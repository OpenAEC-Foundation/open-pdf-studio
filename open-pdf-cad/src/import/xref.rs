//! Externe verwijzingen: paden veilig oplossen en tekeningen laden (#400).
//!
//! Een pad uit een tekeningbestand is invoer, geen opdracht. Er wordt alleen
//! gelezen binnen de map van de tekening zelf en binnen zoekpaden die de
//! gebruiker uitdrukkelijk heeft gekozen:
//!
//! - Netwerkpaden (`\\server\...`), apparaatpaden (`\\?\`, `\\.\`), alles met
//!   een URL-schema, alternatieve datastromen (`bestand:stroom`) en
//!   stuurtekens worden geweigerd zonder dat er iets op schijf wordt
//!   aangeraakt ([`Located::Refused`]).
//! - Een bestandsnaam die het systeem anders leest dan hij er staat, wordt net
//!   zo geweigerd zonder iets aan te raken, maar met een eigen uitkomst
//!   ([`Located::OddName`]), zodat de melding zegt wat er werkelijk aan de
//!   hand is: een naam die het systeem als apparaat leest (`NUL`, `COM1.dwg`,
//!   …) of die op een punt of spatie eindigt. Beoordeeld wordt de naam die het
//!   systeem er werkelijk uit haalt (`Path::file_name`), dus ook `NUL/` en
//!   `NUL/.` vallen hieronder. Alle zulke namen worden geweigerd, niet alleen
//!   de apparaatnamen: dat is het veiligst, en `blad.dwg.` wijst in stilte een
//!   ander bestand aan dan er staat.
//! - Van een absoluut pad (van een andere machine), van een pad met `..` en
//!   van een pad met zo'n vreemde naam als map telt alleen de bestandsnaam; de
//!   mappen erin worden nooit gevolgd.
//! - Wat gevonden wordt, moet ná `canonicalize` nog steeds binnen een
//!   toegestane map liggen. Een koppeling (symlink, junction) die naar buiten
//!   wijst, wordt zo geweigerd.
//! - Er geldt een begroting in bytes, een grens op het aantal bestanden, een
//!   grens op de diepte van verwijzingen in verwijzingen, en een verwijzing
//!   die (via via) naar zichzelf wijst wordt niet nog eens geladen.
//! - Een gevonden bestand wordt één keer geopend; grootte en soort komen van
//!   die geopende handle ([`open_regular`]) en het lezen gaat via dezelfde
//!   handle. Een bestand dat tussen het meten en het lezen verwisseld wordt of
//!   groeit, komt zo niet alsnog binnen.
//!
//! Wat hier niet tegen beschermt:
//!
//! - Een harde koppeling binnen een toegestane map naar een bestand
//!   daarbuiten. Die is op bestandsniveau niet van een gewoon bestand te
//!   onderscheiden, en wie hem kan maken kan het bestand ook gewoon kopiëren.
//! - Het ogenblik tussen het oplossen van het pad (`canonicalize`) en het
//!   openen. Wie in een toegestane map mag schrijven, kan in dat ogenblik het
//!   bestand vervangen door een koppeling naar buiten. Dat vraagt dezelfde
//!   rechten als de harde koppeling hierboven (schrijven in een map die de
//!   gebruiker zelf heeft aangewezen) en is daarom dezelfde grens.

use acadrust::CadDocument;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};

/// Diepste keten van verwijzingen die nog geladen en getekend wordt.
pub const MAX_XREF_DEPTH: u32 = 4;
/// Hoogste aantal bestanden dat één import erbij laadt.
pub const MAX_XREF_FILES: usize = 64;
/// Hoogste aantal bytes dat één import erbij leest.
pub const MAX_XREF_BYTES: u64 = 256 * 1024 * 1024;
/// Hoogste aantal zoekpaden dat de gebruiker kan opgeven.
pub const MAX_SEARCH_PATHS: usize = 16;
/// Langste pad (in tekens) dat nog bekeken wordt.
const MAX_RAW_PATH: usize = 1024;

/// Hoogste aantal bestanden van buiten de tekening dat een verslag bij naam
/// noemt. De tellingen in de waarschuwingen blijven volledig.
pub const MAX_LISTED_EXTERNALS: usize = 50;
/// Langste naam (in tekens) in zo'n verslag.
pub const MAX_LISTED_NAME: usize = 80;

/// Soort bestand van buiten de tekening.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalKind {
    Xref,
    Image,
}

/// Wat er met een bestand van buiten de tekening gebeurd is (of, in de
/// verkenning, zou gebeuren).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalStatus {
    /// Alleen in de verkenning: gevonden binnen een toegestane map, dus de
    /// import zou het lezen. Of het dan bruikbaar is, blijkt pas bij het lezen.
    Found,
    /// Gelezen: een geladen verwijzing of een ingesloten beeld.
    Loaded,
    Missing,
    Refused,
    OddName,
    TooLarge,
    Unsupported,
}

impl ExternalStatus {
    /// Rang in een volle lijst, laag gaat voor: wat gelezen is (of gelezen zou
    /// worden), dan wat geweigerd is, dan wat niet bruikbaar bleek, en als
    /// laatste wat alleen niet gevonden is.
    fn rank(self) -> u8 {
        match self {
            ExternalStatus::Found | ExternalStatus::Loaded => 0,
            ExternalStatus::Refused | ExternalStatus::OddName => 1,
            ExternalStatus::TooLarge | ExternalStatus::Unsupported => 2,
            ExternalStatus::Missing => 3,
        }
    }
}

