//! Annotation model: a lossless mirror of the JavaScript annotation object
//! (`open-pdf-studio/js/types/annotation.ts`).
//!
//! The raw JSON object is the source of truth and is written back unchanged:
//! `null` values, extra keys on points (`arc`, `bulge`), mistyped values and
//! unknown fields all survive. The kernel reads it through typed accessors
//! that return `None` for an absent, `null` or mistyped value, so one bad
//! field never rejects the page. Key order is not preserved; JavaScript does
//! not depend on it.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A point read from the model. `bulge` is set for an arc vertex
/// (`{"arc": true, "bulge": b}`), the way the JavaScript side stores arcs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub bulge: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Annotation {
    pub raw: Map<String, Value>,
}

impl Annotation {
    pub fn id(&self) -> Option<&str> {
        self.str("id")
    }

    pub fn type_name(&self) -> Option<&str> {
        self.str("type")
    }

    pub fn kind(&self) -> Kind {
        self.type_name().map_or(Kind::Unknown, Kind::from_type)
    }

    /// Page number; `None` unless it is a non-negative integer.
    pub fn page(&self) -> Option<u32> {
        self.raw.get("page")?.as_u64()?.try_into().ok()
    }

    /// A finite number; `None` for anything else.
    pub fn f64(&self, key: &str) -> Option<f64> {
        finite(self.raw.get(key)?)
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.raw.get(key)?.as_str()
    }

    pub fn bool(&self, key: &str) -> Option<bool> {
        self.raw.get(key)?.as_bool()
    }

    /// A list of points; `None` if the key is absent or any entry lacks a finite `x`/`y`.
    pub fn points(&self, key: &str) -> Option<Vec<Point>> {
        points_of(self.raw.get(key)?)
    }

    /// A list of point lists (such as `holes`); `None` if any ring is invalid.
    pub fn rings(&self, key: &str) -> Option<Vec<Vec<Point>>> {
        self.raw
            .get(key)?
            .as_array()?
            .iter()
            .map(points_of)
            .collect()
    }
}

fn finite(v: &Value) -> Option<f64> {
    v.as_f64().filter(|f| f.is_finite())
}

fn points_of(v: &Value) -> Option<Vec<Point>> {
    v.as_array()?
        .iter()
        .map(|p| {
            let arc = p.get("arc").and_then(Value::as_bool) == Some(true);
            Some(Point {
                x: finite(p.get("x")?)?,
                y: finite(p.get("y")?)?,
                bulge: if arc {
                    p.get("bulge").and_then(finite)
                } else {
                    None
                },
            })
        })
        .collect()
}

macro_rules! kinds {
    ($( $variant:ident => $name:literal ),* $(,)?) => {
        /// Annotation type as a closed set; `Unknown` covers plugin types.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum Kind {
            $( $variant, )*
            Unknown,
        }

        impl Kind {
            pub fn from_type(name: &str) -> Kind {
                match name {
                    $( $name => Kind::$variant, )*
                    _ => Kind::Unknown,
                }
            }
        }
    };
}

kinds! {
    Highlight => "highlight",
    TextHighlight => "textHighlight",
    TextStrikethrough => "textStrikethrough",
    TextUnderline => "textUnderline",
    TextSquiggly => "textSquiggly",
    Caret => "caret",
    Draw => "draw",
    Line => "line",
    Arrow => "arrow",
    Box => "box",
    Circle => "circle",
    Textbox => "textbox",
    Callout => "callout",
    Comment => "comment",
    Stamp => "stamp",
    Image => "image",
    Signature => "signature",
    Polygon => "polygon",
    Cloud => "cloud",
    CloudPolyline => "cloudPolyline",
    Polyline => "polyline",
    Text => "text",
    Arc => "arc",
    Spline => "spline",
    SplineArrow => "splineArrow",
    Redaction => "redaction",
    MeasureDistance => "measureDistance",
    MeasureArea => "measureArea",
    MeasurePerimeter => "measurePerimeter",
    MeasureAngle => "measureAngle",
    FilledArea => "filledArea",
    Mask => "mask",
    Viewport => "viewport",
    ScheduleTable => "scheduleTable",
    ScaleBar => "scaleBar",
    ScaleRegion => "scaleRegion",
    ParametricSymbol => "parametricSymbol",
    Stavenreeks => "stavenreeks",
    Betonbalk => "betonbalk",
    Systeemraster => "systeemraster",
}

pub fn annotations_from_json(s: &str) -> Result<Vec<Annotation>, serde_json::Error> {
    serde_json::from_str(s)
}

pub fn annotations_to_json(a: &[Annotation]) -> Result<String, serde_json::Error> {
    serde_json::to_string(a)
}
