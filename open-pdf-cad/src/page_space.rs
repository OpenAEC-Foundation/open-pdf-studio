//! Van PDF-gebruikersruimte naar uitvoerruimte.
//!
//! De uitvoerruimte is de pagina **zoals ze wordt weergegeven**: oorsprong
//! linksonder van de zichtbare paginabox, x naar rechts, y omhoog — dezelfde
//! asrichting als DXF/DWG, dus zonder spiegeling. `/Rotate` is toegepast en de
//! oorsprong van de box (ook een negatieve, zoals bij CAD-plots met een
//! MediaBox rond (0,0)) is eraf getrokken. De annotatieruimte van de app is
//! dezelfde ruimte met de y-as omgekeerd (`y_uit = hoogte − y_app`), zodat
//! annotaties later zonder extra rotatielogica mee kunnen.

use crate::geom::{Matrix, Point};
use serde::{Deserialize, Serialize};

/// Millimeters per PDF-punt (1 pt = 1/72 inch).
pub const MM_PER_POINT: f64 = 25.4 / 72.0;

/// Tekeneenheid in een CAD-bestand.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingUnit {
    #[default]
    Mm,
    Cm,
    M,
    In,
    Ft,
    /// Kilometer (`$INSUNITS` 7).
    Km,
    /// Decimeter (14).
    Dm,
    /// Yard (10).
    Yd,
    /// Mijl (3).
    Mi,
}

impl DrawingUnit {
    pub fn mm_per_unit(self) -> f64 {
        match self {
            DrawingUnit::Mm => 1.0,
            DrawingUnit::Cm => 10.0,
            DrawingUnit::M => 1000.0,
            DrawingUnit::In => 25.4,
            DrawingUnit::Ft => 304.8,
            DrawingUnit::Km => 1_000_000.0,
            DrawingUnit::Dm => 100.0,
            DrawingUnit::Yd => 914.4,
            DrawingUnit::Mi => 1_609_344.0,
        }
    }

    /// Waarde van `$INSUNITS` in DXF/DWG.
    pub fn insunits(self) -> i16 {
        match self {
            DrawingUnit::Mm => 4,
            DrawingUnit::Cm => 5,
            DrawingUnit::M => 6,
            DrawingUnit::In => 1,
            DrawingUnit::Ft => 2,
            DrawingUnit::Km => 7,
            DrawingUnit::Dm => 14,
            DrawingUnit::Yd => 10,
            DrawingUnit::Mi => 3,
        }
    }

    /// Eenheid bij een `$INSUNITS`-waarde; `None` voor "zonder eenheid" en
    /// eenheden die de app niet kent.
    pub fn from_insunits(code: i16) -> Option<DrawingUnit> {
        match code {
            1 => Some(DrawingUnit::In),
            2 => Some(DrawingUnit::Ft),
            3 => Some(DrawingUnit::Mi),
            7 => Some(DrawingUnit::Km),
            10 => Some(DrawingUnit::Yd),
            14 => Some(DrawingUnit::Dm),
            4 => Some(DrawingUnit::Mm),
            5 => Some(DrawingUnit::Cm),
            6 => Some(DrawingUnit::M),
            _ => None,
        }
    }

    /// De eenheid bij een korte naam van [`DrawingUnit::app_unit`]; zo noemt
    /// de import de eenheid in `/OPS_ModelUnits`.
    pub fn from_app_unit(name: &str) -> Option<DrawingUnit> {
        [
            DrawingUnit::Mm,
            DrawingUnit::Cm,
            DrawingUnit::M,
            DrawingUnit::In,
            DrawingUnit::Ft,
            DrawingUnit::Km,
            DrawingUnit::Dm,
            DrawingUnit::Yd,
            DrawingUnit::Mi,
        ]
        .into_iter()
        .find(|unit| unit.app_unit() == name)
    }

    /// Korte naam zoals de maatvoering van de app hem gebruikt.
    pub fn app_unit(self) -> &'static str {
        match self {
            DrawingUnit::Mm => "mm",
            DrawingUnit::Cm => "cm",
            DrawingUnit::M => "m",
            DrawingUnit::In => "in",
            DrawingUnit::Ft => "ft",
            DrawingUnit::Km => "km",
            DrawingUnit::Dm => "dm",
            DrawingUnit::Yd => "yd",
            DrawingUnit::Mi => "mi",
        }
    }
}

