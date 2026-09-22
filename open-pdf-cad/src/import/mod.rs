//! Import van DWG en DXF naar een PDF-pagina (#400).
//!
//! ```text
//! DWG/DXF ─lezen─▶ CadDocument ─verkennen─▶ lagen, ruimtes, grenzen
//!         ─wandelen (blokken uitgevouwen, viewports, lagenfilter)─▶
//!         inhoudsstroom + lagen (OCG) + meetschaal (/VP /Measure) ─▶ PDF
//! ```
//!
//! Alleen [`read`] raakt de CAD-lezer; de rest werkt op het documentmodel en
//! is zonder bestanden te testen.

pub mod curves;
pub mod dxf_chunks;
pub mod hatch;
pub mod image;
pub mod paper;
pub mod pdf_out;
pub mod pdf_writer;
pub mod scan;
pub mod style;
pub mod text;
pub mod viewport;
pub mod walk;
pub mod xref;
#[cfg(test)]
#[path = "tests.rs"]
mod walk_tests;

use crate::geom::{Matrix, Point};
use crate::page_space::DrawingUnit;
use curves::{PagePath, Xform3};
use paper::{ModelLayoutRequest, Orientation, PagePlan, PaperChoice, PlanError, Placement, PT_PER_MM};
use pdf_out::{LayerRegistry, OutputPage, PageBuilder, PageMeasure};
use scan::{space_paper, DrawingScan};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use style::{ColorMode, LineweightMode, PenTable};
use walk::{HatchMode, Sink, VisitBudget, WalkSettings, WalkStats, Walker};

use acadrust::CadDocument;

/// Wat er mis kan gaan bij een import.
#[derive(Clone, Debug, PartialEq)]
pub enum ImportError {
    /// Het bestand kon niet gelezen worden.
    Read(String),
    /// Een tekening van vóór R13; die leest de bibliotheek niet.
    TooOld(String),
    Io(String),
    Cancelled,
    /// De gekozen ruimte bestaat niet of is leeg.
    Empty(String),
    /// De pagina wordt groter dan PDF toestaat.
    PageTooLarge { width_mm: f64, height_mm: f64 },
    /// De tekening gaat over een werkgrens (aantal bezoeken, blokken die
    /// zichzelf eindeloos uitvouwen, omvang van de uitvoer).
    TooComplex,
    /// Het doelbestand bestaat al; het wordt nooit stil vervangen.
    Exists(String),
    /// Het gekozen venster heeft geen positieve breedte en hoogte (of bevat
    /// geen eindige getallen).
    InvalidWindow,
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // Vaste vormen: de app herkent ze aan het voorvoegsel.
            ImportError::Read(m) => write!(f, "IMPORT_READ:{m}"),
            ImportError::TooOld(v) => write!(f, "IMPORT_TOO_OLD:{v}"),
            ImportError::Io(m) => write!(f, "IMPORT_IO:{m}"),
            ImportError::Cancelled => write!(f, "IMPORT_CANCELLED"),
            ImportError::Empty(space) => write!(f, "IMPORT_EMPTY:{space}"),
            ImportError::PageTooLarge { width_mm, height_mm } => {
                write!(f, "IMPORT_PAGE_TOO_LARGE:{width_mm:.0}:{height_mm:.0}")
            }
            ImportError::TooComplex => write!(f, "IMPORT_TOO_COMPLEX"),
            ImportError::Exists(path) => write!(f, "IMPORT_EXISTS:{path}"),
            ImportError::InvalidWindow => write!(f, "IMPORT_WINDOW_INVALID"),
        }
    }
}

impl std::error::Error for ImportError {}

/// Fase van een import, voor de voortgangsbalk.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportPhase {
    Read,
    Scan,
    Draw,
    Write,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ImportProgress {
    pub phase: ImportPhase,
    pub done: u64,
    pub total: u64,
}

/// Een ingelezen tekening.
pub struct Drawing {
    pub document: CadDocument,
    pub path: PathBuf,
    pub is_dxf: bool,
    pub version: String,
    pub file_bytes: u64,
    pub read_ms: u64,
    /// Gelezen in stukken (grote tekst-DXF).
    pub chunked: bool,
}

/// DWG-versie uit de eerste zes bytes (`AC1032`), of `None` als het geen
/// DWG is. Werkt op bytes: een bestand dat met `AC10` begint en daarna
/// willekeurige bytes heeft, mag niet laten vastlopen.
fn detect_version(head: &[u8]) -> Option<String> {
    let v = head.get(..6)?;
    (v.starts_with(b"AC10") && v[4..].iter().all(|b| b.is_ascii_alphanumeric()))
        .then(|| String::from_utf8_lossy(v).into_owned())
}

/// Leest een DWG of DXF. Grote tekst-DXF's gaan stuk voor stuk (zie
/// [`dxf_chunks`]).
pub fn read(
    path: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(ImportProgress),
) -> Result<Drawing, ImportError> {
    let started = Instant::now();
    let data = std::fs::read(path).map_err(|e| ImportError::Io(e.to_string()))?;
    let file_bytes = data.len() as u64;
    let is_dwg = detect_version(&data).is_some();
    if let Some(version) = detect_version(&data) {
        // R12 en ouder (AC1009 en lager) leest de bibliotheek niet.
        if version.as_str() < "AC1012" {
            return Err(ImportError::TooOld(version));
        }
    }
    let cancelled = || cancel.load(Ordering::Relaxed);
    progress(ImportProgress { phase: ImportPhase::Read, done: 0, total: 0 });
    let mut chunked = false;
    let document = if is_dwg {
        acadrust::DwgReader::from_file(path)
            .map_err(|e| ImportError::Read(e.to_string()))?
            .read()
            .map_err(|e| ImportError::Read(e.to_string()))?
    } else {
        let read_in_chunks = dxf_chunks::read_in_chunks(
            &data,
            dxf_chunks::DEFAULT_CHUNK,
            |done, total| progress(ImportProgress { phase: ImportPhase::Read, done: done as u64, total: total as u64 }),
            &cancelled,
        );
        match read_in_chunks {
            Err(_) if cancelled() => return Err(ImportError::Cancelled),
            Err(e) => return Err(ImportError::Read(e)),
            Ok(Some(document)) => {
                chunked = true;
                document
            }
            Ok(None) => acadrust::DxfReader::from_reader(std::io::Cursor::new(data))
                .map_err(|e| ImportError::Read(e.to_string()))?
                .read()
                .map_err(|e| ImportError::Read(e.to_string()))?,
        }
    };
    if cancelled() {
        return Err(ImportError::Cancelled);
    }
    let version = format!("{:?}", document.version);
    Ok(Drawing {
        document,
        path: path.to_path_buf(),
        is_dxf: !is_dwg,
        version,
        file_bytes,
        read_ms: started.elapsed().as_millis() as u64,
        chunked,
    })
}

/// Boven dit aantal entiteiten (blokken uitgevouwen, per ruimte) tekent de
/// voorbeeldstand zonder arceringen, tekst en maatvoering; het venster meldt
/// dat.
pub const PREVIEW_SIMPLE_ABOVE: u64 = 200_000;

/// Welk gebied van de modelruimte op papier komt.
#[derive(Clone, Debug, PartialEq, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "rect")]
pub enum AreaChoice {
    /// Zelf berekende grenzen van wat getekend wordt.
    #[default]
    Extents,
    /// `$LIMMIN`/`$LIMMAX`.
    Limits,
    /// Eigen venster in tekeningeenheden: `[x0, y0, x1, y1]`.
    Window([f64; 4]),
}

