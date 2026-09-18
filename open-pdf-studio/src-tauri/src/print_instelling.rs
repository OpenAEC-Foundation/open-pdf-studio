//! Printkeuzes uit de Pagina-instelling vertaald naar wat de printer begrijpt.
//!
//! Puur en platformonafhankelijk, zodat de regels zonder printer te testen
//! zijn. `print_pdf` gebruikt ze voor de DEVMODE op Windows en voor de
//! `lp`-opties op Linux en macOS. `PapierInfo` beschrijft het vel dat een
//! printer gaat gebruiken (voor de Printdialoog); `PrinterDevmodes` onthoudt
//! per printer de keuzes uit het eigenschappenvenster van de driver.

use std::collections::HashMap;
use std::sync::Mutex;

/// Gevraagde oriëntatie. `Auto` = per pagina afleiden (breder dan hoog → liggend).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Orientatie {
    Auto,
    Staand,
    Liggend,
}

impl Orientatie {
    /// Onbekende of ontbrekende keuze → `Auto` (het gedrag van vóór deze wijziging).
    pub fn uit_keuze(keuze: Option<&str>) -> Orientatie {
        match keuze {
            Some("portrait") => Orientatie::Staand,
            Some("landscape") => Orientatie::Liggend,
            _ => Orientatie::Auto,
        }
    }
}

/// Gevraagd papierformaat. `Printer` = niets instellen, standaard van de printer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Papier {
    Printer,
    A2,
    A3,
    A4,
    A5,
    Letter,
    Legal,
    Tabloid,
}

impl Papier {
    /// Onbekende of ontbrekende keuze → `Printer`.
    pub fn uit_keuze(keuze: Option<&str>) -> Papier {
        match keuze {
            Some("a2") => Papier::A2,
            Some("a3") => Papier::A3,
            Some("a4") => Papier::A4,
            Some("a5") => Papier::A5,
            Some("letter") => Papier::Letter,
            Some("legal") => Papier::Legal,
            Some("tabloid") => Papier::Tabloid,
            _ => Papier::Printer,
        }
    }
}

/// Moet deze pagina liggend? Bij `Auto`: breder dan hoog. Werkt op pixels
/// (u32) en op PDF-punten (f32).
pub fn liggend_voor_pagina<T: PartialOrd>(keuze: Orientatie, breedte: T, hoogte: T) -> bool {
    match keuze {
        Orientatie::Auto => breedte > hoogte,
        Orientatie::Staand => false,
        Orientatie::Liggend => true,
    }
}

/// DEVMODE `dmPaperSize`. Waarden gelijk aan de `DMPAPER_*`-constanten uit
/// windows-sys 0.59; `None` bij `Printer` (dan wordt `DM_PAPERSIZE` niet gezet).
pub fn dmpaper(papier: Papier) -> Option<i16> {
    match papier {
        Papier::Printer => None,
        Papier::A2 => Some(66),
        Papier::A3 => Some(8),
        Papier::A4 => Some(9),
        Papier::A5 => Some(11),
        Papier::Letter => Some(1),
        Papier::Legal => Some(5),
        Papier::Tabloid => Some(3),
    }
}

impl Papier {
    /// Sleutel zoals de Pagina-instelling en de Printdialoog hem kennen.
    pub fn sleutel(self) -> &'static str {
        match self {
            Papier::Printer => "printer",
            Papier::A2 => "a2",
            Papier::A3 => "a3",
            Papier::A4 => "a4",
            Papier::A5 => "a5",
            Papier::Letter => "letter",
            Papier::Legal => "legal",
            Papier::Tabloid => "tabloid",
        }
    }

    /// Het vel staand in mm: (korte zijde, lange zijde). `None` bij `Printer`.
    pub fn staande_maat_mm(self) -> Option<(f64, f64)> {
        match self {
            Papier::Printer => None,
            Papier::A2 => Some((420.0, 594.0)),
            Papier::A3 => Some((297.0, 420.0)),
            Papier::A4 => Some((210.0, 297.0)),
            Papier::A5 => Some((148.0, 210.0)),
            Papier::Letter => Some((215.9, 279.4)),
            Papier::Legal => Some((215.9, 355.6)),
            Papier::Tabloid => Some((279.4, 431.8)),
        }
    }
}

