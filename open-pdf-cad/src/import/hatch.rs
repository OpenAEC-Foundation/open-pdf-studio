//! Arceringen: grenzen en patroonlijnen (#400).
//!
//! De grens wordt een gewoon pad (effen vulling, even-oneven zodat eilanden
//! gaten worden). Een patroonarcering wordt als knippad gebruikt: de
//! patroonlijnen lopen dwars over de omhullende en de PDF-lezer knipt ze op de
//! grens. Dat is exact, kost weinig plaats en houdt de streepjes van
//! bijvoorbeeld ANSI31 netjes op één lijn.

use super::curves::{add_elliptic_arc, ccw_sweep, bulge_arc, sample_bspline, PagePath, PathOp};
use super::style::Dash;
use crate::geom::{Matrix, Point};
use acadrust::entities::hatch::{BoundaryEdge, BoundaryPath, HatchPattern, HatchStyleType};

/// Tolerantie waarmee twee randen als aansluitend gelden (paginapunten).
const JOIN_TOLERANCE: f64 = 1e-4;

fn edge_path(edge: &BoundaryEdge, plane: &Matrix, elevation: f64, angles_in_degrees: bool) -> Option<PagePath> {
    let map = |x: f64, y: f64| plane.apply(Point::new(x, y));
    let vector = |x: f64, y: f64| {
        let o = plane.apply(Point::new(0.0, 0.0));
        let p = plane.apply(Point::new(x, y));
        Point::new(p.x - o.x, p.y - o.y)
    };
    let _ = elevation;
    let mut path = PagePath::new();
    match edge {
        BoundaryEdge::Line(l) => {
            path.move_to(map(l.start.x, l.start.y));
            path.line_to(map(l.end.x, l.end.y));
        }
        BoundaryEdge::CircularArc(a) => {
            if !(a.radius.is_finite() && a.radius.abs() > 0.0) {
                return None;
            }
            // Een boog met de klok mee staat in het bestand met
            // complementaire hoeken (360° − hoek) en omgewisseld.
            let (start, end) = if a.counter_clockwise {
                (a.start_angle, a.end_angle)
            } else {
                (std::f64::consts::TAU - a.end_angle, std::f64::consts::TAU - a.start_angle)
            };
            let (t0, t1) = ccw_sweep(start, end);
            let c = map(a.center.x, a.center.y);
            let u = vector(a.radius, 0.0);
            let v = vector(0.0, a.radius);
            add_elliptic_arc(&mut path, c, u, v, t0, t1, true);
            if !a.counter_clockwise {
                path = reverse_path(&path);
            }
        }
        BoundaryEdge::EllipticArc(e) => {
            let (mx, my) = (e.major_axis_endpoint.x, e.major_axis_endpoint.y);
            let major = mx.hypot(my);
            if !(major > 0.0) || !e.minor_axis_ratio.is_finite() {
                return None;
            }
            // In DXF staan deze hoeken in graden, in DWG in radialen; het zijn
            // hoeken (niet de parameter van de ellips).
            let to_rad = |v: f64| if angles_in_degrees { v.to_radians() } else { v };
            let (start_a, end_a) = if e.counter_clockwise {
                (to_rad(e.start_angle), to_rad(e.end_angle))
            } else {
                (std::f64::consts::TAU - to_rad(e.end_angle), std::f64::consts::TAU - to_rad(e.start_angle))
            };
            let ratio = e.minor_axis_ratio.abs().max(1e-9);
            let to_param = |a: f64| (a.sin() / ratio).atan2(a.cos());
            let (t0, t1) = ccw_sweep(to_param(start_a), to_param(end_a));
            let c = map(e.center.x, e.center.y);
            let u = vector(mx, my);
            let v = vector(-my * ratio, mx * ratio);
            add_elliptic_arc(&mut path, c, u, v, t0, t1, true);
            if !e.counter_clockwise {
                path = reverse_path(&path);
            }
        }
        BoundaryEdge::Spline(s) => {
            let control: Vec<[f64; 3]> = s.control_points.iter().map(|p| [p.x, p.y, 0.0]).collect();
            let weights: Vec<f64> = s.control_points.iter().map(|p| if p.z > 0.0 { p.z } else { 1.0 }).collect();
            let points = if control.len() >= 2 {
                sample_bspline(s.degree.max(1) as usize, &s.knots, &control, &weights, |_| 12)
            } else {
                None
            };
            let points = points.unwrap_or_else(|| s.fit_points.iter().map(|p| [p.x, p.y, 0.0]).collect());
            if points.len() < 2 {
                return None;
            }
            for (i, p) in points.iter().enumerate() {
                let q = map(p[0], p[1]);
                if i == 0 {
                    path.move_to(q);
                } else {
                    path.line_to(q);
                }
            }
        }
        BoundaryEdge::Polyline(p) => {
            let n = p.vertices.len();
            if n < 2 {
                return None;
            }
            for i in 0..n {
                let v = p.vertices[i];
                let q = map(v.x, v.y);
                if i == 0 {
                    path.move_to(q);
                }
                let next = if i + 1 < n {
                    Some(p.vertices[i + 1])
                } else if p.is_closed {
                    Some(p.vertices[0])
                } else {
                    None
                };
                let Some(w) = next else { break };
                // z van een polylijn-rand is de bulge.
                if v.z.abs() > 1e-12 {
                    if let Some((c, r, s, e)) = bulge_arc((v.x, v.y), (w.x, w.y), v.z) {
                        add_elliptic_arc(&mut path, map(c.0, c.1), vector(r, 0.0), vector(0.0, r), s, e, false);
                        continue;
                    }
                }
                path.line_to(map(w.x, w.y));
            }
            if p.is_closed {
                path.close();
            }
        }
    }
    (!path.is_empty() && path.is_finite()).then_some(path)
}

