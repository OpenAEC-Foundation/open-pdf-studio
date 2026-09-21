//! Export van de vectorinhoud van een PDF-pagina naar DXF en DWG.
//!
//! Gegevensstroom:
//!
//! ```text
//! PDFium-pagina-objecten ──extract──▶ RawItem (gebruikersruimte)
//!        ──convert──▶ Drawing (mm, lagen, lijntypen) ──writer──▶ DXF / DWG
//! ```
//!
//! Alleen `extract` raakt PDFium en alleen `writer` raakt `acadrust`; alles
//! daartussen is pure geometrie en los te testen.

pub mod clip;
pub mod convert;
pub mod error;
pub mod extract;
pub mod geom;
pub mod import;
pub mod model;
pub mod model_space;
pub mod page_space;
mod pdf_depth;
mod pdfium_ffi;
pub mod raw;
pub mod writer;

pub use convert::{
    AreaRect, ConvertOptions, ConvertStats, Converter, CurveMode, FillMode, LayerCount, LayerStrategy, OriginMode,
    TextMode,
};
pub use error::ExportError;
pub use import::{
    scan_drawing, AreaChoice, Drawing, ImportArgs, ImportError, ImportOptions, ImportPhase, ImportProgress,
    ImportResult, PageResult,
};
pub use extract::{ExtractControl, PageSession, PdfiumLibrary};
pub use model_space::{read as read_model_space, ModelSpace, PageModelSpaces};
pub use page_space::{DrawingUnit, OutputScale, PageFrame};
pub use raw::ExtractStats;
pub use writer::{CadFormat, CadVersion};

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

/// Fase van een lopende export, voor de voortgangsbalk.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportPhase {
    /// PDFium parset de pagina; duur onbekend, dus zonder teller.
    Load,
    /// Pagina-objecten uitlezen en omzetten; `done`/`total` tellen objecten.
    Extract,
    /// Het CAD-document opbouwen.
    Build,
    /// Het bestand schrijven.
    Write,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ExportProgress {
    pub phase: ExportPhase,
    pub done: u64,
    pub total: u64,
}

/// Eén pagina naar één bestand.
#[derive(Clone, Debug)]
pub struct ExportRequest {
    pub pdf_path: PathBuf,
    /// 0-gebaseerd.
    pub page_index: u32,
    pub output_path: PathBuf,
    pub format: CadFormat,
    pub version: CadVersion,
    pub options: ConvertOptions,
    /// Zie [`ExportArgs::max_entities`].
    pub max_entities: Option<u64>,
}

/// Exportopdracht zoals een webview, MCP-opdracht of script hem aanlevert
/// (camelCase). Alles behalve de paden en de pagina is optioneel; wat ontbreekt
/// of onzinnig is (negatieve schaal, tolerantie 0) krijgt de standaardwaarde.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub pdf_path: String,
    /// 0-gebaseerd.
    pub page_index: u32,
    pub output_path: String,
    /// Ontbreekt dit, dan bepaalt de extensie van `output_path` het formaat.
    pub format: Option<CadFormat>,
    pub version: Option<CadVersion>,
    /// Schaalnoemer N van 1:N voor uitvoer op ware grootte; zonder of ≤ 0 is
    /// de uitvoer papiermaat (1 tekeneenheid = 1 mm op papier).
    pub scale_denominator: Option<f64>,
    pub curves: Option<CurveMode>,
    pub curve_tolerance_mm: Option<f64>,
    pub merge_collinear: Option<bool>,
    pub join_connected: Option<bool>,
    pub layers: Option<LayerStrategy>,
    pub fills: Option<FillMode>,
    pub skip_page_fills: Option<bool>,
    pub text: Option<TextMode>,
    pub text_height_factor: Option<f64>,
    /// Tekeneenheid van de uitvoer (standaard mm).
    pub units: Option<DrawingUnit>,
    /// Exportgebied op de weergegeven pagina: x, y, breedte, hoogte in punten,
    /// oorsprong linksonder.
    pub area: Option<[f64; 4]>,
    pub origin: Option<OriginMode>,
    /// Verschuiving in tekeneenheden.
    pub offset_x: Option<f64>,
    pub offset_y: Option<f64>,
    /// Lagen die niet meegaan (namen zoals de export ze maakt).
    pub excluded_layers: Option<Vec<String>>,
    /// Annotaties meenemen op lagen `OPS_<soort>`.
    pub annotations: Option<bool>,
    /// Bovengrens voor het aantal entiteiten; daarboven stopt de export met
    /// [`ExportError::TooLarge`] zodat de gebruiker kan kiezen.
    pub max_entities: Option<u64>,
}

