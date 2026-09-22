//! Ruwe pagina-inhoud zoals PDFium die levert, al omgezet naar
//! PDF-gebruikersruimte van de pagina (alle object- en formuliermatrices zijn
//! toegepast), maar nog zonder paginarotatie, eenheden of vereenvoudiging.

use crate::geom::{Matrix, Point};
use std::sync::Arc;

/// Kleur zoals PDFium die na kleurruimte-omzetting teruggeeft.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const BLACK: Rgba = Rgba { r: 0, g: 0, b: 0, a: 255 };

    pub fn hex(&self) -> String {
        format!("{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }
}

/// Eén stap van een deelpad. Het beginpunt staat in [`SubPath::start`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Segment {
    Line(Point),
    /// Kubische Bézier: twee stuurpunten en het eindpunt.
    Cubic(Point, Point, Point),
}

impl Segment {
    pub fn end(&self) -> Point {
        match *self {
            Segment::Line(p) | Segment::Cubic(_, _, p) => p,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SubPath {
    pub start: Point,
    pub segments: Vec<Segment>,
    pub closed: bool,
}

impl SubPath {
    pub fn has_curves(&self) -> bool {
        self.segments.iter().any(|s| matches!(s, Segment::Cubic(..)))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct StrokeStyle {
    pub color: Rgba,
    /// Lijndikte in gebruikersruimte-eenheden van de pagina (matrix toegepast).
    pub width: f64,
    /// Streeppatroon (aan, uit, aan, …) in gebruikersruimte-eenheden; leeg =
    /// doorgetrokken.
    pub dash: Vec<f64>,
    pub dash_phase: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FillRule {
    NonZero,
    EvenOdd,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FillStyle {
    pub color: Rgba,
    pub rule: FillRule,
}

/// Waar een object bij hoort, voor de laagindeling.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum LayerHint {
    /// Naam van de optionele-inhoudsgroep (PDF-laag), eigen of geërfd van het
    /// omhullende formulier-XObject.
    Ocg(Arc<str>),
    /// Weergave van een annotatie; de naam is de soort (bijvoorbeeld `Square`
    /// of het eigen type van de app zoals `measureDistance`).
    Annotation(Arc<str>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct RawPath {
    pub subpaths: Vec<SubPath>,
    pub stroke: Option<StrokeStyle>,
    pub fill: Option<FillStyle>,
    pub layer: Option<LayerHint>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RawText {
    pub text: String,
    /// Tekstmatrix × alle bovenliggende matrices: van tekstruimte (1 eenheid =
    /// 1 em bij lettergrootte 1) naar gebruikersruimte van de pagina.
    pub matrix: Matrix,
    pub font_size: f64,
    pub font_name: String,
    pub color: Rgba,
    /// PDF-tekstweergavemodus; 3 = onzichtbaar (bijvoorbeeld een OCR-laag).
    pub render_mode: i32,
    pub layer: Option<LayerHint>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RawImage {
    /// Beeldmatrix: het eenheidsvierkant (0,0)–(1,1) naar gebruikersruimte.
    pub matrix: Matrix,
    pub pixel_width: u32,
    pub pixel_height: u32,
    pub layer: Option<LayerHint>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RawItem {
    Path(RawPath),
    Text(RawText),
    Image(RawImage),
}

/// Tellingen van wat de extractie tegenkwam; gaat ongewijzigd mee in het
/// exportrapport zodat zichtbaar is wat níét is omgezet.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct ExtractStats {
    /// Tijd die PDFium nodig had om de pagina te parsen.
    pub load_page_ms: u64,
    /// Tijd voor het opbouwen van de tekstpagina en de teken-naar-object-tabel.
    pub text_page_ms: u64,
    pub path_objects: u64,
    pub text_objects: u64,
    pub image_objects: u64,
    pub shading_objects: u64,
    pub form_objects: u64,
    pub max_form_depth: u32,
    pub path_segments: u64,
    pub bezier_segments: u64,
    /// Objecten met een `/OC`-markering (eigen of geërfd).
    pub objects_with_ocg: u64,
    /// Annotaties waarvan de weergave is meegenomen.
    pub annotations: u64,
    /// Objecten met een knippad waarvan de omhullende kleiner is dan het object
    /// zelf: daar toont de PDF minder dan de export bevat.
    pub objects_clipped: u64,
}
