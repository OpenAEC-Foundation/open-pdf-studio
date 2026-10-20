//! Page rendering with Hayro (pure Rust), following the conventions of the
//! app's PDFium route so both engines are interchangeable:
//! opaque white RGBA, bitmap size `ceil(w_pt * scale)` × `ceil(h_pt * scale)`,
//! regions in display points (after /Rotate) with a top-left origin, and an
//! extra whole-page rotation of 0/90/180/270 degrees clockwise.
//!
//! Annotations are not drawn: the app draws them itself. Form widgets are
//! annotations too, so they are not drawn either (PDFium draws form data).

use std::collections::HashSet;
use std::f64::consts::FRAC_PI_2;
use std::fmt;
use std::sync::Arc;

use hayro::hayro_interpret::util::TransformExt;
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::object::{Array, Dict, Name, ObjectIdentifier, Stream};
use hayro::hayro_syntax::Pdf;
use hayro::{render_into, RenderCache, RenderSettings};
use vello_cpu::color::palette::css::WHITE;
use vello_cpu::kurbo::Affine;
use vello_cpu::{
    Level, Pixmap, RasterizerSettings, RenderContext, RenderSettings as VelloSettings, Resources,
    TargetInit,
};

use crate::raster::{unpremultiply, RgbaImage, MAX_PIXELS, MAX_SIDE};

#[derive(Debug, Clone, PartialEq)]
pub enum RenderError {
    Open(String),
    PageOutOfRange(u32),
    BadRotation(i32),
    BadScale(f32),
    EmptyRegion,
    TooLarge {
        width: u32,
        height: u32,
    },
    /// The page would exhaust memory or take minutes with Hayro; render it
    /// with PDFium instead. Displayed with the `HAYRO_UNSUPPORTED` prefix,
    /// which the app recognises.
    Unsupported(String),
}

impl fmt::Display for RenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RenderError::Open(e) => write!(f, "Hayro could not open the PDF: {e}"),
            RenderError::PageOutOfRange(p) => write!(f, "page index {p} is out of range"),
            RenderError::BadRotation(r) => write!(f, "rotation {r} is not 0, 90, 180 or 270"),
            RenderError::BadScale(s) => write!(f, "scale {s} is not a positive number"),
            RenderError::EmptyRegion => write!(f, "render region is empty"),
            RenderError::TooLarge { width, height } => {
                write!(f, "bitmap {width}x{height} exceeds the size limit")
            }
            RenderError::Unsupported(why) => write!(f, "HAYRO_UNSUPPORTED: {why}"),
        }
    }
}

impl std::error::Error for RenderError {}

self_cell::self_cell!(
    /// The parsed document plus Hayro's render cache (fonts, glyph outlines,
    /// colour spaces), which borrows from it and is reused for every render
    /// of this document.
    struct PdfWithCache {
        owner: Pdf,
        #[not_covariant]
        dependent: RenderCache,
    }
);

pub struct HayroDocument {
    inner: PdfWithCache,
    settings: InterpreterSettings,
    threads: u16,
}

impl HayroDocument {
    pub fn open(bytes: Arc<Vec<u8>>) -> Result<HayroDocument, RenderError> {
        let pdf = Pdf::new(bytes).map_err(|e| RenderError::Open(format!("{e:?}")))?;
        let settings = InterpreterSettings {
            render_annotations: false,
            ..InterpreterSettings::default()
        };
        Ok(HayroDocument {
            inner: PdfWithCache::new(pdf, |_| RenderCache::new()),
            settings,
            threads: 0,
        })
    }

    /// Rasterize with `threads` extra worker threads (0 = on the calling
    /// thread only).
    pub fn with_threads(mut self, threads: u16) -> HayroDocument {
        self.threads = threads;
        self
    }

    pub fn page_count(&self) -> u32 {
        self.inner.borrow_owner().pages().len() as u32
    }

