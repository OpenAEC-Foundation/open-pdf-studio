//! Print the page weight (content + form XObject bytes) of every page:
//! page_weights <pdf>... -> "file;page;weight" lines.
use std::sync::Arc;

use open_pdf_kernel::pdfrender::HayroDocument;

fn main() {
    for path in std::env::args().skip(1) {
        let name = std::path::Path::new(&path).file_name().unwrap().to_string_lossy().to_string();
        let Ok(doc) = HayroDocument::open(Arc::new(std::fs::read(&path).expect("read"))) else {
            eprintln!("{name}: cannot open");
            continue;
        };
        for p in 0..doc.page_count() {
            println!("{name};{};{}", p + 1, doc.page_weight(p).unwrap_or(0));
        }
    }
}
