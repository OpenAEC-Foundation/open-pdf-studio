//! Draagbare modus (#881): de app draait uit een uitgepakte map, zonder
//! installatie, en houdt al haar gegevens in `data\` naast het programma.
//!
//! Aan:
//! - op Windows met een markeringsbestand `portable.ini` (of `.portable`)
//!   naast `open-pdf-studio.exe` — de draagbare zip levert `portable.ini` mee;
//! - overal met `OPDS_PORTABLE=1`. `OPDS_PORTABLE=0` zet de modus uit, ook als
//!   de markering er ligt.
//!
//! Wat er dan verandert (`activeer`, aangeroepen als eerste in `main`, vóór er
//! een draad of venster bestaat):
//! - `OPDS_DATA_DIR` wijst naar `<exe-map>\data`. Daar landen via datamap.rs
//!   voorkeuren, sessie, catalogi, plug-ins, herstelmomentopnamen, crashlogs
//!   (`data\OpenPDFStudio\`) en logboek en cache (`data\<identifier>\`).
//! - `WEBVIEW2_USER_DATA_FOLDER` wijst naar `data\webview2`: het WebView2-
//!   profiel (localStorage, IndexedDB, HTTP-cache). WebView2 laat deze
//!   variabele winnen van de map die Tauri zelf meegeeft.
//! - Staat er een vaste WebView2-runtime in `<exe-map>\WebView2Runtime`, dan
//!   gebruikt de app die (`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`). Zonder die map
//!   is de systeemruntime nodig (Windows 10 en 11 hebben hem); ontbreekt hij,
//!   dan meldt `controleer_webview2` dat met een duidelijk venster.
//! - Een variabele die de gebruiker of een testopstelling al gezet heeft,
//!   blijft staan.
//! - De single-instance-sleutel krijgt een eigen naam per map
//!   (`pas_context_aan`): anders gaf een draagbare start zijn PDF door aan een
//!   geïnstalleerde instantie die al draaide en stopte dan zelf.
//!
//! Is de map niet beschrijfbaar (alleen-lezen share, Program Files), dan
//! blijft de modus aan voor wat installatie vraagt, maar gaan de gegevens naar
//! de gewone gebruikersmappen; de frontend meldt dat (`dataDirError`).
//!
//! Niet beschikbaar in deze modus (de frontend toont een uitleg, Rust weigert
//! als vangnet): de virtuele printer installeren en de Verkenner-miniaturen
//! aanzetten. Beide registreren iets in Windows dat naar een vaste
//! programmamap wijst. De bijwerker installeert niets maar wijst naar de
//! nieuwe zip (js/ui/chrome/updater.js).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Markeringsbestanden naast het programma die de modus aanzetten.
pub const MARKERINGEN: [&str; 2] = ["portable.ini", ".portable"];
/// Omgevingsvariabele die de modus forceert (`1`) of uitzet (`0`).
pub const VAR: &str = "OPDS_PORTABLE";
/// Gegevensmap naast het programma.
pub const DATAMAP: &str = "data";
/// WebView2-profiel binnen de gegevensmap.
pub const WEBVIEW_PROFIEL: &str = "webview2";
/// Optionele vaste WebView2-runtime naast het programma.
pub const RUNTIME_MAP: &str = "WebView2Runtime";
/// WebView2-variabelen (gelezen door de WebView2-loader).
pub const VAR_PROFIEL: &str = "WEBVIEW2_USER_DATA_FOLDER";
pub const VAR_RUNTIME: &str = "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER";

/// Foutcode voor functies die een installatie vragen.
pub const FOUT_ALLEEN_GEINSTALLEERD: &str =
    "PORTABLE_UNSUPPORTED: only available in the installed version";

/// Wat `OPDS_PORTABLE` zegt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Keuze {
    Aan,
    Uit,
    /// Niet (zinnig) gezet: de markering beslist.
    Markering,
}

/// Pure regel: de waarde van `OPDS_PORTABLE`.
pub fn keuze_uit_waarde(waarde: Option<OsString>) -> Keuze {
    let Some(w) = waarde else { return Keuze::Markering };
    match w.to_string_lossy().trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Keuze::Aan,
        "0" | "false" | "no" | "off" => Keuze::Uit,
        _ => Keuze::Markering,
    }
}

