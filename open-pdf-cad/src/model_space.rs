//! De terugweg naar CAD: de afbeelding pagina naar model van een geïmporteerde
//! pagina lezen (#400).
//!
//! De import schrijft per (viewport van de) pagina `/OPS_ModelMatrix` en
//! `/OPS_ModelUnits` in het `/VP`-woordenboek. Met die matrix kan de export een
//! geïmporteerde pagina terugschrijven in de coördinaten van de oorspronkelijke
//! tekening.
//!
//! # Waarom een eigen lezer
//!
//! Bij landelijke coördinaten staat in de matrix een verschuiving van 10⁸ mm
//! met duizendsten erachter. De gangbare PDF-bibliotheek bewaart een reëel
//! getal in 32 bits, goed voor zeven cijfers: daarmee komt de tekening meters
//! naast haar plek terug. Bovendien leest ze élk object van het bestand, en
//! recursief zonder grens: een keten van stroomlengtes die naar elkaar
//! verwijzen of een diep geneste array kost haar de stapel, en dat is geen
//! paniek die te vangen is. Daarom leest deze module het bestand helemaal
//! zelf: `startxref`, de kruisverwijzingen (tabel en stroom), de trailer, de
//! objectstromen en de objecten, met [`Parser`] en getallen in 64 bits, en
//! zonder een object te lezen dat niet op de weg naar de pagina ligt. Om
//! dezelfde reden schrijft de import zijn PDF ook zelf.
//!
//! # Grenzen
//!
//! Alles komt uit een bestand: geen `unwrap`, geen indexering zonder controle.
//!
//! - Niets wordt recursief gevolgd behalve arrays en woordenboeken, tot
//!   `MAX_DEPTH`. De lengte van een stroom komt uit een getal of een gewoon
//!   object, nooit uit een andere stroom; een objectstroom staat nooit in een
//!   objectstroom; de delen van de kruisverwijzingen worden in een rij
//!   afgewerkt, elk één keer en hoogstens `MAX_XREF_SECTIONS`.
//! - Eén leesronde heeft één budget: het aantal gelezen waarden, de bewaarde
//!   tekst en de uitgepakte bytes van stromen, over alle objecten heen. Elk
//!   object wordt één keer gelezen en daarna onthouden; elke objectstroom wordt
//!   één keer uitgepakt, begrensd, en alleen als dat met `FlateDecode` kan; een
//!   voorspeller werkt op de gemeten bytes. Is het budget op, dan is er "geen
//!   terugweg".
//! - De paginaboom wordt zelf doorlopen, in leesvolgorde, zonder een knoop twee
//!   keer te nemen en met een grens op het aantal knopen.
//! - De gebruiker kan afbreken: bij elk deel van de kruisverwijzingen en bij
//!   elk object.

use crate::convert::AreaRect;
use crate::error::ExportError;
use crate::geom::{Matrix, Point};
use crate::page_space::{DrawingUnit, PageFrame, PdfRect};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};

/// De afbeelding van (een deel van) een pagina naar het model van de
/// oorspronkelijke tekening.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelSpace {
    /// Gebruikersruimte van de pagina (punten, zonder `/Rotate`) naar
    /// tekeningeenheden.
    pub page_to_model: Matrix,
    /// Eenheid van de tekening.
    pub unit: DrawingUnit,
    /// De pagina noemt een eenheid die de export niet kent; [`Self::unit`] is
    /// dan niet te vertrouwen en [`PageModelSpaces::choose`] weigert.
    pub unknown_unit: Option<String>,
    /// Naam van de viewport, voor het verslag.
    pub name: String,
    /// Het deel van de pagina waar deze afbeelding geldt (gebruikersruimte);
    /// `None` als het bestand geen bruikbare `/BBox` noemt.
    pub bbox: Option<[f64; 4]>,
}

/// Alle afbeeldingen naar het model die een pagina draagt, met de pagina zelf.
#[derive(Clone, Debug, PartialEq)]
pub struct PageModelSpaces {
    pub frame: PageFrame,
    pub spaces: Vec<ModelSpace>,
}

/// Hoogste aantal viewports van een pagina; een pagina met meer draagt geen
/// terugweg, want van een halve lijst mag de keuze niet afhangen.
const MAX_VIEWPORTS: usize = 1024;
/// Speling in punten bij "beslaat het hele blad" en "het gebied ligt erin".
const SLACK_PT: f64 = 1.0;

impl PageModelSpaces {
    /// Kiest de afbeelding die bij de export hoort.
    ///
    /// - Met een exportgebied: de kleinste viewport waar het gebied helemaal in
    ///   ligt. Ligt het in geen enkele, dan is niet te zeggen welke coördinaten
    ///   bedoeld zijn.
    /// - Zonder gebied: de viewport die het hele blad beslaat, in maat én in
    ///   plaats (zo schrijft de import een modelpagina); anders de enige
    ///   viewport; bij meer vensters zonder gebied is de keuze niet te maken.
    ///
    /// Blijven er twee kandidaten over die even goed passen maar een andere
    /// afbeelding dragen, dan beslist de volgorde in het bestand niet: dat is
    /// [`ExportError::AmbiguousModelSpace`]. Noemt de gekozen viewport een
    /// eenheid die de export niet kent, dan is dat
    /// [`ExportError::UnknownModelUnits`].
    pub fn choose(&self, area: Option<AreaRect>) -> Result<ModelSpace, ExportError> {
        let chosen = self.candidate(area)?;
        match &chosen.unknown_unit {
            Some(unit) => Err(ExportError::UnknownModelUnits(unit.clone())),
            None => Ok(chosen),
        }
    }

    fn candidate(&self, area: Option<AreaRect>) -> Result<ModelSpace, ExportError> {
        if self.spaces.is_empty() {
            return Err(ExportError::NoModelSpace);
        }
        let ambiguous = || ExportError::AmbiguousModelSpace { viewports: self.spaces.len() as u32 };
        let size = |b: &[f64; 4]| (b[2] - b[0]).abs() * (b[3] - b[1]).abs();
        // Eén winnaar, of meer winnaars met dezelfde afbeelding.
        let only = |winners: &[&ModelSpace]| -> Result<ModelSpace, ExportError> {
            let first = winners.first().ok_or_else(ambiguous)?;
            let same = winners.iter().all(|w| w.page_to_model == first.page_to_model && w.unit == first.unit && w.unknown_unit == first.unknown_unit);
            if same {
                Ok((*first).clone())
            } else {
                Err(ambiguous())
            }
        };
        if let Some(area) = area {
            // Het gebied staat in de weergegeven pagina; de viewports in de
            // gebruikersruimte.
            let to_user = self.frame.to_display_points().inverse().ok_or_else(ambiguous)?;
            let (p, q) = (to_user.apply(Point::new(area.x0, area.y0)), to_user.apply(Point::new(area.x1, area.y1)));
            let wanted = [p.x.min(q.x), p.y.min(q.y), p.x.max(q.x), p.y.max(q.y)];
            if !wanted.iter().all(|v| v.is_finite()) {
                return Err(ambiguous());
            }
            let holds = |b: &[f64; 4]| {
                let (x0, y0, x1, y1) = (b[0].min(b[2]), b[1].min(b[3]), b[0].max(b[2]), b[1].max(b[3]));
                wanted[0] >= x0 - SLACK_PT && wanted[1] >= y0 - SLACK_PT && wanted[2] <= x1 + SLACK_PT && wanted[3] <= y1 + SLACK_PT
            };
            let holding: Vec<(&ModelSpace, f64)> = self.spaces.iter().filter_map(|s| s.bbox.as_ref().filter(|b| holds(b)).map(|b| (s, size(b)))).collect();
            let smallest = holding.iter().map(|(_, area)| *area).fold(f64::INFINITY, f64::min);
            if holding.is_empty() {
                // Eén afbeelding zonder omhullende: er valt niets te kiezen.
                return match self.spaces.as_slice() {
                    [single] if single.bbox.is_none() => Ok(single.clone()),
                    _ => Err(ambiguous()),
                };
            }
            // "Even groot" met een haar speling: twee vensters van dezelfde maat
            // verschillen hoogstens in de laatste cijfers.
            let winners: Vec<&ModelSpace> = holding.iter().filter(|(_, area)| *area <= smallest * (1.0 + 1e-9) + 1e-9).map(|(s, _)| *s).collect();
            return only(&winners);
        }
        let view = self.frame.view_box;
        let covers = |b: &[f64; 4]| {
            let (x0, y0, x1, y1) = (b[0].min(b[2]), b[1].min(b[3]), b[0].max(b[2]), b[1].max(b[3]));
            let (left, bottom, right, top) = (view.left.min(view.right), view.bottom.min(view.top), view.left.max(view.right), view.bottom.max(view.top));
            (x0 - left).abs() <= SLACK_PT && (y0 - bottom).abs() <= SLACK_PT && (x1 - right).abs() <= SLACK_PT && (y1 - top).abs() <= SLACK_PT
        };
        let whole: Vec<&ModelSpace> = self.spaces.iter().filter(|s| s.bbox.as_ref().is_some_and(|b| covers(b))).collect();
        match (whole.as_slice(), self.spaces.as_slice()) {
            ([], [single]) => Ok(single.clone()),
            ([], _) => Err(ambiguous()),
            (sheets, _) => only(sheets),
        }
    }
}

/// Leest de terugweg van een pagina in een PDF-bestand en kiest zonder
/// exportgebied (zie [`PageModelSpaces::choose`]). `None` als de pagina hem
/// niet draagt, als de keuze niet te maken is, of als het bestand niet te
/// lezen is.
pub fn read(pdf_path: &Path, page_index: u32) -> Option<ModelSpace> {
    read_page(pdf_path, page_index)?.choose(None).ok()
}

/// Alle afbeeldingen naar het model van een pagina. `None` als het bestand of
/// de pagina niet te lezen is; een pagina zonder `/VP` geeft een lege lijst.
pub fn read_page(pdf_path: &Path, page_index: u32) -> Option<PageModelSpaces> {
    load(pdf_path, page_index, None).ok()
}

/// Als [`read_page`], met de reden erbij: een bestand dat niet te openen is
/// (niet gevonden, geen rechten, vergrendeld) is een bestandsfout en geen
/// "pagina zonder terugweg"; afbreken is afbreken.
pub fn load(pdf_path: &Path, page_index: u32, cancel: Option<&AtomicBool>) -> Result<PageModelSpaces, ExportError> {
    let io = |e: std::io::Error| ExportError::Io(format!("{}: {e}", pdf_path.display()));
    let handle = std::fs::File::open(pdf_path).map_err(io)?;
    if handle.metadata().map_err(io)?.len() == 0 {
        // Een leeg bestand is niet in het geheugen af te beelden, en het
        // draagt ook niets.
        return Err(ExportError::NoModelSpace);
    }
    // Afgebeeld in het geheugen, zoals bij het uitlezen van de pagina: een
    // plot van honderden megabytes hoeft er niet nog eens naast te staan.
    // SAFETY: alleen lezen; een bestand dat intussen verandert, geeft hoogstens
    // een lezing die nergens op slaat, en elke stap controleert zijn grenzen.
    let file = unsafe { memmap2::Mmap::map(&handle) }.map_err(io)?;
    load_mem(&file, page_index, cancel)
}

