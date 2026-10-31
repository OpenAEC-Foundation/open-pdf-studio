//! PDF's met een openingswachtwoord (gebruikerswachtwoord).
//!
//! Alle renderpaden van de app (PDFium in dit proces en in de worker-processen,
//! de vectorlezer, de paginatype-analyse) laden een document op PAD en zonder
//! wachtwoord. Een versleuteld bestand opent daar dus niet. Daarom maakt de app,
//! nadat de gebruiker het juiste wachtwoord heeft gegeven, één ontsleutelde
//! werkkopie in een eigen map in de tijdelijke map van het systeem en opent die
//! als gewoon bestand. Het origineel wordt nooit beschreven: het document is in
//! de app alleen-lezen en de werkkopie verdwijnt bij het sluiten van het
//! tabblad, bij het afsluiten van de app en (wat dan nog blijft staan) bij de
//! volgende start.
//!
//! Het wachtwoord staat alleen in een `Zeroizing`-buffer en wordt nergens
//! gelogd of in een foutmelding opgenomen.
//!
//! PDFium wordt hier via zijn C-functies aangesproken: de Rust-schil
//! (pdfium-render) bewaart altijd met vlag 0, en dan blijft de beveiliging in
//! het resultaat staan. `FPDF_SaveAsCopy` met `FPDF_REMOVE_SECURITY` schrijft de
//! kopie zonder versleuteling.

use std::collections::HashMap;
use std::ffi::c_void;
use std::fs;
use std::os::raw::{c_char, c_int, c_ulong};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_fs::FsExt;
use zeroize::Zeroizing;

/// Naam van de eigen submap in de tijdelijke map van het systeem.
pub const MAPNAAM: &str = "opds-beveiligd";

/// Foutcode voor een verkeerd wachtwoord: de dialoog vraagt dan opnieuw.
pub const FOUT_VERKEERD_WACHTWOORD: &str = "WRONG_PASSWORD";
/// Foutcode als PDFium niet geladen is (rendering staat dan helemaal uit).
pub const FOUT_GEEN_PDFIUM: &str = "PDFIUM_UNAVAILABLE";
/// Foutcode voor elke andere mislukking (kapot bestand, schrijven lukt niet).
pub const FOUT_ONTSLEUTELEN: &str = "DECRYPT_FAILED";

// fpdfview.h / fpdf_save.h
const FPDF_ERR_PASSWORD: c_ulong = 4;
/// Huidige vlag (vanaf PDFium 7xxx een bitvlag).
const FPDF_REMOVE_SECURITY: c_ulong = 1 << 2;
/// Oude waarde; nieuwere PDFium-versies accepteren hem nog als verouderd.
const FPDF_REMOVE_SECURITY_OUD: c_ulong = 3;

#[derive(Debug, PartialEq, Eq)]
pub enum OntsleutelFout {
    VerkeerdWachtwoord,
    GeenPdfium(String),
    Mislukt(String),
}

impl OntsleutelFout {
    /// De tekst die naar de interface gaat: een vaste code, eventueel met een
    /// toelichting. Bevat nooit het wachtwoord.
    pub fn code(&self) -> String {
        match self {
            OntsleutelFout::VerkeerdWachtwoord => FOUT_VERKEERD_WACHTWOORD.to_string(),
            OntsleutelFout::GeenPdfium(t) => format!("{FOUT_GEEN_PDFIUM}: {t}"),
            OntsleutelFout::Mislukt(t) => format!("{FOUT_ONTSLEUTELEN}: {t}"),
        }
    }
}

// ─── PDFium C-functies ─────────────────────────────────────────────────────

type FpdfDocument = *mut c_void;

/// `FPDF_FILEWRITE` uit fpdf_save.h.
#[repr(C)]
struct FpdfFileWrite {
    version: c_int,
    write_block: Option<unsafe extern "C" fn(*mut FpdfFileWrite, *const c_void, c_ulong) -> c_int>,
}

/// Schrijfdoel voor `FPDF_SaveAsCopy`: de PDFium-structuur moet vooraan staan,
/// zodat de terugroepfunctie van de pointer weer bij de buffer komt.
#[repr(C)]
struct Schrijver {
    basis: FpdfFileWrite,
    uit: Vec<u8>,
}

impl Schrijver {
    fn nieuw() -> Self {
        Schrijver {
            basis: FpdfFileWrite { version: 1, write_block: Some(schrijf_blok) },
            uit: Vec::new(),
        }
    }
}

