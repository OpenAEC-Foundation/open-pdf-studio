//! Of Open PDF Studio de standaard-app voor .pdf is, uit het register (alleen
//! lezen). Dit gebeurde met `reg.exe query`; een extra systeemproces kort na
//! de start laat beveiligingssoftware de app afsluiten (#524).
//!
//! Op Linux: de desktop-id die `xdg-mime query default application/pdf`
//! noemt, en wat de app kan als die vraag niet te stellen is (Flatpak, Snap,
//! geen xdg-utils): `StandaardAppStatus` zegt het de JS-kant, die dan uitleg
//! toont in plaats van stil te falen.

use serde::Serialize;

/// The .desktop ids this app is installed under: the .deb/.rpm/AppImage
/// bundle (productName), the Snap and older builds, and the Flatpak app id.
pub const EIGEN_DESKTOP_IDS: &[&str] = &[
    "Open PDF Studio.desktop",
    "open-pdf-studio.desktop",
    "open-pdf-studio_open-pdf-studio.desktop",
    "org.openaec.OpenPdfStudio.desktop",
];

/// Is `desktop_id` (the output of `xdg-mime query default`) this app?
pub fn is_onze_desktop_id(desktop_id: &str) -> bool {
    let id = desktop_id.trim();
    EIGEN_DESKTOP_IDS.iter().any(|e| e.eq_ignore_ascii_case(id))
}

/// What the app knows and can do about the default PDF app.
/// `is_default`: None = cannot be checked here. `reason`: why it cannot be
/// checked or set ("flatpak", "snap", "xdg-mime-missing"), else None.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandaardAppStatus {
    pub is_default: Option<bool>,
    pub current: Option<String>,
    pub can_set: bool,
    pub reason: Option<&'static str>,
}

/// The Linux status. `query`: the trimmed stdout of `xdg-mime query default
/// application/pdf` when xdg-mime ran; None when it is missing or failed.
/// In a sandbox the desktop's mime associations are out of reach (xdg-mime
/// is not in the runtime and could not write the host's mimeapps.list), so
/// the desktop's own settings are the way to choose the default there.
pub fn linux_status(sandbox: Option<&'static str>, query: Option<&str>) -> StandaardAppStatus {
    if let Some(s) = sandbox {
        return StandaardAppStatus { is_default: None, current: None, can_set: false, reason: Some(s) };
    }
    match query {
        None => StandaardAppStatus { is_default: None, current: None, can_set: false, reason: Some("xdg-mime-missing") },
        Some(id) => {
            let id = id.trim();
            StandaardAppStatus {
                is_default: Some(is_onze_desktop_id(id)),
                current: (!id.is_empty()).then(|| id.trim_end_matches(".desktop").to_string()),
                can_set: true,
                reason: None,
            }
        }
    }
}

/// De beslisregel: de ProgId noemt de app, of de open-opdracht van die ProgId
/// noemt de app of het eigen programmapad. Vergelijken zonder hoofdletters.
pub fn is_onze_pdf_app(prog_id: &str, open_opdracht: Option<&str>, eigen_exe: &str) -> bool {
    let prog = prog_id.trim().to_lowercase();
    if prog.is_empty() {
        return false;
    }
    if prog.contains("openpdfstudio") {
        return true;
    }
    let Some(opdracht) = open_opdracht else { return false };
    let opdracht = opdracht.to_lowercase();
    let exe = eigen_exe.trim().to_lowercase();
    opdracht.contains("openpdfstudio") || (!exe.is_empty() && opdracht.contains(&exe))
}

