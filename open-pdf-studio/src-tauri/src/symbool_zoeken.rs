//! Commando-schil voor het zoeken van symbolen op een paginabeeld dat de app
//! zelf maakte. Het rekenwerk staat in de crate `open-pdf-scan` (regel voor
//! regel uit js/search/symbol-matcher.js, met pariteitstests daar); de JS-kant
//! (js/pdf/raster-scan-rust.js) rendert de pagina, maakt het binaire beeld en
//! het sjabloon, en valt terug op de JS-matcher als dit commando ontbreekt,
//! faalt of uitgezet is. Zelfde beeld erin, dus dezelfde treffers eruit.
//!
//! Invoer: rauwe body = eerst het sjabloon, dan het beeld, elk één byte per
//! pixel (niet-nul = inkt); de maten en toleranties als JSON in de kop
//! `x-opds-symbol`. Uitvoer: `{ matches: [[x, y, breedte, hoogte, score,
//! draaiing, schaal], ...], truncated, ms }` in beeldpixels.
//! Fouten beginnen met SCAN_RUST_; een code die matchSymbols zelf ook geeft
//! (INVALID_TOLERANCE) komt erachter en gaat in de app door naar de gebruiker.

use open_pdf_scan::symbol::Binary;
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Kop {
    width: usize,
    height: usize,
    template_width: usize,
    template_height: usize,
    threshold: f64,
    rotations: Vec<f64>,
    scales: Vec<f64>,
}

/// Sjabloon en beeld uit de body, volgens de maten in de kop.
fn beelden(kop: &Kop, body: &[u8]) -> Result<(Binary, Binary), &'static str> {
    let t_len = kop.template_width.checked_mul(kop.template_height).ok_or("TEMPLATE_BOUNDS")?;
    let i_len = kop.width.checked_mul(kop.height).ok_or("INVALID_IMAGE")?;
    if kop.width < 1 || kop.height < 1 || i_len > open_pdf_scan::SYMBOL_MAX_PIXELS || body.len() != t_len.checked_add(i_len).ok_or("INVALID_IMAGE")? {
        return Err("INVALID_IMAGE");
    }
    let template = open_pdf_scan::template(kop.template_width, kop.template_height, &body[..t_len])?;
    let image = Binary { width: kop.width, height: kop.height, pixels: body[t_len..].iter().map(|&p| u8::from(p != 0)).collect() };
    Ok((template, image))
}

/// `OPDS_RUST_SCAN=0` zet de Rust-routes voor paginabeelden uit (vergelijken
/// met JS): dit commando en `raster_scan_page`.
pub fn uitgezet() -> bool {
    std::env::var("OPDS_RUST_SCAN").ok().as_deref() == Some("0")
}

#[tauri::command]
pub async fn symbol_match_raster(request: Request<'_>) -> Result<serde_json::Value, String> {
    if uitgezet() {
        return Err("SCAN_RUST_DISABLED".to_string());
    }
    let kop = request.headers().get("x-opds-symbol")
        .ok_or("SCAN_RUST_FAILED: missing parameters")?.to_str().map_err(|e| format!("SCAN_RUST_FAILED: {e}"))?;
    let kop: Kop = serde_json::from_str(kop).map_err(|e| format!("SCAN_RUST_FAILED: {e}"))?;
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err("SCAN_RUST_FAILED: expected a raw body".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let t0 = std::time::Instant::now();
        let (template, image) = beelden(&kop, &body).map_err(|c| format!("SCAN_RUST_FAILED: {c}"))?;
        let found = open_pdf_scan::search(&image, &template, kop.threshold, &kop.rotations, &kop.scales)
            .map_err(|c| format!("SCAN_RUST_FAILED: {c}"))?;
        let rows: Vec<serde_json::Value> = found
            .matches
            .iter()
            .map(|m| serde_json::json!([m.x, m.y, m.width, m.height, m.score, m.rotation, m.scale]))
            .collect();
        Ok(serde_json::json!({ "matches": rows, "truncated": found.truncated, "ms": t0.elapsed().as_secs_f64() * 1000.0 }))
    })
    .await
    .map_err(|e| format!("SCAN_RUST_FAILED: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kop(width: usize, height: usize, tw: usize, th: usize) -> Kop {
        Kop { width, height, template_width: tw, template_height: th, threshold: 0.75, rotations: vec![0.0], scales: vec![1.0] }
    }

    #[test]
    fn the_body_is_the_template_followed_by_the_image() {
        let mut body = vec![1u8; 36];
        body.extend_from_slice(&[0, 7, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let (template, image) = beelden(&kop(10, 8, 6, 6), &body).unwrap();
        assert_eq!((template.width, template.height, template.pixels.len()), (6, 6, 36));
        assert_eq!((image.width, image.height), (10, 8));
        assert_eq!(&image.pixels[..4], &[0, 1, 0, 1], "any non-zero byte is ink");
    }

    #[test]
    fn a_body_of_the_wrong_length_is_refused() {
        assert!(matches!(beelden(&kop(10, 8, 6, 6), &[0u8; 115]), Err("INVALID_IMAGE")));
        assert!(matches!(beelden(&kop(0, 8, 6, 6), &[0u8; 36]), Err("INVALID_IMAGE")));
        assert!(matches!(beelden(&kop(2000, 1001, 6, 6), &vec![0u8; 36 + 2_002_000]), Err("INVALID_IMAGE")), "over the pixel budget");
        assert!(matches!(beelden(&kop(10, 8, 161, 1), &[0u8; 241]), Err("TEMPLATE_BOUNDS")));
    }
}
