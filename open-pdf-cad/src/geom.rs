//! Pure 2D-geometrie voor de CAD-export: matrices, Bézier-afvlakking en het
//! samenvoegen van collineaire segmenten. Alles in `f64`; PDFium levert `f32`,
//! maar matrixketens (pagina × formulier × object) worden in dubbele precisie
//! samengesteld zodat de afrondingsfout ruim onder de exporttolerantie blijft.

/// Punt in een willekeurige 2D-ruimte (PDF-gebruikersruimte of uitvoerruimte).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }

    pub fn distance(self, other: Point) -> f64 {
        (self.x - other.x).hypot(self.y - other.y)
    }
}

/// Affiene matrix in PDF-notatie `[a b c d e f]` met rijvectoren:
/// `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Matrix {
    pub const IDENTITY: Matrix = Matrix { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    pub const fn new(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> Self {
        Matrix { a, b, c, d, e, f }
    }

    pub const fn translate(tx: f64, ty: f64) -> Self {
        Matrix::new(1.0, 0.0, 0.0, 1.0, tx, ty)
    }

    pub const fn scale(sx: f64, sy: f64) -> Self {
        Matrix::new(sx, 0.0, 0.0, sy, 0.0, 0.0)
    }

    /// Past de matrix toe op een punt.
    pub fn apply(&self, p: Point) -> Point {
        Point::new(
            self.a * p.x + self.c * p.y + self.e,
            self.b * p.x + self.d * p.y + self.f,
        )
    }

    /// `self` eerst, daarna `next` — de PDF-volgorde van `cm`: een punt dat
    /// door `self.then(next)` gaat, krijgt eerst `self` en dan `next`.
    pub fn then(&self, next: &Matrix) -> Matrix {
        Matrix {
            a: self.a * next.a + self.b * next.c,
            b: self.a * next.b + self.b * next.d,
            c: self.c * next.a + self.d * next.c,
            d: self.c * next.b + self.d * next.d,
            e: self.e * next.a + self.f * next.c + next.e,
            f: self.e * next.b + self.f * next.d + next.f,
        }
    }

    /// De omgekeerde afbeelding; `None` als de matrix ontaard is.
    pub fn inverse(&self) -> Option<Matrix> {
        let det = self.determinant();
        if det.abs() < 1e-18 || !det.is_finite() {
            return None;
        }
        let (a, b, c, d) = (self.d / det, -self.b / det, -self.c / det, self.a / det);
        Some(Matrix::new(a, b, c, d, -(self.e * a + self.f * c), -(self.e * b + self.f * d)))
    }

    pub fn determinant(&self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    /// Gemiddelde lineaire schaal (wortel van de oppervlakteschaal). Hiermee
    /// wordt een lijndikte uit objectruimte naar paginaruimte gebracht.
    pub fn mean_scale(&self) -> f64 {
        self.determinant().abs().sqrt()
    }

    /// Schaal langs de lokale y-as: bepaalt de teksthoogte.
    pub fn y_scale(&self) -> f64 {
        self.c.hypot(self.d)
    }

    /// Schaal langs de lokale x-as.
    pub fn x_scale(&self) -> f64 {
        self.a.hypot(self.b)
    }

    /// Hoek van de lokale x-as in radialen, tegen de klok in.
    pub fn x_axis_angle(&self) -> f64 {
        self.b.atan2(self.a)
    }

    /// True als de matrix spiegelt (negatieve determinant).
    pub fn is_mirrored(&self) -> bool {
        self.determinant() < 0.0
    }
}

/// Eén kubische Bézier in absolute punten.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CubicBezier {
    pub p0: Point,
    pub p1: Point,
    pub p2: Point,
    pub p3: Point,
}

impl CubicBezier {
    pub fn point_at(&self, t: f64) -> Point {
        let mt = 1.0 - t;
        let (b0, b1, b2, b3) = (mt * mt * mt, 3.0 * mt * mt * t, 3.0 * mt * t * t, t * t * t);
        Point::new(
            b0 * self.p0.x + b1 * self.p1.x + b2 * self.p2.x + b3 * self.p3.x,
            b0 * self.p0.y + b1 * self.p1.y + b2 * self.p2.y + b3 * self.p3.y,
        )
    }

    /// Bovengrens voor de afwijking tussen de kromme en de koorde p0–p3:
    /// de grootste afstand van een stuurpunt tot de koorde. De kromme ligt in
    /// de convexe omhulling van zijn stuurpunten, dus dit is een veilige grens.
    fn flatness(&self) -> f64 {
        distance_to_segment(self.p1, self.p0, self.p3)
            .max(distance_to_segment(self.p2, self.p0, self.p3))
    }

    fn split(&self) -> (CubicBezier, CubicBezier) {
        let mid = |a: Point, b: Point| Point::new((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
        let p01 = mid(self.p0, self.p1);
        let p12 = mid(self.p1, self.p2);
        let p23 = mid(self.p2, self.p3);
        let p012 = mid(p01, p12);
        let p123 = mid(p12, p23);
        let m = mid(p012, p123);
        (
            CubicBezier { p0: self.p0, p1: p01, p2: p012, p3: m },
            CubicBezier { p0: m, p1: p123, p2: p23, p3: self.p3 },
        )
    }

    /// Vlakt de kromme af tot een polylijn waarvan geen punt verder dan
    /// `tolerance` van de echte kromme ligt. Het beginpunt `p0` wordt NIET
    /// toegevoegd (dat staat al in de lopende polylijn); het eindpunt wel, en
    /// exact — eindpunten van een pad mogen door het afvlakken niet verschuiven.
    pub fn flatten_into(&self, tolerance: f64, out: &mut Vec<Point>) {
        // Diepte 16 = hooguit 65 536 stukken per kromme; genoeg voor elke
        // tolerantie die zinnig is en een harde rem op ontaarde invoer.
        self.flatten_rec(tolerance.max(1e-9), 16, out);
    }

    fn flatten_rec(&self, tolerance: f64, depth: u32, out: &mut Vec<Point>) {
        if depth == 0 || self.flatness() <= tolerance {
            out.push(self.p3);
            return;
        }
        let (l, r) = self.split();
        l.flatten_rec(tolerance, depth - 1, out);
        r.flatten_rec(tolerance, depth - 1, out);
    }
}

/// Afstand van punt `p` tot het lijnstuk `a`–`b`.
pub fn distance_to_segment(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let len2 = dx * dx + dy * dy;
    if len2 <= f64::EPSILON {
        return p.distance(a);
    }
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).clamp(0.0, 1.0);
    p.distance(Point::new(a.x + t * dx, a.y + t * dy))
}

/// Verwijdert tussenpunten die op de lijn tussen hun buren liggen.
///
/// Een punt vervalt als het (a) binnen `tolerance` van de lijn door het laatst
/// behouden punt en zijn opvolger ligt én (b) in de looprichting tussen die
/// twee ligt — een omkeerpunt (heen en terug over dezelfde lijn) blijft dus
/// staan, want dat bepaalt de lengte van het getekende lijnstuk. Begin- en
/// eindpunt blijven altijd. Bij `closed` wordt ook de naad beoordeeld.
pub fn merge_collinear(points: &[Point], tolerance: f64, closed: bool) -> Vec<Point> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let mut out: Vec<Point> = Vec::with_capacity(points.len());
    out.push(points[0]);
    for i in 1..points.len() - 1 {
        let prev = *out.last().unwrap();
        let (cur, next) = (points[i], points[i + 1]);
        if !is_redundant(prev, cur, next, tolerance) {
            out.push(cur);
        }
    }
    out.push(*points.last().unwrap());

    if closed && out.len() > 3 {
        // Naad: het eerste punt kan zelf collineair zijn tussen laatste en tweede.
        let n = out.len();
        if is_redundant(out[n - 1], out[0], out[1], tolerance) {
            out.remove(0);
        }
    }
    out
}

fn is_redundant(prev: Point, cur: Point, next: Point, tolerance: f64) -> bool {
    let (dx, dy) = (next.x - prev.x, next.y - prev.y);
    let len2 = dx * dx + dy * dy;
    if len2 <= f64::EPSILON {
        // prev en next vallen samen: cur is een uitstulping, behouden tenzij
        // het zelf ook samenvalt.
        return cur.distance(prev) <= tolerance;
    }
    // Loodrechte afstand tot de oneindige lijn prev–next.
    let cross = (cur.x - prev.x) * dy - (cur.y - prev.y) * dx;
    if cross.abs() / len2.sqrt() > tolerance {
        return false;
    }
    // Projectie moet tussen prev en next vallen, anders is het een omkeerpunt.
    let t = ((cur.x - prev.x) * dx + (cur.y - prev.y) * dy) / len2;
    (0.0..=1.0).contains(&t)
}

/// Verwijdert opeenvolgende dubbele punten (afstand ≤ `tolerance`).
pub fn dedup_points(points: &[Point], tolerance: f64) -> Vec<Point> {
    let mut out: Vec<Point> = Vec::with_capacity(points.len());
    for &p in points {
        match out.last() {
            Some(&last) if last.distance(p) <= tolerance => {}
            _ => out.push(p),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn matrix_apply_translates_and_scales() {
        let m = Matrix::new(2.0, 0.0, 0.0, 3.0, 10.0, -5.0);
        let p = m.apply(Point::new(1.0, 1.0));
        assert!(close(p.x, 12.0) && close(p.y, -2.0));
    }

    #[test]
    fn matrix_then_applies_left_first() {
        // Eerst schalen, dan verplaatsen: (1,1) → (2,2) → (12,22).
        let m = Matrix::scale(2.0, 2.0).then(&Matrix::translate(10.0, 20.0));
        let p = m.apply(Point::new(1.0, 1.0));
        assert!(close(p.x, 12.0) && close(p.y, 22.0));
        // Andersom: eerst verplaatsen, dan schalen: (1,1) → (11,21) → (22,42).
        let m2 = Matrix::translate(10.0, 20.0).then(&Matrix::scale(2.0, 2.0));
        let p2 = m2.apply(Point::new(1.0, 1.0));
        assert!(close(p2.x, 22.0) && close(p2.y, 42.0));
    }

    #[test]
    fn matrix_then_equals_sequential_application() {
        let m1 = Matrix::new(0.5, 0.2, -0.3, 1.5, 7.0, -2.0);
        let m2 = Matrix::new(0.0, 1.0, -1.0, 0.0, 100.0, 50.0);
        let p = Point::new(3.25, -8.5);
        let direct = m2.apply(m1.apply(p));
        let composed = m1.then(&m2).apply(p);
        assert!(close(direct.x, composed.x) && close(direct.y, composed.y));
    }

    #[test]
    fn matrix_rotation_angle_and_scales() {
        let ang = 30f64.to_radians();
        let m = Matrix::new(2.0 * ang.cos(), 2.0 * ang.sin(), -3.0 * ang.sin(), 3.0 * ang.cos(), 0.0, 0.0);
        assert!(close(m.x_axis_angle(), ang));
        assert!(close(m.x_scale(), 2.0));
        assert!(close(m.y_scale(), 3.0));
        assert!(close(m.mean_scale(), 6f64.sqrt()));
        assert!(!m.is_mirrored());
        assert!(Matrix::scale(1.0, -1.0).is_mirrored());
    }

    /// Kwartcirkel met straal r als kubische Bézier (kappa-benadering).
    fn quarter_circle(r: f64) -> CubicBezier {
        let k = 0.552_284_749_830_793_4 * r;
        CubicBezier {
            p0: Point::new(r, 0.0),
            p1: Point::new(r, k),
            p2: Point::new(k, r),
            p3: Point::new(0.0, r),
        }
    }

    #[test]
    fn flatten_respects_tolerance() {
        let curve = quarter_circle(100.0);
        for tol in [1.0, 0.1, 0.01, 0.001] {
            let mut pts = vec![curve.p0];
            curve.flatten_into(tol, &mut pts);
            // Meet de echte afwijking: bemonster de kromme dicht en neem de
            // grootste afstand tot de polylijn.
            let mut worst = 0.0f64;
            for i in 0..=2000 {
                let p = curve.point_at(i as f64 / 2000.0);
                let d = pts
                    .windows(2)
                    .map(|w| distance_to_segment(p, w[0], w[1]))
                    .fold(f64::INFINITY, f64::min);
                worst = worst.max(d);
            }
            assert!(worst <= tol, "tolerantie {tol}: afwijking {worst}");
        }
    }

    #[test]
    fn flatten_finer_tolerance_gives_more_points() {
        let curve = quarter_circle(100.0);
        let count = |tol: f64| {
            let mut pts = Vec::new();
            curve.flatten_into(tol, &mut pts);
            pts.len()
        };
        assert!(count(0.001) > count(0.01));
        assert!(count(0.01) > count(1.0));
    }

    #[test]
    fn flatten_keeps_exact_endpoint() {
        let curve = quarter_circle(12.345);
        let mut pts = Vec::new();
        curve.flatten_into(0.05, &mut pts);
        assert_eq!(*pts.last().unwrap(), curve.p3);
    }

    #[test]
    fn flatten_straight_curve_is_single_segment() {
        let curve = CubicBezier {
            p0: Point::new(0.0, 0.0),
            p1: Point::new(1.0, 1.0),
            p2: Point::new(2.0, 2.0),
            p3: Point::new(3.0, 3.0),
        };
        let mut pts = Vec::new();
        curve.flatten_into(0.01, &mut pts);
        assert_eq!(pts, vec![Point::new(3.0, 3.0)]);
    }

    #[test]
    fn merge_collinear_drops_midpoints() {
        let pts = [
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(2.0, 0.0),
            Point::new(2.0, 5.0),
        ];
        let out = merge_collinear(&pts, 1e-6, false);
        assert_eq!(out, vec![Point::new(0.0, 0.0), Point::new(2.0, 0.0), Point::new(2.0, 5.0)]);
    }

    #[test]
    fn merge_collinear_keeps_reversal_point() {
        // 0 → 10 → 4 over dezelfde lijn: het getekende stuk loopt tot x=10.
        let pts = [Point::new(0.0, 0.0), Point::new(10.0, 0.0), Point::new(4.0, 0.0)];
        let out = merge_collinear(&pts, 1e-6, false);
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn merge_collinear_respects_tolerance() {
        let pts = [Point::new(0.0, 0.0), Point::new(5.0, 0.02), Point::new(10.0, 0.0)];
        assert_eq!(merge_collinear(&pts, 0.001, false).len(), 3);
        assert_eq!(merge_collinear(&pts, 0.05, false).len(), 2);
    }

    #[test]
    fn merge_collinear_closed_checks_seam() {
        // Vierkant waarvan het startpunt midden op de onderzijde ligt.
        let pts = [
            Point::new(5.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 10.0),
            Point::new(0.0, 10.0),
            Point::new(0.0, 0.0),
        ];
        let out = merge_collinear(&pts, 1e-6, true);
        assert_eq!(out.len(), 4);
        assert!(!out.contains(&Point::new(5.0, 0.0)));
    }

    #[test]
    fn dedup_removes_consecutive_duplicates_only() {
        let pts = [
            Point::new(0.0, 0.0),
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(0.0, 0.0),
        ];
        assert_eq!(dedup_points(&pts, 1e-9).len(), 3);
    }
}
