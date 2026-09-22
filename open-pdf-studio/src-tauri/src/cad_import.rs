//! Tauri-commando's voor de import van DWG en DXF (#400).
//!
//! Dunne schil om de crate `open-pdf-cad`; alle logica zit daar. Wat hier wél
//! gebeurt is het bewaren van de ingelezen tekening: het venster verkent eerst
//! (lagen, ruimtes, grenzen) en zet daarna de import in gang, en een groot
//! bestand twee keer lezen zou seconden kosten. Er blijft er hooguit één in het
//! geheugen; `release_cad_import` laat hem los als het venster sluit.
//!
//! Verloop:
//! 1. `scan_cad_file` leest de tekening op een werkdraad en geeft de verkenning
//!    terug (en houdt de tekening vast onder pad + wijzigingstijd). Ook het
//!    lezen en verkennen melden hun voortgang als `cad-import-progress`.
//! 2. `import_cad_to_pdf` zet de gekozen ruimtes om naar één PDF; voortgang
//!    gaat als event `cad-import-progress` naar de webview, hooguit tien keer
//!    per seconde plus bij elke fasewissel.
//! 3. `cancel_cad_import` zet de afbreekvlag; er blijft geen half bestand staan
//!    (de crate schrijft naar een deelbestand en hernoemt pas aan het eind).
//! 4. `preview_cad_import` is dezelfde omzetting in voorbeeldstand, naar een
//!    bestand dat de schil zelf kiest in de cachemap van de app (voortgang als
//!    `cad-preview-progress`). `discard_cad_preview` en `release_cad_import`
//!    ruimen op wat deze sessie gemaakt heeft; bij het opstarten gaat weg wat
//!    van een vorige keer is blijven staan ([`sweep_previews`]).
//!
//! Zoekpaden voor externe verwijzingen en afbeeldingen komen uit het venster,
//! waar de gebruiker ze met het mapvenster van het systeem kiest. De schil
//! vertrouwt die tekst niet: alleen een absoluut pad dat na `canonicalize` een
//! bestaande map is, gaat door naar de omzetter ([`clean_search_paths`]). Wat
//! afvalt wordt niet gebruikt; `check_cad_search_paths` zegt het venster welke
//! dat zijn.

use open_pdf_cad::import::scan::DrawingScan;
use open_pdf_cad::import::xref::{ExternalFile, MAX_SEARCH_PATHS};
use open_pdf_cad::import::{Drawing, ImportArgs, ImportOptions, ImportPhase, ImportProgress, ImportResult};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::Emitter;

/// Lopende imports (afbreekvlag per `jobId`) en de laatst gelezen tekening.
/// Te klonen, zodat een werkdraad hem gewoon kan meenemen.
#[derive(Default, Clone)]
pub struct CadImportState {
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    cached: Arc<Mutex<Option<CachedDrawing>>>,
    /// Loopt op bij elke `release_cad_import`. Een lezing die al liep toen het
    /// venster sloot, legt zijn tekening daarna niet alsnog in het geheugen.
    generation: Arc<std::sync::atomic::AtomicU64>,
    /// Voorbeeld-PDF's die deze sessie gemaakt heeft. Alleen wat hier staat
    /// kan de webview laten weggooien.
    previews: Arc<Mutex<Vec<PathBuf>>>,
}

struct CachedDrawing {
    path: PathBuf,
    stamp: FileStamp,
    drawing: Arc<Drawing>,
}

/// Kenmerk van het bestand op schijf: wijzigingstijd én grootte. Een revisie
/// met dezelfde tijdstempel (kopiëren behoudt die soms) valt zo ook op.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
struct FileStamp {
    modified: Option<SystemTime>,
    size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    job_id: &'a str,
    phase: ImportPhase,
    done: u64,
    total: u64,
}

fn stamp_of(path: &Path) -> FileStamp {
    match std::fs::metadata(path) {
        Ok(meta) => FileStamp { modified: meta.modified().ok(), size: meta.len() },
        Err(_) => FileStamp::default(),
    }
}

impl CadImportState {
    fn cancel_flag(&self, job_id: &str) -> Result<Arc<AtomicBool>, String> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.jobs
            .lock()
            .map_err(|e| format!("CAD import jobs lock: {e}"))?
            .insert(job_id.to_string(), Arc::clone(&cancel));
        Ok(cancel)
    }

    fn done(&self, job_id: &str) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.remove(job_id);
        }
    }

    /// Zet de afbreekvlag van een lopende taak; false als die niet (meer) loopt.
    fn cancel(&self, job_id: &str) -> bool {
        match self.jobs.lock() {
            Ok(jobs) => match jobs.get(job_id) {
                Some(flag) => {
                    flag.store(true, Ordering::Relaxed);
                    true
                }
                None => false,
            },
            Err(_) => false,
        }
    }

    /// De tekening uit het geheugen, als het om hetzelfde, onveranderde
    /// bestand gaat.
    fn cached(&self, path: &Path) -> Option<Arc<Drawing>> {
        let cache = self.cached.lock().ok()?;
        let entry = cache.as_ref()?;
        (entry.path == path && entry.stamp == stamp_of(path)).then(|| Arc::clone(&entry.drawing))
    }

    /// Nummer van de huidige "ronde"; `release` verhoogt het.
    fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }

    /// Legt de tekening vast, tenzij het venster intussen losgelaten heeft.
    fn remember(&self, path: &Path, drawing: Arc<Drawing>, generation: u64) {
        if self.generation() != generation {
            return;
        }
        if let Ok(mut cache) = self.cached.lock() {
            *cache = Some(CachedDrawing { path: path.to_path_buf(), stamp: stamp_of(path), drawing });
        }
    }

    /// Laat de vastgehouden tekening los en ruimt de voorbeelden van deze
    /// sessie op; true als er een tekening was.
    fn release(&self) -> bool {
        self.generation.fetch_add(1, Ordering::Relaxed);
        self.discard_previews();
        match self.cached.lock() {
            Ok(mut cache) => cache.take().is_some(),
            Err(_) => false,
        }
    }

    fn note_preview(&self, path: &Path) {
        if let Ok(mut previews) = self.previews.lock() {
            previews.push(path.to_path_buf());
        }
    }

    /// Gooit één voorbeeld weg; alleen een bestand dat deze sessie zelf
    /// gemaakt heeft. Lukt het verwijderen niet (het bestand is nog in
    /// gebruik), dan blijft het onthouden voor de volgende poging.
    fn discard_preview(&self, path: &Path) -> bool {
        let Ok(mut previews) = self.previews.lock() else { return false };
        let Some(index) = previews.iter().position(|known| known == path) else { return false };
        if remove_preview(path) {
            previews.swap_remove(index);
            true
        } else {
            false
        }
    }

    /// Gooit alle voorbeelden van deze sessie weg; wat nog in gebruik is,
    /// blijft onthouden (en gaat anders weg bij de volgende start).
    fn discard_previews(&self) {
        if let Ok(mut previews) = self.previews.lock() {
            previews.retain(|path| !remove_preview(path));
        }
    }
}

