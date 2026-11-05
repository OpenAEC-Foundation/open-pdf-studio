//! Transactionele installatie van extensies (#550).
//!
//! Een `.oppx`-pakket wordt één keer in het geheugen gelezen; precies die bytes
//! worden gecontroleerd (`inspecteer_bytes`) en uitgepakt. Uitpakken gebeurt in
//! een tussenmap, daarna volgt de wissel: het journaal wordt geschreven, de oude
//! `<id>/` gaat naar de back-up en de tussenmap wordt `<id>/`. Pas na een
//! geslaagde activatie in de WebView bevestigt de levenscyclus de installatie
//! (`extensie_bevestig`); mislukt de activatie, dan zet `extensie_terugdraaien`
//! de vorige installatie terug. Een journaal van een proces dat niet meer
//! bestaat, is een onderbroken transactie en wordt bij het opstarten
//! teruggedraaid (`herstel_in`); een bevestigd journaal wordt alleen opgeruimd.
//!
//! Indeling onder `<lokale datamap>/OpenPDFStudio/plugins/`:
//!
//! ```text
//! <id>/                          actieve installatie, met .opds-installatie.json
//! .opds-staging/<token>/         uitgepakt pakket vóór de wissel
//! .opds-backup/<token>/          vorige installatie, tot bevestiging
//! .opds-transacties/<token>.json journaal { id, fase, backup, aangemaakt, eigenaar, pid }
//! .opds-transacties/<eigenaar>.levend  (Windows) open zolang dat proces leeft
//! ```
//!
//! De logica staat in gewone functies met de pluginmap als parameter, zodat ze
//! met een tijdelijke map te testen zijn zonder Tauri. Fouten gaan als JSON-tekst
//! `{"code","message"}` naar de WebView.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::{Mutex, OnceLock};

pub const MAX_PAKKET: u64 = 20 * 1024 * 1024;
pub const MAX_ITEMS: usize = 1000;
pub const MAX_UITGEPAKT: u64 = 100 * 1024 * 1024;
pub const MAX_MANIFEST: u64 = 256 * 1024;
const MAX_ID: usize = 64;
const MAX_VERSIE: usize = 64;
const MAX_TEKSTVELD: usize = 512;

const META: &str = ".opds-installatie.json";
const STAGING: &str = ".opds-staging";
const BACKUP: &str = ".opds-backup";
const TRANSACTIES: &str = ".opds-transacties";
const GERESERVEERD: &str = ".opds-";

/// Eén wissel tegelijk: installeren, terugdraaien, bevestigen en verwijderen.
static WISSELSLOT: Mutex<()> = Mutex::new(());

/// Voer `f` uit onder het globale wisselslot.
pub fn met_wisselslot<T>(f: impl FnOnce() -> T) -> T {
    let _slot = WISSELSLOT.lock().unwrap_or_else(|e| e.into_inner());
    f()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fout {
    pub code: &'static str,
    pub message: String,
}

impl Fout {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Fout { code, message: message.into() }
    }
    /// De vorm waarin de WebView de fout krijgt.
    pub fn als_json(&self) -> String {
        json!({ "code": self.code, "message": self.message }).to_string()
    }
}

fn io_fout(wat: &str, e: std::io::Error) -> Fout {
    Fout::new("INSTALL_IO_FAILED", format!("{wat}: {e}"))
}

// ─── Id's ────────────────────────────────────────────────────────────────

fn is_apparaatnaam(segment: &str) -> bool {
    let s = segment.to_ascii_lowercase();
    let basis = s.split('.').next().unwrap_or("");
    matches!(basis, "con" | "prn" | "aux" | "nul")
        || (basis.len() == 4
            && (basis.starts_with("com") || basis.starts_with("lpt"))
            && matches!(basis.as_bytes()[3], b'1'..=b'9'))
}

/// Het strikte id: `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$`,
/// 1-64 tekens, en het eerste segment is geen Windows-apparaatnaam.
pub fn is_strikt_id(id: &str) -> bool {
    if id.is_empty() || id.len() > MAX_ID {
        return false;
    }
    for segment in id.split('.') {
        let b = segment.as_bytes();
        if b.is_empty() {
            return false;
        }
        let ok = |c: u8| c.is_ascii_lowercase() || c.is_ascii_digit();
        if !ok(b[0]) || !ok(b[b.len() - 1]) {
            return false;
        }
        if !b.iter().all(|&c| ok(c) || c == b'-') {
            return false;
        }
    }
    !is_apparaatnaam(id.split('.').next().unwrap_or(""))
}

/// Strikte id-controle voor nieuwe installaties.
pub fn valideer_extensie_id(id: &str) -> Result<(), Fout> {
    if is_strikt_id(id) {
        Ok(())
    } else {
        Err(Fout::new("MANIFEST_INVALID", format!("invalid extension id \"{id}\": use lowercase letters, digits, '-' and '.' (1-64 characters)")))
    }
}

/// Een oud id van een bestaande installatie: precies één gewone mapnaam, zonder
/// pad-, station- of gereserveerde tekens. Zo blijven oude extensies laden,
/// zonder dat `""`, `.`, `..`, `C:` of `a/b` buiten de pluginmap komen.
pub fn is_legacy_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 128 || id.starts_with('.') || id.ends_with('.') || id.ends_with(' ') {
        return false;
    }
    if id.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return false;
    }
    !is_apparaatnaam(id)
}

/// Voor de bestaande commando's `read_plugin_file` en `uninstall_plugin`:
/// een strikt id of een veilig oud id.
pub fn controleer_bestaand_id(id: &str) -> Result<(), String> {
    if is_strikt_id(id) || is_legacy_id(id) {
        Ok(())
    } else {
        Err("Invalid plugin id".to_string())
    }
}

fn controleer_token(token: &str) -> Result<(), Fout> {
    if token.len() == 32 && token.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) {
        Ok(())
    } else {
        Err(Fout::new("TRANSACTION_UNKNOWN", "invalid transaction token"))
    }
}

pub(crate) fn nieuw_token() -> String {
    format!("{:016x}{:016x}", rand::random::<u64>(), rand::random::<u64>())
}

// ─── Pad ─────────────────────────────────────────────────────────────────

/// Wie het pakket aanbiedt. Via MCP geldt alleen een expliciet lokaal pad; wat
/// de gebruiker zelf in de bestandsdialoog kiest, mag ook op een netwerkshare
/// staan (zoals vóór #550).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bron {
    Ui,
    Mcp,
}

impl Bron {
    /// `"mcp"` is MCP; al het andere (ook niets) is de dialoog van de app.
    pub fn uit(s: Option<&str>) -> Bron {
        match s {
            Some("mcp") => Bron::Mcp,
            _ => Bron::Ui,
        }
    }
    fn naam(self) -> &'static str {
        match self {
            Bron::Ui => "ui",
            Bron::Mcp => "mcp",
        }
    }
}

/// De tekstuele padregels: geen apparaatpad (`\\?\`, `\\.\`), geen URL, geen
/// relatief pad, alleen `.oppx`, en via MCP ook geen UNC-pad.
pub fn pad_toegestaan(pad: &str, bron: Bron) -> Result<(), Fout> {
    let niet = |reden: &str| Err(Fout::new("PATH_NOT_ALLOWED", format!("{reden}: {pad}")));
    let p = pad.trim();
    if p.is_empty() {
        return niet("empty path");
    }
    if ["\\\\?\\", "\\\\.\\", "//?/", "//./"].iter().any(|v| p.starts_with(v)) {
        return niet("device paths are not allowed");
    }
    if bron == Bron::Mcp && (p.starts_with("\\\\") || p.starts_with("//")) {
        return niet("network paths are not allowed");
    }
    if p.contains("://") || p.to_ascii_lowercase().starts_with("file:") {
        return niet("URLs are not allowed");
    }
    let pad_buf = Path::new(p);
    if !pad_buf.is_absolute() {
        return niet("the path must be absolute");
    }
    let ext_ok = pad_buf
        .extension()
        .and_then(|e| e.to_str())
        .map_or(false, |e| e.eq_ignore_ascii_case("oppx"));
    if !ext_ok {
        return niet("only .oppx packages can be installed");
    }
    Ok(())
}

/// Ligt dit (gecanonicaliseerde) pad op een netwerkshare? Een netwerkschijf
/// met een stationsletter of een koppeling naar een share wordt na
/// `canonicalize` een `\\?\UNC\…`-pad en is zo te herkennen.
pub fn is_netwerkpad(pad: &Path) -> bool {
    matches!(
        pad.components().next(),
        Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..))
    )
}

/// De regels voor het echte pad na `canonicalize`: via MCP geen netwerkshare.
pub fn echt_pad_toegestaan(echt: &Path, bron: Bron) -> Result<(), Fout> {
    if bron == Bron::Mcp && is_netwerkpad(echt) {
        return Err(Fout::new(
            "PATH_NOT_ALLOWED",
            format!("network shares are not allowed, also not via a drive letter or link: {}", echt.display()),
        ));
    }
    Ok(())
}

/// Alleen een expliciet, absoluut `.oppx`-pad: geen relatief pad, geen `\\?\`
/// of `\\.\`, geen URL, en via MCP ook geen netwerkshare (ook niet achter een
/// stationsletter of koppeling). Geeft het gecanonicaliseerde pad.
pub fn controleer_pad(pad: &str, bron: Bron) -> Result<PathBuf, Fout> {
    pad_toegestaan(pad, bron)?;
    let pad_buf = PathBuf::from(pad.trim());
    let echt = fs::canonicalize(&pad_buf)
        .map_err(|_| Fout::new("FILE_NOT_FOUND", format!("file not found: {pad}")))?;
    echt_pad_toegestaan(&echt, bron)?;
    let meta = fs::metadata(&echt).map_err(|_| Fout::new("FILE_NOT_FOUND", format!("file not found: {pad}")))?;
    if !meta.is_file() {
        return Err(Fout::new("FILE_NOT_FOUND", format!("not a regular file: {pad}")));
    }
    Ok(echt)
}

// ─── Pakketcontrole ──────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct PakketInfo {
    pub id: String,
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub sha256: String,
    pub entries: usize,
    pub bytes: u64,
}

impl PakketInfo {
    pub fn als_json(&self) -> Value {
        json!({
            "id": self.id, "name": self.name, "version": self.version,
            "description": self.description, "author": self.author,
            "sha256": self.sha256, "entries": self.entries, "bytes": self.bytes,
        })
    }
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Controleer de naam van één ZIP-item. Een fout item keurt het hele pakket af.
fn controleer_itemnaam(naam: &str) -> Result<(), Fout> {
    let fout = |reden: &str| Err(Fout::new("PACKAGE_INVALID", format!("unsafe entry name \"{naam}\": {reden}")));
    if naam.is_empty() || naam.contains('\\') || naam.starts_with('/') {
        return fout("absolute or backslash path");
    }
    let delen: Vec<&str> = naam.trim_end_matches('/').split('/').collect();
    for deel in delen {
        if deel.is_empty() || deel == "." || deel == ".." {
            return fout("empty, '.' or '..' segment");
        }
        if deel.chars().any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
            return fout("reserved character");
        }
        if deel.ends_with('.') || deel.ends_with(' ') {
            return fout("trailing dot or space");
        }
        if is_apparaatnaam(deel) {
            return fout("device name");
        }
        if deel.starts_with(GERESERVEERD) {
            return fout("names starting with .opds- are reserved");
        }
    }
    Ok(())
}

