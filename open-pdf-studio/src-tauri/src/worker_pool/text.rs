//! Zoektekst van pagina's via de worker-pool (pdfium-worker, page_text/).
//! De worker leest met PDFium de tekst van een reeks pagina's en geeft de
//! tekstitems zoals pdf.js ze voor het zoeken zou maken, binair (`OPT1`) via
//! de SHM-regio. Hij stopt na een tijdsbudget, zodat tegelrenders op dezelfde
//! worker niet lang wachten; de app vraagt de rest in een volgende aanroep.
//!
//! Geen in-proc-terugval: lukt het niet, dan leest de app de tekst met pdf.js
//! zoals voorheen (js/search/rust-zoektekst.js).

use super::{response, routing, Status, WorkerPool, WORKER_READ_TIMEOUT};
use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::sync::atomic::Ordering;
use tokio::io::AsyncWriteExt;

/// Geen worker in de pool kent `page_text` (verouderde sidecar).
#[derive(Debug)]
pub struct Unsupported;
impl std::fmt::Display for Unsupported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PDF_TEXT_UNSUPPORTED")
    }
}
impl std::error::Error for Unsupported {}

/// Fout die de worker zelf meldt (pagina onleesbaar, bestand gewijzigd); de
/// worker is daarna nog gewoon bruikbaar.
#[derive(Debug)]
struct WorkerReported(String);
impl std::fmt::Display for WorkerReported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "worker text error: {}", self.0)
    }
}
impl std::error::Error for WorkerReported {}

pub(super) fn text_request(id: u64, path: &str, first: u32, count: u32, expect_len: Option<u64>) -> serde_json::Value {
    json!({
        "op": "page_text",
        "id": id,
        "path": path,
        "first": first,
        "count": count,
        "expect_len": expect_len,
    })
}

/// Worker voor baan `lane` van `path`: de vaste worker van het pad (zoals
/// `pick_worker` hem zonder uitwijk kiest), en voor elke volgende baan de
/// volgende levende worker. Workers zonder `page_text` tellen niet mee.
pub(super) fn lane_slot(path: &str, depths: &[usize], lane: u32) -> usize {
    let alive: Vec<usize> = (0..depths.len()).filter(|&i| depths[i] != usize::MAX).collect();
    let base = routing::pick_worker(path, 0, depths, true);
    let pos = alive.iter().position(|&i| i == base).unwrap_or(0);
    alive[(pos + lane as usize) % alive.len()]
}

impl WorkerPool {
    /// Zoektekst (`OPT1`, zie pdfium-worker/src/page_text/mod.rs) van pagina's
    /// vanaf `first`; het antwoord noemt hoeveel pagina's erin zitten. Alle
    /// stukken van één document gaan naar dezelfde worker (affiniteit op het
    /// pad), die het document en zijn fonts dan maar één keer laadt.
    ///
    /// `lane`: de app leest een document met een paar banen tegelijk (elk
    /// een eigen stuk pagina's); baan k gaat naar de k-de worker na die van
    /// het pad, zodat de banen echt naast elkaar lopen.
    pub async fn page_text(&self, path: &str, first: u32, count: u32, expect_len: Option<u64>, lane: u32) -> Result<Vec<u8>> {
        let depths: Vec<usize> = self
            .workers
            .iter()
            .map(|w| match w.status() {
                Status::Ready if w.has_cap("page_text") => w.queue_depth.load(Ordering::Acquire),
                _ => usize::MAX,
            })
            .collect();
        if depths.iter().all(|&d| d == usize::MAX) {
            if self.is_ready() {
                return Err(Unsupported.into());
            }
            return Err(response::Unavailable.into());
        }
        let slot = lane_slot(path, &depths, lane);
        let worker = self.workers[slot].clone();
        self.touch(&worker);
        worker.queue_depth.fetch_add(1, Ordering::Release);
        let result = self.text_on_worker(&worker, path, first, count, expect_len).await;
        worker.queue_depth.fetch_sub(1, Ordering::Release);
        if let Err(e) = &result {
            if e.downcast_ref::<WorkerReported>().is_none() && !response::is_unavailable(e) {
                super::recovery::schedule_worker_recovery(worker.clone(), super::worker_exe_path());
            }
        }
        result
    }

    async fn text_on_worker(
        &self,
        worker: &std::sync::Arc<super::WorkerState>,
        path: &str,
        first: u32,
        count: u32,
        expect_len: Option<u64>,
    ) -> Result<Vec<u8>> {
        let request_lock = worker.request_lock.clone();
        let _exchange = request_lock.lock().await;
        if worker.status() != Status::Ready {
            return Err(response::Unavailable.into());
        }
        let id = self.next_request_id.fetch_add(1, Ordering::Release);
        let line = format!("{}\n", text_request(id, path, first, count, expect_len));
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
        let shm_bytes = resp["shm_bytes"].as_u64().unwrap_or(0) as usize;
        let shm_guard = worker.shm.lock().await;
        let mmap = shm_guard.as_ref().ok_or_else(|| anyhow!("worker {} has no shm", worker.slot))?;
        const HEADER: usize = 32;
        if shm_bytes < 16 || shm_bytes + HEADER > mmap.len() {
            return Err(anyhow!("worker {} text shm_bytes {} out of range", worker.slot, shm_bytes));
        }
        Ok(mmap[HEADER..HEADER + shm_bytes].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn request_carries_the_page_range_and_length() {
        let r = text_request(4, "a.pdf", 10, 32, Some(1234));
        assert_eq!(r["op"], json!("page_text"));
        assert_eq!((r["first"].as_u64(), r["count"].as_u64()), (Some(10), Some(32)));
        assert_eq!(r["expect_len"], json!(1234));
        assert_eq!(text_request(4, "a.pdf", 0, 1, None)["expect_len"], json!(null));
    }

    #[test]
    fn lanes_go_to_different_live_workers() {
        let depths = [0, usize::MAX, 3, 0];
        let a = lane_slot("x.pdf", &depths, 0);
        let b = lane_slot("x.pdf", &depths, 1);
        let c = lane_slot("x.pdf", &depths, 2);
        assert!(a != b && b != c && a != c);
        assert!([a, b, c].iter().all(|&i| i != 1));
        // Meer banen dan workers: rond.
        assert_eq!(lane_slot("x.pdf", &depths, 3), a);
    }

    #[tokio::test]
    async fn workers_without_the_capability_are_unsupported() {
        let worker = Arc::new(super::super::WorkerState::new(0));
        worker.set_status(Status::Ready);
        let pool = WorkerPool::new(vec![worker]);
        let err = pool.page_text("a.pdf", 0, 1, None, 0).await.unwrap_err();
        assert!(err.downcast_ref::<Unsupported>().is_some());
    }
}
