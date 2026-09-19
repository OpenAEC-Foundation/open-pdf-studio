//! Hoe een PDF-pagina op het vel van de printer komt: de pure rekenregels
//! van de printkern (`print_windows`), zonder printer te testen.
//!
//! Twee plaatsingen (`print_pdf`, parameter `plaatsing`):
//! - `Passend` (standaard, het gedrag van vóór de schaalkeuze in de
//!   printdialoog): de pagina passend en gecentreerd in het bedrukbare
//!   gebied van de printer.
//! - `Vel`: de printdialoog heeft elke pagina al op papiergrootte opgemaakt,
//!   met het paginabeeld op de plek en de schaal die de gebruiker koos
//!   (`js/pdf/print-plaatsing.js`). De PDF-pagina is dan het vel en gaat 1:1
//!   op het hele fysieke vel: 1 mm in de PDF is 1 mm op papier. Wat in de
//!   onbedrukbare rand van de printer valt, valt weg.
//!
//! Apparaatcoördinaten van een printer-DC beginnen linksboven in het
//! bedrukbare gebied; het fysieke vel begint `PHYSICALOFFSETX/Y` pixels
//! daarvóór, dus op negatieve coördinaten.

/// Hoe een pagina op het vel komt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plaatsing {
    /// Passend en gecentreerd in het bedrukbare gebied (het oude gedrag).
    Passend,
    /// De pagina is het vel: 1:1 op het hele fysieke vel.
    Vel,
}

impl Plaatsing {
    /// `"vel"` → `Vel`; al het andere of niets → `Passend`, het gedrag van
    /// vóór deze parameter.
    pub fn uit_keuze(keuze: Option<&str>) -> Plaatsing {
        match keuze {
            Some("vel") => Plaatsing::Vel,
            _ => Plaatsing::Passend,
        }
    }
}

/// Rechthoek in apparaatpixels van de printer-DC.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DcRechthoek {
    pub x: i32,
    pub y: i32,
    pub breedte: i32,
    pub hoogte: i32,
}

/// Het vel zoals de printer-DC het meldt (`GetDeviceCaps`), in apparaatpixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DcVel {
    /// `HORZRES`, `VERTRES`: het bedrukbare gebied.
    pub bedrukbaar: (i32, i32),
    /// `PHYSICALWIDTH`, `PHYSICALHEIGHT`: het hele vel.
    pub fysiek: (i32, i32),
    /// `PHYSICALOFFSETX`, `PHYSICALOFFSETY`: waar het bedrukbare gebied op het vel begint.
    pub offset: (i32, i32),
    /// `LOGPIXELSX`, `LOGPIXELSY`.
    pub dpi: (i32, i32),
}

/// Een deel van een PDF-pagina in punten, vanaf de linkerbovenhoek van de pagina.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PaginaDeel {
    pub x: f64,
    pub y: f64,
    pub breedte: f64,
    pub hoogte: f64,
}

impl PaginaDeel {
    /// De hele pagina.
    pub fn heel(pagina_pt: (f64, f64)) -> PaginaDeel {
        PaginaDeel { x: 0.0, y: 0.0, breedte: pagina_pt.0, hoogte: pagina_pt.1 }
    }
}

/// Een rechthoek in PDF-gebruikersruimte (oorsprong linksonder, y omhoog).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdfRechthoek {
    pub links: f64,
    pub onder: f64,
    pub rechts: f64,
    pub boven: f64,
}

/// Onbedrukbare rand van een vel in mm, zoals het vel uit de printer komt.
/// De veldnamen gaan zo naar de JS-kant (print-papier.js).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Marges {
    pub links: f64,
    pub boven: f64,
    pub rechts: f64,
    pub onder: f64,
}

/// Het bedrukbare gebied van een printer voor één vel, per oriëntatie: de
/// randen verschillen per kant (invoerrand) en draaien met het vel mee.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Bedrukbaar {
    pub staand: Marges,
    pub liggend: Marges,
}