/// Alle keuzes van het importvenster.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportOptions {
    /// Ruimtes: `model` of de naam van een layout; elke ruimte wordt een pagina.
    pub spaces: Vec<String>,
    /// Lagen die uit staan (hoofdletterongevoelig).
    pub excluded_layers: Vec<String>,
    /// Lagen die meekomen maar in de PDF uit staan.
    pub hidden_layers: Vec<String>,
    /// Lagen als PDF-lagen (OCG) bewaren.
    pub layers_as_ocg: bool,
    /// Eenheid van de tekening; `None` = uit het bestand.
    pub units: Option<DrawingUnit>,
    pub area: AreaChoice,
    /// `None` = passend op papier.
    pub scale: Option<f64>,
    pub paper: PaperChoice,
    pub orientation: Orientation,
    pub margin_mm: f64,
    pub placement: Placement,
    pub rotation_deg: f64,
    /// Meetschaal (`/VP` + `/Measure`) schrijven.
    pub measure: bool,
    /// De afbeelding pagina → model bewaren voor de weg terug naar CAD.
    pub model_matrix: bool,
    pub color_mode: ColorMode,
    pub lineweight: LineweightMode,
    pub lineweight_factor: f64,
    pub lineweight_min_mm: f64,
    /// Kleurentabel kleur naar lijndikte (alleen bij `LineweightMode::Pens`).
    pub pens: PenTable,
    pub linetypes: bool,
    pub text: bool,
    /// Vervangingstabel voor lettertypen.
    pub fonts: text::FontMap,
    pub hatch: HatchMode,
    /// Maatvoering tekenen, met de verwijslijnen (LEADER, MULTILEADER) erbij.
    pub dimensions: bool,
    pub attributes: bool,
    pub points: bool,
    /// Externe verwijzingen laden als ze gevonden worden.
    pub xrefs: bool,
    /// Afbeeldingen insluiten als ze gevonden worden. Beelden tellen niet mee
    /// in `max_content_bytes`: [`image::MAX_IMAGE_TOTAL_BYTES`] is de enige
    /// bovengrens op wat de import aan beeldgegevens vasthoudt en in de PDF
    /// zet, en die grens is niet instelbaar.
    pub images: bool,
    /// Hoogste aantal beeldpunten per afbeelding. Alleen te verlagen: de
    /// bovengrens is [`image::MAX_IMAGE_PIXELS`]. Die staat ruim, omdat niet
    /// het aantal beeldpunten maar het uitpakwerk de import afremt
    /// ([`image::MAX_IMAGE_WORK_BYTES`], zie de moduledoc van [`image`]); een
    /// lagere waarde hier weigert grote beelden eerder, bijvoorbeeld voor een
    /// voorbeeldweergave.
    pub max_image_pixels: u64,
    /// Zoekpaden voor externe verwijzingen en afbeeldingen, naast de map van
    /// de tekening zelf. Alleen mappen die de gebruiker heeft gekozen.
    pub search_paths: Vec<PathBuf>,
    /// Eigen basispunt voor plaatsing "op oorsprong"; `None` = `$INSBASE`.
    pub base_point: Option<(f64, f64)>,
    /// Werkgrens: hoogste aantal bezoeken voor de hele import, over alle
    /// ruimtes en over grenzen bepalen en tekenen samen.
    pub max_visits: u64,
    /// Werkgrens: hoogste omvang van de inhoudsstromen van alle pagina's samen.
    /// Een blok dat als formulier hergebruikt wordt, telt per plaatsing mee
    /// met de omvang die het uitgevouwen had gehad.
    pub max_content_bytes: usize,
    /// Een blok dat vaker op dezelfde manier staat (alleen de plaats
    /// verschilt) één keer als formulier-XObject in de PDF zetten. De pagina
    /// ziet er hetzelfde uit; het bestand wordt kleiner.
    pub reuse_blocks: bool,
    /// Voorbeeldstand: een ruimte met meer dan [`PREVIEW_SIMPLE_ABOVE`]
    /// entiteiten (geteld ná de laagkeuze) wordt zonder arceerpatronen (effen
    /// vullingen blijven, een patroon wordt zijn omtrek), tekst en maatvoering
    /// (met de verwijslijnen) getekend, zodat het venster snel iets laat zien. Papier, schaal en plaatsing
    /// blijven die van de echte import, en alle werkgrenzen en de afbreekvlag
    /// gelden onverkort.
    pub preview: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        ImportOptions {
            spaces: Vec::new(),
            excluded_layers: Vec::new(),
            hidden_layers: Vec::new(),
            layers_as_ocg: true,
            units: None,
            area: AreaChoice::Extents,
            scale: None,
            paper: PaperChoice::Auto,
            orientation: Orientation::Auto,
            margin_mm: 10.0,
            placement: Placement::Center,
            rotation_deg: 0.0,
            measure: true,
            model_matrix: true,
            color_mode: ColorMode::File,
            lineweight: LineweightMode::File,
            lineweight_factor: 1.0,
            lineweight_min_mm: 0.0,
            pens: PenTable::default(),
            linetypes: true,
            text: true,
            fonts: text::FontMap::default(),
            hatch: HatchMode::All,
            dimensions: true,
            attributes: true,
            points: false,
            xrefs: true,
            images: true,
            max_image_pixels: image::MAX_IMAGE_PIXELS,
            search_paths: Vec::new(),
            base_point: None,
            max_visits: walk::DEFAULT_MAX_VISITS,
            max_content_bytes: pdf_out::DEFAULT_MAX_CONTENT_BYTES,
            reuse_blocks: true,
            preview: false,
        }
    }
}

/// Leest een lijst die niet langer mag zijn dan `MAX`. De lezer stopt bij het
/// eerste element te veel met een nette fout (`IMPORT_ARGS_TOO_LONG:<veld>`),
/// in plaats van een onbegrensde lijst uit de webview in het geheugen te
/// zetten. `null` of geen lijst geeft een lege lijst.
fn bounded_list<'de, D, T, const MAX: usize>(deserializer: D, field: &'static str) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Bounded<T, const MAX: usize>(&'static str, std::marker::PhantomData<T>);
    impl<'de, T: Deserialize<'de>, const MAX: usize> serde::de::Visitor<'de> for Bounded<T, MAX> {
        type Value = Vec<T>;

        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "een lijst van hooguit {MAX} regels")
        }

        fn visit_unit<E: serde::de::Error>(self) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }

        fn visit_none<E: serde::de::Error>(self) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }

        fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<T>, A::Error> {
            let mut out = Vec::with_capacity(seq.size_hint().unwrap_or(0).min(MAX));
            while let Some(item) = seq.next_element::<T>()? {
                if out.len() >= MAX {
                    return Err(serde::de::Error::custom(format!("IMPORT_ARGS_TOO_LONG:{}:{MAX}", self.0)));
                }
                out.push(item);
            }
            Ok(out)
        }
    }
    deserializer.deserialize_any(Bounded::<T, MAX>(field, std::marker::PhantomData))
}

fn bounded_pens<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Vec<PenArg>, D::Error> {
    bounded_list::<D, PenArg, { style::MAX_PENS }>(deserializer, "pens")
}

fn bounded_fonts<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Vec<FontArg>, D::Error> {
    bounded_list::<D, FontArg, { text::MAX_FONT_RULES }>(deserializer, "fonts")
}

fn bounded_search_paths<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    bounded_list::<D, String, { xref::MAX_SEARCH_PATHS }>(deserializer, "searchPaths")
}

/// Eén regel van de kleurentabel zoals de webview hem stuurt.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PenArg {
    /// `#RRGGBB`.
    pub color: String,
    pub lineweight_mm: f64,
}