unsafe extern "C" fn schrijf_blok(this: *mut FpdfFileWrite, data: *const c_void, grootte: c_ulong) -> c_int {
    if this.is_null() {
        return 0;
    }
    if grootte == 0 {
        return 1;
    }
    if data.is_null() {
        return 0;
    }
    // `basis` is het eerste veld van de #[repr(C)]-struct `Schrijver`.
    let schrijver = &mut *(this as *mut Schrijver);
    schrijver.uit.extend_from_slice(std::slice::from_raw_parts(data as *const u8, grootte as usize));
    1
}

type LaadFn = unsafe extern "system" fn(*const c_void, usize, *const c_char) -> FpdfDocument;
type SluitFn = unsafe extern "system" fn(FpdfDocument);
type BewaarFn = unsafe extern "system" fn(FpdfDocument, *mut FpdfFileWrite, c_ulong) -> c_int;
type FoutFn = unsafe extern "system" fn() -> c_ulong;
type RechtenFn = unsafe extern "system" fn(FpdfDocument) -> c_ulong;

struct Functies {
    laad: LaadFn,
    sluit: SluitFn,
    bewaar: BewaarFn,
    laatste_fout: FoutFn,
    rechten: RechtenFn,
    // De bibliotheek moet blijven bestaan zolang de functies gebruikt worden.
    _bibliotheek: libloading::Library,
}

impl Functies {
    fn laad(bibliotheek: &Path) -> Result<Self, OntsleutelFout> {
        // Dezelfde DLL die init_pdfium al geladen (en geïnitialiseerd) heeft:
        // het besturingssysteem geeft dezelfde module terug.
        let lib = unsafe { libloading::Library::new(bibliotheek) }
            .map_err(|e| OntsleutelFout::GeenPdfium(e.to_string()))?;
        unsafe {
            let laad = *lib.get::<LaadFn>(b"FPDF_LoadMemDocument64\0")
                .map_err(|e| OntsleutelFout::GeenPdfium(e.to_string()))?;
            let sluit = *lib.get::<SluitFn>(b"FPDF_CloseDocument\0")
                .map_err(|e| OntsleutelFout::GeenPdfium(e.to_string()))?;
            let bewaar = *lib.get::<BewaarFn>(b"FPDF_SaveAsCopy\0")
                .map_err(|e| OntsleutelFout::GeenPdfium(e.to_string()))?;
            let laatste_fout = *lib.get::<FoutFn>(b"FPDF_GetLastError\0")
                .map_err(|e| OntsleutelFout::GeenPdfium(e.to_string()))?;
            let rechten = *lib.get::<RechtenFn>(b"FPDF_GetDocPermissions\0")
                .map_err(|e| OntsleutelFout::GeenPdfium(e.to_string()))?;
            Ok(Functies { laad, sluit, bewaar, laatste_fout, rechten, _bibliotheek: lib })
        }
    }

    /// Opent `bytes` met (of zonder) wachtwoord. Het wachtwoord is een
    /// NUL-afgesloten buffer.
    unsafe fn open(&self, bytes: &[u8], wachtwoord: Option<&[u8]>) -> Result<FpdfDocument, c_ulong> {
        let ww = wachtwoord.map(|w| w.as_ptr() as *const c_char).unwrap_or(std::ptr::null());
        let doc = (self.laad)(bytes.as_ptr() as *const c_void, bytes.len(), ww);
        if doc.is_null() {
            Err((self.laatste_fout)())
        } else {
            Ok(doc)
        }
    }

    unsafe fn bewaar_zonder_beveiliging(&self, doc: FpdfDocument, vlag: c_ulong) -> Option<Vec<u8>> {
        let mut schrijver = Box::new(Schrijver::nieuw());
        let ok = (self.bewaar)(doc, &mut schrijver.basis as *mut FpdfFileWrite, vlag);
        if ok != 0 && !schrijver.uit.is_empty() {
            Some(std::mem::take(&mut schrijver.uit))
        } else {
            None
        }
    }

    /// Opent het resultaat zonder wachtwoord? Dan is de beveiliging eraf.
    unsafe fn opent_zonder_wachtwoord(&self, bytes: &[u8]) -> bool {
        match self.open(bytes, None) {
            Ok(doc) => {
                (self.sluit)(doc);
                true
            }
            Err(_) => false,
        }
    }
}

