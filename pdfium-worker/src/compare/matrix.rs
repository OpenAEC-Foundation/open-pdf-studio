//! Uitlijning en matrices van Vergelijken: poort van js/compare/alignment.js.
//!
//! Matrices volgen de canvas-conventie [a, b, c, d, e, f]:
//!   x' = a·x + c·y + e,  y' = b·x + d·y + f
//! Een uitlijning {dx, dy (mm), rotation (graden), scale} beeldt een punt van
//! de OUDE pagina af op de NIEUWE, rond de paginamiddens.

use super::jsmath;
use serde::{Deserialize, Serialize};

pub type Matrix = [f64; 6];

pub const IDENTITY: Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
pub const MM_PER_PT: f64 = 25.4 / 72.0;
pub const PT_PER_MM: f64 = 72.0 / 25.4;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Alignment {
    #[serde(default)]
    pub dx: f64,
    #[serde(default)]
    pub dy: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "one")]
    pub scale: f64,
}

fn one() -> f64 {
    1.0
}

impl Default for Alignment {
    fn default() -> Self {
        IDENTITY_ALIGNMENT
    }
}

pub const IDENTITY_ALIGNMENT: Alignment = Alignment { dx: 0.0, dy: 0.0, rotation: 0.0, scale: 1.0 };

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn num(v: f64, d: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        d
    }
}

/// normalizeAlignment
pub fn normalize(a: Alignment) -> Alignment {
    let scale = num(a.scale, 1.0);
    Alignment {
        dx: num(a.dx, 0.0),
        dy: num(a.dy, 0.0),
        rotation: num(a.rotation, 0.0),
        scale: if scale > 0.0 { scale } else { 1.0 },
    }
}

/// alignmentMatrix: oude paginapunten -> nieuwe paginapunten.
pub fn alignment_matrix(align: Alignment, old: Size, new: Size) -> Matrix {
    let Alignment { dx, dy, rotation, scale } = normalize(align);
    let r = (rotation * std::f64::consts::PI) / 180.0;
    let a = scale * jsmath::cos(r);
    let b = scale * jsmath::sin(r);
    let c = -b;
    let d = a;
    let cox = num(old.width, 0.0) / 2.0;
    let coy = num(old.height, 0.0) / 2.0;
    let cnx = num(new.width, 0.0) / 2.0;
    let cny = num(new.height, 0.0) / 2.0;
    let e = cnx + dx * PT_PER_MM - (a * cox + c * coy);
    let f = cny + dy * PT_PER_MM - (b * cox + d * coy);
    [a, b, c, d, e, f]
}

/// matrixToAlignment
pub fn matrix_to_alignment(m: Matrix, old: Size, new: Size) -> Alignment {
    let [a, b, _, _, e, f] = m;
    let scale = jsmath::hypot(a, b);
    let rotation = (jsmath::atan2(b, a) * 180.0) / std::f64::consts::PI;
    let cox = num(old.width, 0.0) / 2.0;
    let coy = num(old.height, 0.0) / 2.0;
    let cnx = num(new.width, 0.0) / 2.0;
    let cny = num(new.height, 0.0) / 2.0;
    let tx = e - cnx + (a * cox - b * coy);
    let ty = f - cny + (b * cox + a * coy);
    Alignment { dx: tx * MM_PER_PT, dy: ty * MM_PER_PT, rotation, scale }
}

/// m1 ∘ m2 (m2 eerst).
pub fn multiply(m1: Matrix, m2: Matrix) -> Matrix {
    let [a1, b1, c1, d1, e1, f1] = m1;
    let [a2, b2, c2, d2, e2, f2] = m2;
    [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    ]
}

pub fn invert(m: Matrix) -> Matrix {
    let [a, b, c, d, e, f] = m;
    let det = a * d - b * c;
    // JS: `if (!det)` vangt 0 én NaN.
    if det == 0.0 || det.is_nan() {
        return IDENTITY;
    }
    let ia = d / det;
    let ib = -b / det;
    let ic = -c / det;
    let id = a / det;
    [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)]
}

#[inline]
pub fn apply_point(m: &Matrix, x: f64, y: f64) -> (f64, f64) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

/// Omhullende van een getransformeerde rechthoek.
pub fn apply_rect(m: &Matrix, r: Rect) -> Rect {
    let pts = [
        apply_point(m, r.x, r.y),
        apply_point(m, r.x + r.width, r.y),
        apply_point(m, r.x, r.y + r.height),
        apply_point(m, r.x + r.width, r.y + r.height),
    ];
    let (mut x1, mut y1, mut x2, mut y2) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for (x, y) in pts {
        if x < x1 {
            x1 = x;
        }
        if y < y1 {
            y1 = y;
        }
        if x > x2 {
            x2 = x;
        }
        if y > y2 {
            y2 = y;
        }
    }
    Rect { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

pub fn scaling(k: f64) -> Matrix {
    [k, 0.0, 0.0, k, 0.0, 0.0]
}

/// Oude maskerpixels -> nieuwe maskerpixels, beide op px_per_pt.
pub fn pixel_matrix(align: Alignment, old: Size, new: Size, px_per_pt: f64) -> Matrix {
    multiply(scaling(px_per_pt), multiply(alignment_matrix(align, old, new), scaling(1.0 / px_per_pt)))
}

pub fn is_identity(m: Option<&Matrix>) -> bool {
    match m {
        None => true,
        Some(m) => {
            (m[0] - 1.0).abs() < 1e-12
                && m[1].abs() < 1e-12
                && m[2].abs() < 1e-12
                && (m[3] - 1.0).abs() < 1e-12
                && m[4].abs() < 1e-9
                && m[5].abs() < 1e-9
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alignment_round_trips_through_its_matrix() {
        let old = Size { width: 1190.55, height: 841.89 };
        let new = Size { width: 842.0, height: 595.0 };
        let a = Alignment { dx: 3.5, dy: -2.0, rotation: 1.25, scale: 0.707 };
        let back = matrix_to_alignment(alignment_matrix(a, old, new), old, new);
        assert!((back.dx - a.dx).abs() < 1e-9);
        assert!((back.dy - a.dy).abs() < 1e-9);
        assert!((back.rotation - a.rotation).abs() < 1e-9);
        assert!((back.scale - a.scale).abs() < 1e-12);
    }

    #[test]
    fn invert_of_a_singular_matrix_is_the_identity() {
        assert_eq!(invert([0.0; 6]), IDENTITY);
        let m = [2.0, 0.5, -0.5, 2.0, 10.0, -4.0];
        let p = multiply(m, invert(m));
        assert!(is_identity(Some(&p)));
    }
}
