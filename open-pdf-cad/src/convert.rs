//! Van ruwe pagina-inhoud naar het CAD-neutrale model: eenheden en rotatie,
//! krommen afvlakken of behouden, collineaire punten samenvoegen, lagen en
//! lijntypen toekennen.

use crate::clip::ClipRect;
use crate::geom::{dedup_points, merge_collinear, CubicBezier, Matrix, Point};
use crate::model::*;
use crate::page_space::{DrawingUnit, OutputScale, OutputTransform, PageFrame};
use crate::raw::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CurveMode {
    /// Krommen worden polylijnen binnen de opgegeven tolerantie.
    #[default]
    Flatten,
    /// Krommen blijven exact behouden als SPLINE (graad 3).
    Spline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerStrategy {
    /// PDF-laag (OCG) als die er is, anders kleur en lijndikte.
    #[default]
    OcgThenStyle,
    /// Altijd op kleur en lijndikte.
    Style,
    /// Alles op één laag.
    Single,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FillMode {
    /// Gevulde vlakken overslaan.
    Skip,
    /// Alleen de omtrek als gesloten polylijn.
    Outline,
    /// Effen HATCH.
    #[default]
    Hatch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextMode {
    Skip,
    #[default]
    Text,
}

/// Welk punt de oorsprong (0,0) van de tekening wordt.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginMode {
    /// Linksonder van de weergegeven pagina.
    #[default]
    Page,
    /// Linksonder van het gekozen gebied.
    Area,
    /// De oorspronkelijke modelcoördinaten van een geïmporteerde pagina
    /// (`/OPS_ModelMatrix`, zie [`crate::model_space`]). De matrix en
    /// `/OPS_ModelUnits` bepalen dan de schaal, de eenheid, de draaiing en de
    /// verschuiving; `scale`, `units` en `offset` tellen niet mee.
    Model,
}

/// Rechthoek op de weergegeven pagina, in punten, oorsprong linksonder.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AreaRect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

/// Opties voor het omzetten van één pagina.
#[derive(Clone, Debug, PartialEq)]
pub struct ConvertOptions {
    pub scale: OutputScale,
    pub curves: CurveMode,
    /// Grootste afwijking bij het afvlakken, in millimeters **op papier**. Bij
    /// uitvoer op ware grootte schaalt de tolerantie mee met de schaalnoemer.
    pub curve_tolerance_paper_mm: f64,
    pub merge_collinear: bool,
    /// Afstand tot de verbindingslijn waaronder een tussenpunt vervalt, in
    /// millimeters op papier.
    pub collinear_tolerance_paper_mm: f64,
    /// Opeenvolgende lijnstukken met dezelfde stijl die kop-aan-staart
    /// aansluiten tot één polylijn rijgen. CAD-plots schrijven een doorlopende
    /// lijn vaak als losse stukjes; zo komt ze weer als één object terug en
    /// blijft het aantal entiteiten (en daarmee het geheugen) beperkt.
    pub join_connected: bool,
    pub layers: LayerStrategy,
    pub fills: FillMode,
    /// Vullingen overslaan die (vrijwel) de hele pagina bedekken: een witte
    /// paginagrond of een vlakvullend patroon dat PDFium als effen kleur
    /// teruggeeft. In een CAD-tekening is zo'n vlak alleen hinderlijk.
    pub skip_page_fills: bool,
    pub text: TextMode,
    /// Verhouding hoofdletterhoogte / lettergrootte. Een CAD-teksthoogte is de
    /// hoogte van hoofdletters, een PDF-lettergrootte de hoogte van het
    /// em-vierkant; voor gangbare schreefloze letters ligt de verhouding rond 0,72.
    pub text_height_factor: f64,
    /// Onzichtbare tekst (weergavemodus 3, bijvoorbeeld een OCR-laag) meenemen.
    pub include_invisible_text: bool,
    /// Tekeneenheid van de uitvoer.
    pub units: DrawingUnit,
    /// Alleen dit gebied exporteren; wat erbuiten valt wordt weggeknipt.
    pub area: Option<AreaRect>,
    pub origin: OriginMode,
    /// Verschuiving die bij alle coördinaten wordt opgeteld, in tekeneenheden
    /// (bijvoorbeeld om een tekening terug in landelijke coördinaten te zetten).
    pub offset: (f64, f64),
    /// Lagen die niet meegaan: de namen zoals de export ze maakt, niet
    /// hoofdlettergevoelig.
    pub excluded_layers: Vec<String>,
    /// Annotaties meenemen, elk op een laag `OPS_<soort>`.
    pub annotations: bool,
    /// De terugweg naar CAD; alleen gebruikt bij [`OriginMode::Model`]. De
    /// aanroeper leest hem van de pagina ([`crate::resolve_model_space`]): de
    /// omzetter zelf leest niets van schijf.
    pub model: Option<crate::model_space::ModelSpace>,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        ConvertOptions {
            scale: OutputScale::PaperMm,
            curves: CurveMode::Flatten,
            curve_tolerance_paper_mm: 0.01,
            merge_collinear: true,
            collinear_tolerance_paper_mm: 0.001,
            join_connected: true,
            layers: LayerStrategy::OcgThenStyle,
            fills: FillMode::Hatch,
            skip_page_fills: true,
            text: TextMode::Text,
            text_height_factor: TEXT_HEIGHT_FACTOR,
            include_invisible_text: false,
            units: DrawingUnit::Mm,
            area: None,
            origin: OriginMode::Page,
            offset: (0.0, 0.0),
            excluded_layers: Vec::new(),
            annotations: false,
            model: None,
        }
    }
}

/// Hoofdletterhoogte ÷ lettergrootte voor gangbare schreefloze letters. De
/// import gebruikt dezelfde verhouding andersom, zodat tekst een rondgang
/// PDF → CAD → PDF op dezelfde maat doorkomt.
pub const TEXT_HEIGHT_FACTOR: f64 = 0.72;

/// Voorvoegsel van de lagen met annotaties.
pub const ANNOTATION_LAYER_PREFIX: &str = "OPS_";

/// Laag in het telverslag van een pagina: wat de export zou maken.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LayerCount {
    pub name: String,
    pub color: Rgb,
    pub entities: u64,
    pub from_ocg: bool,
    pub from_annotation: bool,
}

/// Wat de omzetting opleverde en wat ze liet liggen.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ConvertStats {
    pub lines: u64,
    pub polylines: u64,
    pub splines: u64,
    pub hatches: u64,
    pub texts: u64,
    pub layers: u64,
    pub ocg_layers: u64,
    pub linetypes: u64,
    /// Punten die door het samenvoegen van collineaire segmenten vervielen.
    pub merged_points: u64,
    /// Punten die het afvlakken van krommen toevoegde.
    pub flattened_points: u64,
    /// Lijnstukken die aan een voorgaand stuk zijn geregen in plaats van een
    /// eigen entiteit te worden.
    pub joined_pieces: u64,
    pub skipped_images: u64,
    pub skipped_page_fills: u64,
    pub skipped_invisible_text: u64,
    pub skipped_degenerate_paths: u64,
}

/// Hoogste aantal punten in één aaneengeregen polylijn.
const MAX_JOINED_POINTS: usize = 4096;

/// Open polylijn die nog kan groeien met een aansluitend stuk.
struct PendingRun {
    layer: u32,
    color: Option<Rgb>,
    lineweight: Option<i16>,
    linetype: Option<u32>,
    points: Vec<Point>,
}

#[derive(Clone, Copy, PartialEq)]
enum StyleKind {
    Stroke,
    Fill,
    Text,
}

