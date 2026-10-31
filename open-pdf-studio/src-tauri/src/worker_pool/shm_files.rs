//! Naming and cleanup of the PDFium worker shared-memory files.
//!
//! Every worker owns a 64 MB backing file `pdfium-worker-<app pid>-<slot>.shm`
//! in the OS temp dir (the worker creates it, the app maps it read-only; see
//! `spawn.rs` and `pdfium-worker/src/shm.rs`). The app removes its own files
//! when the pool shuts down; this module also sweeps files left behind by app
//! processes that no longer run (crash, kill, forced exit).
//!
//! Std-only on purpose: the pure parts (name parsing, the delete decision, the
//! directory sweep with an injected liveness check) can be tested in isolation
//! with `rustc --test src/worker_pool/shm_files.rs`, independently of the app
//! crate. The OS liveness check lives in `mod.rs` (`process_alive`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

const PREFIX: &str = "pdfium-worker-";
const SUFFIX: &str = ".shm";

/// Upper bound on directory entries the sweep looks at, so a pathological temp
/// dir cannot keep the background thread busy for long.
pub const MAX_SCANNED_ENTRIES: usize = 500_000;

/// File name for a worker slot of the app process `ns` (its pid).
pub fn file_name(ns: &str, slot: u32) -> String {
    format!("{PREFIX}{ns}-{slot}{SUFFIX}")
}

/// Full path in `dir`. Main and worker must agree on this name; the worker
/// builds the same `pdfium-worker-<ns>-<slot>.shm` under the temp dir.
pub fn path_in(dir: &Path, ns: &str, slot: u32) -> PathBuf {
    dir.join(file_name(ns, slot))
}