fn lees_tekstveld(manifest: &serde_json::Map<String, Value>, veld: &str, max: usize) -> Result<Option<String>, Fout> {
    match manifest.get(veld) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.len() <= max => Ok(Some(s.clone())),
        Some(_) => Err(Fout::new("MANIFEST_INVALID", format!("plugin.json: \"{veld}\" must be a string of at most {max} characters"))),
    }
}

/// Een item dat op een hoofdletterongevoelig bestandssysteem (NTFS, APFS)
/// hetzelfde bestand zou worden als een eerder item, keurt het pakket af:
/// anders overschrijft bij het uitpakken een niet-gecontroleerd `PLUGIN.JSON`
/// het gecontroleerde `plugin.json`.
fn controleer_uniek(gezien: &mut HashSet<String>, naam: &str) -> Result<(), Fout> {
    if gezien.insert(naam.trim_end_matches('/').to_lowercase()) {
        Ok(())
    } else {
        Err(Fout::new("PACKAGE_INVALID", format!("duplicate entry name \"{naam}\" (letter case does not count)")))
    }
}

/// Controleer een pakket op de bytes die in het geheugen staan. Alleen een
/// strikt id.
pub fn inspecteer_bytes(bytes: &[u8]) -> Result<PakketInfo, Fout> {
    inspecteer_bytes_met(bytes, &|_| false)
}

/// Als `inspecteer_bytes`, maar een oud id is goed als `oud_id_bestaat(id)`
/// zegt dat er precies onder dat id al een installatie staat (bijwerken).
pub fn inspecteer_bytes_met(bytes: &[u8], oud_id_bestaat: &dyn Fn(&str) -> bool) -> Result<PakketInfo, Fout> {
    if bytes.len() as u64 > MAX_PAKKET {
        return Err(Fout::new("PACKAGE_INVALID", "package is larger than 20 MB"));
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| Fout::new("PACKAGE_INVALID", format!("not a valid ZIP package: {e}")))?;
    if zip.len() > MAX_ITEMS {
        return Err(Fout::new("PACKAGE_INVALID", format!("more than {MAX_ITEMS} entries")));
    }
    let mut totaal: u64 = 0;
    let mut manifest_tekst: Option<Vec<u8>> = None;
    let mut index_tekst: Option<Vec<u8>> = None;
    let mut gezien = HashSet::new();
    for i in 0..zip.len() {
        let mut item = zip
            .by_index(i)
            .map_err(|e| Fout::new("PACKAGE_INVALID", format!("unreadable entry {i}: {e}")))?;
        let naam = item.name().to_string();
        controleer_itemnaam(&naam)?;
        controleer_uniek(&mut gezien, &naam)?;
        if item.enclosed_name().is_none() {
            return Err(Fout::new("PACKAGE_INVALID", format!("unsafe entry name \"{naam}\"")));
        }
        if item.is_symlink() {
            return Err(Fout::new("PACKAGE_INVALID", format!("symbolic links are not allowed: \"{naam}\"")));
        }
        totaal = totaal.saturating_add(item.size());
        if totaal > MAX_UITGEPAKT {
            return Err(Fout::new("PACKAGE_INVALID", "unpacked size is larger than 100 MB"));
        }
        if item.is_dir() {
            continue;
        }
        if naam == "plugin.json" || naam == "index.js" {
            let max = if naam == "plugin.json" { MAX_MANIFEST } else { MAX_UITGEPAKT };
            let mut inhoud = Vec::new();
            (&mut item)
                .take(max + 1)
                .read_to_end(&mut inhoud)
                .map_err(|e| Fout::new("PACKAGE_INVALID", format!("cannot read {naam}: {e}")))?;
            if inhoud.len() as u64 > max {
                return Err(if naam == "plugin.json" {
                    Fout::new("MANIFEST_INVALID", "plugin.json is larger than 256 KB")
                } else {
                    Fout::new("PACKAGE_INVALID", "index.js is too large")
                });
            }
            if naam == "plugin.json" {
                manifest_tekst = Some(inhoud);
            } else {
                index_tekst = Some(inhoud);
            }
        }
    }
    let manifest_tekst = manifest_tekst.ok_or_else(|| Fout::new("MANIFEST_INVALID", "plugin.json is missing in the package root"))?;
    let manifest: Value = serde_json::from_slice(&manifest_tekst)
        .map_err(|e| Fout::new("MANIFEST_INVALID", format!("plugin.json is not valid JSON: {e}")))?;
    let manifest = manifest
        .as_object()
        .ok_or_else(|| Fout::new("MANIFEST_INVALID", "plugin.json must be a JSON object"))?;
    let id = match manifest.get("id") {
        Some(Value::String(s)) => s.clone(),
        _ => return Err(Fout::new("MANIFEST_INVALID", "plugin.json needs a string \"id\"")),
    };
    // Een oud id mag alleen een bestaande installatie met precies dat id bijwerken.
    if !(is_legacy_id(&id) && !is_strikt_id(&id) && oud_id_bestaat(&id)) {
        valideer_extensie_id(&id)?;
    }
    let version = lees_tekstveld(manifest, "version", MAX_VERSIE)?;
    let name = lees_tekstveld(manifest, "name", MAX_TEKSTVELD)?;
    let description = lees_tekstveld(manifest, "description", MAX_TEKSTVELD * 4).unwrap_or(None);
    let author = lees_tekstveld(manifest, "author", MAX_TEKSTVELD).unwrap_or(None);
    let index = index_tekst.ok_or_else(|| Fout::new("ENTRY_MISSING", "index.js is missing in the package root"))?;
    if std::str::from_utf8(&index).is_err() {
        return Err(Fout::new("ENTRY_MISSING", "index.js is not valid UTF-8"));
    }
    Ok(PakketInfo {
        id,
        name,
        version,
        description,
        author,
        sha256: sha256_hex(bytes),
        entries: zip.len(),
        bytes: bytes.len() as u64,
    })
}

/// Lees het pakket één keer in het geheugen en controleer het. Met `map` (de
/// pluginmap) mag een pakket met een oud id een bestaande installatie met
/// precies dat id bijwerken.
pub fn inspecteer_pakket(pad: &str, bron: Bron, map: Option<&Path>) -> Result<(PakketInfo, Vec<u8>), Fout> {
    let echt = controleer_pad(pad, bron)?;
    let grootte = fs::metadata(&echt).map(|m| m.len()).unwrap_or(0);
    if grootte > MAX_PAKKET {
        return Err(Fout::new("PACKAGE_INVALID", "package is larger than 20 MB"));
    }
    let mut bytes = Vec::new();
    fs::File::open(&echt)
        .and_then(|f| f.take(MAX_PAKKET + 1).read_to_end(&mut bytes))
        .map_err(|_| Fout::new("FILE_NOT_FOUND", format!("cannot read {pad}")))?;
    let oud_id_bestaat = |id: &str| map.map_or(false, |m| bestaande_mapnaam(m, id).as_deref() == Some(id));
    let info = inspecteer_bytes_met(&bytes, &oud_id_bestaat)?;
    Ok((info, bytes))
}

/// De echte naam van de installatiemap van `id`, hoofdletterongevoelig
/// gezocht (zoals NTFS en APFS hem vinden), of None. Een map met precies die
/// naam gaat voor.
fn bestaande_mapnaam(map: &Path, id: &str) -> Option<String> {
    let gezocht = id.to_lowercase();
    let mut gevonden = None;
    for item in fs::read_dir(map).ok()?.flatten() {
        let naam = item.file_name().to_string_lossy().to_string();
        if naam.starts_with('.') || naam.to_lowercase() != gezocht || !item.path().is_dir() {
            continue;
        }
        if naam == id {
            return Some(naam);
        }
        gevonden.get_or_insert(naam);
    }
    gevonden
}

// ─── Versies en vervangbeleid ────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Beleid {
    Never,
    IfNewer,
    Always,
}

pub fn beleid_uit(s: &str) -> Result<Beleid, Fout> {
    match s {
        "never" => Ok(Beleid::Never),
        "ifNewer" => Ok(Beleid::IfNewer),
        "always" => Ok(Beleid::Always),
        _ => Err(Fout::new("INVALID_ARGUMENT", format!("replace must be never, ifNewer or always, not \"{s}\""))),
    }
}

type Versie<'a> = ([u64; 3], Option<Vec<&'a str>>);

fn parse_versie(v: &str) -> Option<Versie<'_>> {
    let zonder_build = v.split('+').next()?;
    let (kern, pre) = match zonder_build.split_once('-') {
        Some((k, p)) => (k, Some(p)),
        None => (zonder_build, None),
    };
    let delen: Vec<&str> = kern.split('.').collect();
    if delen.len() != 3 {
        return None;
    }
    let mut getallen = [0u64; 3];
    for (i, d) in delen.iter().enumerate() {
        if d.is_empty() || !d.bytes().all(|c| c.is_ascii_digit()) || (d.len() > 1 && d.starts_with('0')) {
            return None;
        }
        getallen[i] = d.parse().ok()?;
    }
    let pre = match pre {
        None => None,
        Some(p) => {
            let ids: Vec<&str> = p.split('.').collect();
            if ids.iter().any(|x| x.is_empty() || !x.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')) {
                return None;
            }
            Some(ids)
        }
    };
    Some((getallen, pre))
}