/// Eén bestand van buiten de tekening, voor het verslag aan de gebruiker.
/// `name` is alleen de bestandsnaam, nooit een pad: het verslag gaat naar de
/// webview en hoort niet te verklappen hoe iemands schijf is ingedeeld (en
/// het pad uit de tekening zegt dat evenmin over deze machine).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFile {
    pub name: String,
    pub kind: ExternalKind,
    pub status: ExternalStatus,
}

/// De bestandsnaam uit een pad zoals het in een tekening staat, geschikt om te
/// tonen: alles tot en met het laatste scheidingsteken weg, stuurtekens weg,
/// en niet langer dan [`MAX_LISTED_NAME`] tekens.
pub fn display_name(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches(['/', '\\']);
    let last = trimmed.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = last.chars().filter(|c| !c.is_control()).collect();
    let clean = clean.trim();
    if clean.chars().count() <= MAX_LISTED_NAME {
        return clean.to_string();
    }
    let mut short: String = clean.chars().take(MAX_LISTED_NAME - 1).collect();
    short.push('…');
    short
}

/// De bestanden van buiten de tekening die een verslag bij naam noemt:
/// ontdubbeld en begrensd in aantal.
#[derive(Clone, Debug, Default)]
pub struct ExternalList {
    files: Vec<ExternalFile>,
    truncated: bool,
}

impl ExternalList {
    /// Noteert een bestand; `raw` mag een heel pad zijn, alleen de naam blijft.
    pub fn note(&mut self, raw: &str, kind: ExternalKind, status: ExternalStatus) {
        let name = display_name(raw);
        if name.is_empty() || self.files.iter().any(|f| f.name == name && f.kind == kind && f.status == status) {
            return;
        }
        if self.files.len() >= MAX_LISTED_EXTERNALS {
            self.truncated = true;
            // Vol: wat gelezen of geweigerd is gaat vóór wat alleen niet
            // gevonden is, want daar is het verslag voor. Het laatste bestand
            // van de minst belangrijke soort maakt plaats.
            let least = self.files.iter().map(|f| f.status.rank()).max().unwrap_or(0);
            if least <= status.rank() {
                return;
            }
            if let Some(at) = self.files.iter().rposition(|f| f.status.rank() == least) {
                self.files.remove(at);
            }
        }
        self.files.push(ExternalFile { name, kind, status });
    }

    /// Als [`ExternalList::note`], met de naam van een gevonden bestand.
    pub fn note_path(&mut self, path: &Path, kind: ExternalKind, status: ExternalStatus) {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        self.note(&name, kind, status);
    }

    pub fn extend(&mut self, other: &ExternalList) {
        for file in &other.files {
            self.note(&file.name, file.kind, file.status);
        }
        self.truncated |= other.truncated;
    }

    pub fn files(&self) -> &[ExternalFile] {
        &self.files
    }

    /// Er is meer dan hier staat, zonder dat het genoteerd is.
    pub fn mark_truncated(&mut self) {
        self.truncated = true;
    }

    /// Er waren meer bestanden dan het verslag noemt.
    pub fn truncated(&self) -> bool {
        self.truncated
    }

    pub fn into_parts(self) -> (Vec<ExternalFile>, bool) {
        (self.files, self.truncated)
    }
}

/// Uitkomst van het zoeken naar een bestand.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Located {
    /// Gevonden, binnen een toegestane map; het pad is gecanonicaliseerd.
    Found(PathBuf),
    /// Niet gevonden (of niet van een toegestane soort).
    Missing,
    /// Geweigerd: een onveilig pad, of een vondst die buiten de toegestane
    /// mappen uitkomt.
    Refused,
    /// Geweigerd om de naam: het systeem leest hem als apparaat (`NUL`,
    /// `COM1.dwg`) of knipt er een punt of spatie af.
    OddName,
}

/// Mappen waarin gezocht mag worden.
#[derive(Clone, Debug, Default)]
pub struct SearchPaths {
    roots: Vec<PathBuf>,
}

/// Een naam die het besturingssysteem als apparaat leest, ook met een
/// extensie erachter (`NUL.dwg`) of met spaties voor de punt.
fn is_reserved_name(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or("").trim_end_matches(' ').to_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" | "CLOCK$") {
        return true;
    }
    let mut chars = stem.chars();
    let prefix: String = chars.by_ref().take(3).collect();
    let rest: Vec<char> = chars.collect();
    (prefix == "COM" || prefix == "LPT")
        && rest.len() == 1
        && rest.first().is_some_and(|c| c.is_ascii_digit() || matches!(c, '\u{b9}' | '\u{b2}' | '\u{b3}'))
}

/// Oordeel over een pad op zicht.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Verdict {
    Fine,
    Unsafe,
    OddName,
}

