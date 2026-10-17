//! Concurrency stress test for the in-proc PDFium renderer.
//!
//! Reproduces the Linux heap-corruption crash (`free(): double free` /
//! `malloc(): unaligned fastbin chunk`) that happens when multiple threads
//! load and render PDFs through in-proc PDFium at the same time — exactly the
//! situation on Linux, where the Windows-only worker pool is disabled so every
//! render is in-proc. Several threads each repeatedly load a fresh document and
//! render a full page, a thumbnail and a region, maximising overlap between
//! document loads and renders on different threads.
//!
//! Without serialisation (`PDFIUM_INPROC_LOCK` in `pdfium_renderer`) this
//! aborts the whole test process within a few iterations. With it, all threads
//! finish cleanly.
//!
//! Gated on `OPEN_PDF_STUDIO_STRESS_DIR` (a directory with >=2 PDFs) so it is a
//! no-op in environments without a test corpus.

use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use app_lib::pdfium_renderer::{
    init_pdfium, render_page_region_to_rgba, render_page_to_rgba, render_thumbnail_to_json,
    PdfiumDocumentHandle,
};

#[test]
fn concurrent_inproc_renders_do_not_corrupt_heap() {
    let dir = match std::env::var("OPEN_PDF_STUDIO_STRESS_DIR") {
        Ok(d) => PathBuf::from(d),
        Err(_) => {
            eprintln!("Skipping: set OPEN_PDF_STUDIO_STRESS_DIR to a dir with >=2 PDFs");
            return;
        }
    };

    let dll_dir: PathBuf = std::env::var("OPEN_PDF_STUDIO_TEST_DLL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    init_pdfium(&dll_dir).expect("init_pdfium");

    // Load a handful of PDFs into memory so threads share the byte buffers but
    // build fresh document handles each iteration.
    let mut pdfs: Vec<Arc<Vec<u8>>> = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("read stress dir") {
        let p = entry.expect("dir entry").path();
        if p.extension().and_then(|e| e.to_str()) == Some("pdf") {
            if let Ok(b) = std::fs::read(&p) {
                pdfs.push(Arc::new(b));
            }
        }
        if pdfs.len() >= 4 {
            break;
        }
    }
    assert!(pdfs.len() >= 2, "need >=2 readable PDFs in OPEN_PDF_STUDIO_STRESS_DIR");

    let iters: usize = std::env::var("OPEN_PDF_STUDIO_STRESS_ITERS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(60);
    let n_threads = 8usize;

    let pdfs = Arc::new(pdfs);
    let mut handles = Vec::new();
    for t in 0..n_threads {
        let pdfs = pdfs.clone();
        handles.push(thread::spawn(move || {
            for i in 0..iters {
                let bytes = pdfs[(t + i) % pdfs.len()].clone();
                // Fresh load every iteration → a document LOAD on this thread
                // overlaps RENDERs on the others: the exact crash trigger.
                let handle = match PdfiumDocumentHandle::load_from_bytes(bytes) {
                    Ok(h) => h,
                    Err(_) => continue, // corrupt/encrypted — irrelevant here
                };
                let doc = handle.document();
                let _ = render_page_to_rgba(doc, 0, 1.0, 0);
                let _ = render_thumbnail_to_json(doc, 0, 140, 0);
                let _ = render_page_region_to_rgba(doc, 0, 2.0, 0, 0.0, 0.0, 100.0, 100.0, false);
            }
        }));
    }
    for h in handles {
        h.join().expect("render thread panicked");
    }
    println!(
        "Concurrency stress OK: {} threads x {} iters over {} PDFs, no heap corruption",
        n_threads,
        iters,
        pdfs.len()
    );
}
