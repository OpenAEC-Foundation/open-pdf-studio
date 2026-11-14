//! Pixelwerk op een paginabeeld dat de worker zelf rendert: formuliervormen
//! herkennen (js/pdf/form-recognition.js) en symbolen zoeken
//! (js/search/symbol-matcher.js).
//!
//! De JS-weg rendert de pagina met pdf.js op de interface-thread, leest de
//! pixels terug en rekent daar. Hier rendert PDFium de pagina (die de worker
//! voor het tekenen vaak al geparst heeft) op dezelfde maat en gaat alleen de
//! uitkomst terug: de vormen, of het sjabloon en de treffers. Het rekenwerk
//! staat in de crate `open-pdf-scan` (regel voor regel uit de JS-modules, met
//! pariteitstests daar).
//!
//! De app geeft de rastermaat en de draaiing mee zoals ze die voor pdf.js
//! uitrekent, zodat coördinaten in het antwoord dezelfde betekenis hebben.
//! Het raster zelf komt van PDFium en wijkt langs randen ongeveer een pixel
//! af van dat van pdf.js (docs/rust-stappen.md).

use crate::render::Renderer;
use anyhow::{anyhow, Result};
use open_pdf_scan::symbol::{self, Binary};
use open_pdf_scan::{form, FORM_MAX_PIXELS, SYMBOL_MAX_PIXELS};
use serde::Deserialize;
use std::time::Instant;

#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq)]
pub struct Raster {
    pub path: String,
    pub page_index: u32,
    /// Rastermaat in pixels: Math.ceil van de pdf.js-viewport.
    pub width: u32,
    pub height: u32,
    /// Draaiing bovenop /Rotate (0, 90, 180, 270).
    #[serde(default)]
    pub rotation: i32,
    /// Bytelengte die de app voor dit bestand heeft; wijkt de schijf af, dan
    /// weigert de worker (de app rekent dan zelf).
    #[serde(default)]
    pub expect_len: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq)]
pub struct TemplateWire {
    pub width: usize,
    pub height: usize,
    /// Eén teken per pixel, '1' = inkt.
    pub pixels: String,
}

#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq)]
pub struct SymbolScanRequest {
    pub id: u64,
    pub raster: Raster,
    /// Sjabloon uitsnijden uit deze pagina: x, y, breedte, hoogte in
    /// rasterpixels (cropTemplate).
    #[serde(default)]
    pub crop: Option<[f64; 4]>,
    /// Sjabloon uit een eerder antwoord (andere pagina dan de sjabloonpagina).
    #[serde(default)]
    pub template: Option<TemplateWire>,
    /// Zoeken op deze pagina; uit = alleen het sjabloon uitsnijden.
    #[serde(default = "aan")]
    pub search: bool,
    #[serde(default = "standaard_drempel")]
    pub threshold: f64,
    #[serde(default = "geen_draaiing")]
    pub rotations: Vec<f64>,
    #[serde(default = "schaal_een")]
    pub scales: Vec<f64>,
}

fn aan() -> bool {
    true
}
fn standaard_drempel() -> f64 {
    0.75
}
fn geen_draaiing() -> Vec<f64> {
    vec![0.0]
}
fn schaal_een() -> Vec<f64> {
    vec![1.0]
}