/// Is dit pad op zicht al onveilig? Werkt alleen op de tekst: er wordt niets
/// op schijf of op het netwerk aangeraakt.
fn judge(raw: &str) -> Verdict {
    let trimmed = raw.trim();
    if trimmed.chars().count() > MAX_RAW_PATH || trimmed.chars().any(|c| c.is_control()) {
        return Verdict::Unsafe;
    }
    let normal = trimmed.replace('\\', "/");
    // Netwerkpad of apparaatpad: \\server\deel, \\?\C:\…, \\.\COM1.
    if normal.starts_with("//") {
        return Verdict::Unsafe;
    }
    // Een dubbele punt mag alleen de stationsletter afsluiten (`C:/…`). Al het
    // andere is een URL-schema (`https://`, `file:`), een alternatieve
    // datastroom (`blad.dwg:stroom`) of een pad ten opzichte van de werkmap
    // van een station (`C:blad.dwg`).
    for (at, c) in normal.char_indices() {
        if c != ':' {
            continue;
        }
        let drive = at == 1
            && normal.chars().next().is_some_and(|l| l.is_ascii_alphabetic())
            && normal.get(2..).is_some_and(|rest| rest.starts_with('/'));
        if !drive {
            return Verdict::Unsafe;
        }
    }
    // De bestandsnaam zelf wordt altijd gebruikt en moet dus deugen. Dat is de
    // naam die het systeem eruit haalt, niet het laatste stukje tekst: van
    // `NUL/` en `NUL/.` is dat `NUL`. Mappen in het pad worden alleen gevolgd
    // als ze deugen (zie `odd_component`).
    if Path::new(&normal).file_name().is_some_and(|name| odd_component(&name.to_string_lossy())) {
        Verdict::OddName
    } else {
        Verdict::Fine
    }
}

/// Een naam die iets anders aanwijst dan er staat: het besturingssysteem knipt
/// punten en spaties aan het eind weg, en leest sommige namen als apparaat.
fn odd_component(component: &str) -> bool {
    let odd_ending = component != "." && component != ".." && (component.ends_with('.') || component.ends_with(' '));
    odd_ending || is_reserved_name(component)
}

impl SearchPaths {
    /// `base` is de map van de tekening zelf; `extra` zijn zoekpaden die de
    /// gebruiker heeft gekozen. Mappen die niet bestaan vallen weg.
    pub fn new(base: Option<&Path>, extra: &[PathBuf]) -> SearchPaths {
        let mut roots: Vec<PathBuf> = Vec::new();
        let mut add = |p: &Path| {
            // Een lege map (`Path::new("")`, de "map" van een kale
            // bestandsnaam) is niet de werkmap: die heeft niemand gekozen.
            if p.as_os_str().is_empty() {
                return;
            }
            if let Ok(canonical) = p.canonicalize() {
                if canonical.is_dir() && !roots.contains(&canonical) {
                    roots.push(canonical);
                }
            }
        };
        if let Some(base) = base {
            add(base);
        }
        for path in extra {
            add(path);
        }
        SearchPaths { roots }
    }

    /// De mappen voor een tekening op `drawing`: haar eigen map plus de
    /// gekozen zoekpaden. De map komt van het echte bestand (een koppeling
    /// naar de tekening telt als de plek waar zij werkelijk staat); bestaat
    /// het bestand niet, dan van het pad zoals het er staat.
    pub fn for_drawing(drawing: &Path, extra: &[PathBuf]) -> SearchPaths {
        let real = drawing.canonicalize().ok();
        let base = real.as_deref().and_then(Path::parent).or_else(|| drawing.parent());
        SearchPaths::new(base, extra)
    }

    pub fn is_empty(&self) -> bool {
        self.roots.is_empty()
    }

    /// Ligt dit (gecanonicaliseerde) pad binnen een toegestane map?
    pub fn contains(&self, canonical: &Path) -> bool {
        self.roots.iter().any(|root| canonical.starts_with(root))
    }

    /// Als [`SearchPaths::locate`], zonder onderscheid tussen "niet gevonden"
    /// en "geweigerd".
    pub fn resolve(&self, raw: &str, allowed_extensions: &[&str]) -> Option<PathBuf> {
        match self.locate(raw, None, allowed_extensions) {
            Located::Found(path) => Some(path),
            _ => None,
        }
    }

    /// Zoekt het bestand waar een pad uit een tekening naar verwijst.
    ///
    /// Geprobeerd wordt, in `from` (de map van het bestand waar het pad in
    /// staat, mits die zelf binnen een toegestane map ligt) en daarna in elke
    /// toegestane map: het pad zoals het er staat (alleen als het relatief is
    /// en geen `..` bevat), en anders alleen de bestandsnaam. Wat gevonden
    /// wordt moet ná `canonicalize` binnen een toegestane map liggen, een
    /// gewoon bestand zijn en een toegestane extensie hebben.
    pub fn locate(&self, raw: &str, from: Option<&Path>, allowed_extensions: &[&str]) -> Located {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Located::Missing;
        }
        match judge(trimmed) {
            Verdict::Unsafe => return Located::Refused,
            Verdict::OddName => return Located::OddName,
            Verdict::Fine => {}
        }
        if self.roots.is_empty() {
            return Located::Missing;
        }
        let as_path = PathBuf::from(trimmed.replace('\\', "/"));
        let Some(file_name) = as_path.file_name().map(|n| n.to_owned()) else {
            return Located::Missing;
        };
        // Zoals het er staat alleen als het relatief is, zonder `..`, en zonder
        // mappen met een naam die iets anders aanwijst dan er staat.
        let relative_ok = as_path.components().all(|c| match c {
            Component::Normal(name) => !odd_component(&name.to_string_lossy()),
            Component::CurDir => true,
            _ => false,
        });
        let from = from.filter(|dir| self.contains(dir));
        let mut escaped = false;
        for base in from.into_iter().chain(self.roots.iter().map(|r| r.as_path())) {
            let mut candidates: Vec<PathBuf> = Vec::with_capacity(2);
            if relative_ok {
                candidates.push(base.join(&as_path));
            }
            candidates.push(base.join(&file_name));
            for candidate in candidates {
                let Ok(canonical) = candidate.canonicalize() else { continue };
                if !self.contains(&canonical) {
                    // Een koppeling die naar buiten wijst.
                    escaped = true;
                    continue;
                }
                if !canonical.is_file() {
                    continue;
                }
                let extension = canonical.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                if allowed_extensions.iter().any(|e| *e == extension) {
                    return Located::Found(canonical);
                }
            }
        }
        if escaped {
            Located::Refused
        } else {
            Located::Missing
        }
    }
}

