//! Printkeuzes uit de Pagina-instelling vertaald naar wat de printer begrijpt.
//!
//! Puur en platformonafhankelijk, zodat de regels zonder printer te testen
//! zijn. `print_pdf` gebruikt ze voor de DEVMODE op Windows en voor de
//! `lp`-opties op Linux en macOS.

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

/// Moet deze pagina liggend? Bij `Auto`: breder dan hoog.
pub fn liggend_voor_pagina(keuze: Orientatie, breedte: u32, hoogte: u32) -> bool {
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
    fn lp_opties_per_keuze() {
        assert!(lp_opties(Orientatie::Auto, Papier::Printer).is_empty());
        assert_eq!(
            lp_opties(Orientatie::Liggend, Papier::A3),
            vec!["-o", "orientation-requested=4", "-o", "media=A3"]
        );
        assert_eq!(lp_opties(Orientatie::Staand, Papier::Printer), vec!["-o", "orientation-requested=3"]);
    }
}
