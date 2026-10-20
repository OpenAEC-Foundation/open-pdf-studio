//! Engine comparison: renders every page of every PDF in the given folders
//! with PDFium (the worker's renderer) and Hayro (open-pdf-kernel), and
//! reports speed and completeness per page.
//!
//!   cargo run --release -p pdfium-worker --example engine_compare -- <out-dir> <dir>...
//!
//! pdfium.dll must be next to the example binary or in the working directory.
//! Per page: render time of each engine (first render of the page, then a
//! repeat), errors/panics/timeouts, ink coverage of both, and the share of
//! pixels that differ clearly (any channel > 64). Pages that look different
//! are written as PNG pairs to <out-dir>/flagged for visual review.
//! Writes <out-dir>/pages.csv and <out-dir>/summary.md.

#[path = "../src/render.rs"]
#[allow(dead_code)]
mod render;
#[path = "../src/shm.rs"]
#[allow(dead_code)]
mod shm;
#[path = "../src/thin_lines.rs"]
mod thin_lines;

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use open_pdf_kernel::pdfrender::HayroDocument;
use open_pdf_kernel::raster::RgbaImage;

/// Longest bitmap side; fits the worker's SHM limit at any aspect ratio.
const TARGET_SIDE_PX: f32 = 2048.0;
const HAYRO_TIMEOUT: Duration = Duration::from_secs(120);

struct Shot {
    ms_first: f64,
    ms_repeat: f64,
    img: Option<RgbaImage>,
    error: Option<String>,
}

#[derive(Default)]
struct PageRow {
    file: String,
    page: u32,
    width: u32,
    height: u32,
    pdfium_ms: f64,
    pdfium_repeat_ms: f64,
    hayro_ms: f64,
    hayro_repeat_ms: f64,
    pdfium_error: String,
    hayro_error: String,
    ink_pdfium: f64,
    ink_hayro: f64,
    diff_pct: f64,
    size_mismatch: bool,
    flag: String,
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    anyhow::ensure!(args.len() >= 2, "usage: engine_compare <out-dir> <dir>...");
    let out = PathBuf::from(&args[0]);
    std::fs::create_dir_all(out.join("flagged"))?;
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in &args[1..] {
        let mut found: Vec<PathBuf> = std::fs::read_dir(dir)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf")))
            .collect();
        found.sort();
        files.extend(found);
    }

    let mut pdfium = render::Renderer::new()?;
    let threads: u16 = std::env::var("OPDS_HAYRO_THREADS").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    eprintln!("Hayro threads: {threads}");
    let mut rows: Vec<PageRow> = Vec::new();
    for file in &files {
        let name = file.file_name().unwrap().to_string_lossy().to_string();
        let path = file.to_string_lossy().to_string();
        let bytes = Arc::new(std::fs::read(file)?);
        let t_open = Instant::now();
        let hayro_doc = HayroDocument::open(bytes.clone());
        let hayro_open_ms = ms(t_open);
        let pages = match pdfium.page_count(&path) {
            Ok(n) => n,
            Err(e) => {
                eprintln!("{name}: PDFium cannot open: {e}");
                continue;
            }
        };
        let mut hayro = HayroWorker::new(threads);
        eprintln!("{name}: {pages} pages (Hayro open {hayro_open_ms:.1} ms{})",
            if hayro_doc.is_err() { ", FAILED" } else { "" });
        for page in 0..pages {
            let scale = match &hayro_doc {
                Ok(d) => d.page_size(page).map(|(w, h)| TARGET_SIDE_PX / w.max(h)).unwrap_or(1.0),
                Err(_) => 1.0,
            };
            let p = shot_pdfium(&mut pdfium, &path, page, scale);
            let h = match &hayro_doc {
                Ok(_) => hayro.shot(&bytes, page, scale),
                Err(e) => Shot { ms_first: 0.0, ms_repeat: 0.0, img: None, error: Some(e.to_string()) },
            };
            let mut row = PageRow {
                file: name.clone(),
                page: page + 1,
                pdfium_ms: p.ms_first,
                pdfium_repeat_ms: p.ms_repeat,
                hayro_ms: h.ms_first,
                hayro_repeat_ms: h.ms_repeat,
                pdfium_error: p.error.clone().unwrap_or_default(),
                hayro_error: h.error.clone().unwrap_or_default(),
                ..PageRow::default()
            };
            if let (Some(a), Some(b)) = (&p.img, &h.img) {
                row.width = a.width;
                row.height = a.height;
                row.size_mismatch = a.width.abs_diff(b.width) > 1 || a.height.abs_diff(b.height) > 1;
                row.ink_pdfium = ink(a);
                row.ink_hayro = ink(b);
                row.diff_pct = diff_pct(a, b);
            }
            row.flag = flag(&row);
            if !row.flag.is_empty() {
                let stem = format!("{}-p{}", name.trim_end_matches(".pdf"), page + 1);
                if let Some(a) = &p.img {
                    std::fs::write(out.join("flagged").join(format!("{stem}-pdfium.png")), a.to_png())?;
                }
                if let Some(b) = &h.img {
                    std::fs::write(out.join("flagged").join(format!("{stem}-hayro.png")), b.to_png())?;
                }
            }
            eprintln!(
                "  p{:<3} pdfium {:>8.1} ms  hayro {:>8.1} ms  ink {:>5.2}%/{:>5.2}%  diff {:>5.2}%  {}",
                row.page, row.pdfium_ms, row.hayro_ms, row.ink_pdfium, row.ink_hayro, row.diff_pct, row.flag
            );
            rows.push(row);
        }
    }
    write_csv(&out.join("pages.csv"), &rows)?;
    std::fs::write(out.join("summary.md"), summary(&rows))?;
    eprintln!("written {}", out.display());
    Ok(())
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn shot_pdfium(r: &mut render::Renderer, path: &str, page: u32, scale: f32) -> Shot {
    let t = Instant::now();
    let first = r.render(path, page, scale, 0, false);
    let ms_first = ms(t);
    let t = Instant::now();
    let _ = r.render(path, page, scale, 0, false);
    let ms_repeat = ms(t);
    match first {
        Ok(res) => Shot {
            ms_first,
            ms_repeat,
            img: Some(RgbaImage { width: res.width, height: res.height, data: res.rgba }),
            error: None,
        },
        Err(e) => Shot { ms_first, ms_repeat, img: None, error: Some(e.to_string()) },
    }
}

/// One Hayro document per file on its own thread, so its render cache is
/// reused across the pages of that file, as in the app's worker. A panic or a
/// hang costs one page: a hung thread is abandoned and a fresh one starts.
struct HayroWorker {
    threads: u16,
    tx: Option<mpsc::Sender<(Arc<Vec<u8>>, u32, f32, mpsc::Sender<Shot>)>>,
}

impl HayroWorker {
    fn new(threads: u16) -> Self {
        HayroWorker { threads, tx: None }
    }