/// Eén regel van de lettertypetabel zoals de webview hem stuurt.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FontArg {
    /// Naam in de tekening (SHX- of TTF-bestandsnaam, of de TrueType-naam).
    pub from: String,
    /// `sans` of `mono`.
    pub family: String,
    pub bold: bool,
    pub italic: bool,
}

/// Importopdracht zoals de webview of een script hem aanlevert (camelCase).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportArgs {
    pub path: String,
    pub output_path: String,
    pub spaces: Vec<String>,
    pub excluded_layers: Vec<String>,
    pub hidden_layers: Vec<String>,
    pub layers_as_ocg: Option<bool>,
    pub units: Option<DrawingUnit>,
    pub area: Option<String>,
    pub window: Option<[f64; 4]>,
    pub scale: Option<f64>,
    pub paper: Option<String>,
    pub paper_width_mm: Option<f64>,
    pub paper_height_mm: Option<f64>,
    pub orientation: Option<Orientation>,
    pub margin_mm: Option<f64>,
    pub placement: Option<Placement>,
    pub rotation: Option<f64>,
    pub measure: Option<bool>,
    pub model_matrix: Option<bool>,
    /// Kleurstand: `file`, `black`, `gray`, `mono` (zuiver zwart-wit, met
    /// `monoThreshold`) of `single` (één eigen kleur, met `singleColor`). Een
    /// onbekende naam is `file`.
    pub colors: Option<String>,
    /// Drempel van "zuiver zwart-wit": helderheid in procenten (0 tot 100).
    /// Effen vlakvullingen die lichter zijn, vallen weg.
    pub mono_threshold: Option<f64>,
    /// De kleur van "één eigen kleur", als `#RRGGBB`.
    pub single_color: Option<String>,
    pub lineweight: Option<String>,
    pub lineweight_mm: Option<f64>,
    pub lineweight_factor: Option<f64>,
    pub lineweight_min_mm: Option<f64>,
    /// Kleurentabel: kleur naar lijndikte. Hooguit [`style::MAX_PENS`] regels.
    #[serde(deserialize_with = "bounded_pens")]
    pub pens: Vec<PenArg>,
    pub linetypes: Option<bool>,
    pub text: Option<bool>,
    /// Lettertypevervanging. Hooguit [`text::MAX_FONT_RULES`] regels.
    #[serde(deserialize_with = "bounded_fonts")]
    pub fonts: Vec<FontArg>,
    pub hatch: Option<HatchMode>,
    pub dimensions: Option<bool>,
    pub attributes: Option<bool>,
    pub points: Option<bool>,
    /// Externe verwijzingen laden.
    pub xrefs: Option<bool>,
    /// Afbeeldingen insluiten.
    pub images: Option<bool>,
    /// Hoogste aantal beeldpunten per afbeelding.
    pub max_image_pixels: Option<u64>,
    /// Zoekpaden die de gebruiker heeft gekozen. Hooguit
    /// [`xref::MAX_SEARCH_PATHS`]; de schil van de app controleert ze (bestaat,
    /// is een map) voordat ze bij de omzetter komen.
    #[serde(deserialize_with = "bounded_search_paths")]
    pub search_paths: Vec<String>,
    /// Eigen basispunt `[x, y]` in tekeningeenheden.
    pub base_point: Option<[f64; 2]>,
    /// Werkgrens: hoogste aantal bezoeken voor de hele import (testen en
    /// scripts).
    pub max_visits: Option<u64>,
    /// Werkgrens: hoogste omvang van de inhoudsstromen van alle pagina's samen.
    pub max_content_bytes: Option<usize>,
    /// Blokken die vaker op dezelfde manier staan als formulier hergebruiken.
    pub reuse_blocks: Option<bool>,
    /// Voorbeeldstand (zie [`ImportOptions::preview`]).
    pub preview: Option<bool>,
}

impl ImportArgs {
    pub fn options(&self) -> ImportOptions {
        let default = ImportOptions::default();
        let paper = match self.paper.as_deref() {
            None | Some("") | Some("auto") => PaperChoice::Auto,
            Some("custom") => PaperChoice::Custom {
                width_mm: self.paper_width_mm.filter(|v| *v > 0.0).unwrap_or(297.0),
                height_mm: self.paper_height_mm.filter(|v| *v > 0.0).unwrap_or(420.0),
            },
            Some(name) => PaperChoice::Named(name.to_string()),
        };
        let area = match (self.area.as_deref(), self.window) {
            // "window" zonder rechthoek blijft een venster (een ongeldig): de
            // omzetting weigert dat, in plaats van stil de grenzen te nemen.
            (Some("window"), rect) => AreaChoice::Window(rect.unwrap_or([0.0; 4])),
            (Some("limits"), _) => AreaChoice::Limits,
            _ => AreaChoice::Extents,
        };
        let lineweight = match self.lineweight.as_deref() {
            Some("fixed") => LineweightMode::Fixed(self.lineweight_mm.filter(|v| *v >= 0.0).unwrap_or(0.25)),
            Some("pens") => LineweightMode::Pens,
            _ => LineweightMode::File,
        };
        let pens = PenTable::from_pairs(
            &self
                .pens
                .iter()
                .filter_map(|p| PenTable::parse_color(&p.color).map(|rgb| (rgb, p.lineweight_mm)))
                .collect::<Vec<_>>(),
        );
        let fonts = if self.fonts.is_empty() {
            text::FontMap::default()
        } else {
            let rules = self
                .fonts
                .iter()
                .filter(|f| !f.from.trim().is_empty())
                .map(|f| {
                    let family = if f.family.eq_ignore_ascii_case("mono") {
                        text::FontFamily::Mono
                    } else {
                        text::FontFamily::Sans
                    };
                    (f.from.clone(), text::FontChoice { family, italic: f.italic, bold: f.bold })
                })
                .collect();
            text::FontMap::new(rules, text::FontChoice::DEFAULT)
        };
        ImportOptions {
            spaces: if self.spaces.is_empty() { vec!["model".into()] } else { self.spaces.clone() },
            excluded_layers: self.excluded_layers.clone(),
            hidden_layers: self.hidden_layers.clone(),
            layers_as_ocg: self.layers_as_ocg.unwrap_or(default.layers_as_ocg),
            units: self.units,
            area,
            scale: self.scale.filter(|v| *v > 0.0),
            paper,
            orientation: self.orientation.unwrap_or_default(),
            margin_mm: self.margin_mm.filter(|v| *v >= 0.0).unwrap_or(default.margin_mm),
            placement: self.placement.unwrap_or_default(),
            rotation_deg: self.rotation.filter(|v| v.is_finite()).unwrap_or(0.0),
            measure: self.measure.unwrap_or(default.measure),
            model_matrix: self.model_matrix.unwrap_or(default.model_matrix),
            color_mode: ColorMode::from_args(self.colors.as_deref(), self.mono_threshold, self.single_color.as_deref()),
            lineweight,
            lineweight_factor: self.lineweight_factor.filter(|v| *v > 0.0).unwrap_or(1.0),
            lineweight_min_mm: self.lineweight_min_mm.filter(|v| *v >= 0.0).unwrap_or(0.0),
            pens,
            linetypes: self.linetypes.unwrap_or(true),
            text: self.text.unwrap_or(true),
            fonts,
            hatch: self.hatch.unwrap_or_default(),
            dimensions: self.dimensions.unwrap_or(true),
            attributes: self.attributes.unwrap_or(true),
            points: self.points.unwrap_or(false),
            xrefs: self.xrefs.unwrap_or(default.xrefs),
            images: self.images.unwrap_or(default.images),
            max_image_pixels: self.max_image_pixels.filter(|v| *v > 0).unwrap_or(default.max_image_pixels),
            search_paths: self.search_paths.iter().filter(|p| !p.trim().is_empty()).map(PathBuf::from).collect(),
            base_point: self.base_point.filter(|p| p.iter().all(|v| v.is_finite())).map(|p| (p[0], p[1])),
            max_visits: self.max_visits.filter(|v| *v > 0).unwrap_or(default.max_visits),
            max_content_bytes: self.max_content_bytes.filter(|v| *v > 0).unwrap_or(default.max_content_bytes),
            reuse_blocks: self.reuse_blocks.unwrap_or(default.reuse_blocks),
            preview: self.preview.unwrap_or(default.preview),
            ..default
        }
    }
}