/// Rechthoek in PDF-gebruikersruimte.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PdfRect {
    pub left: f64,
    pub bottom: f64,
    pub right: f64,
    pub top: f64,
}

impl PdfRect {
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Self {
        PdfRect {
            left: x0.min(x1),
            bottom: y0.min(y1),
            right: x0.max(x1),
            top: y0.max(y1),
        }
    }

    pub fn width(&self) -> f64 {
        self.right - self.left
    }

    pub fn height(&self) -> f64 {
        self.top - self.bottom
    }

    /// Doorsnede; `None` als de rechthoeken elkaar niet overlappen.
    pub fn intersect(&self, other: &PdfRect) -> Option<PdfRect> {
        let r = PdfRect {
            left: self.left.max(other.left),
            bottom: self.bottom.max(other.bottom),
            right: self.right.min(other.right),
            top: self.top.min(other.top),
        };
        (r.width() > 0.0 && r.height() > 0.0).then_some(r)
    }
}

/// De zichtbare paginabox plus rotatie: alles wat nodig is om de
/// gebruikersruimte naar de weergegeven pagina te brengen.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageFrame {
    /// Zichtbare box in gebruikersruimte: CropBox ∩ MediaBox.
    pub view_box: PdfRect,
    /// `/Rotate`, genormaliseerd naar 0, 90, 180 of 270 (met de klok mee).
    pub rotate: u16,
    /// `/UserUnit`: lengte van één gebruikersruimte-eenheid in punten.
    pub user_unit: f64,
}

impl PageFrame {
    pub fn new(media_box: PdfRect, crop_box: Option<PdfRect>, rotate_degrees: i32, user_unit: f64) -> Self {
        let view_box = crop_box
            .and_then(|c| c.intersect(&media_box))
            .unwrap_or(media_box);
        let rotate = (((rotate_degrees % 360) + 360) % 360) as u16;
        // Alleen kwartslagen zijn geldig; al het andere behandelen we als 0.
        let rotate = if rotate % 90 == 0 { rotate } else { 0 };
        let user_unit = if user_unit.is_finite() && user_unit > 0.0 { user_unit } else { 1.0 };
        PageFrame { view_box, rotate, user_unit }
    }

    /// Breedte en hoogte van de weergegeven pagina in punten (na rotatie).
    pub fn display_size_pt(&self) -> (f64, f64) {
        let (w, h) = (self.view_box.width() * self.user_unit, self.view_box.height() * self.user_unit);
        if self.rotate == 90 || self.rotate == 270 { (h, w) } else { (w, h) }
    }

    /// Matrix van gebruikersruimte naar de weergegeven pagina in **punten**,
    /// oorsprong linksonder, y omhoog.
    ///
    /// Met `u = x − links`, `v = y − onder`, `W`/`H` de boxmaten:
    /// - 0°:   `(u, v)`
    /// - 90°:  `(v, W − u)`   — de linkeronderhoek komt linksboven terecht
    /// - 180°: `(W − u, H − v)`
    /// - 270°: `(H − v, u)`   — de linkeronderhoek komt rechtsonder terecht
    pub fn to_display_points(&self) -> Matrix {
        let (w, h) = (self.view_box.width(), self.view_box.height());
        let origin = Matrix::translate(-self.view_box.left, -self.view_box.bottom);
        let rot = match self.rotate {
            90 => Matrix::new(0.0, -1.0, 1.0, 0.0, 0.0, w),
            180 => Matrix::new(-1.0, 0.0, 0.0, -1.0, w, h),
            270 => Matrix::new(0.0, 1.0, -1.0, 0.0, h, 0.0),
            _ => Matrix::IDENTITY,
        };
        origin
            .then(&rot)
            .then(&Matrix::scale(self.user_unit, self.user_unit))
    }
}

