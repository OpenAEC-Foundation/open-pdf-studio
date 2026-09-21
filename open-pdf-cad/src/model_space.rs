//! De terugweg naar CAD: de afbeelding pagina naar model van een geïmporteerde
//! pagina lezen (#400).
//!
//! De import schrijft per (viewport van de) pagina `/OPS_ModelMatrix` en
//! `/OPS_ModelUnits` in het `/VP`-woordenboek. Met die matrix kan de export een
//! geïmporteerde pagina terugschrijven in de coördinaten van de oorspronkelijke
//! tekening.
//!
//! # Waarom een eigen lezer voor de getallen
//!
//! Bij landelijke coördinaten staat in de matrix een verschuiving van 10⁸ mm
//! met duizendsten erachter. De PDF-bibliotheek die de opbouw van het bestand
//! leest (kruisverwijzingen, objectstromen, de paginaboom) bewaart een reëel
//! getal in 32 bits, goed voor zeven cijfers: daarmee komt de tekening meters
//! naast haar plek terug. De bibliotheek wijst hier daarom alleen de wég naar
//! een object; de bytes van dat object leest [`Parser`] zelf, met getallen in
//! 64 bits. Om dezelfde reden schrijft de import zijn PDF ook zelf.
//!
//! # Grenzen
//!
//! Alles komt uit een bestand: geen `unwrap`, geen indexering zonder controle.
//!
//! - De bibliotheek leest recursief en zonder dieptegrens; een bestand dat
//!   dieper nest dan `pdf_depth::MAX_NESTING` krijgt ze niet te zien (een
//!   lineaire voorscan, zie de module `pdf_depth`). Ze levert hier alleen de
//!   kruisverwijzingen en de trailer: objecten bewaart ze niet, en een
//!   objectstroom pakt ze niet uit.
//! - Eén leesronde heeft één budget: het aantal gelezen waarden, de bewaarde
//!   tekst en de uitgepakte bytes van objectstromen, over alle objecten heen.
//!   Elk object wordt één keer gelezen en daarna onthouden; elke objectstroom
//!   wordt één keer uitgepakt, begrensd, en alleen als dat met `FlateDecode`
//!   kan. Is het budget op, dan is er "geen terugweg".
//! - De paginaboom wordt zelf doorlopen, in leesvolgorde, zonder een knoop twee
//!   keer te nemen en met een grens op het aantal knopen.
//! - De gebruiker kan afbreken: tijdens de voorscan en bij elk object.

use crate::convert::AreaRect;
use crate::error::ExportError;
use crate::geom::{Matrix, Point};
use crate::page_space::{DrawingUnit, PageFrame, PdfRect};
use crate::pdf_depth::{self, Nesting};
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

/// Hoogste aantal viewports dat van een pagina gelezen wordt.
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
    // De bibliotheek leest recursief en zonder grens; een bestand dat dieper
    // nest dan een echte PDF ooit doet, krijgt ze niet te zien.
    match pdf_depth::scan(file, &[], cancel) {
        Nesting::Fine => {}
        Nesting::TooDeep => return Err(ExportError::NoModelSpace),
        Nesting::Cancelled => return Err(ExportError::Cancelled),
    }
    // Een bestand dat haar laat struikelen, geeft gewoon "geen terugweg".
    let document = std::panic::catch_unwind(|| structure_of(file)).ok().flatten().ok_or(ExportError::NoModelSpace)?;
    let source = Source::new(document, file, cancel);
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

