//! Simple annotations drawn on a transparent layer.
//!
//! The first piece of annotation drawing in Rust: line, box, ellipse,
//! polyline, plain ink and highlight, the way `drawAnnotation` in
//! js/annotations/rendering.js draws them in output mode (real line widths,
//! no editing state). The JS side (js/annotations/rust-laag.js) decides which
//! annotations qualify and resolves colours, opacity, line width and the dash
//! pattern; this crate only rasterises. Anything it is not sure about stays
//! with the JS drawing.
//!
//! Coordinates are page points, y down, as in the app's annotation model.
//! `View` maps them to pixels: pixel = (point - offset) * scale.

use serde::Deserialize;
use tiny_skia::{
    Color, FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, Rect, Stroke, StrokeDash, Transform,
};

/// Largest layer, in pixels (a 4K screen at device scale 2 is 33 MP).
pub const MAX_PIXELS: u64 = 40_000_000;
/// Most shapes in one request.
pub const MAX_SHAPES: usize = 200_000;

#[derive(Debug, Deserialize)]
pub struct View {
    pub width: u32,
    pub height: u32,
    /// Pixels per point.
    pub scale: f32,
    /// Page point at the left top pixel.
    #[serde(default)]
    pub offset_x: f32,
    #[serde(default)]
    pub offset_y: f32,
}

/// Stroke of a shape: colour and alpha (0..1), width in points, dash in points.
#[derive(Debug, Deserialize)]
pub struct Line {
    pub rgb: [u8; 3],
    pub alpha: f32,
    pub width: f32,
    #[serde(default)]
    pub dash: Vec<f32>,
}

/// Fill of a shape: colour and alpha (0..1).
#[derive(Debug, Deserialize)]
pub struct Fill {
    pub rgb: [u8; 3],
    pub alpha: f32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Shape {
    /// A straight line with butt caps.
    Line { x1: f32, y1: f32, x2: f32, y2: f32, line: Line },
    /// A rectangle, rotated by `rot` degrees about its centre.
    Box {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        rot: f32,
        #[serde(default)]
        fill: Option<Fill>,
        #[serde(default)]
        line: Option<Line>,
    },
    /// An ellipse in its bounding box, rotated by `rot` degrees about its centre.
    Circle {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        rot: f32,
        #[serde(default)]
        fill: Option<Fill>,
        #[serde(default)]
        line: Option<Line>,
    },
    /// Connected points `[x0, y0, x1, y1, ...]`. `round`: round caps and
    /// joins (ink); otherwise butt caps and mitre joins (polyline).
    Path {
        pts: Vec<f32>,
        #[serde(default)]
        round: bool,
        line: Line,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    /// Width or height zero, too many pixels, or a scale that is not a
    /// positive finite number.
    InvalidView,
    TooManyShapes,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Error::InvalidView => "ANNOT_INVALID_VIEW",
            Error::TooManyShapes => "ANNOT_TOO_MANY_SHAPES",
        })
    }
}

/// The layer as straight (not premultiplied) RGBA, `width * height * 4`
/// bytes, and the number of shapes that were drawn. A shape with a number
/// that is not finite is skipped.
pub fn render(view: &View, shapes: &[Shape]) -> Result<(Vec<u8>, usize), Error> {
    if view.width == 0
        || view.height == 0
        || u64::from(view.width) * u64::from(view.height) > MAX_PIXELS
        || !view.scale.is_finite()
        || view.scale <= 0.0
        || !view.offset_x.is_finite()
        || !view.offset_y.is_finite()
    {
        return Err(Error::InvalidView);
    }
    if shapes.len() > MAX_SHAPES {
        return Err(Error::TooManyShapes);
    }
    let mut pixmap = Pixmap::new(view.width, view.height).ok_or(Error::InvalidView)?;
    let page = Transform::from_row(view.scale, 0.0, 0.0, view.scale, -view.offset_x * view.scale, -view.offset_y * view.scale);
    let mut drawn = 0;
    for shape in shapes {
        if draw(&mut pixmap, page, shape).is_some() {
            drawn += 1;
        }
    }
    let mut rgba = Vec::with_capacity(pixmap.data().len());
    for p in pixmap.pixels() {
        let c = p.demultiply();
        rgba.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    Ok((rgba, drawn))
}

fn paint(rgb: [u8; 3], alpha: f32) -> Option<Paint<'static>> {
    if !alpha.is_finite() {
        return None;
    }
    let mut paint = Paint::default();
    let a = (alpha.clamp(0.0, 1.0) * 255.0).round() as u8;
    paint.set_color(Color::from_rgba8(rgb[0], rgb[1], rgb[2], a));
    paint.anti_alias = true;
    Some(paint)
}