/// Als [`read_page`], uit de bytes van het bestand.
pub fn read_mem(file: &[u8], page_index: u32) -> Option<PageModelSpaces> {
    load_mem(file, page_index, None).ok()
}

/// Als [`load`], uit de bytes van het bestand.
pub fn load_mem(file: &[u8], page_index: u32, cancel: Option<&AtomicBool>) -> Result<PageModelSpaces, ExportError> {
    let source = Source::new(file, cancel)?;
    let found = source.spaces_of(page_index);
    if source.cancelled.get() {
        return Err(ExportError::Cancelled);
    }
    // Een budget dat op is, heeft onderweg objecten onleesbaar gemaakt: van
    // een halve lijst viewports mag de keuze niet afhangen.
    if source.budget.values_left.get() == 0 {
        return Err(ExportError::NoModelSpace);
    }
    found.ok_or(ExportError::NoModelSpace)
}

fn matrix_of(value: &Value) -> Option<Matrix> {
    let v = numbers::<6>(value)?;
    let m = Matrix::new(v[0], v[1], v[2], v[3], v[4], v[5]);
    let determinant = m.determinant();
    (determinant.is_finite() && determinant.abs() > 1e-18).then_some(m)
}

/// Precies `N` eindige getallen, of niets.
fn numbers<const N: usize>(value: &Value) -> Option<[f64; N]> {
    let Value::Array(items) = value else { return None };
    if items.len() != N {
        return None;
    }
    let mut out = [0.0; N];
    for (slot, item) in out.iter_mut().zip(items) {
        match item {
            Value::Number(n) if n.is_finite() => *slot = *n,
            _ => return None,
        }
    }
    Some(out)
}

fn text_of(value: &Value) -> String {
    match value {
        Value::Text(bytes) => {
            // UTF-16BE met BOM (zo schrijft de import namen buiten ASCII).
            if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
                let units: Vec<u16> = rest.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                String::from_utf16_lossy(&units)
            } else {
                String::from_utf8_lossy(bytes).into_owned()
            }
        }
        Value::Name(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        _ => String::new(),
    }
}

/// De eenheid van het model. Zonder `/OPS_ModelUnits` is het millimeter (zo
/// schrijft de import het ook); een eenheid die er wél staat maar die de export
/// niet kent, wordt niet stil voor millimeter gehouden: de tweede waarde noemt
/// haar, en [`PageModelSpaces::choose`] weigert dan.
fn unit_of(value: Option<&Value>) -> (DrawingUnit, Option<String>) {
    let Some(value) = value else { return (DrawingUnit::Mm, None) };
    let written = text_of(value);
    match DrawingUnit::from_app_unit(written.trim().to_lowercase().as_str()) {
        Some(unit) => (unit, None),
        None => (DrawingUnit::Mm, Some(written.trim().chars().take(32).collect())),
    }
}

// ── Waar een object staat ────────────────────────────────────────────────

/// Een woordenboek als lijst van sleutel en waarde.
struct Dict(Vec<(Vec<u8>, Value)>);

impl Dict {
    fn get(&self, key: &[u8]) -> Option<&Value> {
        entry(&self.0, key)
    }
}

fn entry<'v>(entries: &'v [(Vec<u8>, Value)], key: &[u8]) -> Option<&'v Value> {
    entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

/// Een geheel getal zonder teken, of niets.
fn integer_of(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(n)) if n.fract() == 0.0 && *n >= 0.0 && *n <= 9_007_199_254_740_992.0 => Some(*n as u64),
        _ => None,
    }
}

// ── Stromen uitpakken ────────────────────────────────────────────────────

/// De inhoud van een stroom, begrensd tot `limit` bytes: zonder filter zoals
/// ze er staat, met `FlateDecode` (het enige filter dat hier voorkomt)
/// uitgepakt, en een voorspeller uit `/DecodeParms` toegepast op de zo gemeten
/// bytes. Een ander filter of een voorspeller die niet bij de gemeten bytes
/// past, geeft niets.
fn decode_stream(raw: &[u8], dict: &Dict, limit: usize) -> Option<Vec<u8>> {
    let filters: Vec<&Value> = match dict.get(b"Filter") {
        None => Vec::new(),
        Some(Value::Array(items)) => items.iter().collect(),
        Some(single) => vec![single],
    };
    let out = match filters.as_slice() {
        [] => (raw.len() <= limit).then(|| raw.to_vec())?,
        [Value::Name(name)] if name == b"FlateDecode" => inflate_bounded(raw, limit)?,
        _ => return None,
    };
    let params = match dict.get(b"DecodeParms") {
        Some(Value::Array(items)) if items.len() == 1 => items.first(),
        other => other,
    };
    match params {
        None | Some(Value::Other) => Some(out),
        Some(Value::Dict(entries)) => unpredict(out, entries),
        _ => None,
    }
}

/// Pakt `FlateDecode` uit tot hoogstens `limit` bytes; meer is te veel. Een
/// leesfout telt als het einde van de stroom.
fn inflate_bounded(raw: &[u8], limit: usize) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut out = Vec::new();
    let _ = flate2::read::ZlibDecoder::new(raw).take(limit as u64 + 1).read_to_end(&mut out);
    (out.len() <= limit).then_some(out)
}

/// De voorspeller uit `/DecodeParms`: geen (1) laat de bytes zoals ze zijn;
/// de PNG-voorspellers (10–15) worden per regel teruggerekend. De regelmaat
/// komt uit het woordenboek, maar past er geen hele regel in de gemeten bytes,
/// dan klopt het woordenboek niet en is de stroom onleesbaar: de werkruimte is
/// zo nooit groter dan wat er al gemeten is.
fn unpredict(data: Vec<u8>, params: &[(Vec<u8>, Value)]) -> Option<Vec<u8>> {
    let number = |key: &[u8], default: u64| match entry(params, key) {
        None => Some(default),
        found => integer_of(found),
    };
    let predictor = number(b"Predictor", 1)?;
    if predictor == 1 {
        return Some(data);
    }
    if !(10..=15).contains(&predictor) {
        return None;
    }
    let (colors, bits, columns) = (number(b"Colors", 1)?, number(b"BitsPerComponent", 8)?, number(b"Columns", 1)?);
    if !(1..=64).contains(&colors) || !matches!(bits, 1 | 2 | 4 | 8 | 16) || columns == 0 {
        return None;
    }
    // Bytes per regel, en per pixel (voor de voorspeller minstens één).
    let row = usize::try_from((colors * bits).checked_mul(columns)?.div_ceil(8)).ok()?;
    let pixel = usize::try_from((colors * bits).div_ceil(8)).ok()?.max(1);
    // Elke regel is één filterbyte plus `row` bytes.
    if row.checked_add(1)? > data.len() {
        return None;
    }
    let mut out = Vec::with_capacity(data.len());
    let mut previous = vec![0u8; row];
    let mut current = vec![0u8; row];
    for line in data.chunks_exact(row + 1) {
        let (&filter, bytes) = line.split_first()?;
        current.copy_from_slice(bytes);
        // `previous` en `current` zijn beide precies `row` lang.
        for i in 0..row {
            let (left, up_left) = match i.checked_sub(pixel) {
                Some(j) => (current[j], previous[j]),
                None => (0, 0),
            };
            let up = previous[i];
            let guess = match filter {
                0 => 0,
                1 => left,
                2 => up,
                3 => ((u16::from(left) + u16::from(up)) / 2) as u8,
                4 => paeth(left, up, up_left),
                _ => return None,
            };
            current[i] = current[i].wrapping_add(guess);
        }
        out.extend_from_slice(&current);
        std::mem::swap(&mut previous, &mut current);
    }
    Some(out)
}

/// De regels van een kruisverwijzingsstroom: velden van `/W` bytes breed, voor
/// de objectnummers uit `/Index` (zonder: alle vanaf 0). Regels van een ander
/// soort dan "in het bestand" (1) of "in een objectstroom" (2) tellen niet.
fn xref_rows(rows: &[u8], dict: &Dict) -> Option<Vec<(u32, XrefEntry)>> {
    let Some(Value::Array(widths)) = dict.get(b"W") else { return None };
    let mut w = [0usize; 3];
    if widths.len() < w.len() {
        return None;
    }
    for (slot, item) in w.iter_mut().zip(widths) {
        *slot = usize::try_from(integer_of(Some(item))?).ok().filter(|n| *n <= 8)?;
    }
    let ranges: Vec<u64> = match dict.get(b"Index") {
        Some(Value::Array(items)) => items.iter().map(|i| integer_of(Some(i))).collect::<Option<_>>()?,
        None => vec![0, integer_of(dict.get(b"Size"))?],
        _ => return None,
    };
    let mut at = 0usize;
    let mut field = |width: usize| -> Option<u64> {
        let bytes = rows.get(at..at.checked_add(width)?)?;
        at += width;
        Some(bytes.iter().fold(0u64, |acc, b| (acc << 8) | u64::from(*b)))
    };
    let mut entries = Vec::new();
    for range in ranges.chunks_exact(2) {
        let [start, count] = range else { return None };
        for i in 0..*count {
            let kind = if w[0] == 0 { 1 } else { field(w[0])? };
            let (a, b) = (field(w[1])?, field(w[2])?);
            let number = u32::try_from(start.checked_add(i)?).ok()?;
            let entry = match (kind, u16::try_from(b), usize::try_from(b)) {
                (1, Ok(generation), _) => XrefEntry::Normal { offset: usize::try_from(a).ok()?, generation },
                (2, _, Ok(index)) => XrefEntry::Compressed { container: u32::try_from(a).ok()?, index },
                _ => continue,
            };
            entries.push((number, entry));
            if entries.len() > MAX_XREF_ENTRIES {
                return None;
            }
        }
    }
    Some(entries)
}

fn paeth(left: u8, up: u8, up_left: u8) -> u8 {
    let (a, b, c) = (i16::from(left), i16::from(up), i16::from(up_left));
    let p = a + b - c;
    let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
    if pa <= pb && pa <= pc {
        left
    } else if pb <= pc {
        up
    } else {
        up_left
    }
}

//// Hoeveel waarden het lezen van één pagina bij elkaar mag kosten, over alle
/// objecten heen. Ruim voor een document met tienduizenden pagina's; een
/// bestand dat meer vraagt, geeft "geen terugweg".
const MAX_VALUES_TOTAL: usize = 2_000_000;
/// Hoeveel bytes tekst er bij elkaar bewaard worden; wat erboven komt, wordt
/// gelezen en weggegooid (de naam van een viewport is enkele tientallen bytes).
const MAX_TEXT_TOTAL: usize = 8 << 20;
/// Hoogstens zoveel bytes van één tekst worden bewaard.
const MAX_TEXT: usize = 64 << 10;
/// Uitgepakte objectstromen: per stroom en bij elkaar.
const MAX_UNPACKED_STREAM: usize = 64 << 20;
const MAX_UNPACKED_TOTAL: usize = 256 << 20;
/// Hoogste aantal objecten in de index van één objectstroom.
const MAX_PACKED_OBJECTS: usize = 100_000;
/// Hoogste aantal knopen van de paginaboom dat bezocht wordt.
const MAX_PAGE_NODES: usize = 1_000_000;

