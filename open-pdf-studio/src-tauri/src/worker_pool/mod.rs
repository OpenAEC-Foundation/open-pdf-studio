//! Multi-process PDFium worker pool. Transparent to JS — the
//! `render_pdf_page` Tauri command routes through `WorkerPool::render`
//! when the pool is ready, falls back to in-proc PDFium otherwise.
//!
//! Architecture: spec/2026-05-19-multi-process-pdfium-design.md.

pub mod state;
pub mod routing;
pub mod spawn;
pub mod recovery;
pub mod response;

use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::io::AsyncWriteExt;

pub use state::{Status, WorkerState};

pub struct WorkerPool {
    pub workers: Vec<Arc<WorkerState>>,
    next_request_id: std::sync::atomic::AtomicU64,
    /// Laatste render-activiteit (ms sinds epoch) + of er al getrimd is sinds
    /// die activiteit. Open pagina-handles in de workers kosten op zware
    /// CAD-pagina's ruim 1 GB per worker; bij inactiviteit sturen we Trim.
    last_used_ms: std::sync::atomic::AtomicU64,
    trimmed: std::sync::atomic::AtomicBool,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Bovengrens op één worker-response-lees. Ruim boven elke legitieme render
/// (zwaarste blad in het corpus ~28 s whole-page); vangt alleen een écht
/// vastgelopen of protocol-incompatibele worker (bv. een verouderde sidecar
/// die een nieuwe `op` niet kent en niets terugstuurt). Zonder deze grens
/// blokkeert `read_line` eeuwig met de request-lock vast, waardoor die worker
/// voor ALLE volgende requests wedged raakt en de pagina blanco blijft. Bij
/// timeout -> expliciete fout + beëindigen/respawn; nooit in-proc herhalen.
const WORKER_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Pad naar de pdfium-worker-sidecar naast de hoofdbinary. Platform-correct
/// (`.exe` alleen op Windows) zodat respawn ook op Linux/macOS de juiste naam
/// zoekt.
pub(crate) fn worker_exe_path() -> std::path::PathBuf {
    let name = if cfg!(windows) { "pdfium-worker.exe" } else { "pdfium-worker" };
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(name)))
        .unwrap_or_else(|| std::path::PathBuf::from(name))
}

impl WorkerPool {
    pub fn new(workers: Vec<Arc<WorkerState>>) -> Self {
        Self {
            workers,
            next_request_id: std::sync::atomic::AtomicU64::new(1),
            last_used_ms: std::sync::atomic::AtomicU64::new(now_ms()),
            trimmed: std::sync::atomic::AtomicBool::new(true),
        }
    }

    fn touch(&self, worker: &WorkerState) {
        let now = now_ms();
        self.last_used_ms.store(now, Ordering::Release);
        self.trimmed.store(false, Ordering::Release);
        worker.last_used_ms.store(now, Ordering::Release);
        worker.trimmed.store(false, Ordering::Release);
    }

    /// Stuur Trim naar iedere levende worker die zélf langer dan `idle_ms`
    /// niets gerenderd heeft (eenmalig per inactiviteitsperiode). Per-worker:
    /// na de parallelle eerste render koelen de niet-affinity-workers zo
    /// vanzelf af (~1 GB parse-state per stuk terug), terwijl de worker die de
    /// interactieve tegels bedient heet blijft. Onder de per-worker
    /// request_lock zodat het nooit door een lopende exchange vlecht.
    pub async fn trim_if_idle(&self, idle_ms: u64) {
        let now = now_ms();
        for worker in &self.workers {
            if worker.status() != Status::Ready {
                continue;
            }
            if worker.trimmed.load(Ordering::Acquire) {
                continue;
            }
            if now.saturating_sub(worker.last_used_ms.load(Ordering::Acquire)) < idle_ms {
                continue;
            }
            worker.trimmed.store(true, Ordering::Release);
            let request_lock = worker.request_lock.clone();
            let _exchange = request_lock.lock().await;
            let mut stdin_guard = worker.stdin.lock().await;
            if let Some(stdin) = stdin_guard.as_mut() {
                let _ = stdin.write_all(b"{\"op\":\"trim\"}\n").await;
                let _ = stdin.flush().await;
                eprintln!("[pool] worker {} idle — pagina-handles getrimd", worker.slot);
            }
        }
    }

