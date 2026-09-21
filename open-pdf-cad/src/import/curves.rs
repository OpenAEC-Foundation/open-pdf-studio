//! Ruimtelijke afbeeldingen en krommen voor de import (#400).
//!
//! Een tekening leeft in 3D: 2D-entiteiten (boog, cirkel, polylijn, tekst,
//! arcering) liggen in hun eigen vlak (OCS, "arbitrary axis"), blokken worden
//! met een 3D-afbeelding ingevoegd. De import projecteert alles loodrecht op
//! het XY-vlak (bovenaanzicht). Omdat elke stap affien is, blijven Bézier-
//! krommen Bézier-krommen: bogen en ellipsen worden ná de afbeelding in
//! paginaruimte opgebouwd, dus ook een schuin ingevoegd blok of een gespiegelde
//! OCS geeft de juiste ellips.

use crate::geom::Point;
use std::f64::consts::{FRAC_PI_2, TAU};

/// Affiene 3D-afbeelding als 3×4-matrix: `p' = M·p + t`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Xform3 {
    pub m: [[f64; 4]; 3],
}

impl Xform3 {
    pub const IDENTITY: Xform3 = Xform3 { m: [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]] };

    pub fn translate(x: f64, y: f64, z: f64) -> Self {
        let mut t = Self::IDENTITY;
        t.m[0][3] = x;
        t.m[1][3] = y;
        t.m[2][3] = z;
        t
    }

    pub fn scale(x: f64, y: f64, z: f64) -> Self {
        Xform3 { m: [[x, 0.0, 0.0, 0.0], [0.0, y, 0.0, 0.0], [0.0, 0.0, z, 0.0]] }
    }

    pub fn rotate_z(angle: f64) -> Self {
        let (s, c) = angle.sin_cos();
        Xform3 { m: [[c, -s, 0.0, 0.0], [s, c, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]] }
    }

    /// 2D-matrix (PDF-notatie) als 3D-afbeelding met z ongemoeid.
    pub fn from_matrix(m: &crate::geom::Matrix) -> Self {
        Xform3 { m: [[m.a, m.c, 0.0, m.e], [m.b, m.d, 0.0, m.f], [0.0, 0.0, 1.0, 0.0]] }
    }

    /// OCS → WCS volgens het "arbitrary axis"-algoritme.
    pub fn ocs(normal: [f64; 3]) -> Self {
        let n = normalize(normal).unwrap_or([0.0, 0.0, 1.0]);
        if n[0].abs() < 1e-12 && n[1].abs() < 1e-12 && n[2] > 0.0 {
            return Self::IDENTITY;
        }
        let ax = if n[0].abs() < 1.0 / 64.0 && n[1].abs() < 1.0 / 64.0 {
            cross([0.0, 1.0, 0.0], n)
        } else {
            cross([0.0, 0.0, 1.0], n)
        };
        let ax = normalize(ax).unwrap_or([1.0, 0.0, 0.0]);
        let ay = normalize(cross(n, ax)).unwrap_or([0.0, 1.0, 0.0]);
        Xform3 { m: [[ax[0], ay[0], n[0], 0.0], [ax[1], ay[1], n[1], 0.0], [ax[2], ay[2], n[2], 0.0]] }
    }

    /// Eerst `self`, dan `next`.
    pub fn then(&self, next: &Xform3) -> Xform3 {
        let a = &next.m;
        let b = &self.m;
        let mut m = [[0.0; 4]; 3];
        for r in 0..3 {
            for c in 0..4 {
                let mut v = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
                if c == 3 {
                    v += a[r][3];
                }
                m[r][c] = v;
            }
        }
        Xform3 { m }
    }

    pub fn apply(&self, p: [f64; 3]) -> [f64; 3] {
        let m = &self.m;
        [
            m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
            m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
            m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
        ]
    }

    /// Punt → paginapunt (projectie op XY).
    pub fn point(&self, p: [f64; 3]) -> Point {
        let m = &self.m;
        Point::new(
            m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
            m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
        )
    }

    /// Richting (zonder verschuiving) → paginavector.
    pub fn vector(&self, v: [f64; 3]) -> Point {
        let m = &self.m;
        Point::new(
            m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        )
    }

    /// De 2D-afbeelding van het vlak `z = elevation` van deze ruimte naar de
    /// pagina, als PDF-matrix.
    pub fn plane(&self, elevation: f64) -> crate::geom::Matrix {
        let m = &self.m;
        crate::geom::Matrix::new(
            m[0][0],
            m[1][0],
            m[0][1],
            m[1][1],
            m[0][2] * elevation + m[0][3],
            m[1][2] * elevation + m[1][3],
        )
    }

    /// Gemiddelde lineaire schaal in het XY-vlak (voor lijntypen en toleranties).
    pub fn xy_scale(&self) -> f64 {
        let det = self.m[0][0] * self.m[1][1] - self.m[0][1] * self.m[1][0];
        let s = det.abs().sqrt();
        if s > 0.0 && s.is_finite() {
            s
        } else {
            // Volledig gekanteld vlak: val terug op de langste as.
            self.vector([1.0, 0.0, 0.0]).distance(Point::new(0.0, 0.0)).max(self.vector([0.0, 1.0, 0.0]).distance(Point::new(0.0, 0.0)))
        }
    }
}

