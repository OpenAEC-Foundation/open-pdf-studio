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
pub fn schedule_worker_recovery(worker: Arc<WorkerState>, exe_path: PathBuf) {
    if worker.recovering.swap(true, Ordering::AcqRel) { return; }
    worker.set_status(Status::Dead);
    tokio::spawn(handle_worker_crash(worker, exe_path));
}

async fn handle_worker_crash(worker: Arc<WorkerState>, exe_path: PathBuf) {
    worker.set_status(Status::Dead);
    // Serialize teardown with every exchange, including already queued callers.
    // kill().await both terminates and reaps the old process before respawn.
    let request_lock = worker.request_lock.clone();
    let _exchange = request_lock.lock().await;
    if let Some(mut child) = worker.child.lock().await.take() {
        let _ = child.kill().await;
    }
    *worker.stdin.lock().await = None;
    *worker.stdout.lock().await = None;
    *worker.shm.lock().await = None;
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

    // Queued callers own their increments/decrements; resetting underflows them.

    match spawn_worker(worker.clone(), &exe_path).await {
        Ok(_) => eprintln!("[recovery] worker {} respawned", worker.slot),
        Err(e) => {
            eprintln!("[recovery] worker {} respawn failed: {}", worker.slot, e);
            worker.set_status(Status::Dead);
        }
    }
    worker.recovering.store(false, Ordering::Release);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scheduling_recovery_claims_slot_once_and_preserves_queued_work() {
        let worker = Arc::new(WorkerState::new(0));
        worker.set_status(Status::Ready);
        worker.queue_depth.store(2, Ordering::Release);
        let lock = worker.request_lock.clone();
        let exchange = lock.lock().await;
        schedule_worker_recovery(worker.clone(), PathBuf::from("/nonexistent-worker"));
        schedule_worker_recovery(worker.clone(), PathBuf::from("/nonexistent-worker"));
        assert_eq!(worker.status(), Status::Dead);
        assert!(worker.recovering.load(Ordering::Acquire));
        drop(exchange);
        tokio::time::timeout(Duration::from_secs(5), async {
            while worker.recovering.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert_eq!(worker.crashes.load(Ordering::Acquire), 1);
        assert_eq!(worker.queue_depth.load(Ordering::Acquire), 2);
        worker.queue_depth.fetch_sub(2, Ordering::Release);
        assert_eq!(worker.queue_depth.load(Ordering::Acquire), 0);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn recovery_terminates_and_reaps_old_child() {
        let worker = Arc::new(WorkerState::new(0));
        let child = tokio::process::Command::new("sleep").arg("60").spawn().unwrap();
        let pid = child.id().unwrap();
        *worker.child.lock().await = Some(child);
        handle_worker_crash(worker, PathBuf::from("/nonexistent-worker")).await;
        assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
    }

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