    fn spawn(&mut self) {
        let (tx, rx) = mpsc::channel::<(Arc<Vec<u8>>, u32, f32, mpsc::Sender<Shot>)>();
        let threads = self.threads;
        std::thread::spawn(move || {
            let mut doc: Option<HayroDocument> = None;
            for (bytes, page, scale, reply) in rx {
                let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let t = Instant::now();
                    if doc.is_none() {
                        doc = Some(HayroDocument::open(bytes).map_err(|e| e.to_string())?.with_threads(threads));
                    }
                    let d = doc.as_ref().unwrap();
                    let first = d.render_page(page, scale, 0).map_err(|e| e.to_string());
                    let ms_first = ms(t);
                    let t = Instant::now();
                    let _ = d.render_page(page, scale, 0);
                    Ok::<_, String>((first, ms_first, ms(t)))
                }));
                let shot = match run {
                    Ok(Ok((Ok(img), ms_first, ms_repeat))) => Shot { ms_first, ms_repeat, img: Some(img), error: None },
                    Ok(Ok((Err(e), ms_first, ms_repeat))) => Shot { ms_first, ms_repeat, img: None, error: Some(e) },
                    Ok(Err(e)) => Shot { ms_first: 0.0, ms_repeat: 0.0, img: None, error: Some(e) },
                    Err(_) => {
                        doc = None;
                        Shot { ms_first: 0.0, ms_repeat: 0.0, img: None, error: Some("panic".into()) }
                    }
                };
                let _ = reply.send(shot);
            }
        });
        self.tx = Some(tx);
    }

    fn shot(&mut self, bytes: &Arc<Vec<u8>>, page: u32, scale: f32) -> Shot {
        if self.tx.is_none() {
            self.spawn();
        }
        let (reply_tx, reply_rx) = mpsc::channel();
        let sent = self.tx.as_ref().unwrap().send((bytes.clone(), page, scale, reply_tx));
        if sent.is_err() {
            self.tx = None;
            return Shot { ms_first: 0.0, ms_repeat: 0.0, img: None, error: Some("worker gone".into()) };
        }
        match reply_rx.recv_timeout(HAYRO_TIMEOUT) {
            Ok(shot) => shot,
            Err(_) => {
                self.tx = None;
                Shot {
                    ms_first: HAYRO_TIMEOUT.as_secs_f64() * 1000.0,
                    ms_repeat: 0.0,
                    img: None,
                    error: Some("timeout".into()),
                }
            }
        }
    }
}

/// Share of pixels darker than light grey (luma < 200), in percent.
fn ink(img: &RgbaImage) -> f64 {
    let dark = img
        .data
        .chunks_exact(4)
        .filter(|p| (u32::from(p[0]) * 299 + u32::from(p[1]) * 587 + u32::from(p[2]) * 114) / 1000 < 200)
        .count();
    100.0 * dark as f64 / (img.width as f64 * img.height as f64).max(1.0)
}

