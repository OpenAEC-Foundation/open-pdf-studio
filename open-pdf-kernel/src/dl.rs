//! Display list: the one drawing vocabulary for screen rendering and PDF
//! appearance streams. Coordinates are page space (points, top-left origin),
//! the same space as the annotation model.

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathEl {
    MoveTo(f64, f64),
    LineTo(f64, f64),
    QuadTo(f64, f64, f64, f64),
    CubicTo(f64, f64, f64, f64, f64, f64),
    Close,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Path(pub Vec<PathEl>);

impl Path {
    pub fn rect(x: f64, y: f64, w: f64, h: f64) -> Path {
        Path(vec![
            PathEl::MoveTo(x, y),
            PathEl::LineTo(x + w, y),
            PathEl::LineTo(x + w, y + h),
            PathEl::LineTo(x, y + h),
            PathEl::Close,
        ])
    }

    pub fn polyline(points: &[(f64, f64)], closed: bool) -> Path {
        let mut els = Vec::with_capacity(points.len() + 1);
        for (i, &(x, y)) in points.iter().enumerate() {
            els.push(if i == 0 {
                PathEl::MoveTo(x, y)
            } else {
                PathEl::LineTo(x, y)
            });
        }
        if closed && !points.is_empty() {
            els.push(PathEl::Close);
        }
        Path(els)
    }

    /// Bounds of all control points (a superset of the exact curve bounds).
    fn control_bounds(&self) -> Option<Rect> {
        let mut acc: Option<Rect> = None;
        let mut add = |x: f64, y: f64| {
            let p = Rect {
                x0: x,
                y0: y,
                x1: x,
                y1: y,
            };
            acc = Some(acc.map_or(p, |r| r.union(&p)));
        };
        for el in &self.0 {
            match *el {
                PathEl::MoveTo(x, y) | PathEl::LineTo(x, y) => add(x, y),
                PathEl::QuadTo(x1, y1, x, y) => {
                    add(x1, y1);
                    add(x, y);
                }
                PathEl::CubicTo(x1, y1, x2, y2, x, y) => {
                    add(x1, y1);
                    add(x2, y2);
                    add(x, y);
                }
                PathEl::Close => {}
            }
        }
        acc
    }
}

/// Straight (not premultiplied) RGBA color.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillRule {
    NonZero,
    EvenOdd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineCap {
    Butt,
    Round,
    Square,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineJoin {
    Miter,
    Round,
    Bevel,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StrokeStyle {
    pub width: f64,
    pub cap: LineCap,
    pub join: LineJoin,
    pub miter_limit: f64,
    pub dash: Vec<f64>,
    pub dash_offset: f64,
}

impl Default for StrokeStyle {
    fn default() -> Self {
        StrokeStyle {
            width: 1.0,
            cap: LineCap::Butt,
            join: LineJoin::Miter,
            miter_limit: 10.0,
            dash: Vec::new(),
            dash_offset: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlendMode {
    Normal,
    Multiply,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    Fill {
        path: Path,
        color: Color,
        rule: FillRule,
    },
    Stroke {
        path: Path,
        color: Color,
        style: StrokeStyle,
    },
    PushGroup {
        opacity: f32,
        blend: BlendMode,
        clip: Option<Path>,
    },
    PopGroup,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Rect {
    fn union(&self, o: &Rect) -> Rect {
        Rect {
            x0: self.x0.min(o.x0),
            y0: self.y0.min(o.y0),
            x1: self.x1.max(o.x1),
            y1: self.y1.max(o.y1),
        }
    }

    fn intersect(&self, o: &Rect) -> Option<Rect> {
        let r = Rect {
            x0: self.x0.max(o.x0),
            y0: self.y0.max(o.y0),
            x1: self.x1.min(o.x1),
            y1: self.y1.min(o.y1),
        };
        (r.x0 <= r.x1 && r.y0 <= r.y1).then_some(r)
    }

    fn inflate(&self, d: f64) -> Rect {
        Rect {
            x0: self.x0 - d,
            y0: self.y0 - d,
            x1: self.x1 + d,
            y1: self.y1 + d,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DisplayList {
    pub items: Vec<Item>,
}

impl DisplayList {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, item: Item) {
        self.items.push(item);
    }

    /// Page-space bounds of everything drawn, clipped by group clips.
    /// Strokes grow by half their width (times the miter limit for miter joins).
    pub fn bounds(&self) -> Option<Rect> {
        // Each open group contributes its clip; `None` means "unclipped".
        let mut clips: Vec<Option<Rect>> = Vec::new();
        let mut acc: Option<Rect> = None;
        for item in &self.items {
            let drawn = match item {
                Item::Fill { path, .. } => path.control_bounds(),
                Item::Stroke { path, style, .. } => {
                    let half = style.width / 2.0;
                    let join_grow = if style.join == LineJoin::Miter {
                        half * style.miter_limit
                    } else {
                        half
                    };
                    // A square cap's corner lies half·√2 from the endpoint.
                    let cap_grow = if style.cap == LineCap::Square {
                        half * std::f64::consts::SQRT_2
                    } else {
                        half
                    };
                    let grow = join_grow.max(cap_grow);
                    path.control_bounds().map(|r| r.inflate(grow))
                }
                Item::PushGroup { clip, .. } => {
                    clips.push(clip.as_ref().and_then(Path::control_bounds));
                    continue;
                }
                Item::PopGroup => {
                    clips.pop();
                    continue;
                }
            };
            let mut clipped = drawn;
            for c in clips.iter().flatten() {
                clipped = clipped.and_then(|r| r.intersect(c));
            }
            if let Some(r) = clipped {
                acc = Some(acc.map_or(r, |a| a.union(&r)));
            }
        }
        acc
    }
}