/// PDFium geeft alle rechten (0xFFFFFFFF) als het document met het
/// rechtenwachtwoord geopend is.
const ALLE_RECHTEN: c_ulong = 0xFFFF_FFFF;

/// Een ontsleuteld document en of het met het rechtenwachtwoord geopend is.
pub struct Ontsleuteld {
    pub bytes: Vec<u8>,
    pub eigenaar: bool,
}

/// Opent `bytes` met de vormen van `wachtwoord`; geeft het document of
/// `VerkeerdWachtwoord`. Het document moet daarna gesloten worden.
unsafe fn open_met_vormen(functies: &Functies, bytes: &[u8], wachtwoord: &str) -> Result<FpdfDocument, OntsleutelFout> {
    if wachtwoord.as_bytes().contains(&0) {
        // Een NUL kan nooit deel van het wachtwoord zijn; PDFium zou de rest
        // negeren en mogelijk een korter wachtwoord accepteren.
        return Err(OntsleutelFout::VerkeerdWachtwoord);
    }
    // PDFium bereidt een wachtwoord niet voor. Een bestand van een schrijver die
    // het volgens PDF 2.0 voorbereidde (SASLprep-toewijzing, NFKC, 127 bytes)
    // opent dan niet met wat de gebruiker typt; daarom ook die vormen proberen
    // (pdf_beveiliging::wachtwoord_vormen), zoals pdf.js dat doet.
    for vorm in &crate::pdf_beveiliging::wachtwoord_vormen(wachtwoord) {
        let mut ww: Zeroizing<Vec<u8>> = Zeroizing::new(Vec::with_capacity(vorm.len() + 1));
        ww.extend_from_slice(vorm);
        ww.push(0);
        match functies.open(bytes, Some(&ww)) {
            Ok(d) => return Ok(d),
            Err(FPDF_ERR_PASSWORD) => continue,
            Err(code) => return Err(OntsleutelFout::Mislukt(format!("PDFium error {code}"))),
        }
    }
    Err(OntsleutelFout::VerkeerdWachtwoord)
}

/// Is `wachtwoord` het rechtenwachtwoord van `bytes`? Voor de oudere methoden
/// (RC4, AES-128), waarvan de app de sleutel niet zelf afleidt.
pub fn is_rechtenwachtwoord(bibliotheek: &Path, bytes: &[u8], wachtwoord: &str) -> Result<bool, OntsleutelFout> {
    let functies = Functies::laad(bibliotheek)?;
    let _guard = crate::pdfium_renderer::inproc_guard();
    unsafe {
        let doc = match open_met_vormen(&functies, bytes, wachtwoord) {
            Ok(d) => d,
            Err(OntsleutelFout::VerkeerdWachtwoord) => return Ok(false),
            Err(e) => return Err(e),
        };
        let eigenaar = (functies.rechten)(doc) == ALLE_RECHTEN;
        (functies.sluit)(doc);
        Ok(eigenaar)
    }
}

/// Ontsleutelt een PDF in het geheugen. `bibliotheek` is het pad naar de
/// PDFium-bibliotheek; PDFium moet al geïnitialiseerd zijn (init_pdfium).
pub fn ontsleutel(bibliotheek: &Path, bytes: &[u8], wachtwoord: &str) -> Result<Ontsleuteld, OntsleutelFout> {
    let functies = Functies::laad(bibliotheek)?;
    // In-proc PDFium-werk gaat altijd achter dezelfde vergrendeling langs.
    let _guard = crate::pdfium_renderer::inproc_guard();
    unsafe {
        let doc = open_met_vormen(&functies, bytes, wachtwoord)?;
        let eigenaar = (functies.rechten)(doc) == ALLE_RECHTEN;
        let mut resultaat = None;
        for vlag in [FPDF_REMOVE_SECURITY, FPDF_REMOVE_SECURITY_OUD] {
            if let Some(uit) = functies.bewaar_zonder_beveiliging(doc, vlag) {
                if functies.opent_zonder_wachtwoord(&uit) {
                    resultaat = Some(uit);
                    break;
                }
            }
        }
        (functies.sluit)(doc);
        resultaat
            .map(|bytes| Ontsleuteld { bytes, eigenaar })
            .ok_or_else(|| OntsleutelFout::Mislukt("could not write an unprotected copy".into()))
    }
}