/// Vergelijk twee versies `major.minor.patch[-pre]` met semver-volgorde. None
/// als een van de twee onleesbaar is.
pub fn vergelijk_versies(a: &str, b: &str) -> Option<Ordering> {
    let (ka, pa) = parse_versie(a)?;
    let (kb, pb) = parse_versie(b)?;
    Some(ka.cmp(&kb).then_with(|| match (pa, pb) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => {
            for (p, q) in x.iter().zip(y.iter()) {
                let o = match (p.parse::<u64>(), q.parse::<u64>()) {
                    (Ok(m), Ok(n)) => m.cmp(&n),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => p.cmp(q),
                };
                if o != Ordering::Equal {
                    return o;
                }
            }
            x.len().cmp(&y.len())
        }
    }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Beslissing {
    Installeren,
    Bijwerken,
    Ongewijzigd,
}

/// Wat bestaat er al: de SHA-256 en versie uit `.opds-installatie.json` (of
/// alleen de versie bij een oude installatie zonder die metadata).
#[derive(Debug, Clone, Default)]
pub struct Bestaand {
    pub sha256: Option<String>,
    pub version: Option<String>,
}

/// De beleidstabel uit het ontwerp (§8.2).
pub fn beslis(beleid: Beleid, bestaand: Option<&Bestaand>, nieuw_sha: &str, nieuwe_versie: Option<&str>) -> Result<Beslissing, Fout> {
    let Some(oud) = bestaand else { return Ok(Beslissing::Installeren) };
    if oud.sha256.as_deref() == Some(nieuw_sha) {
        return Ok(Beslissing::Ongewijzigd);
    }
    match beleid {
        Beleid::Never => Err(Fout::new("ALREADY_INSTALLED", "a different package with this id is already installed (replace: never)")),
        Beleid::Always => Ok(Beslissing::Bijwerken),
        Beleid::IfNewer => {
            let (Some(n), Some(o)) = (nieuwe_versie, oud.version.as_deref()) else {
                return Err(Fout::new("VERSION_UNCOMPARABLE", "a version is missing, so ifNewer cannot compare"));
            };
            match vergelijk_versies(n, o) {
                None => Err(Fout::new("VERSION_UNCOMPARABLE", format!("cannot compare versions {n} and {o}"))),
                Some(Ordering::Greater) => Ok(Beslissing::Bijwerken),
                Some(_) => Err(Fout::new("VERSION_NOT_NEWER", format!("version {n} is not newer than the installed {o}"))),
            }
        }
    }
}

// ─── Schijf ──────────────────────────────────────────────────────────────

/// De pluginmap van de app (maakt hem zo nodig aan).
pub fn plugins_map() -> PathBuf {
    let basis = crate::datamap::lokale_datamap().unwrap_or_else(|| PathBuf::from("."));
    let map = basis.join("OpenPDFStudio").join("plugins");
    let _ = fs::create_dir_all(&map);
    map
}

fn nu_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (dagen, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Burgerlijke datum uit dagen sinds 1970-01-01 (algoritme van H. Hinnant).
    let z = dagen + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rest / 3600, (rest % 3600) / 60, rest % 60)
}

fn lees_json(pad: &Path, max: u64) -> Option<Value> {
    let meta = fs::metadata(pad).ok()?;
    if !meta.is_file() || meta.len() > max {
        return None;
    }
    serde_json::from_slice(&fs::read(pad).ok()?).ok()
}

fn lees_bestaand(map: &Path, id: &str) -> Option<Bestaand> {
    let dir = map.join(id);
    if fs::symlink_metadata(&dir).is_err() {
        return None;
    }
    if let Some(meta) = lees_json(&dir.join(META), MAX_MANIFEST) {
        return Some(Bestaand {
            sha256: meta.get("sha256").and_then(|v| v.as_str()).map(String::from),
            version: meta.get("version").and_then(|v| v.as_str()).map(String::from),
        });
    }
    // Oude installatie zonder metadata: telt als een ander pakket.
    let version = lees_json(&dir.join("plugin.json"), MAX_MANIFEST)
        .and_then(|m| m.get("version").and_then(|v| v.as_str()).map(String::from));
    Some(Bestaand { sha256: None, version })
}

fn pak_uit(bytes: &[u8], doel: &Path) -> Result<(), Fout> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| Fout::new("PACKAGE_INVALID", e.to_string()))?;
    fs::create_dir_all(doel).map_err(|e| io_fout("create staging folder", e))?;
    let mut totaal: u64 = 0;
    let mut gezien = HashSet::new();
    for i in 0..zip.len() {
        let mut item = zip.by_index(i).map_err(|e| Fout::new("PACKAGE_INVALID", e.to_string()))?;
        let naam = item.name().to_string();
        controleer_itemnaam(&naam)?;
        controleer_uniek(&mut gezien, &naam)?;
        let rel = item
            .enclosed_name()
            .ok_or_else(|| Fout::new("PACKAGE_INVALID", format!("unsafe entry name \"{naam}\"")))?;
        let uit = doel.join(rel);
        if !uit.starts_with(doel) {
            return Err(Fout::new("PACKAGE_INVALID", format!("unsafe entry name \"{naam}\"")));
        }
        if item.is_dir() {
            fs::create_dir_all(&uit).map_err(|e| io_fout("create folder", e))?;
            continue;
        }
        if let Some(ouder) = uit.parent() {
            fs::create_dir_all(ouder).map_err(|e| io_fout("create folder", e))?;
        }
        // Nooit een al uitgepakt bestand overschrijven: wat gecontroleerd is,
        // wordt ook geïnstalleerd (ook als het bestandssysteem twee namen
        // anders samenvouwt dan to_lowercase).
        let mut f = fs::File::create_new(&uit).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                Fout::new("PACKAGE_INVALID", format!("duplicate entry name \"{naam}\""))
            } else {
                io_fout("create file", e)
            }
        })?;
        // De opgegeven grootte kan liegen: tel wat er echt uitkomt.
        let over = MAX_UITGEPAKT.saturating_sub(totaal);
        let geschreven = std::io::copy(&mut (&mut item).take(over + 1), &mut f).map_err(|e| io_fout("extract file", e))?;
        totaal += geschreven;
        if totaal > MAX_UITGEPAKT {
            return Err(Fout::new("PACKAGE_INVALID", "unpacked size is larger than 100 MB"));
        }
    }
    Ok(())
}

fn journaal_pad(map: &Path, token: &str) -> PathBuf {
    map.join(TRANSACTIES).join(format!("{token}.json"))
}

// ─── Eigenaar van een transactie ─────────────────────────────────────────
//
// Een tab losmaken start een tweede app-proces met dezelfde pluginmap, en dat
// draait bij het opstarten het herstel. Dat herstel mag alleen transacties
// terugdraaien van een proces dat niet meer bestaat. Daarom staat in elk
// journaal het token van het proces (`eigenaar`) en zijn `pid`. Op Windows
// houdt elk proces bovendien `.opds-transacties/<eigenaar>.levend` exclusief
// open (zonder delen) zolang het leeft: een ander proces dat dat bestand niet
// kan openen, weet zo zeker dat de eigenaar leeft, ook als een pid opnieuw is
// uitgedeeld.

/// Het token van dit proces.
fn eigen_eigenaar() -> &'static str {
    static EIGENAAR: OnceLock<String> = OnceLock::new();
    EIGENAAR.get_or_init(nieuw_token)
}

/// Houd voor deze pluginmap het `.levend`-bestand van dit proces open.
#[cfg(windows)]
fn meld_levend(map: &Path) {
    use std::os::windows::fs::OpenOptionsExt;
    static OPEN: Mutex<Vec<(PathBuf, fs::File)>> = Mutex::new(Vec::new());
    let dir = map.join(TRANSACTIES);
    let mut open = OPEN.lock().unwrap_or_else(|e| e.into_inner());
    if open.iter().any(|(d, _)| d == &dir) {
        return;
    }
    let pad = dir.join(format!("{}.levend", eigen_eigenaar()));
    if let Ok(f) = fs::OpenOptions::new().write(true).create(true).share_mode(0).open(&pad) {
        open.push((dir, f));
    }
}

#[cfg(not(windows))]
fn meld_levend(_map: &Path) {}

/// Leeft het proces dat dit journaal schreef nog? Een journaal zonder
/// eigenaar (van vóór deze regel) hoort bij een proces dat er niet meer is.
fn eigenaar_leeft(map: &Path, journaal: &Value) -> bool {
    let Some(eigenaar) = journaal.get("eigenaar").and_then(|v| v.as_str()) else {
        return false;
    };
    if eigenaar == eigen_eigenaar() {
        return true;
    }
    if controleer_token(eigenaar).is_err() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let pad = map.join(TRANSACTIES).join(format!("{eigenaar}.levend"));
        // 32 = ERROR_SHARING_VIOLATION: de eigenaar houdt het bestand open.
        match fs::OpenOptions::new().read(true).share_mode(0).open(&pad) {
            Ok(_) => false,
            Err(e) => e.raw_os_error() == Some(32),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = map;
        match journaal.get("pid").and_then(|v| v.as_u64()) {
            Some(pid) if pid > 0 && pid != u64::from(std::process::id()) => pid_leeft(pid),
            _ => false,
        }
    }
}

#[cfg(not(windows))]
fn pid_leeft(pid: u64) -> bool {
    let proc = Path::new("/proc");
    if proc.is_dir() {
        return proc.join(pid.to_string()).exists();
    }
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_or(false, |s| s.success())
}

fn schrijf_journaal(map: &Path, token: &str, id: &str, fase: &str, backup: bool) -> Result<(), Fout> {
    let dir = map.join(TRANSACTIES);
    fs::create_dir_all(&dir).map_err(|e| io_fout("create journal folder", e))?;
    meld_levend(map);
    let inhoud = json!({
        "id": id, "fase": fase, "backup": if backup { Some(token) } else { None }, "aangemaakt": nu_iso(),
        "eigenaar": eigen_eigenaar(), "pid": std::process::id(),
    });
    let tmp = dir.join(format!("{token}.json.tmp"));
    fs::write(&tmp, inhoud.to_string()).map_err(|e| io_fout("write journal", e))?;
    fs::rename(&tmp, journaal_pad(map, token)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_fout("write journal", e)
    })
}

fn verwijder_pad(pad: &Path) -> std::io::Result<()> {
    match fs::symlink_metadata(pad) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
        Ok(m) if m.is_dir() => fs::remove_dir_all(pad),
        Ok(_) => fs::remove_file(pad),
    }
}

/// Zet na een mislukte stap de vorige installatie terug: eventueel eerst de
/// nieuwe `<id>/` weg, dan de back-up terug. `true` als dat lukte (of er niets
/// terug te zetten was); bij `false` moet het journaal blijven staan, zodat het
/// herstel het afmaakt en de back-up niet als wees wordt opgeruimd.
fn zet_terug(doel: &Path, backup: &Path, heeft_oud: bool, nieuw_weg: bool) -> bool {
    if nieuw_weg && verwijder_pad(doel).is_err() {
        return false;
    }
    !heeft_oud || fs::rename(backup, doel).is_ok()
}

/// Is er voor dit id nog een transactie open? Een bevestigde wordt opgeruimd,
/// een van een proces dat niet meer bestaat eerst teruggedraaid (zoals het
/// herstel bij het opstarten zou doen). Een onbevestigde van een levend
/// proces, ook van dit proces zelf, geeft TRANSACTION_PENDING: anders draait
/// het herstel haar later terug en verdwijnt de nieuwe installatie mee.
fn handel_open_transacties_af(map: &Path, id: &str) -> Result<(), Fout> {
    let gezocht = id.to_lowercase();
    let items: Vec<_> = fs::read_dir(map.join(TRANSACTIES)).map(|it| it.flatten().collect()).unwrap_or_default();
    for item in items {
        let naam = item.file_name().to_string_lossy().to_string();
        let Some(token) = naam.strip_suffix(".json") else { continue };
        if controleer_token(token).is_err() {
            continue;
        }
        let Some(journaal) = lees_json(&item.path(), 64 * 1024) else { continue };
        let jid = journaal.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if jid.to_lowercase() != gezocht {
            continue;
        }
        if journaal.get("fase").and_then(|v| v.as_str()) == Some("bevestigd") {
            ruim_bevestigd_op(map, token);
        } else if eigenaar_leeft(map, &journaal) {
            return Err(Fout::new(
                "TRANSACTION_PENDING",
                format!("an earlier installation of {jid} is not confirmed yet; try again later or restart the app"),
            ));
        } else {
            draai_terug_onder_slot(map, token)?;
        }
    }
    Ok(())
}

/// Installeer of werk bij volgens het vervangbeleid. Het pakket wordt opnieuw
/// gecontroleerd en de hash vergeleken met de verwachte (anders PACKAGE_CHANGED).
/// `bron` is `"mcp"` of `"ui"`: via MCP gelden de strengere padregels.
pub fn installeer_in(map: &Path, pad: &str, beleid: Beleid, verwachte_sha: Option<&str>, bron: &str) -> Result<Value, Fout> {
    met_wisselslot(|| installeer_onder_slot(map, pad, beleid, verwachte_sha, Bron::uit(Some(bron))))
}

