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
use std::path::Path;
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

/// Turn the tessdata directory into the datapath string Tesseract expects.
///
/// On Windows Tauri reports the resource directory as a verbatim path
/// (`\\?\C:\...`). Tesseract appends `/` before `<lang>.traineddata` unless
/// the datapath already ends in a separator, and Windows cannot open a
/// verbatim path containing `/` — every language then failed with "Error
/// opening data file". So the verbatim prefix is stripped where that is
/// unambiguous (`dunce::simplified` keeps paths that must stay verbatim, such
/// as `\\?\UNC\...` or reserved device names), and the result always ends in
/// a separator so Tesseract appends nothing itself.
pub fn tessdata_path_for_tesseract(dir: &Path) -> Result<String, String> {
    let mut path = dunce::simplified(dir)
        .to_str()
        .ok_or_else(|| "tessdata path is not valid UTF-8".to_string())?
        .to_string();
    if !path.ends_with(std::path::is_separator) {
        path.push(std::path::MAIN_SEPARATOR);
    }
    Ok(path)
}

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

#[cfg(test)]
mod tests {
    use super::tessdata_path_for_tesseract;
    use std::path::{Path, MAIN_SEPARATOR};

    #[test]
    fn appends_platform_separator() {
        let out = tessdata_path_for_tesseract(&Path::new("resources").join("tessdata")).unwrap();
        assert_eq!(out, format!("resources{0}tessdata{0}", MAIN_SEPARATOR));
    }

    #[test]
    fn keeps_existing_trailing_separator() {
        let input = format!("tessdata{}", MAIN_SEPARATOR);
        assert_eq!(tessdata_path_for_tesseract(Path::new(&input)).unwrap(), input);
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_absolute_path_only_gets_separator() {
        let out = tessdata_path_for_tesseract(Path::new("/usr/lib/open-pdf-studio/tessdata")).unwrap();
        assert_eq!(out, "/usr/lib/open-pdf-studio/tessdata/");
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_leaves_backslash_question_prefix_alone() {
        // Only meaningful on Windows; elsewhere it is an ordinary file name.
        let out = tessdata_path_for_tesseract(Path::new(r"\\?\C:\x")).unwrap();
        assert_eq!(out, "\\\\?\\C:\\x/");
    }

    #[cfg(windows)]
    #[test]
    fn strips_verbatim_disk_prefix() {
        let out = tessdata_path_for_tesseract(Path::new(
            r"\\?\C:\Program Files\Open PDF Studio\tessdata",
        ))
        .unwrap();
        assert_eq!(out, r"C:\Program Files\Open PDF Studio\tessdata\");
    }

    #[cfg(windows)]
    #[test]
    fn plain_disk_path_only_gets_separator() {
        let out = tessdata_path_for_tesseract(Path::new(r"D:\app\tessdata")).unwrap();
        assert_eq!(out, r"D:\app\tessdata\");
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_path_that_cannot_be_simplified_ends_in_backslash() {
        // A reserved device name has no plain equivalent, so it stays
        // verbatim; the trailing backslash still keeps Tesseract from
        // appending "/" (which a verbatim path cannot contain).
        let out = tessdata_path_for_tesseract(Path::new(r"\\?\C:\app\CON")).unwrap();
        assert_eq!(out, r"\\?\C:\app\CON\");
        let unc = tessdata_path_for_tesseract(Path::new(r"\\?\UNC\server\share\tessdata")).unwrap();
        assert!(unc.ends_with('\\'));
        assert!(!unc.contains('/'));
    }

    #[cfg(windows)]
    #[test]
    fn result_never_mixes_verbatim_prefix_with_forward_slash_join() {
        let dir = Path::new(r"\\?\C:\Users\x\AppData\Local\Open PDF Studio").join("tessdata");
        let out = tessdata_path_for_tesseract(&dir).unwrap();
        assert!(!out.starts_with(r"\\?\"));
        assert!(out.ends_with('\\'));
    }
}