/// Schaal van de uitvoer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OutputScale {
    /// Papiermaat: 1 tekeneenheid = 1 mm op het papier (schaal 1:1).
    PaperMm,
    /// Ware grootte: 1 tekeneenheid = 1 mm in werkelijkheid. `mm_per_point` is
    /// het aantal werkelijke millimeters per PDF-punt; bij schaal 1:N is dat
    /// `N × 25,4 / 72`.
    RealWorldMm { mm_per_point: f64 },
}

impl OutputScale {
    /// Ware grootte uit een schaalnoemer (`100` voor 1:100).
    pub fn from_denominator(denominator: f64) -> Self {
        OutputScale::RealWorldMm { mm_per_point: denominator * MM_PER_POINT }
    }

    /// Ware grootte uit de maatvoering van de app: `pixels_per_unit` is het
    /// aantal PDF-punten per eenheid, `mm_per_unit` de lengte van die eenheid.
    pub fn from_points_per_unit(points_per_unit: f64, mm_per_unit: f64) -> Self {
        OutputScale::RealWorldMm { mm_per_point: mm_per_unit / points_per_unit }
    }

    pub fn mm_per_point(&self) -> f64 {
        match *self {
            OutputScale::PaperMm => MM_PER_POINT,
            OutputScale::RealWorldMm { mm_per_point } => mm_per_point,
        }
    }

    /// Schaalnoemer N van 1:N (1 bij papiermaat).
    pub fn denominator(&self) -> f64 {
        self.mm_per_point() / MM_PER_POINT
    }
}

/// Volledige afbeelding van gebruikersruimte naar uitvoer-millimeters.
#[derive(Clone, Copy, Debug)]
pub struct OutputTransform {
    pub matrix: Matrix,
    /// Van de weergegeven pagina (punten, oorsprong linksonder) naar uitvoer.
    pub display_matrix: Matrix,
    /// Tekeneenheden (mm in de uitvoer) per gebruikersruimte-eenheid.
    pub units_per_user_unit: f64,
    /// Millimeters op papier per gebruikersruimte-eenheid; onafhankelijk van de
    /// uitvoerschaal. Lijndiktes en toleranties zijn papiermaten.
    pub paper_mm_per_user_unit: f64,
}

impl OutputTransform {
    pub fn new(frame: &PageFrame, scale: OutputScale) -> Self {
        Self::with_post(frame, scale, DrawingUnit::Mm, Point::new(0.0, 0.0), (0.0, 0.0))
    }

    /// Met eenheid, oorsprong en verschuiving: `origin_mm` (millimeters op de
    /// schaal van de uitvoer, vóór de eenheid) wordt (0,0), daarna volgt de
    /// omrekening naar `unit` en de verschuiving `offset` in die eenheid.
    pub fn with_post(frame: &PageFrame, scale: OutputScale, unit: DrawingUnit, origin_mm: Point, offset: (f64, f64)) -> Self {
        let k = scale.mm_per_point();
        let u = 1.0 / unit.mm_per_unit();
        let post = Matrix::translate(-origin_mm.x, -origin_mm.y)
            .then(&Matrix::scale(u, u))
            .then(&Matrix::translate(offset.0, offset.1));
        let display_matrix = Matrix::scale(k, k).then(&post);
        let matrix = frame.to_display_points().then(&display_matrix);
        OutputTransform {
            matrix,
            display_matrix,
            units_per_user_unit: k * u * frame.user_unit,
            paper_mm_per_user_unit: MM_PER_POINT * frame.user_unit,
        }
    }