/// Verwijdert een voorbeeldbestand; true als het daarna weg is.
fn remove_preview(path: &Path) -> bool {
    if !is_preview_file(path) {
        return false;
    }
    match std::fs::remove_file(path) {
        Ok(()) => true,
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    }
}

// ── Voorbeeldbestanden ───────────────────────────────────────────────────

/// Map voor voorbeeld-PDF's, binnen de cachemap van de app (per gebruiker).
pub fn preview_dir(app_cache_dir: &Path) -> PathBuf {
    app_cache_dir.join("cad-voorbeeld")
}

/// Map voor de PDF die een echte import maakt, naast de voorbeeldmap. De
/// webview stelde dat pad eerst zelf samen in de gedeelde tijdelijke map van
/// het systeem (op Linux `/tmp`, leesbaar voor elke lokale gebruiker); hier
/// is de map van de gebruiker zelf en op Unix 0700 (`make_private_dir`).
pub fn import_dir(app_cache_dir: &Path) -> PathBuf {
    app_cache_dir.join("cad-import")
}

/// De map waarin de import zijn voorbeeld-PDF's zet. Dit is de enige plek waar
/// de import een cache- of tijdelijke map kiest: het maken van een voorbeeld
/// (`preview_cad_import`) en het opruimen bij de start lopen er allebei
/// doorheen.
///
/// LET OP bij het samenvoegen met de isolatie van een losgekoppelde instantie:
/// de helper die per instantie een eigen datamap kiest, bestaat op deze tak
/// nog niet. Zodra die er is, hoort deze functie daarop over te stappen in
/// plaats van rechtstreeks `app_cache_dir()` te vragen. Anders schrijft en
/// veegt een geisoleerde instantie (de testopstelling, een tweede venster) in
/// de cachemap van de geinstalleerde app.
pub fn voorbeeldmap<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    use tauri::Manager;
    let cache = app.path().app_cache_dir().map_err(|e| format!("IMPORT_IO:{e}"))?;
    Ok(preview_dir(&cache))
}

/// De map waarin een echte import zijn PDF zet (zie [`import_dir`]); dezelfde
/// cachemap als de voorbeelden, dus dezelfde kanttekening als hierboven.
pub fn importmap<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    use tauri::Manager;
    let cache = app.path().app_cache_dir().map_err(|e| format!("IMPORT_IO:{e}"))?;
    Ok(import_dir(&cache))
}

const PREVIEW_PREFIX: &str = "voorbeeld-";

/// Bij het opstarten gaan voorbeelden weg die zo lang niet gewijzigd zijn. Een
/// dag: een voorbeeld leeft hooguit zo lang als het importvenster, maar een
/// andere, nog draaiende instantie van de app kan er net een gemaakt hebben.
pub const PREVIEW_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Heeft dit pad de naam van een voorbeeld (`voorbeeld-….pdf`)?
fn is_preview_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return false };
    name.starts_with(PREVIEW_PREFIX) && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

/// Een nieuwe, unieke naam in `dir`: tijd, proces, teller en een willekeurig
/// getal. Het bestand wordt hier niet aangemaakt; de omzetter schrijft naar
/// een deelbestand en weigert een doel dat al bestaat.
fn new_preview_path(dir: &Path) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let millis = SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let random: u32 = rand::random();
    dir.join(format!("{PREVIEW_PREFIX}{millis}-{}-{count}-{random:08x}.pdf", std::process::id()))
}

/// Maakt `dir` aan; op Unix alleen toegankelijk voor de gebruiker (0700).
fn make_private_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(dir)
    }
}