#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq)]
pub struct FormShapesRequest {
    pub id: u64,
    pub raster: Raster,
    /// Pixels per punt van het raster (detectFormShapes' `scale`).
    pub scale: f64,
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

/// Een foutcode die de JS-functies zelf ook geven (TEMPLATE_BOUNDS en
/// dergelijke): de app geeft hem door in plaats van op JS terug te vallen.
fn code(c: &'static str) -> anyhow::Error {
    anyhow!(c)
}

/// Render de pagina en maak er het binaire beeld van.
fn binary_page(renderer: &mut Renderer, raster: &Raster, max_pixels: usize, invalid: &'static str) -> Result<Binary> {
    let (w, h) = (raster.width as usize, raster.height as usize);
    if w < 1 || h < 1 || w.checked_mul(h).map_or(true, |n| n > max_pixels) {
        return Err(code(invalid));
    }
    if let Some(expect) = raster.expect_len {
        let (_, len) = Renderer::file_identity(&raster.path)?;
        if expect != len {
            return Err(anyhow!("PDF_SCAN_STALE: {} has {} bytes on disk, the app holds {}", raster.path, len, expect));
        }
    }
    let bgra = renderer.render_scan(&raster.path, raster.page_index, w, h, raster.rotation)?;
    let bin = symbol::binary_image(&bgra, w, h, max_pixels).map_err(code)?;
    // Meethulp (scripts/bench-rust/scan-raster-verschil.mjs): het binaire
    // raster naast dat van pdf.js kunnen leggen.
    if let Ok(dir) = std::env::var("OPDS_SCAN_DUMP") {
        let _ = std::fs::write(format!("{}/p{}-{}x{}.bin", dir, raster.page_index, w, h), &bin.pixels);
    }
    Ok(bin)
}

fn template_from_wire(t: &TemplateWire) -> Result<Binary> {
    let pixels: Vec<u8> = t.pixels.bytes().map(|b| u8::from(b == b'1')).collect();
    open_pdf_scan::template(t.width, t.height, &pixels).map_err(code)
}

fn template_to_wire(t: &Binary) -> serde_json::Value {
    let pixels: String = t.pixels.iter().map(|&p| if p != 0 { '1' } else { '0' }).collect();
    serde_json::json!({ "width": t.width, "height": t.height, "pixels": pixels })
}

/// Sjabloon uitsnijden en/of zoeken op één pagina. Antwoord: het sjabloon
/// (zodat de app het bij de volgende pagina's meegeeft) en de treffers als
/// [x, y, breedte, hoogte, score, draaiing, schaal] in rasterpixels.
pub fn symbol_scan(renderer: &mut Renderer, req: &SymbolScanRequest) -> Result<serde_json::Value> {
    let t0 = Instant::now();
    let image = binary_page(renderer, &req.raster, SYMBOL_MAX_PIXELS, "INVALID_IMAGE")?;
    let render_ms = ms(t0);
    let template = match (&req.crop, &req.template) {
        (Some(c), _) => symbol::crop_template(&image, (c[0], c[1], c[2], c[3])).map_err(code)?,
        (None, Some(t)) => template_from_wire(t)?,
        (None, None) => return Err(code("TEMPLATE_BOUNDS")),
    };
    let t1 = Instant::now();
    let (matches, truncated) = if req.search {
        let found = open_pdf_scan::search(&image, &template, req.threshold, &req.rotations, &req.scales).map_err(code)?;
        (found.matches, found.truncated)
    } else {
        (Vec::new(), false)
    };
    let rows: Vec<serde_json::Value> = matches
        .iter()
        .map(|m| serde_json::json!([m.x, m.y, m.width, m.height, m.score, m.rotation, m.scale]))
        .collect();
    Ok(serde_json::json!({
        "template": template_to_wire(&template),
        "matches": rows,
        "truncated": truncated,
        "ms": { "render": render_ms, "match": ms(t1) },
    }))
}

/// Vormen op één pagina als [x, y, breedte, hoogte, soort, betrouwbaarheid,
/// omlijning] (soort 0 tekst, 1 aankruisvakje, 2 keuzerondje; omlijning 1 =
/// lege omlijning, 0 = schrijflijn), in de eenheden van detectFormShapes.
pub fn form_shapes(renderer: &mut Renderer, req: &FormShapesRequest) -> Result<serde_json::Value> {
    if !(req.scale > 0.0) {
        return Err(code("INVALID_RASTER"));
    }
    let t0 = Instant::now();
    let image = binary_page(renderer, &req.raster, FORM_MAX_PIXELS, "INVALID_RASTER")?;
    let render_ms = ms(t0);
    let t1 = Instant::now();
    let shapes = form::detect_form_shapes(&image, req.scale).map_err(code)?;
    let rows: Vec<serde_json::Value> = shapes
        .iter()
        .map(|s| {
            let kind = match s.kind {
                form::Kind::Text => 0,
                form::Kind::Checkbox => 1,
                form::Kind::Radio => 2,
            };
            serde_json::json!([s.x, s.y, s.width, s.height, kind, s.confidence, u8::from(s.outline)])
        })
        .collect();
    Ok(serde_json::json!({ "shapes": rows, "ms": { "render": render_ms, "detect": ms(t1) } }))
}

/// Antwoordregel voor de pool: de uitkomst met id/ok/op erbij, of de fout.
pub fn response_line(id: u64, op: &str, result: Result<serde_json::Value>) -> String {
    match result {
        Ok(mut v) => {
            v["id"] = serde_json::json!(id);
            v["ok"] = serde_json::json!(true);
            v["op"] = serde_json::json!(op);
            v.to_string()
        }
        Err(e) => serde_json::json!({ "id": id, "ok": false, "op": op, "error": format!("{:#}", e) }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_template_from_the_wire_must_fit_its_size() {
        let ok = TemplateWire { width: 2, height: 1, pixels: "10".into() };
        assert_eq!(template_from_wire(&ok).unwrap().pixels, vec![1, 0]);
        let wrong = TemplateWire { width: 2, height: 2, pixels: "10".into() };
        assert_eq!(template_from_wire(&wrong).unwrap_err().to_string(), "TEMPLATE_BOUNDS");
    }

    #[test]
    fn a_failure_keeps_its_code_in_the_answer_line() {
        let line: serde_json::Value = serde_json::from_str(&response_line(7, "symbol_scan", Err(code("TEMPLATE_NEEDS_CONTRAST")))).unwrap();
        assert_eq!((line["id"].as_u64(), line["ok"].as_bool(), line["error"].as_str()), (Some(7), Some(false), Some("TEMPLATE_NEEDS_CONTRAST")));
        let ok: serde_json::Value = serde_json::from_str(&response_line(8, "form_shapes", Ok(serde_json::json!({ "shapes": [] })))).unwrap();
        assert_eq!((ok["id"].as_u64(), ok["ok"].as_bool(), ok["op"].as_str()), (Some(8), Some(true), Some("form_shapes")));
    }
}
