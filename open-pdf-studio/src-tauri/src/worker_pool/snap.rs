//! Snap-geometrie van een pagina via de worker-pool (pdfium-worker,
//! snap_geometry.rs). De worker leest de padobjecten uit de pagina die hij
//! voor het tekenen al geparst heeft; het resultaat komt in stukken van ten
//! hoogste één SHM-regio terug (grote tekeningen passen niet in 64 MB).
//!
//! Geen in-proc-terugval: lukt het niet, dan extraheert de app in JavaScript
//! zoals voorheen (pdf-snap-extractor.js).

use super::{response, routing, Status, WorkerPool, WORKER_READ_TIMEOUT};
use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::sync::atomic::Ordering;
use tokio::io::AsyncWriteExt;

/// Geen worker in de pool kent `snap_geometry` (verouderde sidecar).
#[derive(Debug)]
pub struct Unsupported;
impl std::fmt::Display for Unsupported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PDF_SNAP_UNSUPPORTED")
    }
}
impl std::error::Error for Unsupported {}

/// Fout in het antwoord van de worker zelf (pagina onleesbaar e.d.); de
/// worker is daarna nog gewoon bruikbaar.
#[derive(Debug)]
struct WorkerReported(String);
impl std::fmt::Display for WorkerReported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "worker snap error: {}", self.0)
    }
}
impl std::error::Error for WorkerReported {}

pub(super) fn snap_request(id: u64, path: &str, page_index: u32, viewport: &[f64; 6], offset: u64) -> serde_json::Value {
    json!({
        "op": "snap_geometry",
        "id": id,
        "path": path,
        "page_index": page_index,
        "viewport": viewport,
        "offset": offset,
    })
}

impl WorkerPool {
    /// Snap-geometrie (`OSG1`-codering, zie pdfium-worker/src/snap_geometry.rs).
    /// Zelfde affiniteit als het tekenen van de pagina, zodat de worker met de
    /// open pagina-handle hem levert zonder opnieuw te parsen.
    pub async fn snap_geometry(&self, path: &str, page_index: u32, viewport: [f64; 6]) -> Result<Vec<u8>> {
        let depths: Vec<usize> = self
            .workers
            .iter()
            .map(|w| match w.status() {
                Status::Ready if w.has_cap("snap_geometry") => w.queue_depth.load(Ordering::Acquire),
                _ => usize::MAX,
            })
            .collect();
        if depths.iter().all(|&d| d == usize::MAX) {
            if self.is_ready() {
                return Err(Unsupported.into());
            }
            return Err(response::Unavailable.into());
        }
        let slot = routing::pick_worker(path, page_index, &depths, true);
        let worker = self.workers[slot].clone();
        self.touch(&worker);
        worker.queue_depth.fetch_add(1, Ordering::Release);
        let result = self.snap_on_worker(&worker, path, page_index, &viewport).await;
        worker.queue_depth.fetch_sub(1, Ordering::Release);
        // Een mislukte uitwisseling kan de worker uit de pas brengen: opnieuw
        // starten zoals bij het tekenen. Een fout die de worker zelf meldt niet.
        if let Err(e) = &result {
            if e.downcast_ref::<WorkerReported>().is_none() && !response::is_unavailable(e) {
                super::recovery::schedule_worker_recovery(worker.clone(), super::worker_exe_path());
            }
        }
        result
    }

    async fn snap_on_worker(
        &self,
        worker: &std::sync::Arc<super::WorkerState>,
        path: &str,
        page_index: u32,
        viewport: &[f64; 6],
    ) -> Result<Vec<u8>> {
        // De hele reeks stukken onder één request-lock: de worker bewaart het
        // resultaat alleen tot het volgende request.
        let request_lock = worker.request_lock.clone();
        let _exchange = request_lock.lock().await;
        if worker.status() != Status::Ready {
            return Err(response::Unavailable.into());
        }
        let mut out: Vec<u8> = Vec::new();
        let mut offset: u64 = 0;
        loop {
            let id = self.next_request_id.fetch_add(1, Ordering::Release);
            let line = format!("{}\n", snap_request(id, path, page_index, viewport, offset));
            {
                let mut stdin_guard = worker.stdin.lock().await;
                let stdin = stdin_guard.as_mut().ok_or_else(|| anyhow!("worker {} has no stdin", worker.slot))?;
                stdin.write_all(line.as_bytes()).await.with_context(|| format!("write to worker {}", worker.slot))?;
                stdin.flush().await?;
            }
            let resp_line = {
                let mut stdout_guard = worker.stdout.lock().await;
                let stdout = stdout_guard.as_mut().ok_or_else(|| anyhow!("worker {} has no stdout", worker.slot))?;
                match response::read_response(stdout, WORKER_READ_TIMEOUT).await {
                    Ok(line) => line,
                    Err(error) => {
                        worker.set_status(Status::Dead);
                        return Err(error.context(format!("read from worker {}", worker.slot)));
                    }
                }
            };
            let resp: serde_json::Value = serde_json::from_str(&resp_line)
                .with_context(|| format!("parse worker {} response: {}", worker.slot, resp_line))?;
            if resp["id"].as_u64() != Some(id) {
                worker.set_status(Status::Dead);
                return Err(anyhow!("worker {} answered another request", worker.slot));
            }
            if !resp["ok"].as_bool().unwrap_or(false) {
                return Err(WorkerReported(resp["error"].as_str().unwrap_or("unknown").to_string()).into());
            }
            let total = resp["total_bytes"].as_u64().unwrap_or(0);
            let chunk_offset = resp["offset"].as_u64().unwrap_or(u64::MAX);
            let shm_bytes = resp["shm_bytes"].as_u64().unwrap_or(0) as usize;
            if chunk_offset != offset || offset + shm_bytes as u64 > total {
                return Err(anyhow!("worker {} snap chunk out of order ({} at {})", worker.slot, chunk_offset, offset));
            }
            if out.capacity() == 0 {
                out.reserve_exact(total as usize);
            }
            {
                let shm_guard = worker.shm.lock().await;
                let mmap = shm_guard.as_ref().ok_or_else(|| anyhow!("worker {} has no shm", worker.slot))?;
                const HEADER: usize = 32;
                if shm_bytes + HEADER > mmap.len() {
                    return Err(anyhow!("worker {} shm_bytes {} exceeds region", worker.slot, shm_bytes));
                }
                out.extend_from_slice(&mmap[HEADER..HEADER + shm_bytes]);
            }
            offset += shm_bytes as u64;
            if offset >= total {
                return Ok(out);
            }
            if shm_bytes == 0 {
                return Err(anyhow!("worker {} returned an empty snap chunk", worker.slot));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn request_carries_viewport_and_offset() {
        let r = snap_request(3, "a.pdf", 1, &[1.0, 0.0, 0.0, -1.0, 0.0, 842.0], 64);
        assert_eq!(r["op"], json!("snap_geometry"));
        assert_eq!(r["viewport"], json!([1.0, 0.0, 0.0, -1.0, 0.0, 842.0]));
        assert_eq!(r["offset"], json!(64));
    }

    #[tokio::test]
    async fn workers_without_the_capability_are_unsupported() {
        let worker = Arc::new(super::super::WorkerState::new(0));
        worker.set_status(Status::Ready);
        let pool = WorkerPool::new(vec![worker]);
        let err = pool.snap_geometry("a.pdf", 0, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]).await.unwrap_err();
        assert!(err.downcast_ref::<Unsupported>().is_some());
    }
}