/// Uitkomst van een import.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub output_path: String,
    pub pages: Vec<PageResult>,
    pub file_size: u64,
    pub stats: WalkStats,
    pub warnings: Vec<String>,
    /// De bestanden van buiten de tekening waar de import mee te maken kreeg
    /// (externe verwijzingen en afbeeldingen), met wat ermee gebeurd is. Alleen
    /// bestandsnamen, nooit paden, en hooguit
    /// [`xref::MAX_LISTED_EXTERNALS`]; de tellingen in `warnings` blijven
    /// volledig.
    pub externals: Vec<xref::ExternalFile>,
    /// Er waren meer bestanden dan `externals` noemt.
    pub externals_truncated: bool,
    /// Voorbeeldstand: minstens één ruimte is vereenvoudigd getekend (te veel
    /// entiteiten); de waarschuwing `previewSimplified` zegt het ook.
    pub simplified: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageResult {
    pub space: String,
    pub label: String,
    pub width_mm: f64,
    pub height_mm: f64,
    pub paper: String,
    pub scale: f64,
    pub scale_text: String,
    pub objects: u64,
    /// Verschuiving van de oorsprong in tekeningeenheden (grote coördinaten).
    pub offset: [f64; 2],
    /// Deze pagina is in de voorbeeldstand vereenvoudigd getekend. Per ruimte
    /// beslist: een licht blad naast een zwaar model blijft volledig.
    pub simplified: bool,
}

fn walk_settings(options: &ImportOptions) -> WalkSettings {
    WalkSettings {
        excluded_layers: options.excluded_layers.iter().map(|l| l.to_uppercase()).collect::<HashSet<String>>(),
        color_mode: options.color_mode,
        lineweight: options.lineweight,
        lineweight_factor: options.lineweight_factor,
        lineweight_min_mm: options.lineweight_min_mm,
        pens: options.pens.clone(),
        linetypes: options.linetypes,
        text: options.text,
        fonts: options.fonts.clone(),
        hatch: options.hatch,
        dimensions: options.dimensions,
        attributes: options.attributes,
        points: options.points,
        images: options.images,
        max_hatch_lines: 20_000,
        viewports: true,
        infinite_lines: true,
        max_visits: options.max_visits,
        reuse_blocks: options.reuse_blocks,
    }
}

/// Verzamelt omhullenden per laag (voor de grenzen van een gebied).
#[derive(Default)]
pub struct BoundsSink {
    pub bounds: Option<[f64; 4]>,
    pub per_layer: std::collections::BTreeMap<String, ([f64; 4], u64)>,
    pub items: u64,
    /// Dikste lijn die werkelijk getekend wordt, in paginapunten.
    pub widest_stroke_pt: f64,
    clip: Vec<[f64; 4]>,
}

impl BoundsSink {
    /// Neemt de omhullende mee; `false` als hij buiten het knipvlak valt of
    /// geen eindige getallen heeft.
    fn add(&mut self, layer: &str, bounds: [f64; 4]) -> bool {
        let mut b = bounds;
        if let Some(clip) = self.clip.last() {
            b = [b[0].max(clip[0]), b[1].max(clip[1]), b[2].min(clip[2]), b[3].min(clip[3])];
            if b[0] > b[2] || b[1] > b[3] {
                return false;
            }
        }
        if !b.iter().all(|v| v.is_finite()) {
            return false;
        }
        self.items += 1;
        let entry = self.per_layer.entry(layer.to_string()).or_insert(([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], 0));
        entry.0 = [entry.0[0].min(b[0]), entry.0[1].min(b[1]), entry.0[2].max(b[2]), entry.0[3].max(b[3])];
        entry.1 += 1;
        let all = self.bounds.get_or_insert([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY]);
        *all = [all[0].min(b[0]), all[1].min(b[1]), all[2].max(b[2]), all[3].max(b[3])];
        true
    }
}

impl Sink for BoundsSink {
    fn stroke(&mut self, layer: &str, style: &walk::Stroke, path: &PagePath) {
        if let Some(b) = path.bounds() {
            if self.add(layer, b) && style.width.is_finite() {
                self.widest_stroke_pt = self.widest_stroke_pt.max(style.width);
            }
        }
    }

    fn fill(&mut self, layer: &str, _color: style::Rgb, _alpha: f64, path: &PagePath, _even_odd: bool) {
        if let Some(b) = path.bounds() {
            self.add(layer, b);
        }
    }

    fn text(&mut self, layer: &str, _color: style::Rgb, _alpha: f64, matrix: Matrix, bytes: &[u8], font: text::FontChoice) {
        let w = text::width_with(bytes, font);
        let corners = [
            matrix.apply(Point::new(0.0, -0.25)),
            matrix.apply(Point::new(w, -0.25)),
            matrix.apply(Point::new(w, 1.0)),
            matrix.apply(Point::new(0.0, 1.0)),
        ];
        let b = [
            corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
            corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
            corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
            corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
        ];
        self.add(layer, b);
    }

    fn image(&mut self, layer: &str, _alpha: f64, matrix: Matrix, _key: &str, _raster: &std::rc::Rc<image::Raster>) {
        let corners = [
            matrix.apply(Point::new(0.0, 0.0)),
            matrix.apply(Point::new(1.0, 0.0)),
            matrix.apply(Point::new(1.0, 1.0)),
            matrix.apply(Point::new(0.0, 1.0)),
        ];
        let b = [
            corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
            corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
            corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
            corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
        ];
        self.add(layer, b);
    }

    fn push_clip(&mut self, path: &PagePath, _even_odd: bool) {
        let bounds = path.bounds().unwrap_or([f64::NEG_INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::INFINITY]);
        let clipped = match self.clip.last() {
            Some(c) => [bounds[0].max(c[0]), bounds[1].max(c[1]), bounds[2].min(c[2]), bounds[3].min(c[3])],
            None => bounds,
        };
        self.clip.push(clipped);
    }

    fn pop_clip(&mut self) {
        self.clip.pop();
    }
}

/// Wat een import van buiten de tekening meeneemt: de geladen externe
/// verwijzingen en de afbeeldingen. `None` telt ze alleen (zo doet de
/// verkenning het: laden zou elk venster traag maken).
#[derive(Clone, Copy, Default)]
pub struct Externals<'e> {
    pub xrefs: Option<&'e xref::XrefDocs>,
    pub images: Option<&'e image::ImageStore>,
}

impl<'e> Externals<'e> {
    fn give<'w>(&self, walker: &mut Walker<'w>)
    where
        'e: 'w,
    {
        if let Some(xrefs) = self.xrefs {
            walker.with_xrefs(xrefs);
        }
        if let Some(images) = self.images {
            walker.with_images(images);
        }
    }
}

