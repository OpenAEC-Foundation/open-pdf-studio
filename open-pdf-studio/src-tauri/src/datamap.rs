// Lokale datamap van de app, met een override voor testinstanties.
//
// `dirs::data_local_dir()` gebruikt op Windows de Known Folder API en negeert
// daardoor de omgevingsvariabele LOCALAPPDATA; de Tauri-padresolver
// (`app_data_dir`, `app_log_dir`, `app_cache_dir`) doet hetzelfde. Een tweede
// app-instantie voor tests (MCP-rig, prestatiemeting) schreef zo in de
// voorkeuren, sessie, catalogi, logs en cache van de echte gebruiker. Met
// `OPDS_DATA_DIR` gezet (en niet leeg) gaat al die app-eigen data naar die
// map; zonder de variabele blijft het gedrag ongewijzigd.
//
// Indeling onder `OPDS_DATA_DIR`:
//   OpenPDFStudio/            voorkeuren, sessie, catalogi, plug-ins
//   <identifier>/             app-data (kaders, onderhoeken)
//   <identifier>/logs/        opstartdiagnose
//   <identifier>/cache/       cache (o.a. ondertekende versies)
//
// Niet omgeleid:
// - de spoolmap van de virtuele printer (`%LOCALAPPDATA%\OpenPDFPrinter\spool`).
//   Dat pad wordt bij het installeren van de printer als Windows-printerpoort
//   vastgelegd en is gedeeld met het print-subsysteem; een andere map zou
//   geen printopdrachten meer zien.
// - het WebView2-profiel. Zet daarvoor `WEBVIEW2_USER_DATA_FOLDER`.
//
// De draagbare modus (draagbaar.rs, #881) zet bij het opstarten
// `OPDS_DATA_DIR` op `<exe-map>\data` en gebruikt dus dezelfde indeling. De
// `<identifier>` blijft daarbij de gewone, ook al krijgt een draagbare start
// een eigen single-instance-identifier.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Naam van de omgevingsvariabele die de lokale datamap overschrijft.
pub const OVERRIDE_VAR: &str = "OPDS_DATA_DIR";

/// Pure beslisregel: een gezette, niet-lege (na trimmen) waarde wint.
pub fn override_uit_waarde(waarde: Option<OsString>) -> Option<PathBuf> {
    let waarde = waarde?;
    if waarde.to_string_lossy().trim().is_empty() {
        return None;
    }
    Some(PathBuf::from(waarde))
}

/// De override uit de omgeving, als die gezet is.
pub fn override_map() -> Option<PathBuf> {
    override_uit_waarde(std::env::var_os(OVERRIDE_VAR))
}

/// Schrijfbare datamap van de app op mobiel, bij het opstarten gezet uit de
/// Tauri-padresolver (#596). Op Android wijst `dirs::data_local_dir()` naar
/// een pad onder `/` dat alleen-lezen is (os error 30): voorkeuren en sessie
/// gingen daar verloren. Op het bureaublad blijft deze leeg.
static PLATFORM_MAP: OnceLock<PathBuf> = OnceLock::new();

/// Zet de schrijfbare app-datamap van het platform (mobiel). Eenmalig.
pub fn zet_platform_map(pad: PathBuf) {
    let _ = PLATFORM_MAP.set(pad);
}

/// Pure keuzeregel voor de basis: de override wint, dan de app-datamap van
/// het platform (mobiel), dan de lokale datamap van het OS (bureaublad).
pub fn kies_basis(
    override_map: Option<PathBuf>,
    platform_map: Option<PathBuf>,
    os_map: Option<PathBuf>,
) -> Option<PathBuf> {
    override_map.or(platform_map).or(os_map)
}

/// Lokale datamap van het OS. Niet op Android: daar is die alleen-lezen.
fn os_datamap() -> Option<PathBuf> {
    if cfg!(target_os = "android") {
        None
    } else {
        dirs::data_local_dir()
    }
}

