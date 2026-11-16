//! Commando-schil voor het tekenen van eenvoudige annotaties op een
//! doorzichtige laag. Het tekenwerk staat in de crate `open-pdf-annot`; de
//! JS-kant (js/annotations/rust-laag.js) kiest welke annotaties in aanmerking
//! komen en rekent kleur, dekking, lijndikte en streeppatroon uit.
//!
//! Invoer: de weergave (maat in pixels, schaal, verschuiving) en de vormen.
//! Uitvoer: het aantal getekende vormen (u32 LE) en daarna de RGBA-pixels
//! (niet voorvermenigvuldigd), breedte × hoogte × 4.
//! `OPDS_RUST_ANNOT=0` zet het commando uit; de JS-kant tekent dan zelf.

use open_pdf_annot::{Shape, View};

#[tauri::command]
pub async fn annot_layer_render(view: View, shapes: Vec<Shape>) -> Result<tauri::ipc::Response, String> {
    if std::env::var("OPDS_RUST_ANNOT").ok().as_deref() == Some("0") {
        return Err("ANNOT_RUST_DISABLED".to_string());
    }
    let (rgba, drawn) = tauri::async_runtime::spawn_blocking(move || open_pdf_annot::render(&view, &shapes))
        .await
        .map_err(|e| format!("ANNOT_RUST_JOIN: {e}"))?
        .map_err(|e| e.to_string())?;
    let mut data = Vec::with_capacity(4 + rgba.len());
    data.extend_from_slice(&(drawn as u32).to_le_bytes());
    data.extend_from_slice(&rgba);
    Ok(tauri::ipc::Response::new(data))
}