/// Grenzen van een ruimte, met alleen de lagen die meedoen. Af te breken via
/// `cancel`; een tekening boven de werkgrens geeft `TooComplex`. De bezoeken
/// gaan van `budget` af: de aanroeper deelt er één over al zijn wandelingen.
pub fn space_bounds(
    drawing: &Drawing,
    space: &str,
    options: &ImportOptions,
    externals: Externals<'_>,
    cancel: &AtomicBool,
    budget: &VisitBudget,
) -> Result<(BoundsSink, WalkStats), ImportError> {
    let document = &drawing.document;
    // Oneindige lijnen tellen niet mee voor de grenzen. De grenzen komen uit
    // elke omhullende afzonderlijk: formulieren spelen hier niet mee.
    let settings = WalkSettings { infinite_lines: false, reuse_blocks: false, ..walk_settings(options) };
    let mut walker = Walker::new(document, settings, drawing.is_dxf);
    externals.give(&mut walker);
    walker.share_budget(budget);
    walker.on_cancel(move || cancel.load(Ordering::Relaxed));
    let mut sink = BoundsSink::default();
    match scan::space_record(document, space) {
        Some(record) if record.is_model => walker.model_space(Xform3::IDENTITY, &mut sink),
        Some(record) => walker.paper_space(&record.record, Xform3::IDENTITY, &mut sink),
        None => {}
    }
    if walker.too_complex {
        return Err(ImportError::TooComplex);
    }
    if walker.cancelled || cancel.load(Ordering::Relaxed) {
        return Err(ImportError::Cancelled);
    }
    let stats = walker.stats.clone();
    Ok((sink, stats))
}

/// Een uniek deelbestand naast het doel: twee imports naar hetzelfde doel
/// (of een achtergebleven deelbestand) zitten elkaar zo niet in de weg.
fn partial_path(output: &Path) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = output.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "import".into());
    output.with_file_name(format!("{name}.{}-{n}.deel", std::process::id()))
}

/// Vergroot een knipvierhoek naar buiten met `d` punten langs zijn eigen
/// assen (ook als hij gedraaid is): lijnen op de rand van de tekening worden
/// dan niet voor de helft weggeknipt.
pub fn grow_quad(corners: [Point; 4], d: f64) -> [Point; 4] {
    let unit = |a: Point, b: Point| {
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let len = (dx * dx + dy * dy).sqrt();
        if len < 1e-12 {
            (0.0, 0.0)
        } else {
            (dx / len, dy / len)
        }
    };
    let e1 = unit(corners[0], corners[1]);
    let e2 = unit(corners[0], corners[3]);
    let shift = |p: Point, s1: f64, s2: f64| Point::new(p.x + (e1.0 * s1 + e2.0 * s2) * d, p.y + (e1.1 * s1 + e2.1 * s2) * d);
    [
        shift(corners[0], -1.0, -1.0),
        shift(corners[1], 1.0, -1.0),
        shift(corners[2], 1.0, 1.0),
        shift(corners[3], -1.0, 1.0),
    ]
}

/// Dunste lijn waar het knipvlak rekening mee houdt. Een haarlijn (dikte 0)
/// wordt toch één beeldpunt breed getekend; een kwart millimeter dekt dat af.
const MIN_CLIP_STROKE_MM: f64 = 0.25;

/// Hoeveel het knipvlak om de grenzen groeit, in punten: de helft van de
/// dikste lijn die werkelijk getekend wordt. `widest_stroke_pt` komt uit de
/// wandeling die de grenzen bepaalt en is dus al de dikte op papier (vaste
/// dikte, factor en minimum zijn verwerkt; lagen en entiteiten die niet
/// meedoen tellen niet mee). Zo blijft een lijn op de rand heel zonder dat er
/// meer dan nodig buiten het gekozen gebied zichtbaar wordt.
pub fn clip_growth_pt(widest_stroke_pt: f64) -> f64 {
    let floor = MIN_CLIP_STROKE_MM * PT_PER_MM;
    0.5 * if widest_stroke_pt.is_finite() { widest_stroke_pt.max(floor) } else { floor }
}