/// Share of pixels (over the common area) where any channel differs by > 64.
fn diff_pct(a: &RgbaImage, b: &RgbaImage) -> f64 {
    let (w, h) = (a.width.min(b.width), a.height.min(b.height));
    let mut differ = 0u64;
    for y in 0..h {
        for x in 0..w {
            let i = ((y * a.width + x) * 4) as usize;
            let j = ((y * b.width + x) * 4) as usize;
            if (0..3).any(|c| a.data[i + c].abs_diff(b.data[j + c]) > 64) {
                differ += 1;
            }
        }
    }
    100.0 * differ as f64 / (f64::from(w) * f64::from(h)).max(1.0)
}

fn flag(r: &PageRow) -> String {
    if !r.hayro_error.is_empty() {
        return format!("HAYRO-{}", if r.hayro_error == "timeout" || r.hayro_error == "panic" { r.hayro_error.to_uppercase() } else { "ERROR".into() });
    }
    if !r.pdfium_error.is_empty() {
        return "PDFIUM-ERROR".into();
    }
    if r.size_mismatch {
        return "SIZE".into();
    }
    if r.ink_pdfium > 0.5 && r.ink_hayro < 0.1 * r.ink_pdfium {
        return "HAYRO-BLANK".into();
    }
    let rel = (r.ink_hayro - r.ink_pdfium).abs() / r.ink_pdfium.max(0.5);
    if rel > 0.25 {
        return "INK".into();
    }
    if r.diff_pct > 5.0 {
        return "DIFF".into();
    }
    String::new()
}

fn write_csv(path: &Path, rows: &[PageRow]) -> anyhow::Result<()> {
    let mut s = String::from("file;page;width;height;pdfium_ms;pdfium_repeat_ms;hayro_ms;hayro_repeat_ms;ink_pdfium;ink_hayro;diff_pct;flag;pdfium_error;hayro_error\n");
    for r in rows {
        writeln!(
            s,
            "{};{};{};{};{:.1};{:.1};{:.1};{:.1};{:.3};{:.3};{:.3};{};{};{}",
            r.file, r.page, r.width, r.height, r.pdfium_ms, r.pdfium_repeat_ms, r.hayro_ms, r.hayro_repeat_ms,
            r.ink_pdfium, r.ink_hayro, r.diff_pct, r.flag,
            r.pdfium_error.replace(';', ","), r.hayro_error.replace(';', ",")
        )?;
    }
    std::fs::write(path, s)?;
    Ok(())
}

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.total_cmp(b));
    v[v.len() / 2]
}

fn summary(rows: &[PageRow]) -> String {
    let ok: Vec<&PageRow> = rows.iter().filter(|r| r.hayro_error.is_empty() && r.pdfium_error.is_empty()).collect();
    let mut s = String::new();
    let _ = writeln!(s, "# Engine comparison PDFium vs Hayro\n");
    let _ = writeln!(s, "Pages: {} — both rendered: {} — Hayro failed: {} — PDFium failed: {}\n",
        rows.len(), ok.len(),
        rows.iter().filter(|r| !r.hayro_error.is_empty()).count(),
        rows.iter().filter(|r| !r.pdfium_error.is_empty()).count());
    let tot = |f: fn(&PageRow) -> f64| ok.iter().map(|r| f(r)).sum::<f64>();
    let _ = writeln!(s, "| | PDFium | Hayro | Hayro / PDFium |\n|---|---:|---:|---:|");
    for (label, fp, fh) in [
        ("Median per page, first render (ms)", median(ok.iter().map(|r| r.pdfium_ms).collect()), median(ok.iter().map(|r| r.hayro_ms).collect())),
        ("Median per page, repeat render (ms)", median(ok.iter().map(|r| r.pdfium_repeat_ms).collect()), median(ok.iter().map(|r| r.hayro_repeat_ms).collect())),
        ("Total, first render (s)", tot(|r| r.pdfium_ms) / 1000.0, tot(|r| r.hayro_ms) / 1000.0),
    ] {
        let _ = writeln!(s, "| {label} | {fp:.1} | {fh:.1} | {:.2} |", fh / fp.max(1e-9));
    }
    let _ = writeln!(s, "\nPages where Hayro is more than 2x slower: {}\n",
        ok.iter().filter(|r| r.hayro_ms > 2.0 * r.pdfium_ms).count());
    let _ = writeln!(s, "## Per file\n\n| File | Pages | PDFium s | Hayro s | Ratio | Flags |\n|---|---:|---:|---:|---:|---|");
    let mut files: Vec<&str> = rows.iter().map(|r| r.file.as_str()).collect();
    files.dedup();
    for f in files {
        let fr: Vec<&PageRow> = rows.iter().filter(|r| r.file == f).collect();
        let p: f64 = fr.iter().map(|r| r.pdfium_ms).sum::<f64>() / 1000.0;
        let h: f64 = fr.iter().map(|r| r.hayro_ms).sum::<f64>() / 1000.0;
        let flags: Vec<String> = fr.iter().filter(|r| !r.flag.is_empty()).map(|r| format!("p{} {}", r.page, r.flag)).collect();
        let _ = writeln!(s, "| {f} | {} | {p:.2} | {h:.2} | {:.2} | {} |", fr.len(), h / p.max(1e-9), flags.join(", "));
    }
    s
}
