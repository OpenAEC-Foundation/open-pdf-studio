// Tauri transport; font parsing/selection is tested without the GUI runtime.
#[path = "systeem_lettertypen_core.rs"]
mod core;
use self::core::{zoek, LettertypeBestand};

/// The font file for a family and style, and whether it can be embedded.
#[tauri::command]
pub async fn systeem_lettertype_zoeken(familie: String, vet: bool, cursief: bool) -> Result<LettertypeBestand, String> {
    tauri::async_runtime::spawn_blocking(move || zoek(&familie, vet, cursief))
        .await
        .map_err(|e| e.to_string())
}

/// The bytes of a font file found by systeem_lettertype_zoeken. Only files
/// from the scanned font folders are read.
#[tauri::command]
pub async fn systeem_lettertype_lezen(pad: String, gezicht: Option<u32>) -> Result<tauri::ipc::Response, String> {
    let bytes = core::lees(&pad, gezicht.unwrap_or(0))?;
    Ok(tauri::ipc::Response::new(bytes))
}