/// Zet een tekening om naar een PDF met één pagina per gekozen ruimte.
pub fn convert(
    drawing: &Drawing,
    options: &ImportOptions,
    output: &Path,
    cancel: &AtomicBool,
    progress: impl FnMut(ImportProgress),
) -> Result<ImportResult, ImportError> {
    let progress = std::cell::RefCell::new(progress);
    let report = |phase: ImportPhase, done: u64, total: u64| (progress.borrow_mut())(ImportProgress { phase, done, total });
    let document = &drawing.document;
    // Een bestaand bestand wordt nooit stil vervangen.
    if output.exists() {
        return Err(ImportError::Exists(output.display().to_string()));
    }
    // Een venster dat niet deugt is een fout van de aanroeper; stil de grenzen
    // nemen zou een andere pagina opleveren dan gevraagd.
    if let AreaChoice::Window(rect) = options.area {
        let valid = rect.iter().all(|v| v.is_finite()) && rect[2] > rect[0] && rect[3] > rect[1];
        if !valid {
            return Err(ImportError::InvalidWindow);
        }
    }
    // Zonder PDF-lagen kan een laag niet verborgen meekomen: dan blijft hij weg.
    let mut effective = options.clone();
    if !effective.layers_as_ocg && !effective.hidden_layers.is_empty() {
        let hidden = std::mem::take(&mut effective.hidden_layers);
        effective.excluded_layers.extend(hidden);
    }
    let options = &effective;
    let unit = options.units.unwrap_or_else(|| DrawingUnit::from_insunits(document.header.insertion_units).unwrap_or(DrawingUnit::Mm));
    let mm_per_unit = unit.mm_per_unit();
    let hidden: HashSet<String> = options.hidden_layers.iter().map(|l| l.to_uppercase()).collect();
    let mut registry = LayerRegistry::default();
    let mut pages = Vec::new();
    let mut results = Vec::new();
    let mut stats = WalkStats::default();
    // Vervangen letters tellen per tekststijl over de hele import: dezelfde
    // stijl op vijf bladen is één vervanging, twee stijlen op twee bladen twee.
    let mut replaced_styles: HashSet<String> = HashSet::new();
    let spaces = if options.spaces.is_empty() { vec!["model".to_string()] } else { options.spaces.clone() };
    let cancelled = || cancel.load(Ordering::Relaxed);
    // Werkgrenzen van de hele import: één bezoekbudget voor alle wandelingen
    // (grenzen en tekenen, elke ruimte) en één voor alle inhoudsstromen samen.
    let budget = VisitBudget::new(options.max_visits);
    let mut content_left = options.max_content_bytes;
    let mut simplified = false;

    // Externe verwijzingen één keer laden voor de hele import; de map van de
    // tekening telt altijd mee, andere mappen alleen als de gebruiker ze koos.
    let paths = xref::SearchPaths::for_drawing(&drawing.path, &options.search_paths);
    let xrefs = if options.xrefs {
        if document.block_records.iter().any(xref::is_xref) {
            report(ImportPhase::Read, 0, 0);
        }
        let mut xref_budget = xref::MAX_XREF_BYTES;
        Some(xref::XrefDocs::load(document, Some(&drawing.path), &paths, &mut xref_budget, cancel))
    } else {
        None
    };
    // Afbeeldingen: één voorraad voor de hele import, zodat elk bestand één
    // keer gelezen wordt en de begroting over alle pagina's samen gaat.
    let images = options.images.then(|| image::ImageStore::new(paths.clone(), options.max_image_pixels));
    let externals = Externals { xrefs: xrefs.as_ref(), images: images.as_ref() };

    for (index, space) in spaces.iter().enumerate() {
        if cancelled() {
            return Err(ImportError::Cancelled);
        }
        let Some(record) = scan::space_record(document, space) else {
            return Err(ImportError::Empty(space.clone()));
        };
        report(ImportPhase::Scan, index as u64, spaces.len() as u64);
        let (bounds_sink, bounds_stats) = space_bounds(drawing, space, options, externals, cancel, &budget)?;
        let content_bounds = bounds_sink.bounds;
        // Voorbeeldstand van een zware ruimte: zonder arceerpatronen, tekst en
        // maatvoering is ze snel klaar en laat ze toch de opbouw zien. Effen
        // vullingen blijven (één pad per vlak, en zonder die vlakken ziet een
        // tekening er heel anders uit); een patroon wordt zijn omtrek, want de
        // patroonlijnen zijn wat een arcering duur maakt. Wie arceringen al
        // soberder had gekozen, houdt zijn keuze. De
        // grenzen hierboven zijn die van de volledige tekening, dus papier,
        // schaal en plaatsing zijn die van de echte import. Alleen wát er
        // getekend wordt verandert: de werkgrenzen en de afbreekvlag blijven.
        let simplified_options;
        let simplified_here = options.preview && bounds_stats.entities > PREVIEW_SIMPLE_ABOVE;
        let options = if simplified_here {
            simplified = true;
            let hatch = if options.hatch == HatchMode::All { HatchMode::SolidOnly } else { options.hatch };
            simplified_options = ImportOptions { hatch, text: false, dimensions: false, ..options.clone() };
            &simplified_options
        } else {
            options
        };

        let (plan, measures, clip) = if record.is_model {
            let (area, is_window) = match options.area {
                AreaChoice::Window(rect) => (rect, true),
                AreaChoice::Limits => {
                    let (min, max) = (document.header.model_space_limits_min, document.header.model_space_limits_max);
                    if max.x > min.x && max.y > min.y {
                        ([min.x, min.y, max.x, max.y], false)
                    } else {
                        (content_bounds.ok_or_else(|| ImportError::Empty(space.clone()))?, false)
                    }
                }
                _ => (content_bounds.ok_or_else(|| ImportError::Empty(space.clone()))?, false),
            };
            let request = ModelLayoutRequest {
                area,
                mm_per_unit,
                scale: options.scale,
                paper: options.paper.clone(),
                orientation: options.orientation,
                margin_mm: options.margin_mm,
                placement: options.placement,
                rotation_deg: options.rotation_deg,
                base_point: options
                    .base_point
                    .unwrap_or((document.header.model_space_insertion_base.x, document.header.model_space_insertion_base.y)),
            };
            let plan = paper::plan_model_page(&request).map_err(plan_error)?;
            let measure = options.measure.then(|| {
                let mut measure = pdf_out::page_measure(
                    plan.width_pt,
                    plan.height_pt,
                    plan.scale,
                    unit.app_unit(),
                    mm_per_unit,
                    options.model_matrix.then(|| invert(&plan.matrix)).flatten(),
                );
                measure.name = record.label.clone();
                measure
            });
            // Een venster knipt precies; bij grenzen of limits iets ruimer,
            // zodat lijnen op de rand heel blijven.
            let grow = if is_window { 0.0 } else { clip_growth_pt(bounds_sink.widest_stroke_pt) };
            let clip = plan.clip.map(|corners| {
                let corners = if grow > 0.0 { grow_quad(corners, grow) } else { corners };
                let mut path = PagePath::new();
                path.move_to(corners[0]);
                for c in &corners[1..] {
                    path.line_to(*c);
                }
                path.close();
                path
            });
            (plan, measure.into_iter().collect::<Vec<_>>(), clip)
        } else {
            let mut paper_info = space_paper(document, &record, mm_per_unit);
            // Een zelf gekozen papierformaat gaat voor wat de layout zegt;
            // veel DWG's dragen hun plotinstellingen niet mee.
            match &options.paper {
                PaperChoice::Named(id) => {
                    if let Some(size) = paper::paper_by_id(id) {
                        let landscape = match options.orientation {
                            Orientation::Landscape => true,
                            Orientation::Portrait => false,
                            Orientation::Auto => content_bounds
                                .map(|b| (b[2] - b[0]) > (b[3] - b[1]))
                                .unwrap_or(paper_info.width_mm > paper_info.height_mm),
                        };
                        let (w, h) = if landscape { (size.height_mm, size.width_mm) } else { (size.width_mm, size.height_mm) };
                        paper_info.width_mm = w;
                        paper_info.height_mm = h;
                        paper_info.rotation = 0;
                        paper_info.name = size.id.to_string();
                        paper_info.forced = true;
                    }
                }
                PaperChoice::Custom { width_mm, height_mm } => {
                    paper_info.width_mm = *width_mm;
                    paper_info.height_mm = *height_mm;
                    paper_info.rotation = 0;
                    paper_info.name = "custom".into();
                    paper_info.forced = true;
                }
                PaperChoice::Auto => {}
            }
            let plan = paper::plan_layout_page(&paper_info, content_bounds, options.margin_mm).map_err(plan_error)?;
            (plan, Vec::new(), None)
        };

        let use_ocg = options.layers_as_ocg;
        let mut builder = PageBuilder::new(plan.width_pt, plan.height_pt, &mut registry, use_ocg)
            .with_max_bytes(content_left)
            .with_forms(options.reuse_blocks);
        if let Some(clip) = &clip {
            builder.clip_to(clip);
        }
        let draw_total = bounds_stats.visits.max(1);
        report(ImportPhase::Draw, 0, draw_total);
        let (walker_stats, viewports, page_styles, walker_cancelled, too_complex) = {
            let mut walker = Walker::new(document, walk_settings(options), drawing.is_dxf);
            externals.give(&mut walker);
            walker.share_budget(&budget);
            walker.on_cancel(move || cancel.load(Ordering::Relaxed));
            walker.on_progress(|done| report(ImportPhase::Draw, done.min(draw_total), draw_total));
            let xf = Xform3::from_matrix(&plan.matrix);
            if record.is_model {
                walker.model_space(xf, &mut builder);
            } else {
                walker.paper_space(&record.record, xf, &mut builder);
            }
            (
                walker.stats.clone(),
                std::mem::take(&mut walker.measure_viewports),
                std::mem::take(&mut walker.replaced_styles),
                walker.cancelled,
                walker.too_complex,
            )
        };
        replaced_styles.extend(page_styles);
        if too_complex || builder.is_full() {
            return Err(ImportError::TooComplex);
        }
        if walker_cancelled || cancelled() {
            return Err(ImportError::Cancelled);
        }
        report(ImportPhase::Draw, draw_total, draw_total);
        let mut measures = measures;
        if !record.is_model && options.measure {
            // Papier op ware grootte, en elke viewport zijn eigen schaal.
            measures.push(PageMeasure {
                bbox: [0.0, 0.0, plan.width_pt, plan.height_pt],
                units_per_point: 25.4 / 72.0,
                unit: "mm".into(),
                ratio: "1:1".into(),
                name: record.label.clone(),
                model_matrix: None,
                model_units: "mm".into(),
                outline: Vec::new(),
            });
            for (number, viewport) in viewports.iter().enumerate() {
                let units_per_point = viewport.units_per_point;
                let scale = units_per_point * mm_per_unit / (25.4 / 72.0);
                measures.push(PageMeasure {
                    bbox: viewport.bbox,
                    units_per_point,
                    unit: unit.app_unit().to_string(),
                    ratio: paper::scale_text(scale),
                    name: format!("{} {}", record.label, number + 1),
                    model_matrix: options.model_matrix.then(|| invert(&viewport.matrix)).flatten(),
                    model_units: unit.app_unit().to_string(),
                    outline: viewport.outline.clone(),
                });
            }
        }
        let objects = builder.items;
        // Wat de pagina van de bovengrens afneemt; met formulieren is dat meer
        // dan de inhoudsstroom zelf (zie `PageBuilder::charged_bytes`).
        let charged = builder.charged_bytes();
        let (content, layers, alphas, fonts, page_images, forms) = builder.finish();
        content_left = content_left.saturating_sub(charged.max(content.len()));
        merge_stats(&mut stats, &walker_stats);
        // Welke opgenomen blokken echt een formulier werden, weet de pagina
        // pas als ze af is.
        stats.forms_written += forms.len() as u64;
        stats.forms_reused += forms.iter().map(|form| form.uses).sum::<u64>();
        results.push(PageResult {
            space: space.clone(),
            label: record.label.clone(),
            width_mm: plan.width_mm,
            height_mm: plan.height_mm,
            paper: plan.paper.clone(),
            scale: plan.scale,
            scale_text: paper::scale_text(plan.scale),
            objects,
            offset: offset_of(&plan, record.is_model),
            simplified: simplified_here,
        });
        pages.push(OutputPage {
            width_pt: plan.width_pt,
            height_pt: plan.height_pt,
            content,
            layers,
            alphas,
            fonts,
            images: page_images,
            forms,
            measures,
            label: record.label.clone(),
        });
    }

    // Het laden gebeurt één keer per import, niet per pagina: daarom komen deze
    // tellingen hier en niet via `merge_stats`.
    stats.fonts_replaced = replaced_styles.len() as u64;
    if let Some(xrefs) = &xrefs {
        stats.xrefs_loaded = xrefs.loaded();
        stats.xrefs_missing = xrefs.missing();
        stats.xrefs_refused = xrefs.refused();
        stats.odd_names += xrefs.odd_names();
    }
    // Wat er van buiten de tekening gelezen is (of niet), bij naam.
    let mut listed = xref::ExternalList::default();
    if let Some(xrefs) = &xrefs {
        listed.extend(xrefs.listed());
    }
    if let Some(images) = &images {
        listed.extend(&images.listed());
    }
    let (externals, externals_truncated) = listed.into_parts();
    // De voorraad loslaten: de pagina's houden vast wat ze gebruiken, en het
    // schrijven kan de bytes van een beeld dan overnemen in plaats van kopiëren.
    drop(images);
    for name in registry.names.clone() {
        if hidden.contains(&name.to_uppercase()) {
            registry.hide(&name);
        }
    }
    report(ImportPhase::Write, 0, pages.len() as u64);
    let title = drawing.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    // Eerst naar een uniek deelbestand, dan hernoemen: een half bestand blijft
    // nooit staan, ook niet bij afbreken of een schrijffout.
    let temporary = partial_path(output);
    let written = (|| -> std::io::Result<()> {
        let file = std::fs::File::create(&temporary)?;
        let mut writer = std::io::BufWriter::new(file);
        pdf_out::write_pdf_with(&mut writer, pages, &registry, &title, options.preview, &cancelled, &mut |done, total| {
            report(ImportPhase::Write, done, total)
        })?;
        use std::io::Write;
        writer.flush()?;
        drop(writer);
        if output.exists() {
            return Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, output.display().to_string()));
        }
        std::fs::rename(&temporary, output)
    })();
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temporary);
        if error.kind() == std::io::ErrorKind::Interrupted || cancelled() {
            return Err(ImportError::Cancelled);
        }
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            // Tussen de controle vooraf en het hernoemen verscheen het doel.
            return Err(ImportError::Exists(output.display().to_string()));
        }
        return Err(ImportError::Io(error.to_string()));
    }
    let file_size = std::fs::metadata(output).map(|m| m.len()).unwrap_or(0);
    let mut warnings = warnings_from(&stats);
    if simplified {
        warnings.push(format!("previewSimplified:{}", PREVIEW_SIMPLE_ABOVE));
    }
    Ok(ImportResult {
        output_path: output.to_string_lossy().to_string(),
        pages: results,
        file_size,
        warnings,
        stats,
        externals,
        externals_truncated,
        simplified,
    })
}