/// Verwijdert voorbeelden (`voorbeeld-….pdf`) die langer dan `older_than` niet
/// gewijzigd zijn. Alleen gewone bestanden met die naam; fouten worden
/// genegeerd (een bestand dat nog in gebruik is, komt de volgende keer).
pub fn sweep_previews(dir: &Path, older_than: Duration) {
    let Ok(items) = std::fs::read_dir(dir) else { return };
    let now = SystemTime::now();
    for item in items.flatten() {
        let path = item.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        let old = meta.modified().ok().and_then(|t| now.duration_since(t).ok()).is_some_and(|d| d > older_than);
        if meta.is_file() && old && is_preview_file(&path) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

// ── Zoekpaden ────────────────────────────────────────────────────────────

/// Langste zoekpad (in tekens) dat nog bekeken wordt.
const MAX_SEARCH_PATH_CHARS: usize = 1024;

/// Eén zoekpad uit de webview naar een map waar de omzetter mag zoeken, of
/// `None`. Geldig is alleen een absoluut pad zonder stuurtekens dat, nadat het
/// systeem het heeft opgelost (`canonicalize`: koppelingen en `..` zijn er dan
/// uit), een bestaande map is. Een relatief pad zou tegen de werkmap van het
/// proces worden opgelost, en die heeft niemand gekozen.
fn search_path_ok(raw: &str) -> Option<PathBuf> {
    let text = raw.trim();
    if text.is_empty() || text.chars().count() > MAX_SEARCH_PATH_CHARS || text.chars().any(char::is_control) {
        return None;
    }
    let path = Path::new(text);
    if !path.is_absolute() {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    canonical.is_dir().then_some(canonical)
}

/// De zoekpaden die doorgaan naar de omzetter: gecontroleerd, zonder dubbele
/// en hooguit [`MAX_SEARCH_PATHS`]. Raakt de schijf aan, dus alleen op een
/// werkdraad aanroepen.
fn clean_search_paths(raw: &[String]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for text in raw.iter().take(MAX_SEARCH_PATHS) {
        if let Some(path) = search_path_ok(text) {
            if !out.contains(&path) {
                out.push(path);
            }
        }
    }
    out
}

/// Per zoekpad of het gebruikt zou worden; voor het venster, dat een map die
/// niet (meer) bestaat zo kan aanwijzen.
fn check_search_paths(raw: &[String]) -> Vec<bool> {
    raw.iter().enumerate().map(|(index, text)| index < MAX_SEARCH_PATHS && search_path_ok(text).is_some()).collect()
}

/// De opties van een import: wat de argumenten zeggen, met de zoekpaden
/// gecontroleerd. Raakt de schijf aan (zie [`clean_search_paths`]).
fn options_for(args: &ImportArgs) -> ImportOptions {
    let mut options = args.options();
    options.search_paths = clean_search_paths(&args.search_paths);
    options
}

fn read_drawing(
    state: &CadImportState,
    path: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
) -> Result<Arc<Drawing>, String> {
    if let Some(drawing) = state.cached(path) {
        return Ok(drawing);
    }
    let generation = state.generation();
    let drawing = Arc::new(open_pdf_cad::import::read(path, cancel, |p| progress(p)).map_err(|e| e.to_string())?);
    state.remember(path, Arc::clone(&drawing), generation);
    Ok(drawing)
}

/// Verkenning op de huidige draad (het commando draait hem op een werkdraad).
/// `progress` krijgt de meldingen van het lezen (fase `read`; bij een grote
/// tekst-DXF met bytes geteld en totaal, anders onbepaald) en van het
/// verkennen (fase `scan`, geteld in ruimtes).
///
/// `search_paths` zijn de zoekpaden van de gebruiker (ongecontroleerd, zoals de
/// webview ze stuurt): de lijst van bestanden buiten de tekening zoekt dan ook
/// daar, zodat "gevonden" en "niet gevonden" kloppen met wat de import zal doen.
fn scan_blocking(
    state: &CadImportState,
    path: &Path,
    search_paths: &[String],
    cancel: &AtomicBool,
    mut progress: impl FnMut(ImportProgress),
) -> Result<DrawingScan, String> {
    let drawing = read_drawing(state, path, cancel, &mut progress)?;
    let search_paths = clean_search_paths(search_paths);
    open_pdf_cad::import::scan_drawing_with_paths(&drawing, &search_paths, cancel, progress).map_err(|e| e.to_string())
}

/// De bestanden buiten de tekening, opnieuw gezocht met andere zoekpaden.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalsReport {
    /// Alleen bestandsnamen, nooit paden; begrensd.
    pub externals: Vec<ExternalFile>,
    pub externals_truncated: bool,
}

/// Alleen het zoeken, zonder de rest van de verkenning: de tekening komt uit
/// het geheugen (of wordt gelezen als ze daar niet meer staat).
fn locate_blocking(
    state: &CadImportState,
    path: &Path,
    search_paths: &[String],
    cancel: &AtomicBool,
) -> Result<ExternalsReport, String> {
    let drawing = read_drawing(state, path, cancel, &mut |_| {})?;
    let search_paths = clean_search_paths(search_paths);
    let (externals, externals_truncated) = open_pdf_cad::import::locate_externals(&drawing, &search_paths, cancel);
    if cancel.load(Ordering::Relaxed) {
        return Err(open_pdf_cad::import::ImportError::Cancelled.to_string());
    }
    Ok(ExternalsReport { externals, externals_truncated })
}

/// Omzetting op de huidige draad; `progress` krijgt elke melding van de crate.
fn import_blocking(
    state: &CadImportState,
    args: &ImportArgs,
    cancel: &AtomicBool,
    mut progress: impl FnMut(ImportProgress),
) -> Result<ImportResult, String> {
    let output = PathBuf::from(&args.output_path);
    if output.as_os_str().is_empty() {
        return Err("Geen uitvoerbestand opgegeven".into());
    }
    // De voorbeeldstand laat bij een zware tekening inhoud weg. Dat mag alleen
    // in het voorbeeld (`preview_cad_import`, dat zijn eigen bestand kiest en
    // het als voorbeeld merkt): een echte import is altijd volledig.
    if args.preview == Some(true) {
        return Err("IMPORT_PREVIEW_ONLY".into());
    }
    let drawing = read_drawing(state, Path::new(&args.path), cancel, &mut progress)?;
    open_pdf_cad::import::convert(&drawing, &options_for(args), &output, cancel, progress).map_err(|e| e.to_string())
}

/// Voorbeeldomzetting op de huidige draad. Hetzelfde pad als een echte import,
/// maar altijd in voorbeeldstand (een zware tekening zonder arceringen, tekst
/// en maatvoering, zodat het venster snel iets laat zien) en naar een bestand
/// dat de schil zelf kiest in `dir`: het uitvoerpad van de aanroeper doet niet
/// mee. Werkgrenzen en afbreekvlag gelden onverkort; bij een fout of afbreken
/// blijft er niets staan.
fn preview_blocking(
    state: &CadImportState,
    args: &ImportArgs,
    dir: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(ImportProgress),
) -> Result<ImportResult, String> {
    let drawing = read_drawing(state, Path::new(&args.path), cancel, &mut progress)?;
    let mut options = options_for(args);
    options.preview = true;
    make_private_dir(dir).map_err(|e| format!("IMPORT_IO:{e}"))?;
    let output = new_preview_path(dir);
    let result = open_pdf_cad::import::convert(&drawing, &options, &output, cancel, progress).map_err(|e| e.to_string())?;
    state.note_preview(&output);
    Ok(result)
}

/// Grenzen van de omzetter, zodat het venster dezelfde getallen toont als de
/// crate hanteert.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLimits {
    /// Boven dit aantal entiteiten wordt een voorbeeld vereenvoudigd.
    pub preview_simple_above: u64,
    /// Hoogste aantal beeldpunten per ingesloten afbeelding (alleen te verlagen).
    pub max_image_pixels: u64,
    /// Hoogste aantal (ingepakte) bytes aan afbeeldingen in één import.
    pub max_image_total_bytes: u64,
    /// Hoogste aantal externe verwijzingen per import.
    pub max_xref_files: usize,
    /// Hoogste aantal bestanden van buiten dat een verslag bij naam noemt.
    pub max_listed_externals: usize,
    /// Hoogste aantal zoekpaden.
    pub max_search_paths: usize,
    /// Hoogste aantal regels in de kleurentabel en in de lettertabel.
    pub max_pens: usize,
    pub max_font_rules: usize,
}

fn limits() -> ImportLimits {
    ImportLimits {
        preview_simple_above: open_pdf_cad::import::PREVIEW_SIMPLE_ABOVE,
        max_image_pixels: open_pdf_cad::import::image::MAX_IMAGE_PIXELS,
        max_image_total_bytes: open_pdf_cad::import::image::MAX_IMAGE_TOTAL_BYTES,
        max_xref_files: open_pdf_cad::import::xref::MAX_XREF_FILES,
        max_listed_externals: open_pdf_cad::import::xref::MAX_LISTED_EXTERNALS,
        max_search_paths: MAX_SEARCH_PATHS,
        max_pens: open_pdf_cad::import::style::MAX_PENS,
        max_font_rules: open_pdf_cad::import::text::MAX_FONT_RULES,
    }
}

/// Een lijst zoekpaden uit de webview die langer is dan de grens wordt
/// geweigerd met dezelfde vaste fout als de lijsten in `ImportArgs`.
fn bounded_search_paths(search_paths: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let search_paths = search_paths.unwrap_or_default();
    if search_paths.len() > MAX_SEARCH_PATHS {
        return Err(format!("IMPORT_ARGS_TOO_LONG:searchPaths:{MAX_SEARCH_PATHS}"));
    }
    Ok(search_paths)
}

/// Dunt de voortgang uit: altijd bij een nieuwe fase, verder hooguit eens per
/// `interval`. De webview hoeft geen tienduizenden events te verwerken.
struct Throttle {
    interval: Duration,
    last_emit: Option<Instant>,
    last_phase: Option<ImportPhase>,
}

impl Throttle {
    fn new(interval: Duration) -> Self {
        Throttle { interval, last_emit: None, last_phase: None }
    }

    fn should_emit(&mut self, phase: ImportPhase, now: Instant) -> bool {
        let due = self.last_phase != Some(phase) || self.last_emit.map_or(true, |t| now.duration_since(t) >= self.interval);
        if due {
            self.last_phase = Some(phase);
            self.last_emit = Some(now);
        }
        due
    }
}

/// Leest een DWG of DXF en geeft de verkenning voor het importvenster:
/// lagen met hun status en aantallen, ruimtes (modelruimte en layouts) met
/// grenzen, papier en viewports, de eenheid, lettertypen en waarschuwingen.
///
/// Voortgang gaat als event `cad-import-progress` naar de webview, net als bij
/// de import: de fase, en geteld/totaal waar dat bekend is.
///
/// `search_paths` (JS: `searchPaths`, optioneel) zijn de mappen die de
/// gebruiker gekozen heeft om verwijzingen en afbeeldingen in te zoeken; ze
/// worden hier gecontroleerd en tellen alleen mee voor de lijst `externals`.
#[tauri::command]
pub async fn scan_cad_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, CadImportState>,
    job_id: String,
    path: String,
    search_paths: Option<Vec<String>>,
) -> Result<DrawingScan, String> {
    let search_paths = bounded_search_paths(search_paths)?;
    let cancel = state.cancel_flag(&job_id)?;
    let path = PathBuf::from(path);
    let result = tauri::async_runtime::spawn_blocking({
        let state = state.inner().clone();
        let job_id = job_id.clone();
        let cancel = Arc::clone(&cancel);
        move || {
            let mut throttle = Throttle::new(Duration::from_millis(100));
            scan_blocking(&state, &path, &search_paths, &cancel, |p: ImportProgress| {
                if throttle.should_emit(p.phase, Instant::now()) {
                    let _ = app.emit(
                        "cad-import-progress",
                        ProgressEvent { job_id: &job_id, phase: p.phase, done: p.done, total: p.total },
                    );
                }
            })
        }
    })
    .await
    .map_err(|e| format!("CAD scan task panicked: {e}"));
    state.done(&job_id);
    result?
}