/// Ligt er een markeringsbestand in deze map?
pub fn heeft_markering(exe_map: &Path) -> bool {
    MARKERINGEN.iter().any(|m| exe_map.join(m).is_file())
}

/// Pure regel: draait deze start draagbaar? De markering telt alleen waar
/// `markering_telt` (Windows); de variabele overal.
pub fn is_draagbaar(keuze: Keuze, markering_telt: bool, exe_map: &Path) -> bool {
    match keuze {
        Keuze::Aan => true,
        Keuze::Uit => false,
        Keuze::Markering => markering_telt && heeft_markering(exe_map),
    }
}

/// De gegevensmap van een draagbare map.
pub fn datamap_van(exe_map: &Path) -> PathBuf {
    exe_map.join(DATAMAP)
}

/// Pure regel: welke variabelen zet de draagbare modus? `gezet(naam)` zegt of
/// de omgeving er al een (niet-lege) waarde voor heeft; die blijft staan.
/// `data` is None als de gegevensmap niet beschrijfbaar is: dan alleen de
/// runtime.
pub fn omgevingsplan(
    exe_map: &Path,
    data: Option<&Path>,
    runtime_aanwezig: bool,
    gezet: impl Fn(&str) -> bool,
) -> Vec<(&'static str, PathBuf)> {
    let mut plan = Vec::new();
    if let Some(data) = data {
        if !gezet(crate::datamap::OVERRIDE_VAR) {
            plan.push((crate::datamap::OVERRIDE_VAR, data.to_path_buf()));
        }
        if !gezet(VAR_PROFIEL) {
            plan.push((VAR_PROFIEL, data.join(WEBVIEW_PROFIEL)));
        }
    }
    if runtime_aanwezig && !gezet(VAR_RUNTIME) {
        plan.push((VAR_RUNTIME, exe_map.join(RUNTIME_MAP)));
    }
    plan
}

/// Is een vaste WebView2-runtime meegeleverd? (`msedgewebview2.exe` in de map.)
pub fn runtime_aanwezig(exe_map: &Path) -> bool {
    exe_map.join(RUNTIME_MAP).join("msedgewebview2.exe").is_file()
}

/// Pure regel: de single-instance-sleutel van een draagbare map. Elke map
/// eigen (FNV-1a over het pad, hoofdletterongevoelig zoals Windows-paden), en
/// nooit gelijk aan die van de geïnstalleerde app.
pub fn instantie_identifier(identifier: &str, exe_map: &Path) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for b in exe_map.to_string_lossy().to_lowercase().bytes() {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{identifier}.portable-{h:08x}")
}

/// Toestand voor de frontend (`portable_status`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub portable: bool,
    /// De map met de gebruikersgegevens (None buiten de modus of als hij niet
    /// beschrijfbaar is).
    pub data_dir: Option<String>,
    pub exe_dir: Option<String>,
    /// Een vaste WebView2-runtime naast het programma wordt gebruikt.
    pub fixed_runtime: bool,
    /// De gegevensmap kon niet gemaakt of beschreven worden.
    pub data_dir_error: Option<String>,
}

static STATUS: OnceLock<Status> = OnceLock::new();
/// De identifier van vóór `pas_context_aan`, voor vaste gegevenspaden.
static BASIS_IDENTIFIER: OnceLock<String> = OnceLock::new();

/// De toestand (leeg als `activeer` niet liep).
pub fn status() -> Status {
    STATUS.get().cloned().unwrap_or_default()
}

/// Draait deze start draagbaar?
pub fn actief() -> bool {
    STATUS.get().is_some_and(|s| s.portable)
}

/// Kan de app in deze map schrijven? Maakt de map en een proefbestand.
fn maak_beschrijfbaar(map: &Path) -> Result<(), String> {
    std::fs::create_dir_all(map).map_err(|e| format!("{}: {e}", map.display()))?;
    let proef = map.join(".schrijfproef");
    std::fs::write(&proef, b"").map_err(|e| format!("{}: {e}", map.display()))?;
    let _ = std::fs::remove_file(&proef);
    Ok(())
}