pub fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

pub fn normalize(v: [f64; 3]) -> Option<[f64; 3]> {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    (len > 1e-12 && len.is_finite()).then(|| [v[0] / len, v[1] / len, v[2] / len])
}

/// Padopdrachten in paginaruimte.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PathOp {
    Move(Point),
    Line(Point),
    Cubic(Point, Point, Point),
    Close,
}

/// Een pad in paginapunten.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PagePath {
    pub ops: Vec<PathOp>,
}

impl PagePath {
    pub fn new() -> Self {
        PagePath { ops: Vec::new() }
    }

    pub fn clear(&mut self) {
        self.ops.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }

    pub fn move_to(&mut self, p: Point) {
        self.ops.push(PathOp::Move(p));
    }

    pub fn line_to(&mut self, p: Point) {
        self.ops.push(PathOp::Line(p));
    }

    pub fn cubic_to(&mut self, c1: Point, c2: Point, p: Point) {
        self.ops.push(PathOp::Cubic(c1, c2, p));
    }

    pub fn close(&mut self) {
        self.ops.push(PathOp::Close);
    }

    /// Laatste punt van het pad.
    pub fn current(&self) -> Option<Point> {
        match self.ops.last()? {
            PathOp::Move(p) | PathOp::Line(p) | PathOp::Cubic(_, _, p) => Some(*p),
            // Na sluiten staat het punt op het begin van het deelpad.
            PathOp::Close => self.ops.iter().rev().find_map(|op| if let PathOp::Move(p) = op { Some(*p) } else { None }),
        }
    }

    /// Omhullende van alle punten (inclusief Bézier-steunpunten, dus ruim).
    pub fn bounds(&self) -> Option<[f64; 4]> {
        let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        let mut add = |p: &Point| {
            b[0] = b[0].min(p.x);
            b[1] = b[1].min(p.y);
            b[2] = b[2].max(p.x);
            b[3] = b[3].max(p.y);
        };
        for op in &self.ops {
            match op {
                PathOp::Move(p) | PathOp::Line(p) => add(p),
                PathOp::Cubic(a, c, p) => {
                    add(a);
                    add(c);
                    add(p);
                }
                PathOp::Close => {}
            }
        }
        (b[0] <= b[2] && b[1] <= b[3] && b.iter().all(|v| v.is_finite())).then_some(b)
    }

    /// Alle coördinaten eindig.
    pub fn is_finite(&self) -> bool {
        self.ops.iter().all(|op| match op {
            PathOp::Move(p) | PathOp::Line(p) => p.x.is_finite() && p.y.is_finite(),
            PathOp::Cubic(a, b, p) => [a, b, p].iter().all(|q| q.x.is_finite() && q.y.is_finite()),
            PathOp::Close => true,
        })
    }
}