/// Het gedeelde budget van één leesronde.
struct Budget {
    values_left: Cell<usize>,
    text_left: Cell<usize>,
    unpacked_left: Cell<usize>,
}

impl Budget {
    fn new() -> Self {
        Budget { values_left: Cell::new(MAX_VALUES_TOTAL), text_left: Cell::new(MAX_TEXT_TOTAL), unpacked_left: Cell::new(MAX_UNPACKED_TOTAL) }
    }
}

/// Een uitgepakte objectstroom: de bytes en de index (objectnummer, plaats).
struct Packed {
    content: Vec<u8>,
    first: usize,
    index: Vec<(u64, u64)>,
}

/// Waar een object staat: op een plek in het bestand, of in een objectstroom.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum XrefEntry {
    Normal { offset: usize, generation: u16 },
    Compressed { container: u32, index: usize },
}

/// Eén deel van de kruisverwijzingen met zijn trailer (bij een
/// kruisverwijzingsstroom is dat haar woordenboek).
struct Section {
    entries: Vec<(u32, XrefEntry)>,
    trailer: Dict,
}

/// Hoogste aantal delen van de kruisverwijzingen (`/Prev`, `/XRefStm`) dat
/// gevolgd wordt.
const MAX_XREF_SECTIONS: usize = 64;
/// Hoogste aantal kruisverwijzingen bij elkaar; van een halve tabel mag niets
/// afhangen.
const MAX_XREF_ENTRIES: usize = 4_000_000;

/// De kruisverwijzingen van het bestand naast zijn bytes.
///
/// Alles wat hier gelezen wordt, gaat van één gedeeld budget af: elk object
/// wordt één keer gelezen en daarna onthouden, elke objectstroom wordt één keer
/// en begrensd uitgepakt, en de gebruiker kan afbreken.
struct Source<'a> {
    xref: HashMap<u32, XrefEntry>,
    root: Option<(u32, u16)>,
    file: &'a [u8],
    cancel: Option<&'a AtomicBool>,
    cancelled: Cell<bool>,
    budget: Budget,
    objects: RefCell<HashMap<(u32, u16), Option<Rc<Value>>>>,
    streams: RefCell<HashMap<u32, Option<Rc<Packed>>>>,
}

/// Hoe diep een verwijzing naar een verwijzing gevolgd wordt, en hoe hoog de
/// paginaboom beklommen wordt.
const MAX_HOPS: usize = 32;

impl<'a> Source<'a> {
    /// Leest de opbouw van het bestand; een bestand zonder leesbare
    /// kruisverwijzingen draagt geen terugweg.
    fn new(file: &'a [u8], cancel: Option<&'a AtomicBool>) -> Result<Self, ExportError> {
        let mut source = Source {
            xref: HashMap::new(),
            root: None,
            file,
            cancel,
            cancelled: Cell::new(false),
            budget: Budget::new(),
            objects: RefCell::new(HashMap::new()),
            streams: RefCell::new(HashMap::new()),
        };
        let read = source.read_structure();
        if source.cancelled.get() {
            return Err(ExportError::Cancelled);
        }
        read.ok_or(ExportError::NoModelSpace)?;
        Ok(source)
    }

    /// Van `startxref` langs `/XRefStm` en `/Prev` alle delen van de
    /// kruisverwijzingen, het nieuwste eerst: een later deel telt alleen voor
    /// objecten die nog niet genoemd zijn. De wortel komt uit de nieuwste
    /// trailer die haar noemt.
    fn read_structure(&mut self) -> Option<()> {
        let mut pending = std::collections::VecDeque::from([self.startxref()?]);
        let mut seen = HashSet::new();
        while let Some(at) = pending.pop_front() {
            if !seen.insert(at) {
                continue;
            }
            if seen.len() > MAX_XREF_SECTIONS || self.stopped() {
                return None;
            }
            // Een deel dat niet te lezen is, telt niet mee; de andere delen wel.
            let Some(section) = self.section_at(at) else { continue };
            for (number, entry) in section.entries {
                self.xref.entry(number).or_insert(entry);
            }
            if self.xref.len() > MAX_XREF_ENTRIES {
                return None;
            }
            if self.root.is_none() {
                if let Some(Value::Ref(number, generation)) = section.trailer.get(b"Root") {
                    self.root = Some((*number, *generation));
                }
            }
            // Eerst de stroom die een tabel aanvult (hybride bestand), dan het
            // vorige deel.
            for key in [b"XRefStm".as_slice(), b"Prev"] {
                if let Some(offset) = integer_of(section.trailer.get(key)).and_then(|o| usize::try_from(o).ok()) {
                    pending.push_back(offset);
                }
            }
        }
        Some(())
    }

    /// Het getal achter het laatste `startxref` in de staart van het bestand.
    fn startxref(&self) -> Option<usize> {
        let tail = self.file.get(self.file.len().saturating_sub(2048)..)?;
        let at = tail.windows(b"startxref".len()).rposition(|w| w == b"startxref")?;
        let mut parser = Parser::new(tail.get(at + b"startxref".len()..)?, &self.budget);
        usize::try_from(parser.unsigned()?).ok()
    }

    /// Het deel van de kruisverwijzingen op `at`: een tabel met trailer, of een
    /// kruisverwijzingsstroom (`12 0 obj << /Type /XRef … >> stream`).
    fn section_at(&self, at: usize) -> Option<Section> {
        let mut parser = Parser::new(self.file.get(at..)?, &self.budget);
        parser.skip_space();
        if parser.data.get(parser.at..).is_some_and(|r| r.starts_with(b"xref")) {
            return self.table(&mut parser);
        }
        parser.unsigned()?;
        parser.unsigned()?;
        parser.keyword(b"obj")?;
        let Value::Dict(entries) = parser.value(0)? else { return None };
        let dict = Dict(entries);
        if dict.get(b"Type") != Some(&Value::Name(b"XRef".to_vec())) {
            return None;
        }
        let raw = self.stream_data(&mut parser, &dict)?;
        let rows = decode_stream(raw, &dict, MAX_UNPACKED_STREAM.min(self.budget.unpacked_left.get()))?;
        self.budget.unpacked_left.set(self.budget.unpacked_left.get() - rows.len());
        Some(Section { entries: xref_rows(&rows, &dict)?, trailer: dict })
    }

    /// `xref`, delen van `start count` met regels `offset generatie n|f`, en
    /// `trailer << … >>`. Vrije objecten tellen niet.
    fn table(&self, parser: &mut Parser) -> Option<Section> {
        parser.keyword(b"xref")?;
        let mut entries = Vec::new();
        loop {
            parser.skip_space();
            if parser.data.get(parser.at..).is_some_and(|r| r.starts_with(b"trailer")) {
                break;
            }
            let (start, count) = (parser.unsigned()?, parser.unsigned()?);
            for i in 0..count {
                let (offset, generation) = (parser.unsigned()?, parser.unsigned()?);
                parser.skip_space();
                let in_use = match parser.token() {
                    b"n" => true,
                    b"f" => false,
                    _ => return None,
                };
                let number = u32::try_from(start.checked_add(i)?).ok()?;
                if let (true, Ok(offset), Ok(generation)) = (in_use, usize::try_from(offset), u16::try_from(generation)) {
                    entries.push((number, XrefEntry::Normal { offset, generation }));
                }
                if entries.len() > MAX_XREF_ENTRIES {
                    return None;
                }
            }
        }
        parser.keyword(b"trailer")?;
        let Value::Dict(trailer) = parser.value(0)? else { return None };
        Some(Section { entries, trailer: Dict(trailer) })
    }