/// De onbedrukbare rand die een DC of informatiecontext meldt, in mm op
/// 0,1 mm nauwkeurig. `None` als de maten onbruikbaar zijn: een driver zonder
/// fysiek vel of resolutie, of een bedrukbaar gebied dat buiten het vel valt.
pub fn marges_uit_dc(vel: &DcVel) -> Option<Marges> {
    let (dpi_x, dpi_y) = (vel.dpi.0, vel.dpi.1);
    if dpi_x <= 0
        || dpi_y <= 0
        || vel.fysiek.0 <= 0
        || vel.fysiek.1 <= 0
        || vel.bedrukbaar.0 <= 0
        || vel.bedrukbaar.1 <= 0
    {
        return None;
    }
    let rechts = vel.fysiek.0 - vel.offset.0 - vel.bedrukbaar.0;
    let onder = vel.fysiek.1 - vel.offset.1 - vel.bedrukbaar.1;
    if vel.offset.0 < 0 || vel.offset.1 < 0 || rechts < 0 || onder < 0 {
        return None;
    }
    let mm = |px: i32, dpi: i32| (px as f64 * 25.4 / dpi as f64 * 10.0).round() / 10.0;
    Some(Marges {
        links: mm(vel.offset.0, dpi_x),
        boven: mm(vel.offset.1, dpi_y),
        rechts: mm(rechts, dpi_x),
        onder: mm(onder, dpi_y),
    })
}

/// Het oude gedrag: een bitmap van `bitmap` pixels passend in het bedrukbare
/// gebied, verhouding behouden, gecentreerd.
pub fn passend_in_bedrukbaar(bitmap: (u32, u32), bedrukbaar: (i32, i32)) -> DcRechthoek {
    let (w, h) = (bitmap.0.max(1) as f64, bitmap.1.max(1) as f64);
    let (dev_w, dev_h) = bedrukbaar;
    let s = (dev_w as f64 / w).min(dev_h as f64 / h);
    let dw = (w * s).round() as i32;
    let dh = (h * s).round() as i32;
    DcRechthoek { x: (dev_w - dw) / 2, y: (dev_h - dh) / 2, breedte: dw, hoogte: dh }
}

/// Tot hoeveel mm het vel van de driver mag afwijken van de PDF-pagina en
/// toch "hetzelfde vel" is: drivers ronden af op hun resolutie, en de lijst
/// van de printdialoog noemt Letter, Legal en Tabloid in hele mm.
pub const ZELFDE_VEL_MM: f64 = 1.0;

/// De 1:1-regel (plaatsing `Vel`): waar `deel` van een pagina van
/// `pagina_pt` punten op de DC komt als die pagina het vel is.
///
/// Bestemming is het hele fysieke vel (`PHYSICALWIDTH` x `PHYSICALHEIGHT`),
/// verschoven met `-PHYSICALOFFSETX/Y`, zodat 1 pt in de PDF 1/72 inch op
/// papier is. Er wordt in inches gerekend, dus ook goed bij een andere dpi in
/// x en y. Scheelt het vel meer dan `ZELFDE_VEL_MM` met de pagina (de driver
/// nam toch een ander vel), dan gaat de pagina gelijkmatig passend en
/// gecentreerd op het vel in plaats van vervormd. Een DC zonder fysieke maat
/// telt het bedrukbare gebied als vel.
pub fn deel_op_vel(pagina_pt: (f64, f64), deel: PaginaDeel, vel: &DcVel) -> DcRechthoek {
    let dpi_x = vel.dpi.0.max(1) as f64;
    let dpi_y = vel.dpi.1.max(1) as f64;
    let (fysiek, offset) = if vel.fysiek.0 > 0 && vel.fysiek.1 > 0 {
        (vel.fysiek, vel.offset)
    } else {
        (vel.bedrukbaar, (0, 0))
    };
    let vel_in = (fysiek.0 as f64 / dpi_x, fysiek.1 as f64 / dpi_y);
    let pagina_in = (pagina_pt.0.max(1e-6) / 72.0, pagina_pt.1.max(1e-6) / 72.0);
    let (kx, ky) = (vel_in.0 / pagina_in.0, vel_in.1 / pagina_in.1);
    let zelfde_vel = (vel_in.0 - pagina_in.0).abs() * 25.4 <= ZELFDE_VEL_MM
        && (vel_in.1 - pagina_in.1).abs() * 25.4 <= ZELFDE_VEL_MM;
    let (kx, ky) = if zelfde_vel { (kx, ky) } else { (kx.min(ky), kx.min(ky)) };
    let marge = ((vel_in.0 - pagina_in.0 * kx) / 2.0, (vel_in.1 - pagina_in.1 * ky) / 2.0);
    let naar_x = |pt: f64| ((marge.0 + pt / 72.0 * kx) * dpi_x).round() as i32 - offset.0;
    let naar_y = |pt: f64| ((marge.1 + pt / 72.0 * ky) * dpi_y).round() as i32 - offset.1;
    let (x0, y0) = (naar_x(deel.x), naar_y(deel.y));
    let (x1, y1) = (naar_x(deel.x + deel.breedte), naar_y(deel.y + deel.hoogte));
    DcRechthoek { x: x0, y: y0, breedte: (x1 - x0).max(1), hoogte: (y1 - y0).max(1) }
}