impl ExportArgs {
    pub fn options(&self) -> ConvertOptions {
        let mut options = ConvertOptions::default();
        if let Some(n) = self.scale_denominator.filter(|n| n.is_finite() && *n > 0.0) {
            options.scale = OutputScale::from_denominator(n);
        }
        if let Some(v) = self.curves {
            options.curves = v;
        }
        if let Some(v) = self.curve_tolerance_mm.filter(|v| v.is_finite() && *v > 0.0) {
            options.curve_tolerance_paper_mm = v;
        }
        if let Some(v) = self.merge_collinear {
            options.merge_collinear = v;
        }
        if let Some(v) = self.join_connected {
            options.join_connected = v;
        }
        if let Some(v) = self.layers {
            options.layers = v;
        }
        if let Some(v) = self.fills {
            options.fills = v;
        }
        if let Some(v) = self.skip_page_fills {
            options.skip_page_fills = v;
        }
        if let Some(v) = self.text {
            options.text = v;
        }
        if let Some(v) = self.text_height_factor.filter(|v| v.is_finite() && *v > 0.0) {
            options.text_height_factor = v;
        }
        if let Some(v) = self.units {
            options.units = v;
        }
        if let Some([x, y, w, h]) = self.area {
            if [x, y, w, h].iter().all(|v| v.is_finite()) && w.abs() > 0.0 && h.abs() > 0.0 {
                options.area = Some(AreaRect { x0: x, y0: y, x1: x + w, y1: y + h });
            }
        }
        if let Some(v) = self.origin {
            options.origin = v;
        }
        let finite = |v: Option<f64>| v.filter(|v| v.is_finite()).unwrap_or(0.0);
        options.offset = (finite(self.offset_x), finite(self.offset_y));
        if let Some(v) = &self.excluded_layers {
            options.excluded_layers = v.clone();
        }
        if let Some(v) = self.annotations {
            options.annotations = v;
        }
        options
    }

    /// Volledige opdracht; `None` als het formaat niet uit de argumenten of de
    /// extensie van het uitvoerpad volgt.
    pub fn request(&self) -> Option<ExportRequest> {
        let output_path = PathBuf::from(&self.output_path);
        let format = self.format.or_else(|| CadFormat::from_extension(&output_path))?;
        Some(ExportRequest {
            pdf_path: PathBuf::from(&self.pdf_path),
            page_index: self.page_index,
            output_path,
            format,
            version: self.version.unwrap_or_default(),
            options: self.options(),
            max_entities: self.max_entities,
        })
    }
}

/// Verslag van een geslaagde export.
#[derive(Clone, Debug, Serialize)]
pub struct ExportReport {
    pub output_path: PathBuf,
    pub file_size: u64,
    /// Paginamaat van de uitvoer in tekeneenheden: de eenheid van de export
    /// (millimeter, tenzij anders gekozen), en bij de oorsprong van het model
    /// de eenheid van het model (`/OPS_ModelUnits`), op de schaal van de
    /// tekening. Een A1 op 1:100 in meters meet dan 84,1 bij 59,4.
    pub page_width: f64,
    pub page_height: f64,
    pub page_rotate: u16,
    /// Schaalnoemer N van 1:N (1 = papiermaat).
    pub scale_denominator: f64,
    pub extract: ExtractStats,
    pub convert: ConvertStats,
    /// Uitlezen en omzetten samen, inclusief het parsen door PDFium.
    pub extract_ms: u64,
    pub build_ms: u64,
    pub write_ms: u64,
}

/// Resultaat van het uitlezen: het CAD-neutrale model plus de tellingen. Hier
/// zit geen PDFium-toestand meer in; de paginasessie is al gesloten.
pub struct ExtractedPage {
    pub drawing: model::Drawing,
    pub frame: PageFrame,
    /// De schaal van de uitvoer zoals ze werkelijk is; bij de terugweg naar
    /// CAD volgt ze uit de matrix van de pagina.
    pub scale: OutputScale,
    pub extract: ExtractStats,
    pub convert: ConvertStats,
    pub extract_ms: u64,
}

