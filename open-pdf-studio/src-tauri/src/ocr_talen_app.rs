//! Tauri-opdrachten voor de OCR-talen (#1083). De regels (map, kopie,
//! codes, controle van een download) staan in `ocr_talen.rs`; hier alleen
//! de koppeling met de app en de download zelf.
//!
//! - `ocr_languages_list`: de talen in de effectieve map, de downloadbare
//!   talen en het pad van de map.
//! - `ocr_language_download { code }`: één taal uit de vaste lijst downloaden
//!   naar de map van de gebruiker. Alleen op een klik van de gebruiker.

use crate::ocr_talen;
use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

const MAX_OMLEIDINGEN: usize = 10;

/// Antwoord van `ocr_languages_list` en `ocr_language_download`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTalen {
    /// De map waaruit Tesseract leest.
    pub folder: String,
    /// Wat "Map openen" aanwijst (een taalbestand in de map, of de map).
    pub reveal_path: String,
    /// Is `folder` de map van de gebruiker (dus kan er een taal bij)?
    pub user_folder: bool,
    /// De talen in `folder` (codes, gesorteerd, zonder `osd`).
    pub available: Vec<String>,
    /// De talen die de app kan downloaden.
    pub downloadable: Vec<String>,
}

fn meegeleverde_map<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource_dir: {e}"))?;
    Ok(resource_dir.join(ocr_talen::MAP_NAAM))
}

fn gebruikersmap() -> Option<PathBuf> {
    crate::datamap::lokale_datamap().map(|d| ocr_talen::gebruikersmap(&d))
}

/// De map voor Tesseract: de map van de gebruiker (met de meegeleverde talen
/// erin gekopieerd), of de meegeleverde map als dat niet lukt.
pub fn effectieve_tessdata<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let bundel = meegeleverde_map(app)?;
    Ok(ocr_talen::effectieve_map(&bundel, gebruikersmap().as_deref()))
}

/// Weiger een taalopgave die geen `auto` of `code+code` is: die gaat als
/// bestandsnaam naar Tesseract.
pub fn controleer_taalspec(lang: &str) -> Result<(), String> {
    if ocr_talen::is_geldige_taalspec(lang) {
        Ok(())
    } else {
        Err(format!("OCR_LANGUAGE_SPEC:invalid OCR language \"{lang}\""))
    }
}

fn overzicht<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<OcrTalen, String> {
    let map = effectieve_tessdata(app)?;
    let user_folder = gebruikersmap().map_or(false, |g| g == map);
    Ok(OcrTalen {
        folder: map.to_string_lossy().to_string(),
        reveal_path: ocr_talen::toon_pad(&map).to_string_lossy().to_string(),
        user_folder,
        available: ocr_talen::lijst_talen(&map),
        downloadable: ocr_talen::DOWNLOADBARE_TALEN.iter().map(|c| c.to_string()).collect(),
    })
}

/// De OCR-talen die er zijn, de downloadbare talen en de map.
#[tauri::command]
pub async fn ocr_languages_list(app: tauri::AppHandle) -> Result<OcrTalen, String> {
    tauri::async_runtime::spawn_blocking(move || overzicht(&app))
        .await
        .map_err(|e| format!("OCR language task panicked: {e}"))?
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
        .user_agent(concat!("OpenPDFStudio-ocr/", env!("CARGO_PKG_VERSION")))
        .redirect(beleid)
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("OCR_LANGUAGE_DOWNLOAD:{e}"))
}

/// Download `url` naar `tijdelijk`, met de groottegrens van `ocr_talen`.
async fn download_naar(url: &str, tijdelijk: &std::path::Path) -> Result<(), String> {
    let mut antwoord = klant()?
        .get(url)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|e| format!("OCR_LANGUAGE_DOWNLOAD:{e}"))?;
    if !antwoord.status().is_success() {
        return Err(format!("OCR_LANGUAGE_DOWNLOAD:HTTP {}", antwoord.status()));
    }
    if antwoord.content_length().map_or(false, |n| n > ocr_talen::MAX_GROOTTE) {
        return Err("OCR_LANGUAGE_INVALID:the download is too large".into());
    }
    let mut bestand = std::fs::File::create(tijdelijk).map_err(|e| format!("OCR_LANGUAGE_WRITE:{e}"))?;
    let mut totaal: u64 = 0;
    while let Some(stuk) = antwoord.chunk().await.map_err(|e| format!("OCR_LANGUAGE_DOWNLOAD:{e}"))? {
        totaal += stuk.len() as u64;
        if totaal > ocr_talen::MAX_GROOTTE {
            return Err("OCR_LANGUAGE_INVALID:the download is too large".into());
        }
        bestand.write_all(&stuk).map_err(|e| format!("OCR_LANGUAGE_WRITE:{e}"))?;
    }
    bestand.sync_all().map_err(|e| format!("OCR_LANGUAGE_WRITE:{e}"))?;
    Ok(())
}

/// Download één taal (`code` uit de vaste lijst) uit tessdata_fast naar de
/// map van de gebruiker. Geeft daarna het nieuwe overzicht.
#[tauri::command]
pub async fn ocr_language_download(app: tauri::AppHandle, code: String) -> Result<OcrTalen, String> {
    // Eerst de code: alleen uit de lijst wordt een URL gebouwd.
    let url = ocr_talen::download_url(&code)?;
    let app2 = app.clone();
    let map = tauri::async_runtime::spawn_blocking(move || effectieve_tessdata(&app2))
        .await
        .map_err(|e| format!("OCR language task panicked: {e}"))??;
    if gebruikersmap().as_deref() != Some(map.as_path()) {
        return Err("OCR_LANGUAGE_FOLDER:the language folder cannot be written".into());
    }
    let tijdelijk = ocr_talen::tijdelijk_pad(&map.join(format!("{code}.{}", ocr_talen::EXTENSIE)));
    if let Err(f) = download_naar(&url, &tijdelijk).await {
        let _ = std::fs::remove_file(&tijdelijk);
        return Err(f);
    }
    let (m, c) = (map.clone(), code.clone());
    tauri::async_runtime::spawn_blocking(move || ocr_talen::rond_download_af(&tijdelijk, &m, &c))
        .await
        .map_err(|e| format!("OCR language task panicked: {e}"))??;
    tauri::async_runtime::spawn_blocking(move || overzicht(&app))
        .await
        .map_err(|e| format!("OCR language task panicked: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taalspec_fouten_hebben_een_code() {
        assert!(controleer_taalspec("nld+eng").is_ok());
        assert!(controleer_taalspec("auto").is_ok());
        assert!(controleer_taalspec("../../x").unwrap_err().starts_with("OCR_LANGUAGE_SPEC:"));
    }
}