pub struct Converter {
    options: ConvertOptions,
    transform: OutputTransform,
    flatten_tolerance: f64,
    collinear_tolerance: f64,
    drawing: Drawing,
    layer_index: HashMap<String, u32>,
    linetype_index: HashMap<Vec<i64>, u32>,
    stats: ConvertStats,
    pending: Option<PendingRun>,
    join_tolerance: f64,
    min: Point,
    max: Point,
    /// Uitgesloten lagen, in hoofdletters.
    excluded: HashSet<String>,
    /// Het exportgebied in uitvoerruimte.
    clip: Option<ClipRect>,
    /// De weergegeven pagina in uitvoerruimte.
    page_rect: ClipRect,
    /// Alleen tellen: geen entiteiten bewaren (lagenoverzicht vooraf).
    counting_only: bool,
    /// Entiteiten per laag (index als in `drawing.layers`).
    layer_counts: Vec<u64>,
    /// Laag komt van een annotatie (index als in `drawing.layers`).
    annotation_layers: Vec<bool>,
    /// Bij [`OriginMode::Model`]: de tweede stap, van de uitgelijnde
    /// tussenruimte naar het model (zie [`OutputTransform::from_model`]).
    to_model: Option<Matrix>,
}

impl Converter {
    pub fn new(frame: &PageFrame, options: ConvertOptions) -> Self {
        // Oorsprong in papier-millimeters van de weergegeven pagina (vóór schaal):
        // linksonder van de pagina of van het gebied.
        let k_paper = options.scale.mm_per_point();
        let origin = match (options.origin, options.area) {
            (OriginMode::Area, Some(area)) => Point::new(area.x0.min(area.x1) * k_paper, area.y0.min(area.y1) * k_paper),
            _ => Point::new(0.0, 0.0),
        };
        // De terugweg naar CAD gaat in twee stappen: eerst op de schaal van het
        // model maar nog langs de assen van de pagina (daar werken het knippen
        // op het gebied, de toleranties en het aaneenrijgen), en helemaal aan
        // het eind de draaiing en de verschuiving naar het model. Zonder
        // terugweg (dat weigert `extract_page` al) blijft het de pagina.
        let model = match (options.origin, &options.model) {
            (OriginMode::Model, Some(model)) => {
                OutputTransform::from_model(frame, model.page_to_model).map(|(transform, to_model)| (transform, to_model, model.unit))
            }
            _ => None,
        };
        let mut options = options;
        let (transform, to_model) = match model {
            Some((transform, to_model, unit)) => {
                options.units = unit;
                (transform, Some(to_model))
            }
            None => (OutputTransform::with_post(frame, options.scale, options.units, origin, options.offset), None),
        };
        let per_paper_mm = transform.units_per_paper_mm();
        let (w_pt, h_pt) = frame.display_size_pt();
        let corner0 = transform.display_to_output(Point::new(0.0, 0.0));
        let corner1 = transform.display_to_output(Point::new(w_pt, h_pt));
        let page_rect = ClipRect::new(corner0.x, corner0.y, corner1.x, corner1.y);
        let clip = options.area.map(|a| {
            let p0 = transform.display_to_output(Point::new(a.x0, a.y0));
            let p1 = transform.display_to_output(Point::new(a.x1, a.y1));
            ClipRect::new(p0.x, p0.y, p1.x, p1.y)
        });
        let excluded = options.excluded_layers.iter().map(|n| n.trim().to_uppercase()).collect();
        let units = options.units;
        Converter {
            flatten_tolerance: options.curve_tolerance_paper_mm.max(1e-6) * per_paper_mm,
            collinear_tolerance: options.collinear_tolerance_paper_mm.max(0.0) * per_paper_mm,
            options,
            transform,
            drawing: Drawing {
                page_size: (page_rect.x1 - page_rect.x0, page_rect.y1 - page_rect.y0),
                units,
                ..Drawing::default()
            },
            layer_index: HashMap::new(),
            linetype_index: HashMap::new(),
            stats: ConvertStats::default(),
            pending: None,
            // Gedeelde eindpunten zijn in de bron hetzelfde getal; een miljoenste
            // papier-millimeter vangt alleen afronding in de matrixketen op.
            join_tolerance: 1e-6 * per_paper_mm,
            min: Point::new(f64::MAX, f64::MAX),
            max: Point::new(f64::MIN, f64::MIN),
            excluded,
            clip,
            page_rect,
            counting_only: false,
            layer_counts: Vec::new(),
            annotation_layers: Vec::new(),
            to_model,
        }
    }

    /// De schaal van de uitvoer zoals ze werkelijk is: bij de terugweg naar CAD
    /// volgt ze uit de matrix van de pagina, niet uit de opties.
    pub fn output_scale(&self) -> OutputScale {
        match self.to_model {
            Some(_) => OutputScale::RealWorldMm {
                mm_per_point: self.transform.units_per_paper_mm() * crate::page_space::MM_PER_POINT * self.options.units.mm_per_unit(),
            },
            None => self.options.scale,
        }
    }

    /// Omzetter die alleen telt: voor het lagenoverzicht vóór de export, zonder
    /// de entiteiten in het geheugen te houden.
    pub fn counting(frame: &PageFrame, options: ConvertOptions) -> Self {
        let mut converter = Converter::new(frame, options);
        converter.counting_only = true;
        converter
    }

    /// Aantal entiteiten per laag, in volgorde van ontstaan.
    pub fn layer_counts(&self) -> Vec<LayerCount> {
        self.drawing
            .layers
            .iter()
            .enumerate()
            .map(|(i, layer)| LayerCount {
                name: layer.name.clone(),
                color: layer.color,
                entities: self.layer_counts.get(i).copied().unwrap_or(0),
                from_ocg: layer.from_ocg,
                from_annotation: self.annotation_layers.get(i).copied().unwrap_or(false),
            })
            .collect()
    }

    /// Totaal aantal entiteiten tot nu toe.
    pub fn entity_count(&self) -> u64 {
        let s = &self.stats;
        s.lines + s.polylines + s.splines + s.hatches + s.texts
    }

    pub fn push(&mut self, item: RawItem) {
        match item {
            RawItem::Path(path) => self.push_path(path),
            RawItem::Text(text) => self.push_text(text),
            RawItem::Image(_) => self.stats.skipped_images += 1,
        }
    }

    /// Rondt af: wat nog op aansluiting wachtte gaat mee.
    pub fn flush(&mut self) {
        self.flush_pending();
    }

    pub fn finish(mut self) -> (Drawing, ConvertStats) {
        self.flush_pending();
        self.stats.layers = self.drawing.layers.len() as u64;
        self.stats.ocg_layers = self.drawing.layers.iter().filter(|l| l.from_ocg).count() as u64;
        self.stats.linetypes = self.drawing.linetypes.len() as u64;
        if let Some(to_model) = self.to_model {
            // De tweede stap van de terugweg: draaien en verschuiven naar het
            // model. De omhullende wordt opnieuw bepaald, want een gedraaide
            // rechthoek is geen rechthoek langs de assen meer.
            let turn = to_model.x_axis_angle();
            let grow = to_model.mean_scale();
            let mirrored = to_model.is_mirrored();
            let (mut min, mut max) = (Point::new(f64::MAX, f64::MAX), Point::new(f64::MIN, f64::MIN));
            for entity in &mut self.drawing.entities {
                let mut map = |p: &mut Point| {
                    *p = to_model.apply(*p);
                    min = Point::new(min.x.min(p.x), min.y.min(p.y));
                    max = Point::new(max.x.max(p.x), max.y.max(p.y));
                };
                match &mut entity.geometry {
                    Geometry::Line { start, end } => {
                        map(start);
                        map(end);
                    }
                    Geometry::Polyline { points, .. } => points.iter_mut().for_each(&mut map),
                    Geometry::BezierSpline { control_points } => control_points.iter_mut().for_each(&mut map),
                    Geometry::Hatch { loops } => loops.iter_mut().flatten().for_each(&mut map),
                    Geometry::Text { insert, rotation, height, .. } => {
                        if mirrored {
                            // Tekst in CAD is niet te spiegelen. Ze blijft
                            // leesbaar langs de gespiegelde regel; omdat haar
                            // bovenkant dan naar de andere kant wijst, begint
                            // ze bij de gespiegelde bovenrand en beslaat zo
                            // dezelfde plek als op de pagina.
                            let (sin, cos) = rotation.sin_cos();
                            *insert = Point::new(insert.x - sin * *height, insert.y + cos * *height);
                            *rotation = (to_model.b * cos + to_model.d * sin).atan2(to_model.a * cos + to_model.c * sin);
                        } else {
                            *rotation += turn;
                        }
                        map(insert);
                        *height *= grow;
                    }
                }
            }
            (self.min, self.max) = (min, max);
        }
        if self.min.x <= self.max.x {
            self.drawing.extents = Some((self.min, self.max));
        }
        (self.drawing, self.stats)
    }