/// Zet een DWG of DXF om naar een PDF. De argumenten (camelCase) staan
/// beschreven bij `open_pdf_cad::ImportArgs`.
#[tauri::command]
pub async fn import_cad_to_pdf(
    app: tauri::AppHandle,
    state: tauri::State<'_, CadImportState>,
    job_id: String,
    args: ImportArgs,
) -> Result<ImportResult, String> {
    let cancel = state.cancel_flag(&job_id)?;
    let result = tauri::async_runtime::spawn_blocking({
        let state = state.inner().clone();
        let job_id = job_id.clone();
        let cancel = Arc::clone(&cancel);
        move || {
            let mut throttle = Throttle::new(Duration::from_millis(100));
            import_blocking(&state, &args, &cancel, |p: ImportProgress| {
                if throttle.should_emit(p.phase, Instant::now()) {
                    let _ = app.emit(
                        "cad-import-progress",
                        ProgressEvent { job_id: &job_id, phase: p.phase, done: p.done, total: p.total },
                    );
                }
            })
        }
    })
    .await
    .map_err(|e| format!("CAD import task panicked: {e}"));
    state.done(&job_id);
    result?
}

/// Zoekt opnieuw naar de bestanden buiten de tekening (externe verwijzingen en
/// afbeeldingen), met de zoekpaden zoals ze nu in het venster staan. Er wordt
/// niets gelezen en de tekening komt uit het geheugen: dit is wat het venster
/// aanroept als de gebruiker een zoekpad toevoegt of weghaalt.
#[tauri::command]
pub async fn locate_cad_externals(
    state: tauri::State<'_, CadImportState>,
    job_id: String,
    path: String,
    search_paths: Option<Vec<String>>,
) -> Result<ExternalsReport, String> {
    let search_paths = bounded_search_paths(search_paths)?;
    let cancel = state.cancel_flag(&job_id)?;
    let path = PathBuf::from(path);
    let result = tauri::async_runtime::spawn_blocking({
        let state = state.inner().clone();
        let cancel = Arc::clone(&cancel);
        move || locate_blocking(&state, &path, &search_paths, &cancel)
    })
    .await
    .map_err(|e| format!("CAD externals task panicked: {e}"));
    state.done(&job_id);
    result?
}

/// Zegt per zoekpad of de omzetter het zou gebruiken (een absoluut pad naar
/// een bestaande map, binnen het hoogste aantal). Het venster wijst zo een map
/// aan die niet (meer) bestaat.
#[tauri::command]
pub async fn check_cad_search_paths(paths: Vec<String>) -> Result<Vec<bool>, String> {
    // Een lijst die te lang is, wordt niet nagekeken: alles telt als ongeldig.
    if paths.len() > 4 * MAX_SEARCH_PATHS {
        return Ok(vec![false; paths.len()]);
    }
    tauri::async_runtime::spawn_blocking(move || check_search_paths(&paths))
        .await
        .map_err(|e| format!("CAD search path task panicked: {e}"))
}

/// Zet de tekening om naar een tijdelijke PDF voor de voorbeeldweergave van
/// het importvenster. Zelfde argumenten als `import_cad_to_pdf`, op het
/// uitvoerpad na: het bestand komt met een unieke naam in de cachemap van de
/// app en het pad staat in het verslag (`outputPath`). De voorbeeldmap zelf
/// (niet elk bestand apart) komt in de fs-scope zodat de webview het kan
/// tonen: een toestemming per bestand blijft na het weggooien van dat
/// bestand voor altijd in de scope staan en de lijst groeit met elke
/// debounce-ronde; een toestemming voor de map is één regel die niet groeit,
/// en een weggegooid voorbeeld is er dan gewoon niet meer. Voortgang komt als
/// event `cad-preview-progress`, zodat een lopend voorbeeld de balk van een
/// echte import niet verstoort; afbreken gaat met `cancel_cad_import`.
#[tauri::command]
pub async fn preview_cad_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, CadImportState>,
    job_id: String,
    args: ImportArgs,
) -> Result<ImportResult, String> {
    use tauri_plugin_fs::FsExt;
    let dir = voorbeeldmap(&app)?;
    let cancel = state.cancel_flag(&job_id)?;
    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let state = state.inner().clone();
        let job_id = job_id.clone();
        let cancel = Arc::clone(&cancel);
        let dir = dir.clone();
        move || {
            let mut throttle = Throttle::new(Duration::from_millis(150));
            preview_blocking(&state, &args, &dir, &cancel, |p: ImportProgress| {
                if throttle.should_emit(p.phase, Instant::now()) {
                    let _ = app.emit(
                        "cad-preview-progress",
                        ProgressEvent { job_id: &job_id, phase: p.phase, done: p.done, total: p.total },
                    );
                }
            })
        }
    })
    .await
    .map_err(|e| format!("CAD preview task panicked: {e}"));
    state.done(&job_id);
    let result = result??;
    let _ = app.fs_scope().allow_directory(&dir, false);
    Ok(result)
}

