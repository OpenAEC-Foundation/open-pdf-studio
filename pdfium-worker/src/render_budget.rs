//! Shared pre-allocation policy for interactive PDFium bitmaps.
//! This bounds output buffers, not decoder allocations or total process memory.
use std::fmt;

pub const SCREEN_RGBA_BYTES: u64 = 64 * 1024 * 1024 - 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetError { InvalidGeometry, OutputLimit }
impl fmt::Display for BudgetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidGeometry => "PDF_INVALID_GEOMETRY: dimensions and scale must be finite and positive",
            Self::OutputLimit => "PDF_OUTPUT_LIMIT: bitmap exceeds the caller's RGBA budget",
        })
    }
}
impl std::error::Error for BudgetError {}

/// Validate before float-to-integer casts and before allocating a bitmap.
/// The caller owns the limit; no input-file size limit is implied.
pub fn dimensions(width: f32, height: f32, scale: f32, max_bytes: u64) -> Result<(i32, i32), BudgetError> {
    if [width, height, scale].iter().any(|x| !x.is_finite() || *x <= 0.0) {
        return Err(BudgetError::InvalidGeometry);
    }
    // Match the backend's f32 multiplication, then check before saturating casts.
    let w = (width * scale).ceil();
    let h = (height * scale).ceil();
    if !w.is_finite() || !h.is_finite() || w as f64 > i32::MAX as f64 || h as f64 > i32::MAX as f64 {
        return Err(BudgetError::OutputLimit);
    }
    if w < 1.0 || h < 1.0 { return Err(BudgetError::InvalidGeometry); }
    if (w as u64).checked_mul(h as u64).and_then(|n| n.checked_mul(4)).is_none_or(|n| n > max_bytes) {
        return Err(BudgetError::OutputLimit);
    }
    Ok((w as i32, h as i32))
}