/// Stap 1: pagina uitlezen en omzetten naar het model. Dit is de enige stap die
/// PDFium gebruikt; de aanroeper zorgt dat er in dit proces intussen geen
/// andere PDFium-aanroep loopt en kan dat slot direct na deze stap loslaten.
///
/// `cancel` wordt tussen objecten gecontroleerd; `progress` krijgt de fasen
/// `Load` en `Extract`.
pub fn extract_page(
    library: &PdfiumLibrary,
    pdf_path: &Path,
    page_index: u32,
    options: &ConvertOptions,
    cancel: Option<&AtomicBool>,
    mut progress: Option<&mut dyn FnMut(ExportProgress)>,
) -> Result<ExtractedPage, ExportError> {
    let mut report = |phase: ExportPhase, done: u64, total: u64| {
        if let Some(p) = progress.as_mut() {
            p(ExportProgress { phase, done, total });
        }
    };
    // De oorsprong van het model vraagt de terugweg van de pagina; die leest
    // de aanroeper (`resolve_model_space`). Zonder is er niets om naar terug te
    // rekenen, en stil de pagina-oorsprong nemen zou een andere tekening geven
    // dan gevraagd.
    if options.origin == OriginMode::Model && options.model.is_none() {
        return Err(ExportError::NoModelSpace);
    }
    let started = Instant::now();
    report(ExportPhase::Load, 0, 0);
    // De sessie (en daarmee PDFium's geparste pagina) leeft alleen binnen deze
    // functie: vóór het opbouwen van het CAD-document is dat geheugen terug.
    let session = library.open_page(pdf_path, page_index, options.annotations)?;
    let frame = session.frame();
    let mut converter = Converter::new(&frame, options.clone());
    let mut on_progress = |done: u64, total: u64| report(ExportPhase::Extract, done, total);
    let mut control = ExtractControl {
        cancel,
        progress: Some(&mut on_progress),
        drop_fully_clipped: true,
        skip_text: options.text == TextMode::Skip,
    };
    let extract = session.extract(&mut |item| converter.push(item), &mut control)?;
    drop(session);
    let scale = converter.output_scale();
    let (drawing, convert) = converter.finish();
    Ok(ExtractedPage { drawing, frame, scale, extract, convert, extract_ms: started.elapsed().as_millis() as u64 })
}

/// Weigert een uitgelezen pagina met meer entiteiten dan `max`.
pub fn check_size(page: &ExtractedPage, max: Option<u64>) -> Result<(), ExportError> {
    let entities = page.drawing.entities.len() as u64;
    match max {
        Some(limit) if entities > limit => Err(ExportError::TooLarge { entities, limit }),
        _ => Ok(()),
    }
}

/// Stap 2: het model wegschrijven. Gebruikt geen PDFium meer.
pub fn write_page(
    page: ExtractedPage,
    output_path: &Path,
    format: CadFormat,
    version: CadVersion,
    cancel: Option<&AtomicBool>,
    mut progress: Option<&mut dyn FnMut(ExportProgress)>,
) -> Result<ExportReport, ExportError> {
    let cancelled = || cancel.is_some_and(|c| c.load(Ordering::Relaxed));
    let mut report = |phase: ExportPhase, done: u64, total: u64| {
        if let Some(p) = progress.as_mut() {
            p(ExportProgress { phase, done, total });
        }
    };
    let ExtractedPage { drawing, frame, scale, extract, convert, extract_ms } = page;

    if cancelled() {
        return Err(ExportError::Cancelled);
    }
    let entity_total = drawing.entities.len() as u64;
    report(ExportPhase::Build, 0, entity_total);
    let started = Instant::now();
    let page_size = drawing.page_size;
    let document = writer::build_document(drawing, version)?;
    let build_ms = started.elapsed().as_millis() as u64;

    if cancelled() {
        return Err(ExportError::Cancelled);
    }
    report(ExportPhase::Write, 0, entity_total);
    let started = Instant::now();
    let file_size = writer::write_document(&document, format, output_path)?;
    let write_ms = started.elapsed().as_millis() as u64;

    Ok(ExportReport {
        output_path: output_path.to_path_buf(),
        file_size,
        page_width: page_size.0,
        page_height: page_size.1,
        page_rotate: frame.rotate,
        scale_denominator: scale.denominator(),
        extract,
        convert,
        extract_ms,
        build_ms,
        write_ms,
    })
}

