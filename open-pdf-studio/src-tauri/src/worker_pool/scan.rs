//! Pixelwerk op een paginabeeld via de worker-pool (pdfium-worker,
//! raster_scan/): symbolen zoeken en formuliervormen herkennen. De worker
//! rendert de pagina zelf en geeft alleen de uitkomst terug, als één
//! JSON-regel; er gaat geen bitmap over IPC en niets via de SHM-regio.
//!
//! Geen in-proc-terugval: lukt het niet, dan rekent de app in JavaScript
//! zoals voorheen (js/pdf/raster-scan-rust.js).

use super::{recovery, response, routing, worker_exe_path, Status, WorkerPool, WORKER_READ_TIMEOUT};
use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::sync::atomic::Ordering;
use tokio::io::AsyncWriteExt;

/// De aanvraag zoals hij naar de worker gaat: die van de app met `op` en `id`
/// van de pool erin (wat de app daar zelf invulde telt niet).
pub(super) fn scan_request(mut request: serde_json::Value, op: &str, id: u64) -> serde_json::Value {
    request["op"] = json!(op);
    request["id"] = json!(id);
    request
}

impl WorkerPool {
    /// Eén aanvraag `op` (`symbol_scan` of `form_shapes`) naar een worker die
    /// `raster_scan` kent. `request` is de aanvraag zonder `op` en `id`.
    /// Affiniteit op (pad, pagina): de worker die de pagina tekent heeft hem
    /// vaak al geparst. Geeft de antwoordregel terug, ook als de worker zelf
    /// een fout meldt (`ok: false`); die is daarna gewoon bruikbaar. Geen
    /// worker met `raster_scan` = Unavailable.
    pub async fn raster_scan(&self, op: &str, request: serde_json::Value, path: &str, page_index: u32) -> Result<serde_json::Value> {
        let depths: Vec<usize> = self
            .workers
            .iter()
            .map(|w| match w.status() {
                Status::Ready if w.has_cap("raster_scan") => w.queue_depth.load(Ordering::Acquire),
                _ => usize::MAX,
            })
            .collect();
        if depths.iter().all(|&d| d == usize::MAX) {
            return Err(response::Unavailable.into());
        }
        let slot = routing::pick_worker(path, page_index, &depths, true);
        let worker = self.workers[slot].clone();
        self.touch(&worker);
        worker.queue_depth.fetch_add(1, Ordering::Release);
        let result = async {
            let request_lock = worker.request_lock.clone();
            let _exchange = request_lock.lock().await;
            if worker.status() != Status::Ready {
                return Err(response::Unavailable.into());
            }
            let id = self.next_request_id.fetch_add(1, Ordering::Release);
            let line = format!("{}\n", scan_request(request, op, id));
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
                .with_context(|| format!("parse worker {} {} response", worker.slot, op))?;
            if resp["id"].as_u64() != Some(id) {
                worker.set_status(Status::Dead);
                return Err(anyhow!("worker {} answered another request", worker.slot));
            }
            Ok(resp)
        }
        .await;
        worker.queue_depth.fetch_sub(1, Ordering::Release);
        if result.as_ref().err().is_some_and(|e| !response::is_unavailable(e)) {
            recovery::schedule_worker_recovery(worker.clone(), worker_exe_path());
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::scan_request;
    use serde_json::json;

    #[test]
    fn the_pool_sets_op_and_id() {
        let app = json!({ "raster": { "path": "a.pdf", "page_index": 2, "width": 10, "height": 8 }, "scale": 1.5, "op": "shutdown", "id": 1 });
        let line = scan_request(app, "form_shapes", 42);
        assert_eq!(line["op"], json!("form_shapes"));
        assert_eq!(line["id"], json!(42));
        assert_eq!(line["raster"]["page_index"], json!(2));
        assert_eq!(line["scale"], json!(1.5));
    }
}
