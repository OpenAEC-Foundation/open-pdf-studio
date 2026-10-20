//! Render one page (or a region) with Hayro and report time and size, for
//! profiling: render_page <pdf> <page-index> <scale> [x y w h] [repeat]
use std::sync::Arc;
use std::time::Instant;

use open_pdf_kernel::pdfrender::HayroDocument;

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let bytes = Arc::new(std::fs::read(&a[0]).expect("read pdf"));
    let page: u32 = a[1].parse().unwrap();
    let scale: f32 = a[2].parse().unwrap();
    let region: Option<[f32; 4]> = (a.len() >= 7).then(|| {
        [
            a[3].parse().unwrap(),
            a[4].parse().unwrap(),
            a[5].parse().unwrap(),
            a[6].parse().unwrap(),
        ]
    });
    let repeat: usize = a
        .get(7)
        .or(a.get(3).filter(|_| region.is_none()))
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    let doc = HayroDocument::open(bytes).expect("open");
    for i in 0..repeat {
        let t = Instant::now();
        let img = match region {
            Some([x, y, w, h]) => doc.render_region(page, scale, x, y, w, h),
            None => doc.render_page(page, scale, 0),
        }
        .expect("render");
        println!(
            "run {i}: {}x{} in {:.1} ms",
            img.width,
            img.height,
            t.elapsed().as_secs_f64() * 1000.0
        );
    }
}