/// Voegt een ellipsboog toe: `p(t) = c + u·cos t + v·sin t` voor `t0 → t1`
/// (beide richtingen toegestaan). `u` en `v` zijn al paginavectoren, dus de
/// boog is exact onder elke affiene afbeelding. Met `start` begint een nieuw
/// deelpad, anders loopt de lijn door vanaf het huidige punt.
pub fn add_elliptic_arc(path: &mut PagePath, c: Point, u: Point, v: Point, t0: f64, t1: f64, start: bool) {
    let sweep = t1 - t0;
    let at = |t: f64| Point::new(c.x + u.x * t.cos() + v.x * t.sin(), c.y + u.y * t.cos() + v.y * t.sin());
    let tangent = |t: f64| Point::new(-u.x * t.sin() + v.x * t.cos(), -u.y * t.sin() + v.y * t.cos());
    let p0 = at(t0);
    if start {
        path.move_to(p0);
    } else {
        path.line_to(p0);
    }
    if sweep.abs() < 1e-12 {
        return;
    }
    let n = ((sweep.abs() / FRAC_PI_2).ceil() as usize).clamp(1, 64);
    let step = sweep / n as f64;
    let k = 4.0 / 3.0 * (step / 4.0).tan();
    for i in 0..n {
        let a = t0 + step * i as f64;
        let b = if i + 1 == n { t1 } else { a + step };
        let (pa, pb) = (at(a), at(b));
        let (ta, tb) = (tangent(a), tangent(b));
        path.cubic_to(
            Point::new(pa.x + k * ta.x, pa.y + k * ta.y),
            Point::new(pb.x - k * tb.x, pb.y - k * tb.y),
            pb,
        );
    }
}

/// Hoekbereik van een boog tegen de klok in: `end` ligt na `start`, hooguit
/// een volle cirkel verder.
pub fn ccw_sweep(start: f64, end: f64) -> (f64, f64) {
    let mut e = end;
    while e <= start + 1e-12 {
        e += TAU;
    }
    while e - start > TAU + 1e-12 {
        e -= TAU;
    }
    (start, e)
}

/// Bulge-segment van `a` naar `b` in een vlak (lokale 2D-coördinaten):
/// geeft middelpunt, straal, beginhoek en eindhoek (met teken: negatieve
/// bulge = met de klok mee).
pub fn bulge_arc(a: (f64, f64), b: (f64, f64), bulge: f64) -> Option<((f64, f64), f64, f64, f64)> {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let chord = dx.hypot(dy);
    if chord < 1e-12 || bulge.abs() < 1e-12 || !bulge.is_finite() {
        return None;
    }
    // Ingesloten hoek; positief = tegen de klok in.
    let theta = 4.0 * bulge.atan();
    let half = theta / 2.0;
    let radius = chord / (2.0 * half.sin().abs());
    // Middelpunt op de middelloodlijn van de koorde: links van a→b bij een
    // boog tegen de klok in van minder dan 180°, anders rechts.
    let (mx, my) = ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
    let (nx, ny) = (-dy / chord, dx / chord);
    let d = radius * half.cos() * theta.signum();
    let center = (mx + nx * d, my + ny * d);
    let start = (a.1 - center.1).atan2(a.0 - center.0);
    Some((center, radius, start, start + theta))
}

/// De Boor-evaluatie van een (rationele) B-spline in homogene coördinaten.
fn de_boor(degree: usize, knots: &[f64], ctrl: &[[f64; 4]], span: usize, t: f64) -> [f64; 4] {
    let mut d: Vec<[f64; 4]> = (0..=degree).map(|j| ctrl[span - degree + j]).collect();
    for r in 1..=degree {
        for j in (r..=degree).rev() {
            let i = span - degree + j;
            let denom = knots[i + degree + 1 - r] - knots[i];
            let alpha = if denom.abs() < 1e-300 { 0.0 } else { (t - knots[i]) / denom };
            for k in 0..4 {
                d[j][k] = (1.0 - alpha) * d[j - 1][k] + alpha * d[j][k];
            }
        }
    }
    d[degree]
}

/// Hoogste splinegraad die bemonsterd wordt; CAD-programma's gebruiken
/// hooguit graad 11, de norm laat meer toe.
pub const MAX_SPLINE_DEGREE: usize = 25;

