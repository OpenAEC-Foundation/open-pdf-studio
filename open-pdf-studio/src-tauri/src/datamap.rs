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

use std::ffi::OsString;
use std::path::{Path, PathBuf};

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

/// Basis voor app-eigen lokale data (bevat de submap `OpenPDFStudio`):
/// `OPDS_DATA_DIR` als die gezet is, anders de lokale datamap van het OS.
pub fn lokale_datamap() -> Option<PathBuf> {
    override_map().or_else(dirs::data_local_dir)
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
        return Ok(tauri_map_onder(&basis, &app.config().identifier, soort));
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
    fn tauri_mappen_onder_override() {
        let basis = PathBuf::from("rig");
        let id = "org.voorbeeld.app";
        assert_eq!(tauri_map_onder(&basis, id, TauriMap::Data), basis.join(id));
        assert_eq!(tauri_map_onder(&basis, id, TauriMap::Logs), basis.join(id).join("logs"));
        assert_eq!(tauri_map_onder(&basis, id, TauriMap::Cache), basis.join(id).join("cache"));
    }
}