// ─── Werkkopieën ───────────────────────────────────────────────────────────

/// De map met werkkopieën.
pub fn werkmap() -> PathBuf {
    std::env::temp_dir().join(MAPNAAM)
}

/// Is `naam` de bestandsnaam van een werkkopie van de app? Streng, want wat
/// hier doorheen komt wordt verwijderd: `<pid>-<16 hex>.pdf`.
pub fn is_werkkopie_naam(naam: &str) -> bool {
    let Some(stam) = naam.strip_suffix(".pdf") else { return false };
    let Some((pid, sleutel)) = stam.split_once('-') else { return false };
    !pid.is_empty()
        && pid.len() <= 10
        && pid.bytes().all(|b| b.is_ascii_digit())
        && sleutel.len() == 16
        && sleutel.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Ligt `pad` direct in `map` en heeft het de naam van een werkkopie? Alleen
/// zulke bestanden mag de app verwijderen.
pub fn is_werkkopie(map: &Path, pad: &Path) -> bool {
    let Some(naam) = pad.file_name().and_then(|n| n.to_str()) else { return false };
    if !is_werkkopie_naam(naam) {
        return false;
    }
    let Some(ouder) = pad.parent() else { return false };
    match (fs::canonicalize(ouder), fs::canonicalize(map)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn nieuwe_naam() -> String {
    use rand::RngCore;
    let mut b = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut b);
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}.pdf", std::process::id(), hex)
}

/// Open handvatten op de werkkopieën van deze instantie. Op Windows houdt het
/// handvat (alleen lezen gedeeld) het bestand vast: een andere instantie die
/// bij haar start de map opruimt, kan het dan niet verwijderen.
#[derive(Default)]
pub struct BeveiligdeKopieen(pub Mutex<HashMap<PathBuf, Option<fs::File>>>);

fn houd_vast(pad: &Path) -> Option<fs::File> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ: lezen mag (worker-processen, de webview), schrijven
        // en verwijderen niet.
        fs::OpenOptions::new().read(true).share_mode(0x0000_0001).open(pad).ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        fs::File::open(pad).ok()
    }
}

/// Schrijft de werkkopie en geeft het pad terug.
pub fn schrijf_werkkopie(map: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(map).map_err(|e| format!("{FOUT_ONTSLEUTELEN}: cannot create working folder: {e}"))?;
    for _ in 0..4 {
        let doel = map.join(nieuwe_naam());
        match fs::OpenOptions::new().write(true).create_new(true).open(&doel) {
            Ok(mut f) => {
                use std::io::Write;
                if let Err(e) = f.write_all(bytes).and_then(|_| f.sync_all()) {
                    drop(f);
                    let _ = fs::remove_file(&doel);
                    return Err(format!("{FOUT_ONTSLEUTELEN}: cannot write working copy: {e}"));
                }
                return Ok(doel);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("{FOUT_ONTSLEUTELEN}: cannot write working copy: {e}")),
        }
    }
    Err(format!("{FOUT_ONTSLEUTELEN}: no free working-copy name"))
}

