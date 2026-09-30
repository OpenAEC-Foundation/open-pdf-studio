//! Write beside the destination, then replace it only after a complete, synced write.
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

struct StagedFile(PathBuf);
impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_with(path, |file| file.write_all(bytes))
}

fn write_with(path: &Path, write_bytes: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    // Follow existing symlinks, like an ordinary write, instead of replacing the link.
    let target = match fs::canonicalize(path) {
        Ok(target) => target,
        Err(e) if e.kind() == io::ErrorKind::NotFound => path.to_path_buf(),
        Err(e) => return Err(e),
    };
    let permissions = match fs::metadata(&target) {
        Ok(meta) => {
            if !meta.is_file() || meta.permissions().readonly() {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Destination is not a writable file"));
            }
            // Check write permission without truncating the original.
            OpenOptions::new().write(true).open(&target)?;
            Some(meta.permissions())
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };
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
    fs::rename(&staged.0, &target)?;
    Ok(())
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
        });
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
        });
        assert!(result.is_err());
        assert_eq!(fs::read(path.join("keep")).unwrap(), b"untouched");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
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
