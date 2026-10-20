//! Rasterizer: display list → straight RGBA8 bitmap with a transparent
//! background, via `vello_cpu` (the rasterizer Hayro uses, so anti-aliasing
//! of annotations and page content matches).

use std::fmt;

use vello_cpu::color::{AlphaColor, Srgb};
use vello_cpu::kurbo::{Affine, BezPath, Cap, Join, Stroke};
use vello_cpu::peniko::{BlendMode as VBlend, Fill, Mix};
use vello_cpu::{Level, Pixmap, RasterizerSettings, RenderContext, RenderSettings, Resources};

use crate::dl::{
    BlendMode, Color, DisplayList, FillRule, Item, LineCap, LineJoin, Path, PathEl, StrokeStyle,
};

pub const MAX_SIDE: u32 = 16_384;
pub const MAX_PIXELS: u64 = 64 * 1024 * 1024;

/// Target bitmap. `transform` maps page space to pixels, as
/// `[a, b, c, d, e, f]` in the order of `kurbo::Affine::new`.
#[derive(Debug, Clone, PartialEq)]
pub struct RasterTarget {
    pub width: u32,
    pub height: u32,
    pub transform: [f64; 6],
}

/// Straight (not premultiplied) RGBA8, row by row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RgbaImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RasterError {
    EmptyTarget,
    TooLarge { width: u32, height: u32 },
    UnbalancedGroups,
}

impl fmt::Display for RasterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RasterError::EmptyTarget => write!(f, "raster target has zero width or height"),
            RasterError::TooLarge { width, height } => {
                write!(f, "raster target {width}x{height} exceeds {MAX_SIDE} px per side or {MAX_PIXELS} pixels")
            }
            RasterError::UnbalancedGroups => {
                write!(f, "display list has unbalanced PushGroup/PopGroup")
            }
        }
    }
}

impl std::error::Error for RasterError {}

pub fn render(dl: &DisplayList, target: &RasterTarget) -> Result<RgbaImage, RasterError> {
    let (w, h) = (target.width, target.height);
    if w == 0 || h == 0 {
        return Err(RasterError::EmptyTarget);
    }
    if w > MAX_SIDE || h > MAX_SIDE || u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err(RasterError::TooLarge {
            width: w,
            height: h,
        });
    }
    check_groups(dl)?;

    // MAX_SIDE fits in u16.
    let (w16, h16) = (w as u16, h as u16);
    // Single-threaded: annotation layers are small, and the multithreading
    // feature (enabled for page rendering) would otherwise default to all cores.
    let mut ctx = RenderContext::new_with(
        w16,
        h16,
        RenderSettings {
            level: Level::try_detect().unwrap_or(Level::baseline()),
            num_threads: 0,
        },
    );
    ctx.set_transform(Affine::new(target.transform));
    for item in &dl.items {
        match item {
            Item::Fill { path, color, rule } => {
                ctx.set_fill_rule(match rule {
                    FillRule::NonZero => Fill::NonZero,
                    FillRule::EvenOdd => Fill::EvenOdd,
                });
                ctx.set_paint(to_color(*color));
                ctx.fill_path(&to_bez(path));
            }
            Item::Stroke { path, color, style } => {
                ctx.set_stroke(to_stroke(style, path));
                ctx.set_paint(to_color(*color));
                ctx.stroke_path(&to_bez(path));
            }
            Item::PushGroup {
                opacity,
                blend,
                clip,
            } => {
                let clip = clip.as_ref().map(to_bez);
                let mode: VBlend = match blend {
                    BlendMode::Normal => Mix::Normal.into(),
                    BlendMode::Multiply => Mix::Multiply.into(),
                };
                ctx.push_layer(clip.as_ref(), Some(mode), Some(*opacity), None, None);
            }
            Item::PopGroup => ctx.pop_layer(),
        }
    }
    ctx.flush();
    let mut pixmap = Pixmap::new(w16, h16);
    ctx.render_with(
        &mut pixmap,
        &mut Resources::new(),
        RasterizerSettings::default(),
    );
    Ok(RgbaImage {
        width: w,
        height: h,
        data: unpremultiply(pixmap.data_as_u8_slice()),
    })
}

/// Premultiplied RGBA8 → straight RGBA8, rounding to nearest; alpha 0 → all zero.
pub(crate) fn unpremultiply(premul: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(premul.len());
    for p in premul.chunks_exact(4) {
        let a = u32::from(p[3]);
        if a == 0 {
            out.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }
        for &c in &p[..3] {
            out.push(((u32::from(c) * 255 + a / 2) / a).min(255) as u8);
        }
        out.push(p[3]);
    }
    out
}

impl RgbaImage {
    /// Lossless PNG of the straight RGBA data.
    pub fn to_png(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, self.width, self.height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().expect("PNG header to a Vec cannot fail");
        writer
            .write_image_data(&self.data)
            .expect("PNG data to a Vec cannot fail");
        writer.finish().expect("PNG finish to a Vec cannot fail");
        out
    }