    /// Heeft de gebruiker afgebroken? Onthoudt het antwoord: daarna levert
    /// niets meer iets op.
    fn stopped(&self) -> bool {
        if !self.cancelled.get() && self.cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            self.cancelled.set(true);
        }
        self.cancelled.get()
    }

    /// De viewports met een terugweg op pagina `page_index`.
    fn spaces_of(&self, page_index: u32) -> Option<PageModelSpaces> {
        let page = self.page(page_index)?;
        let Value::Dict(entries) = &*page else { return None };
        let page = Dict(entries.clone());
        let frame = self.frame(&page);
        let mut spaces = Vec::new();
        if let Some(viewports) = page.get(b"VP").and_then(|v| self.resolve(v)) {
            if let Value::Array(items) = &*viewports {
                // Meer viewports dan er gelezen worden: van een halve lijst mag
                // de keuze niet afhangen, net als bij een budget dat op is.
                if items.len() > MAX_VIEWPORTS {
                    return None;
                }
                for item in items {
                    if self.stopped() {
                        return None;
                    }
                    let Some(resolved) = self.resolve(item) else { continue };
                    let Value::Dict(entries) = &*resolved else { continue };
                    let get = |key: &[u8]| entries.iter().find(|(k, _)| k == key).and_then(|(_, v)| self.resolve(v));
                    let Some(page_to_model) = get(b"OPS_ModelMatrix").and_then(|v| matrix_of(&v)) else { continue };
                    let (unit, unknown_unit) = unit_of(get(b"OPS_ModelUnits").as_deref());
                    spaces.push(ModelSpace {
                        page_to_model,
                        unit,
                        unknown_unit,
                        name: get(b"Name").map(|v| text_of(&v)).unwrap_or_default(),
                        bbox: get(b"BBox").and_then(|v| numbers::<4>(&v)),
                    });
                }
            }
        }
        Some(PageModelSpaces { frame, spaces })
    }

    /// Het woordenboek van pagina `index`: de paginaboom in leesvolgorde, met
    /// een grens op het aantal knopen en zonder een knoop twee keer te nemen.
    /// Bladeren die niet gevraagd zijn, worden gelezen en weer losgelaten.
    fn page(&self, index: u32) -> Option<Rc<Value>> {
        let catalog = self.object(self.root?)?;
        let Value::Dict(entries) = &*catalog else { return None };
        let mut stack = vec![entries.iter().find(|(k, _)| k == b"Pages").map(|(_, v)| v.clone())?];
        let mut seen = HashSet::new();
        let mut leaves = 0u32;
        let mut nodes = 0usize;
        while let Some(next) = stack.pop() {
            nodes += 1;
            if nodes > MAX_PAGE_NODES || self.stopped() {
                return None;
            }
            let Value::Ref(number, generation) = next else { continue };
            if !seen.insert((number, generation)) {
                continue;
            }
            let Some(node) = self.read_object((number, generation)) else { continue };
            let Value::Dict(entries) = &node else { continue };
            match entries.iter().find(|(k, _)| k == b"Kids").map(|(_, v)| v) {
                Some(kids) => {
                    let kids = self.resolve(kids)?;
                    let Value::Array(items) = &*kids else { continue };
                    stack.extend(items.iter().rev().cloned());
                }
                None => {
                    if leaves == index {
                        return Some(Rc::new(node));
                    }
                    leaves = leaves.checked_add(1)?;
                }
            }
        }
        None
    }

    /// De waarde zelf, of het object waar ze naar verwijst.
    fn resolve(&self, value: &Value) -> Option<Rc<Value>> {
        let Value::Ref(number, generation) = value else { return Some(Rc::new(value.clone())) };
        let mut current = self.object((*number, *generation))?;
        for _ in 0..MAX_HOPS {
            let next = match &*current {
                Value::Ref(number, generation) => self.object((*number, *generation))?,
                _ => return Some(current),
            };
            current = next;
        }
        None
    }

    /// Eén object, één keer gelezen en daarna onthouden (ook als het niet te
    /// lezen was).
    fn object(&self, id: (u32, u16)) -> Option<Rc<Value>> {
        if let Some(known) = self.objects.borrow().get(&id) {
            return known.clone();
        }
        let read = self.read_object(id).map(Rc::new);
        self.objects.borrow_mut().insert(id, read.clone());
        read
    }

    /// Leest één object, met getallen in 64 bits.
    fn read_object(&self, id: (u32, u16)) -> Option<Value> {
        if self.stopped() {
            return None;
        }
        match *self.xref.get(&id.0)? {
            XrefEntry::Normal { offset, generation } => {
                if generation != id.1 {
                    return None;
                }
                self.object_at(offset, id)?.value(0)
            }
            XrefEntry::Compressed { container, index } => {
                // Een object in een objectstroom heeft generatie 0.
                if id.1 != 0 {
                    return None;
                }
                let packed = self.packed(container)?;
                let (number, offset) = *packed.index.get(index)?;
                if number != u64::from(id.0) {
                    return None;
                }
                let start = packed.first.checked_add(usize::try_from(offset).ok()?)?;
                Parser::new(packed.content.get(start..)?, &self.budget).value(0)
            }
        }
    }

    /// Een lezer op de bytes van object `id` op `offset`, voorbij `12 0 obj`,
    /// en wel van het object dat gevraagd is: een kruisverwijzing die bij een
    /// ander object uitkomt, telt niet.
    fn object_at(&self, offset: usize, id: (u32, u16)) -> Option<Parser<'_>> {
        let mut parser = Parser::new(self.file.get(offset..)?, &self.budget);
        let (number, generation) = (parser.unsigned()?, parser.unsigned()?);
        if number != u64::from(id.0) || generation != u64::from(id.1) {
            return None;
        }
        parser.keyword(b"obj")?;
        Some(parser)
    }

    /// `/Length` van een stroom: een getal, of een verwijzing naar een gewoon
    /// object. De lengte van een objectstroom staat zelf nooit in een
    /// objectstroom; zo volgt uit het lezen van de ene stroom nooit het lezen
    /// van een andere, en is er geen keten om af te dalen.
    fn stream_length(&self, dict: &Dict) -> Option<usize> {
        let length = match dict.get(b"Length") {
            Some(Value::Ref(number, generation)) => {
                if !matches!(self.xref.get(number)?, XrefEntry::Normal { .. }) {
                    return None;
                }
                integer_of(self.object((*number, *generation)).as_deref())
            }
            direct => integer_of(direct),
        }?;
        usize::try_from(length).ok()
    }

    /// De bytes van een stroom, direct achter het woordenboek dat `parser` net
    /// las: `stream`, een regeleinde, `/Length` bytes, `endstream`. Klopt de
    /// lengte niet, dan telt de eerste `endstream` erna.
    fn stream_data<'p>(&self, parser: &mut Parser<'p>, dict: &Dict) -> Option<&'p [u8]> {
        parser.keyword(b"stream")?;
        // Na `stream` een regeleinde: CRLF of LF (en, buiten de norm, CR).
        if parser.peek() == Some(b'\r') {
            parser.at += 1;
        }
        if parser.peek() == Some(b'\n') {
            parser.at += 1;
        }
        let rest = parser.data.get(parser.at..)?;
        if let Some(after) = self.stream_length(dict).and_then(|length| rest.get(length..)) {
            let trimmed = after.iter().position(|b| !is_space(*b)).unwrap_or(after.len());
            if after.get(trimmed..).is_some_and(|a| a.starts_with(b"endstream")) {
                return rest.get(..rest.len() - after.len());
            }
        }
        let mut end = rest.windows(b"endstream".len()).position(|w| w == b"endstream")?;
        for line_end in [b"\r\n".as_slice(), b"\n", b"\r"] {
            if rest.get(..end).is_some_and(|d| d.ends_with(line_end)) {
                end -= line_end.len();
                break;
            }
        }
        rest.get(..end)
    }

    /// Een objectstroom, één keer en begrensd uitgepakt.
    fn packed(&self, container: u32) -> Option<Rc<Packed>> {
        if let Some(known) = self.streams.borrow().get(&container) {
            return known.clone();
        }
        let unpacked = self.unpack(container).map(Rc::new);
        self.streams.borrow_mut().insert(container, unpacked.clone());
        unpacked
    }

    fn unpack(&self, container: u32) -> Option<Packed> {
        // Een objectstroom staat zelf nooit in een objectstroom.
        let XrefEntry::Normal { offset, generation } = *self.xref.get(&container)? else { return None };
        let mut parser = self.object_at(offset, (container, generation))?;
        let Value::Dict(entries) = parser.value(0)? else { return None };
        let dict = Dict(entries);
        if dict.get(b"Type") != Some(&Value::Name(b"ObjStm".to_vec())) {
            return None;
        }
        let raw = self.stream_data(&mut parser, &dict)?;
        let limit = MAX_UNPACKED_STREAM.min(self.budget.unpacked_left.get());
        let content = decode_stream(raw, &dict, limit)?;
        self.budget.unpacked_left.set(self.budget.unpacked_left.get() - content.len());
        let first = usize::try_from(integer_of(dict.get(b"First"))?).ok()?;
        let count = usize::try_from(integer_of(dict.get(b"N"))?).ok()?.min(MAX_PACKED_OBJECTS);
        let mut index = Vec::new();
        {
            let mut header = Parser::new(content.get(..first)?, &self.budget);
            for _ in 0..count {
                let (Some(number), Some(offset)) = (header.unsigned(), header.unsigned()) else { break };
                index.push((number, offset));
            }
        }
        Some(Packed { content, first, index })
    }

    /// De pagina zoals ze wordt weergegeven: `/MediaBox`, `/CropBox` en
    /// `/Rotate` mogen van een ouder komen.
    fn frame(&self, page: &Dict) -> PageFrame {
        let inherited = |key: &[u8]| -> Option<Rc<Value>> {
            if let Some(found) = page.get(key) {
                return self.resolve(found);
            }
            let mut parent = page.get(b"Parent").cloned();
            for _ in 0..MAX_HOPS {
                let node = parent.as_ref().and_then(|p| self.resolve(p))?;
                let Value::Dict(entries) = &*node else { return None };
                let get = |wanted: &[u8]| entries.iter().find(|(k, _)| k == wanted).map(|(_, v)| v);
                if let Some(found) = get(key) {
                    return self.resolve(found);
                }
                parent = get(b"Parent").cloned();
            }
            None
        };
        let rect = |key: &[u8]| inherited(key).and_then(|v| numbers::<4>(&v)).map(|v| PdfRect::new(v[0], v[1], v[2], v[3]));
        let number = |key: &[u8]| match inherited(key).as_deref() {
            Some(Value::Number(n)) if n.is_finite() => Some(*n),
            _ => None,
        };
        // Zonder bruikbare MediaBox: een blad van niets; dan beslaat geen
        // viewport "het hele blad" en kiest `choose` op de andere gronden.
        let media = rect(b"MediaBox").unwrap_or(PdfRect::new(0.0, 0.0, 0.0, 0.0));
        let rotate = number(b"Rotate").map(|r| r.clamp(-3600.0, 3600.0) as i32).unwrap_or(0);
        PageFrame::new(media, rect(b"CropBox"), rotate, number(b"UserUnit").unwrap_or(1.0))
    }
}

// ── De bytes van een object lezen ───────────────────────────────────────

/// Een PDF-waarde, zo ver als de terugweg hem nodig heeft.
#[derive(Clone, Debug, PartialEq)]
enum Value {
    Number(f64),
    Name(Vec<u8>),
    Text(Vec<u8>),
    Array(Vec<Value>),
    Dict(Vec<(Vec<u8>, Value)>),
    Ref(u32, u16),
    /// `true`, `false`, `null`.
    Other,
}

/// Hoe diep arrays en woordenboeken genest mogen zijn.
const MAX_DEPTH: usize = 32;
/// Hoeveel waarden één object mag tellen.
const MAX_VALUES: usize = 200_000;

/// Leest PDF-waarden uit bytes. Elke stap controleert de grens van de invoer;
/// wat niet deugt geeft `None`.
struct Parser<'a> {
    data: &'a [u8],
    at: usize,
    /// Waarden in dit ene object.
    values: usize,
    /// Wat er over alle objecten van deze leesronde nog te lezen valt.
    budget: &'a Budget,
}

fn is_space(byte: u8) -> bool {
    matches!(byte, 0 | 9 | 10 | 12 | 13 | 32)
}