fn stroke(line: &Line, round: bool) -> Option<Stroke> {
    if !line.width.is_finite() || line.width <= 0.0 {
        return None;
    }
    let dash = if line.dash.is_empty() {
        None
    } else {
        // The canvas repeats an odd list to make it even.
        let mut list = line.dash.clone();
        if list.len() % 2 == 1 {
            list.extend_from_within(..);
        }
        Some(StrokeDash::new(list, 0.0)?)
    };
    Some(Stroke {
        width: line.width,
        // The canvas default.
        miter_limit: 10.0,
        line_cap: if round { LineCap::Round } else { LineCap::Butt },
        line_join: if round { LineJoin::Round } else { LineJoin::Miter },
        dash,
    })
}

/// Rotation by `rot` degrees about the centre of the box, on top of `page`.
fn about_centre(page: Transform, x: f32, y: f32, w: f32, h: f32, rot: f32) -> Transform {
    if rot == 0.0 {
        return page;
    }
    page.pre_concat(Transform::from_rotate_at(rot, x + w / 2.0, y + h / 2.0))
}

fn draw(pixmap: &mut Pixmap, page: Transform, shape: &Shape) -> Option<()> {
    match shape {
        Shape::Line { x1, y1, x2, y2, line } => {
            let mut pb = PathBuilder::new();
            pb.move_to(*x1, *y1);
            pb.line_to(*x2, *y2);
            let path = pb.finish()?;
            pixmap.stroke_path(&path, &paint(line.rgb, line.alpha)?, &stroke(line, false)?, page, None);
        }
        Shape::Box { x, y, w, h, rot, fill, line } => {
            // The canvas accepts a negative width or height; a rect is the same area.
            let rect = Rect::from_ltrb(x.min(x + w), y.min(y + h), x.max(x + w), y.max(y + h))?;
            let path = PathBuilder::from_rect(rect);
            let t = about_centre(page, *x, *y, *w, *h, *rot);
            if let Some(f) = fill {
                pixmap.fill_path(&path, &paint(f.rgb, f.alpha)?, FillRule::Winding, t, None);
            }
            if let Some(l) = line {
                pixmap.stroke_path(&path, &paint(l.rgb, l.alpha)?, &stroke(l, false)?, t, None);
            }
        }
        Shape::Circle { x, y, w, h, rot, fill, line } => {
            let rect = Rect::from_ltrb(x.min(x + w), y.min(y + h), x.max(x + w), y.max(y + h))?;
            let path = PathBuilder::from_oval(rect)?;
            let t = about_centre(page, *x, *y, *w, *h, *rot);
            if let Some(f) = fill {
                pixmap.fill_path(&path, &paint(f.rgb, f.alpha)?, FillRule::Winding, t, None);
            }
            if let Some(l) = line {
                pixmap.stroke_path(&path, &paint(l.rgb, l.alpha)?, &stroke(l, false)?, t, None);
            }
        }
        Shape::Path { pts, round, line } => {
            if pts.len() < 4 || pts.len() % 2 == 1 || pts.iter().any(|v| !v.is_finite()) {
                return None;
            }
            let mut pb = PathBuilder::new();
            pb.move_to(pts[0], pts[1]);
            for p in pts[2..].chunks_exact(2) {
                pb.line_to(p[0], p[1]);
            }
            let path = pb.finish()?;
            pixmap.stroke_path(&path, &paint(line.rgb, line.alpha)?, &stroke(line, *round)?, page, None);
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(w: u32, h: u32, scale: f32) -> View {
        View { width: w, height: h, scale, offset_x: 0.0, offset_y: 0.0 }
    }
    fn px(rgba: &[u8], w: u32, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * w + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
    }
    fn shapes(json: &str) -> Vec<Shape> {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn an_empty_layer_is_transparent() {
        let (rgba, drawn) = render(&view(8, 6, 1.0), &[]).unwrap();
        assert_eq!(rgba.len(), 8 * 6 * 4);
        assert_eq!(drawn, 0);
        assert!(rgba.iter().all(|&b| b == 0));
    }

    #[test]
    fn a_filled_box_covers_its_inside_and_nothing_else() {
        let s = shapes(r#"[{"t":"box","x":10,"y":10,"w":20,"h":10,"fill":{"rgb":[255,0,0],"alpha":1}}]"#);
        let (rgba, drawn) = render(&view(40, 30, 1.0), &s).unwrap();
        assert_eq!(drawn, 1);
        assert_eq!(px(&rgba, 40, 15, 15), [255, 0, 0, 255]);
        assert_eq!(px(&rgba, 40, 29, 19), [255, 0, 0, 255]);
        assert_eq!(px(&rgba, 40, 5, 15), [0, 0, 0, 0]);
        assert_eq!(px(&rgba, 40, 31, 15), [0, 0, 0, 0]);
    }

    #[test]
    fn the_colour_comes_back_straight_not_premultiplied() {
        let s = shapes(r#"[{"t":"box","x":0,"y":0,"w":10,"h":10,"fill":{"rgb":[200,100,50],"alpha":0.5}}]"#);
        let (rgba, _) = render(&view(10, 10, 1.0), &s).unwrap();
        let p = px(&rgba, 10, 5, 5);
        assert!((i32::from(p[3]) - 128).abs() <= 1, "alpha {}", p[3]);
        assert!((i32::from(p[0]) - 200).abs() <= 2 && (i32::from(p[1]) - 100).abs() <= 2 && (i32::from(p[2]) - 50).abs() <= 2, "{p:?}");
    }

    #[test]
    fn scale_and_offset_place_the_page_on_the_layer() {
        // Point (60, 40) is pixel ((60 - 50) * 2, (40 - 30) * 2) = (20, 20).
        let s = shapes(r#"[{"t":"box","x":60,"y":40,"w":5,"h":5,"fill":{"rgb":[0,0,255],"alpha":1}}]"#);
        let v = View { width: 60, height: 60, scale: 2.0, offset_x: 50.0, offset_y: 30.0 };
        let (rgba, _) = render(&v, &s).unwrap();
        assert_eq!(px(&rgba, 60, 25, 25), [0, 0, 255, 255]);
        assert_eq!(px(&rgba, 60, 18, 25), [0, 0, 0, 0]);
        assert_eq!(px(&rgba, 60, 31, 25), [0, 0, 0, 0]);
    }

    #[test]
    fn a_line_has_its_width_and_butt_caps() {
        let s = shapes(r#"[{"t":"line","x1":10,"y1":20,"x2":30,"y2":20,"line":{"rgb":[0,0,0],"alpha":1,"width":4}}]"#);
        let (rgba, _) = render(&view(40, 40, 1.0), &s).unwrap();
        assert_eq!(px(&rgba, 40, 20, 18)[3], 255);
        assert_eq!(px(&rgba, 40, 20, 21)[3], 255);
        assert_eq!(px(&rgba, 40, 20, 16)[3], 0);
        assert_eq!(px(&rgba, 40, 20, 23)[3], 0);
        // Butt cap: nothing before the start or after the end.
        assert_eq!(px(&rgba, 40, 8, 20)[3], 0);
        assert_eq!(px(&rgba, 40, 31, 20)[3], 0);
    }

    #[test]
    fn a_dash_leaves_gaps_and_an_odd_list_repeats() {
        let s = shapes(r#"[{"t":"line","x1":0,"y1":5,"x2":40,"y2":5,"line":{"rgb":[0,0,0],"alpha":1,"width":2,"dash":[4]}}]"#);
        let (rgba, drawn) = render(&view(40, 10, 1.0), &s).unwrap();
        assert_eq!(drawn, 1);
        assert_eq!(px(&rgba, 40, 1, 5)[3], 255);
        assert_eq!(px(&rgba, 40, 5, 5)[3], 0);
        assert_eq!(px(&rgba, 40, 9, 5)[3], 255);
    }

    #[test]
    fn an_ellipse_fills_its_centre_not_the_corners_of_its_box() {
        let s = shapes(r#"[{"t":"circle","x":10,"y":10,"w":40,"h":20,"fill":{"rgb":[0,255,0],"alpha":1}}]"#);
        let (rgba, _) = render(&view(60, 40, 1.0), &s).unwrap();
        assert_eq!(px(&rgba, 60, 30, 20), [0, 255, 0, 255]);
        assert_eq!(px(&rgba, 60, 11, 11)[3], 0);
        assert_eq!(px(&rgba, 60, 48, 28)[3], 0);
    }

    #[test]
    fn a_box_rotates_about_its_centre() {
        // 40 x 10 around (30, 30), turned a quarter: 10 x 40.
        let s = shapes(r#"[{"t":"box","x":10,"y":25,"w":40,"h":10,"rot":90,"fill":{"rgb":[9,9,9],"alpha":1}}]"#);
        let (rgba, _) = render(&view(60, 60, 1.0), &s).unwrap();
        assert_eq!(px(&rgba, 60, 30, 12)[3], 255);
        assert_eq!(px(&rgba, 60, 30, 47)[3], 255);
        assert_eq!(px(&rgba, 60, 12, 30)[3], 0);
        assert_eq!(px(&rgba, 60, 47, 30)[3], 0);
    }

    #[test]
    fn a_path_connects_its_points_and_ink_has_round_ends() {
        let butt = shapes(r#"[{"t":"path","pts":[10,10,30,10,30,30],"line":{"rgb":[0,0,0],"alpha":1,"width":6}}]"#);
        let (rgba, _) = render(&view(40, 40, 1.0), &butt).unwrap();
        assert_eq!(px(&rgba, 40, 20, 10)[3], 255);
        assert_eq!(px(&rgba, 40, 30, 20)[3], 255);
        assert_eq!(px(&rgba, 40, 8, 10)[3], 0, "butt cap");
        let round = shapes(r#"[{"t":"path","round":true,"pts":[10,10,30,10,30,30],"line":{"rgb":[0,0,0],"alpha":1,"width":6}}]"#);
        let (rgba, _) = render(&view(40, 40, 1.0), &round).unwrap();
        assert_eq!(px(&rgba, 40, 8, 10)[3], 255, "round cap");
    }

    #[test]
    fn a_broken_shape_is_skipped_and_the_rest_is_drawn() {
        let s = shapes(
            r#"[{"t":"path","pts":[1,2,3],"line":{"rgb":[0,0,0],"alpha":1,"width":1}},
                {"t":"line","x1":0,"y1":0,"x2":5,"y2":5,"line":{"rgb":[0,0,0],"alpha":1,"width":0}},
                {"t":"box","x":2,"y":2,"w":4,"h":4,"fill":{"rgb":[1,2,3],"alpha":1}}]"#,
        );
        let (rgba, drawn) = render(&view(10, 10, 1.0), &s).unwrap();
        assert_eq!(drawn, 1);
        assert_eq!(px(&rgba, 10, 4, 4), [1, 2, 3, 255]);
    }

    #[test]
    fn a_view_that_cannot_be_drawn_is_an_error() {
        assert_eq!(render(&view(0, 10, 1.0), &[]).unwrap_err(), Error::InvalidView);
        assert_eq!(render(&view(10, 10, 0.0), &[]).unwrap_err(), Error::InvalidView);
        assert_eq!(render(&view(10, 10, f32::NAN), &[]).unwrap_err(), Error::InvalidView);
        assert_eq!(render(&view(10_000, 10_000, 1.0), &[]).unwrap_err(), Error::InvalidView);
    }
}