fn installeer_onder_slot(map: &Path, pad: &str, beleid: Beleid, verwachte_sha: Option<&str>, bron: Bron) -> Result<Value, Fout> {
    let (info, bytes) = inspecteer_pakket(pad, bron, Some(map))?;
    if let Some(sha) = verwachte_sha {
        if !sha.eq_ignore_ascii_case(&info.sha256) {
            return Err(Fout::new("PACKAGE_CHANGED", "the package changed between inspection and installation"));
        }
    }
    // Een map die alleen in hoofdletters verschilt, is op NTFS dezelfde map:
    // die zou stil vervangen worden terwijl de oude extensie blijft draaien.
    if let Some(naam) = bestaande_mapnaam(map, &info.id) {
        if naam != info.id {
            return Err(Fout::new(
                "ID_CASE_CONFLICT",
                format!("the installed extension \"{naam}\" differs from \"{}\" only in letter case; uninstall it first", info.id),
            ));
        }
    }
    handel_open_transacties_af(map, &info.id)?;
    let bestaand = lees_bestaand(map, &info.id);
    let beslissing = beslis(beleid, bestaand.as_ref(), &info.sha256, info.version.as_deref())?;
    let vorige = bestaand.as_ref().and_then(|b| b.version.clone());
    if beslissing == Beslissing::Ongewijzigd {
        return Ok(json!({ "outcome": "unchanged", "transactie": null, "previousVersion": vorige,
                          "id": info.id, "version": info.version, "sha256": info.sha256 }));
    }

    let token = nieuw_token();
    let staging = map.join(STAGING).join(&token);
    let doel = map.join(&info.id);
    let heeft_oud = bestaand.is_some();
    let backup = map.join(BACKUP).join(&token);
    // Het journaal eerst: zo hoort ook de tussenmap al bij een transactie (met
    // eigenaar), en ruimt het herstel van een ander proces haar niet op terwijl
    // dit proces uitpakt.
    schrijf_journaal(map, &token, &info.id, "voorbereid", heeft_oud)?;
    let weg_journaal = || {
        let _ = fs::remove_file(journaal_pad(map, &token));
    };
    // Mislukt vóór er iets verplaatst is: tussenmap en journaal weg.
    let mislukt = |f: Fout| {
        let _ = verwijder_pad(&staging);
        weg_journaal();
        f
    };
    pak_uit(&bytes, &staging).map_err(mislukt)?;
    let meta = json!({ "sha256": info.sha256, "version": info.version, "installedAt": nu_iso(), "source": bron.naam() });
    fs::write(staging.join(META), meta.to_string()).map_err(|e| mislukt(io_fout("write installation metadata", e)))?;

    if heeft_oud {
        if let Err(e) = fs::create_dir_all(map.join(BACKUP)).and_then(|_| fs::rename(&doel, &backup)) {
            return Err(mislukt(io_fout("move the previous installation aside", e)));
        }
    }
    // Vanaf hier kan er iets verplaatst zijn. Het journaal verdwijnt alleen als
    // het terugzetten lukt; anders maakt het herstel het af.
    if let Err(f) = schrijf_journaal(map, &token, &info.id, "oud-weg", heeft_oud) {
        if zet_terug(&doel, &backup, heeft_oud, false) {
            let _ = verwijder_pad(&staging);
            weg_journaal();
        }
        return Err(f);
    }
    if let Err(e) = fs::rename(&staging, &doel) {
        if zet_terug(&doel, &backup, heeft_oud, false) {
            let _ = verwijder_pad(&staging);
            weg_journaal();
        }
        return Err(io_fout("activate the new installation", e));
    }
    if let Err(f) = schrijf_journaal(map, &token, &info.id, "gewisseld", heeft_oud) {
        // Zonder bijgewerkt journaal geen halve wissel laten staan.
        if zet_terug(&doel, &backup, heeft_oud, true) {
            weg_journaal();
        }
        return Err(f);
    }
    Ok(json!({
        "outcome": if heeft_oud { "updated" } else { "installed" },
        "transactie": token, "previousVersion": vorige,
        "id": info.id, "version": info.version, "sha256": info.sha256,
    }))
}

fn lees_journaal(map: &Path, token: &str) -> Result<Value, Fout> {
    controleer_token(token)?;
    lees_json(&journaal_pad(map, token), 64 * 1024)
        .ok_or_else(|| Fout::new("TRANSACTION_UNKNOWN", format!("no open transaction {token}")))
}

/// Ruim een bevestigde transactie op: back-up, tussenmap en als laatste het
/// journaal. Mag half mislukken; het herstel doet de rest.
fn ruim_bevestigd_op(map: &Path, token: &str) {
    let _ = verwijder_pad(&map.join(BACKUP).join(token));
    let _ = verwijder_pad(&map.join(STAGING).join(token));
    let _ = fs::remove_file(journaal_pad(map, token));
}

/// Bevestig een geslaagde installatie. Eerst gaat het journaal naar de fase
/// `bevestigd` (dat is het moment waarop de installatie geldt), daarna
/// verdwijnen back-up en journaal. Blijft het journaal daarna toch staan, dan
/// ruimt het herstel het alleen op en draait het niets terug. Mislukt al het
/// vastleggen, dan geeft dit een fout en blijft de transactie onbevestigd.
pub fn bevestig_in(map: &Path, token: &str) -> Result<Value, Fout> {
    met_wisselslot(|| {
        let journaal = lees_journaal(map, token)?;
        if journaal.get("fase").and_then(|v| v.as_str()) != Some("bevestigd") {
            let id = journaal.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let backup = journaal.get("backup").map_or(false, |v| !v.is_null());
            schrijf_journaal(map, token, id, "bevestigd", backup)?;
        }
        ruim_bevestigd_op(map, token);
        Ok(json!({ "confirmed": true }))
    })
}

fn draai_terug_onder_slot(map: &Path, token: &str) -> Result<Value, Fout> {
    let journaal = lees_journaal(map, token)?;
    let id = journaal.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if !(is_strikt_id(&id) || is_legacy_id(&id)) {
        return Err(Fout::new("TRANSACTION_UNKNOWN", "journal has an invalid id"));
    }
    let fase = journaal.get("fase").and_then(|v| v.as_str()).unwrap_or("");
    let doel = map.join(&id);
    let backup = map.join(BACKUP).join(token);
    let heeft_backup = journaal.get("backup").map_or(false, |v| !v.is_null()) && backup.exists();
    // Lukt een stap hieronder niet, dan blijft het journaal staan (de `?`).
    match fase {
        // Al bevestigd: niets meer terug te draaien.
        "bevestigd" => return Err(Fout::new("TRANSACTION_UNKNOWN", format!("transaction {token} is already confirmed"))),
        // De nieuwe staat nog niet op haar plek. Was de oude al naar de
        // back-up verplaatst (onderbroken vóór "oud-weg" vastlag), dan terug.
        "voorbereid" => {
            if heeft_backup && fs::symlink_metadata(&doel).is_err() {
                fs::rename(&backup, &doel).map_err(|e| io_fout("restore previous installation", e))?;
            }
        }
        // De oude staat in de back-up (of er was er geen); `<id>/` is leeg of
        // de onbevestigde nieuwe.
        "oud-weg" | "gewisseld" => {
            verwijder_pad(&doel).map_err(|e| io_fout("remove new installation", e))?;
            if heeft_backup {
                fs::rename(&backup, &doel).map_err(|e| io_fout("restore previous installation", e))?;
            }
        }
        _ => return Err(Fout::new("TRANSACTION_UNKNOWN", format!("journal {token} has an unknown phase"))),
    }
    let _ = verwijder_pad(&map.join(STAGING).join(token));
    fs::remove_file(journaal_pad(map, token)).map_err(|e| io_fout("remove journal", e))?;
    let hersteld = if doel.exists() {
        lees_json(&doel.join(META), MAX_MANIFEST)
            .and_then(|m| m.get("version").and_then(|v| v.as_str()).map(String::from))
            .or_else(|| lees_json(&doel.join("plugin.json"), MAX_MANIFEST)
                .and_then(|m| m.get("version").and_then(|v| v.as_str()).map(String::from)))
    } else {
        None
    };
    Ok(json!({ "restoredVersion": hersteld, "id": id, "restored": doel.exists() }))
}

/// Draai een niet-bevestigde installatie terug: de nieuwe `<id>/` weg en de
/// back-up (als die er is) weer op zijn plaats.
pub fn terugdraaien_in(map: &Path, token: &str) -> Result<Value, Fout> {
    met_wisselslot(|| draai_terug_onder_slot(map, token))
}

/// Een `.tmp`-journaal is een schrijfactie die nooit afkwam, tenzij het nog
/// maar net bestaat (een ander proces schrijft het misschien nu).
fn is_oud(pad: &Path) -> bool {
    fs::metadata(pad)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map_or(false, |d| d.as_secs() >= 60)
}

/// Herstel na een onderbreking. Een journaal van een proces dat niet meer
/// bestaat, is een transactie die nooit is bevestigd en wordt teruggedraaid;
/// een bevestigd journaal wordt alleen opgeruimd. Journalen van een proces dat
/// nog leeft (een tweede app-venster), met hun tussenmap en back-up, blijven
/// staan. Achtergebleven tussenmappen en back-ups zonder journaal verdwijnen.
pub fn herstel_in(map: &Path) -> Value {
    met_wisselslot(|| {
        let mut teruggedraaid = Vec::new();
        let mut bevestigd = Vec::new();
        let mut overgeslagen = 0;
        let mut problemen = Vec::new();
        let items: Vec<_> = fs::read_dir(map.join(TRANSACTIES)).map(|it| it.flatten().collect()).unwrap_or_default();
        for item in items {
            let naam = item.file_name().to_string_lossy().to_string();
            if let Some(token) = naam.strip_suffix(".json") {
                let journaal = lees_json(&item.path(), 64 * 1024);
                if journaal.as_ref().map_or(false, |j| eigenaar_leeft(map, j)) {
                    overgeslagen += 1;
                    continue;
                }
                if journaal.as_ref().and_then(|j| j.get("fase")).and_then(|v| v.as_str()) == Some("bevestigd") {
                    if controleer_token(token).is_ok() {
                        ruim_bevestigd_op(map, token);
                        bevestigd.push(json!({ "id": journaal.as_ref().and_then(|j| j.get("id")).cloned() }));
                    }
                    continue;
                }
                match draai_terug_onder_slot(map, token) {
                    Ok(v) => teruggedraaid.push(v),
                    Err(f) => problemen.push(json!({ "folder": naam, "code": f.code, "message": f.message })),
                }
            } else if naam.ends_with(".tmp") && is_oud(&item.path()) {
                let _ = fs::remove_file(item.path());
            } else if let Some(eigenaar) = naam.strip_suffix(".levend") {
                // Van een proces dat niet meer bestaat: een levend proces houdt
                // het bestand exclusief open, en dan lukt verwijderen niet.
                if eigenaar != eigen_eigenaar() {
                    let _ = fs::remove_file(item.path());
                }
            }
        }
        let open: Vec<String> = fs::read_dir(map.join(TRANSACTIES))
            .map(|it| it.flatten().filter_map(|i| i.file_name().to_string_lossy().strip_suffix(".json").map(String::from)).collect())
            .unwrap_or_default();
        let mut opgeruimd = 0;
        for submap in [STAGING, BACKUP] {
            if let Ok(items) = fs::read_dir(map.join(submap)) {
                for item in items.flatten() {
                    let naam = item.file_name().to_string_lossy().to_string();
                    if open.contains(&naam) {
                        continue;
                    }
                    if verwijder_pad(&item.path()).is_ok() {
                        opgeruimd += 1;
                    }
                }
            }
        }
        json!({ "rolledBack": teruggedraaid, "confirmed": bevestigd, "skipped": overgeslagen, "removed": opgeruimd, "problems": problemen })
    })
}

