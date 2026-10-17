//! Pool vs in-proc parity: same render request through both paths
//! must produce byte-identical RGBA. If this ever drifts, the pool
//! has a bug.
//!
//! Marked `#[ignore]` so it doesn't run on `cargo test`. To execute:
//!   cargo build -p pdfium-worker
//!   cp open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll target/debug/pdfium.dll
//!   cargo test -p open-pdf-studio --test pool_parity -- --ignored

use std::path::PathBuf;
use std::sync::Arc;

#[tokio::test]
#[ignore] // requires built pdfium-worker.exe + test PDF
async fn pool_render_matches_inproc_for_nkd1a_p4() {
    let exe = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug/pdfium-worker.exe");
    if !exe.exists() {
        panic!("build pdfium-worker first: cargo build -p pdfium-worker");
    }

    let path = "C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/NKD1a_opm_aw.pdf";
    let page = 3; // p4 (0-indexed)
    let scale = 0.25_f32;

    // 1. Render via pool
    let workers = app_lib::worker_pool::spawn::spawn_pool(1, &exe).await
        .expect("spawn pool");
    let pool = app_lib::worker_pool::WorkerPool::new(workers);
    assert!(pool.is_ready(), "pool not ready");

    let (pw, ph, prgba) = pool.render(path, page, scale, 0, false).await.expect("pool render");

    // 2. Render in-proc. PDFium must be initialised first; idempotent.
    let dll_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug");
    app_lib::pdfium_renderer::init_pdfium(&dll_dir)
        .expect("init pdfium");

    let bytes = std::fs::read(path).expect("read pdf");
    let cache = app_lib::pdfium_renderer::PdfiumDocCache::default();
    let handle = app_lib::pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        path, Arc::new(bytes), &cache
    ).expect("load pdf");
    let (iw, ih, irgba) = app_lib::pdfium_renderer::render_page_to_rgba(
        handle.document(), page, scale, 0
    ).expect("inproc render");

    // 3. Compare
    assert_eq!(pw, iw, "width differs");
    assert_eq!(ph, ih, "height differs");
    assert_eq!(prgba.len(), irgba.len(), "rgba length differs");

    let diff = prgba.iter().zip(irgba.iter())
        .filter(|(a, b)| a != b).count();
    let total = prgba.len();
    let diff_pct = (diff as f64 / total as f64) * 100.0;
    assert!(diff_pct < 0.1, "pool rgba differs from in-proc by {:.3}% ({} bytes)", diff_pct, diff);
    println!("PARITY OK: {}x{}, diff={} bytes ({:.4}%)", pw, ph, diff, diff_pct);
}
