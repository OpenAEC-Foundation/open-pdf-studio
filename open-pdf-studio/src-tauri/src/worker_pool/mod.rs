//! Multi-process PDFium worker pool. Transparent to JS — the
//! `render_pdf_page` Tauri command routes through `WorkerPool::render`
//! when the pool is ready, falls back to in-proc PDFium otherwise.
//!
//! Architecture: spec/2026-05-19-multi-process-pdfium-design.md.

pub mod state;
pub mod routing;
pub mod spawn;
pub mod recovery;

use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

pub use state::{Status, WorkerState};

use crate::PDFIUM_WORKER_EXE;

pub struct WorkerPool {
    pub workers: Vec<Arc<WorkerState>>,
    next_request_id: std::sync::atomic::AtomicU64,
}

impl WorkerPool {
    pub fn new(workers: Vec<Arc<WorkerState>>) -> Self {
        Self {
            workers,
            next_request_id: std::sync::atomic::AtomicU64::new(1),
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
    ) -> Result<(u32, u32, Vec<u8>)> {
        // First attempt
        let depths = self.depths();
        let slot = routing::pick_worker(path, page_index, &depths);
        let worker = self.workers[slot].clone();
        worker.queue_depth.fetch_add(1, Ordering::Release);
        let result = self.render_on_worker(worker.clone(), path, page_index, scale, rotation).await;
        worker.queue_depth.fetch_sub(1, Ordering::Release);

        if result.is_ok() {
            return result;
        }

        // First attempt failed → mark crash, retry on a DIFFERENT live slot
        let exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join(PDFIUM_WORKER_EXE)))
            .unwrap_or_else(|| std::path::PathBuf::from(PDFIUM_WORKER_EXE));
        let recover_task = recovery::handle_worker_crash(worker.clone(), exe);
        tokio::spawn(recover_task);

        let mut depths_retry = self.depths();
        depths_retry[slot] = usize::MAX; // mark as dead for this retry
        if depths_retry.iter().all(|&d| d == usize::MAX) {
            return result; // no other workers — bubble up the error
        }
        let slot2 = routing::pick_worker(path, page_index, &depths_retry);
        let worker2 = self.workers[slot2].clone();
        worker2.queue_depth.fetch_add(1, Ordering::Release);
        let result2 = self.render_on_worker(worker2.clone(), path, page_index, scale, rotation).await;
        worker2.queue_depth.fetch_sub(1, Ordering::Release);
        result2
    }

    async fn render_on_worker(
        &self,
        worker: Arc<WorkerState>,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<(u32, u32, Vec<u8>)> {
        let id = self.next_request_id.fetch_add(1, Ordering::Release);

        let req = json!({
            "op": "render",
            "id": id,
            "path": path,
            "page_index": page_index,
            "scale": scale,
            "rotation": rotation,
        });
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

        // Read response
        let mut resp_line = String::new();
        {
            let mut stdout_guard = worker.stdout.lock().await;
            let stdout = stdout_guard.as_mut()
                .ok_or_else(|| anyhow!("worker {} has no stdout", worker.slot))?;
            stdout.read_line(&mut resp_line).await
                .with_context(|| format!("read from worker {}", worker.slot))?;
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
}
