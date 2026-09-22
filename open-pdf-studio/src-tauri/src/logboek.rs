// Het logboek van de Rust-kant: waarheen, hoe uitgebreid en hoe groot.
//
// Zonder geregistreerde logger zijn `log::info!` en zijn broers lege hulzen:
// de regels worden weggegooid voordat ze ergens aankomen. Deze module zet
// `tauri-plugin-log` op zodra de app een AppHandle heeft, met:
//
// - een roterend logbestand in de logmap van de app (zie `logmap`);
// - in een ontwikkelbouw ook de standaarduitvoer, zodat `tauri dev` de regels
//   meteen laat zien;
// - standaardniveau `info`, met `OPDS_LOG` als stuurknop (zie `niveau`);
// - een strengere drempel voor code van derden (zie `niveau_derden`), anders
//   vullen venster-, netwerk- en TLS-bibliotheken het bestand.
//
// De regels lopen ook in een release-bouw door: de `log`-crate staat zonder
// `release_max_level_*` in Cargo.toml, dus er wordt niets weggecompileerd.
//
// Wat er NIET in mag: inhoud van documenten (tekst, annotaties, afbeeldingen).
// Paden van de gebruiker mogen wel — het bestand blijft lokaal en zonder pad
// is een foutmelding meestal onbruikbaar.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use log::LevelFilter;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// Omgevingsvariabele die het logniveau bepaalt.
pub const NIVEAU_VAR: &str = "OPDS_LOG";

/// Omgevingsvariabele die de lokale datamap van de app verlegt (testinstanties).
pub const DATAMAP_VAR: &str = "OPDS_DATA_DIR";

/// Niveau zonder (bruikbare) `OPDS_LOG`.
pub const STANDAARDNIVEAU: LevelFilter = LevelFilter::Info;

/// Bij deze grootte gaat het logbestand op de rol (2 MiB).
pub const MAX_BESTANDSGROOTTE: u128 = 2 * 1024 * 1024;

/// Zoveel logbestanden blijven bewaard; samen dus hooguit ~10 MiB.
pub const AANTAL_BESTANDEN: usize = 5;

/// Naam van het logbestand (de plug-in zet er `.log` achter). Vast gekozen:
/// de productnaam, die de plug-in anders neemt, heeft spaties.
pub const BESTANDSNAAM: &str = "open-pdf-studio";

/// Modules waarvoor het gekozen niveau geldt: de app zelf.
const EIGEN_MODULES: [&str; 2] = ["app_lib", "open_pdf_studio"];

/// Pure regel: welk niveau hoort bij een waarde van `OPDS_LOG`?
///
/// Hoofdletters en spaties maken niet uit. Een lege, ontbrekende of onbekende
/// waarde valt terug op de standaard, zodat een typefout nooit het logboek
/// stilzet.
pub fn niveau(waarde: Option<&str>) -> LevelFilter {
    match waarde.map(|w| w.trim().to_ascii_lowercase()).as_deref() {
        Some("off") => LevelFilter::Off,
        Some("error") => LevelFilter::Error,
        Some("warn") | Some("warning") => LevelFilter::Warn,
        Some("info") => LevelFilter::Info,
        Some("debug") => LevelFilter::Debug,
        Some("trace") => LevelFilter::Trace,
        _ => STANDAARDNIVEAU,
    }
}

/// Pure regel: welk niveau geldt voor bibliotheken van derden?
///
/// Hun `info`-regels (vensterbeheer, HTTP, TLS) zijn voor een gebruikersvraag
/// zelden interessant en verdringen onze eigen regels uit het bestand, dus ze
/// komen er hooguit als waarschuwing in. Wie `trace` vraagt, wil juist alles
/// zien en krijgt ze wel.
pub fn niveau_derden(eigen: LevelFilter) -> LevelFilter {
    if eigen == LevelFilter::Trace { LevelFilter::Trace } else { eigen.min(LevelFilter::Warn) }
}

/// Pure regel: een gezette, niet-lege (na trimmen) waarde telt als override.
pub fn override_uit_waarde(waarde: Option<OsString>) -> Option<PathBuf> {
    let waarde = waarde?;
    if waarde.to_string_lossy().trim().is_empty() {
        return None;
    }
    Some(PathBuf::from(waarde))
}

