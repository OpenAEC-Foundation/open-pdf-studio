//! Knippen op een assenparallelle rechthoek: het exportgebied (een schaalgebied,
//! een viewport of een zelf getekend venster).

use crate::geom::Point;

/// Assenparallelle rechthoek in uitvoerruimte.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClipRect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl ClipRect {
    pub fn new(ax: f64, ay: f64, bx: f64, by: f64) -> Self {
        ClipRect { x0: ax.min(bx), y0: ay.min(by), x1: ax.max(bx), y1: ay.max(by) }
    }

    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x0 && p.x <= self.x1 && p.y >= self.y0 && p.y <= self.y1
    }

    /// True als de omhullende van `points` helemaal binnen de rechthoek valt.
    pub fn contains_all(&self, points: &[Point]) -> bool {
        points.iter().all(|&p| self.contains(p))
    }

    /// True als de omhullende van `points` de rechthoek niet raakt.
    pub fn misses(&self, points: &[Point]) -> bool {
        if points.is_empty() {
            return true;
        }
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for p in points {
            min_x = min_x.min(p.x);
            min_y = min_y.min(p.y);
            max_x = max_x.max(p.x);
            max_y = max_y.max(p.y);
        }
        max_x < self.x0 || min_x > self.x1 || max_y < self.y0 || min_y > self.y1
    }

    /// Liang–Barsky: het deel van het lijnstuk `a`–`b` binnen de rechthoek, of
    /// `None`.
    pub fn clip_segment(&self, a: Point, b: Point) -> Option<(Point, Point)> {
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let mut t0 = 0.0f64;
        let mut t1 = 1.0f64;
        for (p, q) in [
            (-dx, a.x - self.x0),
            (dx, self.x1 - a.x),
            (-dy, a.y - self.y0),
            (dy, self.y1 - a.y),
        ] {
            if p == 0.0 {
                if q < 0.0 {
                    return None;
                }
                continue;
            }
            let r = q / p;
            if p < 0.0 {
                if r > t1 {
                    return None;
                }
                t0 = t0.max(r);
            } else {
                if r < t0 {
                    return None;
                }
                t1 = t1.min(r);
            }
        }
        let at = |t: f64| Point::new(a.x + t * dx, a.y + t * dy);
        Some((if t0 > 0.0 { at(t0) } else { a }, if t1 < 1.0 { at(t1) } else { b }))
    }

    /// Knipt een polylijn; geeft de stukken die binnen vallen. Een gesloten
    /// polylijn die helemaal binnen valt komt als één stuk terug met het
    /// beginpunt herhaald aan het eind; de aanroeper beslist of dat weer een
    /// gesloten polylijn wordt.
    pub fn clip_polyline(&self, points: &[Point], closed: bool) -> Vec<Vec<Point>> {
        let mut ring: Vec<Point> = points.to_vec();
        if closed && points.len() > 2 {
            ring.push(points[0]);
        }
        let mut pieces: Vec<Vec<Point>> = Vec::new();
        let mut current: Vec<Point> = Vec::new();
        for pair in ring.windows(2) {
            match self.clip_segment(pair[0], pair[1]) {
                Some((a, b)) => {
                    let continues = current.last().is_some_and(|last| last.distance(a) <= 1e-12);
                    if !continues {
                        if current.len() > 1 {
                            pieces.push(std::mem::take(&mut current));
                        }
                        current.clear();
                        current.push(a);
                    }
                    current.push(b);
                }
                None => {
                    if current.len() > 1 {
                        pieces.push(std::mem::take(&mut current));
                    }
                    current.clear();
                }
            }
        }
        if current.len() > 1 {
            pieces.push(current);
        }
        // Een ring die binnen begint en eindigt maar tussendoor naar buiten
        // ging: laatste en eerste stuk sluiten op elkaar aan.
        if closed && pieces.len() > 1 {
            let first_start = pieces[0][0];
            let last_end = *pieces.last().unwrap().last().unwrap();
            if first_start.distance(last_end) <= 1e-12 {
                let first = pieces.remove(0);
                pieces.last_mut().unwrap().extend_from_slice(&first[1..]);
            }
        }
        pieces
    }

    /// Sutherland–Hodgman: een veelhoek (zonder herhaald beginpunt) geknipt
    /// op de rechthoek. Leeg als er niets binnen valt.
    pub fn clip_polygon(&self, points: &[Point]) -> Vec<Point> {
        let mut out: Vec<Point> = points.to_vec();
        let edges: [(fn(&ClipRect, Point) -> bool, fn(&ClipRect, Point, Point) -> Point); 4] = [
            (|r, p| p.x >= r.x0, |r, a, b| cut_x(a, b, r.x0)),
            (|r, p| p.x <= r.x1, |r, a, b| cut_x(a, b, r.x1)),
            (|r, p| p.y >= r.y0, |r, a, b| cut_y(a, b, r.y0)),
            (|r, p| p.y <= r.y1, |r, a, b| cut_y(a, b, r.y1)),
        ];
        for (inside, cut) in edges {
            if out.is_empty() {
                break;
            }
            let input = std::mem::take(&mut out);
            let mut prev = *input.last().unwrap();
            for &cur in &input {
                let (cur_in, prev_in) = (inside(self, cur), inside(self, prev));
                if cur_in {
                    if !prev_in {
                        out.push(cut(self, prev, cur));
                    }
                    out.push(cur);
                } else if prev_in {
                    out.push(cut(self, prev, cur));
                }
                prev = cur;
            }
        }
        if out.len() < 3 {
            out.clear();
        }
        out
    }
}

