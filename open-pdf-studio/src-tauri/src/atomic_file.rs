//! Write beside the destination, then replace it only after a complete, synced write.
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

struct StagedFile(PathBuf);
impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_with(path, |file| file.write_all(bytes), || Ok(()))
}

/// The error text of a write that was cancelled before the replacement.
pub const CANCELLED: &str = "opds-write-cancelled";
const CHUNK: usize = 4 << 20;

fn cancelled_error() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, CANCELLED)
}

/// Like `write`, but stops as soon as `cancelled` is set: between chunks and
/// once more right before the staged file replaces the destination. A
/// cancelled write leaves the destination untouched and removes the staged
/// file. A cancel that arrives after the replacement changes nothing.
pub fn write_cancellable(path: &Path, bytes: &[u8], cancelled: &AtomicBool) -> io::Result<()> {
    let check = || if cancelled.load(Ordering::SeqCst) { Err(cancelled_error()) } else { Ok(()) };
    check()?;
    write_with(path, |file| {
        for chunk in bytes.chunks(CHUNK) {
            check()?;
            file.write_all(chunk)?;
        }
        Ok(())
    }, check)
}

/// Publish a complete new file without ever replacing an existing destination.
/// Filesystems without hard-link support fail safely; there is no copy fallback.
pub fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let (staged, mut file) = loop {
        let serial = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let temp = parent.join(format!(".opds-workflow-{}-{}.tmp", std::process::id(), serial));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&temp) {
            Ok(file) => break (StagedFile(temp), file),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    let result = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    result?;
    fs::hard_link(&staged.0, path)
}

fn write_with(
    path: &Path,
    write_bytes: impl FnOnce(&mut File) -> io::Result<()>,
    before_replace: impl FnOnce() -> io::Result<()>,
) -> io::Result<()> {
    let target = resolve_target(path);
    let permissions = existing_permissions(&target)?;
    if permissions.is_some() {
        // Check write permission without truncating the original.
        OpenOptions::new().write(true).open(&target)?;
    }
    let staged = stage_beside(&target, permissions, write_bytes)?;
    // The last point where a cancel still keeps the destination as it was.
    before_replace()?;
    replace(&staged.0, &target)
}

/// Follow existing symlinks, like an ordinary write, instead of replacing the link.
fn resolve_target(path: &Path) -> PathBuf {
    match fs::canonicalize(path) {
        Ok(target) => target,
        // Not there yet, or a drive that cannot resolve paths (some network,
        // RAM and virtual drives): write to the path as given.
        Err(_) => path.to_path_buf(),
    }
}

