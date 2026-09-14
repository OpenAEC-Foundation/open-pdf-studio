//! OCR (Optical Character Recognition) via Tesseract, for scanned/image-only
//! PDF pages. Renders a page through the existing PDFium pipeline, runs
//! Tesseract against the bitmap, and returns per-word text + bounding boxes
//! in the same "top-left origin, PDF points at scale=1" coordinate space the
//! rest of the app uses for annotation coordinates — the JS side applies the
//! usual app-coordinate → PDF-coordinate transform (CropBox + Y-flip) when it
//! writes the invisible searchable text layer, same as everywhere else.

use crate::pdfium_renderer;
use pdfium_render::prelude::PdfDocument;
use serde::Serialize;
use tesseract_rs::TesseractAPI;

/// DPI used to rasterize the page for OCR. Higher than screen-render DPI
/// (72-150 typical) because small print needs the extra resolution to
/// recognize reliably; 300 DPI is the conventional OCR baseline.
const OCR_DPI: f32 = 300.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrWord {
    pub text: String,
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
    pub confidence: f32,
}

/// Recognition languages this build ships trained data for. "auto" is a
/// sentinel `lang` value (not a real Tesseract spec) that resolves to this.
///
/// A per-page script-detection pass (Tesseract's separate OSD model, run
/// through its own TesseractAPI instance before the real recognition one)
/// was tried here first, but reliably crashed the whole app on a real
/// multi-page document — likely some interaction between two TesseractAPI
/// lifecycles in the same process rather than anything specific to this
/// document, but not worth the risk without a much deeper investigation.
/// Recognizing with both languages combined is already proven safe (this is
/// what the feature shipped with before "auto" existed) and handles the
/// common case — a CJK document with incidental Latin text/numbers, or vice
/// versa — without picking wrong; it costs a bit more time per page than a
/// correctly-targeted single-language pass would.
const AUTO_LANG: &str = "chi_tra+eng";

/// Run OCR on one page and return its recognized words with bounding boxes.
///
/// `tessdata_dir` must contain the `.traineddata` file(s) for `lang`
/// (Tesseract's `+`-joined language spec, e.g. "chi_tra+eng") — or `lang`
/// may be the literal string "auto" (see AUTO_LANG).
pub fn ocr_page_words(
    doc: &PdfDocument<'static>,
    page_index: u32,
    tessdata_dir: &str,
    lang: &str,
) -> Result<Vec<OcrWord>, String> {
    let scale = OCR_DPI / 72.0;
    let (width_px, height_px, rgba) =
        pdfium_renderer::render_page_to_rgba(doc, page_index, scale, 0)?;

    let resolved_lang = if lang == "auto" { AUTO_LANG } else { lang };

    let api = TesseractAPI::new();
    api.init(tessdata_dir, &resolved_lang)
        .map_err(|e| format!("Tesseract init failed for lang '{}': {}", resolved_lang, e))?;
    api.set_image(&rgba, width_px as i32, height_px as i32, 4, (width_px * 4) as i32)
        .map_err(|e| format!("Tesseract set_image failed: {}", e))?;
    api.recognize()
        .map_err(|e| format!("Tesseract recognize failed: {}", e))?;
    let tsv = api
        .get_tsv_text(0)
        .map_err(|e| format!("Tesseract get_tsv_text failed: {}", e))?;

    Ok(parse_tsv_words(&tsv, scale))
}

/// Parse Tesseract's TSV output (level 5 = word) into OcrWord entries,
/// converting pixel coordinates (at the render scale used) back to PDF
/// points by dividing by `scale`.
fn parse_tsv_words(tsv: &str, scale: f32) -> Vec<OcrWord> {
    let mut words = Vec::new();
    for line in tsv.lines() {
        let cols: Vec<&str> = line.split('\t').collect();
        // level page_num block_num par_num line_num word_num left top width height conf text
        if cols.len() < 12 {
            continue;
        }
        if cols[0] != "5" {
            continue; // not a word-level row
        }
        let (Ok(left), Ok(top), Ok(w), Ok(h), Ok(conf)) = (
            cols[6].parse::<f32>(),
            cols[7].parse::<f32>(),
            cols[8].parse::<f32>(),
            cols[9].parse::<f32>(),
            cols[10].parse::<f32>(),
        ) else {
            continue;
        };
        let text = cols[11..].join("\t");
        if text.trim().is_empty() || conf < 0.0 {
            continue;
        }
        words.push(OcrWord {
            text,
            left: left / scale,
            top: top / scale,
            width: w / scale,
            height: h / scale,
            confidence: conf,
        });
    }
    words
}