    fn push_path(&mut self, path: RawPath) {
        let RawPath { subpaths, stroke, fill, layer: hint } = path;

        if let (Some(fill), true) = (fill, self.options.fills != FillMode::Skip) {
            let color = rgb(fill.color);
            let loops: Vec<Vec<Point>> = subpaths
                .iter()
                .map(|sub| self.outline(sub, true))
                .filter(|pts| pts.len() >= 3)
                .collect();
            if loops.is_empty() {
                self.stats.skipped_degenerate_paths += 1;
            } else if self.options.skip_page_fills && self.covers_page(&loops) {
                self.stats.skipped_page_fills += 1;
            } else if let Some((layer, color_override, _)) = self.layer_for(hint.as_ref(), StyleKind::Fill, color, 0) {
                match self.options.fills {
                    FillMode::Hatch => {
                        self.emit(layer, color_override, None, None, Geometry::Hatch { loops });
                    }
                    FillMode::Outline => {
                        for points in loops {
                            self.emit(layer, color_override, None, None, Geometry::Polyline { points, closed: true });
                        }
                    }
                    FillMode::Skip => {}
                }
            }
        }

        if let Some(stroke) = stroke {
            let color = rgb(stroke.color);
            let lineweight = snap_lineweight(stroke.width * self.transform.paper_mm_per_user_unit);
            if let Some((layer, color_override, weight_override)) =
                self.layer_for(hint.as_ref(), StyleKind::Stroke, color, lineweight)
            {
                let linetype = self.linetype_for(&stroke.dash);
                for sub in &subpaths {
                    self.push_stroked_subpath(sub, layer, color_override, weight_override, linetype);
                }
            }
        }
    }

    /// True als de omhullende van de lussen minstens 95% van de paginabreedte
    /// én van de paginahoogte beslaat.
    fn covers_page(&self, loops: &[Vec<Point>]) -> bool {
        let page = self.page_rect;
        let (mut min, mut max) = (Point::new(f64::MAX, f64::MAX), Point::new(f64::MIN, f64::MIN));
        for p in loops.iter().flatten() {
            min = Point::new(min.x.min(p.x), min.y.min(p.y));
            max = Point::new(max.x.max(p.x), max.y.max(p.y));
        }
        // Alleen het deel binnen de pagina telt.
        let width = max.x.min(page.x1) - min.x.max(page.x0);
        let height = max.y.min(page.y1) - min.y.max(page.y0);
        width >= 0.95 * (page.x1 - page.x0) && height >= 0.95 * (page.y1 - page.y0)
    }

    fn push_stroked_subpath(
        &mut self,
        sub: &SubPath,
        layer: u32,
        color: Option<Rgb>,
        lineweight: Option<i16>,
        linetype: Option<u32>,
    ) {
        if self.options.curves == CurveMode::Spline && sub.has_curves() {
            self.push_runs(sub, layer, color, lineweight, linetype);
            return;
        }
        let points = self.outline_points(sub, sub.closed);
        if sub.closed || !self.options.join_connected {
            let points = self.simplify(points, sub.closed);
            self.emit_polyline(points, sub.closed, layer, color, lineweight, linetype);
            return;
        }
        if points.len() < 2 {
            self.stats.skipped_degenerate_paths += 1;
            return;
        }
        if let Some(run) = self.pending.as_mut() {
            let same_style = run.layer == layer
                && run.color == color
                && run.lineweight == lineweight
                && run.linetype == linetype;
            let connects = run.points.last().is_some_and(|end| end.distance(points[0]) <= self.join_tolerance);
            if same_style && connects && run.points.len() + points.len() <= MAX_JOINED_POINTS {
                run.points.extend_from_slice(&points[1..]);
                self.stats.joined_pieces += 1;
                return;
            }
        }
        self.flush_pending();
        self.pending = Some(PendingRun { layer, color, lineweight, linetype, points });
    }

    /// Schrijft de open polylijn weg die nog op een aansluitend stuk wachtte.
    fn flush_pending(&mut self) {
        if let Some(run) = self.pending.take() {
            let points = self.simplify(run.points, false);
            self.emit_polyline(points, false, run.layer, run.color, run.lineweight, run.linetype);
        }
    }

    /// Krommen behouden: het deelpad valt uiteen in aaneengesloten reeksen
    /// rechte stukken (polylijn) en reeksen krommen (spline).
    fn push_runs(&mut self, sub: &SubPath, layer: u32, color: Option<Rgb>, lineweight: Option<i16>, linetype: Option<u32>) {
        let mut cursor = self.transform.apply(sub.start);
        let first = cursor;
        let mut line_run: Vec<Point> = vec![cursor];
        let mut curve_run: Vec<Point> = Vec::new();
        for segment in &sub.segments {
            match *segment {
                Segment::Line(p) => {
                    if !curve_run.is_empty() {
                        let control_points = std::mem::take(&mut curve_run);
                        self.emit(layer, color, lineweight, linetype, Geometry::BezierSpline { control_points });
                        line_run = vec![cursor];
                    }
                    cursor = self.transform.apply(p);
                    line_run.push(cursor);
                }
                Segment::Cubic(c1, c2, p) => {
                    if line_run.len() > 1 {
                        let points = std::mem::take(&mut line_run);
                        self.emit_polyline(points, false, layer, color, lineweight, linetype);
                    }
                    line_run.clear();
                    if curve_run.is_empty() {
                        curve_run.push(cursor);
                    }
                    cursor = self.transform.apply(p);
                    curve_run.extend([self.transform.apply(c1), self.transform.apply(c2), cursor]);
                }
            }
        }
        if !curve_run.is_empty() {
            self.emit(layer, color, lineweight, linetype, Geometry::BezierSpline { control_points: curve_run });
            line_run = vec![cursor];
        }
        // Sluitstuk van een gesloten deelpad.
        if sub.closed && cursor.distance(first) > 1e-9 {
            line_run.push(first);
        }
        if line_run.len() > 1 {
            self.emit_polyline(line_run, false, layer, color, lineweight, linetype);
        }
    }

    /// Punten van een deelpad in uitvoerruimte, krommen afgevlakt. Bij een
    /// gesloten deelpad staat het beginpunt niet nogmaals aan het eind.
    fn outline(&mut self, sub: &SubPath, closed: bool) -> Vec<Point> {
        let points = self.outline_points(sub, closed);
        self.simplify(points, closed)
    }

    fn simplify(&mut self, points: Vec<Point>, closed: bool) -> Vec<Point> {
        if !self.options.merge_collinear {
            return points;
        }
        let before = points.len();
        let points = merge_collinear(&points, self.collinear_tolerance, closed);
        self.stats.merged_points += (before - points.len()) as u64;
        points
    }