/// De afgeschermde map waarin de webview de PDF van een import laat schrijven
/// (zie [`import_dir`]): aangemaakt als ze er nog niet is, en als map in de
/// fs-scope gezet zodat de webview het bestand daarna kan lezen, verplaatsen
/// en opruimen. Geeft het pad als tekst.
#[tauri::command]
pub async fn cad_import_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_fs::FsExt;
    let dir = importmap(&app)?;
    let made = tauri::async_runtime::spawn_blocking({
        let dir = dir.clone();
        move || make_private_dir(&dir).map_err(|e| format!("IMPORT_IO:{e}"))
    })
    .await
    .map_err(|e| format!("CAD import dir task panicked: {e}"));
    made??;
    let _ = app.fs_scope().allow_directory(&dir, false);
    dir.to_str().map(str::to_owned).ok_or_else(|| "IMPORT_IO:import dir is not valid UTF-8".to_string())
}

/// Gooit een voorbeeld weg dat `preview_cad_import` eerder maakte (het venster
/// heeft een nieuwer voorbeeld). Alleen bestanden van deze sessie; false als
/// het pad daar niet bij hoort of het bestand nog in gebruik is.
#[tauri::command]
pub async fn discard_cad_preview(state: tauri::State<'_, CadImportState>, path: String) -> Result<bool, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.discard_preview(Path::new(&path)))
        .await
        .map_err(|e| format!("CAD preview cleanup task panicked: {e}"))
}

/// De grenzen die de omzetter hanteert.
#[tauri::command]
pub fn cad_import_limits() -> ImportLimits {
    limits()
}

/// Vraagt een lopende verkenning of import om te stoppen.
#[tauri::command]
pub fn cancel_cad_import(state: tauri::State<'_, CadImportState>, job_id: String) -> bool {
    state.cancel(&job_id)
}

/// Laat de vastgehouden tekening los en ruimt de voorbeelden van deze sessie
/// op (het importvenster sluit).
#[tauri::command]
pub fn release_cad_import(state: tauri::State<'_, CadImportState>) -> bool {
    state.release()
}

#[cfg(test)]
mod tests {
    use super::*;
    use open_pdf_cad::geom::Point;
    use open_pdf_cad::model::{Drawing as CadModel, Entity, Geometry, Layer, Rgb};
    use open_pdf_cad::{CadFormat, CadVersion, DrawingUnit};

