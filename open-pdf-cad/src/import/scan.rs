//! Verkenning van een tekening voor het importvenster (#400).
//!
//! Levert precies de gegevens waarmee het venster zinvolle beginwaarden kan
//! zetten: lagen met hun status, kleur en aantal, de ruimtes (modelruimte en
//! layouts) met hun grenzen, papier en viewports, de eenheid, de lettertypen
//! en wat er niet meekomt.

use super::walk::{VisitBudget, WalkSettings, Walker, DEFAULT_MAX_VISITS};
use super::xref::{ExternalFile, ExternalKind, ExternalList, ExternalStatus, Located, SearchPaths, MAX_LISTED_EXTERNALS};
use super::{space_bounds, Drawing, ImportError, ImportOptions, ImportPhase, ImportProgress};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::page_space::DrawingUnit;
use acadrust::entities::EntityType;
use acadrust::objects::ObjectType;
use acadrust::types::{Color, LineWeight};
use acadrust::CadDocument;
use serde::Serialize;
use std::collections::BTreeMap;

/// Grens waarboven de import de oorsprong standaard verschuift.
pub const LARGE_COORDINATE: f64 = 1e5;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitsInfo {
    pub code: i16,
    /// `mm`, `cm`, `m`, `in`, `ft` of leeg als het bestand niets zegt.
    pub unit: String,
    pub mm_per_unit: f64,
    pub from_file: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerScan {
    pub name: String,
    /// `#RRGGBB` zoals de laag in CAD getekend wordt.
    pub color: String,
    pub aci: Option<u16>,
    pub off: bool,
    pub frozen: bool,
    pub locked: bool,
    pub plottable: bool,
    pub linetype: String,
    pub lineweight_mm: Option<f64>,
    /// Aantal getekende onderdelen in de modelruimte.
    pub objects: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceLayerScan {
    pub name: String,
    pub objects: u64,
    pub bounds: Option<[f64; 4]>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportScan {
    /// Papiereenheden per tekeningeenheid.
    pub scale: f64,
    pub ratio: String,
    pub width: f64,
    pub height: f64,
    pub frozen_layers: usize,
    /// De viewport beslaat (nagenoeg) het hele blad.
    pub covers_page: bool,
    /// De laag van het kader van het venster. Alleen ter informatie: die laag
    /// weglaten verbergt het kader, nooit wat het venster toont.
    pub layer: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperScan {
    pub name: String,
    pub width_mm: f64,
    pub height_mm: f64,
    pub rotation: i16,
    pub mm_per_unit: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceScan {
    /// `model` of de naam van de layout.
    pub id: String,
    pub label: String,
    pub kind: String,
    pub order: i16,
    pub objects: u64,
    pub bounds: Option<[f64; 4]>,
    pub limits: Option<[f64; 4]>,
    pub paper: Option<PaperScan>,
    pub layers: Vec<SpaceLayerScan>,
    /// Alleen de viewports die getekend worden (bovenaanzichten).
    pub viewports: Vec<ViewportScan>,
    /// Viewports met een andere kijkrichting of in perspectief: die worden
    /// overgeslagen. Het venster meldt ze vóór de import (`viewports3d`).
    pub viewports_3d: u64,
    /// Viewports die alleen door het vangnet als blad zijn aangemerkt; het
    /// venster meldt ze vóór de import (`sheetByCoverage`).
    pub sheets_by_coverage: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontScan {
    pub style: String,
    pub font: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingScan {
    pub path: String,
    pub format: String,
    pub version: String,
    pub file_bytes: u64,
    pub read_ms: u64,
    pub chunked: bool,
    pub units: UnitsInfo,
    pub large_coordinates: bool,
    pub base_point: [f64; 2],
    pub layers: Vec<LayerScan>,
    pub spaces: Vec<SpaceScan>,
    pub default_space: String,
    pub fonts: Vec<FontScan>,
    /// Bestandsnamen van de externe verwijzingen (nooit het hele pad uit de
    /// tekening), hooguit [`MAX_LISTED_EXTERNALS`].
    pub xrefs: Vec<String>,
    /// Waar de tekening buiten zichzelf naar wijst (externe verwijzingen en
    /// afbeeldingen) en wat de import daarmee zou doen: gevonden naast de
    /// tekening, niet gevonden of geweigerd. Er wordt alleen gezocht, niets
    /// gelezen; of een gevonden bestand bruikbaar is, blijkt pas bij de import.
    /// Gezocht wordt in de map van de tekening en in de zoekpaden die de
    /// aanroeper meegeeft ([`scan_with_paths`]); zonder zoekpaden telt alleen
    /// de map van de tekening. Alleen bestandsnamen, hooguit
    /// [`MAX_LISTED_EXTERNALS`].
    pub externals: Vec<ExternalFile>,
    /// Er waren meer verwijzingen dan `externals` noemt.
    pub externals_truncated: bool,
    pub warnings: Vec<String>,
    /// Entiteiten in de modelruimte; de inhoud van een blok telt per invoeging
    /// mee. Geen bezoeken: cellen van een MINSERT en het uitvouwen zelf tellen
    /// hier niet.
    pub entities: u64,
}

/// Een ruimte in het bestand: de modelruimte of een layout.
#[derive(Clone, Debug, PartialEq)]
pub struct SpaceRecord {
    pub id: String,
    pub label: String,
    pub record: String,
    pub is_model: bool,
    pub order: i16,
}

fn layout_records(document: &CadDocument) -> Vec<(SpaceRecord, Option<&acadrust::objects::Layout>)> {
    let names: BTreeMap<u64, &str> = document.block_records.iter().map(|r| (r.handle.value(), r.name.as_str())).collect();
    let mut out: Vec<(SpaceRecord, Option<&acadrust::objects::Layout>)> = Vec::new();
    for object in document.objects.values() {
        let ObjectType::Layout(layout) = object else { continue };
        let Some(record) = names.get(&layout.block_record.value()) else { continue };
        if record.eq_ignore_ascii_case("*Model_Space") || layout.name.eq_ignore_ascii_case("Model") {
            continue;
        }
        out.push((
            SpaceRecord {
                id: layout.name.clone(),
                label: layout.name.clone(),
                record: (*record).to_string(),
                is_model: false,
                order: layout.tab_order,
            },
            Some(layout),
        ));
    }
    out.sort_by_key(|(space, _)| (space.order, space.id.clone()));
    out
}

/// Zoekt de ruimte bij een naam: `model` of de naam van een layout.
pub fn space_record(document: &CadDocument, id: &str) -> Option<SpaceRecord> {
    if id.is_empty() || id.eq_ignore_ascii_case("model") || id.eq_ignore_ascii_case("*Model_Space") {
        return Some(SpaceRecord {
            id: "model".into(),
            label: "Model".into(),
            record: "*Model_Space".into(),
            is_model: true,
            order: -1,
        });
    }
    layout_records(document)
        .into_iter()
        .find(|(space, _)| space.id.eq_ignore_ascii_case(id) || space.record.eq_ignore_ascii_case(id))
        .map(|(space, _)| space)
}

/// Papier en plotinstellingen van een layout.
pub fn space_paper(document: &CadDocument, space: &SpaceRecord, drawing_mm_per_unit: f64) -> super::paper::LayoutPaper {
    let layout = layout_records(document).into_iter().find(|(s, _)| s.id == space.id).and_then(|(_, l)| l);
    let Some(layout) = layout else {
        return super::paper::LayoutPaper { mm_per_unit: drawing_mm_per_unit, name: space.label.clone(), ..Default::default() };
    };
    layout_paper(layout, &space.label)
}

/// Papier van de layout bij een blokrecord (`*Paper_Space…`), of `None` als
/// het record geen layout heeft.
pub fn record_paper(document: &CadDocument, record_name: &str) -> Option<super::paper::LayoutPaper> {
    layout_records(document)
        .into_iter()
        .find(|(space, _)| space.record.eq_ignore_ascii_case(record_name))
        .and_then(|(space, layout)| layout.map(|l| layout_paper(l, &space.label)))
}

fn layout_paper(layout: &acadrust::objects::Layout, label: &str) -> super::paper::LayoutPaper {
    // Alleen als er werkelijk plotinstellingen in het bestand staan zegt
    // "inch" iets; zonder papiermaat is de papierruimte gewoon in mm.
    let has_paper = layout.paper_width > 0.0 && layout.paper_height > 0.0;
    let unit_mm = if layout.plot_paper_units == 0 && has_paper { 25.4 } else { 1.0 };
    let (num, den) = (layout.plot_scale_numerator, layout.plot_scale_denominator);
    let factor = if num > 0.0 && den > 0.0 { num / den } else { 1.0 };
    let limits = (layout.max_limits.0 > layout.min_limits.0 && layout.max_limits.1 > layout.min_limits.1)
        .then_some([layout.min_limits.0, layout.min_limits.1, layout.max_limits.0, layout.max_limits.1]);
    super::paper::LayoutPaper {
        width_mm: layout.paper_width,
        height_mm: layout.paper_height,
        rotation: layout.plot_rotation,
        margin_left: layout.plot_margin_left,
        margin_bottom: layout.plot_margin_bottom,
        margin_right: layout.plot_margin_right,
        margin_top: layout.plot_margin_top,
        origin_x: layout.plot_origin_x,
        origin_y: layout.plot_origin_y,
        limits,
        mm_per_unit: unit_mm * factor,
        name: if layout.paper_size.is_empty() { label.to_string() } else { layout.paper_size.clone() },
        forced: false,
    }
}

fn color_text(color: Color) -> (String, Option<u16>) {
    match color {
        Color::Index(i) => {
            let (r, g, b) = Color::Index(i).rgb().unwrap_or((255, 255, 255));
            (format!("#{r:02X}{g:02X}{b:02X}"), Some(i as u16))
        }
        Color::Rgb { r, g, b } => (format!("#{r:02X}{g:02X}{b:02X}"), None),
        _ => ("#FFFFFF".into(), Some(7)),
    }
}

fn lineweight(value: LineWeight) -> Option<f64> {
    match value {
        LineWeight::Value(v) if v >= 0 => Some(v as f64 / 100.0),
        _ => None,
    }
}

fn scan_options() -> ImportOptions {
    // Verkennen gebeurt met alle lagen aan en zonder viewports: de layouts
    // tellen hun eigen papierinhoud, het model telt één keer.
    ImportOptions { ..Default::default() }
}

/// Hoogste aantal verschillende verwijzingen waar de verkenning naar zoekt.
const MAX_SCAN_LOOKUPS: usize = 256;

/// Zoekt (zonder iets te lezen) waar de tekening buiten zichzelf naar wijst:
/// de externe verwijzingen en de afbeeldingen. Gezocht wordt in de map van de
/// tekening en in `search_paths`, de mappen die de gebruiker zelf gekozen
/// heeft: dezelfde mappen als de import, zodat "gevonden" en "niet gevonden"
/// bij de gekozen mappen horen. Het aantal zoekacties is begrensd en de
/// afbreekvlag wordt gevraagd.
pub fn outside_files(drawing: &Drawing, search_paths: &[PathBuf], cancel: &AtomicBool) -> ExternalList {
    let document = &drawing.document;
    let mut list = ExternalList::default();
    let mut wanted: Vec<(String, ExternalKind)> = Vec::new();
    let mut seen: std::collections::HashSet<(String, ExternalKind)> = std::collections::HashSet::new();
    let mut want = |raw: &str, kind: ExternalKind, list: &mut ExternalList| {
        let raw = raw.trim();
        if raw.is_empty() || seen.contains(&(raw.to_string(), kind)) {
            return;
        }
        if wanted.len() >= MAX_SCAN_LOOKUPS {
            list.mark_truncated();
            return;
        }
        seen.insert((raw.to_string(), kind));
        wanted.push((raw.to_string(), kind));
    };
    for record in document.block_records.iter().filter(|r| super::xref::is_xref(r)) {
        want(if record.xref_path.trim().is_empty() { &record.name } else { &record.xref_path }, ExternalKind::Xref, &mut list);
    }
    for (index, entity) in document.entities().enumerate() {
        if index % 4096 == 0 && cancel.load(Ordering::Relaxed) {
            return list;
        }
        let EntityType::RasterImage(image) = entity else { continue };
        // Dezelfde regel als de wandeling: eerst het pad van de entiteit,
        // anders dat van haar definitie.
        let raw = if image.file_path.trim().is_empty() {
            match image.definition_handle.and_then(|h| document.objects.get(&h)) {
                Some(ObjectType::ImageDefinition(definition)) => definition.file_name.as_str(),
                _ => "",
            }
        } else {
            image.file_path.as_str()
        };
        want(raw, ExternalKind::Image, &mut list);
    }
    let paths = SearchPaths::for_drawing(&drawing.path, search_paths);
    for (raw, kind) in &wanted {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let extensions: &[&str] = match kind {
            ExternalKind::Xref => &["dwg", "dxf"],
            ExternalKind::Image => &super::image::IMAGE_EXTENSIONS,
        };
        match paths.locate(raw, None, extensions) {
            Located::Found(path) => list.note_path(&path, *kind, ExternalStatus::Found),
            Located::Missing => list.note(raw, *kind, ExternalStatus::Missing),
            Located::Refused => list.note(raw, *kind, ExternalStatus::Refused),
            Located::OddName => list.note(raw, *kind, ExternalStatus::OddName),
        }
    }
    list
}

/// Verkent een ingelezen tekening.
pub fn scan(drawing: &Drawing, cancel: &AtomicBool) -> Result<DrawingScan, ImportError> {
    scan_within(drawing, cancel, DEFAULT_MAX_VISITS)
}

/// Verkent een tekening binnen een eigen bezoekbudget. Het budget geldt voor
/// de hele verkenning: de modelruimte en alle bladen samen.
pub fn scan_within(drawing: &Drawing, cancel: &AtomicBool, max_visits: u64) -> Result<DrawingScan, ImportError> {
    scan_with(drawing, cancel, max_visits, |_| {})
}

/// Als [`scan_within`], met voortgang: fase "verkennen", geteld in ruimtes
/// (de modelruimte en elk blad), met het totaal vooraf bekend. Hoeveel werk
/// één ruimte is, valt vooraf niet te zeggen; het aantal ruimtes wel.
pub fn scan_with(
    drawing: &Drawing,
    cancel: &AtomicBool,
    max_visits: u64,
    progress: impl FnMut(ImportProgress),
) -> Result<DrawingScan, ImportError> {
    scan_with_paths(drawing, &[], cancel, max_visits, progress)
}

/// Als [`scan_with`], met de zoekpaden die de gebruiker gekozen heeft: de
/// lijst van bestanden buiten de tekening (`externals`) zoekt dan ook daar.
/// De rest van de verkenning verandert er niet door.
pub fn scan_with_paths(
    drawing: &Drawing,
    search_paths: &[PathBuf],
    cancel: &AtomicBool,
    max_visits: u64,
    mut progress: impl FnMut(ImportProgress),
) -> Result<DrawingScan, ImportError> {
    let total_spaces = 1 + layout_records(&drawing.document).len() as u64;
    let mut spaces_done = 0u64;
    let mut step = |done: &mut u64, advance: bool| {
        if advance {
            *done += 1;
        }
        progress(ImportProgress { phase: ImportPhase::Scan, done: *done, total: total_spaces });
    };
    step(&mut spaces_done, false);
    let budget = VisitBudget::new(max_visits);
    let document = &drawing.document;
    let options = scan_options();
    let unit = DrawingUnit::from_insunits(document.header.insertion_units);
    let mm_per_unit = unit.map(|u| u.mm_per_unit()).unwrap_or(1.0);

    // Modelruimte: omhullende en aantallen per laag.
    let (model_bounds, model_stats) = space_bounds(drawing, "model", &options, super::Externals::default(), cancel, &budget)?;
    let mut spaces = Vec::new();
    let model_layers: Vec<SpaceLayerScan> = model_bounds
        .per_layer
        .iter()
        .map(|(name, (bounds, count))| SpaceLayerScan { name: name.clone(), objects: *count, bounds: Some(*bounds) })
        .collect();
    let limits = {
        let (min, max) = (document.header.model_space_limits_min, document.header.model_space_limits_max);
        (max.x > min.x && max.y > min.y).then_some([min.x, min.y, max.x, max.y])
    };
    spaces.push(SpaceScan {
        id: "model".into(),
        label: "Model".into(),
        kind: "model".into(),
        order: -1,
        objects: model_bounds.items,
        bounds: model_bounds.bounds,
        limits,
        paper: None,
        layers: model_layers.clone(),
        viewports: Vec::new(),
        viewports_3d: 0,
        sheets_by_coverage: 0,
    });
    step(&mut spaces_done, true);

    // Layouts: papierinhoud, papierformaat en viewports.
    let viewport_settings = WalkSettings { viewports: false, infinite_lines: false, ..Default::default() };
    for (space, layout) in layout_records(document) {
        let mut walker = Walker::new(document, viewport_settings.clone(), drawing.is_dxf);
        walker.share_budget(&budget);
        walker.on_cancel(move || cancel.load(Ordering::Relaxed));
        let mut sink = super::BoundsSink::default();
        walker.paper_space(&space.record, super::curves::Xform3::IDENTITY, &mut sink);
        if walker.too_complex {
            return Err(ImportError::TooComplex);
        }
        if walker.cancelled || cancel.load(Ordering::Relaxed) {
            return Err(ImportError::Cancelled);
        }
        let mut viewports = Vec::new();
        let mut viewports_3d = 0u64;
        let mut sheets_by_coverage = 0u64;
        let mut has_model = false;
        if let Some(record) = document.block_records.get(&space.record) {
            // Precies de beoordeling die ook tekent (import/viewport.rs): wat
            // het venster hier meldt, komt zo op de pagina. Welke viewport de
            // eerste is, bepaalt de layout zelf en niet de plaats in deze lus.
            let sheet = super::viewport::LayoutSheet::of(document, &space.record, drawing.is_dxf);
            for handle in &record.entity_handles {
                let Some(EntityType::Viewport(viewport)) = document.get_entity(*handle) else { continue };
                if viewport.common.invisible {
                    continue;
                }
                let view = match sheet.classify(viewport) {
                    super::viewport::ViewportUse::Draw(view) => view,
                    super::viewport::ViewportUse::NotPlan => {
                        viewports_3d += 1;
                        continue;
                    }
                    super::viewport::ViewportUse::SheetByCoverage => {
                        sheets_by_coverage += 1;
                        continue;
                    }
                    _ => continue,
                };
                has_model = true;
                let paper_mm = space_paper(document, &space, mm_per_unit).mm_per_unit;
                let ratio = mm_per_unit / (view.scale * paper_mm).max(1e-12);
                viewports.push(ViewportScan {
                    scale: view.scale,
                    ratio: super::paper::scale_text(ratio),
                    width: viewport.width,
                    height: viewport.height,
                    frozen_layers: view.frozen_layers.len(),
                    covers_page: view.covers_page,
                    layer: viewport.common.layer.clone(),
                });
            }
        }
        let mut layers: Vec<SpaceLayerScan> = sink
            .per_layer
            .iter()
            .map(|(name, (bounds, count))| SpaceLayerScan { name: name.clone(), objects: *count, bounds: Some(*bounds) })
            .collect();
        if has_model {
            // Wat door de viewports zichtbaar is telt ook mee voor de lagenlijst.
            for model_layer in &model_layers {
                match layers.iter_mut().find(|l| l.name == model_layer.name) {
                    Some(existing) => existing.objects += model_layer.objects,
                    None => layers.push(SpaceLayerScan { name: model_layer.name.clone(), objects: model_layer.objects, bounds: None }),
                }
            }
        }
        let paper = layout.map(|l| {
            let info = space_paper(document, &space, mm_per_unit);
            PaperScan {
                name: if l.paper_size.is_empty() { space.label.clone() } else { l.paper_size.clone() },
                width_mm: info.width_mm,
                height_mm: info.height_mm,
                rotation: info.rotation,
                mm_per_unit: info.mm_per_unit,
            }
        });
        let limits = space_paper(document, &space, mm_per_unit).limits;
        spaces.push(SpaceScan {
            id: space.id.clone(),
            label: space.label.clone(),
            kind: "layout".into(),
            order: space.order,
            objects: sink.items,
            bounds: sink.bounds,
            limits,
            paper,
            layers,
            viewports,
            viewports_3d,
            sheets_by_coverage,
        });
        step(&mut spaces_done, true);
    }

    let layers: Vec<LayerScan> = document
        .layers
        .iter()
        .map(|layer| {
            let (color, aci) = color_text(layer.color);
            let objects = model_layers.iter().find(|l| l.name == layer.name).map(|l| l.objects).unwrap_or(0);
            LayerScan {
                name: layer.name.clone(),
                color,
                aci,
                off: layer.flags.off,
                frozen: layer.flags.frozen,
                locked: layer.flags.locked,
                plottable: layer.is_plottable,
                linetype: layer.line_type.clone(),
                lineweight_mm: lineweight(layer.line_weight),
                objects,
            }
        })
        .collect();

    let fonts: Vec<FontScan> = document
        .text_styles
        .iter()
        .filter(|style| !style.name.is_empty() && (!style.font_file.is_empty() || !style.true_type_font.is_empty()))
        .map(|style| FontScan {
            style: style.name.clone(),
            font: if style.true_type_font.is_empty() { style.font_file.clone() } else { style.true_type_font.clone() },
        })
        .collect();
    let xrefs: Vec<String> = document
        .block_records
        .iter()
        .filter(|r| r.flags.is_xref || r.flags.is_xref_overlay || !r.xref_path.is_empty())
        .map(|r| super::xref::display_name(if r.xref_path.is_empty() { &r.name } else { &r.xref_path }))
        .filter(|name| !name.is_empty())
        .take(MAX_LISTED_EXTERNALS)
        .collect();
    let (externals, externals_truncated) = outside_files(drawing, search_paths, cancel).into_parts();

    let large = model_bounds
        .bounds
        .map(|b| b.iter().any(|v| v.abs() > LARGE_COORDINATE))
        .unwrap_or(false);
    // Standaardruimte: de modelruimte, tenzij daar nauwelijks iets staat (de
    // bladen uit een BIM-export hebben alles in de papierruimte).
    let busiest_layout = spaces
        .iter()
        .filter(|s| s.kind == "layout")
        .max_by_key(|s| s.objects)
        .filter(|s| s.objects > 0)
        .map(|s| (s.id.clone(), s.objects));
    let default_space = match busiest_layout {
        Some((id, objects)) if model_bounds.items < 8 || model_bounds.items * 4 < objects => id,
        _ => "model".to_string(),
    };

    let mut warnings = super::warnings_from(&model_stats);
    if unit.is_none() {
        // 0 = het bestand noemt geen eenheid; een andere code is een eenheid
        // die de import niet kent (bijvoorbeeld lichtjaar of ångström).
        let code = document.header.insertion_units;
        warnings.insert(0, if code == 0 { format!("units:{code}") } else { format!("unitsUnsupported:{code}") });
    }
    if model_bounds.items == 0 {
        warnings.push("emptyModel".into());
    }
    if large {
        warnings.push("largeCoordinates".into());
    }
    // Wat de layouts aan viewports laten vallen of opvallend tekenen, meldt
    // het venster al vóór de import.
    let skipped_3d: u64 = spaces.iter().map(|s| s.viewports_3d).sum();
    if skipped_3d > 0 {
        warnings.push(format!("viewports3d:{skipped_3d}"));
    }
    let guessed: u64 = spaces.iter().map(|s| s.sheets_by_coverage).sum();
    if guessed > 0 {
        warnings.push(format!("sheetByCoverage:{guessed}"));
    }
    let covering = spaces.iter().flat_map(|s| s.viewports.iter()).filter(|v| v.covers_page).count();
    if covering > 0 {
        warnings.push(format!("viewportCoversPage:{covering}"));
    }

    Ok(DrawingScan {
        path: drawing.path.to_string_lossy().to_string(),
        format: if drawing.is_dxf { "dxf".into() } else { "dwg".into() },
        version: drawing.version.clone(),
        file_bytes: drawing.file_bytes,
        read_ms: drawing.read_ms,
        chunked: drawing.chunked,
        units: UnitsInfo {
            code: document.header.insertion_units,
            unit: unit.map(|u| u.app_unit().to_string()).unwrap_or_default(),
            mm_per_unit,
            from_file: unit.is_some(),
        },
        large_coordinates: large,
        base_point: [document.header.model_space_insertion_base.x, document.header.model_space_insertion_base.y],
        layers,
        spaces,
        default_space,
        fonts,
        xrefs,
        externals,
        externals_truncated,
        warnings,
        entities: model_stats.entities,
    })
}