    /// De terugweg naar CAD. `page_to_model` beeldt de gebruikersruimte van de
    /// pagina af op het model van de oorspronkelijke tekening
    /// (`/OPS_ModelMatrix`), met schaal, draaiing en verschuiving ineen.
    ///
    /// Het antwoord heeft twee delen. Het eerste is een gewone afbeelding naar
    /// een tussenruimte op de schaal van het model, maar nog langs de assen van
    /// de weergegeven pagina en met de oorsprong linksonder: daar kan de
    /// omzetter op een rechthoek knippen en met kleine getallen rekenen. Het
    /// tweede deel brengt die tussenruimte naar het model (draaien en
    /// verschuiven, zonder nog te schalen) en hoort helemaal aan het eind. Bij
    /// landelijke coördinaten komt de grote verschuiving er zo pas bij als al
    /// het rekenwerk gedaan is.
    ///
    /// `None` als de matrix ontaard is.
    pub fn from_model(frame: &PageFrame, page_to_model: Matrix) -> Option<(OutputTransform, Matrix)> {
        let display_to_model = frame.to_display_points().inverse()?.then(&page_to_model);
        let units_per_point = display_to_model.determinant().abs().sqrt();
        if !(units_per_point.is_finite() && units_per_point > 0.0) {
            return None;
        }
        let aligned = OutputTransform::with_post(
            frame,
            OutputScale::RealWorldMm { mm_per_point: units_per_point },
            DrawingUnit::Mm,
            Point::new(0.0, 0.0),
            (0.0, 0.0),
        );
        let to_model = Matrix::scale(1.0 / units_per_point, 1.0 / units_per_point).then(&display_to_model);
        [to_model.a, to_model.b, to_model.c, to_model.d, to_model.e, to_model.f].iter().all(|v| v.is_finite()).then_some((aligned, to_model))
    }

    /// Punt op de weergegeven pagina (punten) naar uitvoer.
    pub fn display_to_output(&self, p: Point) -> Point {
        self.display_matrix.apply(p)
    }

    pub fn apply(&self, p: Point) -> Point {
        self.matrix.apply(p)
    }