/// Zet bij [`OriginMode::Model`] de terugweg naar CAD in de opties: leest de
/// viewports van de pagina (`/VP` met `/OPS_ModelMatrix`) en kiest de viewport
/// die bij het exportgebied hoort (zie [`PageModelSpaces::choose`]). Bij een
/// andere oorsprong gebeurt er niets. De omzetter leest zelf nooit van schijf;
/// de schil roept dit aan vóór [`extract_page`].
///
/// Het lezen is begrensd (zie [`model_space`]) en `cancel` breekt het af. Een
/// bestand dat niet te openen is, geeft [`ExportError::Io`] en niet
/// `NO_MODEL_SPACE`: dat laatste zegt iets over de pagina, niet over de schijf.
pub fn resolve_model_space(pdf_path: &Path, page_index: u32, options: &mut ConvertOptions, cancel: Option<&AtomicBool>) -> Result<(), ExportError> {
    if options.origin != OriginMode::Model {
        return Ok(());
    }
    let page = model_space::load(pdf_path, page_index, cancel)?;
    options.model = Some(page.choose(options.area)?);
    Ok(())
}

/// Exporteert één pagina in één aanroep (stap 1 en 2). Blokkeert; de aanroeper
/// zet dit op een werkdraad.
pub fn export_page(
    library: &PdfiumLibrary,
    request: &ExportRequest,
    cancel: Option<&AtomicBool>,
    mut progress: Option<&mut dyn FnMut(ExportProgress)>,
) -> Result<ExportReport, ExportError> {
    let page = extract_page(
        library,
        &request.pdf_path,
        request.page_index,
        &request.options,
        cancel,
        progress.as_mut().map(|p| &mut **p as &mut dyn FnMut(ExportProgress)),
    )?;
    check_size(&page, request.max_entities)?;
    write_page(page, &request.output_path, request.format, request.version, cancel, progress)
}

/// Telverslag van een pagina vóór de export: welke lagen de export zou maken,
/// met het aantal entiteiten per laag. Gebied en uitgesloten lagen tellen hier
/// niet mee; het venster laat daarmee de hele pagina zien.
#[derive(Clone, Debug, Serialize)]
pub struct PageScan {
    pub page_index: u32,
    /// Weergegeven paginamaat in punten en `/Rotate`.
    pub width_pt: f64,
    pub height_pt: f64,
    pub rotate: u16,
    pub layers: Vec<LayerCount>,
    pub entities: u64,
    /// De schaal waarop geteld is: die van de export (bij de oorsprong van het
    /// model die van de tekening).
    pub scale_denominator: f64,
    pub extract: ExtractStats,
    pub scan_ms: u64,
}

/// Telt wat de export van een pagina zou opleveren, zonder iets te bewaren.
pub fn scan_page(
    library: &PdfiumLibrary,
    pdf_path: &Path,
    page_index: u32,
    options: &ConvertOptions,
    cancel: Option<&AtomicBool>,
) -> Result<PageScan, ExportError> {
    let started = Instant::now();
    let area = options.area;
    let mut options = ConvertOptions { area: None, excluded_layers: Vec::new(), ..options.clone() };
    // Op de oorsprong van het model schrijft de export op de schaal van de
    // tekening; dan telt dit ook op die schaal, met dezelfde keuze van viewport
    // als de export (het gebied van de aanroeper). Draagt de pagina geen
    // (eenduidige) terugweg, dan telt het op de schaal van de opties: het
    // venster blijft bruikbaar, en de export zelf meldt wat er ontbreekt.
    if options.origin == OriginMode::Model && options.model.is_none() {
        match model_space::load(pdf_path, page_index, cancel).and_then(|page| page.choose(area)) {
            Ok(model) => options.model = Some(model),
            Err(stop @ (ExportError::Cancelled | ExportError::Io(_))) => return Err(stop),
            Err(_) => {}
        }
    }
    let session = library.open_page(pdf_path, page_index, options.annotations)?;
    let frame = session.frame();
    let mut converter = Converter::counting(&frame, options.clone());
    let mut control = ExtractControl {
        cancel,
        progress: None,
        drop_fully_clipped: true,
        skip_text: options.text == TextMode::Skip,
    };
    let extract = session.extract(&mut |item| converter.push(item), &mut control)?;
    drop(session);
    converter.flush();
    let (width_pt, height_pt) = frame.display_size_pt();
    Ok(PageScan {
        page_index,
        width_pt,
        height_pt,
        rotate: frame.rotate,
        layers: converter.layer_counts(),
        entities: converter.entity_count(),
        scale_denominator: converter.output_scale().denominator(),
        extract,
        scan_ms: started.elapsed().as_millis() as u64,
    })
}