    fn outline_points(&mut self, sub: &SubPath, closed: bool) -> Vec<Point> {
        let mut points: Vec<Point> = Vec::with_capacity(sub.segments.len() + 1);
        let mut cursor = self.transform.apply(sub.start);
        points.push(cursor);
        for segment in &sub.segments {
            match *segment {
                Segment::Line(p) => {
                    cursor = self.transform.apply(p);
                    points.push(cursor);
                }
                Segment::Cubic(c1, c2, p) => {
                    let curve = CubicBezier {
                        p0: cursor,
                        p1: self.transform.apply(c1),
                        p2: self.transform.apply(c2),
                        p3: self.transform.apply(p),
                    };
                    let before = points.len();
                    curve.flatten_into(self.flatten_tolerance, &mut points);
                    self.stats.flattened_points += (points.len() - before).saturating_sub(1) as u64;
                    cursor = curve.p3;
                }
            }
        }
        let mut points = dedup_points(&points, 1e-9);
        if closed && points.len() > 1 && points[0].distance(*points.last().unwrap()) <= 1e-9 {
            points.pop();
        }
        points
    }

    fn emit_polyline(
        &mut self,
        points: Vec<Point>,
        closed: bool,
        layer: u32,
        color: Option<Rgb>,
        lineweight: Option<i16>,
        linetype: Option<u32>,
    ) {
        match points.len() {
            0 | 1 => self.stats.skipped_degenerate_paths += 1,
            2 => {
                let geometry = Geometry::Line { start: points[0], end: points[1] };
                self.emit(layer, color, lineweight, linetype, geometry);
            }
            _ => self.emit(layer, color, lineweight, linetype, Geometry::Polyline { points, closed }),
        }
    }

    fn push_text(&mut self, text: RawText) {
        if self.options.text == TextMode::Skip {
            return;
        }
        // Modus 3 = onzichtbaar, 7 = alleen knippad.
        if (text.render_mode == 3 || text.render_mode == 7) && !self.options.include_invisible_text {
            self.stats.skipped_invisible_text += 1;
            return;
        }
        let to_output = text.matrix.then(&self.transform.matrix);
        let height = text.font_size * to_output.y_scale() * self.options.text_height_factor;
        if !(height.is_finite() && height > 0.0) {
            self.stats.skipped_degenerate_paths += 1;
            return;
        }
        let insert = to_output.apply(Point::new(0.0, 0.0));
        let rotation = to_output.x_axis_angle();
        let width_factor = (to_output.x_scale() / to_output.y_scale()).clamp(0.05, 20.0);
        let Some((layer, color_override, _)) = self.layer_for(text.layer.as_ref(), StyleKind::Text, rgb(text.color), 0) else {
            return;
        };
        let geometry = Geometry::Text { insert, height, rotation, width_factor, value: text.text };
        self.emit(layer, color_override, None, None, geometry);
    }

    fn emit(&mut self, layer: u32, color: Option<Rgb>, lineweight: Option<i16>, linetype: Option<u32>, geometry: Geometry) {
        // Tekenvolgorde bewaren: wat nog wachtte gaat eerst.
        self.flush_pending();
        let Some(clip) = self.clip else {
            self.store(layer, color, lineweight, linetype, geometry);
            return;
        };
        match geometry {
            Geometry::Line { start, end } => {
                if let Some((a, b)) = clip.clip_segment(start, end) {
                    if a.distance(b) > 1e-12 {
                        self.store(layer, color, lineweight, linetype, Geometry::Line { start: a, end: b });
                    }
                }
            }
            Geometry::Polyline { points, closed } => {
                if clip.contains_all(&points) {
                    self.store(layer, color, lineweight, linetype, Geometry::Polyline { points, closed });
                } else if !clip.misses(&points) {
                    for piece in clip.clip_polyline(&points, closed) {
                        self.store_piece(layer, color, lineweight, linetype, piece);
                    }
                }
            }
            Geometry::BezierSpline { control_points } => {
                if clip.contains_all(&control_points) {
                    self.store(layer, color, lineweight, linetype, Geometry::BezierSpline { control_points });
                } else if !clip.misses(&control_points) {
                    // Gedeeltelijk binnen: afvlakken en als polylijn knippen.
                    let mut flat = vec![control_points[0]];
                    for chunk in control_points[1..].chunks_exact(3) {
                        let curve = CubicBezier { p0: *flat.last().unwrap(), p1: chunk[0], p2: chunk[1], p3: chunk[2] };
                        curve.flatten_into(self.flatten_tolerance, &mut flat);
                    }
                    for piece in clip.clip_polyline(&flat, false) {
                        self.store_piece(layer, color, lineweight, linetype, piece);
                    }
                }
            }
            Geometry::Hatch { loops } => {
                let loops: Vec<Vec<Point>> = loops
                    .into_iter()
                    .map(|l| if clip.contains_all(&l) { l } else { clip.clip_polygon(&l) })
                    .filter(|l| l.len() >= 3)
                    .collect();
                if !loops.is_empty() {
                    self.store(layer, color, lineweight, linetype, Geometry::Hatch { loops });
                }
            }
            Geometry::Text { insert, .. } => {
                if clip.contains(insert) {
                    self.store(layer, color, lineweight, linetype, geometry);
                }
            }
        }
    }

    fn store_piece(&mut self, layer: u32, color: Option<Rgb>, lineweight: Option<i16>, linetype: Option<u32>, piece: Vec<Point>) {
        match piece.len() {
            0 | 1 => {}
            2 => self.store(layer, color, lineweight, linetype, Geometry::Line { start: piece[0], end: piece[1] }),
            _ => {
                let closed = piece.len() > 3 && piece[0].distance(*piece.last().unwrap()) <= 1e-12;
                let mut points = piece;
                if closed {
                    points.pop();
                }
                self.store(layer, color, lineweight, linetype, Geometry::Polyline { points, closed });
            }
        }
    }

    fn store(&mut self, layer: u32, color: Option<Rgb>, lineweight: Option<i16>, linetype: Option<u32>, geometry: Geometry) {
        match geometry {
            Geometry::Line { .. } => self.stats.lines += 1,
            Geometry::Polyline { .. } => self.stats.polylines += 1,
            Geometry::BezierSpline { .. } => self.stats.splines += 1,
            Geometry::Hatch { .. } => self.stats.hatches += 1,
            Geometry::Text { .. } => self.stats.texts += 1,
        }
        let (mut min, mut max) = (self.min, self.max);
        geometry.for_each_point(|p| {
            min = Point::new(min.x.min(p.x), min.y.min(p.y));
            max = Point::new(max.x.max(p.x), max.y.max(p.y));
        });
        (self.min, self.max) = (min, max);
        if let Some(count) = self.layer_counts.get_mut(layer as usize) {
            *count += 1;
        }
        if !self.counting_only {
            self.drawing.entities.push(Entity { layer, color, lineweight, linetype, geometry });
        }
    }

    /// Laag voor een object plus de afwijkingen van die laag die het object zelf
    /// moet dragen (kleur, lijndikte); `None` in de afwijkingen betekent
    /// "volgens laag". Geeft `None` als de laag is uitgesloten.
    fn layer_for(
        &mut self,
        hint: Option<&LayerHint>,
        kind: StyleKind,
        color: Rgb,
        lineweight: i16,
    ) -> Option<(u32, Option<Rgb>, Option<i16>)> {
        let annotation = matches!(hint, Some(LayerHint::Annotation(_)));
        let (name, from_ocg) = match (self.options.layers, hint) {
            (_, Some(LayerHint::Annotation(kind))) => {
                (sanitize_layer_name(&format!("{ANNOTATION_LAYER_PREFIX}{kind}")), false)
            }
            (LayerStrategy::Single, _) => ("PDF".to_string(), false),
            (LayerStrategy::OcgThenStyle, Some(LayerHint::Ocg(ocg))) => (sanitize_layer_name(ocg), true),
            _ => (
                match kind {
                    StyleKind::Stroke => format!("PDF_{}_W{:03}", color.hex(), lineweight),
                    StyleKind::Fill => format!("PDF_FILL_{}", color.hex()),
                    StyleKind::Text => format!("PDF_TEXT_{}", color.hex()),
                },
                false,
            ),
        };
        // Laagnamen zijn in DXF/DWG niet hoofdlettergevoelig.
        let key = name.to_uppercase();
        if self.excluded.contains(&key) {
            return None;
        }
        let index = match self.layer_index.get(&key) {
            Some(&index) => index,
            None => {
                let index = self.drawing.layers.len() as u32;
                self.drawing.layers.push(Layer { name, color, lineweight, from_ocg });
                self.layer_counts.push(0);
                self.annotation_layers.push(annotation);
                self.layer_index.insert(key, index);
                index
            }
        };
        let layer = &self.drawing.layers[index as usize];
        let color_override = (layer.color != color).then_some(color);
        let weight_override = (kind == StyleKind::Stroke && layer.lineweight != lineweight).then_some(lineweight);
        Some((index, color_override, weight_override))
    }