/// Path in the OS temp dir for this app process's worker `slot`.
pub fn own_path(slot: u32) -> PathBuf {
    path_in(&std::env::temp_dir(), &std::process::id().to_string(), slot)
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Parse `pdfium-worker-<pid>-<slot>.shm` into `(pid, slot)`. Only that exact
/// shape matches: plain ASCII digits (no sign, no spaces), nothing before or
/// after, numbers that fit in a u32.
pub fn parse_file_name(name: &str) -> Option<(u32, u32)> {
    let rest = name.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
    let (pid, slot) = rest.split_once('-')?;
    if !all_digits(pid) || !all_digits(slot) {
        return None;
    }
    Some((pid.parse().ok()?, slot.parse().ok()?))
}

/// Should the sweep remove a temp-dir entry with this name? Only files of the
/// exact worker pattern whose owning app process is gone. Never our own pid
/// (our workers may be creating their files right now) and never pid 0 (the
/// worker's default namespace when started by hand).
pub fn should_delete(name: &str, own_pid: u32, is_alive: &mut dyn FnMut(u32) -> bool) -> bool {
    match parse_file_name(name) {
        Some((pid, _)) if pid != 0 && pid != own_pid => !is_alive(pid),
        _ => false,
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepStats {
    pub removed: usize,
    pub bytes: u64,
    /// Matched a dead owner but could not be removed (still open somewhere,
    /// permissions): left alone, a later sweep tries again.
    pub skipped: usize,
}

/// Remove stale worker files from `dir`. Best effort: unreadable entries and
/// failed deletes (e.g. a sharing violation because a straggling process still
/// has the file open) are skipped. Liveness is asked once per pid.
pub fn sweep_dir(dir: &Path, own_pid: u32, is_alive: &mut dyn FnMut(u32) -> bool, max_entries: usize) -> SweepStats {
    let mut stats = SweepStats::default();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return stats,
    };
    let mut known: HashMap<u32, bool> = HashMap::new();
    let mut cached_alive = |pid: u32| *known.entry(pid).or_insert_with(|| is_alive(pid));
    for entry in entries.take(max_entries) {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !should_delete(name, own_pid, &mut cached_alive) {
            continue;
        }
        // Only plain files; never follow or remove a directory or link.
        let Ok(meta) = std::fs::symlink_metadata(entry.path()) else { continue };
        if !meta.file_type().is_file() {
            continue;
        }
        match std::fs::remove_file(entry.path()) {
            Ok(()) => {
                stats.removed += 1;
                stats.bytes += meta.len();
            }
            Err(_) => stats.skipped += 1,
        }
    }
    stats
}

/// Remove `path`, retrying briefly: right after a process exits, Windows can
/// still report the file as in use for a moment. A missing file counts as
/// removed.
pub fn remove_with_retry(path: &Path, attempts: u32, delay: Duration) -> bool {
    for i in 0..attempts.max(1) {
        match std::fs::remove_file(path) {
            Ok(()) => return true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return true,
            Err(_) if i + 1 < attempts => std::thread::sleep(delay),
            Err(_) => {}
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_round_trips() {
        assert_eq!(file_name("1234", 3), "pdfium-worker-1234-3.shm");
        assert_eq!(parse_file_name(&file_name("1234", 3)), Some((1234, 3)));
        assert_eq!(parse_file_name("pdfium-worker-4294967295-0.shm"), Some((u32::MAX, 0)));
    }

    #[test]
    fn rejects_anything_but_the_exact_pattern() {
        for name in [
            "pdfium-worker-test-999.shm",   // worker unit-test namespace
            "pdfium-worker-12-.shm",
            "pdfium-worker--3.shm",
            "pdfium-worker-12.shm",
            "pdfium-worker-12-3-4.shm",
            "pdfium-worker-+12-3.shm",
            "pdfium-worker-12-+3.shm",
            "pdfium-worker- 12-3.shm",
            "pdfium-worker-12-3.shm.bak",
            "pdfium-worker-12-3.SHM",
            "PDFIUM-WORKER-12-3.shm",
            "xpdfium-worker-12-3.shm",
            "pdfium-worker-12-3.shmx",
            "pdfium-worker-4294967296-0.shm", // pid overflows u32
            "pdfium-worker-١٢-3.shm",       // non-ASCII digits
            "opds-pool-trace.log",
            "",
        ] {
            assert_eq!(parse_file_name(name), None, "{name:?}");
        }
    }

    #[test]
    fn delete_decision() {
        let own = 100;
        let mut alive = |pid: u32| pid == 200 || pid == own;
        // Dead owner: delete.
        assert!(should_delete("pdfium-worker-300-0.shm", own, &mut alive));
        // Live other instance (e.g. a detached document window): keep.
        assert!(!should_delete("pdfium-worker-200-1.shm", own, &mut alive));
        // Our own files: never, even if the liveness check says dead.
        let mut all_dead = |_: u32| false;
        assert!(!should_delete("pdfium-worker-100-2.shm", own, &mut all_dead));
        // pid 0 (manual worker run) and foreign names: never.
        assert!(!should_delete("pdfium-worker-0-0.shm", own, &mut all_dead));
        assert!(!should_delete("pdfium-worker-test-999.shm", own, &mut all_dead));
        assert!(!should_delete("something-else.shm", own, &mut all_dead));
    }

    #[test]
    fn delete_decision_does_not_ask_liveness_for_foreign_names() {
        let mut asked = Vec::new();
        let mut alive = |pid: u32| {
            asked.push(pid);
            false
        };
        should_delete("pdfium-worker-x-1.shm", 1, &mut alive);
        should_delete("pdfium-worker-1-1.shm", 1, &mut alive);
        should_delete("pdfium-worker-0-1.shm", 1, &mut alive);
        assert!(asked.is_empty());
    }

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("opds-shm-files-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sweep_removes_only_dead_owners_files() {
        let dir = scratch_dir("sweep");
        let own = 100;
        let keep = [
            "pdfium-worker-100-0.shm", // own
            "pdfium-worker-200-0.shm", // live other instance
            "pdfium-worker-200-1.shm",
            "pdfium-worker-test-999.shm",
            "pdfium-worker-0-0.shm",
            "unrelated.txt",
        ];
        let gone = ["pdfium-worker-300-0.shm", "pdfium-worker-300-3.shm", "pdfium-worker-301-0.shm"];
        for n in keep.iter().chain(gone.iter()) {
            std::fs::write(dir.join(n), b"1234").unwrap();
        }
        // A directory with a matching name must be left alone.
        std::fs::create_dir(dir.join("pdfium-worker-302-0.shm")).unwrap();

        let mut asked: Vec<u32> = Vec::new();
        let mut alive = |pid: u32| {
            asked.push(pid);
            pid == 200
        };
        let stats = sweep_dir(&dir, own, &mut alive, MAX_SCANNED_ENTRIES);
        assert_eq!(stats, SweepStats { removed: 3, bytes: 12, skipped: 0 });
        for n in keep {
            assert!(dir.join(n).exists(), "{n} must stay");
        }
        for n in gone {
            assert!(!dir.join(n).exists(), "{n} must be removed");
        }
        assert!(dir.join("pdfium-worker-302-0.shm").is_dir());
        // One liveness query per pid, never for own pid or pid 0.
        asked.sort_unstable();
        assert_eq!(asked, vec![200, 300, 301, 302]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sweep_of_missing_dir_is_a_no_op() {
        let dir = std::env::temp_dir().join("opds-shm-files-test-does-not-exist");
        let mut alive = |_: u32| false;
        assert_eq!(sweep_dir(&dir, 1, &mut alive, 10), SweepStats::default());
    }

    #[test]
    fn remove_with_retry_treats_missing_as_done() {
        let dir = scratch_dir("retry");
        let p = path_in(&dir, "42", 1);
        std::fs::write(&p, b"x").unwrap();
        assert!(remove_with_retry(&p, 3, Duration::from_millis(1)));
        assert!(!p.exists());
        assert!(remove_with_retry(&p, 3, Duration::from_millis(1)));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