/// De geïnstalleerde extensies, met kapotte mappen apart in `problems`.
pub fn lijst_in(map: &Path) -> Value {
    let mut extensies = Vec::new();
    let mut problemen = Vec::new();
    let mut items: Vec<_> = fs::read_dir(map).map(|it| it.flatten().collect()).unwrap_or_default();
    items.sort_by_key(|i| i.file_name());
    for item in items {
        let map_naam = item.file_name().to_string_lossy().to_string();
        if map_naam.starts_with('.') || !item.path().is_dir() {
            continue;
        }
        let probleem = |code: &str, message: String| json!({ "folder": map_naam, "code": code, "message": message });
        let dir = item.path();
        let manifest_pad = dir.join("plugin.json");
        if !manifest_pad.is_file() {
            problemen.push(probleem("MANIFEST_INVALID", "plugin.json is missing".into()));
            continue;
        }
        let Some(manifest) = lees_json(&manifest_pad, MAX_MANIFEST) else {
            problemen.push(probleem("MANIFEST_INVALID", "plugin.json is not valid JSON or too large".into()));
            continue;
        };
        let Some(id) = manifest.get("id").and_then(|v| v.as_str()) else {
            problemen.push(probleem("MANIFEST_INVALID", "plugin.json has no string id".into()));
            continue;
        };
        if id != map_naam {
            problemen.push(probleem("MANIFEST_INVALID", format!("plugin.json id \"{id}\" does not match the folder")));
            continue;
        }
        let strikt = is_strikt_id(id);
        if !strikt && !is_legacy_id(id) {
            problemen.push(probleem("MANIFEST_INVALID", format!("invalid extension id \"{id}\"")));
            continue;
        }
        if !dir.join("index.js").is_file() {
            problemen.push(probleem("ENTRY_MISSING", "index.js is missing".into()));
            continue;
        }
        let meta = lees_json(&dir.join(META), MAX_MANIFEST);
        let tekst = |v: &Value, k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
        extensies.push(json!({
            "id": id,
            "name": tekst(&manifest, "name"),
            "version": tekst(&manifest, "version"),
            "description": tekst(&manifest, "description"),
            "author": tekst(&manifest, "author"),
            "sha256": meta.as_ref().and_then(|m| tekst(m, "sha256")),
            "source": meta.as_ref().and_then(|m| tekst(m, "source")),
            "legacyId": !strikt,
        }));
    }
    json!({ "extensions": extensies, "problems": problemen })
}

// ─── Tauri-commando's ────────────────────────────────────────────────────

/// `{ extensions, problems }`. Met `herstel: true` eerst het herstel na een
/// onderbreking (bij het opstarten).
#[tauri::command]
pub fn extensie_lijst(herstel: Option<bool>) -> Result<Value, String> {
    let map = plugins_map();
    let mut uit = lijst_in_met_herstel(&map, herstel.unwrap_or(false));
    if let Some(o) = uit.as_object_mut() {
        o.entry("recovered").or_insert(Value::Null);
    }
    Ok(uit)
}

fn lijst_in_met_herstel(map: &Path, herstel: bool) -> Value {
    let hersteld = if herstel { Some(herstel_in(map)) } else { None };
    let mut lijst = lijst_in(map);
    if let (Some(h), Some(o)) = (hersteld, lijst.as_object_mut()) {
        o.insert("recovered".into(), h);
    }
    lijst
}

/// Pakketcontrole zonder iets te schrijven. `bron` (`ui` of `mcp`) bepaalt de
/// padregels: alleen de bestandsdialoog mag een netwerkshare gebruiken.
#[tauri::command]
pub fn extensie_inspecteer(pad: String, bron: Option<String>) -> Result<Value, String> {
    let map = plugins_map();
    inspecteer_pakket(&pad, Bron::uit(bron.as_deref()), Some(&map))
        .map(|(info, _)| info.als_json())
        .map_err(|f| f.als_json())
}

/// Installeer volgens het vervangbeleid; de uitkomst is `installed`, `updated`
/// of `unchanged`, met een transactie die bevestigd of teruggedraaid moet worden.
#[tauri::command]
pub fn extensie_installeer(pad: String, beleid: String, verwachte_sha256: Option<String>, bron: Option<String>) -> Result<Value, String> {
    let beleid = beleid_uit(&beleid).map_err(|f| f.als_json())?;
    let bron = Bron::uit(bron.as_deref()).naam();
    installeer_in(&plugins_map(), &pad, beleid, verwachte_sha256.as_deref(), bron).map_err(|f| f.als_json())
}

#[tauri::command]
pub fn extensie_bevestig(transactie: String) -> Result<Value, String> {
    bevestig_in(&plugins_map(), &transactie).map_err(|f| f.als_json())
}