fn cut_x(a: Point, b: Point, x: f64) -> Point {
    let t = (x - a.x) / (b.x - a.x);
    Point::new(x, a.y + t * (b.y - a.y))
}

fn cut_y(a: Point, b: Point, y: f64) -> Point {
    let t = (y - a.y) / (b.y - a.y);
    Point::new(a.x + t * (b.x - a.x), y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: f64, y: f64) -> Point {
        Point::new(x, y)
    }

    fn rect() -> ClipRect {
        ClipRect::new(0.0, 0.0, 10.0, 10.0)
    }

    #[test]
    fn segment_inside_outside_and_crossing() {
        let r = rect();
        assert_eq!(r.clip_segment(p(1.0, 1.0), p(9.0, 9.0)), Some((p(1.0, 1.0), p(9.0, 9.0))));
        assert_eq!(r.clip_segment(p(11.0, 1.0), p(20.0, 9.0)), None);
        assert_eq!(r.clip_segment(p(-5.0, 5.0), p(15.0, 5.0)), Some((p(0.0, 5.0), p(10.0, 5.0))));
        // Diagonaal door een hoek.
        let (a, b) = r.clip_segment(p(-5.0, -5.0), p(5.0, 5.0)).unwrap();
        assert_eq!((a, b), (p(0.0, 0.0), p(5.0, 5.0)));
        // Evenwijdig aan en buiten een rand.
        assert_eq!(r.clip_segment(p(-1.0, 0.0), p(-1.0, 10.0)), None);
    }

    #[test]
    fn polyline_leaving_and_reentering_gives_two_pieces() {
        let r = rect();
        let pts = [p(2.0, 5.0), p(15.0, 5.0), p(15.0, 8.0), p(2.0, 8.0)];
        let pieces = r.clip_polyline(&pts, false);
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0], vec![p(2.0, 5.0), p(10.0, 5.0)]);
        assert_eq!(pieces[1], vec![p(10.0, 8.0), p(2.0, 8.0)]);
    }

    #[test]
    fn polyline_fully_inside_stays_one_piece() {
        let r = rect();
        let pts = [p(1.0, 1.0), p(2.0, 3.0), p(4.0, 1.0)];
        assert_eq!(r.clip_polyline(&pts, false), vec![pts.to_vec()]);
        let closed = r.clip_polyline(&pts, true);
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].len(), 4);
        assert_eq!(closed[0][0], closed[0][3]);
    }

    #[test]
    fn closed_ring_cut_once_is_stitched_at_the_seam() {
        let r = rect();
        // Vierkant dat rechts buiten de rechthoek steekt; begint en eindigt binnen.
        let pts = [p(5.0, 2.0), p(15.0, 2.0), p(15.0, 8.0), p(5.0, 8.0)];
        let pieces = r.clip_polyline(&pts, true);
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0], vec![p(10.0, 8.0), p(5.0, 8.0), p(5.0, 2.0), p(10.0, 2.0)]);
    }

    #[test]
    fn polygon_clip_keeps_inside_part() {
        let r = rect();
        let square = [p(5.0, 5.0), p(15.0, 5.0), p(15.0, 15.0), p(5.0, 15.0)];
        let clipped = r.clip_polygon(&square);
        assert_eq!(clipped.len(), 4);
        for q in &clipped {
            assert!(r.contains(*q));
        }
        let area: f64 = clipped
            .iter()
            .zip(clipped.iter().cycle().skip(1))
            .map(|(a, b)| a.x * b.y - b.x * a.y)
            .sum::<f64>()
            .abs()
            / 2.0;
        assert!((area - 25.0).abs() < 1e-9);
        assert!(r.clip_polygon(&[p(20.0, 20.0), p(30.0, 20.0), p(30.0, 30.0)]).is_empty());
    }

    #[test]
    fn misses_and_contains_all() {
        let r = rect();
        assert!(r.misses(&[p(11.0, 11.0), p(12.0, 13.0)]));
        assert!(!r.misses(&[p(-1.0, 5.0), p(1.0, 5.0)]));
        assert!(r.contains_all(&[p(0.0, 0.0), p(10.0, 10.0)]));
        assert!(!r.contains_all(&[p(0.0, 0.0), p(10.1, 10.0)]));
    }
}
