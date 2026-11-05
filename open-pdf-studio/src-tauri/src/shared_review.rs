//! Shared review folder (#237): list, read and atomically write the per-user
//! review files next to a PDF. Each user only writes his own files; the JS
//! side (js/review/) decides which. Writes go through `atomic_file`, so a sync
//! drive or another reader never sees a half-written file.
use std::fs;
use std::path::Path;

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFile {
    name: String,
    size: u64,
    mtime_ms: f64,
}

fn is_review_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    !name.starts_with('.') && (lower.ends_with(".jsonl") || lower.ends_with(".xfdf"))
}

/// The review files directly in `dir`. A folder that does not exist (yet) is
/// an empty review, not an error.
pub fn list(dir: &Path) -> Result<Vec<ReviewFile>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Failed to read folder: {e}")),
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_review_file(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let mtime_ms = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0.0, |d| d.as_secs_f64() * 1000.0);
        files.push(ReviewFile { name, size: meta.len(), mtime_ms });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// A plain file name of a review file: no folder parts, no hidden files.
fn checked_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." || !is_review_file(name) {
        return Err("Invalid review file name".into());
    }
    Ok(name)
}

pub fn read(dir: &Path, name: &str) -> Result<String, String> {
    let path = dir.join(checked_name(name)?);
    match fs::read(&path) {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Failed to read review file: {e}")),
    }
}

pub fn write(dir: &Path, name: &str, text: &str) -> Result<(), String> {
    let name = checked_name(name)?;
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create review folder: {e}"))?;
    crate::atomic_file::write(&dir.join(name), text.as_bytes()).map_err(|e| format!("Failed to write review file: {e}"))
}

#[tauri::command]
pub async fn shared_review_list(dir: String) -> Result<Vec<ReviewFile>, String> {
    tauri::async_runtime::spawn_blocking(move || list(Path::new(&dir))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shared_review_read(dir: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read(Path::new(&dir), &name)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shared_review_write(dir: String, name: String, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write(Path::new(&dir), &name, &text)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);

    struct TestDir(std::path::PathBuf);
    impl TestDir {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("opds-review-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
            Self(p)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn missing_folder_is_an_empty_review() {
        let dir = TestDir::new();
        assert_eq!(list(&dir.0).unwrap(), Vec::new());
        assert_eq!(read(&dir.0, "x_Annotation_Bob.jsonl").unwrap(), "");
    }

    #[test]
    fn write_creates_the_folder_and_replaces_atomically() {
        let dir = TestDir::new();
        let sub = dir.0.join("PRJ2026-Drawings");
        write(&sub, "PRJ2026-Drawings_Annotation_Alice.jsonl", "{\"a\":1}\n").unwrap();
        write(&sub, "PRJ2026-Drawings_Annotation_Alice.jsonl", "{\"a\":1}\n{\"a\":2}\n").unwrap();
        assert_eq!(read(&sub, "PRJ2026-Drawings_Annotation_Alice.jsonl").unwrap(), "{\"a\":1}\n{\"a\":2}\n");
        fs::write(sub.join("notes.txt"), b"x").unwrap();
        fs::write(sub.join(".opds-save-1-1.tmp"), b"x").unwrap();
        let names: Vec<String> = list(&sub).unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(names, vec!["PRJ2026-Drawings_Annotation_Alice.jsonl".to_string()]);
    }

    #[test]
    fn refuses_names_outside_the_folder() {
        let dir = TestDir::new();
        for name in ["../x.jsonl", "a/b.jsonl", "a\\b.jsonl", "C:x.jsonl", "x.pdf", ".hidden.jsonl", ""] {
            assert!(write(&dir.0, name, "x").is_err(), "{name}");
            assert!(read(&dir.0, name).is_err(), "{name}");
        }
    }
}
