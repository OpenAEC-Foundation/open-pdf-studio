//! Downloads voor de extensiecatalogus (#969, js/plugins/extension-catalog.js):
//! de catalogus-JSON, de release-informatie van GitHub en `.oppx`-pakketten.
//!
//! - Alleen https, ook na een omleiding (een http-stap wordt geweigerd vóór
//!   hij wordt gevolgd).
//! - Groottegrens: tekst 2 MB, een pakket 20 MB (dezelfde grens als de
//!   installatie, `extensie_installatie::MAX_PAKKET`).
//! - Een pakket wordt getoetst aan de SHA-256 uit de catalogus (of de digest
//!   die GitHub voor het release-bestand opgeeft) en aan het verwachte id.
//! - Er wordt niets uitgevoerd: het pakket komt als bestand in een eigen
//!   tijdelijke map en gaat daarna door de bestaande transactionele
//!   installatie (`extensie_inspecteer` / `extensie_installeer`).

use crate::extensie_installatie::{self, Bron, MAX_PAKKET};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const MAX_TEKST: usize = 2 * 1024 * 1024;
const MAX_OMLEIDINGEN: usize = 10;
const DOWNLOADMAP: &str = "opds-extensie-downloads";
const OUDER_DAN: Duration = Duration::from_secs(24 * 60 * 60);

/// Alleen `https://` met een host; geen gebruikersnaam of wachtwoord in de link.
pub fn controleer_https(url: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(url.trim()).map_err(|_| format!("Invalid link: {url}"))?;
    if u.scheme() != "https" {
        return Err("Only https:// links are allowed".to_string());
    }
    if u.host_str().map_or(true, str::is_empty) {
        return Err(format!("Invalid link: {url}"));
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("Links with a user name or password are not allowed".to_string());
    }
    Ok(u)
}

/// Klopt `data` met de verwachte SHA-256 (hex, hoofdletters maken niet uit)?
pub fn controleer_sha256(data: &[u8], verwacht: Option<&str>) -> Result<String, String> {
    let echt = extensie_installatie::sha256_hex(data);
    match verwacht.map(str::trim).filter(|s| !s.is_empty()) {
        Some(v) if !echt.eq_ignore_ascii_case(v) => Err(format!(
            "SHA-256 mismatch: the download is not the expected package (expected {}, got {echt})",
            v.to_ascii_lowercase()
        )),
        _ => Ok(echt),
    }
}

/// Is een (aangekondigde of tot nu toe ontvangen) grootte boven de grens?
pub fn te_groot(grootte: u64, max: usize) -> Option<String> {
    (grootte > max as u64).then(|| format!("Download is larger than {} MB", max / (1024 * 1024)))
}

fn klant() -> Result<reqwest::Client, String> {
    let beleid = reqwest::redirect::Policy::custom(|poging| {
        if poging.previous().len() >= MAX_OMLEIDINGEN {
            poging.error("too many redirects")
        } else if poging.url().scheme() != "https" {
            poging.error("redirect to a non-https link refused")
        } else {
            poging.follow()
        }
    });
    reqwest::Client::builder()
        .user_agent(concat!("OpenPDFStudio-extensions/", env!("CARGO_PKG_VERSION")))
        .redirect(beleid)
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())
}

async fn haal(url: &str, max: usize) -> Result<Vec<u8>, String> {
    let u = controleer_https(url)?;
    let accept = if u.host_str() == Some("api.github.com") {
        "application/vnd.github+json"
    } else {
        "application/json, application/octet-stream, */*"
    };
    let mut antwoord = klant()?
        .get(u)
        .header("Accept", accept)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !antwoord.status().is_success() {
        return Err(format!("Download failed: HTTP {}", antwoord.status()));
    }
    controleer_https(antwoord.url().as_str())?;
    if let Some(f) = antwoord.content_length().and_then(|n| te_groot(n, max)) {
        return Err(f);
    }
    let mut data = Vec::new();
    while let Some(stuk) = antwoord.chunk().await.map_err(|e| format!("Download failed: {e}"))? {
        data.extend_from_slice(&stuk);
        if let Some(f) = te_groot(data.len() as u64, max) {
            return Err(f);
        }
    }
    Ok(data)
}

fn downloadmap() -> PathBuf {
    std::env::temp_dir().join(DOWNLOADMAP)
}