    /// Tekeneenheden per papier-millimeter (de schaalnoemer).
    pub fn units_per_paper_mm(&self) -> f64 {
        self.units_per_user_unit / self.paper_mm_per_user_unit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    fn assert_pt(p: Point, x: f64, y: f64) {
        assert!(close(p.x, x) && close(p.y, y), "kreeg ({}, {}), verwacht ({x}, {y})", p.x, p.y);
    }

    #[test]
    fn the_way_back_to_the_model_is_split_into_a_scale_and_a_turn() {
        // 1:100 in mm, 30° gedraaid, op landelijke coördinaten.
        let k = 100.0 * MM_PER_POINT;
        let (sin, cos) = 30f64.to_radians().sin_cos();
        let page_to_model = Matrix::scale(k, k).then(&Matrix::new(cos, sin, -sin, cos, 155_000_000.0, 463_000_000.0));
        for frame in [
            PageFrame::new(PdfRect::new(0.0, 0.0, 842.0, 595.0), None, 0, 1.0),
            // Een pagina die later gedraaid en bijgesneden is: de matrix geldt
            // in de gebruikersruimte, niet in de weergave.
            PageFrame::new(PdfRect::new(-100.0, -50.0, 742.0, 545.0), None, 90, 1.0),
            PageFrame::new(PdfRect::new(0.0, 0.0, 842.0, 595.0), Some(PdfRect::new(100.0, 100.0, 500.0, 400.0)), 270, 1.0),
        ] {
            let (aligned, to_model) = OutputTransform::from_model(&frame, page_to_model).expect("afbeelding");
            // Eerste stap: alleen schalen, langs de assen van de weergave.
            let d = aligned.display_matrix;
            assert!(close(d.a, k) && close(d.d, k) && close(d.b, 0.0) && close(d.c, 0.0) && close(d.e, 0.0) && close(d.f, 0.0));
            assert!(close(aligned.units_per_paper_mm(), 100.0));
            // Tweede stap: draaien en verschuiven, zonder nog te schalen.
            assert!(close(to_model.determinant().abs(), 1.0));
            // Samen precies de matrix van de pagina.
            for p in [Point::new(0.0, 0.0), Point::new(300.0, 120.5), Point::new(842.0, 595.0)] {
                let (got, wanted) = (to_model.apply(aligned.apply(p)), page_to_model.apply(p));
                assert!(got.distance(wanted) < 1e-6, "{got:?} tegen {wanted:?}");
            }
        }
        let flat = PageFrame::new(PdfRect::new(0.0, 0.0, 842.0, 595.0), None, 0, 1.0);
        assert!(OutputTransform::from_model(&flat, Matrix::scale(0.0, 1.0)).is_none());
        assert!(OutputTransform::from_model(&flat, Matrix::scale(f64::NAN, 1.0)).is_none());
    }

    #[test]
    fn points_to_mm_constant() {
        assert!(close(72.0 * MM_PER_POINT, 25.4));
        // A4: 595,276 × 841,890 pt = 210 × 297 mm.
        assert!((595.275_590_551 * MM_PER_POINT - 210.0).abs() < 1e-6);
    }

    #[test]
    fn unrotated_page_subtracts_box_origin() {
        let frame = PageFrame::new(PdfRect::new(-846.24, -595.26, 846.24, 595.26), None, 0, 1.0);
        let m = frame.to_display_points();
        assert_pt(m.apply(Point::new(-846.24, -595.26)), 0.0, 0.0);
        assert_pt(m.apply(Point::new(846.24, 595.26)), 1692.48, 1190.52);
        assert_pt(m.apply(Point::new(0.0, 0.0)), 846.24, 595.26);
    }

    #[test]
    fn rotate_90_maps_corners_clockwise() {
        // Box 100 breed, 200 hoog; weergegeven 200 breed, 100 hoog.
        let frame = PageFrame::new(PdfRect::new(0.0, 0.0, 100.0, 200.0), None, 90, 1.0);
        assert_eq!(frame.display_size_pt(), (200.0, 100.0));
        let m = frame.to_display_points();
        assert_pt(m.apply(Point::new(0.0, 0.0)), 0.0, 100.0); // linksonder → linksboven
        assert_pt(m.apply(Point::new(100.0, 0.0)), 0.0, 0.0); // rechtsonder → linksonder
        assert_pt(m.apply(Point::new(100.0, 200.0)), 200.0, 0.0); // rechtsboven → rechtsonder
        assert_pt(m.apply(Point::new(0.0, 200.0)), 200.0, 100.0); // linksboven → rechtsboven
    }

    #[test]
    fn rotate_180_and_270_map_corners() {
        let b = PdfRect::new(10.0, 20.0, 110.0, 220.0); // 100 × 200, oorsprong verschoven
        let m180 = PageFrame::new(b, None, 180, 1.0).to_display_points();
        assert_pt(m180.apply(Point::new(10.0, 20.0)), 100.0, 200.0);
        assert_pt(m180.apply(Point::new(110.0, 220.0)), 0.0, 0.0);

        let f270 = PageFrame::new(b, None, 270, 1.0);
        assert_eq!(f270.display_size_pt(), (200.0, 100.0));
        let m270 = f270.to_display_points();
        assert_pt(m270.apply(Point::new(10.0, 20.0)), 200.0, 0.0); // linksonder → rechtsonder
        assert_pt(m270.apply(Point::new(10.0, 220.0)), 0.0, 0.0); // linksboven → linksonder
        assert_pt(m270.apply(Point::new(110.0, 20.0)), 200.0, 100.0); // rechtsonder → rechtsboven
    }

    #[test]
    fn negative_rotation_and_multiples_normalise() {
        let b = PdfRect::new(0.0, 0.0, 100.0, 200.0);
        assert_eq!(PageFrame::new(b, None, -90, 1.0).rotate, 270);
        assert_eq!(PageFrame::new(b, None, 450, 1.0).rotate, 90);
        assert_eq!(PageFrame::new(b, None, 45, 1.0).rotate, 0);
    }

    #[test]
    fn crop_box_inside_media_box_is_the_view_box() {
        let media = PdfRect::new(0.0, 0.0, 1000.0, 800.0);
        let crop = PdfRect::new(100.0, 80.0, 900.0, 720.0);
        let frame = PageFrame::new(media, Some(crop), 0, 1.0);
        assert_eq!(frame.view_box, crop);
        assert_pt(frame.to_display_points().apply(Point::new(100.0, 80.0)), 0.0, 0.0);
    }

    #[test]
    fn crop_box_is_clamped_to_media_box() {
        let media = PdfRect::new(0.0, 0.0, 100.0, 100.0);
        let crop = PdfRect::new(-50.0, 10.0, 60.0, 500.0);
        let frame = PageFrame::new(media, Some(crop), 0, 1.0);
        assert_eq!(frame.view_box, PdfRect::new(0.0, 10.0, 60.0, 100.0));
    }

    #[test]
    fn output_transform_paper_scale_gives_mm() {
        let frame = PageFrame::new(PdfRect::new(0.0, 0.0, 720.0, 720.0), None, 0, 1.0);
        let t = OutputTransform::new(&frame, OutputScale::PaperMm);
        assert_pt(t.apply(Point::new(72.0, 144.0)), 25.4, 50.8);
    }

    #[test]
    fn output_transform_real_world_scale() {
        let frame = PageFrame::new(PdfRect::new(0.0, 0.0, 720.0, 720.0), None, 0, 1.0);
        let scale = OutputScale::from_denominator(100.0);
        assert!(close(scale.denominator(), 100.0));
        let t = OutputTransform::new(&frame, scale);
        // 72 pt = 25,4 mm papier = 2540 mm werkelijk bij 1:100.
        assert_pt(t.apply(Point::new(72.0, 0.0)), 2540.0, 0.0);
    }

    #[test]
    fn scale_from_app_points_per_unit() {
        // De app bewaart 1:100 in meters als 72 / 25,4 / 100 × 1000 punten per meter.
        let ppu = (72.0 / 25.4) / 100.0 * 1000.0;
        let scale = OutputScale::from_points_per_unit(ppu, 1000.0);
        assert!(close(scale.denominator(), 100.0));
    }

    #[test]
    fn user_unit_scales_output() {
        let frame = PageFrame::new(PdfRect::new(0.0, 0.0, 100.0, 100.0), None, 0, 2.0);
        let t = OutputTransform::new(&frame, OutputScale::PaperMm);
        assert_pt(t.apply(Point::new(72.0, 0.0)), 50.8, 0.0);
    }

    #[test]
    fn rotated_page_turns_directions_clockwise() {
        let b = PdfRect::new(0.0, 0.0, 100.0, 200.0);
        let t = OutputTransform::new(&PageFrame::new(b, None, 90, 1.0), OutputScale::PaperMm);
        // Een horizontale vector in gebruikersruimte wijst na 90° met de klok mee omlaag.
        let (p0, p1) = (t.apply(Point::new(0.0, 0.0)), t.apply(Point::new(10.0, 0.0)));
        assert!(close(p1.x - p0.x, 0.0) && p1.y < p0.y);
        assert!(close(t.matrix.x_axis_angle(), -std::f64::consts::FRAC_PI_2));
    }

    #[test]
    fn paper_and_output_scale_are_separate() {
        let frame = PageFrame::new(PdfRect::new(0.0, 0.0, 100.0, 100.0), None, 0, 1.0);
        let t = OutputTransform::new(&frame, OutputScale::from_denominator(50.0));
        assert!(close(t.paper_mm_per_user_unit, MM_PER_POINT));
        assert!(close(t.units_per_user_unit, 50.0 * MM_PER_POINT));
        assert!(close(t.units_per_paper_mm(), 50.0));
    }

    #[test]
    fn units_origin_and_offset_are_applied_after_scale() {
        let frame = PageFrame::new(PdfRect::new(0.0, 0.0, 720.0, 720.0), None, 0, 1.0);
        let origin = Point::new(25.4, 0.0); // 72 pt in papier-mm
        let t = OutputTransform::with_post(&frame, OutputScale::PaperMm, DrawingUnit::Cm, origin, (5.0, 7.0));
        // 144 pt = 50,8 mm; min oorsprong 25,4 = 25,4 mm = 2,54 cm; plus 5.
        assert_pt(t.apply(Point::new(144.0, 0.0)), 7.54, 7.0);
        assert!(close(t.units_per_user_unit, MM_PER_POINT / 10.0));
        assert_pt(t.display_to_output(Point::new(72.0, 72.0)), 5.0, 9.54);
    }

    #[test]
    fn insunits_round_trip() {
        for unit in [DrawingUnit::Mm, DrawingUnit::Cm, DrawingUnit::M, DrawingUnit::In, DrawingUnit::Ft] {
            assert_eq!(DrawingUnit::from_insunits(unit.insunits()), Some(unit));
        }
        assert_eq!(DrawingUnit::from_insunits(0), None);
    }
}
