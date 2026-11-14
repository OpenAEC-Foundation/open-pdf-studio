//! Verscherpen van een paginabeeld vóór het naar de WebView gaat.
//!
//! De render-commando's (`render_pdf_page`, `render_pdf_page_region`,
//! `render_tile_scene_region`) geven `[breedte u32 LE][hoogte u32 LE][rgba]`
//! terug. De WebView verscherpte dat beeld zelf (js/pdf/render-sharpen.js), op
//! de interface-thread: ~21 ms per megapixel bij elk paginabeeld en elke
//! tegel, en zo lang reageerde het venster niet. Met het argument `sharpen`
//! (de sterkte uit SHARPEN_LEVELS) gebeurt het hier, buiten die thread, met
//! dezelfde uitkomst byte voor byte (pdfium-worker/src/sharpen.rs, met
//! pariteitstests daar).
//!
//! De JS-kant (js/pdf/render-sharpen-pref.js) vraagt één keer of deze route er
//! is en verscherpt anders zelf: webversie, mobiel, een oudere backend, of
//! `OPDS_RUST_SHARPEN=0` (om te vergelijken).

#[path = "../../../pdfium-worker/src/sharpen.rs"]
#[allow(dead_code)]
mod sharpen;

/// `OPDS_RUST_SHARPEN=0` zet het verscherpen in Rust uit.
#[tauri::command]
pub fn sharpen_rust_beschikbaar() -> bool {
    std::env::var("OPDS_RUST_SHARPEN").map(|v| v.trim() != "0").unwrap_or(true)
}

/// Verscherp het beeld in `data` ter plekke. Niets bij geen of een ongeldige
/// sterkte, of als de kop niet bij de lengte past.
pub fn verscherp(data: &mut [u8], sharpen: Option<f64>) {
    let Some(amount) = sharpen.filter(|a| a.is_finite() && *a > 0.0) else { return };
    if data.len() < 8 {
        return;
    }
    let width = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    let height = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
    if width.checked_mul(height).and_then(|n| n.checked_mul(4)) != Some(data.len() - 8) {
        return;
    }
    sharpen::sharpen_rgba(&mut data[8..], width, height, amount);
}

/// Het antwoord van een render-commando, verscherpt als erom gevraagd is. Het
/// rekenwerk loopt op een blokkerende thread, niet op de async-runtime.
pub async fn antwoord(mut data: Vec<u8>, sharpen: Option<f64>) -> tauri::ipc::Response {
    if sharpen.is_some_and(|a| a.is_finite() && a > 0.0) {
        data = match tauri::async_runtime::spawn_blocking(move || {
            verscherp(&mut data, sharpen);
            data
        })
        .await
        {
            Ok(d) => d,
            // De thread viel weg: het beeld is dan ook weg. Een leeg antwoord
            // herkent de JS-kant als mislukte render.
            Err(_) => Vec::new(),
        };
    }
    tauri::ipc::Response::new(data)
}

#[cfg(test)]
mod tests {
    use super::verscherp;

    fn beeld(w: u32, h: u32) -> Vec<u8> {
        let mut d = Vec::new();
        d.extend_from_slice(&w.to_le_bytes());
        d.extend_from_slice(&h.to_le_bytes());
        d.extend((0..w * h * 4).map(|i| (i * 53 % 251) as u8));
        d
    }

    #[test]
    fn the_header_stays_and_the_pixels_change() {
        let voor = beeld(6, 5);
        let mut na = voor.clone();
        verscherp(&mut na, Some(0.5));
        assert_eq!(&na[..8], &voor[..8]);
        assert_ne!(&na[8..], &voor[8..]);
    }

    #[test]
    fn nothing_without_an_amount_or_with_a_header_that_does_not_fit() {
        let voor = beeld(6, 5);
        for sterkte in [None, Some(0.0), Some(-1.0), Some(f64::NAN), Some(f64::INFINITY)] {
            let mut na = voor.clone();
            verscherp(&mut na, sterkte);
            assert_eq!(na, voor, "{sterkte:?}");
        }
        let mut kort = voor[..voor.len() - 1].to_vec();
        let zo = kort.clone();
        verscherp(&mut kort, Some(0.5));
        assert_eq!(kort, zo);
        let mut leeg = vec![1u8, 2, 3];
        verscherp(&mut leeg, Some(0.5));
        assert_eq!(leeg, vec![1, 2, 3]);
    }
}