    /// Display size in points, after /Rotate and the crop box.
    pub fn page_size(&self, page_index: u32) -> Result<(f32, f32), RenderError> {
        let pages = self.inner.borrow_owner().pages();
        let page = pages
            .get(page_index as usize)
            .ok_or(RenderError::PageOutOfRange(page_index))?;
        Ok(page.render_dimensions())
    }

    /// How much vector work the page asks for: the raw (compressed) bytes
    /// of its content streams plus those of every form XObject it can draw,
    /// followed recursively and counted once. Images are left out: both
    /// engines decode them at about the same cost.
    pub fn page_weight(&self, page_index: u32) -> Result<u64, RenderError> {
        let pages = self.inner.borrow_owner().pages();
        let page = pages
            .get(page_index as usize)
            .ok_or(RenderError::PageOutOfRange(page_index))?;
        let raw = page.raw();
        let mut total: u64 = 0;
        if let Some(content) = raw.get::<Stream<'_>>(b"Contents".as_slice()) {
            total += content.raw_data().len() as u64;
        } else if let Some(parts) = raw.get::<Array<'_>>(b"Contents".as_slice()) {
            for part in parts.iter::<Stream<'_>>() {
                total += part.raw_data().len() as u64;
            }
        }
        let mut seen = HashSet::new();
        total += form_weight(&page.resources().x_objects, 0, &mut seen);
        Ok(total)
    }

    pub fn render_page(
        &self,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<RgbaImage, RenderError> {
        check_scale(scale)?;
        let quarter_turns = match rotation.rem_euclid(360) {
            r if r % 90 == 0 && rotation.abs() < 360 => r / 90,
            _ => return Err(RenderError::BadRotation(rotation)),
        };
        let (w, h) = self.page_size(page_index)?;
        let (ws, hs) = (
            f64::from(w) * f64::from(scale),
            f64::from(h) * f64::from(scale),
        );
        let turn = match quarter_turns {
            0 => Affine::IDENTITY,
            1 => Affine::translate((hs, 0.0)) * Affine::rotate(FRAC_PI_2),
            2 => Affine::translate((ws, hs)) * Affine::rotate(2.0 * FRAC_PI_2),
            _ => Affine::translate((0.0, ws)) * Affine::rotate(3.0 * FRAC_PI_2),
        };
        let (bw, bh) = if quarter_turns % 2 == 1 {
            (hs, ws)
        } else {
            (ws, hs)
        };
        self.render_with(
            page_index,
            bitmap_side(bw)?,
            bitmap_side(bh)?,
            turn * Affine::scale(f64::from(scale)),
        )
    }

    /// Render the rectangle (`x_pt`, `y_pt`, `w_pt`, `h_pt`) in display points.
    pub fn render_region(
        &self,
        page_index: u32,
        scale: f32,
        x_pt: f32,
        y_pt: f32,
        w_pt: f32,
        h_pt: f32,
    ) -> Result<RgbaImage, RenderError> {
        check_scale(scale)?;
        let valid = |v: f32| v.is_finite() && v > 0.0;
        if !valid(w_pt) || !valid(h_pt) || !x_pt.is_finite() || !y_pt.is_finite() {
            return Err(RenderError::EmptyRegion);
        }
        self.page_size(page_index)?;
        let s = f64::from(scale);
        self.render_with(
            page_index,
            bitmap_side(f64::from(w_pt) * s)?,
            bitmap_side(f64::from(h_pt) * s)?,
            Affine::translate((-f64::from(x_pt) * s, -f64::from(y_pt) * s)) * Affine::scale(s),
        )
    }

    /// Render with `view` mapping display points (top-left origin) to pixels.
    fn render_with(
        &self,
        page_index: u32,
        width: u32,
        height: u32,
        view: Affine,
    ) -> Result<RgbaImage, RenderError> {
        if width > MAX_SIDE
            || height > MAX_SIDE
            || u64::from(width) * u64::from(height) > MAX_PIXELS
        {
            return Err(RenderError::TooLarge { width, height });
        }
        // MAX_SIDE fits in u16.
        let (w16, h16) = (width as u16, height as u16);
        let mut ctx = RenderContext::new_with(
            w16,
            h16,
            VelloSettings {
                level: Level::try_detect().unwrap_or(Level::baseline()),
                num_threads: self.threads,
            },
        );
        self.inner.with_dependent(|pdf, cache| {
            let pages = pdf.pages();
            let page = pages
                .get(page_index as usize)
                .ok_or(RenderError::PageOutOfRange(page_index))?;
            check_sampled_shadings(page, width, height)?;
            let transform = view * page.initial_transform(true).to_kurbo();
            render_into(
                page,
                cache,
                &self.settings,
                &RenderSettings::default(),
                &mut ctx,
                transform,
            );
            Ok::<(), RenderError>(())
        })?;
        ctx.flush();
        let mut pixmap = Pixmap::new(w16, h16);
        ctx.render_with(
            &mut pixmap,
            &mut Resources::new(),
            RasterizerSettings {
                target_init: TargetInit::Clear(WHITE),
                ..RasterizerSettings::default()
            },
        );
        Ok(RgbaImage {
            width,
            height,
            data: unpremultiply(pixmap.data_as_u8_slice()),
        })
    }
}

