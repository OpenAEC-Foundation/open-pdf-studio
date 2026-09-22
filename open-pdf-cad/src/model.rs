//! CAD-neutraal geometriemodel: het ene model waaruit DXF, DWG en later IFC
//! worden geschreven. Coördinaten staan in uitvoereenheden (millimeters),
//! oorsprong linksonder, y omhoog.

use crate::geom::Point;
use crate::page_space::DrawingUnit;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    pub const BLACK: Rgb = Rgb { r: 0, g: 0, b: 0 };

    pub fn hex(&self) -> String {
        format!("{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }
}

/// Lijndikte in honderdsten van een millimeter, beperkt tot de waarden die het
/// DXF/DWG-formaat kent.
pub const VALID_LINEWEIGHTS: [i16; 24] = [
    0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211,
];

/// Dichtstbijzijnde geldige lijndikte voor een breedte in millimeters op papier.
pub fn snap_lineweight(width_mm: f64) -> i16 {
    let target = (width_mm * 100.0).max(0.0);
    let mut best = VALID_LINEWEIGHTS[0];
    let mut best_diff = f64::MAX;
    for &candidate in &VALID_LINEWEIGHTS {
        let diff = (candidate as f64 - target).abs();
        if diff < best_diff {
            best = candidate;
            best_diff = diff;
        }
    }
    best
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Layer {
    pub name: String,
    pub color: Rgb,
    /// Honderdsten van een millimeter.
    pub lineweight: i16,
    /// True als de laag uit een PDF-laag (OCG) komt, false bij een afgeleide
    /// laag op kleur en lijndikte.
    pub from_ocg: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Linetype {
    pub name: String,
    pub description: String,
    /// Afwisselend streep en tussenruimte, in tekeneenheden, beginnend met een
    /// streep; altijd een even aantal.
    pub pattern: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Geometry {
    Line {
        start: Point,
        end: Point,
    },
    Polyline {
        points: Vec<Point>,
        closed: bool,
    },
    /// Keten van kubische Béziers: `3n + 1` stuurpunten. Exact te schrijven als
    /// B-spline van graad 3 met drievoudige knopen op de naden.
    BezierSpline {
        control_points: Vec<Point>,
    },
    /// Effen vulling; elke lus is een gesloten polylijn. Lussen binnen lussen
    /// zijn gaten (oneven-pariteit).
    Hatch {
        loops: Vec<Vec<Point>>,
    },
    /// Maskering: een dekkend vlak in papierkleur, als gesloten omtrek. In CAD
    /// neemt het de achtergrondkleur aan en dekt het af wat eronder ligt —
    /// hetzelfde als wat het witte vlak in de PDF doet.
    Mask {
        outline: Vec<Point>,
    },
    Text {
        insert: Point,
        /// Hoogte van hoofdletters in tekeneenheden.
        height: f64,
        /// Hoek van de basislijn in radialen, tegen de klok in.
        rotation: f64,
        /// Breedte / hoogte van de tekstschaal; 1 bij een uniforme tekstmatrix,
        /// kleiner bij versmalde tekst.
        width_factor: f64,
        value: String,
    },
}

impl Geometry {
    pub fn kind(&self) -> &'static str {
        match self {
            Geometry::Line { .. } => "LINE",
            Geometry::Polyline { .. } => "LWPOLYLINE",
            Geometry::BezierSpline { .. } => "SPLINE",
            Geometry::Hatch { .. } => "HATCH",
            Geometry::Mask { .. } => "WIPEOUT",
            Geometry::Text { .. } => "TEXT",
        }
    }

    pub fn for_each_point(&self, mut f: impl FnMut(Point)) {
        match self {
            Geometry::Line { start, end } => {
                f(*start);
                f(*end);
            }
            Geometry::Polyline { points, .. } => points.iter().copied().for_each(f),
            Geometry::BezierSpline { control_points } => control_points.iter().copied().for_each(f),
            Geometry::Hatch { loops } => loops.iter().flatten().copied().for_each(f),
            Geometry::Mask { outline } => outline.iter().copied().for_each(f),
            Geometry::Text { insert, .. } => f(*insert),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entity {
    /// Index in [`Drawing::layers`].
    pub layer: u32,
    /// `None` = kleur van de laag.
    pub color: Option<Rgb>,
    /// `None` = lijndikte van de laag.
    pub lineweight: Option<i16>,
    /// Index in [`Drawing::linetypes`]; `None` = doorgetrokken.
    pub linetype: Option<u32>,
    pub geometry: Geometry,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Drawing {
    pub layers: Vec<Layer>,
    pub linetypes: Vec<Linetype>,
    pub entities: Vec<Entity>,
    /// Breedte en hoogte van de weergegeven pagina in tekeneenheden (bij de
    /// oorsprong van het model: in modeleenheden, op de schaal van de tekening).
    pub page_size: (f64, f64),
    /// Omhullende van alle geometrie; `None` bij een lege tekening.
    pub extents: Option<(Point, Point)>,
    /// Tekeneenheid van alle coördinaten.
    pub units: DrawingUnit,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lineweight_snaps_to_nearest_valid_value() {
        assert_eq!(snap_lineweight(0.0), 0);
        assert_eq!(snap_lineweight(0.25), 25);
        assert_eq!(snap_lineweight(0.26), 25);
        assert_eq!(snap_lineweight(0.28), 30);
        assert_eq!(snap_lineweight(0.18), 18);
        assert_eq!(snap_lineweight(5.0), 211);
        assert_eq!(snap_lineweight(-1.0), 0);
    }
}
