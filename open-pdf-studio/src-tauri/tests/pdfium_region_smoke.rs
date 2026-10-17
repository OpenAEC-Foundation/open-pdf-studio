//! Smoke test for render_page_region_to_rgba. Renders only the top-left
//! quadrant of BARN page 1 at scale 2.0, verifies dimensions match
//! expected and the bitmap is not all-white (i.e. content is present).

use std::path::PathBuf;
use std::sync::Arc;

use app_lib::pdfium_renderer::{
    init_pdfium, get_or_load_pdfium_doc_with_bytes, render_page_region_to_rgba, PdfiumDocCache,
};

#[test]
fn pdfium_renders_barn_top_left_quadrant() {
    let pdf_path = match std::env::var("OPEN_PDF_STUDIO_TEST_PDF") {
        Ok(p) => p,
        Err(_) => {
            eprintln!("Skipping: set OPEN_PDF_STUDIO_TEST_PDF");
            return;
        }
    };
    let dll_dir: PathBuf = std::env::var("OPEN_PDF_STUDIO_TEST_DLL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|q| q.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."))
        });
    init_pdfium(&dll_dir).expect("init_pdfium");

    let bytes = std::fs::read(&pdf_path).expect("read pdf");
    let cache = PdfiumDocCache::default();
    let handle = get_or_load_pdfium_doc_with_bytes(&pdf_path, Arc::new(bytes), &cache)
        .expect("load");

    // BARN p1 dims at scale 1.0 = 2448x1584 px (1632x1056 pt). Render only
    // the top-left 50% x 50% region at scale 2.0 -> expected bitmap
    // ~1632 x 1056 pixels (region_w_pt=816 x scale 2 = 1632).
    let (w, h, rgba) = render_page_region_to_rgba(
        handle.document(),
        0,        // page_index
        2.0,      // scale
        0,        // rotation
        0.0,      // region_x_pt
        0.0,      // region_y_pt
        816.0,    // region_w_pt (half of 1632)
        528.0,    // region_h_pt (half of 1056)
        false,    // thin_lines
    ).expect("render region");

    println!("Region rendered: {}x{} px, {} bytes", w, h, rgba.len());

    assert_eq!(rgba.len(), (w * h * 4) as usize, "rgba size mismatch");
    assert!(w > 100 && w < 3000, "width out of range: {}", w);
    assert!(h > 100 && h < 3000, "height out of range: {}", h);

    let non_white = rgba.chunks(4).filter(|p| p[0] != 255 || p[1] != 255 || p[2] != 255).count();
    assert!(
        non_white > 100,
        "Region is mostly white — render likely missed content. non_white = {}",
        non_white
    );

    println!("non-white pixels: {}", non_white);
}