fn is_delimiter(byte: u8) -> bool {
    matches!(byte, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

impl<'a> Parser<'a> {
    fn new(data: &'a [u8], budget: &'a Budget) -> Self {
        Parser { data, at: 0, values: 0, budget }
    }

    /// Bewaart een byte van een tekst, zolang de tekst en de leesronde daar
    /// ruimte voor hebben. Wat er niet bij past, wordt gelezen en vergeten:
    /// een lange tekst elders in het woordenboek maakt de pagina niet onleesbaar.
    fn keep(&self, out: &mut Vec<u8>, byte: u8) {
        let left = self.budget.text_left.get();
        if out.len() < MAX_TEXT && left > 0 {
            out.push(byte);
            self.budget.text_left.set(left - 1);
        }
    }

    fn peek(&self) -> Option<u8> {
        self.data.get(self.at).copied()
    }

    fn skip_space(&mut self) {
        while let Some(byte) = self.peek() {
            if is_space(byte) {
                self.at += 1;
            } else if byte == b'%' {
                while self.peek().is_some_and(|b| b != b'\n' && b != b'\r') {
                    self.at += 1;
                }
            } else {
                break;
            }
        }
    }

    /// Het stuk tot de volgende witruimte of het volgende scheidingsteken.
    fn token(&mut self) -> &'a [u8] {
        let start = self.at;
        while self.peek().is_some_and(|b| !is_space(b) && !is_delimiter(b)) {
            self.at += 1;
        }
        self.data.get(start..self.at).unwrap_or(&[])
    }

    fn unsigned(&mut self) -> Option<u64> {
        self.skip_space();
        let token = self.token();
        if token.is_empty() || token.len() > 19 || !token.iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(token).ok()?.parse().ok()
    }

    fn keyword(&mut self, word: &[u8]) -> Option<()> {
        self.skip_space();
        (self.token() == word).then_some(())
    }

    fn value(&mut self, depth: usize) -> Option<Value> {
        self.values += 1;
        let left = self.budget.values_left.get();
        if depth > MAX_DEPTH || self.values > MAX_VALUES || left == 0 {
            return None;
        }
        self.budget.values_left.set(left - 1);
        self.skip_space();
        match self.peek()? {
            b'<' if self.data.get(self.at + 1) == Some(&b'<') => {
                self.at += 2;
                let mut entries = Vec::new();
                loop {
                    self.skip_space();
                    if self.peek()? == b'>' {
                        (self.data.get(self.at + 1) == Some(&b'>')).then_some(())?;
                        self.at += 2;
                        return Some(Value::Dict(entries));
                    }
                    let Value::Name(key) = self.value(depth + 1)? else { return None };
                    entries.push((key, self.value(depth + 1)?));
                }
            }
            b'<' => {
                self.at += 1;
                let mut out = Vec::new();
                let mut high: Option<u8> = None;
                loop {
                    let byte = self.peek()?;
                    self.at += 1;
                    match byte {
                        b'>' => break,
                        b if is_space(b) => {}
                        b => {
                            let digit = (b as char).to_digit(16)? as u8;
                            match high.take() {
                                Some(first) => self.keep(&mut out, first * 16 + digit),
                                None => high = Some(digit),
                            }
                        }
                    }
                }
                // Een oneven aantal cijfers: het laatste telt als gevolgd door 0.
                if let Some(first) = high {
                    self.keep(&mut out, first * 16);
                }
                Some(Value::Text(out))
            }
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.skip_space();
                    if self.peek()? == b']' {
                        self.at += 1;
                        return Some(Value::Array(items));
                    }
                    items.push(self.value(depth + 1)?);
                }
            }
            b'/' => {
                self.at += 1;
                let raw = self.token();
                let mut name = Vec::with_capacity(raw.len());
                let mut bytes = raw.iter().copied();
                while let Some(byte) = bytes.next() {
                    if byte == b'#' {
                        let (high, low) = (bytes.next()?, bytes.next()?);
                        name.push(((high as char).to_digit(16)? * 16 + (low as char).to_digit(16)?) as u8);
                    } else {
                        name.push(byte);
                    }
                }
                Some(Value::Name(name))
            }
            b'(' => self.literal(),
            b'+' | b'-' | b'.' | b'0'..=b'9' => self.number_or_reference(),
            _ => match self.token() {
                b"true" | b"false" | b"null" => Some(Value::Other),
                _ => None,
            },
        }
    }

    /// Een letterlijke tekenreeks, met geneste haakjes en de escapes van PDF.
    fn literal(&mut self) -> Option<Value> {
        self.at += 1;
        let mut out = Vec::new();
        let mut open = 1usize;
        loop {
            let byte = self.peek()?;
            self.at += 1;
            match byte {
                b'(' => {
                    open += 1;
                    self.keep(&mut out, byte);
                }
                b')' => {
                    open -= 1;
                    if open == 0 {
                        return Some(Value::Text(out));
                    }
                    self.keep(&mut out, byte);
                }
                b'\\' => {
                    let escaped = self.peek()?;
                    self.at += 1;
                    match escaped {
                        b'n' => self.keep(&mut out, b'\n'),
                        b'r' => self.keep(&mut out, b'\r'),
                        b't' => self.keep(&mut out, b'\t'),
                        b'b' => self.keep(&mut out, 8),
                        b'f' => self.keep(&mut out, 12),
                        b'0'..=b'7' => {
                            let mut code = u32::from(escaped - b'0');
                            for _ in 0..2 {
                                match self.peek() {
                                    Some(d @ b'0'..=b'7') => {
                                        code = code * 8 + u32::from(d - b'0');
                                        self.at += 1;
                                    }
                                    _ => break,
                                }
                            }
                            self.keep(&mut out, (code & 0xFF) as u8);
                        }
                        // Een regeleinde na een backslash hoort er niet bij.
                        b'\r' => {
                            if self.peek() == Some(b'\n') {
                                self.at += 1;
                            }
                        }
                        b'\n' => {}
                        other => self.keep(&mut out, other),
                    }
                }
                other => self.keep(&mut out, other),
            }
        }
    }

    /// Een getal, of een verwijzing `12 0 R`.
    fn number_or_reference(&mut self) -> Option<Value> {
        let token = self.token();
        let text = std::str::from_utf8(token).ok()?;
        let plain = !text.is_empty() && text.len() <= 64 && text.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.'));
        if !plain {
            return None;
        }
        if text.bytes().all(|b| b.is_ascii_digit()) {
            // Misschien een verwijzing: kijk vooruit en ga terug als het er geen is.
            let back = self.at;
            if let (Ok(number), Some(generation)) = (text.parse::<u32>(), self.unsigned()) {
                self.skip_space();
                if self.token() == b"R" {
                    return Some(Value::Ref(number, u16::try_from(generation).ok()?));
                }
            }
            self.at = back;
        }
        // PDF kent `.5`, `5.` en `+5`; alle drie leest `f64` ook, op `5.` na.
        let value: f64 = text.strip_suffix('.').unwrap_or(text).parse().ok()?;
        value.is_finite().then_some(Value::Number(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Option<Value> {
        Parser::new(text.as_bytes(), &Budget::new()).value(0)
    }

    #[test]
    fn numbers_keep_every_digit_of_a_national_coordinate() {
        let Some(Value::Array(items)) = parse("[ 35.2777777778 0 0 35.2777777778 -154999000.123 -462999000.456 ]") else {
            panic!("geen array");
        };
        assert_eq!(items[4], Value::Number(-154_999_000.123));
        assert_eq!(items[5], Value::Number(-462_999_000.456));
        // In 32 bits was dit al acht millimeter mis.
        assert_ne!(f64::from(-154_999_000.123_f32), -154_999_000.123);
        assert_eq!(parse(".5"), Some(Value::Number(0.5)));
        assert_eq!(parse("5."), Some(Value::Number(5.0)));
        assert_eq!(parse("+7"), Some(Value::Number(7.0)));
        assert_eq!(parse("-0.25"), Some(Value::Number(-0.25)));
    }

    #[test]
    fn dictionaries_strings_names_and_references_are_read() {
        let value = parse("<< /Type /Viewport % commentaar\n /BBox [0 0 842 595] /Name (Blad \\(1\\) \\101) /VP 12 0 R /N#61am <48 69> /Ok true >>");
        let Some(Value::Dict(entries)) = value else { panic!("geen woordenboek") };
        let dict = Dict(entries);
        assert_eq!(dict.get(b"Type"), Some(&Value::Name(b"Viewport".to_vec())));
        assert_eq!(dict.get(b"Name").map(text_of), Some("Blad (1) A".to_string()));
        assert_eq!(dict.get(b"VP"), Some(&Value::Ref(12, 0)));
        assert_eq!(dict.get(b"Naam"), Some(&Value::Text(b"Hi".to_vec())));
        assert_eq!(dict.get(b"Ok"), Some(&Value::Other));
        assert_eq!(numbers::<4>(dict.get(b"BBox").unwrap()), Some([0.0, 0.0, 842.0, 595.0]));
        // Twee gehele getallen zonder R zijn gewoon twee getallen.
        assert_eq!(parse("[1 0 2]"), Some(Value::Array(vec![Value::Number(1.0), Value::Number(0.0), Value::Number(2.0)])));
        // UTF-16 met BOM.
        assert_eq!(text_of(&Value::Text(vec![0xFE, 0xFF, 0x00, 0xE9])), "é");
    }

    #[test]
    fn broken_input_never_panics_and_never_loops() {
        let whole = "<< /VP [ << /BBox [0 0 1 1] /OPS_ModelMatrix [1 0 0 1 (a\\)) <4> ] /X 1 0 R >> ] >>";
        assert!(parse(whole).is_some());
        // Elke afgekapte vorm, en elke vorm met één byte verminkt.
        for cut in 0..whole.len() {
            let _ = Parser::new(&whole.as_bytes()[..cut], &Budget::new()).value(0);
            let mut bytes = whole.as_bytes().to_vec();
            bytes[cut] = b'\\';
            let _ = Parser::new(&bytes, &Budget::new()).value(0);
            bytes[cut] = 0xFF;
            let _ = Parser::new(&bytes, &Budget::new()).value(0);
        }
        // Te diep, te veel, geen einde.
        assert!(parse(&"[".repeat(1_000)).is_none());
        assert!(parse(&format!("[{}]", "0 ".repeat(MAX_VALUES + 5))).is_none());
        assert!(parse("1e5").is_none(), "PDF kent geen exponenten");
        assert!(parse("--5").is_none());
        assert!(parse("(open").is_none());
    }

    fn space(bbox: Option<[f64; 4]>, scale: f64, unit: DrawingUnit) -> ModelSpace {
        ModelSpace { page_to_model: Matrix::scale(scale, scale), unit, unknown_unit: None, name: String::new(), bbox }
    }

    fn page(spaces: Vec<ModelSpace>) -> PageModelSpaces {
        PageModelSpaces { frame: PageFrame::new(PdfRect::new(0.0, 0.0, 842.0, 595.0), None, 0, 1.0), spaces }
    }

    #[test]
    fn the_whole_page_viewport_wins_and_an_area_picks_its_own_viewport() {
        let whole = space(Some([0.0, 0.0, 842.0, 595.0]), 35.0, DrawingUnit::Mm);
        let left = space(Some([10.0, 10.0, 300.0, 300.0]), 7.0, DrawingUnit::M);
        let right = space(Some([400.0, 10.0, 800.0, 300.0]), 3.5, DrawingUnit::M);
        // Een modelpagina met een detail erop: zonder gebied telt het hele blad.
        let both = page(vec![left.clone(), whole.clone()]);
        assert_eq!(both.choose(None), Ok(whole.clone()));
        // Met een gebied binnen het detail: de kleinste viewport die het bevat.
        let inside = AreaRect { x0: 50.0, y0: 50.0, x1: 200.0, y1: 250.0 };
        assert_eq!(both.choose(Some(inside)), Ok(left.clone()));
        let across = AreaRect { x0: 50.0, y0: 50.0, x1: 500.0, y1: 250.0 };
        assert_eq!(both.choose(Some(across)), Ok(whole));
        // Alleen een detail: dat telt.
        assert_eq!(page(vec![left.clone()]).choose(None), Ok(left.clone()));
        // Twee details zonder gebied, of een gebied over beide heen: geen keuze.
        let layout = page(vec![left.clone(), right.clone()]);
        assert_eq!(layout.choose(None), Err(ExportError::AmbiguousModelSpace { viewports: 2 }));
        assert_eq!(layout.choose(Some(across)), Err(ExportError::AmbiguousModelSpace { viewports: 2 }));
        assert_eq!(layout.choose(Some(AreaRect { x0: 450.0, y0: 20.0, x1: 700.0, y1: 200.0 })), Ok(right));
        // Niets: een nette fout.
        assert_eq!(page(Vec::new()).choose(None), Err(ExportError::NoModelSpace));
        // Een gedraaide pagina: het gebied staat in de weergave, de viewport
        // in de gebruikersruimte.
        let turned = PageModelSpaces { frame: PageFrame::new(PdfRect::new(0.0, 0.0, 842.0, 595.0), None, 90, 1.0), spaces: vec![left.clone(), space(Some([400.0, 310.0, 800.0, 590.0]), 1.0, DrawingUnit::Mm)] };
        // Weergave (x, y) = (v, 842 − u): de linker viewport ligt in de weergave op x 10–300, y 542–832.
        assert_eq!(turned.choose(Some(AreaRect { x0: 20.0, y0: 600.0, x1: 200.0, y1: 800.0 })), Ok(left));
    }

    #[test]
    fn equal_candidates_with_a_different_matrix_are_not_chosen_between() {
        // Twee vensters van dezelfde maat over elkaar, elk met een eigen
        // schaal: de volgorde in het bestand mag niet beslissen.
        let one = space(Some([10.0, 10.0, 300.0, 300.0]), 7.0, DrawingUnit::Mm);
        let other = space(Some([10.0, 10.0, 300.0, 300.0]), 3.5, DrawingUnit::Mm);
        let inside = AreaRect { x0: 50.0, y0: 50.0, x1: 200.0, y1: 250.0 };
        let stacked = page(vec![one.clone(), other.clone()]);
        assert_eq!(stacked.choose(Some(inside)), Err(ExportError::AmbiguousModelSpace { viewports: 2 }));
        // Even groot maar verschoven, en het gebied ligt in beide: ook geen keuze.
        let shifted = space(Some([20.0, 20.0, 310.0, 310.0]), 3.5, DrawingUnit::Mm);
        assert_eq!(page(vec![one.clone(), shifted]).choose(Some(inside)), Err(ExportError::AmbiguousModelSpace { viewports: 2 }));
        // Twee keer dezelfde afbeelding is geen twijfel.
        assert_eq!(page(vec![one.clone(), one.clone()]).choose(Some(inside)), Ok(one.clone()));
        // Een kleiner venster wint gewoon.
        let small = space(Some([40.0, 40.0, 250.0, 260.0]), 2.0, DrawingUnit::Mm);
        assert_eq!(page(vec![one.clone(), small.clone(), other]).choose(Some(inside)), Ok(small));

        // Zonder gebied: "het hele blad" is de maat én de plaats van het blad.
        let sheet = space(Some([0.0, 0.0, 842.0, 595.0]), 35.0, DrawingUnit::Mm);
        let moved = space(Some([100.0, 50.0, 942.0, 645.0]), 5.0, DrawingUnit::Mm);
        assert_eq!(page(vec![moved.clone(), sheet.clone()]).choose(None), Ok(sheet.clone()));
        assert_eq!(page(vec![moved.clone(), one.clone()]).choose(None), Err(ExportError::AmbiguousModelSpace { viewports: 2 }));
        // Twee bladvullende vensters met een andere afbeelding: geen keuze.
        let second_sheet = space(Some([0.0, 0.0, 842.0, 595.0]), 17.5, DrawingUnit::Mm);
        assert_eq!(page(vec![sheet.clone(), second_sheet]).choose(None), Err(ExportError::AmbiguousModelSpace { viewports: 2 }));
        assert_eq!(page(vec![sheet.clone(), sheet.clone()]).choose(None), Ok(sheet));
    }

    #[test]
    fn a_unit_the_export_does_not_know_is_an_error_and_not_millimetres() {
        assert_eq!(unit_of(Some(&Value::Text(b"el".to_vec()))), (DrawingUnit::Mm, Some("el".to_string())));
        let mut odd = space(Some([0.0, 0.0, 842.0, 595.0]), 35.0, DrawingUnit::Mm);
        odd.unknown_unit = Some("el".to_string());
        let detail = space(Some([10.0, 10.0, 300.0, 300.0]), 7.0, DrawingUnit::M);
        let both = page(vec![odd, detail.clone()]);
        assert_eq!(both.choose(None), Err(ExportError::UnknownModelUnits("el".to_string())));
        assert_eq!(ExportError::UnknownModelUnits("el".to_string()).to_string(), "MODEL_UNITS_UNKNOWN:el");
        // Alleen de gekozen viewport telt.
        assert_eq!(both.choose(Some(AreaRect { x0: 50.0, y0: 50.0, x1: 200.0, y1: 250.0 })), Ok(detail));
        // In het bestand: aanwezig en onbekend is een fout, afwezig is millimeter.
        let with = |units: &str| document_with_page(&format!("/VP [ << /BBox [0 0 842 595] /OPS_ModelMatrix {MATRIX} {units} >> ]"));
        assert_eq!(load_mem(&with("/OPS_ModelUnits (parsec)"), 0, None).and_then(|p| p.choose(None)), Err(ExportError::UnknownModelUnits("parsec".to_string())));
        assert_eq!(load_mem(&with("/OPS_ModelUnits 12"), 0, None).and_then(|p| p.choose(None)), Err(ExportError::UnknownModelUnits(String::new())));
        assert_eq!(load_mem(&with(""), 0, None).and_then(|p| p.choose(None)).map(|s| s.unit), Ok(DrawingUnit::Mm));
        assert_eq!(load_mem(&with("/OPS_ModelUnits ( KM )"), 0, None).and_then(|p| p.choose(None)).map(|s| s.unit), Ok(DrawingUnit::Km));
    }

    #[test]
    fn a_matrix_that_is_missing_short_or_degenerate_is_no_matrix() {
        assert!(matrix_of(&parse("[1 0 0 1 5 6]").unwrap()).is_some());
        for broken in ["[1 0]", "[1 0 0 1 5 6 7]", "[0 0 0 0 5 6]", "[1 0 0 (x) 5 6]", "(tekst)", "[1 2 2 4 0 0]"] {
            assert!(matrix_of(&parse(broken).unwrap()).is_none(), "{broken}");
        }
        assert_eq!(unit_of(Some(&Value::Text(b"m".to_vec()))), (DrawingUnit::M, None));
        assert_eq!(unit_of(Some(&Value::Text(b" KM ".to_vec()))), (DrawingUnit::Km, None));
        assert_eq!(unit_of(None), (DrawingUnit::Mm, None));
    }

    /// Een PDF met gewone objecten en een kruisverwijzingstabel.
    fn plain_pdf(objects: &[String]) -> Vec<u8> {
        let mut pdf = b"%PDF-1.7\n".to_vec();
        let mut offsets = Vec::new();
        for (i, body) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
        }
        let xref_at = pdf.len();
        pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
        for offset in offsets {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", objects.len() + 1, xref_at).as_bytes());
        pdf
    }

    const MATRIX: &str = "[ 35.2777777778 0 0 35.2777777778 154999000.123 462999000.456 ]";

    #[test]
    fn the_matrix_is_read_in_full_from_a_file_with_inherited_page_size() {
        let objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 842 595] >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R /Contents 4 0 R /VP 5 0 R >>"),
            "<< /Length 8 >>\nstream\n0 0 m S\n\nendstream".to_string(),
            "[ << /Type /Viewport /BBox [ 10 10 100 100 ] /Name (Detail) >> 6 0 R ]".to_string(),
            format!("<< /Type /Viewport /BBox [ 0 0 842 595 ] /Name (Model) /OPS_ModelMatrix {MATRIX} /OPS_ModelUnits (mm) >>"),
        ];
        let found = read_mem(&plain_pdf(&objects), 0).expect("leesbaar");
        assert_eq!(found.frame.display_size_pt(), (842.0, 595.0));
        assert_eq!(found.spaces.len(), 1, "de viewport zonder matrix telt niet");
        let space = found.choose(None).unwrap();
        assert_eq!(space.name, "Model");
        assert_eq!(space.unit, DrawingUnit::Mm);
        assert_eq!(space.page_to_model.e, 154_999_000.123);
        assert_eq!(space.page_to_model.f, 462_999_000.456);
        assert_eq!(space.page_to_model.a, 35.277_777_777_8);
        // Een pagina die niet bestaat, en rommel: niets, en geen paniek.
        assert!(read_mem(&plain_pdf(&objects), 3).is_none());
        assert!(read_mem(b"%PDF-1.7\nrommel", 0).is_none());
        assert!(read_mem(&[], 0).is_none());
        let whole = plain_pdf(&objects);
        for cut in (0..whole.len()).step_by(7) {
            let _ = read_mem(&whole[..cut], 0);
        }
    }

    /// Drie objecten van een gewoon document met één pagina; `extra` komt erachter.
    fn document_with(extra: Vec<String>) -> Vec<u8> {
        document_of(&format!("/VP [ << /BBox [0 0 842 595] /OPS_ModelMatrix {MATRIX} >> ]"), extra)
    }

    /// Een document met één pagina, met `entries` in het paginawoordenboek.
    fn document_with_page(entries: &str) -> Vec<u8> {
        document_of(entries, Vec::new())
    }

    fn document_of(page_entries: &str, extra: Vec<String>) -> Vec<u8> {
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 842 595] >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R {page_entries} >>"),
        ];
        objects.extend(extra);
        plain_pdf(&objects)
    }

    #[test]
    fn a_bottomless_nesting_costs_no_stack() {
        // Een object dat tweehonderdduizend keer opent, en wel het object waar
        // de pagina haar viewports zoekt: de lezer stopt bij zijn dieptegrens
        // en de draad houdt haar stapel, ook een kleine.
        for open in ["[", "<<", "[<<"] {
            let pdf = document_of("/VP 4 0 R", vec![open.repeat(200_000)]);
            let read = std::thread::Builder::new()
                .stack_size(256 << 10)
                .spawn(move || read_mem(&pdf, 0).map(|p| p.spaces.len()))
                .expect("draad")
                .join()
                .expect("geen paniek");
            assert_eq!(read, Some(0), "{open}");
        }
        // Dezelfde haken in een tekst, in commentaar of in een stroom zijn inhoud.
        let harmless = vec![
            format!("({})", "[".repeat(5_000)),
            format!("<< /Length 5000 >>\nstream\n{}\nendstream", "[".repeat(5_000)),
            format!("% {}\n<< >>", "<<".repeat(5_000)),
        ];
        assert!(read_mem(&document_with(harmless), 0).is_some());
        // Tot de grens mag het.
        assert!(parse(&format!("{}{}", "[".repeat(MAX_DEPTH + 1), "]".repeat(MAX_DEPTH + 1))).is_some());
        assert!(parse(&format!("{}{}", "[".repeat(MAX_DEPTH + 2), "]".repeat(MAX_DEPTH + 2))).is_none());
    }

    #[test]
    fn a_chain_of_stream_lengths_is_never_followed_recursively() {
        // Vijfduizend stromen waarvan elke `/Length` naar de volgende stroom
        // verwijst. Een lezer die de lengte ophaalt door dat object te lezen,
        // recurseert de hele keten af; met een kleine stapel is dat het einde
        // van het proces, geen paniek. De pagina zelf is gewoon te lezen.
        const LINKS: usize = 5_000;
        let extra: Vec<String> = (0..LINKS)
            .map(|i| {
                let length = if i + 1 == LINKS { "0".to_string() } else { format!("{} 0 R", 5 + i) };
                format!("<< /Length {length} >>\nstream\n\nendstream")
            })
            .collect();
        let pdf = document_with(extra);
        let read = std::thread::Builder::new()
            .stack_size(256 << 10)
            .spawn(move || read_mem(&pdf, 0).and_then(|p| p.choose(None).ok()))
            .expect("draad")
            .join()
            .expect("geen paniek");
        assert_eq!(read.map(|s| s.page_to_model.e), Some(154_999_000.123));
    }

    /// Vervangt de eerste `from` in `bytes` door `to`; het moet er staan. Een
    /// kortere `to` wordt met witruimte aangevuld, zodat wat erna komt op zijn
    /// plek blijft.
    fn replace_bytes(bytes: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
        let at = bytes.windows(from.len()).position(|w| w == from).expect("te vervangen tekst");
        let mut out = bytes[..at].to_vec();
        out.extend_from_slice(to);
        out.resize(out.len() + from.len().saturating_sub(to.len()), b' ');
        out.extend_from_slice(&bytes[at + from.len()..]);
        out
    }

    /// Zo bewaart de app een document na het opslaan: pagina's in een
    /// objectstroom, en een kruisverwijzingsstroom in plaats van een tabel.
    /// `stream` is de inhoud van de objectstroom zoals ze in het bestand staat
    /// (ingepakt als `filter` dat zegt), `first` de lengte van haar index.
    fn packed_pdf(stream: &[u8], first: usize, filter: &str) -> Vec<u8> {
        packed_pdf_with(stream, first, filter, |rows| (rows.to_vec(), String::new()))
    }

    /// Als [`packed_pdf`]; `encode` bepaalt hoe de regels van de
    /// kruisverwijzingsstroom in het bestand staan (de bytes en de filterwoorden).
    fn packed_pdf_with(stream: &[u8], first: usize, filter: &str, encode: impl Fn(&[u8]) -> (Vec<u8>, String)) -> Vec<u8> {
        let mut pdf = b"%PDF-1.7\n".to_vec();
        let catalog_at = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let stream_at = pdf.len();
        pdf.extend_from_slice(format!("4 0 obj\n<< /Type /ObjStm /N 2 /First {first} /Length {} {filter} >>\nstream\n", stream.len()).as_bytes());
        pdf.extend_from_slice(stream);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");
        let xref_at = pdf.len();
        // Velden van 1, 3 en 1 byte: soort, plaats (of objectstroom), rang.
        let place = |kind: u8, at: usize, rank: u8| [kind, (at >> 16) as u8, (at >> 8) as u8, at as u8, rank];
        let mut rows: Vec<u8> = vec![0, 0, 0, 0, 255];
        rows.extend_from_slice(&place(1, catalog_at, 0));
        rows.extend_from_slice(&place(2, 4, 0));
        rows.extend_from_slice(&place(2, 4, 1));
        rows.extend_from_slice(&place(1, stream_at, 0));
        rows.extend_from_slice(&place(1, xref_at, 0));
        let (rows, xref_filter) = encode(&rows);
        pdf.extend_from_slice(format!("5 0 obj\n<< /Type /XRef /Size 6 /W [1 3 1] /Root 1 0 R {xref_filter} /Length {} >>\nstream\n", rows.len()).as_bytes());
        pdf.extend_from_slice(&rows);
        pdf.extend_from_slice(format!("\nendstream\nendobj\nstartxref\n{xref_at}\n%%EOF\n").as_bytes());
        pdf
    }

    /// De paginaboom en de pagina, zoals ze in een objectstroom staan.
    fn packed_objects() -> (String, usize) {
        let page = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /VP [ << /Type /Viewport /BBox [0 0 842 595] /OPS_ModelMatrix {MATRIX} /OPS_ModelUnits (m) >> ] >>"
        );
        let pages = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
        let index = format!("2 0 3 {} ", pages.len() + 1);
        (format!("{index}{pages} {page}"), index.len())
    }

    fn deflate(bytes: &[u8]) -> Vec<u8> {
        use std::io::Write;
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn the_matrix_is_read_from_a_page_inside_an_object_stream() {
        let (packed, first) = packed_objects();
        let plain = packed_pdf(packed.as_bytes(), first, "");
        // Een lengte die niet klopt, of in een object staat dat er niet is:
        // dan telt `endstream`.
        let length = format!("/Length {}  ", packed.len());
        let wrong_length = replace_bytes(&plain, length.as_bytes(), b"/Length 999 ");
        let missing_length = replace_bytes(&plain, length.as_bytes(), b"/Length 7 0 R");
        for pdf in [plain, packed_pdf(&deflate(packed.as_bytes()), first, "/Filter /FlateDecode"), wrong_length, missing_length] {
            let found = read_mem(&pdf, 0).expect("leesbaar");
            let space = found.choose(None).expect("modelmatrix");
            assert_eq!(space.unit, DrawingUnit::M);
            assert_eq!(space.page_to_model.e, 154_999_000.123);
            assert_eq!(space.page_to_model.f, 462_999_000.456);
        }
        // Afgekapt op elke plek: niets, en geen paniek.
        let whole = packed_pdf(&deflate(packed.as_bytes()), first, "/Filter /FlateDecode");
        for cut in (0..whole.len()).step_by(3) {
            let _ = read_mem(&whole[..cut], 0);
        }
    }

    #[test]
    fn the_cross_reference_stream_is_read_packed_predicted_and_indexed() {
        // Zo schrijven PDF-makers hem: ingepakt, met de voorspeller "Up" over
        // regels van de breedte van één kruisverwijzing (1 + 3 + 1 bytes), en
        // met een /Index die de objectnummers in stukken noemt.
        let (packed, first) = packed_objects();
        for index in ["", "/Index [0 3 3 3]", "/Index [0 1 1 5]"] {
            let pdf = packed_pdf_with(packed.as_bytes(), first, "", |rows| {
                (deflate(&predict_up(rows, 5)), format!("/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 5 >> {index}"))
            });
            assert_eq!(read_mem(&pdf, 0).and_then(|p| p.choose(None).ok()).map(|s| s.unit), Some(DrawingUnit::M), "{index}");
        }
        // Een /Index die de pagina overslaat, een /W die niet deugt, of een
        // andere soort stroom op de plek van de kruisverwijzingen: niets.
        let plain = packed_pdf(packed.as_bytes(), first, "");
        for (from, to) in [("/W [1 3 1]", "/W [1 9 1]"), ("/W [1 3 1]", "/W [1 3]"), ("/Type /XRef", "/Type /ObjStm"), ("/Root 1 0 R", "/Root 1 0 R /Index [0 3]")] {
            assert!(read_mem(&replace_bytes(&plain, from.as_bytes(), to.as_bytes()), 0).is_none(), "{to}");
        }
    }

    #[test]
    fn a_newer_section_wins_and_older_sections_are_followed_once() {
        // Een document dat na een bewerking is aangevuld: het nieuwe deel
        // draagt alleen de gewijzigde pagina en wijst met /Prev naar het oude.
        let old = document_with_page(&format!("/VP [ << /BBox [0 0 842 595] /OPS_ModelMatrix {MATRIX} /OPS_ModelUnits (mm) >> ]"));
        let old_xref = String::from_utf8_lossy(&old).find("\nxref\n").unwrap() + 1;
        let mut pdf = old.clone();
        let page_at = pdf.len();
        pdf.extend(format!("3 0 obj\n<< /Type /Page /Parent 2 0 R /VP [ << /BBox [0 0 842 595] /OPS_ModelMatrix {MATRIX} /OPS_ModelUnits (m) >> ] >>\nendobj\n").bytes());
        let xref_at = pdf.len();
        pdf.extend(format!("xref\n0 1\n0000000000 65535 f \n3 1\n{page_at:010} 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R /Prev {old_xref} >>\nstartxref\n{xref_at}\n%%EOF\n").bytes());
        let unit = |pdf: &[u8]| read_mem(pdf, 0).and_then(|p| p.choose(None).ok()).map(|s| s.unit);
        assert_eq!(unit(&old), Some(DrawingUnit::Mm));
        assert_eq!(unit(&pdf), Some(DrawingUnit::M));
        // Een /Prev die naar zichzelf of naar rommel wijst, laat de rest van het
        // bestand ongelezen: de catalogus ontbreekt dan.
        let text = String::from_utf8(pdf).unwrap();
        for prev in [xref_at.to_string(), "3".to_string(), "99999999".to_string()] {
            let broken = text.replace(&format!("/Prev {old_xref}"), &format!("/Prev {prev}"));
            assert_ne!(broken, text);
            assert_eq!(unit(broken.as_bytes()), None, "{prev}");
        }
    }

    #[test]
    fn a_hybrid_file_finds_its_page_through_the_supplementary_stream() {
        // De tabel noemt alleen de catalogus en de paginaboom; de pagina staat
        // in een kruisverwijzingsstroom waar de trailer met /XRefStm naar wijst.
        let honest = document_with(Vec::new());
        let text = String::from_utf8(honest.clone()).unwrap();
        let at = |header: &str| text.find(header).unwrap();
        let (catalog_at, pages_at, page_at) = (at("1 0 obj"), at("2 0 obj"), at("3 0 obj"));
        let mut pdf = honest.clone();
        let supplement_at = pdf.len();
        pdf.extend(b"6 0 obj\n<< /Type /XRef /Size 7 /W [1 3 1] /Index [3 1] /Length 5 >>\nstream\n");
        pdf.extend([1, (page_at >> 16) as u8, (page_at >> 8) as u8, page_at as u8, 0]);
        pdf.extend(b"\nendstream\nendobj\n");
        let xref_at = pdf.len();
        pdf.extend(format!("xref\n0 3\n0000000000 65535 f \n{catalog_at:010} 00000 n \n{pages_at:010} 00000 n \ntrailer\n<< /Size 7 /Root 1 0 R /XRefStm {supplement_at} >>\nstartxref\n{xref_at}\n%%EOF\n").bytes());
        assert_eq!(read_mem(&pdf, 0).map(|p| p.spaces.len()), Some(1));
        // Zonder /XRefStm is de pagina er niet.
        let without = replace_bytes(&pdf, format!("/XRefStm {supplement_at}").as_bytes(), b"");
        assert!(read_mem(&without, 0).is_none());
    }

    #[test]
    fn an_object_stream_that_unpacks_beyond_the_limit_is_not_unpacked() {
        // Een paar tientallen kilobytes in het bestand, ruim boven de grens
        // eenmaal uitgepakt: het uitpakken stopt bij de grens.
        let (packed, first) = packed_objects();
        let mut bomb = packed.into_bytes();
        bomb.resize(MAX_UNPACKED_STREAM + 1024, b' ');
        let small = deflate(&bomb);
        assert!(small.len() < 1 << 20, "{}", small.len());
        let started = std::time::Instant::now();
        assert_eq!(load_mem(&packed_pdf(&small, first, "/Filter /FlateDecode"), 0, None), Err(ExportError::NoModelSpace));
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "{:?}", started.elapsed());
        // Een filter dat niet begrensd uit te pakken is, wordt niet geprobeerd.
        let (packed, first) = packed_objects();
        assert_eq!(load_mem(&packed_pdf(packed.as_bytes(), first, "/Filter /LZWDecode"), 0, None), Err(ExportError::NoModelSpace));
    }

    /// Zo schrijft een PDF-maker een stroom met de PNG-voorspeller "Up":
    /// regels van `columns` bytes, elk achter een filterbyte, elke byte min de
    /// byte erboven. Aangevuld met witruimte tot hele regels.
    fn predict_up(data: &[u8], columns: usize) -> Vec<u8> {
        let mut padded = data.to_vec();
        padded.resize(data.len().div_ceil(columns) * columns, b' ');
        let mut out = Vec::new();
        let mut previous = vec![0u8; columns];
        for row in padded.chunks_exact(columns) {
            out.push(2);
            out.extend(row.iter().zip(&previous).map(|(b, p)| b.wrapping_sub(*p)));
            previous.copy_from_slice(row);
        }
        out
    }

    #[test]
    fn png_predictors_are_undone_per_row_within_the_measured_bytes() {
        let params = |text: &str| match parse(text) {
            Some(Value::Dict(entries)) => entries,
            _ => panic!("geen woordenboek"),
        };
        // Vijf regels van drie bytes, elk met een ander filter; de eerste
        // regel heeft niets boven zich.
        let rows = vec![0, 1, 2, 3, 1, 1, 1, 1, 2, 1, 1, 1, 3, 1, 1, 1, 4, 0, 0, 0];
        let plain = vec![1, 2, 3, 1, 2, 3, 2, 3, 4, 2, 3, 4, 2, 3, 4];
        assert_eq!(unpredict(rows.clone(), &params("<< /Predictor 12 /Columns 3 >>")), Some(plain.clone()));
        assert_eq!(unpredict(rows.clone(), &params("<< /Predictor 15 /Columns 3 /Colors 1 /BitsPerComponent 8 >>")), Some(plain));
        // Zonder voorspeller blijven de bytes; een halve regel aan het eind telt niet.
        assert_eq!(unpredict(rows.clone(), &params("<< /Columns 3 >>")), Some(rows.clone()));
        assert_eq!(unpredict(vec![0, 7, 8, 9, 0, 1], &params("<< /Predictor 10 /Columns 3 >>")), Some(vec![7, 8, 9]));
        // Bits per regel worden naar boven op hele bytes afgerond.
        assert_eq!(unpredict(vec![1, 0x80, 0x01], &params("<< /Predictor 11 /Columns 12 /BitsPerComponent 1 >>")), Some(vec![0x80, 0x81]));
        // Een onbekend filterbyte, een andere voorspeller, onzinnige maten, of
        // een regel die niet in de gemeten bytes past: niets.
        for broken in [
            "<< /Predictor 12 /Columns 3 >>",
            "<< /Predictor 2 /Columns 3 >>",
            "<< /Predictor 12 /Columns 0 >>",
            "<< /Predictor 12 /Columns 3 /BitsPerComponent 7 >>",
            "<< /Predictor 12 /Columns 3 /Colors 0 >>",
            "<< /Predictor 12 /Columns 1000000000000 >>",
            "<< /Predictor 12 /Columns 4 /Colors 64 /BitsPerComponent 16 >>",
            "<< /Predictor 12 /Columns (drie) >>",
        ] {
            let data = if broken.starts_with("<< /Predictor 12 /Columns 3 >>") { vec![9, 1, 2, 3] } else { rows.clone() };
            assert_eq!(unpredict(data, &params(broken)), None, "{broken}");
        }
        let text = b"een tekst van meer dan zestien bytes lang";
        let mut padded = text.to_vec();
        padded.resize(48, b' ');
        assert_eq!(unpredict(predict_up(text, 16), &params("<< /Predictor 12 /Columns 16 >>")), Some(padded));
    }

    #[test]
    fn a_predictor_whose_row_does_not_fit_the_measured_bytes_is_refused() {
        // Een paar honderd bytes uitgepakt, maar het woordenboek belooft regels
        // van een biljoen bytes: daar wordt geen werkruimte voor gemaakt.
        let (packed, first) = packed_objects();
        let small = deflate(packed.as_bytes());
        let started = std::time::Instant::now();
        for parms in ["/Predictor 12 /Columns 1000000000000 /Colors 1", "/Predictor 12 /Columns 2000000000", "/Predictor 12 /Columns 4 /Colors 64 /BitsPerComponent 16"] {
            let pdf = packed_pdf(&small, first, &format!("/Filter /FlateDecode /DecodeParms << {parms} >>"));
            assert_eq!(load_mem(&pdf, 0, None), Err(ExportError::NoModelSpace), "{parms}");
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(2), "{:?}", started.elapsed());
        // Een voorspeller die wél bij de bytes past, wordt toegepast.
        let predicted = deflate(&predict_up(packed.as_bytes(), 16));
        for parms in ["/DecodeParms << /Predictor 12 /Columns 16 >>", "/DecodeParms [ << /Predictor 12 /Columns 16 >> ]"] {
            let pdf = packed_pdf(&predicted, first, &format!("/Filter /FlateDecode {parms}"));
            assert_eq!(read_mem(&pdf, 0).and_then(|p| p.choose(None).ok()).map(|s| s.unit), Some(DrawingUnit::M), "{parms}");
        }
        // Zonder voorspeller in het woordenboek zijn de voorspelde bytes rommel.
        assert_eq!(load_mem(&packed_pdf(&predicted, first, "/Filter /FlateDecode"), 0, None), Err(ExportError::NoModelSpace));
    }

    #[test]
    fn every_object_is_read_once_and_all_reading_shares_one_budget() {
        let pdf = document_with(vec![format!("[{}]", "0 ".repeat(1_000))]);
        let source = Source::new(&pdf, None).expect("opbouw");
        let before = source.budget.values_left.get();
        let first = source.object((4, 0)).expect("object 4");
        let spent = before - source.budget.values_left.get();
        assert_eq!(spent, 1_001, "de array en haar duizend getallen");
        let again = source.resolve(&Value::Ref(4, 0)).expect("object 4");
        assert!(Rc::ptr_eq(&first, &again), "onthouden, niet opnieuw gelezen");
        assert_eq!(source.budget.values_left.get(), before - spent);
        // Ook wat niet te lezen was, wordt maar één keer geprobeerd.
        assert!(source.object((99, 0)).is_none());
        assert!(source.objects.borrow().contains_key(&(99, 0)));

        // Duizend viewports die allemaal naar dezelfde grote objecten wijzen:
        // vroeger duizend keer gelezen, nu één keer.
        let big = format!("[{}]", "0 ".repeat(150_000));
        let viewports: String = (0..MAX_VIEWPORTS).map(|_| format!("<< /BBox 5 0 R /Name 6 0 R /OPS_ModelMatrix 4 0 R >> ")).collect();
        let shared = document_of(&format!("/VP [ {viewports} ]"), vec![MATRIX.to_string(), big.clone(), big.clone()]);
        let started = std::time::Instant::now();
        let found = load_mem(&shared, 0, None).expect("leesbaar");
        assert_eq!(found.spaces.len(), MAX_VIEWPORTS);
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "{:?}", started.elapsed());
        // Eén viewport meer dan er gelezen worden: geen halve lijst waaruit een
        // andere viewport gekozen zou worden dan het bestand bedoelt.
        let one_more = document_of(&format!("/VP [ {viewports} << /BBox [10 10 20 20] /OPS_ModelMatrix 4 0 R >> ]"), vec![MATRIX.to_string(), big.clone(), big.clone()]);
        assert_eq!(load_mem(&one_more, 0, None), Err(ExportError::NoModelSpace));

        // Meer verschillende objecten dan het budget toelaat: geen halve lijst
        // waar de keuze van afhangt, maar "geen terugweg".
        let many = MAX_VALUES_TOTAL / 150_000 + 2;
        let viewports: String = (0..many).map(|i| format!("<< /BBox {} 0 R /OPS_ModelMatrix 4 0 R >> ", 5 + i)).collect();
        let mut extra = vec![MATRIX.to_string()];
        extra.extend((0..many).map(|_| big.clone()));
        assert_eq!(load_mem(&document_of(&format!("/VP [ {viewports} ]"), extra), 0, None), Err(ExportError::NoModelSpace));
    }

    #[test]
    fn a_long_text_is_read_past_and_kept_short() {
        let long = "x".repeat(MAX_TEXT + 5_000);
        let Some(Value::Dict(entries)) = parse(&format!("<< /A ({long}) /B <{}> /C 7 >>", "41".repeat(MAX_TEXT + 5_000))) else { panic!("geen woordenboek") };
        let dict = Dict(entries);
        assert_eq!(dict.get(b"A"), Some(&Value::Text(vec![b'x'; MAX_TEXT])));
        assert_eq!(dict.get(b"B"), Some(&Value::Text(vec![b'A'; MAX_TEXT])));
        assert_eq!(dict.get(b"C"), Some(&Value::Number(7.0)));
        // Bij elkaar is er ook een grens.
        let budget = Budget::new();
        budget.text_left.set(10);
        let value = Parser::new(b"[ (twaalf tekens) (nog meer) <4142> ]", &budget).value(0);
        assert_eq!(value, Some(Value::Array(vec![Value::Text(b"twaalf tek".to_vec()), Value::Text(Vec::new()), Value::Text(Vec::new())])));
    }

    #[test]
    fn reading_stops_when_the_user_cancels() {
        let pdf = document_with(Vec::new());
        assert_eq!(load_mem(&pdf, 0, Some(&AtomicBool::new(true))), Err(ExportError::Cancelled));
        assert!(load_mem(&pdf, 0, Some(&AtomicBool::new(false))).is_ok());
    }

    #[test]
    fn a_cross_reference_that_lands_on_another_object_does_not_count() {
        // De tabel wijst voor object 3 (de pagina) naar de plek van object 4.
        let objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 842 595] >>".to_string(),
            "<< /Type /Page /Parent 2 0 R >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R /VP [ << /BBox [0 0 842 595] /OPS_ModelMatrix {MATRIX} >> ] >>"),
        ];
        let honest = plain_pdf(&objects);
        assert_eq!(load_mem(&honest, 0, None).map(|p| p.spaces.len()), Ok(0));
        let text = String::from_utf8(honest.clone()).unwrap();
        let (at3, at4) = (text.find("3 0 obj").unwrap(), text.find("4 0 obj").unwrap());
        let lying = text.replacen(&format!("{at3:010} 00000 n"), &format!("{at4:010} 00000 n"), 1);
        assert_ne!(lying, text);
        assert_eq!(load_mem(lying.as_bytes(), 0, None), Err(ExportError::NoModelSpace));
    }
}
