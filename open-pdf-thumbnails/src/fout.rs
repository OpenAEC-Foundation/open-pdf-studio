//! Waarom er geen miniatuur kwam. Elke fout wordt een HRESULT voor de shell;
//! die toont dan het gewone pictogram. Pure code, zonder Windows.

use std::fmt;

/// HRESULT-waarden uit winerror.h (als i32, zoals COM ze teruggeeft).
pub const E_FAIL: i32 = 0x8000_4005_u32 as i32;
pub const E_INVALIDARG: i32 = 0x8007_0057_u32 as i32;
pub const E_OUTOFMEMORY: i32 = 0x8007_000E_u32 as i32;
pub const E_UNEXPECTED: i32 = 0x8000_FFFF_u32 as i32;
pub const E_ACCESSDENIED: i32 = 0x8007_0005_u32 as i32;
/// HRESULT_FROM_WIN32(ERROR_TIMEOUT).
pub const E_TIMEOUT: i32 = 0x8007_05B4_u32 as i32;
/// HRESULT_FROM_WIN32(ERROR_FILE_TOO_LARGE).
pub const E_FILE_TOO_LARGE: i32 = 0x8007_00DF_u32 as i32;
/// HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED).
pub const E_ALREADY_INITIALIZED: i32 = 0x8007_04DF_u32 as i32;
/// HRESULT_FROM_WIN32(ERROR_NOT_READY): Initialize is niet aangeroepen.
pub const E_NOT_READY: i32 = 0x8007_0015_u32 as i32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fout {
    /// pdfium.dll niet gevonden of niet te laden.
    GeenPdfium(String),
    /// Leeg bestand, of groter dan PDFium via een stroom kan lezen (4 GB).
    OngeldigeLengte,
    /// Beveiligd met een wachtwoord om te openen: geen inhoud tonen.
    Wachtwoord,
    /// PDFium kon het bestand niet openen; de foutcode van FPDF_GetLastError.
    Onleesbaar(u32),
    GeenPaginas,
    /// De paginamaat is onzinnig (0, negatief, oneindig of absurd groot).
    Paginamaat,
    /// Geen geheugen voor de bitmap.
    Geheugen,
    /// PDFium gaf een fout tijdens het tekenen.
    Tekenen,
    /// Over de tijdslimiet (ook: te lang gewacht op een andere miniatuur).
    Tijd,
    /// Een paniek in eigen code, opgevangen aan de COM-grens.
    Paniek,
}

impl Fout {
    pub fn hresult(&self) -> i32 {
        match self {
            Fout::GeenPdfium(_)
            | Fout::Onleesbaar(_)
            | Fout::GeenPaginas
            | Fout::Paginamaat
            | Fout::Tekenen => E_FAIL,
            Fout::OngeldigeLengte => E_FILE_TOO_LARGE,
            Fout::Wachtwoord => E_ACCESSDENIED,
            Fout::Geheugen => E_OUTOFMEMORY,
            Fout::Tijd => E_TIMEOUT,
            Fout::Paniek => E_UNEXPECTED,
        }
    }
}

impl fmt::Display for Fout {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Fout::GeenPdfium(r) => write!(f, "PDFium niet beschikbaar: {r}"),
            Fout::OngeldigeLengte => write!(f, "lege of te grote stroom"),
            Fout::Wachtwoord => write!(f, "beveiligd met een wachtwoord"),
            Fout::Onleesbaar(c) => write!(f, "PDF niet te openen (PDFium-fout {c})"),
            Fout::GeenPaginas => write!(f, "geen pagina's"),
            Fout::Paginamaat => write!(f, "ongeldige paginamaat"),
            Fout::Geheugen => write!(f, "geen geheugen voor de bitmap"),
            Fout::Tekenen => write!(f, "tekenen mislukt"),
            Fout::Tijd => write!(f, "tijdslimiet overschreden"),
            Fout::Paniek => write!(f, "interne fout"),
        }
    }
}

/// PDFium-foutcode (FPDF_GetLastError) na een mislukte FPDF_LoadCustomDocument.
/// `te_laat`: de tijdslimiet was al voorbij, dan faalde het lezen expres.
pub fn fout_bij_openen(pdfium_fout: u32, te_laat: bool) -> Fout {
    const FPDF_ERR_PASSWORD: u32 = 4;
    if te_laat {
        Fout::Tijd
    } else if pdfium_fout == FPDF_ERR_PASSWORD {
        Fout::Wachtwoord
    } else {
        Fout::Onleesbaar(pdfium_fout)
    }
}

/// Lengte van de stroom als `unsigned long` voor FPDF_FILEACCESS (32 bits op
/// Windows). `None` voor leeg of te groot.
pub fn stroomlengte(bytes: u64) -> Result<u32, Fout> {
    match u32::try_from(bytes) {
        Ok(0) | Err(_) => Err(Fout::OngeldigeLengte),
        Ok(n) => Ok(n),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elke_fout_is_een_fout_hresult() {
        let alle = [
            Fout::GeenPdfium("x".into()),
            Fout::OngeldigeLengte,
            Fout::Wachtwoord,
            Fout::Onleesbaar(3),
            Fout::GeenPaginas,
            Fout::Paginamaat,
            Fout::Geheugen,
            Fout::Tekenen,
            Fout::Tijd,
            Fout::Paniek,
        ];
        for f in alle {
            // Een negatieve HRESULT is een fout: de shell valt terug op het pictogram.
            assert!(f.hresult() < 0, "{f:?} geeft geen fout-HRESULT");
            assert!(!f.to_string().is_empty());
        }
    }

    #[test]
    fn wachtwoord_wordt_herkend() {
        assert_eq!(fout_bij_openen(4, false), Fout::Wachtwoord);
        assert_eq!(fout_bij_openen(4, false).hresult(), E_ACCESSDENIED);
    }

    #[test]
    fn kapot_bestand() {
        // FPDF_ERR_FORMAT = 3, FPDF_ERR_FILE = 2.
        assert_eq!(fout_bij_openen(3, false), Fout::Onleesbaar(3));
        assert_eq!(fout_bij_openen(2, false).hresult(), E_FAIL);
    }

    #[test]
    fn te_laat_gaat_voor_de_pdfium_fout() {
        assert_eq!(fout_bij_openen(3, true), Fout::Tijd);
        assert_eq!(fout_bij_openen(4, true).hresult(), E_TIMEOUT);
    }

    #[test]
    fn stroomlengte_grenzen() {
        assert_eq!(stroomlengte(0), Err(Fout::OngeldigeLengte));
        assert_eq!(stroomlengte(1), Ok(1));
        assert_eq!(stroomlengte(u32::MAX as u64), Ok(u32::MAX));
        assert_eq!(
            stroomlengte(u32::MAX as u64 + 1),
            Err(Fout::OngeldigeLengte)
        );
    }
}