    /// Returns true if at least one worker is Ready.
    pub fn is_ready(&self) -> bool {
        self.workers.iter().any(|w| w.status() == Status::Ready)
    }

    /// Snapshot of current queue depths (usize::MAX for dead slots).
    fn depths(&self) -> Vec<usize> {
        self.workers.iter().map(|w| match w.status() {
            Status::Ready => w.queue_depth.load(Ordering::Acquire),
            _ => usize::MAX,
        }).collect()
    }

    /// Render via the pool. Returns (width, height, rgba_bytes).
    pub async fn render(
        &self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        thin_lines: bool,
    ) -> Result<(u32, u32, Vec<u8>)> {
        // First attempt. Pinned: al het werk voor dezelfde (path, page) —
        // volledige render, thumbnail, tegels — blijft op één worker, ook
        // onder druk. Uitwijken naar een koude worker zou die eerst de hele
        // content-stream laten parsen (seconden + ~1 GB parse-state op zware
        // CAD-bladen), terwijl de warme worker in ~0,4 s klaar is.
        let depths = self.depths();
        if depths.iter().all(|&d| d == usize::MAX) { return Err(response::Unavailable.into()); }
        let slot = routing::pick_worker(path, page_index, &depths, true);
        let worker = self.workers[slot].clone();
        self.touch(&worker);
        worker.queue_depth.fetch_add(1, Ordering::Release);
        let result = self.render_on_worker(worker.clone(), path, page_index, scale, rotation, thin_lines).await;
        worker.queue_depth.fetch_sub(1, Ordering::Release);

        if result.is_ok() {
            return result;
        }

        // Recover failed exchanges; exhausted work is never retried.
        // Other failures may retry once on a different live slot.
        if !result.as_ref().err().is_some_and(response::is_unavailable) {
            recovery::schedule_worker_recovery(worker.clone(), worker_exe_path());
        }
        if result.as_ref().err().is_some_and(response::is_resource_limit) { return result; }

        let mut depths_retry = self.depths();
        depths_retry[slot] = usize::MAX; // mark as dead for this retry
        if depths_retry.iter().all(|&d| d == usize::MAX) {
            return result; // no other workers — bubble up the error
        }
        let slot2 = routing::pick_worker(path, page_index, &depths_retry, true);
        let worker2 = self.workers[slot2].clone();
        self.touch(&worker2);
        worker2.queue_depth.fetch_add(1, Ordering::Release);
        let result2 = self.render_on_worker(worker2.clone(), path, page_index, scale, rotation, thin_lines).await;
        worker2.queue_depth.fetch_sub(1, Ordering::Release);
        if result2.as_ref().err().is_some_and(|e| !response::is_unavailable(e)) {
            recovery::schedule_worker_recovery(worker2, worker_exe_path());
        }
        result2
    }

