//! Pixelvergelijking van Vergelijken (#465) in de worker.
//!
//! Het pixelwerk van js/compare/ (rasteren van beide revisies, inktmaskers,
//! automatische uitlijning, verschil per pixel, clusters) draait hier, waar
//! PDFium de pagina's al rendert: volledige RGBA-bitmaps gaan nooit over IPC.
//! Terug gaan alleen de clusters (binair via SHM), de uitlijning en
//! statistieken. De algoritmen zijn regel voor regel geporteerd uit
//! ink-mask.js, mask-detect.js, auto-align.js, fft.js en alignment.js; de
//! pariteitstests (tests.rs) draaien beide op dezelfde maskers.
//!
//! De pijplijn volgt de pixeltak van computePairChanges() in
//! compare-viewport.js stap voor stap.

pub mod align;
pub mod detect;
pub mod fft;
pub mod ink;
pub mod jsmath;
pub mod matrix;
#[cfg(test)]
mod tests;

use crate::render::Renderer;
use align::{estimate_alignment, AlignOptions, AlignResult};
use anyhow::{anyhow, Result};
use detect::{detect_mask_changes, DetectOptions, Detection};
use ink::{estimate_background, write_ink_tile, Mask, Rgb, BGRA};
use matrix::{alignment_matrix, multiply, normalize, scaling, Alignment, Size};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Instant;

/// Grootste tegelrand en tegelbudget (detect-plan.js).
pub const MAX_TILE_EDGE: usize = 4096;
pub const MAX_TILE_PX: usize = 8_388_608;
/// Maskercache per worker: een A0-masker op 0,2 mm/px is 25 MB.
const MASK_CACHE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq)]
pub struct Side {
    pub path: String,
    pub page_index: u32,
    /// Paginamaat in punten zoals pdf.js hem meldt (viewport op schaal 1).
    pub width_pt: f64,
    pub height_pt: f64,
    /// Bytelengte die de app voor dit bestand in het geheugen heeft; wijkt de
    /// schijf af, dan weigert de worker (de app rekent dan zelf).
    #[serde(default)]
    pub expect_len: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, Deserialize, PartialEq)]
pub struct AutoAlign {
    #[serde(default)]
    pub measure_ratio: Option<f64>,
    #[serde(default)]
    pub rotation_range: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
pub struct CompareRequest {
    pub id: u64,
    pub old: Side,
    pub new: Side,
    pub px_per_pt: f64,
    pub threshold: f64,
    #[serde(default)]
    pub params: Option<DetectOptions>,
    /// Handmatige uitlijning (gebruikt zonder auto_align).
    #[serde(default)]
    pub alignment: Option<Alignment>,
    #[serde(default)]
    pub auto_align: Option<AutoAlign>,
    /// Alleen uitlijnen (vectorvergelijking met automatische uitlijning).
    #[serde(default)]
    pub skip_detect: bool,
}

impl PartialEq for CompareRequest {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id && self.old == other.old && self.new == other.new
    }
}

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct Stats {
    pub preview_ms: f64,
    pub render_ms: f64,
    pub ink_ms: f64,
    pub align_ms: f64,
    pub detect_ms: f64,
    pub total_ms: f64,
    pub mask_hits: u32,
    pub masks_rendered: u32,
    pub old_ink: u64,
    pub new_ink: u64,
    pub width: usize,
    pub height: usize,
}

pub struct CompareOutcome {
    pub alignment: Alignment,
    pub align_info: Option<AlignResult>,
    pub old_px: f64,
    pub detection: Option<Detection>,
    pub stats: Stats,
}

#[derive(PartialEq, Clone)]
struct MaskKey {
    path: String,
    mtime: Option<std::time::SystemTime>,
    len: u64,
    page: u32,
    px: u64,
    threshold: u64,
}

struct CachedMask {
    key: MaskKey,
    mask: Arc<Mask>,
    ink: u64,
}

#[derive(Default)]
pub struct CompareCache {
    masks: Vec<CachedMask>,
    bytes: usize,
    backgrounds: Vec<((String, Option<std::time::SystemTime>, u64, u32), Rgb)>,
}

impl CompareCache {
    pub fn clear(&mut self) {
        self.masks.clear();
        self.bytes = 0;
        self.backgrounds.clear();
    }