/// Basis voor app-eigen lokale data (bevat de submap `OpenPDFStudio`):
/// `OPDS_DATA_DIR` als die gezet is, op mobiel de app-datamap, anders de
/// lokale datamap van het OS.
pub fn lokale_datamap() -> Option<PathBuf> {
    kies_basis(override_map(), PLATFORM_MAP.get().cloned(), os_datamap())
}

/// Welke Tauri-map bedoeld is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TauriMap {
    Data,
    Logs,
    Cache,
}

/// Pure padregel voor een Tauri-map onder een override-basis.
pub fn tauri_map_onder(basis: &Path, identifier: &str, soort: TauriMap) -> PathBuf {
    let app = basis.join(identifier);
    match soort {
        TauriMap::Data => app,
        TauriMap::Logs => app.join("logs"),
        TauriMap::Cache => app.join("cache"),
    }
}

/// Effectieve Tauri-map: onder `OPDS_DATA_DIR` als die gezet is, anders de
/// gewone Tauri-padresolver.
pub fn tauri_map<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    soort: TauriMap,
) -> tauri::Result<PathBuf> {
    use tauri::Manager;
    if let Some(basis) = override_map() {
        let identifier = crate::draagbaar::basis_identifier(&app.config().identifier);
        return Ok(tauri_map_onder(&basis, &identifier, soort));
    }
    match soort {
        TauriMap::Data => app.path().app_data_dir(),
        TauriMap::Logs => app.path().app_log_dir(),
        TauriMap::Cache => app.path().app_cache_dir(),
    }
}

/// Effectieve app-data-map voor de frontend (vervangt `path.appDataDir()`).
#[tauri::command]
pub fn app_data_dir_effectief(app: tauri::AppHandle) -> Result<String, String> {
    let map = tauri_map(&app, TauriMap::Data).map_err(|e| e.to_string())?;
    Ok(map.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zonder_variabele_geen_override() {
        assert_eq!(override_uit_waarde(None), None);
    }

    #[test]
    fn lege_of_witruimte_waarde_telt_niet() {
        assert_eq!(override_uit_waarde(Some(OsString::from(""))), None);
        assert_eq!(override_uit_waarde(Some(OsString::from("   "))), None);
    }

    #[test]
    fn gezette_waarde_wint() {
        let pad = if cfg!(windows) { r"C:\tmp\rig-data" } else { "/tmp/rig-data" };
        assert_eq!(override_uit_waarde(Some(OsString::from(pad))), Some(PathBuf::from(pad)));
    }

    #[test]
    fn basis_override_wint_van_platform_en_os() {
        let o = Some(PathBuf::from("override"));
        let p = Some(PathBuf::from("platform"));
        let os = Some(PathBuf::from("os"));
        assert_eq!(kies_basis(o.clone(), p.clone(), os.clone()), o);
        assert_eq!(kies_basis(None, p.clone(), os.clone()), p);
        assert_eq!(kies_basis(None, None, os.clone()), os);
        assert_eq!(kies_basis(None, None, None), None);
    }

    #[test]
    fn bureaublad_gebruikt_de_os_map() {
        // Op het bureaublad wordt geen platformmap gezet; de basis blijft de
        // lokale datamap van het OS (ongewijzigd gedrag, #596).
        if !cfg!(target_os = "android") {
            assert_eq!(os_datamap(), dirs::data_local_dir());
        }
    }

    #[test]
    fn tauri_mappen_onder_override() {
        let basis = PathBuf::from("rig");
        let id = "org.voorbeeld.app";
        assert_eq!(tauri_map_onder(&basis, id, TauriMap::Data), basis.join(id));
        assert_eq!(tauri_map_onder(&basis, id, TauriMap::Logs), basis.join(id).join("logs"));
        assert_eq!(tauri_map_onder(&basis, id, TauriMap::Cache), basis.join(id).join("cache"));
    }
}