/// Het deel van de pagina met inhoud: de omhullende van alle `objecten`
/// (gebruikersruimte), begrensd tot `kader` (de zichtbare pagina in
/// gebruikersruimte), als deel vanaf de linkerbovenhoek van de pagina.
/// Objecten met onbruikbare maten tellen niet. `None` = niets op de pagina.
pub fn inhoud_deel(objecten: &[PdfRechthoek], kader: PdfRechthoek) -> Option<PaginaDeel> {
    let (mut links, mut onder, mut rechts, mut boven) =
        (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for o in objecten {
        if ![o.links, o.onder, o.rechts, o.boven].iter().all(|v| v.is_finite()) {
            continue;
        }
        links = links.min(o.links.min(o.rechts));
        rechts = rechts.max(o.links.max(o.rechts));
        onder = onder.min(o.onder.min(o.boven));
        boven = boven.max(o.onder.max(o.boven));
    }
    let links = links.max(kader.links);
    let rechts = rechts.min(kader.rechts);
    let onder = onder.max(kader.onder);
    let boven = boven.min(kader.boven);
    if !(rechts > links && boven > onder) {
        return None;
    }
    Some(PaginaDeel { x: links - kader.links, y: kader.boven - boven, breedte: rechts - links, hoogte: boven - onder })
}

/// De fijnste resolutie (dpi) als de pagina alleen uit afbeeldingen bestaat
/// met een bekende resolutie (zo zien de opgemaakte pagina's van de
/// printdialoog eruit), anders `None`.
pub fn fijnste_afbeelding_dpi(afbeeldingen: &[Option<f64>]) -> Option<f64> {
    if afbeeldingen.is_empty() {
        return None;
    }
    afbeeldingen.iter().try_fold(0.0_f64, |fijnste, dpi| match dpi {
        Some(d) if d.is_finite() && *d > 0.0 => Some(fijnste.max(*d)),
        _ => None,
    })
}

/// Hoe fijn een pagina voor de printer gerenderd wordt (dpi): de resolutie
/// van het apparaat, minstens 96 en hooguit 300 (geheugen bij plotters), zoals
/// altijd. Bestaat de pagina alleen uit afbeeldingen, dan niet fijner dan de
/// fijnste afbeelding (maar minstens 72): een vergroot paginabeeld op een
/// groot vel kost dan niet meer geheugen dan het beeld zelf.
pub fn render_dpi(apparaat_dpi: i32, afbeelding_dpi: Option<f64>) -> f64 {
    let basis = apparaat_dpi.max(96).min(300) as f64;
    match afbeelding_dpi {
        Some(d) if d.is_finite() && d > 0.0 => basis.min(d.max(72.0)),
        _ => basis,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MM: f64 = 72.0 / 25.4;

    /// De pdf-printer van Windows meldt 600 dpi en geen onbedrukbare rand; A3 staand.
    fn pdf_driver_a3() -> DcVel {
        DcVel { bedrukbaar: (7016, 9921), fysiek: (7016, 9921), offset: (0, 0), dpi: (600, 600) }
    }

    /// Een laserprinter met 4,2 mm rand (100 px op 600 dpi), A4 staand.
    fn laser_a4() -> DcVel {
        DcVel { bedrukbaar: (4760, 6816), fysiek: (4960, 7016), offset: (100, 100), dpi: (600, 600) }
    }

    fn a4() -> (f64, f64) {
        (210.0 * MM, 297.0 * MM)
    }

    fn a3() -> (f64, f64) {
        (297.0 * MM, 420.0 * MM)
    }

    #[test]
    fn plaatsing_uit_keuze_met_veilige_terugval() {
        assert_eq!(Plaatsing::uit_keuze(Some("vel")), Plaatsing::Vel);
        assert_eq!(Plaatsing::uit_keuze(Some("passend")), Plaatsing::Passend);
        assert_eq!(Plaatsing::uit_keuze(Some("Vel")), Plaatsing::Passend);
        assert_eq!(Plaatsing::uit_keuze(Some("")), Plaatsing::Passend);
        assert_eq!(Plaatsing::uit_keuze(None), Plaatsing::Passend);
    }

    #[test]
    fn passend_zoals_voorheen_gecentreerd_in_het_bedrukbare_gebied() {
        // A4-bitmap (300 dpi) op de laserprinter: passend in 4760 x 6816.
        let r = passend_in_bedrukbaar((2480, 3508), laser_a4().bedrukbaar);
        assert_eq!((r.breedte, r.hoogte), (4760, 6733));
        assert_eq!((r.x, r.y), (0, (6816 - 6733) / 2));
        // Liggende bitmap op een staand gebied: op de breedte, verticaal gecentreerd.
        let r = passend_in_bedrukbaar((3508, 2480), (4760, 6816));
        assert_eq!(r.breedte, 4760);
        assert_eq!(r.hoogte, (2480.0 * 4760.0 / 3508.0_f64).round() as i32);
        assert_eq!(r.y, (6816 - r.hoogte) / 2);
    }

    #[test]
    fn vel_de_hele_pagina_is_het_hele_fysieke_vel() {
        let r = deel_op_vel(a3(), PaginaDeel::heel(a3()), &pdf_driver_a3());
        assert_eq!(r, DcRechthoek { x: 0, y: 0, breedte: 7016, hoogte: 9921 });
    }

    #[test]
    fn vel_verschuift_met_de_onbedrukbare_rand() {
        // Laser, A4: het vel begint 100 px vóór het bedrukbare gebied.
        let r = deel_op_vel(a4(), PaginaDeel::heel(a4()), &laser_a4());
        assert_eq!(r, DcRechthoek { x: -100, y: -100, breedte: 4960, hoogte: 7016 });
    }

    #[test]
    fn vel_is_een_op_een_in_millimeters() {
        // Een A4-pagina gecentreerd op A3 (43,5 / 61,5 mm), als deel van de A3-pagina.
        let deel = PaginaDeel { x: 43.5 * MM, y: 61.5 * MM, breedte: 210.0 * MM, hoogte: 297.0 * MM };
        let r = deel_op_vel(a3(), deel, &pdf_driver_a3());
        let mm = |px: i32| px as f64 * 25.4 / 600.0;
        assert!((mm(r.x) - 43.5).abs() < 0.05, "{r:?}");
        assert!((mm(r.y) - 61.5).abs() < 0.05, "{r:?}");
        assert!((mm(r.breedte) - 210.0).abs() < 0.05, "{r:?}");
        assert!((mm(r.hoogte) - 297.0).abs() < 0.05, "{r:?}");
        // Zelfde deel op een printer met rand: dezelfde plek op papier, dus 100 px verschoven.
        let a3_laser = DcVel { bedrukbaar: (6816, 9721), fysiek: (7016, 9921), offset: (100, 100), dpi: (600, 600) };
        let s = deel_op_vel(a3(), deel, &a3_laser);
        assert_eq!((s.x, s.y, s.breedte, s.hoogte), (r.x - 100, r.y - 100, r.breedte, r.hoogte));
    }

    #[test]
    fn vel_met_verschillende_dpi_in_x_en_y() {
        // 600 x 1200 dpi: dezelfde millimeters, twee keer zoveel pixels in y.
        let vel = DcVel { bedrukbaar: (4960, 14032), fysiek: (4960, 14032), offset: (0, 0), dpi: (600, 1200) };
        let r = deel_op_vel(a4(), PaginaDeel::heel(a4()), &vel);
        assert_eq!(r, DcRechthoek { x: 0, y: 0, breedte: 4960, hoogte: 14032 });
        let deel = PaginaDeel { x: 10.0 * MM, y: 20.0 * MM, breedte: 50.0 * MM, hoogte: 50.0 * MM };
        let r = deel_op_vel(a4(), deel, &vel);
        let (mm_x, mm_y) = (|px: i32| px as f64 * 25.4 / 600.0, |px: i32| px as f64 * 25.4 / 1200.0);
        assert!((mm_x(r.x) - 10.0).abs() < 0.05 && (mm_y(r.y) - 20.0).abs() < 0.05, "{r:?}");
        assert!((mm_x(r.breedte) - 50.0).abs() < 0.05 && (mm_y(r.hoogte) - 50.0).abs() < 0.05, "{r:?}");
    }

    #[test]
    fn vel_afgeronde_maat_is_hetzelfde_vel() {
        // De driver meldt Letter als 5100 x 6600 px (215,9 x 279,4 mm); de PDF-pagina
        // is 216 x 279 mm (de maat in de lijst van de dialoog): gewoon het hele vel.
        let vel = DcVel { bedrukbaar: (5100, 6600), fysiek: (5100, 6600), offset: (0, 0), dpi: (600, 600) };
        let pagina = (216.0 * MM, 279.0 * MM);
        let r = deel_op_vel(pagina, PaginaDeel::heel(pagina), &vel);
        assert_eq!(r, DcRechthoek { x: 0, y: 0, breedte: 5100, hoogte: 6600 });
        // Net meer dan ZELFDE_VEL_MM verschil: gelijkmatig passend, niet uitgerekt.
        let langer = (216.0 * MM, (279.4 + ZELFDE_VEL_MM + 0.2) * MM);
        let r = deel_op_vel(langer, PaginaDeel::heel(langer), &vel);
        assert_eq!(r.hoogte, 6600);
        assert!(r.breedte < 5100 && r.x > 0, "{r:?}");
    }

    #[test]
    fn vel_ander_vel_dan_de_pagina_passend_zonder_vervorming() {
        // Een A3-pagina, maar de driver gaf A4: passend en gecentreerd, niet uitgerekt.
        let vel = DcVel { bedrukbaar: (4960, 7016), fysiek: (4960, 7016), offset: (0, 0), dpi: (600, 600) };
        let r = deel_op_vel(a3(), PaginaDeel::heel(a3()), &vel);
        assert!((r.breedte as f64 / r.hoogte as f64 - 297.0 / 420.0).abs() < 0.001, "{r:?}");
        assert!(r.breedte <= 4960 && r.hoogte <= 7016, "{r:?}");
    }

    #[test]
    fn vel_zonder_fysieke_maat_valt_terug_op_het_bedrukbare_gebied() {
        let vel = DcVel { bedrukbaar: (4960, 7016), fysiek: (0, 0), offset: (100, 100), dpi: (600, 600) };
        let r = deel_op_vel(a4(), PaginaDeel::heel(a4()), &vel);
        assert_eq!(r, DcRechthoek { x: 0, y: 0, breedte: 4960, hoogte: 7016 });
    }

    #[test]
    fn vel_klein_deel_is_minstens_een_pixel() {
        let deel = PaginaDeel { x: 100.0, y: 100.0, breedte: 0.01, hoogte: 0.01 };
        let r = deel_op_vel(a4(), deel, &laser_a4());
        assert!(r.breedte >= 1 && r.hoogte >= 1);
    }

    #[test]
    fn marges_van_een_driver_zonder_rand_zijn_nul() {
        assert_eq!(
            marges_uit_dc(&pdf_driver_a3()),
            Some(Marges { links: 0.0, boven: 0.0, rechts: 0.0, onder: 0.0 })
        );
    }

    #[test]
    fn marges_van_een_laserprinter_in_millimeters() {
        // 100 px op 600 dpi = 4,2 mm rondom.
        let m = marges_uit_dc(&laser_a4()).unwrap();
        assert_eq!(m, Marges { links: 4.2, boven: 4.2, rechts: 4.2, onder: 4.2 });
    }

    #[test]
    fn marges_per_kant_en_bij_verschillende_dpi() {
        // Asymmetrisch: links 3 mm (71 px), boven 5 mm (118 px), rechts 3,4 mm, onder 10 mm.
        let vel = DcVel {
            bedrukbaar: (4960 - 71 - 80, 7016 - 118 - 236),
            fysiek: (4960, 7016),
            offset: (71, 118),
            dpi: (600, 600),
        };
        let m = marges_uit_dc(&vel).unwrap();
        assert!((m.links - 3.0).abs() < 0.06 && (m.boven - 5.0).abs() < 0.06, "{m:?}");
        assert!((m.rechts - 3.4).abs() < 0.06 && (m.onder - 10.0).abs() < 0.06, "{m:?}");
        // 600 x 1200 dpi: de y-marges rekenen met de y-resolutie.
        let vel = DcVel { bedrukbaar: (4800, 13832), fysiek: (4960, 14032), offset: (80, 100), dpi: (600, 1200) };
        let m = marges_uit_dc(&vel).unwrap();
        assert_eq!((m.links, m.rechts), (3.4, 3.4));
        assert_eq!((m.boven, m.onder), (2.1, 2.1));
    }

    #[test]
    fn onbruikbare_maten_geven_geen_marges() {
        let leeg = DcVel { bedrukbaar: (0, 0), fysiek: (0, 0), offset: (0, 0), dpi: (0, 0) };
        assert_eq!(marges_uit_dc(&leeg), None);
        // Bedrukbaar gebied groter dan het vel: onzin.
        let onzin = DcVel { bedrukbaar: (5000, 7016), fysiek: (4960, 7016), offset: (100, 0), dpi: (600, 600) };
        assert_eq!(marges_uit_dc(&onzin), None);
        // Geen fysieke maat (sommige drivers): niets te zeggen.
        let zonder = DcVel { bedrukbaar: (4760, 6816), fysiek: (0, 0), offset: (0, 0), dpi: (600, 600) };
        assert_eq!(marges_uit_dc(&zonder), None);
    }

    #[test]
    fn inhoud_is_de_omhullende_vanaf_linksboven() {
        let kader = PdfRechthoek { links: 0.0, onder: 0.0, rechts: 842.0, boven: 1191.0 };
        let beeld = PdfRechthoek { links: 123.0, onder: 174.0, rechts: 718.0, boven: 1016.0 };
        let d = inhoud_deel(&[beeld], kader).unwrap();
        assert_eq!(d, PaginaDeel { x: 123.0, y: 175.0, breedte: 595.0, hoogte: 842.0 });
        // Twee objecten: de omhullende van beide.
        let tweede = PdfRechthoek { links: 700.0, onder: 1000.0, rechts: 800.0, boven: 1100.0 };
        let d = inhoud_deel(&[beeld, tweede], kader).unwrap();
        assert_eq!(d, PaginaDeel { x: 123.0, y: 91.0, breedte: 677.0, hoogte: 926.0 });
    }

    #[test]
    fn inhoud_begrensd_tot_de_pagina_en_met_verschoven_kader() {
        // Een beeld dat buiten de pagina steekt.
        let kader = PdfRechthoek { links: 0.0, onder: 0.0, rechts: 595.0, boven: 842.0 };
        let groot = PdfRechthoek { links: -100.0, onder: -50.0, rechts: 700.0, boven: 900.0 };
        assert_eq!(inhoud_deel(&[groot], kader).unwrap(), PaginaDeel::heel((595.0, 842.0)));
        // Een pagina waarvan het kader niet in de oorsprong begint.
        let kader = PdfRechthoek { links: 100.0, onder: 200.0, rechts: 695.0, boven: 1042.0 };
        let beeld = PdfRechthoek { links: 150.0, onder: 300.0, rechts: 250.0, boven: 400.0 };
        assert_eq!(
            inhoud_deel(&[beeld], kader).unwrap(),
            PaginaDeel { x: 50.0, y: 642.0, breedte: 100.0, hoogte: 100.0 }
        );
    }

    #[test]
    fn inhoud_leeg_of_onbruikbaar_is_niets() {
        let kader = PdfRechthoek { links: 0.0, onder: 0.0, rechts: 595.0, boven: 842.0 };
        assert_eq!(inhoud_deel(&[], kader), None);
        let buiten = PdfRechthoek { links: 600.0, onder: 0.0, rechts: 700.0, boven: 100.0 };
        assert_eq!(inhoud_deel(&[buiten], kader), None);
        let onzin = PdfRechthoek { links: f64::NAN, onder: 0.0, rechts: 10.0, boven: 10.0 };
        assert_eq!(inhoud_deel(&[onzin], kader), None);
        // Omgekeerd opgegeven hoeken tellen gewoon.
        let omgekeerd = PdfRechthoek { links: 20.0, onder: 30.0, rechts: 10.0, boven: 5.0 };
        assert_eq!(inhoud_deel(&[omgekeerd], kader).unwrap(), PaginaDeel { x: 10.0, y: 812.0, breedte: 10.0, hoogte: 25.0 });
    }

    #[test]
    fn fijnste_afbeelding_alleen_als_alles_een_afbeelding_is() {
        assert_eq!(fijnste_afbeelding_dpi(&[Some(106.0)]), Some(106.0));
        assert_eq!(fijnste_afbeelding_dpi(&[Some(106.0), Some(300.0)]), Some(300.0));
        assert_eq!(fijnste_afbeelding_dpi(&[Some(106.0), None]), None);
        assert_eq!(fijnste_afbeelding_dpi(&[Some(0.0)]), None);
        assert_eq!(fijnste_afbeelding_dpi(&[Some(f64::NAN)]), None);
        assert_eq!(fijnste_afbeelding_dpi(&[]), None);
    }

    #[test]
    fn render_dpi_zoals_voorheen_en_niet_fijner_dan_het_beeld() {
        // Zoals altijd: apparaat, minstens 96, hooguit 300.
        assert_eq!(render_dpi(600, None), 300.0);
        assert_eq!(render_dpi(200, None), 200.0);
        assert_eq!(render_dpi(72, None), 96.0);
        // Een vergroot paginabeeld van 106 dpi: niet fijner renderen dan het beeld.
        assert_eq!(render_dpi(600, Some(106.0)), 106.0);
        // Een beeld van 300 dpi of meer: de gewone grens.
        assert_eq!(render_dpi(600, Some(300.0)), 300.0);
        assert_eq!(render_dpi(600, Some(1200.0)), 300.0);
        // Minstens 72, en onzin telt niet.
        assert_eq!(render_dpi(600, Some(20.0)), 72.0);
        assert_eq!(render_dpi(600, Some(f64::INFINITY)), 300.0);
        assert_eq!(render_dpi(600, Some(-5.0)), 300.0);
    }
}