/// Stel de modus vast en zet de omgeving. Eén keer, als eerste in `main`:
/// `set_var` hoort vóór er andere draden zijn.
pub fn activeer() -> Status {
    if let Some(s) = STATUS.get() {
        return s.clone();
    }
    let status = bepaal_en_zet();
    let _ = STATUS.set(status.clone());
    status
}

fn bepaal_en_zet() -> Status {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Status::default();
    }
    let Some(exe_map) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) else {
        return Status::default();
    };
    let keuze = keuze_uit_waarde(std::env::var_os(VAR));
    if !is_draagbaar(keuze, cfg!(windows), &exe_map) {
        return Status::default();
    }

    let data = datamap_van(&exe_map);
    let (data_ok, data_dir_error) = match maak_beschrijfbaar(&data) {
        Ok(()) => (Some(data.clone()), None),
        Err(e) => (None, Some(e)),
    };
    let runtime = cfg!(windows) && runtime_aanwezig(&exe_map);
    let gezet = |naam: &str| std::env::var_os(naam).is_some_and(|w| !w.is_empty());
    for (naam, waarde) in omgevingsplan(&exe_map, data_ok.as_deref(), runtime, gezet) {
        std::env::set_var(naam, &waarde);
    }
    if let Some(e) = &data_dir_error {
        eprintln!("[portable] data folder not writable, using the user profile: {e}");
    }

    Status {
        portable: true,
        data_dir: crate::datamap::override_map().map(|p| p.to_string_lossy().into_owned()),
        exe_dir: Some(exe_map.to_string_lossy().into_owned()),
        fixed_runtime: std::env::var_os(VAR_RUNTIME).is_some_and(|w| !w.is_empty()),
        data_dir_error,
    }
}

/// Geef de draagbare start een eigen single-instance-sleutel (zie boven). De
/// oorspronkelijke identifier blijft bewaard voor de gegevenspaden.
pub fn pas_context_aan<R: tauri::Runtime>(context: &mut tauri::Context<R>) {
    let basis = context.config().identifier.clone();
    let _ = BASIS_IDENTIFIER.set(basis.clone());
    let s = status();
    if !s.portable {
        return;
    }
    if let Some(exe_map) = s.exe_dir.as_deref() {
        context.config_mut().identifier = instantie_identifier(&basis, Path::new(exe_map));
    }
}

/// De identifier voor gegevenspaden: die van vóór `pas_context_aan`.
pub fn basis_identifier(huidig: &str) -> String {
    BASIS_IDENTIFIER.get().cloned().unwrap_or_else(|| huidig.to_string())
}

/// Weiger een functie die een installatie vraagt.
pub fn weiger_als_draagbaar() -> Result<(), String> {
    if actief() {
        Err(FOUT_ALLEEN_GEINSTALLEERD.to_string())
    } else {
        Ok(())
    }
}

/// Toestand voor de frontend.
#[tauri::command]
pub fn portable_status() -> Status {
    status()
}

/// Tekst van de melding als de WebView2-runtime ontbreekt.
pub const MELDING_GEEN_WEBVIEW2: &str = "Open PDF Studio needs the Microsoft Edge WebView2 Runtime, \
which was not found on this computer.\n\n\
Windows 10 and 11 normally include it. Install it from \
https://developer.microsoft.com/microsoft-edge/webview2/ (Evergreen Runtime), \
or place a fixed-version runtime in a folder named \"WebView2Runtime\" next to \
open-pdf-studio.exe.";

/// Draagbaar op Windows: is er een WebView2-runtime? Zo niet, dan een
/// duidelijk venster en stoppen (zonder controle zou de app zonder venster
/// eindigen; de installers regelen de runtime zelf, de zip niet).
pub fn controleer_webview2() {
    #[cfg(windows)]
    if actief() && !webview2_aanwezig() {
        toon_fout(MELDING_GEEN_WEBVIEW2);
        std::process::exit(1);
    }
}

