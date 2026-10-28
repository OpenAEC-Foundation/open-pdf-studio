//! Batch OCR over a folder, and OCR of a freshly scanned PDF (#382): the
//! Tauri commands. The work per file is headless: the file is read from disk
//! into a private PDFium handle (never the caches of the open tabs, so a tab
//! with the same path is not disturbed and the batch always sees what is on
//! disk), its pages are counted, checked for text and recognised one by one
//! with the same Tesseract pipeline as `ocr_pdf_page`. The JS side
//! (js/pdf/batch-ocr.js) writes the invisible text layer and the result file.

use crate::batch_ocr_walk;
use crate::pdfium_renderer::{self, PdfiumDocumentHandle};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// At most this many files per run; the dialog says when there were more.
const MAX_FILES: usize = 10_000;

/// The one document a batch run works on (by path). Cloned into blocking
/// tasks; all clones share the slot.
#[derive(Default, Clone)]
pub struct BatchOcrDoc(Arc<Mutex<Option<(String, Arc<PdfiumDocumentHandle>)>>>);

impl BatchOcrDoc {
    /// The handle for `path`, loading it from disk when another (or no)
    /// document is in the slot. Blocking: call from a blocking task.
    fn handle(&self, path: &str) -> Result<Arc<PdfiumDocumentHandle>, String> {
        let mut slot = self.0.lock().map_err(|e| format!("Batch OCR lock: {e}"))?;
        if let Some((open, handle)) = slot.as_ref() {
            if open == path {
                return Ok(handle.clone());
            }
        }
        // Close the previous document before loading the next one.
        drop(slot.take());
        let bytes = std::fs::read(path).map_err(|e| format!("Read: {e}"))?;
        let handle = Arc::new(PdfiumDocumentHandle::load_from_bytes(Arc::new(bytes))?);
        *slot = Some((path.to_string(), handle.clone()));
        Ok(handle)
    }

    fn release(&self) -> bool {
        // Closing waits for the PDFium lock: never on the UI thread.
        let taken = match self.0.lock() {
            Ok(mut slot) => slot.take(),
            Err(_) => None,
        };
        let had = taken.is_some();
        if let Some(handle) = taken {
            std::thread::spawn(move || drop(handle));
        }
        had
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchOcrFiles {
    pub files: Vec<String>,
    pub truncated: bool,
}

/// The PDF files in `dir` (and with `recursive` its subfolders, never inside
/// `exclude`). The folder was chosen by the user, so it joins the file-system
/// scope: the JS side reads the files with the fs plugin.
#[tauri::command]
pub async fn batch_ocr_list(
    app: tauri::AppHandle,
    dir: String,
    recursive: bool,
    exclude: Option<String>,
) -> Result<BatchOcrFiles, String> {
    use tauri_plugin_fs::FsExt;
    let root = std::path::PathBuf::from(&dir);
    let walk = tauri::async_runtime::spawn_blocking(move || {
        let exclude = exclude.filter(|e| !e.trim().is_empty()).map(std::path::PathBuf::from);
        batch_ocr_walk::walk_pdfs(&root, recursive, exclude.as_deref(), MAX_FILES)
    })
    .await
    .map_err(|e| format!("Batch OCR list task panicked: {e}"))?
    .map_err(|e| format!("BATCH_OCR_FOLDER:{e}"))?;
    let _ = app.fs_scope().allow_directory(Path::new(&dir), recursive);
    Ok(BatchOcrFiles {
        files: walk.files.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        truncated: walk.truncated,
    })
}

/// The output folder joins the file-system scope too (existence checks).
#[tauri::command]
pub fn batch_ocr_allow_output(app: tauri::AppHandle, dir: String) -> Result<bool, String> {
    use tauri_plugin_fs::FsExt;
    std::fs::create_dir_all(&dir).map_err(|e| format!("BATCH_OCR_OUTPUT:{e}"))?;
    app.fs_scope().allow_directory(Path::new(&dir), true).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Per page the number of non-whitespace characters in the text layer.
/// Always reads the file from disk again (a new run, or a changed file).
#[tauri::command]
pub async fn batch_ocr_inspect(state: tauri::State<'_, BatchOcrDoc>, path: String) -> Result<Vec<u32>, String> {
    let doc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        doc.release();
        let handle = doc.handle(&path)?;
        let pdf = handle.document();
        let count = pdf.pages().len() as u32;
        Ok((0..count).map(|i| pdfium_renderer::page_text_chars(pdf, i).unwrap_or(0)).collect())
    })
    .await
    .map_err(|e| format!("Batch OCR inspect task panicked: {e}"))?
}

/// OCR one page of the batch document (`lang` as for `ocr_pdf_page`).
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn batch_ocr_page(
    app: tauri::AppHandle,
    state: tauri::State<'_, BatchOcrDoc>,
    path: String,
    page_index: u32,
    lang: Option<String>,
) -> Result<Vec<crate::ocr::OcrWord>, String> {
    use tauri::Manager;
    let resource_dir = app.path().resource_dir().map_err(|e| format!("Cannot resolve resource_dir: {e}"))?;
    let tessdata_dir = crate::ocr::tessdata_path_for_tesseract(&resource_dir.join("tessdata"))?;
    let lang = lang.unwrap_or_else(|| "auto".to_string());
    let doc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let handle = doc.handle(&path)?;
        crate::ocr::ocr_page_words(handle.document(), page_index, &tessdata_dir, &lang)
    })
    .await
    .map_err(|e| format!("OCR task panicked: {e}"))?
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn batch_ocr_page() -> Result<(), String> {
    Err("OCR is not available on this platform".to_string())
}

/// Let go of the batch document (after each file and at the end of a run).
#[tauri::command]
pub fn batch_ocr_release(state: tauri::State<'_, BatchOcrDoc>) -> bool {
    state.release()
}