/// Hayro samples every shading that is not an axial or radial gradient
/// (function and mesh shadings, types 1 and 4-7) into a texture as large as
/// the filled area, and keeps all of them until the page is rasterized. A
/// technical drawing with hundreds of mesh fills then needs many gigabytes
/// and minutes (measured: 576 meshes, 14.8 GB at 100 %).
const MAX_SAMPLED_SHADINGS: usize = 64;
/// Upper bound for those textures in one render, assuming each covers the
/// whole bitmap (RGBA8).
const SAMPLED_SHADING_BUDGET: u64 = 1 << 30;

fn check_sampled_shadings(
    page: &hayro::hayro_syntax::page::Page<'_>,
    width: u32,
    height: u32,
) -> Result<(), RenderError> {
    let mut seen = Seen::default();
    count_sampled_shadings(
        &page.resources().patterns,
        &page.resources().shadings,
        &page.resources().x_objects,
        0,
        &mut seen,
    );
    let count = seen.ids.len() + seen.inline;
    if count > MAX_SAMPLED_SHADINGS {
        return Err(RenderError::Unsupported(format!(
            "page uses {count} mesh or function shadings (limit {MAX_SAMPLED_SHADINGS})"
        )));
    }
    let bytes = count as u64 * u64::from(width) * u64::from(height) * 4;
    if bytes > SAMPLED_SHADING_BUDGET {
        return Err(RenderError::Unsupported(format!(
            "{count} mesh or function shadings need up to {} MiB of textures at this size",
            bytes >> 20
        )));
    }
    Ok(())
}

/// Distinct sampled shadings: by object id, plus inline (direct) ones.
#[derive(Default)]
struct Seen {
    ids: HashSet<ObjectIdentifier>,
    inline: usize,
}

impl Seen {
    fn add(&mut self, shading: Option<Dict<'_>>) {
        let Some(d) = shading else { return };
        let sampled = d
            .get::<i32>(b"ShadingType".as_slice())
            .is_some_and(|t| t != 2 && t != 3);
        if sampled {
            match d.obj_id() {
                Some(id) => {
                    self.ids.insert(id);
                }
                None => self.inline += 1,
            }
        }
    }
}