/// Bestandsnaam van de PDFium-bibliotheek op dit platform.
pub fn pdfium_library_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "pdfium.dll"
    } else if cfg!(target_os = "macos") {
        "libpdfium.dylib"
    } else {
        "libpdfium.so"
    }
}

/// Pad van de PDFium-bibliotheek in een map.
pub fn pdfium_library_in(dir: &Path) -> PathBuf {
    dir.join(pdfium_library_name())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(json: &str) -> ExportArgs {
        serde_json::from_str(json).expect("argumenten moeten deserialiseren")
    }

    #[test]
    fn minimal_arguments_give_crate_defaults() {
        let a = args(r#"{ "pdfPath": "a.pdf", "pageIndex": 0, "outputPath": "a.dxf" }"#);
        assert_eq!(a.options(), ConvertOptions::default());
        let request = a.request().unwrap();
        assert_eq!(request.format, CadFormat::Dxf);
        assert_eq!(request.version, CadVersion::default());
    }

    #[test]
    fn webview_options_map_onto_convert_options() {
        let a = args(
            r#"{ "pdfPath": "a.pdf", "pageIndex": 2, "outputPath": "a.dwg",
                 "format": "dwg", "version": "r2018", "scaleDenominator": 100,
                 "curves": "spline", "curveToleranceMm": 0.05, "mergeCollinear": false,
                 "joinConnected": false, "layers": "style", "fills": "outline",
                 "skipPageFills": false, "text": "skip", "textHeightFactor": 0.7 }"#,
        );
        let o = a.options();
        assert!((o.scale.denominator() - 100.0).abs() < 1e-9);
        assert_eq!(o.curves, CurveMode::Spline);
        assert_eq!(o.curve_tolerance_paper_mm, 0.05);
        assert!(!o.merge_collinear && !o.join_connected && !o.skip_page_fills);
        assert_eq!(o.layers, LayerStrategy::Style);
        assert_eq!(o.fills, FillMode::Outline);
        assert_eq!(o.text, TextMode::Skip);
        assert_eq!(o.text_height_factor, 0.7);
        let request = a.request().unwrap();
        assert_eq!((request.format, request.version, request.page_index), (CadFormat::Dwg, CadVersion::R2018, 2));
    }

    #[test]
    fn nonsense_numbers_fall_back_to_defaults() {
        let a = args(
            r#"{ "pdfPath": "a.pdf", "pageIndex": 0, "outputPath": "a.dxf",
                 "scaleDenominator": -5, "curveToleranceMm": 0, "textHeightFactor": -1 }"#,
        );
        assert_eq!(a.options(), ConvertOptions::default());
    }

    #[test]
    fn area_origin_units_layers_and_limits_are_read() {
        let a = args(
            r#"{ "pdfPath": "a.pdf", "pageIndex": 0, "outputPath": "a.dxf",
                 "units": "m", "area": [10, 20, 100, 50], "origin": "area",
                 "offsetX": 155000, "offsetY": 463000, "excludedLayers": ["A", "b"],
                 "annotations": true, "maxEntities": 750000 }"#,
        );
        let o = a.options();
        assert_eq!(o.units, DrawingUnit::M);
        assert_eq!(o.area, Some(AreaRect { x0: 10.0, y0: 20.0, x1: 110.0, y1: 70.0 }));
        assert_eq!(o.origin, OriginMode::Area);
        assert_eq!(o.offset, (155000.0, 463000.0));
        assert_eq!(o.excluded_layers, vec!["A".to_string(), "b".to_string()]);
        assert!(o.annotations);
        assert_eq!(a.request().unwrap().max_entities, Some(750000));
        // Een gebied zonder oppervlak telt niet.
        let b = args(r#"{ "pdfPath": "a.pdf", "pageIndex": 0, "outputPath": "a.dxf", "area": [1, 2, 0, 5] }"#);
        assert_eq!(b.options().area, None);
    }

    #[test]
    fn unknown_extension_without_format_gives_no_request() {
        let a = args(r#"{ "pdfPath": "a.pdf", "pageIndex": 0, "outputPath": "a.txt" }"#);
        assert!(a.request().is_none());
        let b = args(r#"{ "pdfPath": "a.pdf", "pageIndex": 0, "outputPath": "a.txt", "format": "dxf_binary" }"#);
        assert_eq!(b.request().unwrap().format, CadFormat::DxfBinary);
    }
}