/// Oude downloads (van een afgebroken installatie) opruimen.
fn ruim_oude_op(map: &Path) {
    let Ok(lijst) = std::fs::read_dir(map) else { return };
    for e in lijst.flatten() {
        let oud = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .map_or(false, |d| d > OUDER_DAN);
        if oud && e.path().extension().map_or(false, |x| x == "oppx") {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Ligt `pad` direct in `map` en is het een `.oppx`? Alleen zulke bestanden
/// mag `extensie_pakket_opruimen` weghalen.
pub fn is_eigen_download(map: &Path, pad: &Path) -> bool {
    let (Ok(m), Ok(p)) = (std::fs::canonicalize(map), std::fs::canonicalize(pad)) else { return false };
    p.parent() == Some(m.as_path()) && p.extension().map_or(false, |x| x == "oppx") && p.is_file()
}

/// Een klein tekstbestand: de catalogus-JSON of release-informatie van GitHub.
#[tauri::command]
pub async fn extensie_tekst_ophalen(url: String) -> Result<String, String> {
    let data = haal(&url, MAX_TEKST).await?;
    String::from_utf8(data).map_err(|_| "The answer is not UTF-8 text".to_string())
}

/// Download een `.oppx` naar een tijdelijk bestand en controleer het: de
/// SHA-256 (als die bekend is), het pakket zelf (zoals bij installeren) en het
/// id (als `verwacht_id` is gegeven). Geeft `{ pad, id, name, version, sha256 }`.
#[tauri::command]
pub async fn extensie_pakket_ophalen(url: String, sha256: Option<String>, verwacht_id: Option<String>) -> Result<Value, String> {
    let data = haal(&url, MAX_PAKKET as usize).await?;
    let echt = controleer_sha256(&data, sha256.as_deref())?;
    let map = downloadmap();
    std::fs::create_dir_all(&map).map_err(|e| format!("Cannot create the download folder: {e}"))?;
    ruim_oude_op(&map);
    let pad = map.join(format!("{}.oppx", extensie_installatie::nieuw_token()));
    std::fs::write(&pad, &data).map_err(|e| format!("Cannot write the download: {e}"))?;
    let pad_tekst = pad.to_string_lossy().to_string();
    let controle = extensie_installatie::inspecteer_pakket(&pad_tekst, Bron::Ui, Some(&extensie_installatie::plugins_map()));
    let info = match controle {
        Ok((info, _)) => info,
        Err(f) => {
            let _ = std::fs::remove_file(&pad);
            return Err(format!("{}: {}", f.code, f.message));
        }
    };
    if let Some(v) = verwacht_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if info.id != v {
            let _ = std::fs::remove_file(&pad);
            return Err(format!("The package has id \"{}\", but \"{v}\" was expected", info.id));
        }
    }
    Ok(json!({ "pad": pad_tekst, "id": info.id, "name": info.name, "version": info.version, "sha256": echt }))
}

/// Het tijdelijke bestand na de installatie weghalen (alleen eigen downloads).
#[tauri::command]
pub fn extensie_pakket_opruimen(pad: String) -> Result<(), String> {
    let p = PathBuf::from(&pad);
    if !is_eigen_download(&downloadmap(), &p) {
        return Err("Not a downloaded extension package".to_string());
    }
    std::fs::remove_file(&p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alleen_https() {
        assert!(controleer_https("https://example.org/a.json").is_ok());
        assert!(controleer_https("http://example.org/a.json").is_err());
        assert!(controleer_https("file:///C:/a.oppx").is_err());
        assert!(controleer_https("https://user:pw@example.org/a").is_err());
        assert!(controleer_https("geen link").is_err());
    }

    #[test]
    fn sha256_wordt_getoetst() {
        let data = b"abc";
        let goed = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert_eq!(controleer_sha256(data, Some(goed)).unwrap(), goed);
        assert!(controleer_sha256(data, Some(&goed.to_ascii_uppercase())).is_ok());
        assert!(controleer_sha256(data, None).is_ok());
        assert!(controleer_sha256(data, Some("")).is_ok());
        let fout = controleer_sha256(data, Some(&"0".repeat(64))).unwrap_err();
        assert!(fout.contains("SHA-256 mismatch"));
    }

    #[test]
    fn groottegrens() {
        assert!(te_groot(10, 10).is_none());
        assert!(te_groot(11, 10).is_some());
        assert!(te_groot(MAX_PAKKET + 1, MAX_PAKKET as usize).is_some());
    }

    #[test]
    fn opruimen_alleen_in_eigen_map() {
        let map = std::env::temp_dir().join(format!("opds-cat-test-{}", extensie_installatie::nieuw_token()));
        std::fs::create_dir_all(&map).unwrap();
        let goed = map.join("x.oppx");
        std::fs::write(&goed, b"x").unwrap();
        let ander = map.join("x.txt");
        std::fs::write(&ander, b"x").unwrap();
        assert!(is_eigen_download(&map, &goed));
        assert!(!is_eigen_download(&map, &ander));
        assert!(!is_eigen_download(&map, &map.join("..").join("x.oppx")));
        let _ = std::fs::remove_dir_all(&map);
    }
}