/// Alle bekende vellen, voor het terugzoeken op maat.
const BEKENDE_VELLEN: [Papier; 7] = [
    Papier::A2,
    Papier::A3,
    Papier::A4,
    Papier::A5,
    Papier::Letter,
    Papier::Legal,
    Papier::Tabloid,
];

/// Welk bekend vel hoort bij een DEVMODE-papiercode (`dmPaperSize`)?
///
/// Gedraaide (`*_ROTATED`), dwars ingevoerde (`*_TRANSVERSE`) en "small"-
/// varianten zijn hetzelfde vel dat alleen anders door de printer gaat; ze
/// krijgen dezelfde sleutel. Ledger (17 x 11 in) is het gedraaide Tabloid-vel.
/// Vellen met een andere maat (A3 Extra, A4 Plus, ...) en onbekende of
/// driver-eigen codes (>= 256) geven `None`; dan beslist de maat
/// (`papier_uit_maat_mm`) of het "overig" wordt.
pub fn papier_uit_dmpaper(code: i16) -> Option<Papier> {
    match code {
        66 => Some(Papier::A2),
        8 | 67 | 76 => Some(Papier::A3),         // A3, A3_TRANSVERSE, A3_ROTATED
        9 | 10 | 55 | 77 => Some(Papier::A4),    // A4, A4SMALL, A4_TRANSVERSE, A4_ROTATED
        11 | 61 | 78 => Some(Papier::A5),        // A5, A5_TRANSVERSE, A5_ROTATED
        1 | 2 | 54 | 75 => Some(Papier::Letter), // LETTER, LETTERSMALL, _TRANSVERSE, _ROTATED
        5 => Some(Papier::Legal),
        3 | 4 => Some(Papier::Tabloid),          // TABLOID, LEDGER
        _ => None,
    }
}

/// Speling bij het herkennen van een vel op maat: drivers ronden soms af.
const MAAT_SPELING_MM: f64 = 1.5;

/// Welk bekend vel heeft deze maat (in mm, in willekeurige volgorde)?
pub fn papier_uit_maat_mm(a: f64, b: f64) -> Option<Papier> {
    let (kort, lang) = if a <= b { (a, b) } else { (b, a) };
    BEKENDE_VELLEN.iter().copied().find(|p| match p.staande_maat_mm() {
        Some((k, l)) => (k - kort).abs() <= MAAT_SPELING_MM && (l - lang).abs() <= MAAT_SPELING_MM,
        None => false,
    })
}

fn op_tiende(mm: f64) -> f64 {
    (mm * 10.0).round() / 10.0
}

/// Het vel dat een printer gaat gebruiken, zoals de Printdialoog het toont.
/// Gaat als camelCase naar de JS-kant.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PapierInfo {
    /// "a2" | "a3" | "a4" | "a5" | "letter" | "legal" | "tabloid" | "overig".
    pub papier: &'static str,
    /// Formuliernaam van de driver (bijv. "A3"), anders leeg.
    pub naam: String,
    /// Vel staand: korte zijde in mm, op 0,1 mm.
    pub breedte_mm: f64,
    /// Vel staand: lange zijde in mm, op 0,1 mm.
    pub hoogte_mm: f64,
    /// "portrait" | "landscape".
    pub orientatie: &'static str,
}

impl PapierInfo {
    /// Uit de velden van een DEVMODE.
    ///
    /// - `dm_paper_size`: `dmPaperSize` (0 als `DM_PAPERSIZE` niet gezet is);
    /// - `maat_tiende_mm`: de maat in 0,1 mm als die bekend is, uit
    ///   `dmPaperWidth`/`dmPaperLength` of uit de papierlijst van de driver;
    ///   volgorde maakt niet uit, waarden <= 0 tellen als onbekend;
    /// - `formuliernaam`: `dmFormName` of de papiernaam van de driver;
    /// - `dm_orientation`: `DMORIENT_LANDSCAPE` (2) = liggend, al het andere staand.
    ///
    /// Een opgegeven maat wint van de code (zoals in de DEVMODE zelf). `None`
    /// als er geen maat en geen bekende code is.
    pub fn uit_devmode(
        dm_paper_size: i16,
        maat_tiende_mm: Option<(i32, i32)>,
        formuliernaam: Option<&str>,
        dm_orientation: i16,
    ) -> Option<PapierInfo> {
        let uit_code = papier_uit_dmpaper(dm_paper_size);
        let maat = maat_tiende_mm
            .filter(|&(a, b)| a > 0 && b > 0)
            .map(|(a, b)| {
                let (a, b) = (a as f64 / 10.0, b as f64 / 10.0);
                if a <= b { (a, b) } else { (b, a) }
            });
        let (papier, (breedte, hoogte)) = match (uit_code, maat) {
            (Some(p), None) => (Some(p), p.staande_maat_mm()?),
            (code, Some(m)) => {
                // De code geldt alleen als hij bij de maat past; anders beslist de maat.
                let op_maat = papier_uit_maat_mm(m.0, m.1);
                (code.filter(|p| op_maat == Some(*p)).or(op_maat), m)
            }
            (None, None) => return None,
        };
        Some(PapierInfo {
            papier: papier.map(Papier::sleutel).unwrap_or("overig"),
            naam: formuliernaam
                .map(|n| n.trim_end_matches('\0').trim().to_string())
                .unwrap_or_default(),
            breedte_mm: op_tiende(breedte),
            hoogte_mm: op_tiende(hoogte),
            orientatie: if dm_orientation == 2 { "landscape" } else { "portrait" },
        })
    }