/// A whole page turned by `rotation` degrees clockwise (a multiple of 90, on
/// top of the page's own /Rotate), for a render through PDFium's matrix:
/// the bitmap size and the matrix `[a, b, c, d, e, f]`.
///
/// `width_pt` x `height_pt` is the page as PDFium shows it without the extra
/// turn, `(target_w, target_h)` its bitmap from `dimensions`. The matrix works
/// in that display space (after /Rotate, y down from the top left), so a
/// quarter turn maps (x, y) to (height - y, x). The page-render configuration
/// of the binding has a rotation of its own, but on the matrix route it turns
/// the page the other way after moving it, and a quarter turn then lands
/// outside the bitmap: a white page.
pub fn turned_page(rotation: i32, width_pt: f32, height_pt: f32, (target_w, target_h): (i32, i32)) -> Option<((i32, i32), [f32; 6])> {
    // The scale the unturned render gets: the target width, held back by the
    // maximum height.
    let s = (target_w as f32 / width_pt).min(target_h as f32 / height_pt);
    if !(width_pt > 0.0 && height_pt > 0.0 && s.is_finite() && s > 0.0) { return None; }
    // The bitmap the unturned render gets at that scale (rounded, like the
    // binding does), so a turned page is exactly as large as an unturned one.
    let w = ((width_pt * s).round() as i32).max(1);
    let h = ((height_pt * s).round() as i32).max(1);
    Some(match rotation.rem_euclid(360) {
        0 => ((w, h), [s, 0.0, 0.0, s, 0.0, 0.0]),
        90 => ((h, w), [0.0, s, -s, 0.0, height_pt * s, 0.0]),
        180 => ((w, h), [-s, 0.0, 0.0, -s, width_pt * s, height_pt * s]),
        270 => ((h, w), [0.0, -s, s, 0.0, 0.0, width_pt * s]),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Where the matrix puts a point of the page (PDF matrix convention).
    fn at(m: [f32; 6], x: f32, y: f32) -> (f32, f32) {
        (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
    }
    #[test] fn a_turned_page_stays_inside_its_bitmap() {
        // 300 x 200 pt at 1.5: 450 x 300 px. Corners and a point near the top
        // left, for every quarter turn.
        let (w, h) = (300.0, 200.0);
        let target = dimensions(w, h, 1.5, SCREEN_RGBA_BYTES).unwrap();
        assert_eq!(target, (450, 300));
        for (rotation, size, near_top_left) in [
            (0, (450, 300), (15.0, 30.0)),
            (90, (300, 450), (270.0, 15.0)),
            (180, (450, 300), (435.0, 270.0)),
            (270, (300, 450), (30.0, 435.0)),
            (-90, (300, 450), (30.0, 435.0)),
            (450, (300, 450), (270.0, 15.0)),
        ] {
            let (got, m) = turned_page(rotation, w, h, target).unwrap();
            assert_eq!(got, size, "bitmap size at {rotation}");
            for (x, y) in [(0.0, 0.0), (w, 0.0), (0.0, h), (w, h)] {
                let (px, py) = at(m, x, y);
                assert!((-0.01..=got.0 as f32 + 0.01).contains(&px) && (-0.01..=got.1 as f32 + 0.01).contains(&py),
                    "corner ({x}, {y}) at {rotation} lands at ({px}, {py}), outside {got:?}");
            }
            assert_eq!(at(m, 10.0, 20.0), near_top_left, "point (10, 20) at {rotation}");
        }
    }
    #[test] fn a_turned_page_is_as_large_as_an_unturned_one() {
        // 1683.96 x 1190.76 pt at 0.75: the target is rounded up (1263 x 894),
        // the page itself fills 1263 x 893 of it.
        let (w, h) = (1683.96, 1190.76);
        let target = dimensions(w, h, 0.75, SCREEN_RGBA_BYTES).unwrap();
        assert_eq!(target, (1263, 894));
        assert_eq!(turned_page(0, w, h, target).unwrap().0, (1263, 893));
        assert_eq!(turned_page(90, w, h, target).unwrap().0, (893, 1263));
        assert_eq!(turned_page(180, w, h, target).unwrap().0, (1263, 893));
        assert_eq!(turned_page(270, w, h, target).unwrap().0, (893, 1263));
    }
    #[test] fn only_quarter_turns_of_a_real_page() {
        assert!(turned_page(45, 300.0, 200.0, (450, 300)).is_none());
        assert!(turned_page(90, 0.0, 200.0, (450, 300)).is_none());
    }
    #[test] fn exact_budget_and_fractional_edges() {
        assert_eq!(dimensions(10.1, 20.1, 1.0, 11*21*4), Ok((11,21)));
        assert_eq!(dimensions(10.1, 20.1, 1.0, 11*21*4-1), Err(BudgetError::OutputLimit));
    }
    #[test] fn invalid_geometry_is_not_a_zero_sized_success() {
        for n in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 0.0, -1.0] {
            assert_eq!(dimensions(n, 1.0, 1.0, SCREEN_RGBA_BYTES), Err(BudgetError::InvalidGeometry));
            assert_eq!(dimensions(1.0, 1.0, n, SCREEN_RGBA_BYTES), Err(BudgetError::InvalidGeometry));
        }
    }
    #[test] fn overflow_and_large_output_fail_before_cast_or_allocation() {
        assert_eq!(dimensions(f32::MAX, 1.0, 2.0, u64::MAX), Err(BudgetError::OutputLimit));
        assert_eq!(dimensions(4096.0, 4096.0, 1.0, SCREEN_RGBA_BYTES), Err(BudgetError::OutputLimit));
        assert!(dimensions(2000.0, 2000.0, 1.0, SCREEN_RGBA_BYTES).is_ok());
    }
    #[test] fn caller_can_choose_a_smaller_budget_and_retry() {
        assert_eq!(dimensions(100.0, 100.0, 1.0, 100), Err(BudgetError::OutputLimit));
        assert_eq!(dimensions(100.0, 100.0, 0.05, 100), Ok((5,5)));
    }
}