/// Keert de volgorde van een (enkelvoudig) deelpad om.
pub fn reverse_path(path: &PagePath) -> PagePath {
    let mut points: Vec<Point> = Vec::new();
    let mut segments: Vec<(Option<(Point, Point)>, Point)> = Vec::new();
    let mut start = None;
    for op in &path.ops {
        match op {
            PathOp::Move(p) => {
                start = Some(*p);
                points.push(*p);
            }
            PathOp::Line(p) => segments.push((None, *p)),
            PathOp::Cubic(a, b, p) => segments.push((Some((*a, *b)), *p)),
            PathOp::Close => {}
        }
    }
    let Some(first) = start else { return path.clone() };
    let mut out = PagePath::new();
    let last = segments.last().map(|s| s.1).unwrap_or(first);
    out.move_to(last);
    for i in (0..segments.len()).rev() {
        let from = if i == 0 { first } else { segments[i - 1].1 };
        match segments[i].0 {
            Some((a, b)) => out.cubic_to(b, a, from),
            None => out.line_to(from),
        }
    }
    let _ = points;
    out
}

fn first_point(path: &PagePath) -> Option<Point> {
    path.ops.iter().find_map(|op| if let PathOp::Move(p) = op { Some(*p) } else { None })
}

fn append(target: &mut PagePath, piece: &PagePath) {
    for (i, op) in piece.ops.iter().enumerate() {
        match op {
            PathOp::Move(p) if i == 0 => {
                if target.is_empty() {
                    target.move_to(*p);
                } else if target.current().map(|c| c.distance(*p) > JOIN_TOLERANCE).unwrap_or(true) {
                    target.line_to(*p);
                }
            }
            PathOp::Move(p) => target.move_to(*p),
            other => target.ops.push(*other),
        }
    }
}

/// Bouwt het grenspad van een arcering. `angles_in_degrees` geldt voor DXF.
pub fn boundary(paths: &[BoundaryPath], plane: &Matrix, elevation: f64, style: HatchStyleType, angles_in_degrees: bool) -> PagePath {
    let mut out = PagePath::new();
    // Bij "negeren" tellen alleen de buitenste grenzen mee.
    let outer_only = matches!(style, HatchStyleType::Ignore);
    let use_path = |p: &BoundaryPath| !outer_only || p.flags.bits() & 0x11 != 0;
    let any_outer = paths.iter().any(use_path);
    for bp in paths {
        if any_outer && !use_path(bp) {
            continue;
        }
        let mut loop_path = PagePath::new();
        for edge in &bp.edges {
            let Some(piece) = edge_path(edge, plane, elevation, angles_in_degrees) else { continue };
            if loop_path.is_empty() {
                append(&mut loop_path, &piece);
                continue;
            }
            let current = loop_path.current();
            let (ps, pe) = (first_point(&piece), piece.current());
            match (current, ps, pe) {
                (Some(c), Some(s), Some(e)) if c.distance(e) + JOIN_TOLERANCE < c.distance(s) => {
                    let reversed = reverse_path(&piece);
                    append(&mut loop_path, &reversed);
                }
                _ => append(&mut loop_path, &piece),
            }
        }
        if !loop_path.is_empty() {
            loop_path.close();
            out.ops.extend_from_slice(&loop_path.ops);
        }
    }
    out
}