/// The permissions of the destination when it exists; an error when it is not
/// a file that may be replaced.
fn existing_permissions(target: &Path) -> io::Result<Option<fs::Permissions>> {
    match fs::metadata(target) {
        Ok(meta) => {
            if !meta.is_file() || meta.permissions().readonly() {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Destination is not a writable file"));
            }
            Ok(Some(meta.permissions()))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Write a complete, synced file beside the destination. Its handle is closed
/// again when this returns; the staged file removes itself when dropped.
fn stage_beside(
    target: &Path,
    permissions: Option<fs::Permissions>,
    write_bytes: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<StagedFile> {
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let (staged, mut file) = loop {
        let serial = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let temp = parent.join(format!(".opds-save-{}-{}.tmp", std::process::id(), serial));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&temp) {
            Ok(file) => break (StagedFile(temp), file),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    };
    // Close the handle before cleanup or rename, including on Windows error paths.
    let result = (|| {
        write_bytes(&mut file)?;
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        file.sync_all()
    })();
    drop(file);
    result?;
    Ok(staged)
}

// ── Files in a folder that other programs read along (#1115) ────────────────
//
// The review files of a shared review live in a folder that a cloud sync
// client, a virus scanner or the other reviewers' apps read at any moment.
// Such a program holds a file open for a short while, often without sharing
// write or delete access. The app therefore never keeps these files open
// longer than one read or write, never writes them in place, and waits a
// moment when one is in use.

/// Waits between the attempts of `write_shared`: about three seconds in all.
pub const SHARED_WRITE_DELAYS_MS: &[u64] = &[50, 100, 200, 400, 800, 1500];
/// Waits between the attempts of `read_shared`.
pub const SHARED_READ_DELAYS_MS: &[u64] = &[50, 100, 200, 400];

/// Windows refuses an open, rename or replace like this while another program
/// has the file open without sharing that access: access denied (5), sharing
/// violation (32) or lock violation (33). Elsewhere a held file never blocks.
pub fn is_in_use(e: &io::Error) -> bool {
    cfg!(windows) && matches!(e.raw_os_error(), Some(5 | 32 | 33))
}

/// Why `write_shared` gave up.
#[derive(Debug)]
pub struct SharedWriteError {
    /// Another program still had the file in use after every attempt; the
    /// destination is as it was and a later attempt can succeed.
    pub in_use: bool,
    pub error: io::Error,
}

impl std::fmt::Display for SharedWriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(f)
    }
}

/// Replace `path` with `bytes` for readers that may open it at any moment:
/// staged beside it and renamed over it, never written in place, so a reader
/// sees the old or the new file and nothing in between. While another program
/// has the destination or the staged file in use, the rename is tried again
/// with growing waits. When it still fails the destination is unchanged, the
/// staged file is gone and the error says whether the file was in use.
pub fn write_shared(path: &Path, bytes: &[u8]) -> Result<(), SharedWriteError> {
    write_shared_with(path, bytes, SHARED_WRITE_DELAYS_MS)
}

fn write_shared_with(path: &Path, bytes: &[u8], delays_ms: &[u64]) -> Result<(), SharedWriteError> {
    let other = |error| SharedWriteError { in_use: false, error };
    let target = resolve_target(path);
    let permissions = existing_permissions(&target).map_err(other)?;
    let staged = stage_beside(&target, permissions, |file| file.write_all(bytes)).map_err(other)?;
    let mut attempt = 0;
    loop {
        match fs::rename(&staged.0, &target) {
            Ok(()) => return Ok(()),
            Err(e) if is_in_use(&e) && attempt < delays_ms.len() => {
                std::thread::sleep(std::time::Duration::from_millis(delays_ms[attempt]));
                attempt += 1;
            }
            Err(error) => return Err(SharedWriteError { in_use: is_in_use(&error), error }),
        }
    }
}

/// Read a whole file that other programs may hold or replace at any moment.
/// The handle shares reading, writing and deleting (the standard library
/// opens files that way on Windows) and is closed before this returns. A file
/// another program holds without sharing reading is tried again briefly.
pub fn read_shared(path: &Path) -> io::Result<Vec<u8>> {
    read_shared_with(path, SHARED_READ_DELAYS_MS)
}

fn read_shared_with(path: &Path, delays_ms: &[u64]) -> io::Result<Vec<u8>> {
    let mut attempt = 0;
    loop {
        match fs::read(path) {
            Err(e) if is_in_use(&e) && attempt < delays_ms.len() => {
                std::thread::sleep(std::time::Duration::from_millis(delays_ms[attempt]));
                attempt += 1;
            }
            result => return result,
        }
    }
}

/// Move the staged file over the destination. On Windows a rename fails while
/// another program (a viewer, the preview pane, a virus scanner) holds the
/// destination open without delete sharing; retry briefly, then write in place
/// as the previous save did, which still works when that program allows writing.
fn replace(staged: &Path, target: &Path) -> io::Result<()> {
    let mut attempt = 0;
    loop {
        match fs::rename(staged, target) {
            Ok(()) => return Ok(()),
            Err(e) if cfg!(windows) && e.kind() == io::ErrorKind::PermissionDenied && target.is_file() => {
                if attempt == 4 {
                    fs::copy(staged, target)?;
                    return Ok(());
                }
                std::thread::sleep(std::time::Duration::from_millis(25 << attempt));
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("opds-atomic-test-{}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn new_file_never_clobbers_and_cleans_staging() {
        let dir = TestDir::new();
        let path = dir.0.join("output.pdf");
        write_new(&path, b"complete").unwrap();
        assert!(write_new(&path, b"different").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"complete");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn creates_and_replaces_file() {
        let dir = TestDir::new();
        let path = dir.0.join("document.pdf");
        write(&path, b"original").unwrap();
        write(&path, b"complete replacement").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"complete replacement");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn partial_write_keeps_original_and_removes_temp() {
        let dir = TestDir::new();
        let path = dir.0.join("document.pdf");
        fs::write(&path, b"original").unwrap();
        let result = write_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::new(io::ErrorKind::Other, "simulated full disk"))
        }, || Ok(()));
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn failed_replacement_keeps_destination_and_removes_temp() {
        let dir = TestDir::new();
        let path = dir.0.join("document.pdf");
        let result = write_with(&path, |file| {
            file.write_all(b"replacement")?;
            fs::create_dir(&path)?;
            fs::write(path.join("keep"), b"untouched")
        }, || Ok(()));
        assert!(result.is_err());
        assert_eq!(fs::read(path.join("keep")).unwrap(), b"untouched");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn cancel_before_the_write_keeps_original_and_leaves_no_temp() {
        let dir = TestDir::new();
        let path = dir.0.join("document.pdf");
        fs::write(&path, b"original").unwrap();
        let cancelled = AtomicBool::new(true);
        let err = write_cancellable(&path, b"replacement", &cancelled).unwrap_err();
        assert!(err.to_string().contains(CANCELLED));
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn cancel_after_staging_keeps_original_and_removes_temp() {
        let dir = TestDir::new();
        let path = dir.0.join("document.pdf");
        fs::write(&path, b"original").unwrap();
        let cancelled = AtomicBool::new(false);
        // Cancelled while the bytes were being staged: the staged file exists
        // when the cancel is seen, and must be gone afterwards.
        let err = write_with(&path, |file| {
            file.write_all(b"replacement")?;
            cancelled.store(true, Ordering::SeqCst);
            Ok(())
        }, || if cancelled.load(Ordering::SeqCst) { Err(cancelled_error()) } else { Ok(()) }).unwrap_err();
        assert!(err.to_string().contains(CANCELLED));
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn cancellable_write_without_cancel_replaces_the_file() {
        let dir = TestDir::new();
        let path = dir.0.join("document.pdf");
        fs::write(&path, b"original").unwrap();
        let big = vec![7u8; CHUNK * 2 + 3];
        write_cancellable(&path, &big, &AtomicBool::new(false)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), big);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn replaces_file_held_open_without_delete_sharing() {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 1;
        const FILE_SHARE_WRITE: u32 = 2;
        let dir = TestDir::new();
        let path = dir.0.join("document.pdf");
        fs::write(&path, b"original").unwrap();
        let _viewer = OpenOptions::new().read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE).open(&path).unwrap();
        write(&path, b"replacement").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn shared_write_creates_replaces_and_leaves_no_temp() {
        let dir = TestDir::new();
        let path = dir.0.join("Plan_Annotation_Alice.jsonl");
        write_shared(&path, b"one\n").unwrap();
        write_shared(&path, b"one\ntwo\n").unwrap();
        assert_eq!(read_shared(&path).unwrap(), b"one\ntwo\n");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
        assert_eq!(read_shared(&dir.0.join("absent.jsonl")).unwrap_err().kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn shared_write_refuses_a_folder_as_destination_at_once() {
        let dir = TestDir::new();
        let folder = dir.0.join("Plan_Annotation_Alice.jsonl");
        fs::create_dir(&folder).unwrap();
        let started = std::time::Instant::now();
        let err = write_shared(&folder, b"x").unwrap_err();
        assert!(!err.in_use);
        assert!(started.elapsed() < std::time::Duration::from_millis(1000), "no waiting for an error that will not pass");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[cfg(windows)]
    mod shared_on_windows {
        use super::*;
        use std::os::windows::fs::OpenOptionsExt;
        const SHARE_READ: u32 = 1;
        const SHARE_WRITE: u32 = 2;
        const SHARE_DELETE: u32 = 4;

        fn hold(path: &Path, share: u32) -> File {
            OpenOptions::new().read(true).share_mode(share).open(path).unwrap()
        }

        /// Another program that has the file open for a while (a sync client
        /// that uploads it, a scanner) and then lets go.
        fn hold_for(path: &Path, share: u32, ms: u64) -> std::thread::JoinHandle<()> {
            let held = hold(path, share);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(ms));
                drop(held);
            })
        }

        #[test]
        fn a_reader_that_shares_everything_does_not_delay_the_write() {
            let dir = TestDir::new();
            let path = dir.0.join("Plan_Annotation_Alice.jsonl");
            fs::write(&path, b"old").unwrap();
            let mut reader = hold(&path, SHARE_READ | SHARE_WRITE | SHARE_DELETE);
            write_shared_with(&path, b"new", &[]).unwrap();
            // The reader keeps the file it opened; a new reader gets the new one.
            let mut seen = String::new();
            io::Read::read_to_string(&mut reader, &mut seen).unwrap();
            assert_eq!(seen, "old");
            assert_eq!(read_shared(&path).unwrap(), b"new");
        }

        #[test]
        fn the_write_waits_for_a_program_that_holds_the_file_briefly() {
            for share in [SHARE_READ, SHARE_READ | SHARE_WRITE] {
                let dir = TestDir::new();
                let path = dir.0.join("Plan_Annotation_Alice.jsonl");
                fs::write(&path, b"old").unwrap();
                let other = hold_for(&path, share, 300);
                write_shared(&path, b"new").unwrap();
                other.join().unwrap();
                assert_eq!(fs::read(&path).unwrap(), b"new");
                assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
            }
        }

        #[test]
        fn a_file_that_stays_in_use_is_reported_and_never_written_in_place() {
            // Sharing read and write but not delete: an in-place write would
            // succeed here, and the holder would read a half-written file.
            for share in [SHARE_READ, SHARE_READ | SHARE_WRITE, 0] {
                let dir = TestDir::new();
                let path = dir.0.join("Plan_Annotation_Alice.jsonl");
                fs::write(&path, b"old").unwrap();
                let held = hold(&path, share);
                let err = write_shared_with(&path, b"new", &[10, 20]).unwrap_err();
                assert!(err.in_use, "share {share}: {err}");
                drop(held);
                assert_eq!(fs::read(&path).unwrap(), b"old");
                assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1, "the staged file is removed");
                // Released: the same write now succeeds.
                write_shared_with(&path, b"new", &[]).unwrap();
                assert_eq!(fs::read(&path).unwrap(), b"new");
            }
        }

        #[test]
        fn the_read_waits_for_a_program_that_holds_the_file_exclusively() {
            let dir = TestDir::new();
            let path = dir.0.join("Plan_Annotation_Bob.jsonl");
            fs::write(&path, b"theirs").unwrap();
            let other = hold_for(&path, 0, 200);
            assert_eq!(read_shared(&path).unwrap(), b"theirs");
            other.join().unwrap();
            let held = hold(&path, 0);
            assert!(is_in_use(&read_shared_with(&path, &[10]).unwrap_err()));
            drop(held);
        }

        #[test]
        fn while_the_app_reads_a_file_another_program_can_replace_it() {
            let dir = TestDir::new();
            let path = dir.0.join("Plan_Annotation_Bob.jsonl");
            fs::write(&path, b"theirs").unwrap();
            // The handle `read_shared` uses (fs::read opens the same way).
            let reading = File::open(&path).unwrap();
            drop(hold(&path, SHARE_READ | SHARE_WRITE | SHARE_DELETE));
            let incoming = dir.0.join("incoming.tmp");
            fs::write(&incoming, b"newer").unwrap();
            fs::rename(&incoming, &path).unwrap();
            drop(reading);
            assert_eq!(fs::read(&path).unwrap(), b"newer");
        }
    }

    #[cfg(unix)]
    #[test]
    fn preserves_symlink_and_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = TestDir::new();
        let target = dir.0.join("original.pdf");
        let link = dir.0.join("link.pdf");
        fs::write(&target, b"old").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
        symlink(&target, &link).unwrap();
        write(&link, b"new").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o640);
    }
}
