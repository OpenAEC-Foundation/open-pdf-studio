//! Registratie van de miniatuurhandler, per gebruiker (HKCU), zonder admin.
//!
//! Dit bestand is zelfstandig (geen afhankelijkheden, geen `crate::`): de app
//! neemt het met `#[path]` op in src/verkenner_miniaturen.rs, zodat de app en
//! de DLL dezelfde CLSID en dezelfde regels gebruiken, en de tests hier
//! lokaal draaien (`cargo test -p open-pdf-thumbnails`).
//!
//! Wat er geschreven wordt (alleen onder HKCU\Software\Classes):
//!
//! ```text
//! CLSID\{CB423985-…}                  (standaard) = omschrijving
//!   InprocServer32                    (standaard) = <installatiemap>\open-pdf-thumbnails.dll
//!                                     ThreadingModel = Apartment
//!   PreviousPdfThumbnailHandler       alleen als we een eigen HKCU-waarde vervingen
//! .pdf\ShellEx\{E357FCCD-…}           (standaard) = {CB423985-…}
//! ```
//!
//! Nooit: de standaardwaarde van .pdf, een ProgID, UserChoice of iets onder
//! HKLM. De bestandskoppeling en de standaard-app blijven dus wat ze zijn.
//!
//! Zo zoekt de shell een miniatuurhandler (vastgesteld op Windows 11, zie
//! #605): eerst ShellEx onder de ProgID van de standaard-app, dan onder de
//! extensie (.pdf; HKCU gaat daarbij voor HKLM). Een handler onder de ProgID
//! van een andere standaard-app wint dus altijd; die raken we niet aan en
//! melden we alleen. Een handler van een ander programma onder .pdf vervangen
//! we alleen als de gebruiker daarvoor kiest, en we zetten hem bij
//! uitschakelen precies terug.

#![allow(dead_code)]

pub const CLSID: &str = "{CB423985-4932-4B94-8BD3-C515D63CB768}";
pub const CLSID_WAARDE: u128 = 0xCB423985_4932_4B94_8BD3_C515D63CB768;
/// De shell-extensie voor miniaturen (de IID van IThumbnailProvider).
pub const MINIATUUR_SHELLEX: &str = "{E357FCCD-A995-4576-B01F-234630154E96}";
pub const DLL_NAAM: &str = "open-pdf-thumbnails.dll";
pub const OMSCHRIJVING: &str = "Open PDF Studio PDF thumbnail provider";
pub const VORIGE_WAARDE: &str = "PreviousPdfThumbnailHandler";
pub const EXTENSIE: &str = ".pdf";

/// Sleutels, relatief aan een Classes-wortel (HKCU\Software\Classes of
/// HKLM\Software\Classes).
pub fn clsid_sleutel(clsid: &str) -> String {
    format!(r"CLSID\{}", clsid)
}

pub fn inproc_sleutel(clsid: &str) -> String {
    format!(r"CLSID\{}\InprocServer32", clsid)
}

pub fn localserver_sleutel(clsid: &str) -> String {
    format!(r"CLSID\{}\LocalServer32", clsid)
}

/// `<extensie of ProgID>\ShellEx\{E357…}`.
pub fn shellex_sleutel(klasse: &str) -> String {
    format!(r"{}\ShellEx\{}", klasse, MINIATUUR_SHELLEX)
}

pub fn shellex_ouder(klasse: &str) -> String {
    format!(r"{}\ShellEx", klasse)
}