    fn work_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("opds-cad-import-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Een DXF met een rechthoek van `width` × 5000 mm op laag "Wanden".
    fn sample_dxf(dir: &Path, name: &str, width: f64) -> PathBuf {
        let model = CadModel {
            layers: vec![Layer { name: "Wanden".into(), color: Rgb { r: 0, g: 0, b: 0 }, lineweight: 25, from_ocg: true }],
            linetypes: Vec::new(),
            entities: vec![
                Entity {
                    layer: 0,
                    color: None,
                    lineweight: None,
                    linetype: None,
                    geometry: Geometry::Polyline {
                        points: vec![Point::new(0.0, 0.0), Point::new(width, 0.0), Point::new(width, 5000.0), Point::new(0.0, 5000.0)],
                        closed: true,
                    },
                },
                Entity {
                    layer: 0,
                    color: None,
                    lineweight: None,
                    linetype: None,
                    geometry: Geometry::Line { start: Point::new(0.0, 0.0), end: Point::new(width, 5000.0) },
                },
            ],
            page_size: (width, 5000.0),
            extents: Some((Point::new(0.0, 0.0), Point::new(width, 5000.0))),
            units: DrawingUnit::Mm,
        };
        let path = dir.join(name);
        open_pdf_cad::writer::write_drawing(model, CadFormat::Dxf, CadVersion::R2013, &path).unwrap();
        path
    }

    /// Een hoofdtekening (kale tekst-DXF) met één lijn en een externe
    /// verwijzing `GEVEL` naar `target`, ingevoegd op de oorsprong.
    fn host_with_xref(dir: &Path, name: &str, target: &str) -> PathBuf {
        let pairs = [
            "0", "SECTION", "2", "BLOCKS", "0", "BLOCK", "8", "0", "2", "GEVEL", "70", "4", "10", "0.0", "20", "0.0", "30",
            "0.0", "3", "GEVEL", "1", target, "0", "ENDBLK", "8", "0", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0",
            "LINE", "8", "0", "10", "0.0", "20", "0.0", "30", "0.0", "11", "1000.0", "21", "0.0", "31", "0.0", "0", "INSERT",
            "8", "0", "2", "GEVEL", "10", "0.0", "20", "0.0", "30", "0.0", "0", "ENDSEC", "0", "EOF",
        ];
        let path = dir.join(name);
        std::fs::write(&path, pairs.join("
") + "
").unwrap();
        path
    }

    fn args(path: &Path, output: &Path) -> ImportArgs {
        ImportArgs {
            path: path.to_string_lossy().to_string(),
            output_path: output.to_string_lossy().to_string(),
            scale: Some(100.0),
            ..Default::default()
        }
    }

    #[test]
    fn the_scanned_drawing_is_reused_until_the_file_changes_or_is_released() {
        let dir = work_dir("cache");
        let dxf = sample_dxf(&dir, "a.dxf", 10000.0);
        let state = CadImportState::default();
        let cancel = AtomicBool::new(false);

        let scan = scan_blocking(&state, &dxf, &[], &cancel, |_| {}).unwrap();
        assert!(scan.layers.iter().any(|l| l.name == "Wanden"));
        let first = state.cached(&dxf).expect("na de verkenning vastgehouden");
        let again = read_drawing(&state, &dxf, &cancel, &mut |_| {}).unwrap();
        assert!(Arc::ptr_eq(&first, &again), "tweede keer niet uit het geheugen");
        assert!(state.cached(&dir.join("ander.dxf")).is_none(), "ander pad mag niet raken");

        // Het bestand verandert (nieuwe revisie): opnieuw lezen. Ook als de
        // wijzigingstijd gelijk blijft, want de grootte hoort bij de sleutel.
        let stamp = stamp_of(&dxf);
        sample_dxf(&dir, "a.dxf", 12345.6789);
        if let Some(modified) = stamp.modified {
            std::fs::File::options().write(true).open(&dxf).unwrap().set_modified(modified).unwrap();
        }
        assert_eq!(stamp_of(&dxf).modified, stamp.modified, "tijdstempel teruggezet");
        assert_ne!(stamp_of(&dxf).size, stamp.size, "grootte wel veranderd");
        assert!(state.cached(&dxf).is_none(), "gewijzigd bestand komt uit het geheugen");
        let fresh = read_drawing(&state, &dxf, &cancel, &mut |_| {}).unwrap();
        assert!(!Arc::ptr_eq(&first, &fresh));

        assert!(state.release());
        assert!(!state.release(), "twee keer loslaten");
        assert!(state.cached(&dxf).is_none());
    }

    #[test]
    fn scanning_reports_reading_and_then_the_spaces() {
        let dir = work_dir("scan-voortgang");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let state = CadImportState::default();
        let mut seen: Vec<ImportProgress> = Vec::new();
        let scan = scan_blocking(&state, &dxf, &[], &AtomicBool::new(false), |p| seen.push(p)).unwrap();
        let phases: Vec<ImportPhase> = seen.iter().map(|p| p.phase).collect();
        assert_eq!(phases.first(), Some(&ImportPhase::Read), "{phases:?}");
        let first_scan = phases.iter().position(|p| *p == ImportPhase::Scan).expect("geen fase verkennen");
        assert!(phases[first_scan..].iter().all(|p| *p == ImportPhase::Scan), "na het lezen alleen nog verkennen: {phases:?}");
        let last = seen.last().unwrap();
        assert_eq!((last.done, last.total), (scan.spaces.len() as u64, scan.spaces.len() as u64));

        // Tweede keer komt de tekening uit het geheugen: geen leesfase meer.
        let mut again: Vec<ImportPhase> = Vec::new();
        scan_blocking(&state, &dxf, &[], &AtomicBool::new(false), |p| again.push(p.phase)).unwrap();
        assert!(again.iter().all(|p| *p == ImportPhase::Scan), "{again:?}");
    }

    #[test]
    fn import_writes_the_pdf_and_reports_progress() {
        let dir = work_dir("import");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let state = CadImportState::default();
        let cancel = AtomicBool::new(false);
        scan_blocking(&state, &dxf, &[], &cancel, |_| {}).unwrap();
        let pdf = dir.join("plan.pdf");
        let mut phases = Vec::new();
        let result = import_blocking(&state, &args(&dxf, &pdf), &cancel, |p| phases.push(p.phase)).unwrap();
        assert_eq!(result.pages.len(), 1);
        assert_eq!(result.pages[0].scale_text, "1:100");
        assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF-"));
        assert!(phases.contains(&ImportPhase::Write), "geen voortgang voor het schrijven: {phases:?}");
    }

    #[test]
    fn a_cancelled_import_reports_the_fixed_code_and_writes_nothing() {
        let dir = work_dir("cancel");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let state = CadImportState::default();
        let pdf = dir.join("plan.pdf");
        let error = import_blocking(&state, &args(&dxf, &pdf), &AtomicBool::new(true), |_| {}).unwrap_err();
        assert_eq!(error, "IMPORT_CANCELLED");
        assert!(!pdf.exists() && !dir.join("plan.deel").exists());
    }

    #[test]
    fn import_without_output_path_is_refused() {
        let state = CadImportState::default();
        let args = ImportArgs { path: "x.dxf".into(), ..Default::default() };
        assert!(import_blocking(&state, &args, &AtomicBool::new(false), |_| {}).is_err());
    }

    #[test]
    fn unreadable_or_missing_files_give_the_fixed_codes() {
        let dir = work_dir("kapot");
        let bad = dir.join("kapot.dxf");
        std::fs::write(&bad, b"geen tekening").unwrap();
        let error = scan_blocking(&CadImportState::default(), &bad, &[], &AtomicBool::new(false), |_| {}).unwrap_err();
        assert!(error.starts_with("IMPORT_READ:"), "{error}");
        let missing = scan_blocking(&CadImportState::default(), &dir.join("weg.dwg"), &[], &AtomicBool::new(false), |_| {}).unwrap_err();
        assert!(missing.starts_with("IMPORT_IO:"), "{missing}");
    }

    #[test]
    fn a_read_that_finishes_after_closing_does_not_fill_the_cache_again() {
        let dir = work_dir("race");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let state = CadImportState::default();
        // Het venster sluit terwijl de lezing loopt: generatie loopt op.
        let generation = state.generation();
        state.release();
        let drawing = Arc::new(open_pdf_cad::import::read(&dxf, &AtomicBool::new(false), |_| {}).unwrap());
        state.remember(&dxf, drawing, generation);
        assert!(state.cached(&dxf).is_none(), "tekening na het sluiten toch vastgehouden");
        // Een nieuwe ronde legt hem wel vast.
        let generation = state.generation();
        let drawing = Arc::new(open_pdf_cad::import::read(&dxf, &AtomicBool::new(false), |_| {}).unwrap());
        state.remember(&dxf, drawing, generation);
        assert!(state.cached(&dxf).is_some());
    }

    #[test]
    fn a_too_complex_drawing_reports_the_fixed_code() {
        let dir = work_dir("complex");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let state = CadImportState::default();
        let mut args = args(&dxf, &dir.join("plan.pdf"));
        args.max_visits = Some(1);
        let error = import_blocking(&state, &args, &AtomicBool::new(false), |_| {}).unwrap_err();
        assert_eq!(error, "IMPORT_TOO_COMPLEX");
    }

    #[test]
    fn an_existing_output_and_a_bad_window_report_their_own_codes() {
        let dir = work_dir("codes");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let state = CadImportState::default();
        let taken = dir.join("bezet.pdf");
        std::fs::write(&taken, b"van de gebruiker").unwrap();
        let error = import_blocking(&state, &args(&dxf, &taken), &AtomicBool::new(false), |_| {}).unwrap_err();
        assert_eq!(error, format!("IMPORT_EXISTS:{}", taken.display()));
        assert_eq!(std::fs::read(&taken).unwrap(), b"van de gebruiker");

        let mut window = args(&dxf, &dir.join("venster.pdf"));
        window.area = Some("window".into());
        window.window = Some([10.0, 10.0, 10.0, 50.0]);
        let error = import_blocking(&state, &window, &AtomicBool::new(false), |_| {}).unwrap_err();
        assert_eq!(error, "IMPORT_WINDOW_INVALID");
    }

    #[test]
    fn a_real_import_refuses_the_preview_mode() {
        let dir = work_dir("geen-voorbeeld");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let out = dir.join("uit.pdf");
        let state = CadImportState::default();
        let mut request = args(&dxf, &out);
        request.preview = Some(true);
        let error = import_blocking(&state, &request, &AtomicBool::new(false), |_| {}).unwrap_err();
        assert_eq!(error, "IMPORT_PREVIEW_ONLY");
        assert!(!out.exists(), "er is niets geschreven");
        // Uit of niet genoemd: een gewone import.
        for preview in [Some(false), None] {
            request.preview = preview;
            let _ = std::fs::remove_file(&out);
            import_blocking(&state, &request, &AtomicBool::new(false), |_| {}).unwrap();
            assert!(out.exists());
        }
    }

    #[test]
    fn a_preview_runs_in_preview_mode_and_writes_into_its_own_folder() {
        let dir = work_dir("voorbeeld");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let previews = preview_dir(&dir.join("cache"));
        let state = CadImportState::default();
        let cancel = AtomicBool::new(false);
        // De aanroeper zet "preview" niet en geeft een eigen uitvoerpad mee:
        // het commando bepaalt beide zelf.
        let elsewhere = dir.join("elders.pdf");
        let mut request = args(&dxf, &elsewhere);
        request.preview = None;
        let mut phases = Vec::new();
        let first = preview_blocking(&state, &request, &previews, &cancel, |p| phases.push(p.phase)).unwrap();
        assert_eq!(first.pages.len(), 1);
        assert!(!first.simplified, "een kleine tekening blijft volledig");
        assert!(phases.contains(&ImportPhase::Write), "{phases:?}");
        assert!(!elsewhere.exists(), "het pad van de aanroeper wordt niet gebruikt");
        let written = PathBuf::from(&first.output_path);
        assert_eq!(written.parent(), Some(previews.as_path()));
        assert!(is_preview_file(&written), "{written:?}");
        assert!(std::fs::read(&written).unwrap().starts_with(b"%PDF-"));

        // Een tweede voorbeeld krijgt een eigen naam; het eerste blijft staan
        // tot het venster het loslaat.
        let second = preview_blocking(&state, &request, &previews, &cancel, |_| {}).unwrap();
        assert_ne!(second.output_path, first.output_path);
        assert!(written.exists());

        // Loslaten ruimt alleen op wat deze sessie zelf gemaakt heeft.
        let foreign = previews.join("voorbeeld-van-een-ander.pdf");
        std::fs::write(&foreign, b"%PDF-").unwrap();
        assert!(!state.discard_preview(&foreign), "niet van deze sessie");
        assert!(!state.discard_preview(&dxf), "geen voorbeeld");
        assert!(state.discard_preview(&written));
        assert!(!written.exists());
        assert!(!state.discard_preview(&written), "twee keer weggooien");
        state.release();
        assert!(!PathBuf::from(&second.output_path).exists(), "loslaten ruimt de rest op");
        assert!(foreign.exists() && dxf.exists());
    }

    #[test]
    fn the_import_folder_sits_next_to_the_preview_folder_and_is_private() {
        let cache = work_dir("importmap").join("cache");
        let imports = import_dir(&cache);
        assert_eq!(imports.parent(), preview_dir(&cache).parent());
        assert_ne!(imports, preview_dir(&cache));
        make_private_dir(&imports).unwrap();
        assert!(imports.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&imports).unwrap().permissions().mode() & 0o777, 0o700);
        }
    }

    #[test]
    fn a_cancelled_or_failed_preview_leaves_nothing_behind() {
        let dir = work_dir("voorbeeld-afbreken");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let previews = preview_dir(&dir.join("cache"));
        let state = CadImportState::default();
        let request = args(&dxf, &dir.join("x.pdf"));
        let error = preview_blocking(&state, &request, &previews, &AtomicBool::new(true), |_| {}).unwrap_err();
        assert_eq!(error, "IMPORT_CANCELLED");
        let mut tight = request.clone();
        tight.max_visits = Some(1);
        let error = preview_blocking(&state, &tight, &previews, &AtomicBool::new(false), |_| {}).unwrap_err();
        assert_eq!(error, "IMPORT_TOO_COMPLEX", "de voorbeeldstand heeft geen ruimere grenzen");
        let left: Vec<_> = std::fs::read_dir(&previews).map(|d| d.flatten().collect()).unwrap_or_default();
        assert!(left.is_empty(), "{left:?}");
        assert!(state.previews.lock().unwrap().is_empty());
    }

    #[test]
    fn old_previews_are_swept_at_start_and_nothing_else() {
        let dir = work_dir("voorbeeld-opruimen");
        let previews = preview_dir(&dir);
        std::fs::create_dir_all(&previews).unwrap();
        let old = new_preview_path(&previews);
        let fresh = new_preview_path(&previews);
        let other = previews.join("notities.pdf");
        let nested = previews.join("voorbeeld-map.pdf");
        for file in [&old, &fresh, &other] {
            std::fs::write(file, b"%PDF-").unwrap();
        }
        std::fs::create_dir_all(&nested).unwrap();
        let long_ago = SystemTime::now() - Duration::from_secs(3 * 24 * 60 * 60);
        for file in [&old, &other] {
            std::fs::File::options().write(true).open(file).unwrap().set_modified(long_ago).unwrap();
        }
        sweep_previews(&previews, PREVIEW_MAX_AGE);
        assert!(!old.exists(), "een oud voorbeeld gaat weg");
        assert!(fresh.exists(), "een voorbeeld van nu kan van een andere, draaiende instantie zijn");
        assert!(other.exists(), "alleen bestanden met de naam van een voorbeeld");
        assert!(nested.is_dir(), "mappen blijven ongemoeid");
        // Een map die niet bestaat is geen fout.
        sweep_previews(&dir.join("bestaat-niet"), Duration::ZERO);
    }

    #[test]
    fn the_limits_are_the_ones_from_the_converter() {
        let limits = limits();
        assert_eq!(limits.preview_simple_above, open_pdf_cad::import::PREVIEW_SIMPLE_ABOVE);
        assert_eq!(limits.max_image_pixels, open_pdf_cad::import::image::MAX_IMAGE_PIXELS);
        assert_eq!(limits.max_image_total_bytes, open_pdf_cad::import::image::MAX_IMAGE_TOTAL_BYTES);
        assert_eq!(limits.max_xref_files, open_pdf_cad::import::xref::MAX_XREF_FILES);
        assert_eq!(limits.max_listed_externals, open_pdf_cad::import::xref::MAX_LISTED_EXTERNALS);
        assert_eq!(limits.max_search_paths, open_pdf_cad::import::xref::MAX_SEARCH_PATHS);
        let json = serde_json::to_value(limits).unwrap();
        assert!(json.get("previewSimpleAbove").is_some() && json.get("maxSearchPaths").is_some(), "{json}");
    }

    #[test]
    fn the_new_display_arguments_reach_the_options() {
        let args: ImportArgs = serde_json::from_str(
            r##"{"path":"a.dxf","outputPath":"a.pdf","lineweight":"pens",
                "pens":[{"color":"#00FF00","lineweightMm":0.5}],
                "xrefs":false,"images":false,"maxImagePixels":1000000,"reuseBlocks":false,
                "colors":"mono","monoThreshold":70,
                "fonts":[{"from":"romans.shx","family":"mono","bold":true,"italic":false}]}"##,
        )
        .unwrap();
        let options = options_for(&args);
        assert!(!options.xrefs && !options.images && !options.reuse_blocks && !options.preview);
        assert_eq!(options.max_image_pixels, 1_000_000);
        assert_eq!(options.lineweight, open_pdf_cad::import::style::LineweightMode::Pens);
        assert_eq!(options.pens.width_mm((0, 255, 0)), Some(0.5));
        assert_eq!(options.color_mode, open_pdf_cad::import::style::ColorMode::Mono { threshold_pct: 70 });
        assert_eq!(
            options.fonts.choose("romans.shx", ""),
            open_pdf_cad::import::text::FontChoice {
                family: open_pdf_cad::import::text::FontFamily::Mono,
                italic: false,
                bold: true
            }
        );
        // Te lange lijsten komen niet eens binnen.
        let rows: Vec<String> = (0..2000).map(|i| format!(r##"{{"color":"#{i:06X}","lineweightMm":0.2}}"##)).collect();
        let error = serde_json::from_str::<ImportArgs>(&format!(r#"{{"path":"a.dxf","pens":[{}]}}"#, rows.join(",")))
            .unwrap_err()
            .to_string();
        assert!(error.contains("IMPORT_ARGS_TOO_LONG:pens"), "{error}");
    }

    #[test]
    fn only_existing_folders_survive_as_search_paths() {
        let dir = work_dir("zoekpaden");
        let folder = dir.join("verwijzingen");
        std::fs::create_dir_all(&folder).unwrap();
        let file = dir.join("los.txt");
        std::fs::write(&file, b"geen map").unwrap();
        let text = |p: &Path| p.to_string_lossy().to_string();
        let raw = vec![
            text(&folder),
            "   ".to_string(),
            text(&dir.join("bestaat-niet")),
            text(&file),
            "verwijzingen".to_string(),
            format!("{}\u{7}", text(&folder)),
            // Dezelfde map nog eens, anders geschreven.
            text(&folder.join("..").join("verwijzingen")),
            "x".repeat(MAX_SEARCH_PATH_CHARS + 1),
        ];
        assert_eq!(
            check_search_paths(&raw),
            vec![true, false, false, false, false, false, true, false],
            "leeg, weg, geen map, relatief, stuurteken en te lang vallen af"
        );
        let clean = clean_search_paths(&raw);
        assert_eq!(clean, vec![folder.canonicalize().unwrap()], "gecanonicaliseerd en zonder dubbele");

        // Meer dan de grens: de rest valt weg, en telt bij het nakijken als fout.
        let many: Vec<String> = (0..open_pdf_cad::import::xref::MAX_SEARCH_PATHS + 3)
            .map(|i| {
                let sub = dir.join(format!("map-{i}"));
                std::fs::create_dir_all(&sub).unwrap();
                text(&sub)
            })
            .collect();
        assert_eq!(clean_search_paths(&many).len(), open_pdf_cad::import::xref::MAX_SEARCH_PATHS);
        let checked = check_search_paths(&many);
        assert_eq!(checked.len(), many.len());
        assert!(checked[..open_pdf_cad::import::xref::MAX_SEARCH_PATHS].iter().all(|ok| *ok));
        assert!(checked[open_pdf_cad::import::xref::MAX_SEARCH_PATHS..].iter().all(|ok| !*ok));

        // In de opties van een import komen alleen de gecontroleerde paden.
        let mut request = args(&dir.join("a.dxf"), &dir.join("a.pdf"));
        request.search_paths = raw;
        assert_eq!(options_for(&request).search_paths, clean);
    }

    #[test]
    fn a_chosen_search_path_changes_what_the_scan_and_the_import_find() {
        use open_pdf_cad::import::xref::ExternalStatus;
        let dir = work_dir("zoekpad-verkenning");
        let work = dir.join("werk");
        let elsewhere = dir.join("verwijzingen");
        std::fs::create_dir_all(&work).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        sample_dxf(&elsewhere, "gevel.dxf", 2000.0);
        let host = host_with_xref(&work, "hoofd.dxf", "gevel.dxf");
        let state = CadImportState::default();
        let go = AtomicBool::new(false);
        let status = |files: &[open_pdf_cad::import::xref::ExternalFile]| files.iter().map(|f| f.status).collect::<Vec<_>>();

        let scan = scan_blocking(&state, &host, &[], &go, |_| {}).unwrap();
        assert_eq!(status(&scan.externals), vec![ExternalStatus::Missing]);
        let chosen = vec![elsewhere.to_string_lossy().to_string()];
        let scan = scan_blocking(&state, &host, &chosen, &go, |_| {}).unwrap();
        assert_eq!(status(&scan.externals), vec![ExternalStatus::Found]);

        // Alleen opnieuw zoeken: de tekening komt uit het geheugen.
        let first = state.cached(&host).expect("vastgehouden");
        let report = locate_blocking(&state, &host, &chosen, &go).unwrap();
        assert_eq!(status(&report.externals), vec![ExternalStatus::Found]);
        assert!(!report.externals_truncated);
        assert!(Arc::ptr_eq(&first, &state.cached(&host).unwrap()), "niet opnieuw gelezen");
        let report = locate_blocking(&state, &host, &["bestaat-niet".to_string()], &go).unwrap();
        assert_eq!(status(&report.externals), vec![ExternalStatus::Missing], "een ongeldig zoekpad telt niet");
        let json = serde_json::to_value(&report).unwrap();
        assert!(json.get("externals").is_some() && json.get("externalsTruncated").is_some());

        // De import leest de verwijzing alleen met het zoekpad.
        let mut request = args(&host, &dir.join("zonder.pdf"));
        let without = import_blocking(&state, &request, &go, |_| {}).unwrap();
        assert_eq!(status(&without.externals), vec![ExternalStatus::Missing]);
        request.output_path = dir.join("met.pdf").to_string_lossy().to_string();
        request.search_paths = chosen;
        let with = import_blocking(&state, &request, &go, |_| {}).unwrap();
        assert_eq!(status(&with.externals), vec![ExternalStatus::Loaded]);
        assert!(with.externals.iter().all(|f| !f.name.contains('/') && !f.name.contains('\\')), "alleen namen, geen paden");
    }

    #[test]
    fn cancel_only_reaches_running_jobs() {
        let state = CadImportState::default();
        assert!(!state.cancel("scan-1"));
        let flag = state.cancel_flag("scan-1").unwrap();
        assert!(state.cancel("scan-1"));
        assert!(flag.load(Ordering::Relaxed));
        state.done("scan-1");
        assert!(!state.cancel("scan-1"));
    }

    #[test]
    fn progress_is_thinned_but_every_phase_change_gets_through() {
        let mut throttle = Throttle::new(Duration::from_millis(100));
        let t0 = Instant::now();
        assert!(throttle.should_emit(ImportPhase::Read, t0));
        assert!(!throttle.should_emit(ImportPhase::Read, t0 + Duration::from_millis(50)));
        assert!(throttle.should_emit(ImportPhase::Draw, t0 + Duration::from_millis(60)));
        assert!(!throttle.should_emit(ImportPhase::Draw, t0 + Duration::from_millis(100)));
        assert!(throttle.should_emit(ImportPhase::Draw, t0 + Duration::from_millis(170)));
    }
}