/// Een gevonden bestand, één keer geopend. Grootte en soort komen van de
/// geopende handle, niet van het pad: wat daarna gelezen wordt, is hetzelfde
/// bestand als wat gemeten is.
pub struct OpenFile {
    file: std::fs::File,
    size: u64,
}

/// Opent een gevonden bestand. `None` als het niet te openen is of geen gewoon
/// bestand blijkt (een map, een apparaat).
pub fn open_regular(path: &Path) -> Option<OpenFile> {
    let file = std::fs::File::open(path).ok()?;
    let meta = file.metadata().ok()?;
    meta.is_file().then_some(OpenFile { file, size: meta.len() })
}

impl OpenFile {
    /// Grootte in bytes, gemeten op de geopende handle.
    pub fn size(&self) -> u64 {
        self.size
    }

    /// Leest het bestand, maar nooit meer dan de gemeten grootte: een bestand
    /// dat tussen het meten en het lezen groeit, komt zo niet alsnog binnen.
    /// `None` als het niet leesbaar is, groter blijkt dan gemeten, of niet in
    /// het geheugen past.
    pub fn read(self) -> Option<Vec<u8>> {
        let mut data = Vec::new();
        data.try_reserve_exact(usize::try_from(self.size).ok()?.checked_add(1)?).ok()?;
        self.file.take(self.size.saturating_add(1)).read_to_end(&mut data).ok()?;
        (data.len() as u64 <= self.size).then_some(data)
    }
}

/// Eén geladen externe verwijzing.
pub struct XrefDoc {
    pub document: CadDocument,
    pub is_dxf: bool,
    /// Map van het bestand (gecanonicaliseerd): daar zoekt de import eerst
    /// naar wat deze tekening zelf weer aanhaalt.
    pub dir: PathBuf,
    /// De verwijzingen van deze tekening zelf.
    pub children: XrefDocs,
}

/// De geladen tekeningen van één niveau, op de naam van het blokrecord (in
/// hoofdletters). Het bovenste niveau draagt de tellingen van de hele boom.
#[derive(Default)]
pub struct XrefDocs {
    documents: HashMap<String, Rc<XrefDoc>>,
    loaded: u64,
    missing: u64,
    refused: u64,
    odd_names: u64,
    listed: ExternalList,
}

pub fn is_xref(record: &acadrust::tables::BlockRecord) -> bool {
    record.flags.is_xref || record.flags.is_xref_overlay || !record.xref_path.is_empty()
}

struct Loader<'p> {
    paths: &'p SearchPaths,
    budget: &'p mut u64,
    cancel: &'p AtomicBool,
    /// Bestanden die nu geladen worden, van buiten naar binnen: wat hier al
    /// in staat, wijst (via via) naar zichzelf.
    chain: Vec<PathBuf>,
    /// Elk bestand wordt één keer gelezen, ook als twee tekeningen het
    /// aanhalen.
    cache: HashMap<PathBuf, Rc<XrefDoc>>,
    /// Bestanden die gelezen zijn, ook als ze daarna onleesbaar bleken.
    files: usize,
    loaded: u64,
    missing: u64,
    refused: u64,
    odd_names: u64,
    /// Wat het verslag bij naam noemt.
    listed: ExternalList,
}