/// Collect sampled shadings from pattern and shading resources, following
/// form XObjects up to a fixed depth.
fn count_sampled_shadings(
    patterns: &Dict<'_>,
    shadings: &Dict<'_>,
    x_objects: &Dict<'_>,
    depth: u32,
    seen: &mut Seen,
) {
    for name in patterns.keys() {
        if let Some(pattern) = patterns.get::<Dict<'_>>(name.as_ref()) {
            if pattern.get::<i32>(b"PatternType".as_slice()) == Some(2) {
                seen.add(shading_of(&pattern, b"Shading"));
            }
        }
    }
    for name in shadings.keys() {
        seen.add(shading_of(shadings, name.as_ref()));
    }
    if depth >= 4 {
        return;
    }
    for name in x_objects.keys() {
        let Some(form) = x_objects.get::<Stream<'_>>(name.as_ref()) else {
            continue;
        };
        let Some(res) = form.dict().get::<Dict<'_>>(b"Resources".as_slice()) else {
            continue;
        };
        let sub = |key: &[u8]| res.get::<Dict<'_>>(key).unwrap_or_default();
        count_sampled_shadings(
            &sub(b"Pattern"),
            &sub(b"Shading"),
            &sub(b"XObject"),
            depth + 1,
            seen,
        );
    }
}

/// Raw bytes of the form XObjects in `x_objects`, recursively, each once.
fn form_weight(x_objects: &Dict<'_>, depth: u32, seen: &mut HashSet<ObjectIdentifier>) -> u64 {
    if depth > 8 {
        return 0;
    }
    let mut total = 0;
    for name in x_objects.keys() {
        let Some(form) = x_objects.get::<Stream<'_>>(name.as_ref()) else {
            continue;
        };
        let is_form = form
            .dict()
            .get::<Name<'_>>(b"Subtype".as_slice())
            .is_some_and(|s| s.as_ref() == b"Form");
        if !is_form || !seen.insert(form.obj_id()) {
            continue;
        }
        total += form.raw_data().len() as u64;
        if let Some(res) = form.dict().get::<Dict<'_>>(b"Resources".as_slice()) {
            if let Some(inner) = res.get::<Dict<'_>>(b"XObject".as_slice()) {
                total += form_weight(&inner, depth + 1, seen);
            }
        }
    }
    total
}

/// Workers the app's pool runs side by side (src-tauri, WorkerPool).
const POOL_WORKERS: usize = 4;
/// Measured on the verification set: 4 threads make Hayro as fast as PDFium
/// on light pages and ~2.6x faster on heavy drawings; 8 adds little.
const MAX_RENDER_THREADS: usize = 4;

/// Extra rasterizer threads per pool worker: a fair share of `cores` for each
/// of the pool's workers, at most MAX_RENDER_THREADS.
pub fn default_render_threads(cores: usize) -> u16 {
    (cores / POOL_WORKERS).saturating_sub(1).min(MAX_RENDER_THREADS) as u16
}

/// Threads a worker uses for Hayro: OPDS_HAYRO_THREADS, or the default share
/// of this machine.
pub fn render_threads() -> u16 {
    std::env::var("OPDS_HAYRO_THREADS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| {
            default_render_threads(std::thread::available_parallelism().map_or(1, |n| n.get()))
        })
}

/// A shading resource is a dictionary (types 1-3) or a stream (types 4-7).
fn shading_of<'a>(holder: &Dict<'a>, key: &[u8]) -> Option<Dict<'a>> {
    holder
        .get::<Dict<'a>>(key)
        .or_else(|| holder.get::<Stream<'a>>(key).map(|s| s.dict().clone()))
}

fn check_scale(scale: f32) -> Result<(), RenderError> {
    if scale.is_finite() && scale > 0.0 {
        Ok(())
    } else {
        Err(RenderError::BadScale(scale))
    }
}

/// Bitmap side in pixels: `ceil`, as the PDFium route does, and at least 1.
fn bitmap_side(v: f64) -> Result<u32, RenderError> {
    let side = v.ceil().max(1.0);
    if side > f64::from(MAX_SIDE) {
        return Err(RenderError::TooLarge {
            width: side as u32,
            height: side as u32,
        });
    }
    Ok(side as u32)
}