    /// Een vel dat de driver niet laat beschrijven (geen bekende code en geen
    /// maat): "overig", maten 0. Alleen voor het antwoord van het
    /// eigenschappenvenster, dat bij OK altijd iets teruggeeft.
    pub fn onbekend(formuliernaam: Option<&str>, dm_orientation: i16) -> PapierInfo {
        PapierInfo {
            papier: "overig",
            naam: formuliernaam
                .map(|n| n.trim_end_matches('\0').trim().to_string())
                .unwrap_or_default(),
            breedte_mm: 0.0,
            hoogte_mm: 0.0,
            orientatie: if dm_orientation == 2 { "landscape" } else { "portrait" },
        }
    }

    /// Hetzelfde vel: dezelfde sleutel en (op 1 mm) dezelfde maat. Naam en
    /// oriëntatie tellen niet: "A4" uit lade 1 of lade 2 is hetzelfde vel.
    pub fn zelfde_vel(&self, ander: &PapierInfo) -> bool {
        self.papier == ander.papier
            && (self.breedte_mm - ander.breedte_mm).abs() <= 1.0
            && (self.hoogte_mm - ander.hoogte_mm).abs() <= 1.0
    }
}

/// Beschrijft `info` al het gevraagde vel? Dan hoeft het papier niet
/// overschreven te worden: een gedraaide variant (A4_ROTATED) of een
/// driver-eigen formulier van dezelfde maat blijft dan staan. `Printer`
/// vraagt nooit een vel.
pub fn beschrijft_vel(info: Option<&PapierInfo>, papier: Papier) -> bool {
    papier != Papier::Printer && info.is_some_and(|i| i.papier == papier.sleutel())
}

/// Antwoord van `open_printer_properties` bij OK: het gekozen vel plus wat de
/// gebruiker in het venster veranderde ten opzichte van de voorinvulling.
/// Serialiseert als PapierInfo met twee extra velden (camelCase).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EigenschappenKeuze {
    #[serde(flatten)]
    pub info: PapierInfo,
    pub papier_gewijzigd: bool,
    pub orientatie_gewijzigd: bool,
}

/// Sessiegeheugen: per printernaam de volledige DEVMODE (publiek deel plus
/// driverdeel, als bytes) die de gebruiker in het eigenschappenvenster van de
/// driver met OK bevestigde. Alleen in het geheugen: nooit bewaard, nooit
/// naar de printer- of systeemstandaard geschreven. Tauri-state.
#[derive(Default)]
pub struct PrinterDevmodes(pub Mutex<HashMap<String, Vec<u8>>>);

impl PrinterDevmodes {
    pub fn ophalen(&self, printer: &str) -> Option<Vec<u8>> {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).get(printer).cloned()
    }

    pub fn bewaren(&self, printer: &str, devmode: Vec<u8>) {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(printer.to_string(), devmode);
    }
}