/// Eén familie patroonlijnen, klaar om te tekenen.
pub struct PatternFamily {
    pub path: PagePath,
    pub dash: Option<Dash>,
}

/// Bouwt de patroonlijnen van een arcering binnen `bounds` (paginaruimte).
/// `max_lines` begrenst het totaal; boven die grens geeft de functie `None`
/// zodat de aanroeper alleen de omtrek kan tekenen.
pub fn pattern(pattern: &HatchPattern, plane: &Matrix, bounds: [f64; 4], max_lines: usize) -> Option<Vec<PatternFamily>> {
    if pattern.lines.is_empty() {
        return None;
    }
    let origin = plane.apply(Point::new(0.0, 0.0));
    let vector = |x: f64, y: f64| {
        let p = plane.apply(Point::new(x, y));
        Point::new(p.x - origin.x, p.y - origin.y)
    };
    let corners = [
        Point::new(bounds[0], bounds[1]),
        Point::new(bounds[2], bounds[1]),
        Point::new(bounds[2], bounds[3]),
        Point::new(bounds[0], bounds[3]),
    ];
    let mut families = Vec::new();
    let mut total_lines = 0usize;
    for line in &pattern.lines {
        let (sin, cos) = line.angle.sin_cos();
        let dir = vector(cos, sin);
        let len = dir.x.hypot(dir.y);
        if !(len > 1e-9) || !len.is_finite() {
            continue;
        }
        let unit = Point::new(dir.x / len, dir.y / len);
        let normal = Point::new(-unit.y, unit.x);
        let base = plane.apply(Point::new(line.base_point.x, line.base_point.y));
        let offset = vector(line.offset.x, line.offset.y);
        let step = normal.x * offset.x + normal.y * offset.y;
        if !(step.abs() > 1e-9) || !step.is_finite() {
            continue;
        }
        let dist = |p: Point| normal.x * p.x + normal.y * p.y;
        let along = |p: Point| unit.x * p.x + unit.y * p.y;
        let (mut dmin, mut dmax) = (f64::INFINITY, f64::NEG_INFINITY);
        let (mut tmin, mut tmax) = (f64::INFINITY, f64::NEG_INFINITY);
        for c in corners {
            dmin = dmin.min(dist(c));
            dmax = dmax.max(dist(c));
            tmin = tmin.min(along(c));
            tmax = tmax.max(along(c));
        }
        let base_d = dist(base);
        let (k0, k1) = {
            let a = (dmin - base_d) / step;
            let b = (dmax - base_d) / step;
            (a.min(b).floor() as i64, a.max(b).ceil() as i64)
        };
        let count = (k1 - k0 + 1).max(0) as usize;
        if count == 0 {
            continue;
        }
        total_lines += count;
        if total_lines > max_lines {
            return None;
        }
        // Streepjes: lengtes zijn in tekeningeenheden langs de lijn.
        let dash = super::style::pdf_dash(&line.dash_lengths, len);
        let period: f64 = dash.as_ref().map(|d| d.array.iter().sum::<f64>()).unwrap_or(0.0);
        let mut path = PagePath::new();
        for k in k0..=k1 {
            let o = Point::new(base.x + offset.x * k as f64, base.y + offset.y * k as f64);
            let t_o = along(o);
            let (mut t0, t1) = (tmin - t_o, tmax - t_o);
            if period > 0.0 {
                // Elke lijn op een veelvoud van de patroonlengte laten
                // beginnen, dan klopt één fase voor alle lijnen.
                t0 = (t0 / period).floor() * period;
            }
            path.move_to(Point::new(o.x + unit.x * t0, o.y + unit.y * t0));
            path.line_to(Point::new(o.x + unit.x * t1, o.y + unit.y * t1));
        }
        if !path.is_empty() {
            families.push(PatternFamily { path, dash });
        }
    }
    (!families.is_empty()).then_some(families)
}