fn plan_error(error: PlanError) -> ImportError {
    match error {
        PlanError::EmptyArea => ImportError::Empty(String::new()),
        PlanError::PageTooLarge { width_mm, height_mm } => ImportError::PageTooLarge { width_mm, height_mm },
    }
}

fn offset_of(plan: &PagePlan, is_model: bool) -> [f64; 2] {
    if !is_model {
        return [0.0, 0.0];
    }
    // Welk punt van de tekening ligt op de oorsprong van de pagina?
    match invert(&plan.matrix) {
        Some(inverse) => {
            let p = inverse.apply(Point::new(0.0, 0.0));
            [p.x, p.y]
        }
        None => [0.0, 0.0],
    }
}

/// Inverse van een affiene matrix.
pub fn invert(m: &Matrix) -> Option<Matrix> {
    m.inverse()
}

fn merge_stats(target: &mut WalkStats, source: &WalkStats) {
    target.visits += source.visits;
    target.entities += source.entities;
    target.drawn += source.drawn;
    target.texts += source.texts;
    target.hatches += source.hatches;
    target.hatch_patterns_skipped += source.hatch_patterns_skipped;
    target.light_fills_dropped += source.light_fills_dropped;
    target.blocks_expanded += source.blocks_expanded;
    target.missing_blocks += source.missing_blocks;
    target.xrefs_skipped += source.xrefs_skipped;
    target.images_skipped += source.images_skipped;
    target.images_embedded += source.images_embedded;
    target.images_missing += source.images_missing;
    target.images_refused += source.images_refused;
    target.images_too_large += source.images_too_large;
    target.images_unsupported += source.images_unsupported;
    target.odd_names += source.odd_names;
    target.viewports_drawn += source.viewports_drawn;
    target.viewports_3d_skipped += source.viewports_3d_skipped;
    target.viewports_cover_page += source.viewports_cover_page;
    target.sheets_by_coverage += source.sheets_by_coverage;
    target.unsupported += source.unsupported;
    target.replaced_characters += source.replaced_characters;
    // `fonts_replaced` hoort hier niet: de import telt de stijlnamen van alle
    // pagina's samen (zie `replaced_styles` in `convert`).
    target.deep_nesting += source.deep_nesting;
    for (name, count) in &source.skipped_types {
        *target.skipped_types.entry(name.clone()).or_default() += count;
    }
}