    fn get(&mut self, key: &MaskKey) -> Option<(Arc<Mask>, u64)> {
        let i = self.masks.iter().position(|c| &c.key == key)?;
        let c = self.masks.remove(i);
        let out = (c.mask.clone(), c.ink);
        self.masks.push(c);
        Some(out)
    }

    fn put(&mut self, key: MaskKey, mask: Arc<Mask>, ink: u64) {
        self.bytes += mask.byte_len();
        self.masks.push(CachedMask { key, mask, ink });
        while self.bytes > MASK_CACHE_BYTES && self.masks.len() > 2 {
            let c = self.masks.remove(0);
            self.bytes -= c.mask.byte_len();
        }
    }
}

/// planTiles (detect-plan.js)
pub fn plan_tiles(width: usize, height: usize) -> Vec<(usize, usize, usize, usize)> {
    let w = width.max(1);
    let h = height.max(1);
    let cols = w.div_ceil(MAX_TILE_EDGE).max(1);
    let tile_w = w.div_ceil(cols);
    let tile_h = MAX_TILE_EDGE.min(h).min(MAX_TILE_PX / tile_w).max(1);
    let mut tiles = Vec::new();
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            tiles.push((x, y, tile_w.min(w - x), tile_h.min(h - y)));
            x += tile_w;
        }
        y += tile_h;
    }
    tiles
}

/// Maskermaat van een pagina op px pixels per punt: Math.ceil(viewport.width).
pub fn mask_dims(side: &Side, px: f64) -> (usize, usize) {
    let w = (side.width_pt * px).ceil().max(1.0);
    let h = (side.height_pt * px).ceil().max(1.0);
    (w as usize, h as usize)
}