/// Bemonstert een B-spline tot een polylijn: per niet-lege knoopspanne
/// `samples_per_span` stukken. Punten in de ruimte van de controlepunten.
/// Geeft `None` bij een onbruikbare definitie.
pub fn sample_bspline(
    degree: usize,
    knots: &[f64],
    control: &[[f64; 3]],
    weights: &[f64],
    samples_per_span: impl Fn(&[[f64; 3]]) -> usize,
) -> Option<Vec<[f64; 3]>> {
    let n = control.len();
    // De Boor kost graad² per punt; een absurde graad uit een kwaadwillig of
    // kapot bestand zou minuten rekenen. Dan liever de fitpunten (aanroeper).
    if degree == 0 || degree > MAX_SPLINE_DEGREE || n <= degree {
        return None;
    }
    let knots: Vec<f64> = if knots.len() == n + degree + 1 {
        knots.to_vec()
    } else {
        // Geen of een onbruikbare knopenvector: uniform, aan beide kanten geklemd.
        let inner = n - degree;
        let mut k = vec![0.0; degree + 1];
        for i in 1..inner {
            k.push(i as f64);
        }
        k.extend(std::iter::repeat(inner as f64).take(degree + 1));
        k
    };
    if knots.windows(2).any(|w| w[1] < w[0] - 1e-12) || knots.iter().any(|k| !k.is_finite()) {
        return None;
    }
    let rational = weights.len() == n && weights.iter().any(|w| (w - 1.0).abs() > 1e-12);
    let ctrl: Vec<[f64; 4]> = control
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let w = if rational { weights[i].max(1e-12) } else { 1.0 };
            [p[0] * w, p[1] * w, p[2] * w, w]
        })
        .collect();
    let (t_start, t_end) = (knots[degree], knots[n]);
    if !(t_end > t_start) {
        return None;
    }
    let mut out = Vec::new();
    let emit = |h: [f64; 4], out: &mut Vec<[f64; 3]>| {
        let w = if h[3].abs() < 1e-300 { 1.0 } else { h[3] };
        out.push([h[0] / w, h[1] / w, h[2] / w]);
    };
    for span in degree..n {
        let (a, b) = (knots[span], knots[span + 1]);
        if b - a <= 1e-14 || b <= t_start || a >= t_end {
            continue;
        }
        let local = &control[span - degree..=span];
        let steps = samples_per_span(local).clamp(1, 256);
        let first = out.is_empty();
        for s in 0..=steps {
            if s == 0 && !first {
                continue;
            }
            let t = a + (b - a) * s as f64 / steps as f64;
            emit(de_boor(degree, &knots, &ctrl, span, t), &mut out);
        }
    }
    (out.len() >= 2).then_some(out)
}