    pub fn from_png(bytes: &[u8]) -> Result<RgbaImage, String> {
        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
        let mut buf = vec![0; reader.output_buffer_size().ok_or("PNG too large")?];
        let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
        if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
            return Err(format!(
                "expected 8-bit RGBA PNG, got {:?} {:?}",
                info.color_type, info.bit_depth
            ));
        }
        buf.truncate(info.buffer_size());
        Ok(RgbaImage {
            width: info.width,
            height: info.height,
            data: buf,
        })
    }
}

fn check_groups(dl: &DisplayList) -> Result<(), RasterError> {
    let mut depth: usize = 0;
    for item in &dl.items {
        match item {
            Item::PushGroup { .. } => depth += 1,
            Item::PopGroup => depth = depth.checked_sub(1).ok_or(RasterError::UnbalancedGroups)?,
            _ => {}
        }
    }
    if depth == 0 {
        Ok(())
    } else {
        Err(RasterError::UnbalancedGroups)
    }
}

fn to_color(c: Color) -> AlphaColor<Srgb> {
    AlphaColor::from_rgba8(c.r, c.g, c.b, c.a)
}

fn to_bez(path: &Path) -> BezPath {
    let mut bez = BezPath::new();
    let mut open = false;
    let mut start: Option<(f64, f64)> = None;
    for el in &path.0 {
        // A drawing element without an open subpath starts one at the last
        // subpath start (after Close, as in PDF) or at its own end point.
        let end = match *el {
            PathEl::MoveTo(x, y) | PathEl::LineTo(x, y) | PathEl::QuadTo(_, _, x, y) => (x, y),
            PathEl::CubicTo(_, _, _, _, x, y) => (x, y),
            PathEl::Close => {
                if open {
                    bez.close_path();
                    open = false;
                }
                continue;
            }
        };
        if let PathEl::MoveTo(..) = el {
            bez.move_to(end);
            start = Some(end);
            open = true;
            continue;
        }
        if !open {
            let p = *start.get_or_insert(end);
            bez.move_to(p);
            open = true;
        }
        match *el {
            PathEl::LineTo(x, y) => bez.line_to((x, y)),
            PathEl::QuadTo(x1, y1, x, y) => bez.quad_to((x1, y1), (x, y)),
            PathEl::CubicTo(x1, y1, x2, y2, x, y) => bez.curve_to((x1, y1), (x2, y2), (x, y)),
            PathEl::MoveTo(..) | PathEl::Close => unreachable!(),
        }
    }
    bez
}

/// Upper bound on dash segments per stroke; beyond it the dash is dropped
/// and the stroke is drawn solid, so a degenerate pattern cannot stall rendering.
const MAX_DASH_SEGMENTS: f64 = 100_000.0;

/// The dash pattern if it is usable on `path`: finite, non-negative, a
/// positive period, and not more than `MAX_DASH_SEGMENTS` periods long.
fn usable_dash<'a>(s: &'a StrokeStyle, path: &Path) -> Option<&'a [f64]> {
    let period: f64 = s.dash.iter().sum();
    let valid = !s.dash.is_empty()
        && s.dash.iter().all(|d| d.is_finite() && *d >= 0.0)
        && s.dash_offset.is_finite()
        && period > 0.0;
    (valid && control_length(path) / period <= MAX_DASH_SEGMENTS).then_some(&s.dash[..])
}

/// Length of the control polygon: an upper bound of the path length.
fn control_length(path: &Path) -> f64 {
    fn visit(len: &mut f64, cur: &mut Option<(f64, f64)>, p: (f64, f64)) {
        if let Some(c) = *cur {
            *len += ((p.0 - c.0).powi(2) + (p.1 - c.1).powi(2)).sqrt();
        }
        *cur = Some(p);
    }
    let mut len = 0.0;
    let mut cur: Option<(f64, f64)> = None;
    let mut start: Option<(f64, f64)> = None;
    for el in &path.0 {
        match *el {
            PathEl::MoveTo(x, y) => {
                cur = Some((x, y));
                start = cur;
            }
            PathEl::LineTo(x, y) => visit(&mut len, &mut cur, (x, y)),
            PathEl::QuadTo(x1, y1, x, y) => {
                visit(&mut len, &mut cur, (x1, y1));
                visit(&mut len, &mut cur, (x, y));
            }
            PathEl::CubicTo(x1, y1, x2, y2, x, y) => {
                visit(&mut len, &mut cur, (x1, y1));
                visit(&mut len, &mut cur, (x2, y2));
                visit(&mut len, &mut cur, (x, y));
            }
            PathEl::Close => {
                if let Some(s) = start {
                    visit(&mut len, &mut cur, s);
                }
            }
        }
    }
    len
}

fn to_stroke(s: &StrokeStyle, path: &Path) -> Stroke {
    let cap = match s.cap {
        LineCap::Butt => Cap::Butt,
        LineCap::Round => Cap::Round,
        LineCap::Square => Cap::Square,
    };
    let join = match s.join {
        LineJoin::Miter => Join::Miter,
        LineJoin::Round => Join::Round,
        LineJoin::Bevel => Join::Bevel,
    };
    let stroke = Stroke::new(s.width)
        .with_caps(cap)
        .with_join(join)
        .with_miter_limit(s.miter_limit);
    match usable_dash(s, path) {
        Some(dash) => stroke.with_dashes(s.dash_offset, dash.iter().copied()),
        None => stroke,
    }
}