#[cfg(test)]
mod tests {
    use super::*;
    use acadrust::entities::hatch::{CircularArcEdge, HatchPatternLine, LineEdge};
    use acadrust::types::Vector2;

    fn line_edge(a: (f64, f64), b: (f64, f64)) -> BoundaryEdge {
        BoundaryEdge::Line(LineEdge { start: Vector2::new(a.0, a.1), end: Vector2::new(b.0, b.1) })
    }

    #[test]
    fn a_square_boundary_closes() {
        let mut bp = BoundaryPath::default();
        bp.edges.push(line_edge((0.0, 0.0), (10.0, 0.0)));
        bp.edges.push(line_edge((10.0, 0.0), (10.0, 10.0)));
        // Omgekeerde rand: moet gedraaid worden aangehangen.
        bp.edges.push(line_edge((0.0, 10.0), (10.0, 10.0)));
        bp.edges.push(line_edge((0.0, 10.0), (0.0, 0.0)));
        let path = boundary(&[bp], &Matrix::IDENTITY, 0.0, HatchStyleType::Normal, true);
        assert_eq!(path.ops.len(), 6);
        assert!(matches!(path.ops.last(), Some(PathOp::Close)));
        let pts: Vec<Point> = path
            .ops
            .iter()
            .filter_map(|op| match op {
                PathOp::Move(p) | PathOp::Line(p) => Some(*p),
                _ => None,
            })
            .collect();
        assert_eq!(pts.len(), 5);
        assert_eq!(pts[4], Point::new(0.0, 0.0));
    }

    #[test]
    fn a_clockwise_arc_edge_connects_to_its_neighbours() {
        // Halve cirkel met de klok mee van (10,0) naar (-10,0): in het bestand
        // staan de complementaire hoeken 180 → 360.
        let mut bp = BoundaryPath::default();
        bp.edges.push(line_edge((-10.0, 0.0), (10.0, 0.0)));
        bp.edges.push(BoundaryEdge::CircularArc(CircularArcEdge {
            center: Vector2::new(0.0, 0.0),
            radius: 10.0,
            start_angle: std::f64::consts::PI,
            end_angle: std::f64::consts::TAU,
            counter_clockwise: false,
        }));
        let path = boundary(&[bp], &Matrix::IDENTITY, 0.0, HatchStyleType::Normal, false);
        // Na de lijn naar (10,0) begint de boog daar ook, zonder tussenlijn.
        let pts: Vec<Point> = path
            .ops
            .iter()
            .filter_map(|op| match op {
                PathOp::Move(p) | PathOp::Line(p) | PathOp::Cubic(_, _, p) => Some(*p),
                _ => None,
            })
            .collect();
        assert!((pts[1].x - 10.0).abs() < 1e-9);
        // De boog loopt over de bovenkant (y = +10) en eindigt bij (−10, 0).
        let last = *pts.last().unwrap();
        assert!((last.x + 10.0).abs() < 1e-6 && last.y.abs() < 1e-6);
        assert!(pts.iter().any(|p| p.y > 9.0));
        assert!(!pts.iter().any(|p| p.y < -0.001));
    }

    #[test]
    fn pattern_lines_cover_the_bounds_and_share_one_phase() {
        let p = HatchPattern {
            name: "ANSI31".into(),
            description: String::new(),
            lines: vec![HatchPatternLine {
                angle: std::f64::consts::FRAC_PI_4,
                base_point: Vector2::new(0.0, 0.0),
                offset: Vector2::new(-2.2097, 2.2097),
                dash_lengths: vec![],
            }],
        };
        let families = pattern(&p, &Matrix::IDENTITY, [0.0, 0.0, 10.0, 10.0], 10_000).unwrap();
        assert_eq!(families.len(), 1);
        let lines = families[0].path.ops.len() / 2;
        // Diagonale lijnen met 3,125 afstand over een vlak van 14,1 diagonaal.
        assert!((4..=8).contains(&lines), "{lines} lijnen");
        // Te veel lijnen geeft niets terug.
        let fine = HatchPattern {
            lines: vec![HatchPatternLine { offset: Vector2::new(0.0, 0.001), ..p.lines[0].clone() }],
            ..p.clone()
        };
        assert!(pattern(&fine, &Matrix::IDENTITY, [0.0, 0.0, 1000.0, 1000.0], 5_000).is_none());
    }
}