    async fn render_on_worker(
        &self,
        worker: Arc<WorkerState>,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        thin_lines: bool,
    ) -> Result<(u32, u32, Vec<u8>)> {
        // Eén request tegelijk per worker: het draadprotocol heeft geen id-demux
        // en de SHM-regio wordt per response overschreven.
        let request_lock = worker.request_lock.clone();
        let _t_queue = std::time::Instant::now();
        let _exchange = request_lock.lock().await;
        if worker.status() != Status::Ready { return Err(response::Unavailable.into()); }
        let _t_run = std::time::Instant::now();
        let _plog = PoolTrace::new(worker.slot, "render", path, page_index, scale, _t_queue, _t_run);
        let id = self.next_request_id.fetch_add(1, Ordering::Release);

        let req = render_request(id, path, page_index, scale, rotation, thin_lines);
        let req_line = format!("{}\n", req);

        // Write request
        {
            let mut stdin_guard = worker.stdin.lock().await;
            let stdin = stdin_guard.as_mut()
                .ok_or_else(|| anyhow!("worker {} has no stdin", worker.slot))?;
            stdin.write_all(req_line.as_bytes()).await
                .with_context(|| format!("write to worker {}", worker.slot))?;
            stdin.flush().await?;
        }

        // Read response (met timeout: een vastgelopen/verouderde worker die
        // niets terugstuurt mag de request-lock niet eeuwig vasthouden).
        let resp_line;
        {
            let mut stdout_guard = worker.stdout.lock().await;
            let stdout = stdout_guard.as_mut()
                .ok_or_else(|| anyhow!("worker {} has no stdout", worker.slot))?;
            match response::read_response(stdout, WORKER_READ_TIMEOUT).await {
                Ok(line) => resp_line = line,
                Err(error) => {
                    worker.set_status(Status::Dead);
                    return Err(error.context(format!("read from worker {}", worker.slot)));
                }
            }
        }

        if resp_line.is_empty() {
            return Err(anyhow!("worker {} EOF", worker.slot));
        }

        let resp: serde_json::Value = serde_json::from_str(&resp_line)
            .with_context(|| format!("parse worker {} response: {}", worker.slot, resp_line))?;

        if !resp["ok"].as_bool().unwrap_or(false) {
            let err = resp["error"].as_str().unwrap_or("unknown");
            return Err(anyhow!("worker {} render error: {}", worker.slot, err));
        }

        let w = resp["w"].as_u64().unwrap_or(0) as u32;
        let h = resp["h"].as_u64().unwrap_or(0) as u32;
        let shm_bytes = resp["shm_bytes"].as_u64().unwrap_or(0) as usize;

        // Read RGBA from SHM
        let shm_guard = worker.shm.lock().await;
        let mmap = shm_guard.as_ref()
            .ok_or_else(|| anyhow!("worker {} has no shm", worker.slot))?;
        const HEADER: usize = 32;
        if shm_bytes + HEADER > mmap.len() {
            return Err(anyhow!("worker {} shm_bytes {} exceeds region", worker.slot, shm_bytes));
        }
        let rgba = mmap[HEADER..HEADER + shm_bytes].to_vec();

        Ok((w, h, rgba))
    }

