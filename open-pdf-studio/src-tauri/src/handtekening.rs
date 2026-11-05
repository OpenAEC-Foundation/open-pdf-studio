//! Commando-schil voor digitale handtekeningen (#374). Lezen, ondertekenen en
//! verifiëren zitten in de crate `open-pdf-signatures` (zonder Tauri, apart te
//! testen); hier staan alleen de Tauri-commando's die er een thread en de
//! app-mappen omheen zetten.

use std::path::Path;

pub use open_pdf_signatures::{certificaat, onderteken, verifieer};

use open_pdf_signatures::certificaat::{CertificaatInfo, InfoFout};
use open_pdf_signatures::onderteken::{onderteken_bestand, OndertekenFout, Ondertekenopties};
use open_pdf_signatures::verifieer::{
    io_fout, map_ondertekende_versies, schrijf_ondertekende_versie, verifieer_bestand, HandtekeningInfo, LijstFout,
};

/// Gegevens van het ondertekencertificaat in een .p12, zonder iets te ondertekenen.
/// Lezen en sleutelafleiding (tot miljoenen iteraties) lopen via `spawn_blocking`,
/// zodat de hoofdthread niet blokkeert.
#[tauri::command]
pub async fn pdf_certificate_info(pad: String, wachtwoord: String) -> Result<CertificaatInfo, InfoFout> {
    let wachtwoord = zeroize::Zeroizing::new(wachtwoord);
    tauri::async_runtime::spawn_blocking(move || certificaat::info_uit_bestand(Path::new(&pad), &wachtwoord))
        .await
        .map_err(|e| InfoFout::Onleesbaar { detail: e.to_string() })?
}

/// Verifieert alle handtekeningen in `pad` (spec §4.1). Loopt op een aparte
/// thread: het rootarchief laden en hashen houdt het openen niet op (spec §7.3).
#[tauri::command]
pub async fn pdf_signature_list(pad: String) -> Result<Vec<HandtekeningInfo>, LijstFout> {
    tauri::async_runtime::spawn_blocking(move || verifieer_bestand(Path::new(&pad)))
        .await
        .map_err(io_fout)?
}

/// Schrijft de ondertekende versie van handtekening `nummer` naar een nieuw
/// bestand in de cachemap van de app en geeft het absolute pad (spec §4.1, "Toon
/// ondertekende versie"). Het bestand komt in de fs-scope, zodat de UI het kan
/// openen en verwijderen. `bereik_einde` (JS: `bereikEinde`, optioneel): het
/// einde uit de lijst; wijkt het af, dan [`LijstFout::GewijzigdSindsLijst`].
#[tauri::command]
pub async fn pdf_signed_revision(
    app: tauri::AppHandle,
    pad: String,
    nummer: usize,
    bereik_einde: Option<u64>,
) -> Result<String, LijstFout> {
    use tauri_plugin_fs::FsExt;
    let cachemap = crate::datamap::tauri_map(&app, crate::datamap::TauriMap::Cache).map_err(io_fout)?;
    let doel = tauri::async_runtime::spawn_blocking(move || {
        schrijf_ondertekende_versie(&map_ondertekende_versies(&cachemap), &pad, nummer, bereik_einde)
    })
    .await
    .map_err(io_fout)??;
    let _ = app.fs_scope().allow_file(&doel);
    Ok(doel.to_string_lossy().into_owned())
}

/// Hoe lang een tijdstempeldienst mag doen over één antwoord.
const TIJDSTEMPEL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Vraagt een RFC 3161-tijdstempel over `handtekeningwaarde` bij de dienst op
/// `url` (alleen http/https). Blokkeert; draait binnen `spawn_blocking`.
fn haal_tijdstempel(url: &str, handtekeningwaarde: &[u8]) -> Result<Vec<u8>, String> {
    let geldig = url::Url::parse(url).map_err(|e| format!("ongeldige URL: {e}"))?;
    if !matches!(geldig.scheme(), "http" | "https") {
        return Err("alleen http- en https-adressen".to_string());
    }
    let (verzoek, nonce) = open_pdf_signatures::tsa::verzoek(handtekeningwaarde)?;
    let antwoord = tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::builder().timeout(TIJDSTEMPEL_TIMEOUT).build().map_err(|e| e.to_string())?;
        let r = client
            .post(geldig)
            .header("Content-Type", "application/timestamp-query")
            .header("Accept", "application/timestamp-reply")
            .body(verzoek)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("HTTP {}", r.status()));
        }
        r.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
    })?;
    open_pdf_signatures::tsa::token_uit_antwoord(&antwoord, handtekeningwaarde, &nonce)
}

/// Ondertekent het opgeslagen bestand `bron` met het certificaat uit het
/// .p12/.pfx `p12` naar het nieuwe bestand `doel` (spec §4.1, "Ondertekend
/// opslaan als…"). Met `tijdstempel_url` komt er een RFC 3161-tijdstempel bij;
/// mislukt dat, dan de fout `tijdstempel` en geen bestand (de UI vraagt dan of
/// het zonder mag). Geeft het doelpad; dat komt in de fs-scope.
#[tauri::command]
pub async fn pdf_sign(
    app: tauri::AppHandle,
    bron: String,
    doel: String,
    p12: String,
    wachtwoord: String,
    opties: Ondertekenopties,
    tijdstempel_url: Option<String>,
) -> Result<String, OndertekenFout> {
    use tauri_plugin_fs::FsExt;
    let wachtwoord = zeroize::Zeroizing::new(wachtwoord);
    let doel_pad = std::path::PathBuf::from(&doel);
    let pad = doel_pad.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let url = tijdstempel_url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
        let mut haal = |waarde: &[u8]| haal_tijdstempel(url.as_deref().unwrap_or_default(), waarde);
        let tijdstempel: Option<open_pdf_signatures::onderteken::Tijdstempelaar<'_>> =
            if url.is_some() { Some(&mut haal) } else { None };
        onderteken_bestand(Path::new(&bron), &pad, Path::new(&p12), &wachtwoord, &opties, tijdstempel)
    })
    .await
    .map_err(|e| OndertekenFout::Intern { detail: e.to_string() })??;
    let _ = app.fs_scope().allow_file(&doel_pad);
    Ok(doel)
}