    /// Lijntype voor een streeppatroon; `None` voor doorgetrokken. Gelijke
    /// patronen (op 0,001 tekeneenheid) delen één lijntype.
    fn linetype_for(&mut self, dash: &[f64]) -> Option<u32> {
        if dash.is_empty() {
            return None;
        }
        let k = self.transform.units_per_user_unit;
        let mut pattern: Vec<f64> = dash.iter().map(|&v| v * k).collect();
        if pattern.len() % 2 == 1 {
            // Oneven aantal: het patroon herhaalt zich met streep en ruimte verwisseld.
            pattern.extend(pattern.clone());
        }
        if pattern.iter().sum::<f64>() <= 0.0 {
            return None;
        }
        let key: Vec<i64> = pattern.iter().map(|&v| (v * 1000.0).round() as i64).collect();
        if let Some(&index) = self.linetype_index.get(&key) {
            return Some(index);
        }
        let index = self.drawing.linetypes.len() as u32;
        let description = pattern
            .iter()
            .map(|v| format!("{:.2}", v))
            .collect::<Vec<_>>()
            .join(" ");
        self.drawing.linetypes.push(Linetype {
            name: format!("PDF_DASH_{}", index + 1),
            description: format!("PDF-streeppatroon {description}"),
            pattern,
        });
        self.linetype_index.insert(key, index);
        Some(index)
    }
}

fn rgb(c: Rgba) -> Rgb {
    Rgb { r: c.r, g: c.g, b: c.b }
}