impl Loader<'_> {
    fn note(&mut self, raw: &str, status: ExternalStatus) {
        self.listed.note(raw, ExternalKind::Xref, status);
    }

    fn level(&mut self, document: &CadDocument, from: Option<&Path>, depth: u32) -> HashMap<String, Rc<XrefDoc>> {
        let mut out = HashMap::new();
        for record in document.block_records.iter() {
            if self.cancel.load(Ordering::Relaxed) {
                break;
            }
            if !is_xref(record) {
                continue;
            }
            let raw = if record.xref_path.trim().is_empty() { record.name.as_str() } else { record.xref_path.as_str() };
            if depth > MAX_XREF_DEPTH {
                self.refused += 1;
                self.note(raw, ExternalStatus::Refused);
                continue;
            }
            let found = match self.paths.locate(raw, from, &["dwg", "dxf"]) {
                Located::Found(path) => path,
                Located::Missing => {
                    self.missing += 1;
                    self.note(raw, ExternalStatus::Missing);
                    continue;
                }
                Located::Refused => {
                    self.refused += 1;
                    self.note(raw, ExternalStatus::Refused);
                    continue;
                }
                Located::OddName => {
                    self.odd_names += 1;
                    self.note(raw, ExternalStatus::OddName);
                    continue;
                }
            };
            // A verwijst naar B verwijst naar A: de kring stopt hier.
            if self.chain.contains(&found) {
                self.refused += 1;
                self.listed.note_path(&found, ExternalKind::Xref, ExternalStatus::Refused);
                continue;
            }
            if let Some(known) = self.cache.get(&found) {
                out.insert(record.name.to_uppercase(), known.clone());
                continue;
            }
            if self.files >= MAX_XREF_FILES {
                self.refused += 1;
                self.listed.note_path(&found, ExternalKind::Xref, ExternalStatus::Refused);
                continue;
            }
            // Eén keer openen: de grootte voor de begroting en de bytes komen
            // van dezelfde handle.
            let Some(open) = open_regular(&found) else {
                self.missing += 1;
                self.listed.note_path(&found, ExternalKind::Xref, ExternalStatus::Missing);
                continue;
            };
            if open.size() > *self.budget {
                self.refused += 1;
                self.listed.note_path(&found, ExternalKind::Xref, ExternalStatus::Refused);
                continue;
            }
            *self.budget -= open.size();
            self.files += 1;
            let Some((child, is_dxf)) = open.read().and_then(|data| read_document(data, self.cancel)) else {
                self.missing += 1;
                self.listed.note_path(&found, ExternalKind::Xref, ExternalStatus::Unsupported);
                continue;
            };
            let dir = found.parent().map(Path::to_path_buf).unwrap_or_default();
            self.chain.push(found.clone());
            let children = XrefDocs { documents: self.level(&child, Some(&dir), depth + 1), ..Default::default() };
            self.chain.pop();
            let loaded = Rc::new(XrefDoc { document: child, is_dxf, dir, children });
            self.listed.note_path(&found, ExternalKind::Xref, ExternalStatus::Loaded);
            self.cache.insert(found, loaded.clone());
            self.loaded += 1;
            out.insert(record.name.to_uppercase(), loaded);
        }
        out
    }
}

impl XrefDocs {
    pub fn get(&self, block_name: &str) -> Option<&XrefDoc> {
        self.documents.get(&block_name.to_uppercase()).map(|doc| doc.as_ref())
    }

    /// Bestanden die geladen zijn (de hele boom).
    pub fn loaded(&self) -> u64 {
        self.loaded
    }

    /// Verwijzingen die niet gevonden werden of niet leesbaar waren.
    pub fn missing(&self) -> u64 {
        self.missing
    }

    /// Verwijzingen die geweigerd zijn: onveilig pad, buiten de toegestane
    /// mappen, een kring, te diep, of boven de begroting.
    pub fn refused(&self) -> u64 {
        self.refused
    }

    /// Verwijzingen die geweigerd zijn om hun naam: een naam die het systeem
    /// als apparaat leest of waar het een punt of spatie van afknipt.
    pub fn odd_names(&self) -> u64 {
        self.odd_names
    }

    /// De verwijzingen bij naam, voor het verslag: alleen bestandsnamen,
    /// begrensd in aantal.
    pub fn listed(&self) -> &ExternalList {
        &self.listed
    }

    /// Laadt de externe verwijzingen van een tekening, ook die van de
    /// verwijzingen zelf tot [`MAX_XREF_DEPTH`] diep. Leest niets buiten
    /// `paths`, niet meer dan [`MAX_XREF_FILES`] bestanden en niet meer bytes
    /// dan er in `budget` over zijn. `source` is het bestand van de
    /// hoofdtekening zelf: een verwijzing daarnaar is een kring. Af te breken
    /// via `cancel`.
    pub fn load(document: &CadDocument, source: Option<&Path>, paths: &SearchPaths, budget: &mut u64, cancel: &AtomicBool) -> XrefDocs {
        let mut loader = Loader {
            paths,
            budget,
            cancel,
            chain: source.and_then(|p| p.canonicalize().ok()).into_iter().collect(),
            cache: HashMap::new(),
            files: 0,
            loaded: 0,
            missing: 0,
            refused: 0,
            odd_names: 0,
            listed: ExternalList::default(),
        };
        let from = loader.chain.first().and_then(|p| p.parent()).map(Path::to_path_buf);
        let documents = loader.level(document, from.as_deref(), 1);
        XrefDocs {
            documents,
            loaded: loader.loaded,
            missing: loader.missing,
            refused: loader.refused,
            odd_names: loader.odd_names,
            listed: loader.listed,
        }
    }
}

