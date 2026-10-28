//! Batch OCR (#382): which PDF files in a folder take part. Only `std`, so it
//! is unit-tested without the Tauri crate
//! (`rustc --edition 2021 --test src/batch_ocr_walk.rs`).
//!
//! Rules: `.pdf` in any letter case; with `recursive` also in subfolders, but
//! never through a symbolic link (no loops, no escaping the chosen folder) and
//! never inside `exclude` (the output folder when it lies inside the source
//! folder, so a second run does not OCR its own results). Hidden entries
//! (starting with a dot) are skipped. The list is sorted and capped at
//! `limit` files; `truncated` says whether more were there.

use std::path::{Path, PathBuf};

pub struct Walk {
    pub files: Vec<PathBuf>,
    pub truncated: bool,
}

pub fn is_pdf(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

fn hidden(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.'))
}

pub fn walk_pdfs(root: &Path, recursive: bool, exclude: Option<&Path>, limit: usize) -> std::io::Result<Walk> {
    let mut files = Vec::new();
    let mut truncated = false;
    let mut stack = vec![root.to_path_buf()];
    // The root itself must be readable: that error goes to the caller.
    let mut first = true;
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if first => return Err(e),
            Err(_) => continue, // an unreadable subfolder is left out
        };
        first = false;
        for entry in entries.flatten() {
            let path = entry.path();
            if hidden(&path) {
                continue;
            }
            // file_type() does not follow symbolic links.
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if recursive && exclude.map_or(true, |ex| !same_or_inside(&path, ex)) {
                    stack.push(path);
                }
            } else if kind.is_file() && is_pdf(&path) {
                if files.len() >= limit {
                    truncated = true;
                    continue;
                }
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(Walk { files, truncated })
}

/// Is `path` the folder `other` or inside it? Compares canonical paths when
/// both exist, else the paths as given.
pub fn same_or_inside(path: &Path, other: &Path) -> bool {
    let a = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let b = std::fs::canonicalize(other).unwrap_or_else(|_| other.to_path_buf());
    a.starts_with(&b)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tree(name: &str) -> Tmp {
        let root = std::env::temp_dir().join(format!("opds-batch-walk-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for dir in ["", "sub", "sub/deep", "out", ".hidden"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        for file in ["a.pdf", "B.PDF", "notes.txt", "sub/c.pdf", "sub/deep/d.pdf", "out/a_ocr.pdf", ".hidden/e.pdf", ".f.pdf"] {
            std::fs::write(root.join(file), b"%PDF-1.4").unwrap();
        }
        Tmp(root)
    }

    fn names(root: &Path, walk: &Walk) -> Vec<String> {
        walk.files
            .iter()
            .map(|p| p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"))
            .collect()
    }

    #[test]
    fn top_level_only() {
        let t = tree("top");
        let walk = walk_pdfs(&t.0, false, None, 100).unwrap();
        assert_eq!(names(&t.0, &walk), vec!["B.PDF", "a.pdf"]);
        assert!(!walk.truncated);
    }

    #[test]
    fn recursive_skips_hidden_and_the_output_folder() {
        let t = tree("rec");
        let out = t.0.join("out");
        let walk = walk_pdfs(&t.0, true, Some(&out), 100).unwrap();
        assert_eq!(names(&t.0, &walk), vec!["B.PDF", "a.pdf", "sub/c.pdf", "sub/deep/d.pdf"]);
        let all = walk_pdfs(&t.0, true, None, 100).unwrap();
        assert!(names(&t.0, &all).contains(&"out/a_ocr.pdf".to_string()));
    }

    #[test]
    fn limit_marks_truncation() {
        let t = tree("limit");
        let walk = walk_pdfs(&t.0, true, None, 2).unwrap();
        assert_eq!(walk.files.len(), 2);
        assert!(walk.truncated);
    }

    #[test]
    fn missing_root_is_an_error() {
        assert!(walk_pdfs(Path::new("/definitely/not/here/opds"), true, None, 10).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_to_folders_are_not_followed() {
        let t = tree("link");
        std::os::unix::fs::symlink(&t.0, t.0.join("sub/loop")).unwrap();
        let walk = walk_pdfs(&t.0, true, None, 100).unwrap();
        assert_eq!(walk.files.len(), 5);
    }
}