/// Maakt van een PDF-laagnaam een geldige DXF/DWG-laagnaam: verboden tekens
/// worden een onderstrepingsteken, de lengte blijft binnen 255 tekens.
pub fn sanitize_layer_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| match c {
            '<' | '>' | '/' | '\\' | '"' | ':' | ';' | '?' | '*' | '|' | '=' | ',' | '`' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .take(255)
        .collect();
    if cleaned.is_empty() { "PDF_LAAG".to_string() } else { cleaned }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::page_space::PdfRect;
    use std::sync::Arc;

    fn frame() -> PageFrame {
        PageFrame::new(PdfRect::new(0.0, 0.0, 720.0, 720.0), None, 0, 1.0)
    }

    fn stroke(width: f64, dash: Vec<f64>) -> Option<StrokeStyle> {
        Some(StrokeStyle { color: Rgba::BLACK, width, dash, dash_phase: 0.0 })
    }

    fn line_path(points: &[(f64, f64)], closed: bool) -> SubPath {
        SubPath {
            start: Point::new(points[0].0, points[0].1),
            segments: points[1..].iter().map(|&(x, y)| Segment::Line(Point::new(x, y))).collect(),
            closed,
        }
    }

    fn convert(items: Vec<RawItem>, options: ConvertOptions) -> (Drawing, ConvertStats) {
        let mut converter = Converter::new(&frame(), options);
        for item in items {
            converter.push(item);
        }
        converter.finish()
    }

    #[test]
    fn single_segment_becomes_line_in_mm() {
        let path = RawPath { subpaths: vec![line_path(&[(72.0, 72.0), (144.0, 72.0)], false)], stroke: stroke(0.709, vec![]), fill: None, layer: None };
        let (drawing, stats) = convert(vec![RawItem::Path(path)], ConvertOptions::default());
        assert_eq!(stats.lines, 1);
        match &drawing.entities[0].geometry {
            Geometry::Line { start, end } => {
                assert!((start.x - 25.4).abs() < 1e-9 && (start.y - 25.4).abs() < 1e-9);
                assert!((end.x - 50.8).abs() < 1e-9);
            }
            other => panic!("verwachtte LINE, kreeg {other:?}"),
        }
        // 0,709 pt = 0,25 mm.
        assert_eq!(drawing.layers[0].name, "PDF_000000_W025");
        assert_eq!(drawing.layers[0].lineweight, 25);
    }

    #[test]
    fn collinear_points_merge_only_when_enabled() {
        let make = || RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(0.0, 0.0), (10.0, 0.0), (20.0, 0.0), (20.0, 10.0)], false)],
            stroke: stroke(1.0, vec![]),
            fill: None,
            layer: None,
        });
        let (merged, stats) = convert(vec![make()], ConvertOptions::default());
        assert_eq!(stats.merged_points, 1);
        assert!(matches!(&merged.entities[0].geometry, Geometry::Polyline { points, .. } if points.len() == 3));

        let options = ConvertOptions { merge_collinear: false, ..ConvertOptions::default() };
        let (raw, stats) = convert(vec![make()], options);
        assert_eq!(stats.merged_points, 0);
        assert!(matches!(&raw.entities[0].geometry, Geometry::Polyline { points, .. } if points.len() == 4));
    }

    fn piece(points: &[(f64, f64)], width: f64) -> RawItem {
        RawItem::Path(RawPath { subpaths: vec![line_path(points, false)], stroke: stroke(width, vec![]), fill: None, layer: None })
    }

    #[test]
    fn connected_pieces_join_and_collinear_parts_merge_across_objects() {
        // Drie losse objecten: twee collineaire stukken en een haakse aansluiting.
        let items = vec![
            piece(&[(0.0, 0.0), (10.0, 0.0)], 1.0),
            piece(&[(10.0, 0.0), (20.0, 0.0)], 1.0),
            piece(&[(20.0, 0.0), (20.0, 10.0)], 1.0),
        ];
        let (drawing, stats) = convert(items, ConvertOptions::default());
        assert_eq!(drawing.entities.len(), 1);
        assert_eq!(stats.joined_pieces, 2);
        assert_eq!(stats.merged_points, 1);
        assert!(matches!(&drawing.entities[0].geometry, Geometry::Polyline { points, closed: false } if points.len() == 3));
    }

    #[test]
    fn pieces_with_another_style_or_a_gap_stay_separate() {
        let items = vec![
            piece(&[(0.0, 0.0), (10.0, 0.0)], 1.0),
            piece(&[(10.0, 0.0), (20.0, 0.0)], 2.0), // andere lijndikte
            piece(&[(20.5, 0.0), (30.0, 0.0)], 2.0), // sluit niet aan
        ];
        let (drawing, stats) = convert(items, ConvertOptions::default());
        assert_eq!(drawing.entities.len(), 3);
        assert_eq!(stats.joined_pieces, 0);
    }

    #[test]
    fn joining_can_be_switched_off() {
        let items = vec![piece(&[(0.0, 0.0), (10.0, 0.0)], 1.0), piece(&[(10.0, 0.0), (20.0, 5.0)], 1.0)];
        let options = ConvertOptions { join_connected: false, ..ConvertOptions::default() };
        let (drawing, _) = convert(items, options);
        assert_eq!(drawing.entities.len(), 2);
    }

    #[test]
    fn joining_keeps_draw_order_with_other_entities() {
        let fill = RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(0.0, 0.0), (5.0, 0.0), (5.0, 5.0)], true)],
            stroke: None,
            fill: Some(FillStyle { color: Rgba::BLACK, rule: FillRule::NonZero }),
            layer: None,
        });
        let items = vec![piece(&[(0.0, 0.0), (10.0, 0.0)], 1.0), fill, piece(&[(10.0, 0.0), (20.0, 5.0)], 1.0)];
        let (drawing, _) = convert(items, ConvertOptions::default());
        let kinds: Vec<&str> = drawing.entities.iter().map(|e| e.geometry.kind()).collect();
        assert_eq!(kinds, ["LINE", "HATCH", "LINE"]);
    }

    #[test]
    fn closed_rectangle_drops_duplicate_closing_point() {
        let sub = line_path(&[(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0), (0.0, 0.0)], true);
        let path = RawPath { subpaths: vec![sub], stroke: stroke(1.0, vec![]), fill: None, layer: None };
        let (drawing, _) = convert(vec![RawItem::Path(path)], ConvertOptions::default());
        assert!(matches!(&drawing.entities[0].geometry, Geometry::Polyline { points, closed: true } if points.len() == 4));
    }

    fn curve_path() -> RawPath {
        RawPath {
            subpaths: vec![SubPath {
                start: Point::new(100.0, 0.0),
                segments: vec![Segment::Cubic(Point::new(100.0, 55.2), Point::new(55.2, 100.0), Point::new(0.0, 100.0))],
                closed: false,
            }],
            stroke: stroke(1.0, vec![]),
            fill: None,
            layer: None,
        }
    }

    #[test]
    fn curves_flatten_by_default_and_tolerance_scales_with_output() {
        let (paper, _) = convert(vec![RawItem::Path(curve_path())], ConvertOptions::default());
        let count = |d: &Drawing| match &d.entities[0].geometry {
            Geometry::Polyline { points, .. } => points.len(),
            other => panic!("verwachtte polylijn, kreeg {other:?}"),
        };
        // Op ware grootte 1:100 is de tolerantie 100× zo groot in tekeneenheden,
        // de kromme ook: het aantal punten blijft dus gelijk.
        let options = ConvertOptions { scale: OutputScale::from_denominator(100.0), ..ConvertOptions::default() };
        let (real, _) = convert(vec![RawItem::Path(curve_path())], options);
        assert_eq!(count(&paper), count(&real));
        assert!(count(&paper) > 8);
    }

    #[test]
    fn spline_mode_keeps_exact_control_points() {
        let options = ConvertOptions { curves: CurveMode::Spline, ..ConvertOptions::default() };
        let (drawing, stats) = convert(vec![RawItem::Path(curve_path())], options);
        assert_eq!(stats.splines, 1);
        match &drawing.entities[0].geometry {
            Geometry::BezierSpline { control_points } => assert_eq!(control_points.len(), 4),
            other => panic!("verwachtte spline, kreeg {other:?}"),
        }
    }

    #[test]
    fn ocg_name_becomes_layer_and_style_is_fallback() {
        let ocg = LayerHint::Ocg(Arc::from("Topo|topo"));
        let with = RawPath { subpaths: vec![line_path(&[(0.0, 0.0), (5.0, 5.0)], false)], stroke: stroke(1.0, vec![]), fill: None, layer: Some(ocg) };
        let without = RawPath { subpaths: vec![line_path(&[(0.0, 0.0), (5.0, 5.0)], false)], stroke: stroke(1.0, vec![]), fill: None, layer: None };
        let (drawing, stats) = convert(vec![RawItem::Path(with), RawItem::Path(without)], ConvertOptions::default());
        assert_eq!(drawing.layers[0].name, "Topo_topo");
        assert!(drawing.layers[0].from_ocg);
        assert!(drawing.layers[1].name.starts_with("PDF_000000_W"));
        assert_eq!(stats.ocg_layers, 1);
    }

    #[test]
    fn second_style_on_an_ocg_layer_is_carried_by_the_entity() {
        let ocg = LayerHint::Ocg(Arc::from("Wanden"));
        let red = StrokeStyle { color: Rgba { r: 255, g: 0, b: 0, a: 255 }, width: 2.0, dash: vec![], dash_phase: 0.0 };
        let first = RawPath { subpaths: vec![line_path(&[(0.0, 0.0), (5.0, 5.0)], false)], stroke: stroke(1.0, vec![]), fill: None, layer: Some(ocg.clone()) };
        let second = RawPath { subpaths: vec![line_path(&[(0.0, 0.0), (5.0, 5.0)], false)], stroke: Some(red), fill: None, layer: Some(ocg) };
        let (drawing, _) = convert(vec![RawItem::Path(first), RawItem::Path(second)], ConvertOptions::default());
        assert_eq!(drawing.layers.len(), 1);
        assert_eq!(drawing.entities[0].color, None);
        assert_eq!(drawing.entities[1].color, Some(Rgb { r: 255, g: 0, b: 0 }));
        assert!(drawing.entities[1].lineweight.is_some());
    }

    #[test]
    fn dash_pattern_becomes_shared_linetype_in_drawing_units() {
        let make = || RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(0.0, 0.0), (50.0, 0.0)], false)],
            stroke: stroke(1.0, vec![7.2, 3.6]),
            fill: None,
            layer: None,
        });
        let (drawing, stats) = convert(vec![make(), make()], ConvertOptions::default());
        assert_eq!(stats.linetypes, 1);
        assert_eq!(drawing.entities[0].linetype, Some(0));
        assert_eq!(drawing.entities[1].linetype, Some(0));
        let pattern = &drawing.linetypes[0].pattern;
        assert!((pattern[0] - 2.54).abs() < 1e-9 && (pattern[1] - 1.27).abs() < 1e-9);
    }

    #[test]
    fn odd_dash_array_is_doubled() {
        let path = RawPath { subpaths: vec![line_path(&[(0.0, 0.0), (50.0, 0.0)], false)], stroke: stroke(1.0, vec![3.0]), fill: None, layer: None };
        let (drawing, _) = convert(vec![RawItem::Path(path)], ConvertOptions::default());
        assert_eq!(drawing.linetypes[0].pattern.len(), 2);
    }

    #[test]
    fn fill_becomes_hatch_with_one_loop_per_subpath() {
        let outer = line_path(&[(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)], true);
        let hole = line_path(&[(40.0, 40.0), (60.0, 40.0), (60.0, 60.0), (40.0, 60.0)], true);
        let path = RawPath {
            subpaths: vec![outer, hole],
            stroke: None,
            fill: Some(FillStyle { color: Rgba { r: 200, g: 200, b: 200, a: 255 }, rule: FillRule::EvenOdd }),
            layer: None,
        };
        let (drawing, stats) = convert(vec![RawItem::Path(path)], ConvertOptions::default());
        assert_eq!(stats.hatches, 1);
        assert!(matches!(&drawing.entities[0].geometry, Geometry::Hatch { loops } if loops.len() == 2));
        assert_eq!(drawing.layers[0].name, "PDF_FILL_C8C8C8");
    }

    #[test]
    fn page_covering_fill_is_skipped_unless_asked() {
        let make = || RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(0.0, 0.0), (720.0, 0.0), (720.0, 720.0), (0.0, 720.0)], true)],
            stroke: None,
            fill: Some(FillStyle { color: Rgba { r: 255, g: 255, b: 255, a: 255 }, rule: FillRule::NonZero }),
            layer: None,
        });
        let (drawing, stats) = convert(vec![make()], ConvertOptions::default());
        assert!(drawing.entities.is_empty());
        assert_eq!(stats.skipped_page_fills, 1);

        let options = ConvertOptions { skip_page_fills: false, ..ConvertOptions::default() };
        let (drawing, stats) = convert(vec![make()], options);
        assert_eq!(drawing.entities.len(), 1);
        assert_eq!(stats.skipped_page_fills, 0);
    }

    #[test]
    fn text_height_rotation_and_position() {
        use crate::geom::Matrix;
        let angle = 90f64.to_radians();
        let text = RawText {
            text: "A-01".into(),
            matrix: Matrix::new(angle.cos(), angle.sin(), -angle.sin(), angle.cos(), 72.0, 144.0),
            font_size: 10.0,
            font_name: "Arial".into(),
            color: Rgba::BLACK,
            render_mode: 0,
            layer: None,
        };
        let options = ConvertOptions { text_height_factor: 1.0, ..ConvertOptions::default() };
        let (drawing, stats) = convert(vec![RawItem::Text(text)], options);
        assert_eq!(stats.texts, 1);
        match &drawing.entities[0].geometry {
            Geometry::Text { insert, height, rotation, width_factor, value } => {
                assert!((width_factor - 1.0).abs() < 1e-9);
                assert!((insert.x - 25.4).abs() < 1e-9 && (insert.y - 50.8).abs() < 1e-9);
                assert!((height - 10.0 * 25.4 / 72.0).abs() < 1e-9);
                assert!((rotation - angle).abs() < 1e-9);
                assert_eq!(value, "A-01");
            }
            other => panic!("verwachtte tekst, kreeg {other:?}"),
        }
    }

    #[test]
    fn condensed_text_keeps_height_and_gets_width_factor() {
        use crate::geom::Matrix;
        let text = RawText {
            text: "150 mm.".into(),
            matrix: Matrix::new(0.8, 0.0, 0.0, 1.0, 0.0, 0.0),
            font_size: 10.0,
            font_name: String::new(),
            color: Rgba::BLACK,
            render_mode: 0,
            layer: None,
        };
        let options = ConvertOptions { text_height_factor: 1.0, ..ConvertOptions::default() };
        let (drawing, _) = convert(vec![RawItem::Text(text)], options);
        match &drawing.entities[0].geometry {
            Geometry::Text { height, width_factor, .. } => {
                assert!((height - 10.0 * 25.4 / 72.0).abs() < 1e-9);
                assert!((width_factor - 0.8).abs() < 1e-9);
            }
            other => panic!("verwachtte tekst, kreeg {other:?}"),
        }
    }

    #[test]
    fn invisible_text_is_skipped_by_default() {
        use crate::geom::Matrix;
        let text = RawText { text: "ocr".into(), matrix: Matrix::IDENTITY, font_size: 10.0, font_name: String::new(), color: Rgba::BLACK, render_mode: 3, layer: None };
        let (drawing, stats) = convert(vec![RawItem::Text(text)], ConvertOptions::default());
        assert!(drawing.entities.is_empty());
        assert_eq!(stats.skipped_invisible_text, 1);
    }

    #[test]
    fn layer_names_are_sanitized() {
        assert_eq!(sanitize_layer_name("Topo|topo"), "Topo_topo");
        assert_eq!(sanitize_layer_name("  a<b>c:d  "), "a_b_c_d");
        assert_eq!(sanitize_layer_name(""), "PDF_LAAG");
        assert_eq!(sanitize_layer_name("G-Afsluiter"), "G-Afsluiter");
    }

    #[test]
    fn extents_cover_all_geometry() {
        let path = RawPath { subpaths: vec![line_path(&[(72.0, 72.0), (144.0, 216.0)], false)], stroke: stroke(1.0, vec![]), fill: None, layer: None };
        let (drawing, _) = convert(vec![RawItem::Path(path)], ConvertOptions::default());
        let (min, max) = drawing.extents.unwrap();
        assert!((min.x - 25.4).abs() < 1e-9 && (max.y - 76.2).abs() < 1e-9);
        assert!((drawing.page_size.0 - 254.0).abs() < 1e-9);
    }

    #[test]
    fn excluded_layer_is_skipped_and_not_created() {
        let make = |w: f64| RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(0.0, 0.0), (72.0, 0.0)], false)],
            stroke: stroke(w, vec![6.0, 3.0]),
            fill: None,
            layer: None,
        });
        let options = ConvertOptions { excluded_layers: vec!["pdf_000000_w070".into()], ..ConvertOptions::default() };
        let (drawing, stats) = convert(vec![make(2.0), make(0.709)], options);
        assert_eq!(drawing.layers.len(), 1);
        assert_eq!(drawing.layers[0].name, "PDF_000000_W025");
        assert_eq!(stats.lines, 1);
        // Het lijntype van de uitgesloten laag komt er niet bij.
        assert_eq!(stats.linetypes, 1);
    }

    #[test]
    fn annotations_get_their_own_layer_regardless_of_strategy() {
        let path = RawPath {
            subpaths: vec![line_path(&[(0.0, 0.0), (72.0, 0.0)], false)],
            stroke: stroke(1.0, vec![]),
            fill: None,
            layer: Some(LayerHint::Annotation(Arc::from("measureDistance"))),
        };
        let options = ConvertOptions { layers: LayerStrategy::Single, ..ConvertOptions::default() };
        let mut converter = Converter::new(&frame(), options);
        converter.push(RawItem::Path(path));
        converter.flush();
        let counts = converter.layer_counts();
        assert_eq!(counts.len(), 1);
        assert_eq!(counts[0].name, "OPS_measureDistance");
        assert!(counts[0].from_annotation);
        assert_eq!(counts[0].entities, 1);
    }

    #[test]
    fn area_clips_lines_polylines_hatches_and_text() {
        // Gebied: 72 × 72 pt linksonder = 25,4 × 25,4 mm.
        let area = AreaRect { x0: 0.0, y0: 0.0, x1: 72.0, y1: 72.0 };
        let options = ConvertOptions { area: Some(area), ..ConvertOptions::default() };
        let crossing = RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(36.0, 36.0), (144.0, 36.0)], false)],
            stroke: stroke(1.0, vec![]),
            fill: None,
            layer: None,
        });
        let outside = RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(100.0, 100.0), (200.0, 100.0)], false)],
            stroke: stroke(1.0, vec![]),
            fill: None,
            layer: None,
        });
        let fill = RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(36.0, 36.0), (144.0, 36.0), (144.0, 144.0), (36.0, 144.0)], true)],
            stroke: None,
            fill: Some(FillStyle { color: Rgba::BLACK, rule: FillRule::NonZero }),
            layer: None,
        });
        use crate::geom::Matrix;
        let text_in = RawItem::Text(RawText { text: "in".into(), matrix: Matrix::translate(10.0, 10.0), font_size: 10.0, font_name: String::new(), color: Rgba::BLACK, render_mode: 0, layer: None });
        let text_out = RawItem::Text(RawText { text: "uit".into(), matrix: Matrix::translate(100.0, 10.0), font_size: 10.0, font_name: String::new(), color: Rgba::BLACK, render_mode: 0, layer: None });
        let (drawing, stats) = convert(vec![crossing, outside, fill, text_in, text_out], options);
        assert_eq!((stats.lines, stats.hatches, stats.texts), (1, 1, 1));
        let mm = 25.4;
        match &drawing.entities[0].geometry {
            Geometry::Line { start, end } => {
                assert!((start.x - mm / 2.0).abs() < 1e-9 && (end.x - mm).abs() < 1e-9);
            }
            other => panic!("verwachtte LINE, kreeg {other:?}"),
        }
        match &drawing.entities[1].geometry {
            Geometry::Hatch { loops } => {
                assert!(loops[0].iter().all(|p| p.x <= mm + 1e-9 && p.y <= mm + 1e-9));
            }
            other => panic!("verwachtte HATCH, kreeg {other:?}"),
        }
    }

    #[test]
    fn area_origin_offset_and_units() {
        let area = AreaRect { x0: 72.0, y0: 144.0, x1: 144.0, y1: 216.0 };
        let options = ConvertOptions {
            area: Some(area),
            origin: OriginMode::Area,
            units: DrawingUnit::Cm,
            offset: (1000.0, 2000.0),
            ..ConvertOptions::default()
        };
        let path = RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(72.0, 144.0), (144.0, 144.0)], false)],
            stroke: stroke(1.0, vec![]),
            fill: None,
            layer: None,
        });
        let (drawing, _) = convert(vec![path], options);
        match &drawing.entities[0].geometry {
            Geometry::Line { start, end } => {
                // Linksonder van het gebied wordt (0,0), plus de verschuiving; in cm.
                assert!((start.x - 1000.0).abs() < 1e-9 && (start.y - 2000.0).abs() < 1e-9);
                assert!((end.x - 1002.54).abs() < 1e-9);
            }
            other => panic!("verwachtte LINE, kreeg {other:?}"),
        }
    }

    #[test]
    fn model_origin_clips_along_the_page_and_then_turns_into_the_model() {
        use crate::geom::Matrix;
        use crate::model_space::ModelSpace;
        // De pagina staat 30° gedraaid in het model, op 1:100 in meters, met
        // een landelijke verschuiving: 1 pt = 100 × 25,4/72 mm = 0,0352… m.
        let k = 100.0 * 25.4 / 72.0 / 1000.0;
        let (sin, cos) = 30f64.to_radians().sin_cos();
        let page_to_model = Matrix::scale(k, k).then(&Matrix::new(cos, sin, -sin, cos, 155_000.0, 463_000.0));
        let model = ModelSpace { page_to_model, unit: DrawingUnit::M, unknown_unit: None, name: String::new(), bbox: None };
        let area = AreaRect { x0: 0.0, y0: 0.0, x1: 72.0, y1: 72.0 };
        let options = ConvertOptions {
            area: Some(area),
            origin: OriginMode::Model,
            model: Some(model),
            // Tellen niet mee bij de oorsprong van het model.
            scale: OutputScale::from_denominator(5.0),
            units: DrawingUnit::In,
            offset: (9.0, 9.0),
            ..ConvertOptions::default()
        };
        let crossing = RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(36.0, 36.0), (144.0, 36.0)], false)],
            stroke: stroke(1.0, vec![6.0, 3.0]),
            fill: None,
            layer: None,
        });
        let text = RawItem::Text(RawText { text: "in".into(), matrix: Matrix::translate(10.0, 10.0), font_size: 10.0, font_name: String::new(), color: Rgba::BLACK, render_mode: 0, layer: None });
        let mut converter = Converter::new(&frame(), options);
        assert!((converter.output_scale().denominator() - 100.0).abs() < 1e-9, "de schaal volgt uit de matrix");
        converter.push(crossing);
        converter.push(text);
        let (drawing, stats) = converter.finish();
        assert_eq!((stats.lines, stats.texts), (1, 1));
        assert_eq!(drawing.units, DrawingUnit::M);
        // De lijn is op de rand van het gebied geknipt (x = 72 pt, langs de
        // assen van de pagina) en staat daarna gedraaid in het model.
        let (a, b) = (page_to_model.apply(Point::new(36.0, 36.0)), page_to_model.apply(Point::new(72.0, 36.0)));
        match &drawing.entities[0].geometry {
            Geometry::Line { start, end } => {
                assert!(start.distance(a) < 1e-7 && end.distance(b) < 1e-7, "{start:?} {end:?} tegen {a:?} {b:?}");
            }
            other => panic!("verwachtte LINE, kreeg {other:?}"),
        }
        // Het lijntype staat in tekeningeenheden van het model: 6 pt is 0,2117 m.
        let pattern = &drawing.linetypes[0].pattern;
        assert!((pattern[0] - 6.0 * k).abs() < 1e-9, "{pattern:?}");
        match &drawing.entities[1].geometry {
            Geometry::Text { insert, rotation, height, .. } => {
                assert!(insert.distance(page_to_model.apply(Point::new(10.0, 10.0))) < 1e-7);
                assert!((rotation.to_degrees() - 30.0).abs() < 1e-9, "{rotation}");
                assert!((height - 10.0 * 0.72 * k).abs() < 1e-9, "{height}");
            }
            other => panic!("verwachtte TEXT, kreeg {other:?}"),
        }
        // De omhullende is die van de gedraaide tekening.
        let (min, max) = drawing.extents.unwrap();
        assert!(min.x > 155_000.0 - 1.0 && max.x < 155_000.0 + 3.0 && min.y > 463_000.0 && max.y < 463_000.0 + 3.0, "{min:?} {max:?}");

        // Zonder terugweg blijft de omzetter bij de pagina (de schil weigert
        // dat al vóór het uitlezen).
        let lost = ConvertOptions { origin: OriginMode::Model, ..ConvertOptions::default() };
        let (drawing, _) = convert(vec![RawItem::Path(RawPath { subpaths: vec![line_path(&[(0.0, 0.0), (72.0, 0.0)], false)], stroke: stroke(1.0, vec![]), fill: None, layer: None })], lost);
        assert!(matches!(&drawing.entities[0].geometry, Geometry::Line { end, .. } if (end.x - 25.4).abs() < 1e-9));
    }

    #[test]
    fn text_stays_readable_and_in_place_when_the_way_back_mirrors() {
        use crate::model_space::ModelSpace;
        // Een terugweg die spiegelt (y omlaag) komt uit de import niet voor,
        // maar een bestand mag hem noemen. Tekst in CAD is niet te spiegelen:
        // ze blijft leesbaar, langs de gespiegelde regel, en beslaat dezelfde
        // plek als op de pagina.
        let k = 0.5;
        let page_to_model = Matrix::new(k, 0.0, 0.0, -k, 1_000.0, 2_000.0);
        let model = ModelSpace { page_to_model, unit: DrawingUnit::Mm, unknown_unit: None, name: String::new(), bbox: None };
        let options = ConvertOptions { origin: OriginMode::Model, model: Some(model), ..ConvertOptions::default() };
        let (sin, cos) = 90f64.to_radians().sin_cos();
        let flat = RawItem::Text(RawText { text: "plat".into(), matrix: Matrix::translate(10.0, 10.0), font_size: 10.0, font_name: String::new(), color: Rgba::BLACK, render_mode: 0, layer: None });
        let upright = RawItem::Text(RawText { text: "staand".into(), matrix: Matrix::new(cos, sin, -sin, cos, 100.0, 50.0), font_size: 10.0, font_name: String::new(), color: Rgba::BLACK, render_mode: 0, layer: None });
        let mut converter = Converter::new(&frame(), options);
        converter.push(flat);
        converter.push(upright);
        let (drawing, _) = converter.finish();
        let h = 10.0 * 0.72;
        match &drawing.entities[0].geometry {
            Geometry::Text { insert, rotation, height, .. } => {
                // Op de pagina van (10, 10) omhoog tot 17,2; in het model loopt
                // y omlaag, dus de tekst begint bij de gespiegelde bovenrand.
                assert!(insert.distance(page_to_model.apply(Point::new(10.0, 10.0 + h))) < 1e-9, "{insert:?}");
                assert!(rotation.abs() < 1e-9, "{rotation}");
                assert!((height - h * k).abs() < 1e-9);
            }
            other => panic!("verwachtte TEXT, kreeg {other:?}"),
        }
        match &drawing.entities[1].geometry {
            Geometry::Text { insert, rotation, .. } => {
                // Staand op de pagina (omhoog lezend) leest in het model omlaag.
                assert!((rotation.to_degrees() + 90.0).abs() < 1e-9, "{rotation}");
                assert!(insert.distance(page_to_model.apply(Point::new(100.0 - h, 50.0))) < 1e-9, "{insert:?}");
            }
            other => panic!("verwachtte TEXT, kreeg {other:?}"),
        }
    }

    #[test]
    fn counting_mode_counts_without_storing() {
        let make = || RawItem::Path(RawPath {
            subpaths: vec![line_path(&[(0.0, 0.0), (10.0, 0.0)], false), line_path(&[(0.0, 5.0), (10.0, 5.0)], false)],
            stroke: stroke(1.0, vec![]),
            fill: None,
            layer: None,
        });
        let mut converter = Converter::counting(&frame(), ConvertOptions { join_connected: false, ..ConvertOptions::default() });
        converter.push(make());
        converter.push(make());
        converter.flush();
        assert_eq!(converter.entity_count(), 4);
        assert_eq!(converter.layer_counts()[0].entities, 4);
        let (drawing, _) = converter.finish();
        assert!(drawing.entities.is_empty());
    }
}