/// Leest één verwezen tekening uit het geheugen. Een bestand dat niet leesbaar
/// is (of van vóór R13) levert `None`; de import gaat dan door zonder die
/// verwijzing. Geeft ook terug of het een DXF was.
fn read_document(data: Vec<u8>, cancel: &AtomicBool) -> Option<(CadDocument, bool)> {
    match super::detect_version(&data) {
        Some(version) if version.as_str() < "AC1012" => None,
        Some(_) => acadrust::DwgReader::from_stream(std::io::Cursor::new(data)).read().ok().map(|d| (d, false)),
        None => {
            let cancelled = || cancel.load(Ordering::Relaxed);
            let in_chunks = super::dxf_chunks::read_in_chunks(&data, super::dxf_chunks::DEFAULT_CHUNK, |_, _| {}, &cancelled);
            match in_chunks {
                Ok(Some(document)) => Some((document, true)),
                Ok(None) => acadrust::DxfReader::from_reader(std::io::Cursor::new(data)).ok()?.read().ok().map(|d| (d, true)),
                Err(_) => None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tijdelijke map die zichzelf opruimt.
    struct WorkDir(PathBuf);

    impl WorkDir {
        fn new(name: &str) -> WorkDir {
            let dir = std::env::temp_dir().join(format!("opds-xref-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            WorkDir(dir)
        }
    }

    impl Drop for WorkDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const KINDS: [&str; 2] = ["dwg", "dxf"];

    #[test]
    fn only_files_inside_a_chosen_folder_are_found() {
        let work = WorkDir::new("paden");
        let root = work.0.join("tekening");
        let sub = root.join("verwijzingen");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(root.join("blad.dwg"), b"x").unwrap();
        std::fs::write(sub.join("gevel.dxf"), b"x").unwrap();
        std::fs::write(root.join("geheim.txt"), b"x").unwrap();
        let buiten = work.0.join("buiten");
        std::fs::create_dir_all(&buiten).unwrap();
        std::fs::write(buiten.join("elders.dwg"), b"x").unwrap();

        let paths = SearchPaths::new(Some(&root), &[sub.clone()]);
        assert!(paths.resolve("blad.dwg", &KINDS).is_some());
        assert!(paths.resolve("gevel.dxf", &KINDS).is_some(), "ook in een gekozen zoekpad");
        assert!(paths.resolve("verwijzingen/gevel.dxf", &KINDS).is_some(), "relatief binnen de map");
        assert!(paths.resolve("verwijzingen\\gevel.dxf", &KINDS).is_some());
        // Alleen de bestandsnaam telt van een absoluut pad van een andere machine.
        assert!(paths.resolve("Z:/projecten/2026/blad.dwg", &KINDS).is_some());
        assert!(paths.resolve("Z:\\projecten\\2026\\BLAD.DWG", &KINDS).is_some() || cfg!(not(windows)));
        assert!(paths.resolve("geheim.txt", &KINDS).is_none(), "verkeerde soort");
        assert!(paths.resolve("../buiten/elders.dwg", &KINDS).is_none(), "padtraversal");
        assert!(paths.resolve("verwijzingen/../../buiten/elders.dwg", &KINDS).is_none());
        assert!(paths.resolve(&buiten.join("elders.dwg").to_string_lossy(), &KINDS).is_none());
        // Van een pad met `..` telt alleen de naam: de mappen worden niet gevolgd.
        assert!(paths.resolve("../elders/blad.dwg", &KINDS).is_some());
        assert!(paths.resolve("", &KINDS).is_none());
        assert!(paths.resolve("   ", &KINDS).is_none());
        assert!(paths.resolve("..", &KINDS).is_none());
        assert!(paths.resolve("/", &KINDS).is_none());
        assert!(SearchPaths::default().resolve("blad.dwg", &KINDS).is_none(), "zonder map niets");
        // Een kale bestandsnaam heeft de lege map als ouder; dat is niet de werkmap.
        assert!(SearchPaths::new(Path::new("blad.dwg").parent(), &[]).is_empty());
        assert!(SearchPaths::new(Some(&work.0.join("bestaat-niet")), &[]).is_empty());
    }

    #[test]
    fn unsafe_paths_are_refused_before_anything_is_touched() {
        let work = WorkDir::new("onveilig");
        std::fs::write(work.0.join("blad.dwg"), b"x").unwrap();
        let paths = SearchPaths::new(Some(&work.0), &[]);
        for raw in [
            "//server/deel/blad.dwg",
            "\\\\server\\deel\\blad.dwg",
            "\\/server/deel/blad.dwg",
            "\\\\?\\C:\\blad.dwg",
            "\\\\?\\UNC\\server\\deel\\blad.dwg",
            "\\\\.\\C:\\blad.dwg",
            "//./COM1",
            "https://elders/blad.dwg",
            "file:///C:/blad.dwg",
            "file:blad.dwg",
            "ftp://elders/blad.dwg",
            "blad.dwg:stroom",
            "blad.dwg::$DATA",
            "C:blad.dwg",
            "blad\u{0}.dwg",
            "blad\n.dwg",
        ] {
            assert_eq!(paths.locate(raw, None, &KINDS), Located::Refused, "{raw:?}");
        }
        // Een naam die het systeem anders leest dan hij er staat: geweigerd
        // met een eigen uitkomst, zodat de melding klopt. De naam die het
        // systeem eruit haalt telt, niet het laatste stukje tekst.
        for raw in [
            "NUL",
            "nul.dwg",
            "COM1.dwg",
            "lpt9 .dwg",
            "AUX.tar.dwg",
            "blad.dwg.",
            "NUL/",
            "NUL\\",
            "nul.dwg/.",
            "map/COM1.dwg/",
            "blad.dwg./",
            "C:/elders/AUX\\",
        ] {
            assert_eq!(paths.locate(raw, None, &KINDS), Located::OddName, "{raw:?}");
        }
        let long = format!("{}.dwg", "a".repeat(MAX_RAW_PATH + 1));
        assert_eq!(paths.locate(&long, None, &KINDS), Located::Refused);
        // Namen die er alleen op lijken, zijn gewone namen.
        for raw in ["console.dwg", "COM10.dwg", "nulpunt.dwg", "com.dwg", "bestaat-niet.dwg"] {
            assert_eq!(paths.locate(raw, None, &KINDS), Located::Missing, "{raw:?}");
        }
        assert!(matches!(paths.locate("C:/elders/blad.dwg", None, &KINDS), Located::Found(_)), "stationsletter mag");
        // Een map met een vreemde naam wordt niet gevolgd; dan telt alleen de
        // bestandsnaam. (In echte tekeningen komen mappen voor die op een spatie
        // eindigen; dat is geen reden om de afbeelding te weigeren.)
        std::fs::create_dir_all(work.0.join("map")).unwrap();
        std::fs::write(work.0.join("map").join("detail.dwg"), b"x").unwrap();
        assert!(matches!(paths.locate("map/detail.dwg", None, &KINDS), Located::Found(_)));
        for raw in ["map /detail.dwg", "map./detail.dwg", "CON/detail.dwg", "../../map /detail.dwg"] {
            assert_eq!(paths.locate(raw, None, &KINDS), Located::Missing, "{raw:?}");
        }
        for raw in ["map /blad.dwg", "CON/blad.dwg", "..\\oud \\blad.dwg"] {
            assert!(matches!(paths.locate(raw, None, &KINDS), Located::Found(_)), "{raw:?}");
        }
    }

    /// Maakt een koppeling naar een map: eerst een symlink, en waar dat zonder
    /// rechten niet mag (Windows) een junction. `false` als geen van beide lukt.
    fn link_dir(target: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_dir(target, link).is_ok() {
                return true;
            }
            std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
        #[cfg(not(windows))]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
    }

    #[test]
    fn a_link_that_points_outside_is_refused() {
        let work = WorkDir::new("koppeling");
        let root = work.0.join("tekening");
        let buiten = work.0.join("buiten");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&buiten).unwrap();
        std::fs::write(buiten.join("elders.dwg"), b"x").unwrap();
        let link = root.join("uitweg");
        if !link_dir(&buiten, &link) {
            eprintln!("koppelingen kunnen hier niet gemaakt worden; test overgeslagen");
            return;
        }
        let paths = SearchPaths::new(Some(&root), &[]);
        assert_eq!(paths.locate("uitweg/elders.dwg", None, &KINDS), Located::Refused);
        // Dezelfde map uitdrukkelijk gekozen: dan mag het.
        let chosen = SearchPaths::new(Some(&root), &[buiten.clone()]);
        assert!(matches!(chosen.locate("uitweg/elders.dwg", None, &KINDS), Located::Found(_)));
        // Ook een koppeling naar één bestand (als het systeem die toestaat).
        let file_link = root.join("kopie.dwg");
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(buiten.join("elders.dwg"), &file_link).is_ok();
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(buiten.join("elders.dwg"), &file_link).is_ok();
        if linked {
            assert_eq!(paths.locate("kopie.dwg", None, &KINDS), Located::Refused);
            assert!(matches!(chosen.locate("kopie.dwg", None, &KINDS), Located::Found(_)));
            let _ = std::fs::remove_file(&file_link);
        }
        // De koppeling weghalen vóór het opruimen: de inhoud van het doel hoort
        // niet bij deze map.
        let _ = std::fs::remove_dir(&link);
    }

    #[test]
    fn the_folder_of_the_referring_file_counts_only_inside_a_chosen_folder() {
        let work = WorkDir::new("vanuit");
        let root = work.0.join("tekening");
        let sub = root.join("onderdelen");
        let buiten = work.0.join("buiten");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(&buiten).unwrap();
        std::fs::write(sub.join("detail.dxf"), b"x").unwrap();
        std::fs::write(buiten.join("elders.dxf"), b"x").unwrap();
        let paths = SearchPaths::new(Some(&root), &[]);
        let sub = sub.canonicalize().unwrap();
        assert_eq!(paths.locate("detail.dxf", None, &KINDS), Located::Missing, "niet in de map zelf");
        assert!(matches!(paths.locate("detail.dxf", Some(&sub), &KINDS), Located::Found(_)));
        let buiten = buiten.canonicalize().unwrap();
        assert_eq!(paths.locate("elders.dxf", Some(&buiten), &KINDS), Located::Missing, "een map van buiten telt niet");
    }

    #[test]
    fn the_list_of_outside_files_shows_names_only_and_is_bounded() {
        // Alleen de bestandsnaam, nooit de mappen ervoor; stuurtekens weg.
        assert_eq!(display_name("D:\\werk\\project\\gevel.dwg"), "gevel.dwg");
        assert_eq!(display_name("//server/deel/kaart.png"), "kaart.png");
        assert_eq!(display_name("../../elders/blad.dxf"), "blad.dxf");
        assert_eq!(display_name("map/NUL/"), "NUL");
        assert_eq!(display_name("https://elders/pad/foto.jpg?x=1"), "foto.jpg?x=1");
        assert_eq!(display_name("blad\u{0}\n.dwg"), "blad.dwg");
        assert_eq!(display_name("  "), "");
        let long = display_name(&format!("{}.dwg", "a".repeat(500)));
        assert_eq!(long.chars().count(), MAX_LISTED_NAME);
        assert!(long.ends_with('…'));

        let mut list = ExternalList::default();
        list.note("C:/project/gevel.dwg", ExternalKind::Xref, ExternalStatus::Loaded);
        list.note("gevel.dwg", ExternalKind::Xref, ExternalStatus::Loaded);
        list.note("gevel.dwg", ExternalKind::Xref, ExternalStatus::Missing);
        list.note("", ExternalKind::Image, ExternalStatus::Missing);
        assert_eq!(list.files().len(), 2, "hetzelfde bestand met dezelfde uitkomst staat er één keer");
        assert!(!list.truncated());
        for i in 0..MAX_LISTED_EXTERNALS + 10 {
            list.note(&format!("beeld-{i}.png"), ExternalKind::Image, ExternalStatus::Missing);
        }
        assert_eq!(list.files().len(), MAX_LISTED_EXTERNALS);
        assert!(list.truncated());
        // Samenvoegen houdt dezelfde grens aan.
        let mut other = ExternalList::default();
        other.note("los.png", ExternalKind::Image, ExternalStatus::Found);
        other.extend(&list);
        assert_eq!(other.files().len(), MAX_LISTED_EXTERNALS);
        assert!(other.truncated());
        assert_eq!(other.files()[0].name, "los.png");

        // In een volle lijst gaat wat gelezen of geweigerd is vóór wat alleen
        // niet gevonden is: daar is het verslag voor. (Gezien in de
        // testverzameling: 58 niet gevonden verwijzingen verdrongen vier
        // geweigerde netwerkpaden uit de lijst.)
        let mut full = ExternalList::default();
        for i in 0..MAX_LISTED_EXTERNALS + 8 {
            full.note(&format!("weg-{i}.dwg"), ExternalKind::Xref, ExternalStatus::Missing);
        }
        full.note("\\\\server\\deel\\foto.jpg", ExternalKind::Image, ExternalStatus::Refused);
        full.note("te-groot.png", ExternalKind::Image, ExternalStatus::TooLarge);
        full.note("gevel.dwg", ExternalKind::Xref, ExternalStatus::Loaded);
        assert_eq!(full.files().len(), MAX_LISTED_EXTERNALS);
        assert!(full.truncated());
        for (name, status) in [("foto.jpg", ExternalStatus::Refused), ("te-groot.png", ExternalStatus::TooLarge), ("gevel.dwg", ExternalStatus::Loaded)] {
            assert!(full.files().iter().any(|f| f.name == name && f.status == status), "{name} hoort in de lijst");
        }
        assert_eq!(full.files().iter().filter(|f| f.status == ExternalStatus::Missing).count(), MAX_LISTED_EXTERNALS - 3);
        // Een lijst vol gelezen bestanden wijkt niet voor een gemist bestand,
        // en ook niet voor nog een gelezen bestand.
        let mut read = ExternalList::default();
        for i in 0..MAX_LISTED_EXTERNALS {
            read.note(&format!("blad-{i}.dwg"), ExternalKind::Xref, ExternalStatus::Loaded);
        }
        read.note("weg.dwg", ExternalKind::Xref, ExternalStatus::Missing);
        read.note("extra.dwg", ExternalKind::Xref, ExternalStatus::Loaded);
        assert!(read.truncated() && read.files().iter().all(|f| f.name.starts_with("blad-")));
        // Samenvoegen volgt dezelfde regel.
        let mut merged = ExternalList::default();
        merged.extend(&full);
        let mut images = ExternalList::default();
        images.note("kaart.png", ExternalKind::Image, ExternalStatus::Loaded);
        merged.extend(&images);
        assert!(merged.files().iter().any(|f| f.name == "kaart.png"));
        assert_eq!(merged.files().len(), MAX_LISTED_EXTERNALS);
    }

    #[test]
    fn a_file_is_measured_and_read_through_one_open_handle() {
        let work = WorkDir::new("handle");
        let path = work.0.join("blad.dxf");
        std::fs::write(&path, vec![b'0'; 4096]).unwrap();
        let open = open_regular(&path).expect("gewoon bestand");
        assert_eq!(open.size(), 4096);
        // Het bestand groeit ná het meten: er komt niet meer binnen dan gemeten.
        {
            use std::io::Write;
            let mut grow = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            grow.write_all(&[b'1'; 4096]).unwrap();
        }
        assert!(open.read().is_none(), "groter dan gemeten wordt niet gelezen");
        let open = open_regular(&path).expect("gewoon bestand");
        assert_eq!(open.read().map(|d| d.len()), Some(8192));
        // Een map of iets dat niet bestaat is geen gewoon bestand.
        assert!(open_regular(&work.0).is_none());
        assert!(open_regular(&work.0.join("bestaat-niet.dxf")).is_none());
    }

    #[test]
    fn a_file_over_the_budget_is_not_read() {
        let work = WorkDir::new("begroting");
        std::fs::write(work.0.join("groot.dxf"), vec![b'0'; 4096]).unwrap();
        let mut host = CadDocument::new();
        let mut record = acadrust::tables::BlockRecord::new("GROOT");
        record.xref_path = "groot.dxf".into();
        record.flags.is_xref = true;
        host.block_records.add(record).unwrap();
        let paths = SearchPaths::new(Some(&work.0), &[]);
        let cancel = AtomicBool::new(false);
        let mut budget = 1000u64;
        let docs = XrefDocs::load(&host, None, &paths, &mut budget, &cancel);
        assert_eq!((docs.loaded(), docs.refused()), (0, 1), "past niet in de begroting");
        assert_eq!(budget, 1000, "en de begroting blijft staan");
        // Ruim genoeg: wat gelezen is gaat van de begroting af, ook als het
        // daarna geen leesbare tekening blijkt.
        let mut budget = 8192u64;
        let docs = XrefDocs::load(&host, None, &paths, &mut budget, &cancel);
        assert_eq!((docs.refused(), docs.missing()), (0, 1));
        assert_eq!(budget, 8192 - 4096);
    }
}
