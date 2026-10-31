use super::spawn::spawn_worker;
use super::state::{Status, WorkerState};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

const CRASH_WINDOW: Duration = Duration::from_secs(30);
const MAX_CRASHES_IN_WINDOW: usize = 3;
const RESPAWN_DELAY: Duration = Duration::from_secs(1);

/// Called when WorkerPool::render detects an error talking to a worker.
/// Marks the worker Dead, schedules respawn after backoff, and tracks
/// crash count for the DeadPermanent threshold.
pub async fn handle_worker_crash(worker: Arc<WorkerState>, exe_path: PathBuf) {
    // During shutdown a failing request is expected (handles are being torn
    // down); do not touch the status or start a new worker.
    if worker.is_shutting_down() {
        return;
    }
    worker.set_status(Status::Dead);
    let crashes = worker.crashes.fetch_add(1, Ordering::Release) + 1;
    let now = Instant::now();

    let too_many = {
        let mut last = worker.last_crash_at.lock().await;
        let recent = last.map(|t| now.duration_since(t) < CRASH_WINDOW).unwrap_or(false);
        *last = Some(now);
        recent && crashes >= MAX_CRASHES_IN_WINDOW
    };

    if too_many {
        worker.set_status(Status::DeadPermanent);
        eprintln!(
            "[recovery] worker {} crashed {}x in {:?} — marking DeadPermanent",
            worker.slot, crashes, CRASH_WINDOW
        );
        return;
    }

    eprintln!(
        "[recovery] worker {} crashed (#{}); respawning in {:?}",
        worker.slot, crashes, RESPAWN_DELAY
    );

    tokio::time::sleep(RESPAWN_DELAY).await;

    // Release the old worker completely before the new one recreates the SAME
    // file name: our mapping and the old (possibly wedged, still running)
    // process both keep the section open, and truncating a file with an open
    // user-mapped section fails with os error 1224. So: drop our mapping and
    // pipes first, then make sure the old process has exited.
    release_worker_handles(&worker, OLD_WORKER_GRACE).await;
    worker.queue_depth.store(0, Ordering::Release);

    if worker.is_shutting_down() {
        return;
    }

    match spawn_worker(worker.clone(), &exe_path).await {
        Ok(_) => eprintln!("[recovery] worker {} respawned", worker.slot),
        Err(e) => {
            eprintln!("[recovery] worker {} respawn failed: {}", worker.slot, e);
            worker.set_status(Status::Dead);
        }
    }
}

/// How long a respawn waits for the old worker to exit after its stdin is
/// closed, before killing it.
const OLD_WORKER_GRACE: Duration = Duration::from_millis(200);
/// Upper bound on waiting for a killed worker to be reaped.
const KILL_WAIT: Duration = Duration::from_secs(2);

/// Drop the app's mapping and pipes of `worker` and stop its process: close
/// stdin (the worker exits on EOF and removes its own SHM file), wait up to
/// `grace`, then kill and wait for the exit. Afterwards nothing in this
/// process holds the worker's SHM file. Best effort; never panics.
pub(crate) async fn release_worker_handles(worker: &WorkerState, grace: Duration) {
    *worker.shm.lock().await = None;
    *worker.stdin.lock().await = None;
    let child = worker.child.lock().await.take();
    if let Some(mut child) = child {
        if !matches!(tokio::time::timeout(grace, child.wait()).await, Ok(Ok(_))) {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(KILL_WAIT, child.wait()).await;
        }
    }
    // stdout last: a request that was still reading it ends with EOF once the
    // process is gone, which releases this lock.
    if let Ok(mut stdout) = tokio::time::timeout(KILL_WAIT, worker.stdout.lock()).await {
        *stdout = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn three_quick_crashes_marks_permanent() {
        // Use a non-existent exe path so respawn always fails — we just
        // care about the crash counter / DeadPermanent transition.
        let worker = Arc::new(WorkerState::new(0));
        let bad_path = PathBuf::from("C:/does-not-exist.exe");

        // First crash: status Dead, respawn attempted (fails, set Dead again)
        handle_worker_crash(worker.clone(), bad_path.clone()).await;
        assert_eq!(worker.status(), Status::Dead);

        // Second crash within 30s: still Dead, not yet permanent
        handle_worker_crash(worker.clone(), bad_path.clone()).await;
        // crashes counter is 2 now

        // Third crash: should hit MAX_CRASHES_IN_WINDOW
        handle_worker_crash(worker.clone(), bad_path).await;
        assert_eq!(worker.status(), Status::DeadPermanent);
    }
}