#[tauri::command]
pub fn extensie_terugdraaien(transactie: String) -> Result<Value, String> {
    terugdraaien_in(&plugins_map(), &transactie).map_err(|f| f.als_json())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn tijdelijke_map(naam: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("opds-ext-{naam}-{}", nieuw_token()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn zip_bytes(items: &[(&str, &str)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opties = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (naam, inhoud) in items {
            if naam.ends_with('/') {
                w.add_directory(naam.trim_end_matches('/'), opties).unwrap();
            } else {
                w.start_file(*naam, opties).unwrap();
                w.write_all(inhoud.as_bytes()).unwrap();
            }
        }
        w.finish().unwrap().into_inner()
    }

    fn pakket(id: &str, versie: &str, code: &str) -> Vec<u8> {
        zip_bytes(&[
            ("plugin.json", &format!(r#"{{"id":"{id}","name":"Test","version":"{versie}"}}"#)),
            ("index.js", code),
        ])
    }

    fn schrijf_pakket(map: &Path, naam: &str, bytes: &[u8]) -> String {
        let pad = map.join(naam);
        fs::write(&pad, bytes).unwrap();
        pad.to_string_lossy().to_string()
    }

    /// Doe alsof het proces dat dit journaal schreef niet meer bestaat.
    fn verweesd(map: &Path, token: &str) {
        let pad = journaal_pad(map, token);
        let mut j = lees_json(&pad, 64 * 1024).unwrap();
        let o = j.as_object_mut().unwrap();
        o.remove("eigenaar");
        o.remove("pid");
        fs::write(&pad, j.to_string()).unwrap();
    }

    fn open_journalen(map: &Path) -> Vec<String> {
        fs::read_dir(map.join(TRANSACTIES))
            .map(|it| it.flatten().filter_map(|i| i.file_name().to_string_lossy().strip_suffix(".json").map(String::from)).collect())
            .unwrap_or_default()
    }

    fn aantal_in(map: &Path, submap: &str) -> usize {
        fs::read_dir(map.join(submap)).map(|it| it.count()).unwrap_or(0)
    }

    fn index_js(map: &Path, id: &str) -> String {
        fs::read_to_string(map.join(id).join("index.js")).unwrap()
    }

    /// Installeer en bevestig; geeft niets terug.
    fn installeer_bevestigd(map: &Path, pad: &str) {
        let r = installeer_in(map, pad, Beleid::Always, None, "ui").unwrap();
        bevestig_in(map, r["transactie"].as_str().unwrap()).unwrap();
    }

    #[test]
    fn id_regel() {
        for id in ["", ".", "..", "C:", "C:x", "a/b", "con", "con.x", "A", "-a", "a-", "a..b", "nul", "lpt9.x"] {
            assert!(!is_strikt_id(id), "{id} hoort geweigerd te worden");
            assert!(valideer_extensie_id(id).is_err());
        }
        for id in ["a", "nl.voorbeeld.kozijnen", "a-b.c1", "com0", "x.con"] {
            assert!(is_strikt_id(id), "{id} hoort geaccepteerd te worden");
        }
        assert!(!is_strikt_id(&"a".repeat(65)));
        // Oude id's: één gewone mapnaam.
        assert!(is_legacy_id("Mijn_Plugin v2"));
        for id in ["", ".", "..", "C:", "a/b", "a\\b", ".verborgen", "con", "x."] {
            assert!(!is_legacy_id(id), "{id} is geen veilig oud id");
            assert!(controleer_bestaand_id(id).is_err());
        }
    }

    #[test]
    fn padregels() {
        let map = tijdelijke_map("pad");
        let pad = schrijf_pakket(&map, "a.oppx", &pakket("nl.a", "1.0.0", "export function activate() {}"));
        assert!(controleer_pad(&pad, Bron::Mcp).is_ok());
        let hoofd = schrijf_pakket(&map, "B.OPPX", &pakket("nl.a", "1.0.0", "x"));
        assert!(controleer_pad(&hoofd, Bron::Mcp).is_ok(), "extensie hoofdletterongevoelig");
        for slecht in ["relatief.oppx", "\\\\server\\share\\a.oppx", "//server/share/a.oppx", "\\\\?\\C:\\a.oppx",
                       "\\\\.\\C:\\a.oppx", "https://example.com/a.oppx", "file:///C:/a.oppx", ""] {
            assert_eq!(controleer_pad(slecht, Bron::Mcp).unwrap_err().code, "PATH_NOT_ALLOWED", "{slecht}");
        }
        let zip = schrijf_pakket(&map, "a.zip", b"x");
        assert_eq!(controleer_pad(&zip, Bron::Mcp).unwrap_err().code, "PATH_NOT_ALLOWED");
        let weg = map.join("bestaat-niet.oppx");
        assert_eq!(controleer_pad(&weg.to_string_lossy(), Bron::Mcp).unwrap_err().code, "FILE_NOT_FOUND");
        let mapje = map.join("map.oppx");
        fs::create_dir_all(&mapje).unwrap();
        assert_eq!(controleer_pad(&mapje.to_string_lossy(), Bron::Mcp).unwrap_err().code, "FILE_NOT_FOUND");
        let _ = fs::remove_dir_all(&map);
    }

    #[test]
    fn zip_slip_symlinks_en_gereserveerde_namen() {
        let slip = zip_bytes(&[("plugin.json", r#"{"id":"nl.a"}"#), ("index.js", "x"), ("../buiten.txt", "x")]);
        assert_eq!(inspecteer_bytes(&slip).unwrap_err().code, "PACKAGE_INVALID");
        let slip2 = zip_bytes(&[("plugin.json", r#"{"id":"nl.a"}"#), ("index.js", "x"), ("a/../../b", "x")]);
        assert_eq!(inspecteer_bytes(&slip2).unwrap_err().code, "PACKAGE_INVALID");
        let absoluut = zip_bytes(&[("plugin.json", r#"{"id":"nl.a"}"#), ("index.js", "x"), ("/etc/x", "x")]);
        assert_eq!(inspecteer_bytes(&absoluut).unwrap_err().code, "PACKAGE_INVALID");
        let station = zip_bytes(&[("plugin.json", r#"{"id":"nl.a"}"#), ("index.js", "x"), ("C:/x", "x")]);
        assert_eq!(inspecteer_bytes(&station).unwrap_err().code, "PACKAGE_INVALID");
        let gereserveerd = zip_bytes(&[("plugin.json", r#"{"id":"nl.a"}"#), ("index.js", "x"), (".opds-installatie.json", "{}")]);
        assert_eq!(inspecteer_bytes(&gereserveerd).unwrap_err().code, "PACKAGE_INVALID");
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opties = SimpleFileOptions::default();
        w.start_file("plugin.json", opties).unwrap();
        w.write_all(br#"{"id":"nl.a"}"#).unwrap();
        w.start_file("index.js", opties).unwrap();
        w.write_all(b"x").unwrap();
        w.add_symlink("link", "../../buiten", opties).unwrap();
        let symlink = w.finish().unwrap().into_inner();
        assert_eq!(inspecteer_bytes(&symlink).unwrap_err().code, "PACKAGE_INVALID");
        assert_eq!(inspecteer_bytes(b"geen zip").unwrap_err().code, "PACKAGE_INVALID");
    }

    #[test]
    fn manifest_en_ingang() {
        let zonder_manifest = zip_bytes(&[("index.js", "x")]);
        assert_eq!(inspecteer_bytes(&zonder_manifest).unwrap_err().code, "MANIFEST_INVALID");
        let geen_json = zip_bytes(&[("plugin.json", "{kapot"), ("index.js", "x")]);
        assert_eq!(inspecteer_bytes(&geen_json).unwrap_err().code, "MANIFEST_INVALID");
        let geen_object = zip_bytes(&[("plugin.json", "[1]"), ("index.js", "x")]);
        assert_eq!(inspecteer_bytes(&geen_object).unwrap_err().code, "MANIFEST_INVALID");
        let slecht_id = zip_bytes(&[("plugin.json", r#"{"id":"C:"}"#), ("index.js", "x")]);
        assert_eq!(inspecteer_bytes(&slecht_id).unwrap_err().code, "MANIFEST_INVALID");
        let slechte_versie = zip_bytes(&[("plugin.json", r#"{"id":"nl.a","version":1}"#), ("index.js", "x")]);
        assert_eq!(inspecteer_bytes(&slechte_versie).unwrap_err().code, "MANIFEST_INVALID");
        let zonder_ingang = zip_bytes(&[("plugin.json", r#"{"id":"nl.a"}"#), ("src/index.js", "x")]);
        assert_eq!(inspecteer_bytes(&zonder_ingang).unwrap_err().code, "ENTRY_MISSING");
        let goed = pakket("nl.a", "1.2.3", "export function activate() {}");
        let info = inspecteer_bytes(&goed).unwrap();
        assert_eq!(info.id, "nl.a");
        assert_eq!(info.version.as_deref(), Some("1.2.3"));
        assert_eq!(info.entries, 2);
        assert_eq!(info.sha256.len(), 64);
        assert_eq!(info.sha256, sha256_hex(&goed));
    }

    #[test]
    fn limieten() {
        let veel: Vec<(String, String)> = (0..=MAX_ITEMS).map(|i| (format!("f{i}.txt"), String::new())).collect();
        let mut items: Vec<(&str, &str)> = vec![("plugin.json", r#"{"id":"nl.a"}"#), ("index.js", "x")];
        items.extend(veel.iter().map(|(a, b)| (a.as_str(), b.as_str())));
        assert_eq!(inspecteer_bytes(&zip_bytes(&items)).unwrap_err().code, "PACKAGE_INVALID");
        let groot_manifest = format!(r#"{{"id":"nl.a","x":"{}"}}"#, "a".repeat(MAX_MANIFEST as usize));
        let te_groot = zip_bytes(&[("plugin.json", &groot_manifest), ("index.js", "x")]);
        assert_eq!(inspecteer_bytes(&te_groot).unwrap_err().code, "MANIFEST_INVALID");
        let lang = vec![0u8; (MAX_PAKKET + 1) as usize];
        assert_eq!(inspecteer_bytes(&lang).unwrap_err().code, "PACKAGE_INVALID");
    }

    #[test]
    fn versievergelijking() {
        use Ordering::*;
        assert_eq!(vergelijk_versies("1.1.0", "1.0.9"), Some(Greater));
        assert_eq!(vergelijk_versies("1.0.0", "1.0.0"), Some(Equal));
        assert_eq!(vergelijk_versies("2.0.0", "10.0.0"), Some(Less));
        assert_eq!(vergelijk_versies("1.0.0-alpha", "1.0.0"), Some(Less));
        assert_eq!(vergelijk_versies("1.0.0-alpha.1", "1.0.0-alpha"), Some(Greater));
        assert_eq!(vergelijk_versies("1.0.0-alpha.beta", "1.0.0-alpha.1"), Some(Greater));
        assert_eq!(vergelijk_versies("1.0.0-beta.2", "1.0.0-beta.11"), Some(Less));
        assert_eq!(vergelijk_versies("1.0.0+build.5", "1.0.0"), Some(Equal));
        assert_eq!(vergelijk_versies("1.0", "1.0.0"), None);
        assert_eq!(vergelijk_versies("01.0.0", "1.0.0"), None);
        assert_eq!(vergelijk_versies("x", "1.0.0"), None);
    }

    #[test]
    fn beleidstabel() {
        use Beslissing::*;
        let oud = Bestaand { sha256: Some("aaa".into()), version: Some("1.0.0".into()) };
        for b in [Beleid::Never, Beleid::IfNewer, Beleid::Always] {
            assert_eq!(beslis(b, None, "bbb", Some("1.0.0")).unwrap(), Installeren);
            assert_eq!(beslis(b, Some(&oud), "aaa", Some("9.0.0")).unwrap(), Ongewijzigd);
        }
        assert_eq!(beslis(Beleid::Never, Some(&oud), "bbb", Some("2.0.0")).unwrap_err().code, "ALREADY_INSTALLED");
        assert_eq!(beslis(Beleid::IfNewer, Some(&oud), "bbb", Some("1.1.0")).unwrap(), Bijwerken);
        assert_eq!(beslis(Beleid::IfNewer, Some(&oud), "bbb", Some("1.0.0")).unwrap_err().code, "VERSION_NOT_NEWER");
        assert_eq!(beslis(Beleid::IfNewer, Some(&oud), "bbb", Some("0.9.0")).unwrap_err().code, "VERSION_NOT_NEWER");
        assert_eq!(beslis(Beleid::IfNewer, Some(&oud), "bbb", None).unwrap_err().code, "VERSION_UNCOMPARABLE");
        assert_eq!(beslis(Beleid::IfNewer, Some(&oud), "bbb", Some("nieuw")).unwrap_err().code, "VERSION_UNCOMPARABLE");
        assert_eq!(beslis(Beleid::Always, Some(&oud), "bbb", Some("0.1.0")).unwrap(), Bijwerken);
        // Een oude installatie zonder metadata telt als een ander pakket.
        let zonder_meta = Bestaand { sha256: None, version: Some("1.0.0".into()) };
        assert_eq!(beslis(Beleid::Never, Some(&zonder_meta), "aaa", None).unwrap_err().code, "ALREADY_INSTALLED");
        assert!(beleid_uit("sometimes").is_err());
    }

    #[test]
    fn wissel_met_bevestigen_en_terugdraaien() {
        let map = tijdelijke_map("wissel");
        let bron = tijdelijke_map("wissel-bron");
        let v1 = schrijf_pakket(&bron, "v1.oppx", &pakket("nl.a", "1.0.0", "// een"));
        let v2 = schrijf_pakket(&bron, "v2.oppx", &pakket("nl.a", "1.1.0", "// twee"));

        // Eerste installatie, bevestigd.
        let r = installeer_in(&map, &v1, Beleid::Never, None, "mcp").unwrap();
        assert_eq!(r["outcome"], "installed");
        let t1 = r["transactie"].as_str().unwrap().to_string();
        assert!(journaal_pad(&map, &t1).exists());
        bevestig_in(&map, &t1).unwrap();
        assert!(!journaal_pad(&map, &t1).exists());
        assert_eq!(fs::read_to_string(map.join("nl.a").join("index.js")).unwrap(), "// een");
        let meta = lees_json(&map.join("nl.a").join(META), 4096).unwrap();
        assert_eq!(meta["source"], "mcp");
        assert_eq!(meta["version"], "1.0.0");

        // Hetzelfde pakket: unchanged, niets geschreven.
        let zelfde = installeer_in(&map, &v1, Beleid::Never, None, "mcp").unwrap();
        assert_eq!(zelfde["outcome"], "unchanged");
        assert!(zelfde["transactie"].is_null());
        // Verwachte hash klopt niet.
        assert_eq!(installeer_in(&map, &v2, Beleid::Always, Some("00"), "ui").unwrap_err().code, "PACKAGE_CHANGED");
        assert_eq!(installeer_in(&map, &v2, Beleid::Never, None, "ui").unwrap_err().code, "ALREADY_INSTALLED");

        // Bijwerken en terugdraaien: 1.0.0 staat er weer.
        let r2 = installeer_in(&map, &v2, Beleid::IfNewer, None, "mcp").unwrap();
        assert_eq!(r2["outcome"], "updated");
        assert_eq!(r2["previousVersion"], "1.0.0");
        let t2 = r2["transactie"].as_str().unwrap().to_string();
        assert_eq!(fs::read_to_string(map.join("nl.a").join("index.js")).unwrap(), "// twee");
        assert!(map.join(BACKUP).join(&t2).exists());
        let terug = terugdraaien_in(&map, &t2).unwrap();
        assert_eq!(terug["restoredVersion"], "1.0.0");
        assert_eq!(fs::read_to_string(map.join("nl.a").join("index.js")).unwrap(), "// een");
        assert!(!map.join(BACKUP).join(&t2).exists());
        assert!(!journaal_pad(&map, &t2).exists());
        assert_eq!(terugdraaien_in(&map, &t2).unwrap_err().code, "TRANSACTION_UNKNOWN");
        assert_eq!(bevestig_in(&map, "../../x").unwrap_err().code, "TRANSACTION_UNKNOWN");

        // Bijwerken en bevestigen: back-up weg.
        let r3 = installeer_in(&map, &v2, Beleid::Always, None, "ui").unwrap();
        let t3 = r3["transactie"].as_str().unwrap().to_string();
        bevestig_in(&map, &t3).unwrap();
        assert!(!map.join(BACKUP).join(&t3).exists());
        assert_eq!(fs::read_to_string(map.join("nl.a").join("index.js")).unwrap(), "// twee");
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn eerste_installatie_terugdraaien_laat_niets_achter() {
        let map = tijdelijke_map("eerste");
        let bron = tijdelijke_map("eerste-bron");
        let v1 = schrijf_pakket(&bron, "v1.oppx", &pakket("nl.b", "1.0.0", "// een"));
        let r = installeer_in(&map, &v1, Beleid::Always, None, "mcp").unwrap();
        let t = r["transactie"].as_str().unwrap().to_string();
        let terug = terugdraaien_in(&map, &t).unwrap();
        assert!(terug["restoredVersion"].is_null());
        assert!(!map.join("nl.b").exists());
        assert_eq!(lijst_in(&map)["extensions"].as_array().unwrap().len(), 0);
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn herstel_van_een_onbevestigd_journaal() {
        let map = tijdelijke_map("herstel");
        let bron = tijdelijke_map("herstel-bron");
        let v1 = schrijf_pakket(&bron, "v1.oppx", &pakket("nl.c", "1.0.0", "// een"));
        let v2 = schrijf_pakket(&bron, "v2.oppx", &pakket("nl.c", "2.0.0", "// twee"));
        let t1 = installeer_in(&map, &v1, Beleid::Always, None, "ui").unwrap()["transactie"].as_str().unwrap().to_string();
        bevestig_in(&map, &t1).unwrap();
        // "Crash" na de wissel, vóór de bevestiging: het proces bestaat niet meer.
        let t2 = installeer_in(&map, &v2, Beleid::Always, None, "ui").unwrap()["transactie"].as_str().unwrap().to_string();
        verweesd(&map, &t2);
        // Ook een achtergebleven tussenmap en een wees-back-up.
        fs::create_dir_all(map.join(STAGING).join("0123456789abcdef0123456789abcdef")).unwrap();
        fs::create_dir_all(map.join(BACKUP).join("fedcba9876543210fedcba9876543210")).unwrap();
        let h = herstel_in(&map);
        assert_eq!(h["rolledBack"].as_array().unwrap().len(), 1);
        assert_eq!(h["removed"], 2);
        assert_eq!(fs::read_to_string(map.join("nl.c").join("index.js")).unwrap(), "// een");
        assert!(open_journalen(&map).is_empty());

        // Een onderbreking tussen "oud weg" en "nieuw op zijn plek".
        let token = "00000000000000000000000000000001";
        fs::create_dir_all(map.join(BACKUP)).unwrap();
        fs::rename(map.join("nl.c"), map.join(BACKUP).join(token)).unwrap();
        schrijf_journaal(&map, token, "nl.c", "oud-weg", true).unwrap();
        verweesd(&map, token);
        herstel_in(&map);
        assert_eq!(fs::read_to_string(map.join("nl.c").join("index.js")).unwrap(), "// een");

        // Een onderbreking vóór er iets verplaatst is.
        let token2 = "00000000000000000000000000000002";
        schrijf_journaal(&map, token2, "nl.c", "voorbereid", true).unwrap();
        verweesd(&map, token2);
        fs::create_dir_all(map.join(STAGING).join(token2)).unwrap();
        herstel_in(&map);
        assert_eq!(fs::read_to_string(map.join("nl.c").join("index.js")).unwrap(), "// een", "de oude blijft staan");
        assert!(!map.join(STAGING).join(token2).exists());
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn lijst_toont_kapotte_mappen_als_probleem() {
        let map = tijdelijke_map("lijst");
        let goed = map.join("nl.goed");
        fs::create_dir_all(&goed).unwrap();
        fs::write(goed.join("plugin.json"), r#"{"id":"nl.goed","name":"Goed","version":"1.0.0"}"#).unwrap();
        fs::write(goed.join("index.js"), "x").unwrap();
        let oud = map.join("Oude_Plugin");
        fs::create_dir_all(&oud).unwrap();
        fs::write(oud.join("plugin.json"), r#"{"id":"Oude_Plugin"}"#).unwrap();
        fs::write(oud.join("index.js"), "x").unwrap();
        let kapot = map.join("kapot");
        fs::create_dir_all(&kapot).unwrap();
        fs::write(kapot.join("plugin.json"), "{kapot").unwrap();
        let anders = map.join("anders");
        fs::create_dir_all(&anders).unwrap();
        fs::write(anders.join("plugin.json"), r#"{"id":"iets.anders"}"#).unwrap();
        let zonder = map.join("nl.zonder");
        fs::create_dir_all(&zonder).unwrap();
        fs::write(zonder.join("plugin.json"), r#"{"id":"nl.zonder"}"#).unwrap();
        fs::create_dir_all(map.join(STAGING)).unwrap();
        let l = lijst_in(&map);
        let ids: Vec<&str> = l["extensions"].as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["Oude_Plugin", "nl.goed"]);
        assert_eq!(l["extensions"][0]["legacyId"], true);
        assert_eq!(l["extensions"][1]["legacyId"], false);
        let problemen: Vec<(String, String)> = l["problems"].as_array().unwrap().iter()
            .map(|p| (p["folder"].as_str().unwrap().to_string(), p["code"].as_str().unwrap().to_string())).collect();
        assert_eq!(problemen, vec![
            ("anders".to_string(), "MANIFEST_INVALID".to_string()),
            ("kapot".to_string(), "MANIFEST_INVALID".to_string()),
            ("nl.zonder".to_string(), "ENTRY_MISSING".to_string()),
        ]);
        let _ = fs::remove_dir_all(&map);
    }

    #[test]
    fn fout_als_json() {
        let f = Fout::new("PACKAGE_INVALID", "x \"y\"");
        let v: Value = serde_json::from_str(&f.als_json()).unwrap();
        assert_eq!(v["code"], "PACKAGE_INVALID");
        assert_eq!(v["message"], "x \"y\"");
        assert!(nu_iso().ends_with('Z') && nu_iso().len() == 20);
    }

    #[test]
    fn netwerkpaden_alleen_via_de_dialoog() {
        // Tekstueel: een UNC-pad alleen via de bestandsdialoog; apparaatpaden nooit.
        for p in ["\\\\server\\share\\a.oppx", "//server/share/a.oppx"] {
            assert_eq!(pad_toegestaan(p, Bron::Mcp).unwrap_err().code, "PATH_NOT_ALLOWED", "{p}");
            assert!(pad_toegestaan(p, Bron::Ui).is_ok(), "{p} via de dialoog");
        }
        for p in ["\\\\?\\C:\\a.oppx", "\\\\.\\C:\\a.oppx", "//?/C:/a.oppx", "//./C:/a.oppx"] {
            for b in [Bron::Mcp, Bron::Ui] {
                assert_eq!(pad_toegestaan(p, b).unwrap_err().code, "PATH_NOT_ALLOWED", "{p} {b:?}");
            }
        }
        assert_eq!(Bron::uit(Some("mcp")), Bron::Mcp);
        assert_eq!(Bron::uit(Some("ui")), Bron::Ui);
        assert_eq!(Bron::uit(None), Bron::Ui);
        // Na canonicalize wordt een netwerkschijf met een stationsletter een
        // \\?\UNC\-pad: via MCP geweigerd, via de dialoog goed.
        #[cfg(windows)]
        {
            let unc = Path::new(r"\\?\UNC\192.168.10.10\deel\a.oppx");
            assert!(is_netwerkpad(unc));
            assert!(is_netwerkpad(Path::new(r"\\server\share\a.oppx")));
            assert!(!is_netwerkpad(Path::new(r"\\?\C:\map\a.oppx")));
            assert!(!is_netwerkpad(Path::new(r"C:\map\a.oppx")));
            assert_eq!(echt_pad_toegestaan(unc, Bron::Mcp).unwrap_err().code, "PATH_NOT_ALLOWED");
            assert!(echt_pad_toegestaan(unc, Bron::Ui).is_ok());
            assert!(echt_pad_toegestaan(Path::new(r"\\?\C:\map\a.oppx"), Bron::Mcp).is_ok());
        }
    }

    #[test]
    fn dubbele_items_die_alleen_in_hoofdletters_verschillen() {
        let manifest = zip_bytes(&[
            ("plugin.json", r#"{"id":"nl.d","version":"2.0.0"}"#), ("index.js", "x"), ("PLUGIN.JSON", r#"{"id":"iets.anders"}"#),
        ]);
        assert_eq!(inspecteer_bytes(&manifest).unwrap_err().code, "PACKAGE_INVALID");
        let ingang = zip_bytes(&[("plugin.json", r#"{"id":"nl.d"}"#), ("index.js", "x"), ("INDEX.JS", "y")]);
        assert_eq!(inspecteer_bytes(&ingang).unwrap_err().code, "PACKAGE_INVALID");
        let dieper = zip_bytes(&[("plugin.json", r#"{"id":"nl.d"}"#), ("index.js", "x"), ("lib/a.js", "1"), ("LIB/A.js", "2")]);
        assert_eq!(inspecteer_bytes(&dieper).unwrap_err().code, "PACKAGE_INVALID");
        let map = tijdelijke_map("dubbel");
        // Ook het uitpakken weigert het.
        assert_eq!(pak_uit(&manifest, &map.join("uit")).unwrap_err().code, "PACKAGE_INVALID");
        // Over een werkende installatie heen: die blijft staan.
        let bron = tijdelijke_map("dubbel-bron");
        installeer_bevestigd(&map, &schrijf_pakket(&bron, "v1.oppx", &pakket("nl.d", "1.0.0", "// een")));
        let kwaad = schrijf_pakket(&bron, "kwaad.oppx", &manifest);
        assert_eq!(installeer_in(&map, &kwaad, Beleid::Always, None, "ui").unwrap_err().code, "PACKAGE_INVALID");
        let op_schijf = lees_json(&map.join("nl.d").join("plugin.json"), 4096).unwrap();
        assert_eq!(op_schijf["id"], "nl.d");
        assert_eq!(index_js(&map, "nl.d"), "// een");
        assert_eq!(aantal_in(&map, BACKUP), 0);
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn id_dat_alleen_in_hoofdletters_verschilt() {
        let map = tijdelijke_map("hoofdletters");
        let bron = tijdelijke_map("hoofdletters-bron");
        let oud = map.join("Nl.A");
        fs::create_dir_all(&oud).unwrap();
        fs::write(oud.join("plugin.json"), r#"{"id":"Nl.A","version":"1.0.0"}"#).unwrap();
        fs::write(oud.join("index.js"), "// oud").unwrap();
        let nieuw = schrijf_pakket(&bron, "a.oppx", &pakket("nl.a", "2.0.0", "// nieuw"));
        for b in ["mcp", "ui"] {
            let f = installeer_in(&map, &nieuw, Beleid::Always, None, b).unwrap_err();
            assert_eq!(f.code, "ID_CASE_CONFLICT");
            assert!(f.message.contains("Nl.A"), "{}", f.message);
        }
        let namen: Vec<String> = fs::read_dir(&map).unwrap().flatten()
            .map(|i| i.file_name().to_string_lossy().to_string()).filter(|n| !n.starts_with('.')).collect();
        assert_eq!(namen, vec!["Nl.A".to_string()]);
        assert_eq!(fs::read_to_string(oud.join("index.js")).unwrap(), "// oud");
        assert!(open_journalen(&map).is_empty());
        assert_eq!(aantal_in(&map, STAGING), 0);
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn oud_id_bijwerken() {
        let map = tijdelijke_map("oud-id");
        let bron = tijdelijke_map("oud-id-bron");
        let oud = map.join("Oude_Plugin");
        fs::create_dir_all(&oud).unwrap();
        fs::write(oud.join("plugin.json"), r#"{"id":"Oude_Plugin","version":"1.0.0"}"#).unwrap();
        fs::write(oud.join("index.js"), "// een").unwrap();
        let v2 = schrijf_pakket(&bron, "v2.oppx", &pakket("Oude_Plugin", "2.0.0", "// twee"));
        // Zonder bestaande installatie blijft een oud id geweigerd.
        assert_eq!(inspecteer_pakket(&v2, Bron::Ui, None).unwrap_err().code, "MANIFEST_INVALID");
        let leeg = tijdelijke_map("oud-id-leeg");
        assert_eq!(installeer_in(&leeg, &v2, Beleid::Always, None, "ui").unwrap_err().code, "MANIFEST_INVALID");
        // Met precies die map mag het pakket haar bijwerken (ook via het paneel).
        assert_eq!(inspecteer_pakket(&v2, Bron::Ui, Some(&map)).unwrap().0.id, "Oude_Plugin");
        let r = installeer_in(&map, &v2, Beleid::Always, None, "ui").unwrap();
        assert_eq!(r["outcome"], "updated");
        assert_eq!(r["previousVersion"], "1.0.0");
        bevestig_in(&map, r["transactie"].as_str().unwrap()).unwrap();
        assert_eq!(index_js(&map, "Oude_Plugin"), "// twee");
        assert_eq!(lijst_in(&map)["extensions"][0]["legacyId"], true);
        // Een oud id dat alleen in hoofdletters van de map afwijkt, telt niet.
        let anders = schrijf_pakket(&bron, "v3.oppx", &pakket("oude_plugin", "3.0.0", "x"));
        assert_eq!(installeer_in(&map, &anders, Beleid::Always, None, "ui").unwrap_err().code, "MANIFEST_INVALID");
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&leeg);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn bevestigen_legt_eerst_vast_en_het_herstel_draait_dat_niet_terug() {
        let map = tijdelijke_map("bevestigd");
        let bron = tijdelijke_map("bevestigd-bron");
        installeer_bevestigd(&map, &schrijf_pakket(&bron, "v1.oppx", &pakket("nl.e", "1.0.0", "// een")));
        let v2 = schrijf_pakket(&bron, "v2.oppx", &pakket("nl.e", "2.0.0", "// twee"));
        let t2 = installeer_in(&map, &v2, Beleid::Always, None, "mcp").unwrap()["transactie"].as_str().unwrap().to_string();
        // Een bevestiging die na het vastleggen stopte: journaal 'bevestigd', back-up nog aanwezig.
        schrijf_journaal(&map, &t2, "nl.e", "bevestigd", true).unwrap();
        verweesd(&map, &t2);
        assert!(map.join(BACKUP).join(&t2).exists());
        let h = herstel_in(&map);
        assert_eq!(h["rolledBack"].as_array().unwrap().len(), 0, "niet teruggedraaid");
        assert_eq!(h["confirmed"].as_array().unwrap().len(), 1);
        assert_eq!(index_js(&map, "nl.e"), "// twee");
        assert!(!map.join(BACKUP).join(&t2).exists());
        assert!(open_journalen(&map).is_empty());
        // Bevestigen ruimt alles op; een tweede keer is de transactie onbekend.
        let v3 = schrijf_pakket(&bron, "v3.oppx", &pakket("nl.e", "3.0.0", "// drie"));
        let t3 = installeer_in(&map, &v3, Beleid::Always, None, "mcp").unwrap()["transactie"].as_str().unwrap().to_string();
        bevestig_in(&map, &t3).unwrap();
        assert!(open_journalen(&map).is_empty());
        assert_eq!(aantal_in(&map, BACKUP), 0);
        assert_eq!(bevestig_in(&map, &t3).unwrap_err().code, "TRANSACTION_UNKNOWN");
        assert_eq!(terugdraaien_in(&map, &t3).unwrap_err().code, "TRANSACTION_UNKNOWN");
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Een vergrendeld journaal: bevestigen mislukt en de transactie blijft open.
            let v4 = schrijf_pakket(&bron, "v4.oppx", &pakket("nl.e", "4.0.0", "// vier"));
            let t4 = installeer_in(&map, &v4, Beleid::Always, None, "mcp").unwrap()["transactie"].as_str().unwrap().to_string();
            let slot = fs::OpenOptions::new().read(true).share_mode(0).open(journaal_pad(&map, &t4)).unwrap();
            assert!(bevestig_in(&map, &t4).is_err());
            drop(slot);
            assert!(journaal_pad(&map, &t4).exists());
            // De levenscyclus draait dan bewust terug.
            terugdraaien_in(&map, &t4).unwrap();
            assert_eq!(index_js(&map, "nl.e"), "// drie");
        }
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn een_open_transactie_voor_hetzelfde_id() {
        let map = tijdelijke_map("open");
        let bron = tijdelijke_map("open-bron");
        installeer_bevestigd(&map, &schrijf_pakket(&bron, "v1.oppx", &pakket("nl.f", "1.0.0", "// een")));
        let v2 = schrijf_pakket(&bron, "v2.oppx", &pakket("nl.f", "2.0.0", "// twee"));
        let v3 = schrijf_pakket(&bron, "v3.oppx", &pakket("nl.f", "3.0.0", "// drie"));
        let t2 = installeer_in(&map, &v2, Beleid::Always, None, "mcp").unwrap()["transactie"].as_str().unwrap().to_string();
        // Nog niet bevestigd en het proces leeft: geen nieuwe installatie erover.
        assert_eq!(installeer_in(&map, &v3, Beleid::Always, None, "mcp").unwrap_err().code, "TRANSACTION_PENDING");
        assert_eq!(index_js(&map, "nl.f"), "// twee");
        // Van een proces dat niet meer bestaat: eerst terugdraaien, dan installeren.
        verweesd(&map, &t2);
        let r3 = installeer_in(&map, &v3, Beleid::Always, None, "mcp").unwrap();
        assert_eq!(r3["previousVersion"], "1.0.0");
        bevestig_in(&map, r3["transactie"].as_str().unwrap()).unwrap();
        assert_eq!(index_js(&map, "nl.f"), "// drie");
        assert!(open_journalen(&map).is_empty());
        assert_eq!(aantal_in(&map, BACKUP), 0);
        // Een herstel daarna heeft niets meer te doen.
        let h = herstel_in(&map);
        assert_eq!(h["rolledBack"].as_array().unwrap().len(), 0);
        assert_eq!(index_js(&map, "nl.f"), "// drie");
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn herstel_slaat_een_levend_proces_over() {
        let map = tijdelijke_map("levend");
        let bron = tijdelijke_map("levend-bron");
        installeer_bevestigd(&map, &schrijf_pakket(&bron, "v1.oppx", &pakket("nl.g", "1.0.0", "// een")));
        let v2 = schrijf_pakket(&bron, "v2.oppx", &pakket("nl.g", "2.0.0", "// twee"));
        let t2 = installeer_in(&map, &v2, Beleid::Always, None, "mcp").unwrap()["transactie"].as_str().unwrap().to_string();
        // Het herstel van een tweede app-proces: de eigenaar van t2 leeft nog.
        let h = herstel_in(&map);
        assert_eq!(h["rolledBack"].as_array().unwrap().len(), 0);
        assert_eq!(h["skipped"], 1);
        assert_eq!(index_js(&map, "nl.g"), "// twee");
        assert!(map.join(BACKUP).join(&t2).exists(), "de back-up blijft");
        bevestig_in(&map, &t2).unwrap();
        // Een tussenmap tijdens het uitpakken hoort al bij een journaal.
        let t3 = "00000000000000000000000000000003";
        schrijf_journaal(&map, t3, "nl.h", "voorbereid", false).unwrap();
        fs::create_dir_all(map.join(STAGING).join(t3)).unwrap();
        herstel_in(&map);
        assert!(map.join(STAGING).join(t3).exists());
        assert!(journaal_pad(&map, t3).exists());
        // Eigenaarschap.
        assert!(eigenaar_leeft(&map, &json!({ "eigenaar": eigen_eigenaar() })));
        assert!(!eigenaar_leeft(&map, &json!({})), "een journaal zonder eigenaar is van een oud proces");
        assert!(!eigenaar_leeft(&map, &json!({ "eigenaar": "geen-token" })));
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Een ander proces, nagebootst met een vastgehouden .levend-bestand.
            let ander = "abcdefabcdefabcdefabcdefabcdef01";
            let levend = map.join(TRANSACTIES).join(format!("{ander}.levend"));
            let vast = fs::OpenOptions::new().write(true).create(true).share_mode(0).open(&levend).unwrap();
            let j = json!({ "eigenaar": ander, "pid": 1 });
            assert!(eigenaar_leeft(&map, &j));
            herstel_in(&map);
            assert!(levend.exists(), "het herstel laat het .levend-bestand van een levend proces staan");
            drop(vast);
            assert!(!eigenaar_leeft(&map, &j));
            herstel_in(&map);
            assert!(!levend.exists(), "en ruimt dat van een gestopt proces op");
        }
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn herstel_zet_een_al_verplaatste_backup_terug() {
        let map = tijdelijke_map("verplaatst");
        let bron = tijdelijke_map("verplaatst-bron");
        installeer_bevestigd(&map, &schrijf_pakket(&bron, "v1.oppx", &pakket("nl.i", "1.0.0", "// een")));
        // Onderbroken tussen "oude naar de back-up" en het journaal "oud-weg".
        let token = "00000000000000000000000000000004";
        schrijf_journaal(&map, token, "nl.i", "voorbereid", true).unwrap();
        verweesd(&map, token);
        fs::create_dir_all(map.join(BACKUP)).unwrap();
        fs::rename(map.join("nl.i"), map.join(BACKUP).join(token)).unwrap();
        let h = herstel_in(&map);
        assert_eq!(h["rolledBack"][0]["restored"], true);
        assert_eq!(index_js(&map, "nl.i"), "// een");
        assert!(!map.join(BACKUP).join(token).exists());
        // Een eerste installatie die stopte na het verplaatsen van de tussenmap
        // ("oud-weg" zonder back-up): de onbevestigde installatie verdwijnt.
        let t5 = "00000000000000000000000000000005";
        schrijf_journaal(&map, t5, "nl.j", "oud-weg", false).unwrap();
        verweesd(&map, t5);
        fs::create_dir_all(map.join("nl.j")).unwrap();
        fs::write(map.join("nl.j").join("plugin.json"), r#"{"id":"nl.j"}"#).unwrap();
        fs::write(map.join("nl.j").join("index.js"), "x").unwrap();
        herstel_in(&map);
        assert!(!map.join("nl.j").exists());
        assert_eq!(index_js(&map, "nl.i"), "// een");
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[cfg(windows)]
    #[test]
    fn mislukt_terugzetten_laat_het_journaal_staan() {
        use std::os::windows::fs::OpenOptionsExt;
        let map = tijdelijke_map("vast");
        let bron = tijdelijke_map("vast-bron");
        installeer_bevestigd(&map, &schrijf_pakket(&bron, "v1.oppx", &pakket("nl.k", "1.0.0", "// een")));
        let v2 = schrijf_pakket(&bron, "v2.oppx", &pakket("nl.k", "2.0.0", "// twee"));
        let t2 = installeer_in(&map, &v2, Beleid::Always, None, "mcp").unwrap()["transactie"].as_str().unwrap().to_string();
        // Een bestand in de back-up is even vergrendeld: terugzetten lukt niet.
        let backup = map.join(BACKUP).join(&t2);
        let vast = fs::OpenOptions::new().read(true).share_mode(0).open(backup.join("index.js")).unwrap();
        assert!(terugdraaien_in(&map, &t2).is_err());
        assert!(journaal_pad(&map, &t2).exists(), "het journaal blijft");
        assert!(backup.exists(), "de back-up blijft");
        // Ook de hulp van de foutpaden in installeer_onder_slot meldt het.
        assert!(!zet_terug(&map.join("nl.k"), &backup, true, true));
        drop(vast);
        // Het herstel (of een nieuwe poging) maakt het af.
        verweesd(&map, &t2);
        let h = herstel_in(&map);
        assert_eq!(h["rolledBack"].as_array().unwrap().len(), 1);
        assert_eq!(index_js(&map, "nl.k"), "// een");
        assert!(open_journalen(&map).is_empty());
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&bron);
    }

    #[test]
    fn herstel_ruimt_alleen_oude_tmp_journalen_op() {
        let map = tijdelijke_map("tmp");
        fs::create_dir_all(map.join(TRANSACTIES)).unwrap();
        let tmp = map.join(TRANSACTIES).join("00000000000000000000000000000006.json.tmp");
        fs::write(&tmp, "{}").unwrap();
        herstel_in(&map);
        assert!(tmp.exists(), "misschien schrijft een ander proces het nu");
        let f = fs::OpenOptions::new().write(true).open(&tmp).unwrap();
        f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(120)).unwrap();
        drop(f);
        herstel_in(&map);
        assert!(!tmp.exists());
        let _ = fs::remove_dir_all(&map);
    }
}
