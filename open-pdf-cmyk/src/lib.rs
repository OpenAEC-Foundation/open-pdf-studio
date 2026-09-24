//! RGB naar CMYK voor de PDF/X-export (#422).
//!
//! ```text
//! PDF-bytes ──convert_document──▶ PDF-bytes (incrementele update) + verslag
//!                 │
//!                 └─ CmykTransform: Little CMS met het gekozen drukprofiel
//! ```
//!
//! De app-crate bevat alleen de Tauri-schil; alles hier is zonder de app te
//! bouwen en te testen.

pub mod content;
pub mod doc;
pub mod images;
pub mod lcms;
mod lexer;
pub mod profiles;
pub mod report;
pub mod space;
pub mod transform;

pub use doc::{convert_document, ConvertError, Converted};
pub use lcms::{LcmsTransform, RenderingIntent};
pub use profiles::{ProfileError, ProfileInfo};
pub use report::Report;

use std::path::Path;

/// Resultaat van een omzetting met een profielbestand.
#[derive(Debug)]
pub struct ProfileConversion {
    pub pdf: Vec<u8>,
    pub report: Report,
    /// De bytes van het drukprofiel, voor de output-intent.
    pub profile: Vec<u8>,
    /// Naam van het profiel (uit de `desc`-tag of de bestandsnaam).
    pub profile_name: String,
}

/// Wat er mis kan gaan bij [`convert_with_profile`].
#[derive(Debug)]
pub enum Error {
    Profile(ProfileError),
    Convert(ConvertError),
    /// Little CMS kon geen transformatie maken met dit profiel.
    Transform(String),
}

impl Error {
    /// Code voor de interface: `profile:<reden>`, `encrypted`, `unreadable`
    /// of `transform`.
    pub fn code(&self) -> String {
        match self {
            Error::Profile(e) => format!("profile:{}", e.code()),
            Error::Convert(e) => e.code().to_string(),
            Error::Transform(_) => "transform".to_string(),
        }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Profile(e) => write!(f, "profile: {e}"),
            Error::Convert(e) => write!(f, "{e}"),
            Error::Transform(e) => write!(f, "transform: {e}"),
        }
    }
}

impl std::error::Error for Error {}

/// Controleert het profiel, zet het document om en geeft ook de
/// profielbytes en -naam terug.
pub fn convert_with_profile(pdf: &[u8], profile_path: &Path, intent: RenderingIntent) -> Result<ProfileConversion, Error> {
    let info = profiles::inspect_file(profile_path).map_err(Error::Profile)?;
    let profile = std::fs::read(profile_path).map_err(|_| Error::Profile(ProfileError::Unreadable))?;
    let transform = LcmsTransform::new(&profile, intent).map_err(Error::Transform)?;
    let Converted { pdf, report } = convert_document(pdf, &transform).map_err(Error::Convert)?;
    Ok(ProfileConversion { pdf, report, profile, profile_name: info.name })
}

/// Een pad uit een verzoekkop. Koppen zijn ASCII, dus de webview stuurt het
/// pad percent-gecodeerd (`encodeURIComponent`); hier weer terug naar UTF-8.
pub fn path_from_header(value: &str) -> Option<std::path::PathBuf> {
    let raw = value.as_bytes();
    let mut bytes = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' {
            let hex = std::str::from_utf8(raw.get(i + 1..i + 3)?).ok()?;
            bytes.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            bytes.push(raw[i]);
            i += 1;
        }
    }
    let text = String::from_utf8(bytes).ok()?;
    (!text.is_empty()).then(|| std::path::PathBuf::from(text))
}

/// Het antwoord aan de webview in één buffer:
/// `[u32 LE n][n bytes JSON {report, profileName}][u32 LE m][m bytes profiel][pdf]`.
pub fn pack_response(c: &ProfileConversion) -> Vec<u8> {
    let meta = serde_json::to_vec(&serde_json::json!({ "report": c.report, "profileName": c.profile_name }))
        .expect("verslag is altijd als JSON te schrijven");
    let mut out = Vec::with_capacity(8 + meta.len() + c.profile.len() + c.pdf.len());
    out.extend_from_slice(&(meta.len() as u32).to_le_bytes());
    out.extend_from_slice(&meta);
    out.extend_from_slice(&(c.profile.len() as u32).to_le_bytes());
    out.extend_from_slice(&c.profile);
    out.extend_from_slice(&c.pdf);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_path_is_percent_decoded_as_utf8() {
        let p = path_from_header("C%3A%5CProfielen%5CKrant%20Ren%C3%A9e.icc").unwrap();
        assert_eq!(p, std::path::PathBuf::from("C:\\Profielen\\Krant Renée.icc"));
        assert_eq!(path_from_header("/usr/share/color/icc/a.icc").unwrap(), std::path::PathBuf::from("/usr/share/color/icc/a.icc"));
    }

    #[test]
    fn broken_or_empty_header_path_is_refused() {
        assert_eq!(path_from_header(""), None);
        assert_eq!(path_from_header("%ZZ"), None);
        assert_eq!(path_from_header("%C3"), None);
    }
}