/// Leest een tekstwaarde (REG_SZ of REG_EXPAND_SZ, niet uitgevouwen, zoals
/// `reg query` hem toont). `waarde` None = de standaardwaarde van de sleutel.
#[cfg(target_os = "windows")]
pub fn lees_tekst(
    hoofd: windows_sys::Win32::System::Registry::HKEY,
    sleutel: &str,
    waarde: Option<&str>,
) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, RRF_NOEXPAND, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
    };

    let breed = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let sleutel_w = breed(sleutel);
    let waarde_w = waarde.map(breed);
    let waarde_ptr = waarde_w.as_ref().map_or(std::ptr::null(), |w| w.as_ptr());
    let vlaggen = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;

    // Eerst de grootte in bytes, dan de waarde zelf.
    let mut bytes: u32 = 0;
    let r = unsafe {
        RegGetValueW(hoofd, sleutel_w.as_ptr(), waarde_ptr, vlaggen,
            std::ptr::null_mut(), std::ptr::null_mut(), &mut bytes)
    };
    if r != ERROR_SUCCESS || bytes < 2 {
        return None;
    }
    let mut buf: Vec<u16> = vec![0; (bytes as usize).div_ceil(2) + 1];
    let mut bytes = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(hoofd, sleutel_w.as_ptr(), waarde_ptr, vlaggen,
            std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut bytes)
    };
    if r != ERROR_SUCCESS {
        return None;
    }
    let lengte = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..lengte]))
}

#[cfg(test)]
mod tests {
    use super::{is_onze_desktop_id, is_onze_pdf_app, linux_status, StandaardAppStatus};

    const EXE: &str = r"C:\Program Files\Open PDF Studio\open-pdf-studio.exe";

    #[test]
    fn progid_van_de_app() {
        assert!(is_onze_pdf_app("OpenPDFStudio.pdf", None, EXE));
    }

    #[test]
    fn open_opdracht_met_het_eigen_pad() {
        let opdracht = r#""C:\Program Files\Open PDF Studio\open-pdf-studio.exe" "%1""#;
        assert!(is_onze_pdf_app("Applications\\open-pdf-studio.exe", Some(opdracht), EXE));
    }

    #[test]
    fn een_andere_app() {
        let opdracht = r#""C:\Program Files\Andere Lezer\lezer.exe" "%1""#;
        assert!(!is_onze_pdf_app("AndereLezer.Document", Some(opdracht), EXE));
        assert!(!is_onze_pdf_app("AndereLezer.Document", None, EXE));
        assert!(!is_onze_pdf_app("", Some(r#"open-pdf-studio.exe"#), EXE));
    }

    #[test]
    fn eigen_desktop_ids() {
        assert!(is_onze_desktop_id("Open PDF Studio.desktop\n"));
        assert!(is_onze_desktop_id("org.openaec.OpenPdfStudio.desktop"));
        assert!(is_onze_desktop_id("open-pdf-studio_open-pdf-studio.desktop"));
        assert!(!is_onze_desktop_id("org.gnome.Evince.desktop"));
        assert!(!is_onze_desktop_id(""));
    }

    #[test]
    fn linux_status_per_omgeving() {
        // Flatpak/Snap: niet na te gaan, niet te zetten; uitleg via reason.
        for s in ["flatpak", "snap"] {
            assert_eq!(
                linux_status(Some(s), Some("Open PDF Studio.desktop")),
                StandaardAppStatus { is_default: None, current: None, can_set: false, reason: Some(s) }
            );
        }
        assert_eq!(linux_status(None, None).reason, Some("xdg-mime-missing"));
        assert!(!linux_status(None, None).can_set);
        let ander = linux_status(None, Some("org.gnome.Evince.desktop"));
        assert_eq!(ander.is_default, Some(false));
        assert_eq!(ander.current.as_deref(), Some("org.gnome.Evince"));
        assert!(ander.can_set);
        let geen = linux_status(None, Some(""));
        assert_eq!((geen.is_default, geen.current), (Some(false), None));
        assert_eq!(linux_status(None, Some("open-pdf-studio.desktop")).is_default, Some(true));
        // JSON voor de JS-kant in camelCase.
        let json = serde_json::to_value(linux_status(Some("flatpak"), None)).unwrap();
        assert_eq!(json, serde_json::json!({"isDefault": null, "current": null, "canSet": false, "reason": "flatpak"}));
    }
}