/// _quantScale (compare-viewport.js)
pub fn quant_scale(s: f64) -> f64 {
    jsmath::exp(jsmath::round(jsmath::ln(s) / 0.005) * 0.005)
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn check_side(side: &Side) -> Result<(Option<std::time::SystemTime>, u64)> {
    if !(side.width_pt.is_finite() && side.height_pt.is_finite() && side.width_pt > 0.0 && side.height_pt > 0.0) {
        return Err(anyhow!("PDF_INVALID_GEOMETRY: compare page size"));
    }
    let (mtime, len) = Renderer::file_identity(&side.path)?;
    if let Some(expect) = side.expect_len {
        if expect != len {
            return Err(anyhow!("PDF_COMPARE_STALE: {} has {} bytes on disk, the app holds {}", side.path, len, expect));
        }
    }
    Ok((mtime, len))
}

/// _preview(): achtergrondkleur uit een render van 256 px op de lange zijde.
fn background(renderer: &mut Renderer, cache: &mut CompareCache, side: &Side, ident: (Option<std::time::SystemTime>, u64)) -> Result<Rgb> {
    let key = (side.path.clone(), ident.0, ident.1, side.page_index);
    if let Some((_, bg)) = cache.backgrounds.iter().find(|(k, _)| *k == key) {
        return Ok(*bg);
    }
    let scale = 256.0 / side.width_pt.max(side.height_pt);
    let (w, h) = mask_dims(side, scale);
    let mut bg = ink::WHITE;
    renderer.render_tiles(&side.path, side.page_index, scale, &[(0, 0, w, h)], |_, px| {
        bg = estimate_background(px, BGRA, w, h, 250_000.0);
    })?;
    cache.backgrounds.push((key, bg));
    if cache.backgrounds.len() > 32 {
        cache.backgrounds.remove(0);
    }
    Ok(bg)
}

/// getCompareMask(): tegelgewijs renderen naar een inktmasker.
fn mask_for(renderer: &mut Renderer, cache: &mut CompareCache, side: &Side, px: f64, threshold: f64, stats: &mut Stats) -> Result<(Arc<Mask>, u64)> {
    let ident = check_side(side)?;
    let key = MaskKey { path: side.path.clone(), mtime: ident.0, len: ident.1, page: side.page_index, px: px.to_bits(), threshold: threshold.to_bits() };
    if let Some(hit) = cache.get(&key) {
        stats.mask_hits += 1;
        return Ok(hit);
    }
    let t = Instant::now();
    let bg = background(renderer, cache, side, ident)?;
    stats.preview_ms += ms(t);
    let (w, h) = mask_dims(side, px);
    let mut mask = Mask::new(w, h);
    let tiles = plan_tiles(w, h);
    let mut ink = 0u64;
    let mut ink_ms = 0.0;
    let t = Instant::now();
    renderer.render_tiles(&side.path, side.page_index, px, &tiles, |i, bgra| {
        let ti = Instant::now();
        let (x, y, tw, th) = tiles[i];
        ink += write_ink_tile(&mut mask, bgra, BGRA, tw, th, x, y, bg, threshold);
        ink_ms += ms(ti);
    })?;
    stats.render_ms += ms(t) - ink_ms;
    stats.ink_ms += ink_ms;
    stats.masks_rendered += 1;
    let mask = Arc::new(mask);
    cache.put(key, mask.clone(), ink);
    Ok((mask, ink))
}

/// De pixeltak van computePairChanges() voor één paginapaar.
pub fn compare_pair(renderer: &mut Renderer, cache: &mut CompareCache, req: &CompareRequest) -> Result<CompareOutcome> {
    let t_total = Instant::now();
    let px = req.px_per_pt;
    if !(px.is_finite() && px > 0.0) {
        return Err(anyhow!("PDF_INVALID_GEOMETRY: compare resolution"));
    }
    let mut stats = Stats::default();
    let old_size = Size { width: req.old.width_pt, height: req.old.height_pt };
    let new_size = Size { width: req.new.width_pt, height: req.new.height_pt };
    let (old_mask, old_ink) = mask_for(renderer, cache, &req.old, px, req.threshold, &mut stats)?;
    let (new_mask, new_ink) = mask_for(renderer, cache, &req.new, px, req.threshold, &mut stats)?;
    stats.old_ink = old_ink;
    stats.new_ink = new_ink;
    stats.width = new_mask.width;
    stats.height = new_mask.height;

    let mut alignment = normalize(req.alignment.unwrap_or_default());
    let mut align_info = None;
    if let Some(aa) = &req.auto_align {
        let t = Instant::now();
        let r = estimate_alignment(
            &old_mask,
            &new_mask,
            &AlignOptions { px_per_pt: px, old_size, new_size, measure_ratio: aa.measure_ratio, rotation_range: aa.rotation_range },
        );
        stats.align_ms = ms(t);
        alignment = normalize(r.alignment);
        align_info = Some(r);
    }
    if req.skip_detect {
        stats.total_ms = ms(t_total);
        return Ok(CompareOutcome { alignment, align_info, old_px: px, detection: None, stats });
    }

    // Schaalcorrectie: de oude pagina op de schaal waarop hij getoond wordt.
    let mut old_det = old_mask;
    let mut old_px = px;
    if (alignment.scale - 1.0).abs() > 0.02 {
        old_px = px * quant_scale(alignment.scale);
        old_det = mask_for(renderer, cache, &req.old, old_px, req.threshold, &mut stats)?.0;
    }
    let transform = multiply(scaling(px), multiply(alignment_matrix(alignment, old_size, new_size), scaling(1.0 / old_px)));
    let t = Instant::now();
    let params = req.params.unwrap_or_default();
    let detection = detect_mask_changes(&old_det, &new_mask, Some(&transform), &params);
    stats.detect_ms = ms(t);
    stats.total_ms = ms(t_total);
    Ok(CompareOutcome { alignment, align_info, old_px, detection: Some(detection), stats })
}

/// Waarden per cluster in de binaire uitvoer (f64, little-endian):
/// soort (0 toegevoegd, 1 verwijderd, 2 gewijzigd), x, y, breedte, hoogte,
/// pixelCount, old.x, old.y, old.width, old.height — alles in maskerpixels.
pub const CLUSTER_FIELDS: usize = 10;

pub fn clusters_to_bytes(d: &Detection) -> Vec<u8> {
    let mut out = Vec::with_capacity(d.clusters.len() * CLUSTER_FIELDS * 8);
    for c in &d.clusters {
        for v in [
            c.kind.code(),
            c.x as f64,
            c.y as f64,
            c.width as f64,
            c.height as f64,
            c.pixel_count as f64,
            c.old.x,
            c.old.y,
            c.old.width,
            c.old.height,
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}
