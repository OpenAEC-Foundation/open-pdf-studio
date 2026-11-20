//! Commando-schil voor het beeldwerk in de crate `open-pdf-image`:
//!
//! * `png_naar_xobject`: een PNG (rauwe body) naar de Flate-streams van een
//!   beeld-XObject. JS-kant: js/pdf/embed-png-rust.js.
//!
//! De opmaak van het antwoord staat bij `png_xobject::response`. Byte 0 = 0
//! betekent: dit beeld is voor JavaScript.

use open_pdf_image::png_xobject;
use tauri::ipc::{InvokeBody, Request, Response};

fn aan(naam: &str) -> bool {
    std::env::var(naam).map(|v| v.trim() != "0").unwrap_or(true)
}

/// Welke routes aan staan: bit 0 PNG naar XObject. `OPDS_RUST_PNG_EMBED=0`
/// zet die uit (vergelijken met JS).
#[tauri::command]
pub fn beeld_rust_beschikbaar() -> u8 {
    aan("OPDS_RUST_PNG_EMBED") as u8
}

fn body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("Expected a raw body".into()),
    }
}

#[tauri::command]
pub async fn png_naar_xobject(request: Request<'_>) -> Result<Response, String> {
    let bytes = body(&request)?;
    let antwoord = tauri::async_runtime::spawn_blocking(move || png_xobject::response(png_xobject::png_to_xobject(&bytes)))
        .await
        .map_err(|e| e.to_string())?;
    Ok(Response::new(antwoord))
}
