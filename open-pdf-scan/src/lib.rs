//! Pixelwerk op een begrensd paginabeeld: symbolen zoeken en formuliervormen
//! herkennen. Regel voor regel overgenomen uit js/search/symbol-matcher.js en
//! js/pdf/form-recognition.js; op dezelfde invoer dezelfde uitvoer, ook voor
//! de kommagetallen (tests.rs, met fixtures uit
//! open-pdf-studio/scripts/bench-rust/scan-golden.mjs).

pub mod form;
pub mod symbol;
#[cfg(test)]
mod tests;

/// Grootste raster voor symbolen zoeken (binaryImage) en voor formulieren
/// (detectFormShapes).
pub const SYMBOL_MAX_PIXELS: usize = 2_000_000;
pub const FORM_MAX_PIXELS: usize = 4_000_000;

/// Math.round: halve waarden naar +oneindig.
pub(crate) fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let c = x.ceil();
    if c - 0.5 > x {
        c - 1.0
    } else {
        c
    }
}

/// Draaiingen zoals JS ze krijgt: alleen 0, 90, 180 en 270 zijn geldig
/// (transformTemplate), al het andere is INVALID_TOLERANCE.
pub fn rotations(values: &[f64]) -> Result<Vec<u32>, &'static str> {
    values
        .iter()
        .map(|&r| if [0.0, 90.0, 180.0, 270.0].contains(&r) { Ok(r as u32) } else { Err("INVALID_TOLERANCE") })
        .collect()
}

/// Een sjabloon uit bytes (één per pixel, niet-nul = inkt).
pub fn template(width: usize, height: usize, pixels: &[u8]) -> Result<symbol::Binary, &'static str> {
    if width < 1 || height < 1 || width > 160 || height > 160 || pixels.len() != width * height {
        return Err("TEMPLATE_BOUNDS");
    }
    Ok(symbol::Binary { width, height, pixels: pixels.iter().map(|&p| u8::from(p != 0)).collect() })
}

/// matchSymbols() met de toleranties zoals de app ze meegeeft.
pub fn search(image: &symbol::Binary, template: &symbol::Binary, threshold: f64, rotations_deg: &[f64], scales: &[f64]) -> Result<symbol::Found, &'static str> {
    if rotations_deg.len() > 4 {
        return Err("INVALID_TOLERANCE");
    }
    symbol::match_symbols(image, template, threshold, &rotations(rotations_deg)?, scales)
}
