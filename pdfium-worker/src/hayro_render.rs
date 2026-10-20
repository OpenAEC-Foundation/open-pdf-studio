//! Hayro route of the worker: the same requests as `render.rs`, rendered by
//! the pure-Rust engine in `open-pdf-kernel`.

use std::sync::Arc;
use std::time::SystemTime;

use anyhow::{anyhow, Context, Result};
use open_pdf_kernel::pdfrender::HayroDocument;

use crate::render::RenderResult;
use crate::shm;

/// Same cap as the PDFium cache: active document plus one more.
const DOC_CACHE_CAP: usize = 2;

struct CachedDoc {
    path: String,
    mtime: Option<SystemTime>,
    len: u64,
    doc: HayroDocument,
}

pub struct HayroRenderer {
    cache: Vec<CachedDoc>,
    threads: u16,
}

impl Default for HayroRenderer {
    fn default() -> Self {
        HayroRenderer {
            cache: Vec::new(),
            threads: open_pdf_kernel::pdfrender::render_threads(),
        }
    }
}

impl HayroRenderer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cache hit only when path, mtime and length match (the file may have
    /// been rewritten by a save).
    fn doc(&mut self, path: &str) -> Result<&HayroDocument> {
        let meta = std::fs::metadata(path).with_context(|| format!("stat {}", path))?;
        let (mtime, len) = (meta.modified().ok(), meta.len());
        let hit = self
            .cache
            .iter()
            .position(|c| c.path == path && c.mtime == mtime && c.len == len);
        let i = match hit {
            Some(i) => i,
            None => {
                self.cache.retain(|c| c.path != path);
                let bytes = std::fs::read(path).with_context(|| format!("read {}", path))?;
                let doc = HayroDocument::open(Arc::new(bytes))?.with_threads(self.threads);
                if self.cache.len() >= DOC_CACHE_CAP {
                    self.cache.remove(0);
                }
                self.cache.push(CachedDoc { path: path.to_string(), mtime, len, doc });
                self.cache.len() - 1
            }
        };
        Ok(&self.cache[i].doc)
    }

    pub fn render(&mut self, path: &str, page_index: u32, scale: f32, rotation: i32) -> Result<RenderResult> {
        let doc = self.doc(path)?;
        let (w, h) = doc.page_size(page_index)?;
        let (bw, bh) = (ceil_px(w, scale), ceil_px(h, scale));
        let (bw, bh) = if rotation.rem_euclid(180) == 90 { (bh, bw) } else { (bw, bh) };
        shm::ensure_bitmap_fits(bw, bh)?;
        let img = doc.render_page(page_index, scale, rotation)?;
        Ok(RenderResult { width: img.width, height: img.height, rgba: img.data })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn render_region(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        x_pt: f32,
        y_pt: f32,
        w_pt: f32,
        h_pt: f32,
    ) -> Result<RenderResult> {
        if rotation != 0 {
            return Err(anyhow!("render_region: rotation {} not supported", rotation));
        }
        shm::ensure_bitmap_fits(ceil_px(w_pt, scale), ceil_px(h_pt, scale))?;
        let img = self.doc(path)?.render_region(page_index, scale, x_pt, y_pt, w_pt, h_pt)?;
        Ok(RenderResult { width: img.width, height: img.height, rgba: img.data })
    }
}

fn ceil_px(pt: f32, scale: f32) -> i32 {
    (f64::from(pt) * f64::from(scale)).ceil().min(f64::from(i32::MAX)) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tekst_pdf() -> String {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../test pdf-bestanden/Testbestanden/Tekst.pdf")
            .to_string()
    }

    #[test]
    fn renders_tekst_p1_at_display_size() {
        let mut r = HayroRenderer::new();
        let out = r.render(&tekst_pdf(), 0, 1.0, 0).unwrap();
        assert_eq!((out.width, out.height), (596, 842));
        assert_eq!(out.rgba.len(), 596 * 842 * 4);
        let ink = out.rgba.chunks(4).filter(|p| p[0] < 128).count();
        assert!(ink > 1000, "page has text: {ink} dark pixels");
    }

    #[test]
    fn region_has_the_requested_size() {
        let mut r = HayroRenderer::new();
        let out = r.render_region(&tekst_pdf(), 0, 2.0, 0, 10.0, 20.0, 100.5, 50.0).unwrap();
        assert_eq!((out.width, out.height), (201, 100));
    }

    #[test]
    fn region_rejects_rotation_like_pdfium() {
        let mut r = HayroRenderer::new();
        assert!(r.render_region(&tekst_pdf(), 0, 1.0, 90, 0.0, 0.0, 10.0, 10.0).is_err());
    }

    #[test]
    fn oversized_bitmap_is_a_clean_shm_error() {
        let mut r = HayroRenderer::new();
        let err = match r.render(&tekst_pdf(), 0, 10.0, 0) {
            Ok(_) => panic!("expected an error"),
            Err(e) => e.to_string(),
        };
        assert!(err.contains("too large for SHM"), "{err}");
    }

    #[test]
    fn missing_file_is_an_error() {
        let mut r = HayroRenderer::new();
        assert!(r.render("C:/does/not/exist.pdf", 0, 1.0, 0).is_err());
    }
}