/// Waarschuwingscodes; de app vertaalt ze.
pub fn warnings_from(stats: &WalkStats) -> Vec<String> {
    let mut out = Vec::new();
    if stats.xrefs_loaded > 0 {
        out.push(format!("xrefsLoaded:{}", stats.xrefs_loaded));
    }
    if stats.xrefs_missing > 0 {
        out.push(format!("xrefsMissing:{}", stats.xrefs_missing));
    }
    if stats.xrefs_refused > 0 {
        out.push(format!("xrefsRefused:{}", stats.xrefs_refused));
    }
    if stats.xrefs_skipped > 0 {
        out.push(format!("xrefs:{}", stats.xrefs_skipped));
    }
    if stats.images_embedded > 0 {
        out.push(format!("imagesEmbedded:{}", stats.images_embedded));
    }
    if stats.images_missing > 0 {
        out.push(format!("imagesMissing:{}", stats.images_missing));
    }
    if stats.images_refused > 0 {
        out.push(format!("imagesRefused:{}", stats.images_refused));
    }
    if stats.images_too_large > 0 {
        out.push(format!("imagesTooLarge:{}", stats.images_too_large));
    }
    if stats.images_unsupported > 0 {
        out.push(format!("imagesUnsupported:{}", stats.images_unsupported));
    }
    if stats.odd_names > 0 {
        out.push(format!("oddNames:{}", stats.odd_names));
    }
    if stats.images_skipped > 0 {
        out.push(format!("images:{}", stats.images_skipped));
    }
    if stats.viewports_3d_skipped > 0 {
        out.push(format!("viewports3d:{}", stats.viewports_3d_skipped));
    }
    if stats.viewports_cover_page > 0 {
        out.push(format!("viewportCoversPage:{}", stats.viewports_cover_page));
    }
    if stats.sheets_by_coverage > 0 {
        out.push(format!("sheetByCoverage:{}", stats.sheets_by_coverage));
    }
    if stats.missing_blocks > 0 {
        out.push(format!("missingBlocks:{}", stats.missing_blocks));
    }
    if stats.hatch_patterns_skipped > 0 {
        out.push(format!("hatchPatterns:{}", stats.hatch_patterns_skipped));
    }
    if stats.light_fills_dropped > 0 {
        out.push(format!("lightFillsDropped:{}", stats.light_fills_dropped));
    }
    if stats.replaced_characters > 0 {
        out.push(format!("characters:{}", stats.replaced_characters));
    }
    if stats.fonts_replaced > 0 {
        out.push(format!("fontsReplaced:{}", stats.fonts_replaced));
    }
    if stats.deep_nesting > 0 {
        out.push(format!("nesting:{}", stats.deep_nesting));
    }
    if stats.unsupported > 0 {
        out.push(format!("unsupported:{}", stats.unsupported));
    }
    out
}

/// Verkenning van een bestand voor het importvenster. Af te breken via
/// `cancel`; boven de werkgrens `TooComplex`.
pub fn scan_drawing(drawing: &Drawing, cancel: &AtomicBool) -> Result<DrawingScan, ImportError> {
    scan::scan(drawing, cancel)
}

/// Als [`scan_drawing`], met voortgang per ruimte (fase "verkennen", geteld en
/// totaal bekend), zodat het venster bij een grote tekening niet stil staat.
pub fn scan_drawing_with(
    drawing: &Drawing,
    cancel: &AtomicBool,
    progress: impl FnMut(ImportProgress),
) -> Result<DrawingScan, ImportError> {
    scan::scan_with(drawing, cancel, walk::DEFAULT_MAX_VISITS, progress)
}

/// Als [`scan_drawing_with`], met de zoekpaden van de gebruiker: de lijst van
/// bestanden buiten de tekening zoekt dan ook in die mappen.
pub fn scan_drawing_with_paths(
    drawing: &Drawing,
    search_paths: &[PathBuf],
    cancel: &AtomicBool,
    progress: impl FnMut(ImportProgress),
) -> Result<DrawingScan, ImportError> {
    scan::scan_with_paths(drawing, search_paths, cancel, walk::DEFAULT_MAX_VISITS, progress)
}

/// Alleen het zoeken naar de bestanden buiten de tekening (externe
/// verwijzingen en afbeeldingen), zonder de rest van de verkenning: voor als
/// de gebruiker een zoekpad toevoegt of weghaalt. Er wordt niets gelezen.
/// Geeft de lijst (alleen bestandsnamen, begrensd) en of ze is afgekapt.
pub fn locate_externals(drawing: &Drawing, search_paths: &[PathBuf], cancel: &AtomicBool) -> (Vec<xref::ExternalFile>, bool) {
    scan::outside_files(drawing, search_paths, cancel).into_parts()
}

/// Punten per millimeter (voor aanroepers).
pub const POINTS_PER_MM: f64 = PT_PER_MM;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_get_sensible_defaults() {
        let args: ImportArgs = serde_json::from_str(r#"{"path":"a.dwg","outputPath":"a.pdf"}"#).unwrap();
        let options = args.options();
        assert_eq!(options.spaces, vec!["model".to_string()]);
        assert_eq!(options.paper, PaperChoice::Auto);
        assert_eq!(options.area, AreaChoice::Extents);
        assert!(options.scale.is_none());
        assert!(options.layers_as_ocg && options.measure);

        let args: ImportArgs = serde_json::from_str(
            r#"{"path":"a.dxf","outputPath":"a.pdf","spaces":["Layout1"],"scale":50,"paper":"A1",
                "area":"window","window":[0,0,100,50],"colors":"black","hatch":"outline",
                "lineweight":"fixed","lineweightMm":0.13,"units":"m","placement":"lower_left"}"#,
        )
        .unwrap();
        let options = args.options();
        assert_eq!(options.spaces, vec!["Layout1".to_string()]);
        assert_eq!(options.scale, Some(50.0));
        assert_eq!(options.paper, PaperChoice::Named("A1".into()));
        assert_eq!(options.area, AreaChoice::Window([0.0, 0.0, 100.0, 50.0]));
        assert_eq!(options.color_mode, ColorMode::Black);
        assert_eq!(options.hatch, HatchMode::Outline);
        assert_eq!(options.lineweight, LineweightMode::Fixed(0.13));
        assert_eq!(options.units, Some(DrawingUnit::M));
        assert_eq!(options.placement, Placement::LowerLeft);
    }

    #[test]
    fn over_long_pen_and_font_lists_are_refused_while_reading() {
        let pens = |n: usize| {
            let rows: Vec<String> = (0..n).map(|i| format!(r##"{{"color":"#{:06X}","lineweightMm":0.25}}"##, i)).collect();
            format!(r#"{{"path":"a.dxf","outputPath":"a.pdf","pens":[{}]}}"#, rows.join(","))
        };
        let args: ImportArgs = serde_json::from_str(&pens(style::MAX_PENS)).unwrap();
        assert_eq!(args.pens.len(), style::MAX_PENS);
        let error = serde_json::from_str::<ImportArgs>(&pens(style::MAX_PENS + 1)).unwrap_err().to_string();
        assert!(error.contains("IMPORT_ARGS_TOO_LONG:pens"), "{error}");

        let fonts = |n: usize| {
            let rows: Vec<String> = (0..n).map(|i| format!(r#"{{"from":"f{i}.shx","family":"mono"}}"#)).collect();
            format!(r#"{{"path":"a.dxf","outputPath":"a.pdf","fonts":[{}]}}"#, rows.join(","))
        };
        assert!(serde_json::from_str::<ImportArgs>(&fonts(text::MAX_FONT_RULES)).is_ok());
        let error = serde_json::from_str::<ImportArgs>(&fonts(text::MAX_FONT_RULES + 1)).unwrap_err().to_string();
        assert!(error.contains("IMPORT_ARGS_TOO_LONG:fonts"), "{error}");
        // Geen lijst, of `null`, blijft gewoon leeg.
        let args: ImportArgs = serde_json::from_str(r#"{"path":"a.dxf","pens":null}"#).unwrap();
        assert!(args.pens.is_empty() && args.fonts.is_empty());
    }

    #[test]
    fn inverting_a_matrix_returns_the_original_point() {
        let m = Matrix::translate(-100.0, -50.0).then(&Matrix::scale(2.0, 2.0)).then(&Matrix::new(0.0, 1.0, -1.0, 0.0, 10.0, 20.0));
        let inverse = invert(&m).unwrap();
        let p = Point::new(123.0, -45.0);
        let q = inverse.apply(m.apply(p));
        assert!((q.x - p.x).abs() < 1e-9 && (q.y - p.y).abs() < 1e-9);
        assert!(invert(&Matrix::scale(0.0, 1.0)).is_none());
    }
}