/// Extra `lp`-argumenten (CUPS). Bij `Auto` geen oriëntatie-optie, bij `Printer` geen media.
pub fn lp_opties(orientatie: Orientatie, papier: Papier) -> Vec<String> {
    let mut opties = Vec::new();
    match orientatie {
        Orientatie::Auto => {}
        Orientatie::Staand => {
            opties.push("-o".to_string());
            opties.push("orientation-requested=3".to_string());
        }
        Orientatie::Liggend => {
            opties.push("-o".to_string());
            opties.push("orientation-requested=4".to_string());
        }
    }
    let media = match papier {
        Papier::Printer => None,
        Papier::A2 => Some("A2"),
        Papier::A3 => Some("A3"),
        Papier::A4 => Some("A4"),
        Papier::A5 => Some("A5"),
        Papier::Letter => Some("Letter"),
        Papier::Legal => Some("Legal"),
        Papier::Tabloid => Some("Tabloid"),
    };
    if let Some(m) = media {
        opties.push("-o".to_string());
        opties.push(format!("media={m}"));
    }
    opties
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keuzes_parsen_met_veilige_terugval() {
        assert_eq!(Orientatie::uit_keuze(Some("landscape")), Orientatie::Liggend);
        assert_eq!(Orientatie::uit_keuze(Some("portrait")), Orientatie::Staand);
        assert_eq!(Orientatie::uit_keuze(Some("auto")), Orientatie::Auto);
        assert_eq!(Orientatie::uit_keuze(Some("onzin")), Orientatie::Auto);
        assert_eq!(Orientatie::uit_keuze(None), Orientatie::Auto);
        assert_eq!(Papier::uit_keuze(Some("a3")), Papier::A3);
        assert_eq!(Papier::uit_keuze(Some("printer")), Papier::Printer);
        assert_eq!(Papier::uit_keuze(Some("a1")), Papier::Printer);
        assert_eq!(Papier::uit_keuze(None), Papier::Printer);
    }

    #[test]
    fn auto_volgt_de_pagina_zoals_voorheen() {
        assert!(liggend_voor_pagina(Orientatie::Auto, 1684, 1191));
        assert!(!liggend_voor_pagina(Orientatie::Auto, 1191, 1684));
        assert!(!liggend_voor_pagina(Orientatie::Auto, 1000, 1000));
    }

    #[test]
    fn expliciete_keuze_wint_van_de_pagina() {
        assert!(liggend_voor_pagina(Orientatie::Liggend, 1191, 1684));
        assert!(!liggend_voor_pagina(Orientatie::Staand, 1684, 1191));
    }

    #[test]
    fn printerstandaard_zet_geen_papiercode() {
        assert_eq!(dmpaper(Papier::Printer), None);
        assert_eq!(dmpaper(Papier::A4), Some(9));
    }

    #[cfg(windows)]
    #[test]
    fn papiercodes_gelijk_aan_windows_constanten() {
        use windows_sys::Win32::Graphics::Gdi::{
            DMPAPER_A2, DMPAPER_A3, DMPAPER_A4, DMPAPER_A5, DMPAPER_LEGAL, DMPAPER_LETTER, DMPAPER_TABLOID,
        };
        assert_eq!(dmpaper(Papier::A2), Some(DMPAPER_A2 as i16));
        assert_eq!(dmpaper(Papier::A3), Some(DMPAPER_A3 as i16));
        assert_eq!(dmpaper(Papier::A4), Some(DMPAPER_A4 as i16));
        assert_eq!(dmpaper(Papier::A5), Some(DMPAPER_A5 as i16));
        assert_eq!(dmpaper(Papier::Letter), Some(DMPAPER_LETTER as i16));
        assert_eq!(dmpaper(Papier::Legal), Some(DMPAPER_LEGAL as i16));
        assert_eq!(dmpaper(Papier::Tabloid), Some(DMPAPER_TABLOID as i16));
    }

    #[test]
    fn orientatie_ook_op_pdf_punten() {
        assert!(liggend_voor_pagina(Orientatie::Auto, 841.89_f32, 595.28_f32));
        assert!(!liggend_voor_pagina(Orientatie::Auto, 595.28_f32, 841.89_f32));
        assert!(!liggend_voor_pagina(Orientatie::Auto, 600.0_f32, 600.0_f32));
    }

    #[test]
    fn bekende_papiercodes_naar_sleutel() {
        let sleutel = |c: i16| papier_uit_dmpaper(c).map(Papier::sleutel);
        assert_eq!(sleutel(66), Some("a2"));
        assert_eq!(sleutel(8), Some("a3"));
        assert_eq!(sleutel(9), Some("a4"));
        assert_eq!(sleutel(11), Some("a5"));
        assert_eq!(sleutel(1), Some("letter"));
        assert_eq!(sleutel(5), Some("legal"));
        assert_eq!(sleutel(3), Some("tabloid"));
        // Elke Papier-keuze komt via haar eigen code terug op zichzelf.
        for p in BEKENDE_VELLEN {
            assert_eq!(papier_uit_dmpaper(dmpaper(p).unwrap()), Some(p));
        }
    }

    #[test]
    fn gedraaide_en_dwarse_varianten_zijn_hetzelfde_vel() {
        let sleutel = |c: i16| papier_uit_dmpaper(c).map(Papier::sleutel);
        assert_eq!(sleutel(76), Some("a3")); // A3_ROTATED
        assert_eq!(sleutel(67), Some("a3")); // A3_TRANSVERSE
        assert_eq!(sleutel(77), Some("a4")); // A4_ROTATED
        assert_eq!(sleutel(55), Some("a4")); // A4_TRANSVERSE
        assert_eq!(sleutel(10), Some("a4")); // A4SMALL
        assert_eq!(sleutel(78), Some("a5")); // A5_ROTATED
        assert_eq!(sleutel(61), Some("a5")); // A5_TRANSVERSE
        assert_eq!(sleutel(75), Some("letter")); // LETTER_ROTATED
        assert_eq!(sleutel(54), Some("letter")); // LETTER_TRANSVERSE
        assert_eq!(sleutel(2), Some("letter")); // LETTERSMALL
        assert_eq!(sleutel(4), Some("tabloid")); // LEDGER = gedraaid Tabloid
    }

    #[test]
    fn andere_maten_en_onbekende_codes_zijn_geen_bekend_vel() {
        assert_eq!(papier_uit_dmpaper(0), None);
        assert_eq!(papier_uit_dmpaper(63), None); // A3_EXTRA
        assert_eq!(papier_uit_dmpaper(60), None); // A4_PLUS
        assert_eq!(papier_uit_dmpaper(64), None); // A5_EXTRA
        assert_eq!(papier_uit_dmpaper(256), None); // DMPAPER_USER
        assert_eq!(papier_uit_dmpaper(-1), None);
    }

    #[test]
    fn staande_maten() {
        assert_eq!(Papier::A3.staande_maat_mm(), Some((297.0, 420.0)));
        assert_eq!(Papier::A2.staande_maat_mm(), Some((420.0, 594.0)));
        assert_eq!(Papier::Letter.staande_maat_mm(), Some((215.9, 279.4)));
        assert_eq!(Papier::Tabloid.staande_maat_mm(), Some((279.4, 431.8)));
        assert_eq!(Papier::Printer.staande_maat_mm(), None);
        for p in BEKENDE_VELLEN {
            let (b, h) = p.staande_maat_mm().unwrap();
            assert!(b < h, "{p:?} staat niet staand");
        }
    }

    #[test]
    fn vel_herkennen_op_maat() {
        assert_eq!(papier_uit_maat_mm(297.0, 420.0), Some(Papier::A3));
        assert_eq!(papier_uit_maat_mm(420.0, 297.0), Some(Papier::A3));
        assert_eq!(papier_uit_maat_mm(296.3, 419.1), Some(Papier::A3));
        assert_eq!(papier_uit_maat_mm(215.9, 279.4), Some(Papier::Letter));
        assert_eq!(papier_uit_maat_mm(322.0, 445.0), None); // A3 Extra
        assert_eq!(papier_uit_maat_mm(210.0, 330.0), None); // A4 Plus
    }

    #[test]
    fn papierinfo_uit_code_zonder_maat() {
        let info = PapierInfo::uit_devmode(8, None, Some("A3"), 1).unwrap();
        assert_eq!(
            info,
            PapierInfo {
                papier: "a3",
                naam: "A3".to_string(),
                breedte_mm: 297.0,
                hoogte_mm: 420.0,
                orientatie: "portrait",
            }
        );
        let info = PapierInfo::uit_devmode(76, None, None, 2).unwrap();
        assert_eq!((info.papier, info.breedte_mm, info.hoogte_mm), ("a3", 297.0, 420.0));
        assert_eq!(info.orientatie, "landscape");
        assert_eq!(info.naam, "");
    }

    #[test]
    fn papierinfo_maat_staand_en_op_tiende_mm() {
        // Liggend opgegeven maat wordt staand; 0,1 mm-eenheden exact.
        let info = PapierInfo::uit_devmode(1, Some((2794, 2159)), None, 1).unwrap();
        assert_eq!((info.papier, info.breedte_mm, info.hoogte_mm), ("letter", 215.9, 279.4));
        let info = PapierInfo::uit_devmode(9, Some((2100, 2970)), Some("A4\0\0"), 0).unwrap();
        assert_eq!((info.papier, info.naam.as_str(), info.orientatie), ("a4", "A4", "portrait"));
    }

    #[test]
    fn papierinfo_onbekende_code_beslist_op_maat() {
        // Driver-eigen code met een A3-maat: gewoon A3.
        let info = PapierInfo::uit_devmode(260, Some((2970, 4200)), Some("A3 (297 x 420 mm)"), 1).unwrap();
        assert_eq!((info.papier, info.breedte_mm, info.hoogte_mm), ("a3", 297.0, 420.0));
        assert_eq!(info.naam, "A3 (297 x 420 mm)");
        // Andere maat: overig, met de echte maat.
        let info = PapierInfo::uit_devmode(63, Some((3220, 4450)), None, 1).unwrap();
        assert_eq!((info.papier, info.breedte_mm, info.hoogte_mm), ("overig", 322.0, 445.0));
        // Zonder code en zonder maat valt er niets te zeggen.
        assert_eq!(PapierInfo::uit_devmode(0, None, Some("Iets"), 1), None);
        assert_eq!(PapierInfo::uit_devmode(263, Some((0, 4200)), None, 1), None);
    }

    #[test]
    fn papierinfo_maat_wint_van_code() {
        // dmPaperWidth/-Length gaan in een DEVMODE voor dmPaperSize.
        let info = PapierInfo::uit_devmode(9, Some((2970, 4200)), None, 1).unwrap();
        assert_eq!(info.papier, "a3");
        let info = PapierInfo::uit_devmode(9, Some((1000, 1500)), None, 1).unwrap();
        assert_eq!((info.papier, info.breedte_mm, info.hoogte_mm), ("overig", 100.0, 150.0));
    }

    #[test]
    fn papierinfo_serialiseert_camelcase() {
        let info = PapierInfo::uit_devmode(8, None, Some("A3"), 2).unwrap();
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "papier": "a3",
                "naam": "A3",
                "breedteMm": 297.0,
                "hoogteMm": 420.0,
                "orientatie": "landscape"
            })
        );
    }

    #[test]
    fn eigenschappenkeuze_is_papierinfo_met_vlaggen() {
        let keuze = EigenschappenKeuze {
            info: PapierInfo::uit_devmode(8, None, Some("A3"), 2).unwrap(),
            papier_gewijzigd: false,
            orientatie_gewijzigd: true,
        };
        assert_eq!(
            serde_json::to_value(&keuze).unwrap(),
            serde_json::json!({
                "papier": "a3",
                "naam": "A3",
                "breedteMm": 297.0,
                "hoogteMm": 420.0,
                "orientatie": "landscape",
                "papierGewijzigd": false,
                "orientatieGewijzigd": true
            })
        );
    }

    #[test]
    fn onbekend_vel_is_overig_zonder_maat() {
        let info = PapierInfo::onbekend(Some("Eigen formulier\0"), 2);
        assert_eq!(
            info,
            PapierInfo {
                papier: "overig",
                naam: "Eigen formulier".to_string(),
                breedte_mm: 0.0,
                hoogte_mm: 0.0,
                orientatie: "landscape",
            }
        );
        assert_eq!(PapierInfo::onbekend(None, 1).naam, "");
    }

    #[test]
    fn zelfde_vel_negeert_naam_en_orientatie() {
        let a3 = PapierInfo::uit_devmode(8, None, Some("A3"), 1).unwrap();
        // Driver-eigen A3-formulier uit een andere lade, liggend.
        let a3_lade2 = PapierInfo::uit_devmode(260, Some((2970, 4200)), Some("A3 (lade 2)"), 2).unwrap();
        let a3_gedraaid = PapierInfo::uit_devmode(76, None, None, 2).unwrap();
        let a4 = PapierInfo::uit_devmode(9, None, Some("A4"), 1).unwrap();
        assert!(a3.zelfde_vel(&a3_lade2));
        assert!(a3.zelfde_vel(&a3_gedraaid));
        assert!(!a3.zelfde_vel(&a4));
        // Overig: de maat beslist.
        let poster = PapierInfo::uit_devmode(300, Some((5000, 7000)), None, 1).unwrap();
        let groter = PapierInfo::uit_devmode(300, Some((5000, 7100)), None, 1).unwrap();
        assert!(poster.zelfde_vel(&poster.clone()));
        assert!(!poster.zelfde_vel(&groter));
    }

    #[test]
    fn beschrijft_vel_ook_voor_varianten() {
        // A4_ROTATED uit de eigenschappen: bij papier "a4" niet overschrijven.
        let a4_gedraaid = PapierInfo::uit_devmode(77, None, None, 2);
        assert!(beschrijft_vel(a4_gedraaid.as_ref(), Papier::A4));
        assert!(!beschrijft_vel(a4_gedraaid.as_ref(), Papier::A3));
        // Driver-eigen formulier (>= 256) met een A3-maat.
        let eigen_a3 = PapierInfo::uit_devmode(270, Some((2970, 4200)), Some("A3 Lade 2"), 1);
        assert!(beschrijft_vel(eigen_a3.as_ref(), Papier::A3));
        // Onbekend vel of papier "printer": nooit.
        assert!(!beschrijft_vel(None, Papier::A3));
        assert!(!beschrijft_vel(a4_gedraaid.as_ref(), Papier::Printer));
        assert!(!beschrijft_vel(Some(&PapierInfo::onbekend(None, 1)), Papier::A4));
    }

    #[test]
    fn sessiegeheugen_per_printer() {
        let s = PrinterDevmodes::default();
        assert_eq!(s.ophalen("P"), None);
        s.bewaren("P", vec![1, 2, 3]);
        s.bewaren("Q", vec![4]);
        s.bewaren("P", vec![5]);
        assert_eq!(s.ophalen("P"), Some(vec![5]));
        assert_eq!(s.ophalen("Q"), Some(vec![4]));
    }

    #[cfg(windows)]
    #[test]
    fn variantcodes_gelijk_aan_windows_constanten() {
        use windows_sys::Win32::Graphics::Gdi::{
            DMPAPER_A3_EXTRA, DMPAPER_A3_ROTATED, DMPAPER_A3_TRANSVERSE, DMPAPER_A4SMALL, DMPAPER_A4_PLUS,
            DMPAPER_A4_ROTATED, DMPAPER_A4_TRANSVERSE, DMPAPER_A5_ROTATED, DMPAPER_A5_TRANSVERSE, DMPAPER_LEDGER,
            DMPAPER_LETTERSMALL, DMPAPER_LETTER_ROTATED, DMPAPER_LETTER_TRANSVERSE,
        };
        let s = |c: u32| papier_uit_dmpaper(c as i16);
        assert_eq!(s(DMPAPER_A3_ROTATED), Some(Papier::A3));
        assert_eq!(s(DMPAPER_A3_TRANSVERSE), Some(Papier::A3));
        assert_eq!(s(DMPAPER_A4_ROTATED), Some(Papier::A4));
        assert_eq!(s(DMPAPER_A4_TRANSVERSE), Some(Papier::A4));
        assert_eq!(s(DMPAPER_A4SMALL), Some(Papier::A4));
        assert_eq!(s(DMPAPER_A5_ROTATED), Some(Papier::A5));
        assert_eq!(s(DMPAPER_A5_TRANSVERSE), Some(Papier::A5));
        assert_eq!(s(DMPAPER_LETTER_ROTATED), Some(Papier::Letter));
        assert_eq!(s(DMPAPER_LETTER_TRANSVERSE), Some(Papier::Letter));
        assert_eq!(s(DMPAPER_LETTERSMALL), Some(Papier::Letter));
        assert_eq!(s(DMPAPER_LEDGER), Some(Papier::Tabloid));
        assert_eq!(s(DMPAPER_A3_EXTRA), None);
        assert_eq!(s(DMPAPER_A4_PLUS), None);
    }

    #[test]
    fn lp_opties_per_keuze() {
        assert!(lp_opties(Orientatie::Auto, Papier::Printer).is_empty());
        assert_eq!(
            lp_opties(Orientatie::Liggend, Papier::A3),
            vec!["-o", "orientation-requested=4", "-o", "media=A3"]
        );
        assert_eq!(lp_opties(Orientatie::Staand, Papier::Printer), vec!["-o", "orientation-requested=3"]);
    }
}
