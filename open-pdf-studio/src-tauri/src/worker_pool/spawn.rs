use super::shm_files;
use super::state::{Status, WorkerState};
use anyhow::{anyhow, Context, Result};
use memmap2::MmapOptions;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

const SHM_SIZE: usize = 64 * 1024 * 1024;
const READY_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn spawn_worker(worker: Arc<WorkerState>, exe_path: &std::path::Path) -> Result<()> {
    if worker.is_shutting_down() {
        return Err(anyhow!("worker {} not spawned: pool is shutting down", worker.slot));
    }
    worker.set_status(Status::Spawning);

    // Namespace SHM by THIS app process's PID so a detached document window
    // running as its own process spawns workers with distinct SHM files
    // (else both processes fight over pdfium-worker-{slot}.shm → os error 1224).
    let ns = std::process::id().to_string();
    let mut cmd = Command::new(exe_path);
    cmd.arg(worker.slot.to_string())
        .arg(&ns)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        // A worker that never makes it into the pool (ready timeout, failed
        // mmap) must not linger with its SHM file open: dropping the Child on
        // those error paths kills it.
        .kill_on_drop(true);
    // Hide the worker's console window — the GUI parent has no console to
    // share, so without this every pool worker pops up a black console box.
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn()
        .with_context(|| format!("spawn worker {} from {:?}", worker.slot, exe_path))?;

    let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    let mut reader = BufReader::new(stdout);

    // Wait for ready line (with timeout)
    let mut ready_line = String::new();
    timeout(READY_TIMEOUT, reader.read_line(&mut ready_line)).await
        .with_context(|| format!("worker {} ready timeout", worker.slot))?
        .with_context(|| format!("worker {} ready read", worker.slot))?;

    if !ready_line.contains("\"op\":\"ready\"") {
        return Err(anyhow!("worker {} did not send ready: {}", worker.slot, ready_line));
    }

    // mmap the SHM file the worker created (same PID-namespaced path)
    let shm_path = shm_files::path_in(&std::env::temp_dir(), &ns, worker.slot);
    let file = std::fs::OpenOptions::new()
        .read(true).write(false)
        .open(&shm_path)
        .with_context(|| format!("open SHM {}", shm_path.display()))?;
    let mmap = unsafe {
        MmapOptions::new().len(SHM_SIZE).map(&file)
            .with_context(|| format!("mmap SHM {}", shm_path.display()))?
    };
    // The mapping keeps the section alive; the file handle itself is not
    // needed any more (and must not keep the file open on Windows).
    drop(file);

    // Stash handles in the WorkerState
    *worker.child.lock().await = Some(child);
    *worker.stdin.lock().await = Some(stdin);
    *worker.stdout.lock().await = Some(reader);
    *worker.shm.lock().await = Some(mmap);
    worker.set_status(Status::Ready);

    Ok(())
}

pub async fn spawn_pool(n_workers: u32, exe_path: &std::path::Path) -> Result<Vec<Arc<WorkerState>>> {
    let mut workers = Vec::with_capacity(n_workers as usize);
    for slot in 0..n_workers {
        let w = Arc::new(WorkerState::new(slot));
        workers.push(w.clone());
        match spawn_worker(w.clone(), exe_path).await {
            Ok(_) => {
                eprintln!("[pool] worker {} ready", slot);
            }
            Err(e) => {
                eprintln!("[pool] worker {} spawn failed: {} — pool will run with N-1", slot, e);
                w.set_status(Status::DeadPermanent);
            }
        }
    }
    Ok(workers)
}