/// Catmull-Rom door fitpunten naar kubische Béziers (als een spline alleen
/// fitpunten heeft). Punten in de ruimte van de fitpunten; geeft
/// steunpunten per segment: (c1, c2, eind).
pub fn catmull_rom(points: &[[f64; 3]], closed: bool) -> Vec<([f64; 3], [f64; 3], [f64; 3])> {
    let n = points.len();
    let mut out = Vec::new();
    if n < 2 {
        return out;
    }
    let get = |i: isize| -> [f64; 3] {
        if closed {
            points[((i % n as isize) + n as isize) as usize % n]
        } else {
            points[i.clamp(0, n as isize - 1) as usize]
        }
    };
    let segments = if closed { n } else { n - 1 };
    for i in 0..segments as isize {
        let (p0, p1, p2, p3) = (get(i - 1), get(i), get(i + 1), get(i + 2));
        let c1 = [p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0, p1[2] + (p2[2] - p0[2]) / 6.0];
        let c2 = [p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0, p2[2] - (p3[2] - p1[2]) / 6.0];
        out.push((c1, c2, p2));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absurd_spline_degree_is_refused() {
        let ctrl: Vec<[f64; 3]> = (0..40).map(|i| [i as f64, (i % 3) as f64, 0.0]).collect();
        assert!(sample_bspline(MAX_SPLINE_DEGREE, &[], &ctrl, &[], |_| 4).is_some());
        assert!(sample_bspline(MAX_SPLINE_DEGREE + 1, &[], &ctrl, &[], |_| 4).is_none());
        assert!(sample_bspline(60_000, &[], &ctrl, &[], |_| 4).is_none());
    }

    fn close(a: f64, b: f64, eps: f64) -> bool {
        (a - b).abs() <= eps
    }

    #[test]
    fn arbitrary_axis_for_a_downward_normal_mirrors_x() {
        let t = Xform3::ocs([0.0, 0.0, -1.0]);
        let p = t.apply([2.0, 3.0, 0.0]);
        assert!(close(p[0], -2.0, 1e-12) && close(p[1], 3.0, 1e-12));
        assert_eq!(Xform3::ocs([0.0, 0.0, 1.0]), Xform3::IDENTITY);
    }

    #[test]
    fn composition_order() {
        // Eerst schalen, dan verschuiven.
        let t = Xform3::scale(2.0, 2.0, 1.0).then(&Xform3::translate(10.0, 0.0, 0.0));
        let p = t.apply([1.0, 1.0, 0.0]);
        assert!(close(p[0], 12.0, 1e-12) && close(p[1], 2.0, 1e-12));
        let plane = t.plane(0.0);
        let q = plane.apply(Point::new(1.0, 1.0));
        assert!(close(q.x, 12.0, 1e-12) && close(q.y, 2.0, 1e-12));
    }

    #[test]
    fn quarter_circle_bezier_is_accurate() {
        let mut path = PagePath::new();
        add_elliptic_arc(&mut path, Point::new(0.0, 0.0), Point::new(100.0, 0.0), Point::new(0.0, 100.0), 0.0, FRAC_PI_2, true);
        assert_eq!(path.ops.len(), 2);
        if let PathOp::Cubic(c1, c2, p) = path.ops[1] {
            assert!(close(p.x, 0.0, 1e-9) && close(p.y, 100.0, 1e-9));
            // Midpoint of the Bézier within 0.03 % of the radius.
            let m = Point::new(
                0.125 * 100.0 + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p.x,
                0.125 * 0.0 + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p.y,
            );
            assert!(close(m.x.hypot(m.y), 100.0, 0.03));
        } else {
            panic!("geen Bézier");
        }
    }

    #[test]
    fn bulge_of_one_is_a_half_circle() {
        let (c, r, s, e) = bulge_arc((0.0, 0.0), (10.0, 0.0), 1.0).unwrap();
        assert!(close(c.0, 5.0, 1e-9) && close(c.1, 0.0, 1e-9) && close(r, 5.0, 1e-9));
        // Van (0,0) tegen de klok in naar (10,0): onderlangs.
        assert!(close(s.cos() * r + c.0, 0.0, 1e-9));
        assert!(close(e - s, std::f64::consts::PI, 1e-9));
        let mid = s + (e - s) / 2.0;
        assert!(mid.sin() < 0.0);
        // Negatieve bulge: bovenlangs.
        let (c, _, s, e) = bulge_arc((0.0, 0.0), (10.0, 0.0), -1.0).unwrap();
        let mid = s + (e - s) / 2.0;
        assert!((c.1 + 5.0 * mid.sin()) > 0.0);
        // Kwart bulge (tan 22.5°): 90° boog, middelpunt boven de koorde bij positieve bulge?
        let (c, r, s, e) = bulge_arc((0.0, 0.0), (10.0, 0.0), (std::f64::consts::PI / 8.0).tan()).unwrap();
        assert!(close(e - s, FRAC_PI_2, 1e-9));
        assert!(close(r, 10.0 / 2f64.sqrt(), 1e-9));
        assert!(close(c.0, 5.0, 1e-9) && close(c.1, 5.0, 1e-9));
    }

    #[test]
    fn clamped_cubic_bspline_hits_its_end_points() {
        let ctrl = [[0.0, 0.0, 0.0], [1.0, 2.0, 0.0], [3.0, 2.0, 0.0], [4.0, 0.0, 0.0]];
        let knots = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0];
        let pts = sample_bspline(3, &knots, &ctrl, &[], |_| 8).unwrap();
        assert_eq!(pts.len(), 9);
        assert!(close(pts[0][0], 0.0, 1e-12) && close(pts[8][0], 4.0, 1e-12));
        // Bézier midpoint: (0 + 3·1 + 3·3 + 4)/8 = 2, (0 + 6 + 6 + 0)/8 = 1.5.
        assert!(close(pts[4][0], 2.0, 1e-12) && close(pts[4][1], 1.5, 1e-12));
        // A rational quadratic with w = cos 45° is an exact quarter circle.
        let ctrl = [[1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]];
        let knots = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let w = [1.0, std::f64::consts::FRAC_1_SQRT_2, 1.0];
        for p in sample_bspline(2, &knots, &ctrl, &w, |_| 16).unwrap() {
            assert!(close(p[0].hypot(p[1]), 1.0, 1e-12));
        }
    }
}