    /// Render a page REGION (tile) via the pool. Small tiles fit the 64 MB SHM
    /// easily, so — unlike whole huge pages — these succeed via the pool and
    /// render in a SEPARATE process (safe: no concurrent in-proc PDFium). One
    /// attempt; on error the caller falls back to in-proc.
    ///
    /// `spread`: true = tegels over alle workers spreiden (parallelle eerste
    /// render); false = affinity op (pad,pagina) zodat interactieve tegels
    /// steeds dezelfde worker (met hete pagina-handle) raken en de overige
    /// workers hun ~1 GB parse-state niet hoeven te dragen.
    pub async fn render_region(
        &self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        region_x_pt: f32,
        region_y_pt: f32,
        region_w_pt: f32,
        region_h_pt: f32,
        spread: bool,
        thin_lines: bool,
    ) -> Result<(u32, u32, Vec<u8>)> {
        let depths = self.depths();
        if depths.iter().all(|&d| d == usize::MAX) { return Err(response::Unavailable.into()); }
        // Salt de affiniteit met de regio-coördinaten wanneer spreiding gewenst
        // is: tegels van DEZELFDE pagina landen dan op verschillende workers.
        let salt = if spread {
            region_x_pt.to_bits() ^ region_y_pt.to_bits().rotate_left(16)
        } else {
            0
        };
        // Zonder spread pinnen we op de affinity-worker (geen overflow-
        // uitwijk): één worker draagt de dure parse-state en serialiseert de
        // tegels à ~0,4 s. Met spread is uitwijken juist gewenst.
        let slot = routing::pick_worker(path, page_index ^ salt, &depths, !spread);
        let worker = self.workers[slot].clone();
        self.touch(&worker);
        worker.queue_depth.fetch_add(1, Ordering::Release);
        let result = self.render_region_on_worker(
            worker.clone(), path, page_index, scale, rotation,
            region_x_pt, region_y_pt, region_w_pt, region_h_pt, thin_lines,
        ).await;
        worker.queue_depth.fetch_sub(1, Ordering::Release);
        // Geen retry; alleen niet-fatale fouten mogen in-proc terugvallen. Een
        // gefaalde/getimede worker is mogelijk gedesynchroniseerd — respawn
        // hem zodat de volgende tegel niet weer op een wedged worker landt.
        if result.as_ref().err().is_some_and(|e| !response::is_unavailable(e)) {
            recovery::schedule_worker_recovery(worker.clone(), worker_exe_path());
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn render_region_on_worker(
        &self,
        worker: Arc<WorkerState>,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        region_x_pt: f32,
        region_y_pt: f32,
        region_w_pt: f32,
        region_h_pt: f32,
        thin_lines: bool,
    ) -> Result<(u32, u32, Vec<u8>)> {
        // Zelfde volledige-round-trip-serialisatie als render_on_worker.
        let request_lock = worker.request_lock.clone();
        let _t_queue = std::time::Instant::now();
        let _exchange = request_lock.lock().await;
        if worker.status() != Status::Ready { return Err(response::Unavailable.into()); }
        let _t_run = std::time::Instant::now();
        let _plog = PoolTrace::new(worker.slot, "region", path, page_index, scale, _t_queue, _t_run);
        let id = self.next_request_id.fetch_add(1, Ordering::Release);

        let req = render_region_request(
            id, path, page_index, scale, rotation,
            region_x_pt, region_y_pt, region_w_pt, region_h_pt, thin_lines,
        );
        let req_line = format!("{}\n", req);

        {
            let mut stdin_guard = worker.stdin.lock().await;
            let stdin = stdin_guard.as_mut()
                .ok_or_else(|| anyhow!("worker {} has no stdin", worker.slot))?;
            stdin.write_all(req_line.as_bytes()).await
                .with_context(|| format!("write to worker {}", worker.slot))?;
            stdin.flush().await?;
        }

        let resp_line;
        {
            let mut stdout_guard = worker.stdout.lock().await;
            let stdout = stdout_guard.as_mut()
                .ok_or_else(|| anyhow!("worker {} has no stdout", worker.slot))?;
            match response::read_response(stdout, WORKER_READ_TIMEOUT).await {
                Ok(line) => resp_line = line,
                Err(error) => {
                    worker.set_status(Status::Dead);
                    return Err(error.context(format!("read from worker {}", worker.slot)));
                }
            }
        }

        if resp_line.is_empty() {
            return Err(anyhow!("worker {} EOF", worker.slot));
        }

        let resp: serde_json::Value = serde_json::from_str(&resp_line)
            .with_context(|| format!("parse worker {} response: {}", worker.slot, resp_line))?;

        if !resp["ok"].as_bool().unwrap_or(false) {
            let err = resp["error"].as_str().unwrap_or("unknown");
            return Err(anyhow!("worker {} region render error: {}", worker.slot, err));
        }

        let w = resp["w"].as_u64().unwrap_or(0) as u32;
        let h = resp["h"].as_u64().unwrap_or(0) as u32;
        let shm_bytes = resp["shm_bytes"].as_u64().unwrap_or(0) as usize;

        let shm_guard = worker.shm.lock().await;
        let mmap = shm_guard.as_ref()
            .ok_or_else(|| anyhow!("worker {} has no shm", worker.slot))?;
        const HEADER: usize = 32;
        if shm_bytes + HEADER > mmap.len() {
            return Err(anyhow!("worker {} shm_bytes {} exceeds region", worker.slot, shm_bytes));
        }
        let rgba = mmap[HEADER..HEADER + shm_bytes].to_vec();

        Ok((w, h, rgba))
    }
}

/// Worker-request voor een volledige pagina (zie pdfium-worker/src/protocol.rs).
/// `thin_lines` = Thin Lines-weergave (#595): de worker tekent elke lijn als
/// haarlijn.
fn render_request(id: u64, path: &str, page_index: u32, scale: f32, rotation: i32, thin_lines: bool) -> serde_json::Value {
    json!({
        "op": "render",
        "id": id,
        "path": path,
        "page_index": page_index,
        "scale": scale,
        "rotation": rotation,
        "thin_lines": thin_lines,
    })
}

/// Worker-request voor een pagina-regio (tegel), zie `render_request`.
#[allow(clippy::too_many_arguments)]
fn render_region_request(
    id: u64,
    path: &str,
    page_index: u32,
    scale: f32,
    rotation: i32,
    region_x_pt: f32,
    region_y_pt: f32,
    region_w_pt: f32,
    region_h_pt: f32,
    thin_lines: bool,
) -> serde_json::Value {
    json!({
        "op": "render_region",
        "id": id,
        "path": path,
        "page_index": page_index,
        "scale": scale,
        "rotation": rotation,
        "region_x_pt": region_x_pt,
        "region_y_pt": region_y_pt,
        "region_w_pt": region_w_pt,
        "region_h_pt": region_h_pt,
        "thin_lines": thin_lines,
    })
}

#[cfg(test)]
mod request_tests {
    use super::*;

    #[test]
    fn both_render_requests_carry_thin_lines() {
        assert_eq!(render_request(1, "a.pdf", 0, 1.0, 0, true)["thin_lines"], json!(true));
        assert_eq!(render_request(1, "a.pdf", 0, 1.0, 0, false)["thin_lines"], json!(false));
        let region = render_region_request(2, "a.pdf", 3, 2.0, 0, 0.0, 0.0, 10.0, 10.0, true);
        assert_eq!(region["thin_lines"], json!(true));
        assert_eq!(region["op"], json!("render_region"));
    }
}

/// Tijdelijke meet-tracer (aan met env `OPDS_POOL_TRACE=1`): schrijft per
/// pool-request de rij-wachttijd en uitvoerduur naar
/// %TEMP%/opds-pool-trace.log. RAII: logt bij drop, dus ook bij fouten.
struct PoolTrace {
    line: Option<String>,
    t_run: std::time::Instant,
}

impl PoolTrace {
    fn new(slot: u32, op: &'static str, path: &str, page: u32, scale: f32,
           t_queue: std::time::Instant, t_run: std::time::Instant) -> Self {
        if std::env::var("OPDS_POOL_TRACE").ok().as_deref() != Some("1") {
            return Self { line: None, t_run };
        }
        let name = std::path::Path::new(path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let wait_ms = t_run.duration_since(t_queue).as_millis();
        Self {
            line: Some(format!("w{} {} p{} s{:.3} wait={}ms {}", slot, op, page, scale, wait_ms, name)),
            t_run,
        }
    }
}

impl Drop for PoolTrace {
    fn drop(&mut self) {
        if let Some(l) = self.line.take() {
            use std::io::Write;
            let p = std::env::temp_dir().join("opds-pool-trace.log");
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
                let _ = writeln!(f, "{} run={}ms", l, self.t_run.elapsed().as_millis());
            }
        }
    }
}

#[cfg(test)]
mod unavailable_tests {
    use super::*;
    #[tokio::test]
    async fn all_dead_returns_an_isolated_error_for_pages_and_regions() {
        let worker = Arc::new(WorkerState::new(0));
        worker.set_status(Status::Dead);
        let pool = WorkerPool {
            workers: vec![worker],
            next_request_id: std::sync::atomic::AtomicU64::new(1),
            last_used_ms: std::sync::atomic::AtomicU64::new(0),
            trimmed: std::sync::atomic::AtomicBool::new(false),
        };
        let page = pool.render("fixture.pdf", 0, 1.0, 0, false).await.unwrap_err();
        assert!(response::is_unavailable(&page));
        let region = pool.render_region("fixture.pdf", 0, 1.0, 0, 0.0, 0.0, 10.0, 10.0, false, false).await.unwrap_err();
        assert!(response::is_unavailable(&region));
    }
}