/// De opbouw van het bestand: alleen de kruisverwijzingen en de trailer. De
/// objecten zelf leest [`Source`], begrensd; hier vallen ze bij het lezen al
/// weg, zodat de bibliotheek geen objectstroom uitpakt en geen inhoud bewaart.
fn structure_of(file: &[u8]) -> Option<lopdf::Document> {
    fn nothing(_: (u32, u16), _: &mut lopdf::Object) -> Option<((u32, u16), lopdf::Object)> {
        None
    }
    lopdf::Reader { buffer: file, document: lopdf::Document::new() }.read(Some(nothing)).ok()
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
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
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

/// De kruisverwijzingen van het bestand (van de bibliotheek) naast zijn bytes.
///
/// Alles wat hier gelezen wordt, gaat van één gedeeld budget af: elk object
/// wordt één keer gelezen en daarna onthouden, elke objectstroom wordt één keer
/// en begrensd uitgepakt, en de gebruiker kan afbreken.
struct Source<'a> {
    reader: lopdf::Reader<'a>,
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
    fn new(document: lopdf::Document, file: &'a [u8], cancel: Option<&'a AtomicBool>) -> Self {
        let root = document.trailer.get(b"Root").ok().and_then(|r| r.as_reference().ok());
        let mut reader = lopdf::Reader { buffer: file, document: lopdf::Document::new() };
        reader.document.reference_table = document.reference_table;
        Source {
            reader,
            root,
            file,
            cancel,
            cancelled: Cell::new(false),
            budget: Budget::new(),
            objects: RefCell::new(HashMap::new()),
            streams: RefCell::new(HashMap::new()),
        }
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
                for item in items.iter().take(MAX_VIEWPORTS) {
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
        match self.reader.document.reference_table.get(id.0)? {
            lopdf::xref::XrefEntry::Normal { offset, generation } => {
                let mut parser = Parser::new(self.file.get(*offset as usize..)?, &self.budget);
                // `12 0 obj`, en wel van het object dat gevraagd is: een
                // kruisverwijzing die bij een ander object uitkomt, telt niet.
                let (number, found_generation) = (parser.unsigned()?, parser.unsigned()?);
                if number != u64::from(id.0) || found_generation != u64::from(*generation) || *generation != id.1 {
                    return None;
                }
                parser.keyword(b"obj")?;
                parser.value(0)
            }
            lopdf::xref::XrefEntry::Compressed { container, index } => {
                let packed = self.packed(*container)?;
                let (number, offset) = *packed.index.get(usize::from(*index))?;
                if number != u64::from(id.0) {
                    return None;
                }
                let start = packed.first.checked_add(usize::try_from(offset).ok()?)?;
                Parser::new(packed.content.get(start..)?, &self.budget).value(0)
            }
            _ => None,
        }
    }

    /// Een objectstroom, één keer en begrensd uitgepakt.
    fn packed(&self, container: u32) -> Option<Rc<Packed>> {
        if let Some(known) = self.streams.borrow().get(&container) {
            return known.clone();
        }
        let unpacked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.unpack(container))).ok().flatten().map(Rc::new);
        self.streams.borrow_mut().insert(container, unpacked.clone());
        unpacked
    }

    fn unpack(&self, container: u32) -> Option<Packed> {
        use std::io::Read;
        // De bibliotheek leest hier alleen het woordenboek en de ruwe bytes van
        // de stroom; uitpakken doet ze niet. De voorscan dekte deze bytes al.
        let lopdf::Object::Stream(mut stream) = self.reader.get_object((container, 0), &mut HashSet::new()).ok()? else { return None };
        if !stream.dict.type_is(b"ObjStm") {
            return None;
        }
        if stream.dict.get(b"Filter").is_ok() {
            // Alleen wat begrensd uit te pakken is.
            match stream.filters() {
                Ok(filters) if filters.len() == 1 && filters.first().is_some_and(|f| f == "FlateDecode") => {}
                _ => return None,
            }
            let limit = MAX_UNPACKED_STREAM.min(self.budget.unpacked_left.get());
            let mut out = Vec::new();
            // Een leesfout telt als het einde van de stroom, zoals in de bibliotheek.
            let _ = flate2::read::ZlibDecoder::new(stream.content.as_slice()).take(limit as u64 + 1).read_to_end(&mut out);
            if out.len() > limit {
                return None;
            }
            self.budget.unpacked_left.set(self.budget.unpacked_left.get() - out.len());
            if stream.dict.get(b"DecodeParms").is_ok() {
                // Een voorspeller maakt de uitvoer niet groter; de bibliotheek
                // past hem toe op dezelfde, nu gemeten invoer.
                stream.decompress();
            } else {
                stream.dict.remove(b"Filter");
                stream.set_content(out);
            }
        }
        let first = usize::try_from(stream.dict.get(b"First").and_then(lopdf::Object::as_i64).ok()?).ok()?;
        let count = usize::try_from(stream.dict.get(b"N").and_then(lopdf::Object::as_i64).ok()?).ok()?.min(MAX_PACKED_OBJECTS);
        let content = std::mem::take(&mut stream.content);
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
    fn a_bottomless_nesting_is_refused_before_the_library_reads_it() {
        // De bibliotheek leest arrays en woordenboeken recursief, zonder grens:
        // zo'n bestand kost de stapel, en dat is geen paniek die te vangen is.
        // Een draad met de gewone stapel, zoals de werkdraad van de app.
        for open in ["[", "<<", "[<<"] {
            let pdf = document_with(vec![open.repeat(200_000)]);
            let read = std::thread::spawn(move || read_mem(&pdf, 0)).join().expect("geen paniek");
            assert!(read.is_none(), "{open}");
        }
        // Dezelfde haken in een tekst, in commentaar of in een stroom tellen niet.
        let harmless = vec![
            format!("({})", "[".repeat(5_000)),
            format!("<< /Length 5000 >>\nstream\n{}\nendstream", "[".repeat(5_000)),
            format!("% {}\n<< >>", "<<".repeat(5_000)),
        ];
        assert!(read_mem(&document_with(harmless), 0).is_some());
        // Tot de grens mag het.
        let allowed = format!("{}{}", "[".repeat(crate::pdf_depth::MAX_NESTING), "]".repeat(crate::pdf_depth::MAX_NESTING));
        assert!(read_mem(&document_with(vec![allowed]), 0).is_some());
    }

    /// Zo bewaart de app een document na het opslaan: pagina's in een
    /// objectstroom, en een kruisverwijzingsstroom in plaats van een tabel.
    /// `stream` is de inhoud van de objectstroom zoals ze in het bestand staat
    /// (ingepakt als `filter` dat zegt), `first` de lengte van haar index.
    fn packed_pdf(stream: &[u8], first: usize, filter: &str) -> Vec<u8> {
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
        pdf.extend_from_slice(format!("5 0 obj\n<< /Type /XRef /Size 6 /W [1 3 1] /Root 1 0 R /Length {} >>\nstream\n", rows.len()).as_bytes());
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
        for pdf in [packed_pdf(packed.as_bytes(), first, ""), packed_pdf(&deflate(packed.as_bytes()), first, "/Filter /FlateDecode")] {
            let found = read_mem(&pdf, 0).expect("leesbaar");
            let space = found.choose(None).expect("modelmatrix");
            assert_eq!(space.unit, DrawingUnit::M);
            assert_eq!(space.page_to_model.e, 154_999_000.123);
            assert_eq!(space.page_to_model.f, 462_999_000.456);
        }
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

    #[test]
    fn every_object_is_read_once_and_all_reading_shares_one_budget() {
        let pdf = document_with(vec![format!("[{}]", "0 ".repeat(1_000))]);
        let source = Source::new(structure_of(&pdf).expect("opbouw"), &pdf, None);
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