/// De basis van de verlegde datamap, als `OPDS_DATA_DIR` gezet is.
///
/// Eigen, kleine lezing van de variabele: op deze tak bestaat de gedeelde
/// hulp uit de open PR met `datamap.rs` nog niet. Na het samenvoegen met die
/// PR hoort deze functie te verdwijnen en gaat `logmap_van_app` over op
/// `datamap::tauri_map(app, datamap::TauriMap::Logs)`, dat precies dezelfde
/// indeling `<basis>/<identifier>/logs` oplevert.
pub fn override_basis() -> Option<PathBuf> {
    override_uit_waarde(std::env::var_os(DATAMAP_VAR))
}

/// Pure regel: waar komt het logbestand?
///
/// Met een override (een testinstantie met een eigen `OPDS_DATA_DIR`) onder
/// `<basis>/<identifier>/logs`, zodat zo'n instantie niet in het logboek van
/// de geïnstalleerde app schrijft. Zonder override de logmap die het platform
/// aanwijst.
pub fn logmap(override_basis: Option<&Path>, identifier: &str, standaard: &Path) -> PathBuf {
    match override_basis {
        Some(basis) => basis.join(identifier).join("logs"),
        None => standaard.to_path_buf(),
    }
}

/// De logmap van deze app-instantie.
fn logmap_van_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    use tauri::Manager;
    let standaard = app.path().app_log_dir().map_err(|e| format!("logmap onbekend: {e}"))?;
    Ok(logmap(override_basis().as_deref(), &app.config().identifier, &standaard))
}

/// Waar een logregel heen gaat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Doel {
    /// Het roterende logbestand in deze map.
    Bestand(PathBuf),
    /// De standaarduitvoer (`tauri dev` laat die zien).
    Standaarduitvoer,
}

/// Pure regel: welke doelen krijgt de logger?
///
/// Deze lijst **vervangt** de standaardlijst van de plug-in. Die bevat naast
/// de standaarduitvoer ook de logmap die het platform aanwijst, en dat is
/// precies wat een testinstantie met `OPDS_DATA_DIR` níét mag raken: zonder
/// vervanging schrijft ze alsnog in het logboek van de geïnstalleerde app.
pub fn doelen(map: &Path, ontwikkelbouw: bool) -> Vec<Doel> {
    let mut lijst = vec![Doel::Bestand(map.to_path_buf())];
    // Een geïnstalleerde app heeft op Windows geen console om naar te
    // schrijven; in een ontwikkelbouw is de uitvoer juist het snelste venster
    // op wat de Rust-kant doet.
    if ontwikkelbouw {
        lijst.push(Doel::Standaarduitvoer);
    }
    lijst
}

