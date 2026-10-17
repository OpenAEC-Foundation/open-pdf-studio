//! Miniaturen van PDF-bestanden in Windows Verkenner (#605), aan of uit per
//! gebruiker vanuit Voorkeuren > Bestandskoppeling.
//!
//! De miniaturen zelf maakt open-pdf-thumbnails.dll (de crate
//! open-pdf-thumbnails), die naast de app en pdfium.dll wordt meegeleverd.
//! Deze module registreert hem onder HKCU\Software\Classes (geen admin) en
//! laat de bestandskoppeling en de standaard-app ongemoeid. De regels staan in
//! open-pdf-thumbnails/src/registratie.rs; die is hier met `#[path]` opgenomen
//! zodat app en DLL dezelfde CLSID en sleutels gebruiken en de tests daar
//! lokaal draaien.

use serde::Serialize;

#[cfg(target_os = "windows")]
#[path = "../../../open-pdf-thumbnails/src/registratie.rs"]
pub mod registratie;

/// Wat de voorkeuren tonen.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MiniatuurStatus {
    /// Alleen Windows.
    pub supported: bool,
    /// De DLL staat naast de app (een build zonder heeft hem niet).
    pub available: bool,
    /// Onze handler is actief voor .pdf voor deze gebruiker.
    pub enabled: bool,
    /// Naam van de werkende miniatuurhandler van een ander programma onder
    /// .pdf; aanzetten vervangt die alleen na een keuze van de gebruiker.
    pub other_handler: Option<String>,
    /// Naam van de handler van een andere standaard-PDF-app; die gebruikt
    /// Windows zolang dat programma de standaard-app is.
    pub default_app_handler: Option<String>,
}

#[cfg(target_os = "windows")]
fn bestaat(pad: &str) -> bool {
    std::path::Path::new(pad).is_file()
}

/// De DLL is er echt: een PE-bestand (begint met "MZ"). Een build zonder
/// handler heeft op die plek een leeg bestand (zie build.rs).
#[cfg(target_os = "windows")]
pub fn is_bruikbare_dll(pad: &str) -> bool {
    use std::io::Read;
    let mut kop = [0u8; 2];
    std::fs::File::open(pad).and_then(|mut f| f.read_exact(&mut kop)).is_ok() && kop == *b"MZ"
}

/// Het pad van de DLL naast de app, zonder `\\?\`-voorvoegsel (dat pad komt
/// in InprocServer32 en moet voor COM een gewoon pad zijn).
#[cfg(target_os = "windows")]
pub fn dll_pad(resource_dir: &std::path::Path) -> String {
    let pad = resource_dir.join(registratie::DLL_NAAM);
    dunce::simplified(&pad).to_string_lossy().into_owned()
}

#[cfg(target_os = "windows")]
pub fn status(resource_dir: &std::path::Path) -> MiniatuurStatus {
    use registratie::win32::{standaard_progid, Win32Register};
    let dll = dll_pad(resource_dir);
    let reg = Win32Register::echt();
    let progid = standaard_progid();
    let s = registratie::status(&reg, progid.as_deref(), &bestaat);
    MiniatuurStatus {
        supported: true,
        available: is_bruikbare_dll(&dll),
        enabled: s.actief,
        other_handler: s.ander.map(|h| h.naam),
        default_app_handler: s.via_standaard_app.map(|h| h.naam),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn status(_resource_dir: &std::path::Path) -> MiniatuurStatus {
    MiniatuurStatus::default()
}

/// Zet de miniaturen aan of uit. `vervang_ander`: de gebruiker koos ervoor de
/// handler van een ander programma (voor deze gebruiker) te vervangen.
#[cfg(target_os = "windows")]
pub fn zet(resource_dir: &std::path::Path, aan: bool, vervang_ander: bool) -> Result<MiniatuurStatus, String> {
    use registratie::win32::{meld_shell, Win32Register};
    let dll = dll_pad(resource_dir);
    if aan && !is_bruikbare_dll(&dll) {
        return Err(format!("thumbnail handler not available in this build: {dll}"));
    }
    let mut reg = Win32Register::echt();
    let uitkomst = if aan {
        registratie::zet_aan(&mut reg, &dll, vervang_ander, &bestaat)
    } else {
        registratie::zet_uit(&mut reg)
    };
    // Ook na een half gelukte wijziging: de shell moet opnieuw kijken.
    meld_shell();
    uitkomst.map_err(|e| e.to_string())?;
    Ok(status(resource_dir))
}

#[cfg(not(target_os = "windows"))]
pub fn zet(_resource_dir: &std::path::Path, _aan: bool, _vervang_ander: bool) -> Result<MiniatuurStatus, String> {
    Err("File Explorer thumbnails are only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_camel_case_json() {
        let s = MiniatuurStatus {
            supported: true,
            available: true,
            enabled: false,
            other_handler: Some("X".into()),
            default_app_handler: None,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["otherHandler"], "X");
        assert_eq!(json["defaultAppHandler"], serde_json::Value::Null);
        assert_eq!(json["enabled"], false);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn leeg_bestand_is_geen_dll() {
        let map = std::env::temp_dir().join(format!("opds-miniatuur-test-{}", std::process::id()));
        std::fs::create_dir_all(&map).unwrap();
        let leeg = map.join("leeg.dll");
        std::fs::write(&leeg, b"").unwrap();
        let pe = map.join("pe.dll");
        std::fs::write(&pe, [b'M', b'Z', 0x90, 0x00]).unwrap();
        assert!(!is_bruikbare_dll(&leeg.to_string_lossy()));
        assert!(is_bruikbare_dll(&pe.to_string_lossy()));
        assert!(!is_bruikbare_dll(&map.join("weg.dll").to_string_lossy()));
        let _ = std::fs::remove_dir_all(&map);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn dll_pad_zonder_verbatim_voorvoegsel() {
        let p = dll_pad(std::path::Path::new(r"\\?\C:\Program Files\Open PDF Studio"));
        assert_eq!(p, r"C:\Program Files\Open PDF Studio\open-pdf-thumbnails.dll");
    }
}