/// Verwijdert een werkkopie van deze instantie. `Ok(false)` als het bestand
/// nog in gebruik is: de opruiming bij afsluiten of de volgende start pakt het
/// dan op.
pub fn verwijder_werkkopie(kopieen: &BeveiligdeKopieen, map: &Path, pad: &Path) -> Result<bool, String> {
    if !is_werkkopie(map, pad) {
        return Err("not a protected-PDF working copy".into());
    }
    if let Ok(mut lijst) = kopieen.0.lock() {
        // Handvat loslaten vóór het verwijderen.
        lijst.remove(pad);
    }
    match fs::remove_file(pad) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Bij afsluiten: alle werkkopieën van deze instantie weg (best effort).
pub fn ruim_eigen_kopieen_op(kopieen: &BeveiligdeKopieen) {
    let paden: Vec<PathBuf> = match kopieen.0.lock() {
        Ok(mut lijst) => lijst.drain().map(|(p, _)| p).collect(),
        Err(_) => return,
    };
    for pad in paden {
        let _ = fs::remove_file(&pad);
    }
}

#[cfg(target_os = "linux")]
fn proces_leeft(pid: u32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

/// Bij de start: wat van een vorige keer is blijven staan. Op Windows houdt
/// een draaiende instantie haar kopieën vast (verwijderen faalt dan); op Linux
/// blijven kopieën van een levend proces staan; elders alleen wat ouder is dan
/// een dag.
pub fn ruim_oude_kopieen_op(map: &Path) -> usize {
    let Ok(lijst) = fs::read_dir(map) else { return 0 };
    let eigen = std::process::id();
    let mut weg = 0;
    for item in lijst.flatten() {
        let pad = item.path();
        let Some(naam) = pad.file_name().and_then(|n| n.to_str()).map(str::to_owned) else { continue };
        if !is_werkkopie_naam(&naam) {
            continue;
        }
        let pid: u32 = naam.split('-').next().and_then(|p| p.parse().ok()).unwrap_or(0);
        if pid == eigen {
            continue;
        }
        #[cfg(target_os = "linux")]
        if proces_leeft(pid) {
            continue;
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let oud = item
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .map(|d| d.as_secs() > 24 * 3600)
                .unwrap_or(false);
            if !oud {
                continue;
            }
        }
        if fs::remove_file(&pad).is_ok() {
            weg += 1;
        }
    }
    weg
}

// ─── Tauri-commando's ──────────────────────────────────────────────────────

/// Antwoord van [`open_protected_pdf`].
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeopendBeveiligd {
    /// De ontsleutelde werkkopie.
    pub path: String,
    /// De beveiliging van het origineel (sessie om terug te schrijven, of
    /// alleen een beschrijving); `None` als die niet te lezen was.
    pub security: Option<crate::pdf_beveiliging::SessieInfo>,
}

/// Opent een versleutelde PDF: schrijft een ontsleutelde werkkopie en geeft
/// het pad ervan terug, met de beveiliging van het origineel (#378), zodat
/// opslaan die kan behouden. `password` is leeg voor een bestand dat zonder
/// wachtwoord opent maar rechten heeft. Fout `WRONG_PASSWORD` bij een
/// verkeerd wachtwoord.
#[tauri::command]
pub async fn open_protected_pdf(
    app: tauri::AppHandle,
    path: String,
    password: String,
) -> Result<GeopendBeveiligd, String> {
    let wachtwoord = Zeroizing::new(password);
    let Some(bibliotheek) = crate::pdfium_renderer::bibliotheek_pad() else {
        return Err(OntsleutelFout::GeenPdfium("PDFium is not loaded".into()).code());
    };
    let bron = PathBuf::from(&path);
    let app2 = app.clone();
    let (doel, security) = tauri::async_runtime::spawn_blocking(move || -> Result<(PathBuf, Option<crate::pdf_beveiliging::SessieInfo>), String> {
        let bytes = fs::read(&bron).map_err(|e| format!("{FOUT_ONTSLEUTELEN}: cannot read file: {e}"))?;
        let schoon = ontsleutel(&bibliotheek, &bytes, &wachtwoord).map_err(|e| e.code())?;
        let sessies = app2.state::<crate::pdf_beveiliging::BeveiligingsSessies>();
        let security = crate::pdf_beveiliging::sessie_voor_bestand(&sessies, &bytes, &wachtwoord, schoon.eigenaar);
        drop(wachtwoord);
        Ok((schrijf_werkkopie(&werkmap(), &schoon.bytes)?, security))
    })
    .await
    .map_err(|e| format!("{FOUT_ONTSLEUTELEN}: {e}"))??;

    let handvat = houd_vast(&doel);
    if let Ok(mut lijst) = app.state::<BeveiligdeKopieen>().0.lock() {
        lijst.insert(doel.clone(), handvat);
    }
    // De webview leest de kopie via de fs-plugin (readBinaryFile).
    let _ = app.fs_scope().allow_file(&doel);
    Ok(GeopendBeveiligd { path: doel.to_string_lossy().to_string(), security })
}

/// Is `password` het rechtenwachtwoord van het bestand op `path`? Voor de
/// oudere methoden, die de app alleen via PDFium opent.
#[tauri::command]
pub async fn verify_pdf_owner_password(path: String, password: String) -> Result<bool, String> {
    let wachtwoord = Zeroizing::new(password);
    let Some(bibliotheek) = crate::pdfium_renderer::bibliotheek_pad() else {
        return Err(OntsleutelFout::GeenPdfium("PDFium is not loaded".into()).code());
    };
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&path).map_err(|e| format!("{FOUT_ONTSLEUTELEN}: cannot read file: {e}"))?;
        is_rechtenwachtwoord(&bibliotheek, &bytes, &wachtwoord).map_err(|e| e.code())
    })
    .await
    .map_err(|e| format!("{FOUT_ONTSLEUTELEN}: {e}"))?
}

