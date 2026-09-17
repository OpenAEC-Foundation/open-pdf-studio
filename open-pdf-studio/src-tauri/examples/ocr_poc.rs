// OCR end-to-end verification: run the REAL ocr::ocr_page_words function
// (the same code the Tauri command uses) against a real PDF and dump the
// words as JSON, so a Node script can feed them into the real JS invisible-
// text-layer writer and verify the saved PDF is actually searchable.
//
// Usage: cargo run -p open-pdf-studio --example ocr_poc -- <pdf-path> [page-index] [lang] > words.json

use app_lib::{ocr, pdfium_renderer};
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let pdf_path = args.get(1).expect("usage: ocr_poc <pdf-path> [page-index] [lang]");
    let page_index: u32 = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(0);
    let lang = args.get(3).cloned().unwrap_or_else(|| "chi_tra+eng".to_string());

    let dylib_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/macos-universal");
    pdfium_renderer::init_pdfium(&dylib_dir).expect("init_pdfium failed");

    let bytes = std::fs::read(pdf_path).expect("read pdf");
    let cache = pdfium_renderer::PdfiumDocCache(std::sync::Mutex::new(std::collections::HashMap::new()));
    let handle = pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        pdf_path,
        std::sync::Arc::new(bytes),
        &cache,
    )
    .expect("load pdf");

    let words = ocr::ocr_page_words(handle.document(), page_index, "/tmp/tessdata", &lang)
        .expect("ocr_page_words failed");

    eprintln!("Recognized {} words", words.len());
    println!("{}", serde_json::to_string(&words).unwrap());
}
