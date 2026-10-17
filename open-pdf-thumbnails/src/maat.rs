//! De afmeting van de miniatuur: pure rekenregels, zonder Windows of PDFium.
//!
//! De shell vraagt een miniatuur van `cx` pixels voor de langste zijde. Volgens
//! de richtlijnen van de shell vullen we niet zelf aan tot een vierkant: de
//! bitmap heeft de verhouding van de pagina zoals die getoond wordt (dus na
//! /Rotate), en Windows centreert hem zelf.

/// Grootste zijde die we ooit maken. De shell vraagt nu 32, 96, 256, 1024 of
/// 2560; groter levert niets op en kost alleen geheugen (2560² × 4 = 26 MB).
pub const MAX_ZIJDE: u32 = 2560;

/// Grootste paginazijde in punten die we accepteren (PDF-limiet is 14 400 pt,
/// met UserUnit kan het meer zijn; daarboven is het bestand vrijwel zeker stuk).
pub const MAX_PAGINA_PT: f32 = 1_000_000.0;

/// Breedte en hoogte in pixels voor een pagina van `breedte_pt` × `hoogte_pt`
/// (de getoonde maat, na rotatie: `FPDF_GetPageWidthF`/`HeightF` ruilen zelf
/// bij /Rotate 90 en 270) bij een gevraagde maat `cx`.
///
/// `None` als er niets zinnigs te maken is: `cx` is 0, of de paginamaat is
/// geen eindig positief getal. De kortste zijde is altijd minstens 1 pixel.
pub fn doelmaat(breedte_pt: f32, hoogte_pt: f32, cx: u32) -> Option<(u32, u32)> {
    if cx == 0 {
        return None;
    }
    let geldig = |v: f32| v.is_finite() && v > 0.0 && v <= MAX_PAGINA_PT;
    if !geldig(breedte_pt) || !geldig(hoogte_pt) {
        return None;
    }
    let lang = cx.min(MAX_ZIJDE);
    let kort = |klein: f32, groot: f32| -> u32 {
        let v = (lang as f64 * klein as f64 / groot as f64).round();
        (v as u32).clamp(1, lang)
    };
    if breedte_pt >= hoogte_pt {
        Some((lang, kort(hoogte_pt, breedte_pt)))
    } else {
        Some((kort(breedte_pt, hoogte_pt), lang))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a4_staand_bij_256() {
        // 595 × 842 pt: de hoogte is de lange zijde.
        assert_eq!(doelmaat(595.0, 842.0, 256), Some((181, 256)));
    }

    #[test]
    fn a4_liggend_bij_256() {
        assert_eq!(doelmaat(842.0, 595.0, 256), Some((256, 181)));
    }

    #[test]
    fn a0_tekening_liggend() {
        // A0 liggend, 3370 × 2384 pt.
        assert_eq!(doelmaat(3370.0, 2384.0, 1024), Some((1024, 724)));
    }

    #[test]
    fn vierkant() {
        assert_eq!(doelmaat(500.0, 500.0, 96), Some((96, 96)));
    }

    #[test]
    fn gevraagde_maat_wordt_begrensd() {
        assert_eq!(doelmaat(595.0, 842.0, 10_000), Some((1809, MAX_ZIJDE)));
    }

    #[test]
    fn extreme_verhouding_houdt_een_pixel() {
        // Een strook van 14 400 × 1 pt: de korte zijde wordt niet 0.
        assert_eq!(doelmaat(14_400.0, 1.0, 32), Some((32, 1)));
        assert_eq!(doelmaat(1.0, 14_400.0, 32), Some((1, 32)));
    }

    #[test]
    fn ongeldige_invoer() {
        assert_eq!(doelmaat(595.0, 842.0, 0), None);
        assert_eq!(doelmaat(0.0, 842.0, 256), None);
        assert_eq!(doelmaat(-1.0, 842.0, 256), None);
        assert_eq!(doelmaat(f32::NAN, 842.0, 256), None);
        assert_eq!(doelmaat(595.0, f32::INFINITY, 256), None);
        assert_eq!(doelmaat(2.0e6, 842.0, 256), None);
    }
}
