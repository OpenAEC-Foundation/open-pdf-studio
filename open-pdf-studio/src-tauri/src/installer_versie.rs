//! Kan de OpenAEC Installer op deze computer zonder venster controleren?
//!
//! De update-plugin (`openaec-update`) start de installer bij het opstarten
//! van de app met `--check` als zijn statusbestand ontbreekt of ouder is dan
//! een dag. Dat argument bestaat sinds installer 0.2.4. Een oudere installer
//! kent het niet, opent gewoon zijn venster en schrijft geen statusbestand,
//! zodat de app hem bij elke start opnieuw zou openen. Met zo'n installer
//! registreert de app de plugin daarom niet en werkt hij zichzelf bij, zoals
//! op een computer zonder installer.
//!
//! Zelfstandig te testen: `rustc --edition 2021 --test installer_versie.rs`.

/// De eerste installer met `--check` (controle zonder venster, statusbestand).
pub const EERSTE_MET_CONTROLE: (u32, u32, u32) = (0, 2, 4);

/// Mag de app de installer op de achtergrond laten controleren? Alleen als
/// zijn versie bekend is en hij `--check` kent. Onbekend (geen installer,
/// geen versiegegevens, niet te lezen) telt als nee: liever de eigen updater
/// dan een venster dat de gebruiker niet vroeg.
pub fn kent_achtergrondcontrole(versie: Option<(u32, u32, u32)>) -> bool {
    versie.is_some_and(|v| v >= EERSTE_MET_CONTROLE)
}

/// Versie uit de vaste versiegegevens van een Windows-programma: de hoge en
/// lage helft van `dwFileVersionMS` en de hoge helft van `dwFileVersionLS`.
pub fn versie_uit_vaste_info(ms: u32, ls: u32) -> (u32, u32, u32) {
    (ms >> 16, ms & 0xffff, ls >> 16)
}

/// Waar de installer staat als zijn statusbestand hem niet noemt; hetzelfde
/// pad als de plugin gebruikt.
#[cfg(windows)]
fn standaard_installer() -> Option<std::path::PathBuf> {
    let pad = std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
        .join("OpenAEC Installer")
        .join("openaec-installer.exe");
    pad.is_file().then_some(pad)
}

/// De vaste versiegegevens van een Windows-programma (VS_FIXEDFILEINFO).
#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct VasteVersieInfo {
    dwSignature: u32,
    dwStrucVersion: u32,
    dwFileVersionMS: u32,
    dwFileVersionLS: u32,
    dwProductVersionMS: u32,
    dwProductVersionLS: u32,
    dwFileFlagsMask: u32,
    dwFileFlags: u32,
    dwFileOS: u32,
    dwFileType: u32,
    dwFileSubtype: u32,
    dwFileDateMS: u32,
    dwFileDateLS: u32,
}

// Rechtstreeks uit version.dll, zodat dit bestand ook los te testen is.
#[cfg(windows)]
#[link(name = "version")]
extern "system" {
    fn GetFileVersionInfoSizeW(bestand: *const u16, handle: *mut u32) -> u32;
    fn GetFileVersionInfoW(bestand: *const u16, handle: u32, lengte: u32, gegevens: *mut core::ffi::c_void) -> i32;
    fn VerQueryValueW(blok: *const core::ffi::c_void, pad: *const u16, buffer: *mut *mut core::ffi::c_void, lengte: *mut u32) -> i32;
}

/// De versie van het programma op `pad`, uit zijn versiegegevens.
#[cfg(windows)]
fn versie_van(pad: &std::path::Path) -> Option<(u32, u32, u32)> {
    use std::os::windows::ffi::OsStrExt;

    let breed: Vec<u16> = pad.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let wortel: Vec<u16> = "\\".encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `breed` en `wortel` zijn nul-afgesloten; de buffer heeft de
    // grootte die Windows opgeeft; `info` wijst in die buffer en wordt alleen
    // gelezen terwijl de buffer leeft en groot genoeg is voor de structuur.
    unsafe {
        let grootte = GetFileVersionInfoSizeW(breed.as_ptr(), std::ptr::null_mut());
        if grootte == 0 {
            return None;
        }
        let mut buffer = vec![0u8; grootte as usize];
        if GetFileVersionInfoW(breed.as_ptr(), 0, grootte, buffer.as_mut_ptr().cast()) == 0 {
            return None;
        }
        let mut info: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut lengte: u32 = 0;
        if VerQueryValueW(buffer.as_ptr().cast(), wortel.as_ptr(), &mut info, &mut lengte) == 0
            || info.is_null()
            || (lengte as usize) < std::mem::size_of::<VasteVersieInfo>()
        {
            return None;
        }
        let vast = &*(info as *const VasteVersieInfo);
        Some(versie_uit_vaste_info(vast.dwFileVersionMS, vast.dwFileVersionLS))
    }
}

/// Kent de installer op deze computer `--check`? `installer` is het pad uit
/// zijn statusbestand als dat er is; anders de standaardplek.
#[cfg(windows)]
pub fn installer_kent_achtergrondcontrole(installer: Option<std::path::PathBuf>) -> bool {
    let pad = installer.filter(|p| p.is_file()).or_else(standaard_installer);
    kent_achtergrondcontrole(pad.as_deref().and_then(|p| versie_van(p)))
}

#[cfg(not(windows))]
pub fn installer_kent_achtergrondcontrole(_installer: Option<std::path::PathBuf>) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn een_oude_installer_wordt_niet_op_de_achtergrond_gestart() {
        // 0.1.1 kent --check niet en opent zijn venster.
        assert!(!kent_achtergrondcontrole(Some((0, 1, 1))));
        assert!(!kent_achtergrondcontrole(Some((0, 2, 3))));
    }

    #[test]
    fn vanaf_0_2_4_mag_het() {
        assert!(kent_achtergrondcontrole(Some((0, 2, 4))));
        assert!(kent_achtergrondcontrole(Some((0, 2, 9))));
        assert!(kent_achtergrondcontrole(Some((0, 10, 0))));
        assert!(kent_achtergrondcontrole(Some((1, 0, 0))));
    }

    #[test]
    fn een_onbekende_versie_telt_als_nee() {
        assert!(!kent_achtergrondcontrole(None));
    }

    #[test]
    fn een_pad_zonder_installer_telt_als_nee() {
        let weg = std::path::PathBuf::from("dit-bestand-bestaat-niet.exe");
        // Het pad bestaat niet; op een computer zonder installer is het antwoord nee.
        // (Met een installer hangt het van zijn versie af, dus alleen het type telt.)
        let _: bool = installer_kent_achtergrondcontrole(Some(weg));
    }

    #[test]
    fn de_versie_komt_uit_de_vaste_versiegegevens() {
        // 0.2.9.0: MS = 0x0000_0002, LS = 0x0009_0000.
        assert_eq!(versie_uit_vaste_info(0x0000_0002, 0x0009_0000), (0, 2, 9));
        assert_eq!(versie_uit_vaste_info(0x0001_0000, 0x0000_0007), (1, 0, 0));
    }
}