/// Zet de logger op en meld waar het logboek staat.
///
/// Fouten zijn niet fataal: de app start ook zonder logboek. De aanroeper
/// meldt ze op de standaardfoutuitvoer.
pub fn registreer<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let map = logmap_van_app(app)?;
    let eigen = niveau(std::env::var(NIVEAU_VAR).ok().as_deref());

    let doelen = doelen(&map, cfg!(debug_assertions)).into_iter().map(|doel| match doel {
        Doel::Bestand(map) => Target::new(TargetKind::Folder {
            path: map,
            file_name: Some(BESTANDSNAAM.to_string()),
        }),
        Doel::Standaarduitvoer => Target::new(TargetKind::Stdout),
    });

    let mut plugin = tauri_plugin_log::Builder::new()
        .level(niveau_derden(eigen))
        .max_file_size(MAX_BESTANDSGROOTTE)
        .rotation_strategy(RotationStrategy::KeepSome(AANTAL_BESTANDEN))
        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
        .targets(doelen);
    for module in EIGEN_MODULES {
        plugin = plugin.level_for(module, eigen);
    }

    app.plugin(plugin.build()).map_err(|e| format!("logger niet geregistreerd: {e}"))?;
    log::info!("[logboek] niveau {eigen} ({NIVEAU_VAR}), map {}", map.display());
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logboek_niveau_standaard_is_info() {
        assert_eq!(niveau(None), LevelFilter::Info);
        assert_eq!(niveau(Some("")), LevelFilter::Info);
        assert_eq!(niveau(Some("   ")), LevelFilter::Info);
    }

    #[test]
    fn logboek_niveau_leest_naam_ongeacht_hoofdletters() {
        assert_eq!(niveau(Some("debug")), LevelFilter::Debug);
        assert_eq!(niveau(Some(" TRACE ")), LevelFilter::Trace);
        assert_eq!(niveau(Some("Warning")), LevelFilter::Warn);
        assert_eq!(niveau(Some("off")), LevelFilter::Off);
    }

    #[test]
    fn logboek_onbruikbaar_niveau_valt_terug_op_standaard() {
        assert_eq!(niveau(Some("uitgebreid")), STANDAARDNIVEAU);
        assert_eq!(niveau(Some("9")), STANDAARDNIVEAU);
    }

    #[test]
    fn logboek_derden_blijven_op_waarschuwing() {
        assert_eq!(niveau_derden(LevelFilter::Info), LevelFilter::Warn);
        assert_eq!(niveau_derden(LevelFilter::Debug), LevelFilter::Warn);
        assert_eq!(niveau_derden(LevelFilter::Error), LevelFilter::Error);
        assert_eq!(niveau_derden(LevelFilter::Off), LevelFilter::Off);
    }

    #[test]
    fn logboek_derden_mogen_alles_bij_trace() {
        assert_eq!(niveau_derden(LevelFilter::Trace), LevelFilter::Trace);
    }

    #[test]
    fn logboek_zonder_override_de_standaardmap() {
        let standaard = PathBuf::from("logmap-van-het-platform");
        assert_eq!(logmap(None, "org.voorbeeld.app", &standaard), standaard);
    }

    #[test]
    fn logboek_met_override_onder_de_eigen_datamap() {
        let basis = PathBuf::from("rig-data");
        let standaard = PathBuf::from("logmap-van-het-platform");
        assert_eq!(
            logmap(Some(&basis), "org.voorbeeld.app", &standaard),
            basis.join("org.voorbeeld.app").join("logs")
        );
    }

    #[test]
    fn logboek_lege_override_telt_niet() {
        assert_eq!(override_uit_waarde(None), None);
        assert_eq!(override_uit_waarde(Some(OsString::from(""))), None);
        assert_eq!(override_uit_waarde(Some(OsString::from("  "))), None);
    }

    #[test]
    fn logboek_gezette_override_wint() {
        let pad = if cfg!(windows) { r"C:\tmp\rig-data" } else { "/tmp/rig-data" };
        assert_eq!(override_uit_waarde(Some(OsString::from(pad))), Some(PathBuf::from(pad)));
    }

    #[test]
    fn logboek_schrijft_alleen_naar_de_eigen_map() {
        let map = PathBuf::from("rig-data").join("org.voorbeeld.app").join("logs");
        assert_eq!(doelen(&map, false), vec![Doel::Bestand(map.clone())]);
    }

    #[test]
    fn logboek_ontwikkelbouw_ook_naar_de_standaarduitvoer() {
        let map = PathBuf::from("logmap");
        assert_eq!(doelen(&map, true), vec![Doel::Bestand(map), Doel::Standaarduitvoer]);
    }

    /// De hele weg: een app-handle zonder venster (de mock-runtime van Tauri),
    /// de logger erop, en dan staat er een logbestand in de map uit
    /// `OPDS_DATA_DIR` met de gemelde regel erin.
    ///
    /// Eén test, geen tweede: een logger is per proces maar één keer te zetten.
    #[test]
    fn logboek_schrijft_in_de_map_uit_opds_data_dir() {
        use tauri::Manager;
        let map = std::env::temp_dir().join(format!("opds-logboek-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&map);
        std::env::set_var(DATAMAP_VAR, &map);
        std::env::set_var(NIVEAU_VAR, "info");
        let app = tauri::test::mock_app();
        // Het bestand dat de standaardlijst van de plug-in zou aanmaken: dat
        // hoort er met een override juist NIET bij te komen.
        let standaardbestand = app
            .path()
            .app_log_dir()
            .expect("standaard logmap")
            .join(format!("{}.log", app.package_info().name));
        let bestond_al = standaardbestand.exists();
        let doel = registreer(app.handle()).expect("logger geregistreerd");
        std::env::remove_var(DATAMAP_VAR);
        std::env::remove_var(NIVEAU_VAR);

        assert!(doel.starts_with(&map), "logboek buiten de eigen datamap: {}", doel.display());
        assert_eq!(doel.file_name().and_then(|n| n.to_str()), Some("logs"));

        log::info!("[logboek-test] deze regel hoort in het bestand");
        log::logger().flush();
        let bestand = doel.join(format!("{BESTANDSNAAM}.log"));
        let inhoud = std::fs::read_to_string(&bestand).expect("logbestand te lezen");
        assert_eq!(
            inhoud.matches("[logboek-test] deze regel hoort in het bestand").count(),
            1,
            "de regel hoort er precies één keer in te staan, in {}: {inhoud}",
            bestand.display()
        );
        assert_eq!(
            standaardbestand.exists(),
            bestond_al,
            "met een eigen datamap hoort er niets in de standaardlogmap te komen: {}",
            standaardbestand.display()
        );
        let _ = std::fs::remove_dir_all(&map);
    }
}