/// Verwijdert een werkkopie (alleen bestanden in de eigen map met de naam van
/// een werkkopie). `false` als het bestand nog in gebruik was.
#[tauri::command]
pub fn release_protected_pdf(
    path: String,
    kopieen: tauri::State<BeveiligdeKopieen>,
) -> Result<bool, String> {
    verwijder_werkkopie(&kopieen, &werkmap(), Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn werkkopie_naam_is_streng() {
        assert!(is_werkkopie_naam("1234-0123456789abcdef.pdf"));
        assert!(!is_werkkopie_naam("1234-0123456789ABCDEF.pdf"));
        assert!(!is_werkkopie_naam("1234-0123456789abcde.pdf"));
        assert!(!is_werkkopie_naam("rapport.pdf"));
        assert!(!is_werkkopie_naam("-0123456789abcdef.pdf"));
        assert!(!is_werkkopie_naam("12a4-0123456789abcdef.pdf"));
        assert!(!is_werkkopie_naam("1234-0123456789abcdef.pdf.exe"));
        assert!(!is_werkkopie_naam("..\\1234-0123456789abcdef.pdf"));
    }

    #[test]
    fn nieuwe_naam_is_een_werkkopie_naam() {
        for _ in 0..20 {
            assert!(is_werkkopie_naam(&nieuwe_naam()));
        }
    }

    fn proefmap(naam: &str) -> PathBuf {
        let map = std::env::temp_dir().join(format!("opds-beveiligd-test-{naam}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&map);
        fs::create_dir_all(&map).unwrap();
        map
    }

    #[test]
    fn verwijderen_alleen_binnen_de_map() {
        let map = proefmap("verwijder");
        let kopieen = BeveiligdeKopieen::default();
        let kopie = schrijf_werkkopie(&map, b"%PDF-1.7\n").unwrap();
        assert!(kopie.exists());

        // Zelfde naam, andere map: geweigerd en blijft staan.
        let elders = proefmap("elders");
        let vreemd = elders.join(kopie.file_name().unwrap());
        fs::write(&vreemd, b"x").unwrap();
        assert!(verwijder_werkkopie(&kopieen, &map, &vreemd).is_err());
        assert!(vreemd.exists());

        // Een gewoon bestand in de map: geweigerd.
        let gewoon = map.join("rapport.pdf");
        fs::write(&gewoon, b"x").unwrap();
        assert!(verwijder_werkkopie(&kopieen, &map, &gewoon).is_err());
        assert!(gewoon.exists());

        assert_eq!(verwijder_werkkopie(&kopieen, &map, &kopie), Ok(true));
        assert!(!kopie.exists());
        let _ = fs::remove_dir_all(&map);
        let _ = fs::remove_dir_all(&elders);
    }

    #[test]
    fn opruimen_bij_start_laat_eigen_en_vreemde_bestanden_staan() {
        let map = proefmap("start");
        let eigen = schrijf_werkkopie(&map, b"%PDF").unwrap();
        // Een kopie van een (niet meer bestaand) ander proces.
        let oud = map.join("4294967295-0123456789abcdef.pdf");
        fs::write(&oud, b"%PDF").unwrap();
        let gewoon = map.join("notities.pdf");
        fs::write(&gewoon, b"x").unwrap();

        ruim_oude_kopieen_op(&map);
        assert!(eigen.exists(), "kopie van deze instantie blijft staan");
        assert!(gewoon.exists(), "geen werkkopie: blijft staan");
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        assert!(!oud.exists(), "achtergebleven kopie is opgeruimd");
        let _ = fs::remove_dir_all(&map);
    }

    #[test]
    fn foutcodes_bevatten_geen_wachtwoord() {
        assert_eq!(OntsleutelFout::VerkeerdWachtwoord.code(), "WRONG_PASSWORD");
        assert!(OntsleutelFout::Mislukt("x".into()).code().starts_with("DECRYPT_FAILED"));
        assert!(OntsleutelFout::GeenPdfium("x".into()).code().starts_with("PDFIUM_UNAVAILABLE"));
    }
}