/// De CLSID als tekst, zoals in het register: `{XXXXXXXX-XXXX-…}`, hoofdletters.
pub fn guid_tekst(waarde: u128) -> String {
    let h = format!("{:032X}", waarde);
    format!(
        "{{{}-{}-{}-{}-{}}}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

/// Twee GUID-teksten gelijk, ongeacht hoofdletters, accolades en spaties.
pub fn zelfde_guid(a: &str, b: &str) -> bool {
    let schoon = |s: &str| {
        s.trim()
            .trim_start_matches('{')
            .trim_end_matches('}')
            .to_ascii_uppercase()
    };
    let (a, b) = (schoon(a), schoon(b));
    !a.is_empty() && a == b
}

pub fn is_eigen(clsid: &str) -> bool {
    zelfde_guid(clsid, CLSID)
}

/// Een pad uit InprocServer32 zonder aanhalingstekens en spaties eromheen.
pub fn schoon_pad(pad: &str) -> String {
    pad.trim().trim_matches('"').trim().to_string()
}

fn niet_leeg(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Laag {
    /// HKCU\Software\Classes: hier schrijven we.
    Gebruiker,
    /// HKLM\Software\Classes: alleen lezen.
    Machine,
}

/// Wat de registratie nodig heeft van het register. Schrijven gaat altijd naar
/// de gebruikerslaag; er is bewust geen manier om naar HKLM te schrijven.
pub trait Register {
    /// Tekstwaarde (`None` = standaardwaarde van de sleutel).
    fn lees(&self, laag: Laag, sleutel: &str, waarde: Option<&str>) -> Option<String>;
    fn schrijf(&mut self, sleutel: &str, waarde: Option<&str>, data: &str) -> Result<(), String>;
    fn verwijder_waarde(&mut self, sleutel: &str, waarde: &str) -> Result<(), String>;
    /// De sleutel met alles eronder; niet bestaand is geen fout.
    fn verwijder_boom(&mut self, sleutel: &str) -> Result<(), String>;
    /// Alleen als de sleutel geen subsleutels en geen waarden heeft.
    fn verwijder_als_leeg(&mut self, sleutel: &str) -> Result<(), String>;

    /// Zoals HKEY_CLASSES_ROOT het toont: gebruiker gaat voor machine.
    fn lees_samen(&self, sleutel: &str, waarde: Option<&str>) -> Option<String> {
        niet_leeg(self.lees(Laag::Gebruiker, sleutel, waarde))
            .or_else(|| niet_leeg(self.lees(Laag::Machine, sleutel, waarde)))
    }
}

/// Een miniatuurhandler van een ander programma.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Handler {
    pub clsid: String,
    /// Naam uit het register (standaardwaarde van de CLSID), anders de DLL-naam.
    pub naam: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Status {
    /// Onze handler staat in .pdf en wijst naar een bestaande DLL.
    pub actief: bool,
    /// Ons geregistreerde DLL-pad, als er een is.
    pub eigen_pad: Option<String>,
    /// Een werkende handler van een ander programma onder .pdf (niet de onze).
    pub ander: Option<Handler>,
    /// Een werkende handler onder de ProgID van de standaard-app; die gebruikt
    /// Windows vóór die onder .pdf, ook als de onze aan staat.
    pub via_standaard_app: Option<Handler>,
}

/// Een handler werkt als zijn CLSID een server heeft waarvan het bestand
/// bestaat. Een verwijzing naar een CLSID die er niet (meer) is — wat een
/// verwijderd programma vaak achterlaat — telt niet: die geeft alleen fouten.
pub fn werkende_handler(
    reg: &dyn Register,
    clsid: &str,
    bestaat: &dyn Fn(&str) -> bool,
) -> Option<Handler> {
    let inproc = niet_leeg(reg.lees_samen(&inproc_sleutel(clsid), None)).map(|p| schoon_pad(&p));
    let werkt = match &inproc {
        Some(pad) => bestaat(pad),
        None => niet_leeg(reg.lees_samen(&localserver_sleutel(clsid), None)).is_some(),
    };
    if !werkt {
        return None;
    }
    let naam = niet_leeg(reg.lees_samen(&clsid_sleutel(clsid), None))
        .or_else(|| {
            inproc
                .as_deref()
                .and_then(|p| p.rsplit(['\\', '/']).next())
                .map(str::to_string)
        })
        .unwrap_or_else(|| clsid.trim().to_string());
    Some(Handler {
        clsid: clsid.trim().to_string(),
        naam,
    })
}

/// De huidige toestand. `standaard_progid`: de ProgId uit UserChoice van .pdf.
pub fn status(
    reg: &dyn Register,
    standaard_progid: Option<&str>,
    bestaat: &dyn Fn(&str) -> bool,
) -> Status {
    let eigen_pad =
        niet_leeg(reg.lees(Laag::Gebruiker, &inproc_sleutel(CLSID), None)).map(|p| schoon_pad(&p));
    let in_pdf = reg.lees_samen(&shellex_sleutel(EXTENSIE), None);

    let actief =
        in_pdf.as_deref().is_some_and(is_eigen) && eigen_pad.as_deref().is_some_and(bestaat);
    let ander = in_pdf
        .as_deref()
        .filter(|c| !is_eigen(c))
        .and_then(|c| werkende_handler(reg, c, bestaat));
    let via_standaard_app = standaard_progid
        .map(str::trim)
        .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case(EXTENSIE))
        .and_then(|p| reg.lees_samen(&shellex_sleutel(p), None))
        .filter(|c| !is_eigen(c))
        .and_then(|c| werkende_handler(reg, &c, bestaat));

    Status {
        actief,
        eigen_pad,
        ander,
        via_standaard_app,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZetFout {
    /// Er is een werkende handler van een ander programma; de gebruiker moet
    /// eerst kiezen of de onze die (voor deze gebruiker) vervangt.
    AnderProgramma(Handler),
    /// De DLL ontbreekt naast de app (bijvoorbeeld een build zonder).
    GeenDll(String),
    Register(String),
}

impl std::fmt::Display for ZetFout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ZetFout::AnderProgramma(h) => {
                write!(f, "another program provides PDF thumbnails: {}", h.naam)
            }
            ZetFout::GeenDll(p) => write!(f, "thumbnail handler not found: {}", p),
            ZetFout::Register(e) => write!(f, "registry: {}", e),
        }
    }
}

/// Zet de miniaturen aan voor deze gebruiker. `vervang_ander`: de gebruiker
/// koos ervoor een werkende handler van een ander programma te vervangen.
pub fn zet_aan(
    reg: &mut dyn Register,
    dll_pad: &str,
    vervang_ander: bool,
    bestaat: &dyn Fn(&str) -> bool,
) -> Result<(), ZetFout> {
    if !bestaat(dll_pad) {
        return Err(ZetFout::GeenDll(dll_pad.to_string()));
    }
    let nu = status(reg, None, bestaat);
    if let Some(ander) = nu.ander {
        if !vervang_ander {
            return Err(ZetFout::AnderProgramma(ander));
        }
    }
    let r = ZetFout::Register;

    reg.schrijf(&clsid_sleutel(CLSID), None, OMSCHRIJVING)
        .map_err(r)?;
    reg.schrijf(&inproc_sleutel(CLSID), None, dll_pad)
        .map_err(r)?;
    reg.schrijf(&inproc_sleutel(CLSID), Some("ThreadingModel"), "Apartment")
        .map_err(r)?;

    // Een eigen HKCU-waarde van een ander programma bewaren we om hem bij
    // uitschakelen terug te zetten. Een HKLM-waarde hoeft dat niet: die
    // blijft staan en is weer zichtbaar zodra onze HKCU-waarde weg is.
    let sleutel = shellex_sleutel(EXTENSIE);
    match niet_leeg(reg.lees(Laag::Gebruiker, &sleutel, None)) {
        Some(eerder) if !is_eigen(&eerder) => {
            reg.schrijf(&clsid_sleutel(CLSID), Some(VORIGE_WAARDE), &eerder)
                .map_err(r)?;
        }
        Some(_) => {} // al de onze: een eerder bewaarde waarde blijft staan
        None => {
            let _ = reg.verwijder_waarde(&clsid_sleutel(CLSID), VORIGE_WAARDE);
        }
    }
    reg.schrijf(&sleutel, None, CLSID).map_err(r)?;
    Ok(())
}

/// Zet de miniaturen uit voor deze gebruiker: precies terug naar hoe het was.
/// Een waarde die intussen door iets anders is overschreven, blijft staan.
pub fn zet_uit(reg: &mut dyn Register) -> Result<(), ZetFout> {
    let r = ZetFout::Register;
    let sleutel = shellex_sleutel(EXTENSIE);
    if niet_leeg(reg.lees(Laag::Gebruiker, &sleutel, None))
        .as_deref()
        .is_some_and(is_eigen)
    {
        match niet_leeg(reg.lees(Laag::Gebruiker, &clsid_sleutel(CLSID), Some(VORIGE_WAARDE))) {
            Some(vorige) => reg.schrijf(&sleutel, None, &vorige).map_err(r)?,
            None => {
                reg.verwijder_boom(&sleutel).map_err(r)?;
                // Wat we daarvoor zelf aanmaakten en nu leeg is (geen waarden,
                // geen subsleutels) gaat ook weg; anders blijft alles staan.
                reg.verwijder_als_leeg(&shellex_ouder(EXTENSIE))
                    .map_err(r)?;
                reg.verwijder_als_leeg(EXTENSIE).map_err(r)?;
            }
        }
    }
    reg.verwijder_boom(&clsid_sleutel(CLSID)).map_err(r)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Het echte register (Windows), met eigen FFI-declaraties zodat dit bestand
// zonder crates in zowel de DLL als de app bouwt.
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub mod win32 {
    use super::{Laag, Register};
    use std::ffi::c_void;

    type Hkey = isize;
    pub const HKEY_CURRENT_USER: Hkey = 0x8000_0001_u32 as i32 as isize;
    pub const HKEY_LOCAL_MACHINE: Hkey = 0x8000_0002_u32 as i32 as isize;
    const KEY_READ: u32 = 0x20019;
    const KEY_WRITE: u32 = 0x20006;
    const KEY_WOW64_64KEY: u32 = 0x0100;
    const REG_SZ: u32 = 1;
    const RRF_RT_REG_SZ: u32 = 0x0000_0002;
    const ERROR_SUCCESS: i32 = 0;
    const ERROR_FILE_NOT_FOUND: i32 = 2;
    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0;

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            key: Hkey,
            sub: *const u16,
            options: u32,
            sam: u32,
            result: *mut Hkey,
        ) -> i32;
        fn RegCreateKeyExW(
            key: Hkey,
            sub: *const u16,
            reserved: u32,
            class: *const u16,
            options: u32,
            sam: u32,
            security: *const c_void,
            result: *mut Hkey,
            disposition: *mut u32,
        ) -> i32;
        fn RegSetValueExW(
            key: Hkey,
            name: *const u16,
            reserved: u32,
            kind: u32,
            data: *const u8,
            len: u32,
        ) -> i32;
        fn RegGetValueW(
            key: Hkey,
            sub: *const u16,
            value: *const u16,
            flags: u32,
            kind: *mut u32,
            data: *mut c_void,
            len: *mut u32,
        ) -> i32;
        fn RegDeleteKeyValueW(key: Hkey, sub: *const u16, value: *const u16) -> i32;
        fn RegDeleteTreeW(key: Hkey, sub: *const u16) -> i32;
        fn RegDeleteKeyW(key: Hkey, sub: *const u16) -> i32;
        fn RegQueryInfoKeyW(
            key: Hkey,
            class: *mut u16,
            class_len: *mut u32,
            reserved: *const u32,
            sub_keys: *mut u32,
            max_sub_len: *mut u32,
            max_class_len: *mut u32,
            values: *mut u32,
            max_value_name: *mut u32,
            max_value_len: *mut u32,
            security: *mut u32,
            last_write: *mut c_void,
        ) -> i32;
        fn RegCloseKey(key: Hkey) -> i32;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(event: i32, flags: u32, item1: *const c_void, item2: *const c_void);
    }

    fn breed(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Meldt de shell dat koppelingen veranderd zijn (miniaturen opnieuw bepalen).
    pub fn meld_shell() {
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED,
                SHCNF_IDLIST,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
    }

    /// Het register met twee Classes-wortels. Normaal HKCU\Software\Classes en
    /// HKLM\Software\Classes; tests gebruiken twee wortels onder een eigen
    /// HKCU-sleutel.
    pub struct Win32Register {
        gebruiker: (Hkey, String),
        machine: (Hkey, String),
    }

    impl Win32Register {
        pub fn echt() -> Self {
            Win32Register {
                gebruiker: (HKEY_CURRENT_USER, r"Software\Classes".into()),
                machine: (HKEY_LOCAL_MACHINE, r"Software\Classes".into()),
            }
        }

        /// Voor tests: beide lagen onder HKCU\<basis>\user en \machine.
        pub fn onder(basis: &str) -> Self {
            Win32Register {
                gebruiker: (HKEY_CURRENT_USER, format!(r"{basis}\user")),
                machine: (HKEY_CURRENT_USER, format!(r"{basis}\machine")),
            }
        }

        fn pad(wortel: &(Hkey, String), sleutel: &str) -> String {
            if sleutel.is_empty() {
                wortel.1.clone()
            } else if wortel.1.is_empty() {
                sleutel.to_string()
            } else {
                format!(r"{}\{}", wortel.1, sleutel)
            }
        }

        /// Schrijft in een laag naar keuze. Alleen voor tests (de machine-laag
        /// ligt dan ook onder HKCU); de registratie zelf gebruikt `schrijf`.
        pub fn schrijf_in(
            &mut self,
            laag: Laag,
            sleutel: &str,
            waarde: Option<&str>,
            data: &str,
        ) -> Result<(), String> {
            let wortel = match laag {
                Laag::Gebruiker => &self.gebruiker,
                Laag::Machine => &self.machine,
            };
            schrijf_tekst(wortel.0, &Self::pad(wortel, sleutel), waarde, data)
        }
    }

    fn schrijf_tekst(
        wortel: Hkey,
        pad: &str,
        waarde: Option<&str>,
        data: &str,
    ) -> Result<(), String> {
        let pad_w = breed(pad);
        let mut sleutel: Hkey = 0;
        let r = unsafe {
            RegCreateKeyExW(
                wortel,
                pad_w.as_ptr(),
                0,
                std::ptr::null(),
                0,
                KEY_WRITE | KEY_WOW64_64KEY,
                std::ptr::null(),
                &mut sleutel,
                std::ptr::null_mut(),
            )
        };
        if r != ERROR_SUCCESS {
            return Err(format!("create {pad}: {r}"));
        }
        let naam = waarde.map(breed);
        let data_w = breed(data);
        let r = unsafe {
            RegSetValueExW(
                sleutel,
                naam.as_ref().map_or(std::ptr::null(), |n| n.as_ptr()),
                0,
                REG_SZ,
                data_w.as_ptr().cast(),
                (data_w.len() * 2) as u32,
            )
        };
        unsafe { RegCloseKey(sleutel) };
        if r != ERROR_SUCCESS {
            return Err(format!("set {pad}: {r}"));
        }
        Ok(())
    }

    impl Register for Win32Register {
        fn lees(&self, laag: Laag, sleutel: &str, waarde: Option<&str>) -> Option<String> {
            let wortel = match laag {
                Laag::Gebruiker => &self.gebruiker,
                Laag::Machine => &self.machine,
            };
            let pad = breed(&Self::pad(wortel, sleutel));
            let naam = waarde.map(breed);
            let naam_ptr = naam.as_ref().map_or(std::ptr::null(), |n| n.as_ptr());
            // RRF_RT_REG_SZ leest ook REG_EXPAND_SZ, uitgevouwen.
            let mut bytes: u32 = 0;
            let r = unsafe {
                RegGetValueW(
                    wortel.0,
                    pad.as_ptr(),
                    naam_ptr,
                    RRF_RT_REG_SZ,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut bytes,
                )
            };
            if r != ERROR_SUCCESS || bytes < 2 {
                return None;
            }
            let mut buf = vec![0u16; (bytes as usize).div_ceil(2) + 1];
            let mut bytes = (buf.len() * 2) as u32;
            let r = unsafe {
                RegGetValueW(
                    wortel.0,
                    pad.as_ptr(),
                    naam_ptr,
                    RRF_RT_REG_SZ,
                    std::ptr::null_mut(),
                    buf.as_mut_ptr().cast(),
                    &mut bytes,
                )
            };
            if r != ERROR_SUCCESS {
                return None;
            }
            let lengte = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..lengte]))
        }

        fn schrijf(
            &mut self,
            sleutel: &str,
            waarde: Option<&str>,
            data: &str,
        ) -> Result<(), String> {
            schrijf_tekst(
                self.gebruiker.0,
                &Self::pad(&self.gebruiker, sleutel),
                waarde,
                data,
            )
        }

        fn verwijder_waarde(&mut self, sleutel: &str, waarde: &str) -> Result<(), String> {
            let pad = breed(&Self::pad(&self.gebruiker, sleutel));
            let naam = breed(waarde);
            match unsafe { RegDeleteKeyValueW(self.gebruiker.0, pad.as_ptr(), naam.as_ptr()) } {
                ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => Ok(()),
                r => Err(format!("delete value {sleutel}\\{waarde}: {r}")),
            }
        }

        fn verwijder_boom(&mut self, sleutel: &str) -> Result<(), String> {
            if sleutel.is_empty() {
                return Err("refusing to delete the root".into());
            }
            let pad = breed(&Self::pad(&self.gebruiker, sleutel));
            match unsafe { RegDeleteTreeW(self.gebruiker.0, pad.as_ptr()) } {
                ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => {}
                r => return Err(format!("delete tree {sleutel}: {r}")),
            }
            // Met een subpad laat RegDeleteTreeW de sleutel zelf leeg staan.
            match unsafe { RegDeleteKeyW(self.gebruiker.0, pad.as_ptr()) } {
                ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => Ok(()),
                r => Err(format!("delete key {sleutel}: {r}")),
            }
        }

        fn verwijder_als_leeg(&mut self, sleutel: &str) -> Result<(), String> {
            if sleutel.is_empty() {
                return Err("refusing to delete the root".into());
            }
            let pad = breed(&Self::pad(&self.gebruiker, sleutel));
            let mut h: Hkey = 0;
            let r = unsafe {
                RegOpenKeyExW(
                    self.gebruiker.0,
                    pad.as_ptr(),
                    0,
                    KEY_READ | KEY_WOW64_64KEY,
                    &mut h,
                )
            };
            if r == ERROR_FILE_NOT_FOUND {
                return Ok(());
            }
            if r != ERROR_SUCCESS {
                return Err(format!("open {sleutel}: {r}"));
            }
            let (mut subs, mut waarden) = (0u32, 0u32);
            let r = unsafe {
                RegQueryInfoKeyW(
                    h,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    &mut subs,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut waarden,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            unsafe { RegCloseKey(h) };
            if r != ERROR_SUCCESS {
                return Err(format!("query {sleutel}: {r}"));
            }
            if subs > 0 || waarden > 0 {
                return Ok(());
            }
            match unsafe { RegDeleteKeyW(self.gebruiker.0, pad.as_ptr()) } {
                ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => Ok(()),
                r => Err(format!("delete key {sleutel}: {r}")),
            }
        }
    }

    /// De ProgId die de gebruiker als standaard-app voor .pdf koos (UserChoice).
    pub fn standaard_progid() -> Option<String> {
        let reg = Win32Register {
            gebruiker: (HKEY_CURRENT_USER, String::new()),
            machine: (HKEY_LOCAL_MACHINE, String::new()),
        };
        reg.lees(
            Laag::Gebruiker,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice",
            Some("ProgId"),
        )
    }

    /// Verwijdert een testboom onder HKCU (alleen voor tests).
    pub fn verwijder_testboom(basis: &str) {
        let pad = breed(basis);
        unsafe {
            RegDeleteTreeW(HKEY_CURRENT_USER, pad.as_ptr());
            RegDeleteKeyW(HKEY_CURRENT_USER, pad.as_ptr());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    enum L {
        G,
        M,
    }

    fn l(laag: Laag) -> L {
        match laag {
            Laag::Gebruiker => L::G,
            Laag::Machine => L::M,
        }
    }

    fn k(s: &str) -> String {
        s.to_ascii_lowercase()
    }

    /// Register in het geheugen, met dezelfde betekenis als het echte.
    #[derive(Default, Debug, PartialEq, Eq, Clone)]
    struct Geheugen {
        sleutels: BTreeSet<(L, String)>,
        waarden: BTreeMap<(L, String, String), String>,
    }

    impl Geheugen {
        /// Zoals een echt profiel: HKCU\Software\Classes\CLSID bestaat altijd.
        fn nieuw() -> Self {
            let mut g = Geheugen::default();
            g.sleutels.insert((L::G, "clsid".into()));
            g
        }

        fn zet(&mut self, laag: Laag, sleutel: &str, waarde: Option<&str>, data: &str) {
            let mut pad = String::new();
            for deel in sleutel.split('\\') {
                if !pad.is_empty() {
                    pad.push('\\');
                }
                pad.push_str(deel);
                self.sleutels.insert((l(laag), k(&pad)));
            }
            self.waarden.insert(
                (l(laag), k(sleutel), k(waarde.unwrap_or(""))),
                data.to_string(),
            );
        }

        fn machine(&self) -> Vec<((L, String, String), String)> {
            self.waarden
                .iter()
                .filter(|((laag, ..), _)| *laag == L::M)
                .map(|(a, b)| (a.clone(), b.clone()))
                .collect()
        }
    }

    impl Register for Geheugen {
        fn lees(&self, laag: Laag, sleutel: &str, waarde: Option<&str>) -> Option<String> {
            self.waarden
                .get(&(l(laag), k(sleutel), k(waarde.unwrap_or(""))))
                .cloned()
        }
        fn schrijf(
            &mut self,
            sleutel: &str,
            waarde: Option<&str>,
            data: &str,
        ) -> Result<(), String> {
            self.zet(Laag::Gebruiker, sleutel, waarde, data);
            Ok(())
        }
        fn verwijder_waarde(&mut self, sleutel: &str, waarde: &str) -> Result<(), String> {
            self.waarden.remove(&(L::G, k(sleutel), k(waarde)));
            Ok(())
        }
        fn verwijder_boom(&mut self, sleutel: &str) -> Result<(), String> {
            let p = k(sleutel);
            let kind = format!("{p}\\");
            let onder = |s: &String| *s == p || s.starts_with(&kind);
            self.sleutels
                .retain(|(laag, s)| !(*laag == L::G && onder(s)));
            self.waarden
                .retain(|(laag, s, _), _| !(*laag == L::G && onder(s)));
            Ok(())
        }
        fn verwijder_als_leeg(&mut self, sleutel: &str) -> Result<(), String> {
            let p = k(sleutel);
            let kind = format!("{p}\\");
            let heeft_sub = self
                .sleutels
                .iter()
                .any(|(laag, s)| *laag == L::G && s.starts_with(&kind));
            let heeft_waarde = self
                .waarden
                .keys()
                .any(|(laag, s, _)| *laag == L::G && *s == p);
            if !heeft_sub && !heeft_waarde {
                self.sleutels.remove(&(L::G, p));
            }
            Ok(())
        }
    }

    const DLL: &str = r"C:\Program Files\Open PDF Studio\open-pdf-thumbnails.dll";
    const ANDER: &str = "{11111111-2222-3333-4444-555555555555}";
    const ANDER_DLL: &str = r"C:\Program Files\Other\thumbs.dll";

    fn alles_bestaat(_: &str) -> bool {
        true
    }

    fn met_ander_programma(laag: Laag) -> Geheugen {
        let mut g = Geheugen::nieuw();
        g.zet(
            Laag::Machine,
            &clsid_sleutel(ANDER),
            None,
            "Other PDF Thumbnails",
        );
        g.zet(Laag::Machine, &inproc_sleutel(ANDER), None, ANDER_DLL);
        g.zet(laag, &shellex_sleutel(EXTENSIE), None, ANDER);
        g
    }

    #[test]
    fn clsid_tekst_en_waarde_horen_bij_elkaar() {
        assert_eq!(guid_tekst(CLSID_WAARDE), CLSID);
    }

    #[test]
    fn sleutels() {
        assert_eq!(
            clsid_sleutel(CLSID),
            r"CLSID\{CB423985-4932-4B94-8BD3-C515D63CB768}"
        );
        assert_eq!(
            inproc_sleutel(CLSID),
            r"CLSID\{CB423985-4932-4B94-8BD3-C515D63CB768}\InprocServer32"
        );
        assert_eq!(
            shellex_sleutel(".pdf"),
            r".pdf\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}"
        );
        assert_eq!(shellex_ouder(".pdf"), r".pdf\ShellEx");
    }

    #[test]
    fn guid_vergelijken() {
        assert!(zelfde_guid("{cb423985-4932-4b94-8bd3-c515d63cb768}", CLSID));
        assert!(zelfde_guid(" CB423985-4932-4B94-8BD3-C515D63CB768 ", CLSID));
        assert!(!zelfde_guid("", ""));
        assert!(!zelfde_guid(ANDER, CLSID));
    }

    #[test]
    fn aanzetten_op_een_schone_machine() {
        let mut g = Geheugen::nieuw();
        zet_aan(&mut g, DLL, false, &alles_bestaat).unwrap();
        assert_eq!(
            g.lees(Laag::Gebruiker, &inproc_sleutel(CLSID), None)
                .as_deref(),
            Some(DLL)
        );
        assert_eq!(
            g.lees(
                Laag::Gebruiker,
                &inproc_sleutel(CLSID),
                Some("ThreadingModel")
            )
            .as_deref(),
            Some("Apartment")
        );
        assert_eq!(
            g.lees(Laag::Gebruiker, &shellex_sleutel(".pdf"), None)
                .as_deref(),
            Some(CLSID)
        );
        assert_eq!(
            g.lees(Laag::Gebruiker, &clsid_sleutel(CLSID), Some(VORIGE_WAARDE)),
            None
        );
        let s = status(&g, Some("OpenPDFStudio.pdf"), &alles_bestaat);
        assert!(s.actief);
        assert_eq!(s.ander, None);
        assert_eq!(s.eigen_pad.as_deref(), Some(DLL));
    }

    #[test]
    fn nooit_de_koppeling_of_hklm() {
        let mut g = met_ander_programma(Laag::Machine);
        g.zet(Laag::Machine, ".pdf", None, "OpenPDFStudio.pdf");
        let voor = g.machine();
        zet_aan(&mut g, DLL, true, &alles_bestaat).unwrap();
        assert_eq!(g.machine(), voor);
        zet_uit(&mut g).unwrap();
        assert_eq!(g.machine(), voor);
        // De standaardwaarde van .pdf (de koppeling) is nooit geschreven.
        assert_eq!(g.lees(Laag::Gebruiker, ".pdf", None), None);
    }

    #[test]
    fn uitzetten_zet_alles_terug() {
        let leeg = Geheugen::nieuw();
        let mut g = leeg.clone();
        zet_aan(&mut g, DLL, false, &alles_bestaat).unwrap();
        zet_uit(&mut g).unwrap();
        assert_eq!(g, leeg);
        assert!(!status(&g, None, &alles_bestaat).actief);
    }

    #[test]
    fn uitzetten_laat_andere_shellex_staan() {
        let mut g = Geheugen::nieuw();
        g.zet(
            Laag::Gebruiker,
            r".pdf\ShellEx\{8895b1c6-b41f-4c1c-a562-0d564250836f}",
            None,
            "{x}",
        );
        let voor = g.clone();
        zet_aan(&mut g, DLL, false, &alles_bestaat).unwrap();
        zet_uit(&mut g).unwrap();
        assert_eq!(g, voor);
    }

    #[test]
    fn ander_programma_vraagt_eerst() {
        let mut g = met_ander_programma(Laag::Machine);
        let voor = g.clone();
        let fout = zet_aan(&mut g, DLL, false, &alles_bestaat).unwrap_err();
        assert_eq!(
            fout,
            ZetFout::AnderProgramma(Handler {
                clsid: ANDER.into(),
                naam: "Other PDF Thumbnails".into()
            })
        );
        assert_eq!(g, voor, "zonder keuze wordt niets geschreven");
        assert!(status(&g, None, &alles_bestaat).ander.is_some());
    }

    #[test]
    fn ander_programma_in_hklm_vervangen_en_terug() {
        let mut g = met_ander_programma(Laag::Machine);
        let voor = g.clone();
        zet_aan(&mut g, DLL, true, &alles_bestaat).unwrap();
        let s = status(&g, None, &alles_bestaat);
        assert!(s.actief);
        assert_eq!(s.ander, None);
        // HKLM is niet aangeraakt; er is niets te bewaren.
        assert_eq!(
            g.lees(Laag::Gebruiker, &clsid_sleutel(CLSID), Some(VORIGE_WAARDE)),
            None
        );
        zet_uit(&mut g).unwrap();
        assert_eq!(g, voor);
        assert_eq!(
            status(&g, None, &alles_bestaat).ander.map(|h| h.clsid),
            Some(ANDER.to_string())
        );
    }

    #[test]
    fn ander_programma_in_hkcu_wordt_precies_teruggezet() {
        let mut g = met_ander_programma(Laag::Gebruiker);
        let voor = g.clone();
        zet_aan(&mut g, DLL, true, &alles_bestaat).unwrap();
        assert_eq!(
            g.lees(Laag::Gebruiker, &clsid_sleutel(CLSID), Some(VORIGE_WAARDE))
                .as_deref(),
            Some(ANDER)
        );
        // Twee keer aanzetten verliest de bewaarde waarde niet.
        zet_aan(&mut g, DLL, true, &alles_bestaat).unwrap();
        assert_eq!(
            g.lees(Laag::Gebruiker, &clsid_sleutel(CLSID), Some(VORIGE_WAARDE))
                .as_deref(),
            Some(ANDER)
        );
        zet_uit(&mut g).unwrap();
        assert_eq!(g, voor);
    }

    #[test]
    fn verweesde_verwijzing_telt_niet_als_ander_programma() {
        // Een .pdf-handler naar een CLSID die niet bestaat (verwijderd programma).
        let mut g = Geheugen::nieuw();
        g.zet(
            Laag::Machine,
            &shellex_sleutel(EXTENSIE),
            None,
            "{0DAC722E-C823-4527-AFD5-76275DB557BC}",
        );
        assert_eq!(status(&g, None, &alles_bestaat).ander, None);
        let voor = g.clone();
        zet_aan(&mut g, DLL, false, &alles_bestaat).unwrap();
        assert!(status(&g, None, &alles_bestaat).actief);
        zet_uit(&mut g).unwrap();
        assert_eq!(g, voor);
    }

    #[test]
    fn handler_met_ontbrekende_dll_telt_niet() {
        let g = met_ander_programma(Laag::Machine);
        let bestaat = |p: &str| p != ANDER_DLL;
        assert_eq!(status(&g, None, &bestaat).ander, None);
    }

    #[test]
    fn handler_zonder_naam_krijgt_de_dll_naam() {
        let mut g = Geheugen::nieuw();
        g.zet(
            Laag::Machine,
            &inproc_sleutel(ANDER),
            None,
            "\"C:\\x\\thumbs.dll\"",
        );
        assert_eq!(
            werkende_handler(&g, ANDER, &alles_bestaat).map(|h| h.naam),
            Some("thumbs.dll".into())
        );
    }

    #[test]
    fn handler_van_de_standaard_app_wordt_gemeld() {
        let mut g = Geheugen::nieuw();
        g.zet(
            Laag::Machine,
            &clsid_sleutel(ANDER),
            None,
            "Viewer Thumbnails",
        );
        g.zet(Laag::Machine, &inproc_sleutel(ANDER), None, ANDER_DLL);
        g.zet(
            Laag::Machine,
            &shellex_sleutel("Other.Viewer.pdf"),
            None,
            ANDER,
        );
        zet_aan(&mut g, DLL, false, &alles_bestaat).unwrap();
        let s = status(&g, Some("Other.Viewer.pdf"), &alles_bestaat);
        assert!(s.actief);
        assert_eq!(
            s.via_standaard_app.map(|h| h.naam),
            Some("Viewer Thumbnails".into())
        );
        // Met Open PDF Studio als standaard-app is er niets te melden.
        assert_eq!(
            status(&g, Some("OpenPDFStudio.pdf"), &alles_bestaat).via_standaard_app,
            None
        );
    }

    #[test]
    fn verplaatste_dll_is_niet_actief() {
        let mut g = Geheugen::nieuw();
        zet_aan(&mut g, DLL, false, &alles_bestaat).unwrap();
        let weg = |p: &str| p != DLL;
        assert!(!status(&g, None, &weg).actief);
    }

    #[test]
    fn zonder_dll_niet_aanzetten() {
        let mut g = Geheugen::nieuw();
        let nergens = |_: &str| false;
        assert_eq!(
            zet_aan(&mut g, DLL, false, &nergens),
            Err(ZetFout::GeenDll(DLL.into()))
        );
        assert_eq!(g, Geheugen::nieuw());
    }

    #[test]
    fn uitzetten_laat_een_intussen_gewijzigde_waarde_staan() {
        let mut g = Geheugen::nieuw();
        zet_aan(&mut g, DLL, false, &alles_bestaat).unwrap();
        g.zet(Laag::Gebruiker, &shellex_sleutel(EXTENSIE), None, ANDER);
        zet_uit(&mut g).unwrap();
        assert_eq!(
            g.lees(Laag::Gebruiker, &shellex_sleutel(EXTENSIE), None)
                .as_deref(),
            Some(ANDER)
        );
        assert_eq!(g.lees(Laag::Gebruiker, &inproc_sleutel(CLSID), None), None);
    }

    /// Dezelfde regels tegen het echte register, in een eigen testboom onder
    /// HKCU (raakt Software\Classes niet).
    #[cfg(windows)]
    #[test]
    fn echt_register_in_een_testboom() {
        use super::win32::{verwijder_testboom, Win32Register};
        let basis = format!(
            r"Software\OpenPdfStudioThumbnailTest-{}",
            std::process::id()
        );
        verwijder_testboom(&basis);
        let mut reg = Win32Register::onder(&basis);
        reg.schrijf_in(
            Laag::Machine,
            &clsid_sleutel(ANDER),
            None,
            "Other PDF Thumbnails",
        )
        .unwrap();
        reg.schrijf_in(Laag::Machine, &inproc_sleutel(ANDER), None, ANDER_DLL)
            .unwrap();
        reg.schrijf_in(Laag::Gebruiker, &shellex_sleutel(EXTENSIE), None, ANDER)
            .unwrap();

        assert!(matches!(
            zet_aan(&mut reg, DLL, false, &alles_bestaat),
            Err(ZetFout::AnderProgramma(_))
        ));
        zet_aan(&mut reg, DLL, true, &alles_bestaat).unwrap();
        assert!(status(&reg, None, &alles_bestaat).actief);
        assert_eq!(
            reg.lees(Laag::Gebruiker, &clsid_sleutel(CLSID), Some(VORIGE_WAARDE))
                .as_deref(),
            Some(ANDER)
        );
        zet_uit(&mut reg).unwrap();
        assert_eq!(
            reg.lees(Laag::Gebruiker, &shellex_sleutel(EXTENSIE), None)
                .as_deref(),
            Some(ANDER)
        );
        assert_eq!(
            reg.lees(Laag::Gebruiker, &inproc_sleutel(CLSID), None),
            None
        );

        // Zonder ander programma: na uitzetten is ook de ShellEx-sleutel weg.
        reg.verwijder_boom(&shellex_ouder(EXTENSIE)).unwrap();
        zet_aan(&mut reg, DLL, false, &alles_bestaat).unwrap();
        zet_uit(&mut reg).unwrap();
        assert_eq!(
            reg.lees(Laag::Gebruiker, &shellex_sleutel(EXTENSIE), None),
            None
        );
        verwijder_testboom(&basis);
    }
}