#[cfg(windows)]
fn webview2_aanwezig() -> bool {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    use windows::core::{HSTRING, PCWSTR, PWSTR};

    let map = std::env::var_os(VAR_RUNTIME).filter(|w| !w.is_empty());
    let map_w = map.as_ref().map(|m| HSTRING::from(m.as_os_str()));
    let map_p = map_w.as_ref().map_or(PCWSTR::null(), |h| PCWSTR(h.as_ptr()));
    let mut versie = PWSTR::null();
    let gelukt = unsafe { GetAvailableCoreWebView2BrowserVersionString(map_p, &mut versie) }.is_ok();
    if versie.is_null() {
        return false;
    }
    let tekst = unsafe { versie.to_string() }.unwrap_or_default();
    unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(versie.0 as *const _)) };
    gelukt && !tekst.trim().is_empty()
}

#[cfg(windows)]
fn toon_fout(tekst: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let breed = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let tekst_w = breed(tekst);
    let titel_w = breed("Open PDF Studio");
    unsafe {
        MessageBoxW(std::ptr::null_mut(), tekst_w.as_ptr(), titel_w.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tijdelijke_map(naam: &str) -> PathBuf {
        let map = std::env::temp_dir().join(format!("opds-draagbaar-{naam}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&map);
        std::fs::create_dir_all(&map).unwrap();
        map
    }

    #[test]
    fn variabele_aan_uit_of_markering() {
        assert_eq!(keuze_uit_waarde(None), Keuze::Markering);
        for w in ["1", "true", " YES ", "on"] {
            assert_eq!(keuze_uit_waarde(Some(OsString::from(w))), Keuze::Aan, "{w}");
        }
        for w in ["0", "false", "No", "off"] {
            assert_eq!(keuze_uit_waarde(Some(OsString::from(w))), Keuze::Uit, "{w}");
        }
        for w in ["", "  ", "misschien"] {
            assert_eq!(keuze_uit_waarde(Some(OsString::from(w))), Keuze::Markering, "{w:?}");
        }
    }

    #[test]
    fn markering_naast_het_programma_zet_de_modus_aan() {
        let map = tijdelijke_map("markering");
        assert!(!is_draagbaar(Keuze::Markering, true, &map));
        std::fs::write(map.join("portable.ini"), "").unwrap();
        assert!(is_draagbaar(Keuze::Markering, true, &map));
        // Waar de markering niet telt (macOS, Linux), alleen de variabele.
        assert!(!is_draagbaar(Keuze::Markering, false, &map));
        // De variabele wint in beide richtingen.
        assert!(!is_draagbaar(Keuze::Uit, true, &map));
        let leeg = tijdelijke_map("leeg");
        assert!(is_draagbaar(Keuze::Aan, false, &leeg));
        let _ = std::fs::remove_dir_all(&map);
        let _ = std::fs::remove_dir_all(&leeg);
    }

    #[test]
    fn punt_portable_telt_ook_maar_een_map_met_die_naam_niet() {
        let map = tijdelijke_map("punt");
        std::fs::create_dir_all(map.join("portable.ini")).unwrap();
        assert!(!heeft_markering(&map), "een map is geen markering");
        std::fs::write(map.join(".portable"), "").unwrap();
        assert!(heeft_markering(&map));
        let _ = std::fs::remove_dir_all(&map);
    }

    #[test]
    fn gegevens_naast_het_programma() {
        let exe = PathBuf::from("draagbaar");
        assert_eq!(datamap_van(&exe), exe.join("data"));
    }

    #[test]
    fn plan_zet_datamap_en_webview2_profiel() {
        let exe = PathBuf::from("draagbaar");
        let data = datamap_van(&exe);
        let plan = omgevingsplan(&exe, Some(&data), false, |_| false);
        assert_eq!(
            plan,
            vec![
                (crate::datamap::OVERRIDE_VAR, data.clone()),
                (VAR_PROFIEL, data.join("webview2")),
            ]
        );
    }

    #[test]
    fn plan_laat_gezette_variabelen_staan() {
        let exe = PathBuf::from("draagbaar");
        let data = datamap_van(&exe);
        let plan = omgevingsplan(&exe, Some(&data), true, |n| n == crate::datamap::OVERRIDE_VAR || n == VAR_RUNTIME);
        assert_eq!(plan, vec![(VAR_PROFIEL, data.join("webview2"))]);
    }

    #[test]
    fn plan_met_vaste_runtime() {
        let exe = PathBuf::from("draagbaar");
        let plan = omgevingsplan(&exe, Some(&datamap_van(&exe)), true, |_| false);
        assert_eq!(plan.last(), Some(&(VAR_RUNTIME, exe.join("WebView2Runtime"))));
    }

    #[test]
    fn plan_zonder_beschrijfbare_map_raakt_de_gegevens_niet() {
        let exe = PathBuf::from("draagbaar");
        assert!(omgevingsplan(&exe, None, false, |_| false).is_empty());
        assert_eq!(omgevingsplan(&exe, None, true, |_| false), vec![(VAR_RUNTIME, exe.join("WebView2Runtime"))]);
    }

    #[test]
    fn datamap_onder_de_draagbare_basis() {
        // Met OPDS_DATA_DIR = <exe>\data komen logboek en cache hier terecht.
        let data = datamap_van(Path::new("draagbaar"));
        let id = "org.openaec.openpdfstudio";
        use crate::datamap::{tauri_map_onder, TauriMap};
        assert_eq!(tauri_map_onder(&data, id, TauriMap::Logs), data.join(id).join("logs"));
        assert_eq!(tauri_map_onder(&data, id, TauriMap::Cache), data.join(id).join("cache"));
    }

    #[test]
    fn instantiesleutel_per_map_en_nooit_die_van_de_installatie() {
        let id = "org.openaec.openpdfstudio";
        let a = instantie_identifier(id, Path::new("E:/Apps/OPDS"));
        let b = instantie_identifier(id, Path::new("F:/Elders/OPDS"));
        assert_ne!(a, id);
        assert!(a.starts_with("org.openaec.openpdfstudio.portable-"), "{a}");
        assert_ne!(a, b);
        // Windows-paden zijn hoofdletterongevoelig.
        assert_eq!(a, instantie_identifier(id, Path::new("e:/apps/opds")));
        // Stabiel tussen starts: dezelfde map, dezelfde sleutel.
        assert_eq!(a, instantie_identifier(id, Path::new("E:/Apps/OPDS")));
    }

    #[test]
    fn runtime_telt_alleen_met_het_programma_erin() {
        let map = tijdelijke_map("runtime");
        assert!(!runtime_aanwezig(&map));
        std::fs::create_dir_all(map.join(RUNTIME_MAP)).unwrap();
        assert!(!runtime_aanwezig(&map));
        std::fs::write(map.join(RUNTIME_MAP).join("msedgewebview2.exe"), "").unwrap();
        assert!(runtime_aanwezig(&map));
        let _ = std::fs::remove_dir_all(&map);
    }

    #[test]
    fn beschrijfbare_map_wordt_gemaakt() {
        let map = tijdelijke_map("schrijf").join("data");
        assert!(maak_beschrijfbaar(&map).is_ok());
        assert!(map.is_dir());
        assert!(!map.join(".schrijfproef").exists(), "proefbestand opgeruimd");
        let _ = std::fs::remove_dir_all(map.parent().unwrap());
    }

    #[test]
    fn niet_beschrijfbaar_geeft_een_fout() {
        // Een bestand waar de map moet komen: create_dir_all faalt op elk OS.
        let basis = tijdelijke_map("blok");
        std::fs::write(basis.join("data"), "").unwrap();
        assert!(maak_beschrijfbaar(&basis.join("data")).is_err());
        let _ = std::fs::remove_dir_all(&basis);
    }

    #[test]
    fn status_als_json_voor_de_frontend() {
        let s = Status {
            portable: true,
            data_dir: Some("D".into()),
            exe_dir: Some("E".into()),
            fixed_runtime: false,
            data_dir_error: None,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["portable"], true);
        assert_eq!(json["dataDir"], "D");
        assert_eq!(json["exeDir"], "E");
        assert_eq!(json["fixedRuntime"], false);
        assert!(json["dataDirError"].is_null());
    }

    #[test]
    fn buiten_de_modus_weigert_niets() {
        // In de testrunner liep activeer() niet: geen draagbare start.
        assert!(!actief());
        assert!(weiger_als_draagbaar().is_ok());
        assert_eq!(basis_identifier("x.y"), "x.y");
    }
}
