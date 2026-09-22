//! Printen op Windows: elke PDF-pagina via PDFium rasteren en met GDI op de
//! printer-DC zetten.
//!
//! De DC wordt aangemaakt met een volledige, door de driver gecontroleerde
//! DEVMODE (`print_devmode`): de eigenschappen die de gebruiker in deze sessie
//! koos (anders de standaard van de driver), met het papier uit de
//! Pagina-instelling erin en de oriëntatie van de eerste pagina. Pas als een
//! volgende pagina de andere kant op staat volgt `ResetDCW`, met dezelfde
//! volledige DEVMODE waarin alleen `dmOrientation` anders is.
//!
//! Vroeger ging de DC open zonder DEVMODE en kreeg hij vóór elke pagina een
//! verder lege `DEVMODEW` via `ResetDCW`. Drivers vullen de lege velden dan
//! met hun eigen standaard aan en nemen het papier vaak alleen over uit de
//! DEVMODE waarmee de DC gemaakt is: het papier bleef A4 (issue 406).
//!
//! Geeft een driver geen bruikbare DEVMODE, dan blijft die oude weg over als
//! noodweg (`nood_devmode`), maar altijd mét papier: het gevraagde, of het
//! vel dat de DC al heeft, zodat een ResetDC het papier niet kwijtraakt.
//! Vellen zonder vaste papiercode (A1, A0, de verlengde vellen) kent de
//! noodweg niet; daar blijft het papier van de printer staan.
//!
//! Waar een pagina op het vel komt (`print_plaatsing`): passend in het
//! bedrukbare gebied (het oude gedrag), of, als de printdialoog de schaal al
//! in de pagina heeft gezet (plaatsing `Vel`), 1:1 op het hele fysieke vel.
//! Staat de pagina haaks op het vel dat de DC meldt (het stuurprogramma nam
//! de stand of het papier niet over), dan gaat het beeld een kwartslag
//! linksom (`draaiing_voor_vel`), dezelfde regel en richting als het
//! voorbeeld in de printdialoog.

use std::path::Path;
use std::sync::Arc;

use pdfium_render::prelude::PdfDocument;
use windows_sys::Win32::Graphics::Gdi::{
    CreateDCW, CreateICW, DeleteDC, GetDeviceCaps, ResetDCW, SetStretchBltMode, StretchDIBits, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DEVMODEW, DIB_RGB_COLORS, DMORIENT_LANDSCAPE, DMORIENT_PORTRAIT,
    DM_ORIENTATION, DM_PAPERSIZE, HALFTONE, HDC, HORZRES, LOGPIXELSX, LOGPIXELSY, PHYSICALHEIGHT,
    PHYSICALOFFSETX, PHYSICALOFFSETY, PHYSICALWIDTH, SRCCOPY, VERTRES,
};
// De StartDoc/EndDoc-familie staat in windows-sys onder Storage::Xps.
use windows_sys::Win32::Storage::Xps::{AbortDoc, EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};

use crate::pdfium_renderer;
use crate::print_devmode::{breed, devmode_voor_opdracht, met_orientatie, DevMode, Printer};
use crate::print_instelling::{dmpaper, liggend_voor_pagina, papier_uit_maat_mm, Orientatie, Papier};
use crate::print_plaatsing::{
    deel_linksom, deel_op_vel, draai_linksom, draaiing_voor_vel, fijnste_afbeelding_dpi, inhoud_deel, marges_uit_dc,
    passend_in_bedrukbaar, render_dpi, Bedrukbaar, DcRechthoek, DcVel, PaginaDeel, Plaatsing,
};

/// Printer-DC die bij het verlaten van de scope altijd weer vrijkomt.
struct Dc(HDC);

impl Drop for Dc {
    fn drop(&mut self) {
        unsafe {
            DeleteDC(self.0);
        }
    }
}

/// Lopende printopdracht: zonder `afgerond()` wordt hij afgebroken, zodat een
/// fout halverwege geen halve opdracht in de wachtrij laat staan.
struct Opdracht {
    hdc: HDC,
    open: bool,
}

impl Opdracht {
    fn afgerond(mut self) -> Result<(), String> {
        self.open = false;
        if unsafe { EndDoc(self.hdc) } <= 0 {
            return Err("EndDoc failed (print job not completed)".to_string());
        }
        Ok(())
    }
}

impl Drop for Opdracht {
    fn drop(&mut self) {
        if self.open {
            unsafe {
                AbortDoc(self.hdc);
            }
        }
    }
}

/// De DEVMODE's voor staande en liggende pagina's van één opdracht.
pub struct OpdrachtDevmodes {
    pub staand: DevMode,
    pub liggend: DevMode,
}

impl OpdrachtDevmodes {
    pub fn maak(printer: &str, opgeslagen: Option<&[u8]>, papier: Papier) -> Result<OpdrachtDevmodes, String> {
        let prn = Printer::open(printer)?;
        let basis = devmode_voor_opdracht(&prn, opgeslagen, papier)?;
        Ok(OpdrachtDevmodes {
            staand: met_orientatie(&prn, &basis, false),
            liggend: met_orientatie(&prn, &basis, true),
        })
        // `prn` gaat hier dicht (Drop).
    }

    pub fn voor(&self, liggend: bool) -> &DevMode {
        if liggend { &self.liggend } else { &self.staand }
    }
}

/// Het vel van de DC in mm (breedte x hoogte zoals de DC staat).
fn vel_mm(hdc: HDC) -> (f64, f64) {
    unsafe {
        let (pw, ph) = (GetDeviceCaps(hdc, PHYSICALWIDTH as i32), GetDeviceCaps(hdc, PHYSICALHEIGHT as i32));
        let (dx, dy) = (GetDeviceCaps(hdc, LOGPIXELSX as i32).max(1), GetDeviceCaps(hdc, LOGPIXELSY as i32).max(1));
        (pw as f64 * 25.4 / dx as f64, ph as f64 * 25.4 / dy as f64)
    }
}

/// Het vel van de DC in apparaatpixels: bedrukbaar gebied, fysiek vel,
/// waar het bedrukbare gebied begint en de resolutie.
fn dc_vel(hdc: HDC) -> DcVel {
    let cap = |index: u32| unsafe { GetDeviceCaps(hdc, index as i32) };
    DcVel {
        bedrukbaar: (cap(HORZRES), cap(VERTRES)),
        fysiek: (cap(PHYSICALWIDTH), cap(PHYSICALHEIGHT)),
        offset: (cap(PHYSICALOFFSETX), cap(PHYSICALOFFSETY)),
        dpi: (cap(LOGPIXELSX), cap(LOGPIXELSY)),
    }
}

/// Het bedrukbare gebied van de volgende opdracht, per oriëntatie.
///
/// Gemeten op een informatiecontext met precies de DEVMODE die de afdruk
/// krijgt (`OpdrachtDevmodes`): de eigenschappen uit deze sessie of de
/// standaard van de driver, met het papier uit de Pagina-instelling. Er start
/// geen opdracht, er gaat niets naar de printer en er verandert niets.
/// `None` als de driver geen DEVMODE of geen bruikbare maten geeft; dan
/// rekent de printdialoog met marge 0, zoals vóór deze meting.
pub fn bedrukbaar_voor_opdracht(printer: &str, opgeslagen: Option<&[u8]>, papier: Papier) -> Option<Bedrukbaar> {
    let devmodes = OpdrachtDevmodes::maak(printer, opgeslagen, papier)
        .map_err(|e| log::warn!("[print] bedrukbaar gebied van '{printer}' onbekend: {e}"))
        .ok()?;
    let naam = breed(printer);
    let meet = |liggend: bool| {
        let ic = unsafe { CreateICW(std::ptr::null(), naam.as_ptr(), std::ptr::null(), devmodes.voor(liggend).ptr()) };
        if ic.is_null() {
            return None;
        }
        let vel = dc_vel(ic);
        unsafe { DeleteDC(ic) };
        marges_uit_dc(&vel)
    };
    Some(Bedrukbaar { staand: meet(false)?, liggend: meet(true)? })
}

/// Een gerenderde pagina (breedte, hoogte, RGBA) en waar hij op de DC komt.
type PaginaBeeld = (u32, u32, Vec<u8>, DcRechthoek);

/// Plaatsing `Vel`: de pagina is het vel en gaat 1:1 op het fysieke vel.
///
/// De printdialoog zet één paginabeeld op een verder leeg vel; alleen het
/// deel met inhoud wordt gerenderd, en niet fijner dan dat beeld zelf
/// (`render_dpi`), zodat een A4 op een A0-vel niet een heel A0 aan pixels
/// kost. `None` = een leeg vel. Een gedraaide pagina (/Rotate) gaat in zijn
/// geheel, zoals PDFium hem gedraaid rendert.
///
/// Staat de pagina haaks op het vel dat de DC meldt (het stuurprogramma nam
/// een ander vel of een andere stand dan gevraagd), dan gaat het beeld een
/// kwartslag linksom (`draaiing_voor_vel`), zodat het het vel vult in plaats
/// van er ongedraaid op zo'n 70 % met witranden op te staan.
fn beeld_op_vel(doc: &PdfDocument<'static>, i: u32, apparaat_dpi: i32, vel: &DcVel) -> Result<Option<PaginaBeeld>, String> {
    let (pw, ph) = pdfium_renderer::page_size_pt(doc, i)?;
    let pagina = (pw as f64, ph as f64);
    let draaiing = draaiing_voor_vel(pagina, vel);
    // De pagina zoals ze op het vel ligt: gedraaid zijn breedte en hoogte gewisseld.
    let op_vel = if draaiing == 0 { pagina } else { (pagina.1, pagina.0) };
    if draaiing != 0 {
        log::info!("[print] pagina {} staat haaks op het vel; beeld een kwartslag gedraaid", i + 1);
    }
    let inhoud = match pdfium_renderer::page_content(doc, i) {
        Ok(inhoud) if !inhoud.gedraaid => Some(inhoud),
        Ok(_) => None,
        Err(e) => {
            log::warn!("[print] objecten van pagina {} onleesbaar: {e}; hele pagina", i + 1);
            None
        }
    };
    let Some(inhoud) = inhoud else {
        let schaal = (render_dpi(apparaat_dpi, None) / 72.0) as f32;
        let (w, h, rgba) = pdfium_renderer::render_page_to_rgba(doc, i, schaal, draaiing)?;
        return Ok(Some((w, h, rgba, deel_op_vel(op_vel, PaginaDeel::heel(op_vel), vel))));
    };
    let Some(deel) = inhoud_deel(&inhoud.objecten, inhoud.kader) else {
        return Ok(None);
    };
    let schaal = render_dpi(apparaat_dpi, fijnste_afbeelding_dpi(&inhoud.afbeelding_dpi)) / 72.0;
    let (w, h, rgba) = pdfium_renderer::render_page_part_for_print(
        doc,
        i,
        schaal as f32,
        deel.x as f32,
        deel.y as f32,
        deel.breedte as f32,
        deel.hoogte as f32,
    )?;
    // Het beeld dekt hele pixels, dus een fractie meer dan het deel.
    let gedekt = PaginaDeel { breedte: w as f64 / schaal, hoogte: h as f64 / schaal, ..deel };
    if draaiing == 0 {
        return Ok(Some((w, h, rgba, deel_op_vel(pagina, gedekt, vel))));
    }
    let (w, h, rgba) = draai_linksom(w, h, &rgba);
    Ok(Some((w, h, rgba, deel_op_vel(op_vel, deel_linksom(gedekt, pagina), vel))))
}

/// Noodweg als de driver geen DEVMODE geeft: een verder lege `DEVMODEW` voor
/// `ResetDCW`, zoals vóór issue 406 (alleen het publieke deel,
/// `dmDriverExtra` 0), met oriëntatie en, als bekend, het papier. Zonder
/// papier vullen drivers het papier met hun ingebouwde standaard aan.
pub fn nood_devmode(printer: &str, papiercode: Option<i16>, liggend: bool) -> DEVMODEW {
    // Veilig: DEVMODEW bestaat alleen uit gehele getallen; nullen is geldig.
    let mut dm: DEVMODEW = unsafe { std::mem::zeroed() };
    dm.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
    dm.dmFields = DM_ORIENTATION;
    dm.Anonymous1.Anonymous1.dmOrientation = (if liggend { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT }) as i16;
    if let Some(code) = papiercode {
        dm.dmFields |= DM_PAPERSIZE;
        dm.Anonymous1.Anonymous1.dmPaperSize = code;
    }
    let naam = breed(printer);
    let n = (naam.len() - 1).min(31);
    dm.dmDeviceName[..n].copy_from_slice(&naam[..n]);
    dm
}

/// Welke `DEVMODE` een pagina krijgt: de volledige van de driver, of de noodweg.
enum Stand<'a> {
    Volledig(&'a OpdrachtDevmodes),
    /// Papiercode voor de noodweg (gevraagd, of het vel dat de DC al had),
    /// en of het papier bij de eerste pagina nog gezet moet worden.
    Nood { papier: Option<i16>, eerst_zetten: bool },
}

/// Print het PDF-bestand `pad` op `printer`.
///
/// `plaatsing`: `Passend` (elke pagina passend in het bedrukbare gebied) of
/// `Vel` (de pagina is al op papiergrootte opgemaakt en gaat 1:1 op het
/// fysieke vel). `opgeslagen` is de in deze sessie in het eigenschappenvenster
/// gekozen DEVMODE voor deze printer (bytes), `uitvoer` een bestand om naar te
/// printen (`DOCINFOW.lpszOutput`; de app zelf geeft `None`).
pub fn print_pdf_bestand(
    pad: &Path,
    printer: &str,
    orientatie: Orientatie,
    papier: Papier,
    plaatsing: Plaatsing,
    opgeslagen: Option<&[u8]>,
    uitvoer: Option<&Path>,
) -> Result<(), String> {
    if !pad.is_file() {
        return Err("File does not exist".to_string());
    }
    // Geeft de driver geen bruikbare DEVMODE, dan de noodweg in plaats van
    // helemaal niet printen. Bestaat de printer niet, dan faalt CreateDCW.
    let devmodes = match OpdrachtDevmodes::maak(printer, opgeslagen, papier) {
        Ok(d) => Some(d),
        Err(e) => {
            log::warn!("[print] geen DEVMODE voor '{printer}': {e}; noodweg via ResetDC");
            None
        }
    };
    print_met_devmodes(pad, printer, orientatie, papier, plaatsing, devmodes.as_ref(), uitvoer)
}

/// De printkern. `devmodes` `None` = de noodweg: DC zonder DEVMODE, papier en
/// oriëntatie via `ResetDCW` met `nood_devmode`.
fn print_met_devmodes(
    pad: &Path,
    printer: &str,
    orientatie: Orientatie,
    papier: Papier,
    plaatsing: Plaatsing,
    devmodes: Option<&OpdrachtDevmodes>,
    uitvoer: Option<&Path>,
) -> Result<(), String> {
    if !pad.is_file() {
        return Err("File does not exist".to_string());
    }

    // Document via PDFium laden (geen doc-cache: printen is een koud pad en
    // het tijdelijke bestand verdwijnt kort hierna).
    let bytes = std::fs::read(pad).map_err(|e| format!("Read PDF: {e}"))?;
    let handle = pdfium_renderer::PdfiumDocumentHandle::load_from_bytes(Arc::new(bytes))?;
    let doc = handle.document();
    let page_count = doc.pages().len() as u32;
    if page_count == 0 {
        return Err("PDF has no pages".to_string());
    }

    // Oriëntatie per pagina uit de paginamaat, zonder te renderen: die van de
    // eerste pagina moet er al zijn voordat de DC bestaat.
    let liggend_voor = |i: u32| -> Result<bool, String> {
        let (w, h) = pdfium_renderer::page_size_pt(doc, i)?;
        Ok(liggend_voor_pagina(orientatie, w, h))
    };
    let eerste_liggend = liggend_voor(0)?;

    let printer_w = breed(printer);
    let begin_devmode = devmodes.map_or(std::ptr::null(), |d| d.voor(eerste_liggend).ptr());
    let hdc = unsafe { CreateDCW(std::ptr::null(), printer_w.as_ptr(), std::ptr::null(), begin_devmode) };
    if hdc.is_null() {
        return Err(format!("Cannot open printer '{printer}'"));
    }
    let _dc = Dc(hdc);

    // Stand van de DC. Noodweg: de DC staat zoals de driver hem gaf; welk vel
    // en welke kant dat is lezen we af, zodat een ResetDC voor de oriëntatie
    // het papier niet kwijtraakt.
    let (stand, mut dc_liggend) = match devmodes {
        Some(d) => (Stand::Volledig(d), eerste_liggend),
        None => {
            let (b, h) = vel_mm(hdc);
            let gevraagd = dmpaper(papier);
            let papier = gevraagd.or_else(|| papier_uit_maat_mm(b, h).and_then(dmpaper));
            (Stand::Nood { papier, eerst_zetten: gevraagd.is_some() }, b > h)
        }
    };

    let doc_name = breed(pad.file_name().and_then(|n| n.to_str()).unwrap_or("Document"));
    let uitvoer_w = uitvoer.map(|p| breed(&p.to_string_lossy()));
    let di = DOCINFOW {
        cbSize: std::mem::size_of::<DOCINFOW>() as i32,
        lpszDocName: doc_name.as_ptr(),
        lpszOutput: uitvoer_w.as_ref().map_or(std::ptr::null(), |w| w.as_ptr()),
        lpszDatatype: std::ptr::null(),
        fwType: 0,
    };
    if unsafe { StartDocW(hdc, &di) } <= 0 {
        return Err("StartDoc failed (print job rejected)".to_string());
    }
    let opdracht = Opdracht { hdc, open: true };

    // Renderen op de resolutie van het apparaat, hooguit 300 dpi (geheugen bij plotters).
    let dpi = unsafe { GetDeviceCaps(hdc, LOGPIXELSX as i32) }.max(96);
    let scale = (dpi.min(300) as f32) / 72.0;

    for i in 0..page_count {
        // Papier alleen omdraaien als deze pagina de andere kant op staat;
        // tussen pagina's, vóór StartPage. Noodweg: ook vóór de eerste pagina
        // als er een papier gevraagd is.
        let liggend = if i == 0 { eerste_liggend } else { liggend_voor(i)? };
        let reset = match &stand {
            Stand::Volledig(d) => (liggend != dc_liggend).then(|| unsafe { ResetDCW(hdc, d.voor(liggend).ptr()) }),
            Stand::Nood { papier: code, eerst_zetten } => (liggend != dc_liggend || (i == 0 && *eerst_zetten))
                .then(|| unsafe { ResetDCW(hdc, &nood_devmode(printer, *code, liggend)) }),
        };
        match reset {
            // De driver weigerde; de pagina gaat met de vorige stand mee in
            // plaats van de opdracht af te breken.
            Some(r) if r.is_null() => {
                log::warn!("[print] ResetDC geweigerd voor pagina {} ({:?}, {:?})", i + 1, orientatie, papier)
            }
            Some(_) => dc_liggend = liggend,
            None => {}
        }
        // Het vel na een eventuele ResetDC opnieuw lezen.
        let vel = dc_vel(hdc);

        let beeld = match plaatsing {
            Plaatsing::Passend => {
                // Staat de pagina haaks op het vel dat de DC meldt (het
                // stuurprogramma nam de stand niet over), dan een kwartslag
                // linksom, zodat het beeld het vel vult.
                let (pw, ph) = pdfium_renderer::page_size_pt(doc, i)?;
                let draaiing = draaiing_voor_vel((pw as f64, ph as f64), &vel);
                let (w, h, rgba) = pdfium_renderer::render_page_to_rgba(doc, i, scale, draaiing)
                    .map_err(|e| format!("Render page {} failed: {e}", i + 1))?;
                // Pagina passend in het printbare gebied, verhouding behouden, gecentreerd.
                let doel = passend_in_bedrukbaar((w, h), vel.bedrukbaar);
                Some((w, h, rgba, doel))
            }
            Plaatsing::Vel => {
                beeld_op_vel(doc, i, dpi, &vel).map_err(|e| format!("Render page {} failed: {e}", i + 1))?
            }
        };

        unsafe {
            if StartPage(hdc) <= 0 {
                return Err(format!("StartPage failed (page {})", i + 1));
            }
        }
        // Een leeg vel (plaatsing Vel zonder inhoud) krijgt alleen StartPage/EndPage.
        if let Some((w, h, mut rgba, doel)) = beeld {
            // RGBA -> BGRA (bytevolgorde van een GDI-DIB)
            for px in rgba.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            let mut bmi: BITMAPINFO = unsafe { std::mem::zeroed() };
            bmi.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32), // top-down DIB
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            };
            unsafe {
                SetStretchBltMode(hdc, HALFTONE);
                StretchDIBits(
                    hdc,
                    doel.x,
                    doel.y,
                    doel.breedte,
                    doel.hoogte,
                    0,
                    0,
                    w as i32,
                    h as i32,
                    rgba.as_ptr() as *const std::ffi::c_void,
                    &bmi,
                    DIB_RGB_COLORS,
                    SRCCOPY,
                );
            }
        }
        unsafe {
            if EndPage(hdc) <= 0 {
                return Err(format!("EndPage failed (page {})", i + 1));
            }
        }
    }

    opdracht.afgerond()
}

/// Proeven op echte printers. Allemaal `#[ignore]`: draai ze bewust met
/// `cargo test --lib print_windows -- --ignored --nocapture`.
///
/// Veiligheid: `papier_per_printer_zonder_opdracht` en
/// `grote_en_verlengde_vellen_zonder_opdracht` starten op GEEN enkele
/// printer een opdracht; ze openen DC's alleen om maten te lezen (CreateDC,
/// ResetDC, GetDeviceCaps, DeviceCapabilities, DocumentProperties zonder
/// venster). Alleen `eind_tot_eind_naar_pdf_bestand` en
/// `grote_en_verlengde_vellen_naar_pdf_bestand` printen, en uitsluitend op de
/// virtuele printer `PROEF_PRINTER` naar een bestand in `proefmap()` of
/// `proefmap_formaten()`.
#[cfg(test)]
mod proef {
    use super::*;
    use crate::print_devmode;
    use crate::print_plaatsing::Marges;
    use crate::print_devmode::{eigenschappen_kiezen, huidig_papier, papier_info, papierlijst};
    use crate::print_instelling::dmpaper;
    use std::path::PathBuf;
    use windows_sys::Win32::Graphics::Gdi::Rectangle;
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, GetPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W, PRINTER_INFO_4W,
    };

    /// De enige printer waarop een proef een opdracht mag starten, en alleen
    /// met een uitvoerbestand: de virtuele PDF-printer van de app.
    const PROEF_PRINTER: &str = "Open PDF Studio";
    const PROEF_DRIVER: &str = "Microsoft Print To PDF";

    fn proefmap() -> PathBuf {
        std::env::temp_dir().join("opds-406-probe")
    }

    fn pw_tekst(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut n = 0;
        unsafe {
            while *p.add(n) != 0 {
                n += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
        }
    }

    fn alle_printers() -> Vec<String> {
        let vlag = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (mut nodig, mut aantal) = (0u32, 0u32);
        unsafe {
            EnumPrintersW(vlag, std::ptr::null(), 4, std::ptr::null_mut(), 0, &mut nodig, &mut aantal);
            let mut buf = vec![0u64; (nodig as usize).div_ceil(8).max(1)];
            if EnumPrintersW(vlag, std::ptr::null(), 4, buf.as_mut_ptr() as *mut u8, nodig, &mut nodig, &mut aantal) == 0 {
                return Vec::new();
            }
            let info = std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_4W, aantal as usize);
            info.iter().map(|i| pw_tekst(i.pPrinterName)).collect()
        }
    }

    fn drivernaam(printer: &str) -> Option<String> {
        let prn = Printer::open(printer).ok()?;
        let h = prn.handle_voor_proef();
        let mut nodig = 0u32;
        unsafe {
            GetPrinterW(h, 2, std::ptr::null_mut(), 0, &mut nodig);
            let mut buf = vec![0u64; (nodig as usize).div_ceil(8).max(1)];
            if GetPrinterW(h, 2, buf.as_mut_ptr() as *mut u8, nodig, &mut nodig) == 0 {
                return None;
            }
            Some(pw_tekst((*(buf.as_ptr() as *const PRINTER_INFO_2W)).pDriverName))
        }
    }

    fn dc(printer: &str, dm: *const DEVMODEW) -> Option<Dc> {
        let naam = breed(printer);
        let hdc = unsafe { CreateDCW(std::ptr::null(), naam.as_ptr(), std::ptr::null(), dm) };
        (!hdc.is_null()).then_some(Dc(hdc))
    }

    /// De DEVMODE zoals main en v2.3.0 hem voor ResetDCW bouwden: alles nul,
    /// alleen het publieke deel, `dmDriverExtra` 0 (nu de noodweg).
    fn lege_devmode(printer: &str, papier: Option<i16>, liggend: bool) -> DEVMODEW {
        nood_devmode(printer, papier, liggend)
    }

    fn ruw(dm: &DEVMODEW) -> &[u8] {
        unsafe { std::slice::from_raw_parts(dm as *const DEVMODEW as *const u8, std::mem::size_of::<DEVMODEW>()) }
    }

    fn mm(m: Option<(f64, f64)>) -> String {
        m.map_or("-".to_string(), |(b, h)| format!("{b:6.1} x {h:6.1} mm"))
    }

    fn is_ongeveer(m: Option<(f64, f64)>, verwacht: (f64, f64), speling: f64) -> bool {
        m.is_some_and(|(b, h)| (b - verwacht.0).abs() <= speling && (h - verwacht.1).abs() <= speling)
    }

    /// (a) Per geïnstalleerde printer, zonder opdracht: het vel van de DC bij
    /// de standaard, de nieuwe weg (A3 staand/liggend), de weg van main en de
    /// v2.3.0-ResetDC bovenop een volledige A3-DEVMODE.
    #[test]
    #[ignore]
    fn papier_per_printer_zonder_opdracht() {
        let a3 = dmpaper(Papier::A3).unwrap();
        let mut fouten = Vec::new();
        for printer in alle_printers() {
            let begin = std::time::Instant::now();
            println!("\n=== {printer}  (driver: {})", drivernaam(&printer).unwrap_or_default());
            let standaard = match Printer::open(&printer).and_then(|p| p.standaard()) {
                Ok(dm) => dm,
                Err(e) => {
                    println!("  kan standaard niet lezen: {e}");
                    continue;
                }
            };
            let t = std::time::Instant::now();
            let voor_dialoog = huidig_papier(&printer, None);
            println!("  printer_papier: {voor_dialoog:?} ({} ms)", t.elapsed().as_millis());
            let lijst = papierlijst(&printer);
            let kent_a3 = lijst.iter().any(|s| s.code == a3);
            println!(
                "  driverstandaard: dmPaperSize={:?} liggend={} -> {:?}",
                standaard.papiercode(),
                standaard.liggend(),
                papier_info(&printer, &standaard)
            );
            println!(
                "  papierlijst: {} soorten, A3 (code 8) {}",
                lijst.len(),
                if kent_a3 { "aanwezig" } else { "ONTBREEKT" }
            );

            let s_standaard = dc(&printer, std::ptr::null()).map(|d| vel_mm(d.0));
            println!("  DC zonder DEVMODE (standaard)                        : {}", mm(s_standaard));

            // Nieuwe weg.
            let nieuw = match OpdrachtDevmodes::maak(&printer, None, Papier::A3) {
                Ok(n) => n,
                Err(e) => {
                    println!("  nieuwe DEVMODE mislukt: {e}");
                    fouten.push(format!("{printer}: nieuwe DEVMODE mislukt: {e}"));
                    continue;
                }
            };
            let s_nieuw_staand = dc(&printer, nieuw.voor(false).ptr()).map(|d| vel_mm(d.0));
            let s_nieuw_liggend = dc(&printer, nieuw.voor(true).ptr()).map(|d| vel_mm(d.0));
            let s_nieuw_omgedraaid = dc(&printer, nieuw.voor(false).ptr())
                .and_then(|d| (!unsafe { ResetDCW(d.0, nieuw.voor(true).ptr()) }.is_null()).then(|| vel_mm(d.0)));
            println!("  NIEUW  DC met volledige A3-DEVMODE, staand           : {}", mm(s_nieuw_staand));
            println!("  NIEUW  DC met volledige A3-DEVMODE, liggend          : {}", mm(s_nieuw_liggend));
            println!("  NIEUW  staand + ResetDC(volledig, liggend)           : {}", mm(s_nieuw_omgedraaid));

            // main: DC zonder DEVMODE, dan ResetDC met lege DEVMODEW (ORIENTATION|PAPERSIZE=A3).
            let s_main = |liggend: bool| {
                dc(&printer, std::ptr::null()).and_then(|d| {
                    let leeg = lege_devmode(&printer, Some(a3), liggend);
                    (!unsafe { ResetDCW(d.0, &leeg) }.is_null()).then(|| vel_mm(d.0))
                })
            };
            println!("  MAIN   DC zonder DEVMODE + ResetDC(leeg, A3, staand) : {}", mm(s_main(false)));
            println!("  MAIN   DC zonder DEVMODE + ResetDC(leeg, A3, liggend): {}", mm(s_main(true)));

            // v2.3.0 bovenop een volledige A3-DC: ResetDC met lege DEVMODEW, alleen ORIENTATION.
            let s_v230 = dc(&printer, nieuw.voor(false).ptr()).map(|d| {
                let voor = vel_mm(d.0);
                let leeg = lege_devmode(&printer, None, false);
                let na = (!unsafe { ResetDCW(d.0, &leeg) }.is_null()).then(|| vel_mm(d.0));
                (voor, na)
            });
            match s_v230 {
                Some((voor, na)) => println!(
                    "  V2.3.0 A3-DC {} + ResetDC(leeg, alleen ORIENTATION): {}",
                    mm(Some(voor)),
                    mm(na)
                ),
                None => println!("  V2.3.0 A3-DC kon niet worden gemaakt"),
            }

            // Wat de driver zelf maakt van zo'n lege DEVMODEW als invoer.
            if let (Ok(prn), Ok(leeg)) =
                (Printer::open(&printer), DevMode::uit_bytes(ruw(&lege_devmode(&printer, Some(a3), false))))
            {
                match prn.valideren(&leeg) {
                    Ok(v) => println!(
                        "  driver-validatie lege DEVMODEW(A3): dmPaperSize={:?} -> {:?}",
                        v.papiercode(),
                        papier_info(&printer, &v).map(|i| (i.papier, i.naam, i.breedte_mm, i.hoogte_mm))
                    ),
                    Err(e) => println!("  driver-validatie lege DEVMODEW(A3): {e}"),
                }
            }
            println!("  ({} ms)", begin.elapsed().as_millis());

            if kent_a3 {
                if !is_ongeveer(s_nieuw_staand, (297.0, 420.0), 3.0) {
                    fouten.push(format!("{printer}: nieuw A3 staand = {}", mm(s_nieuw_staand)));
                }
                if !is_ongeveer(s_nieuw_liggend, (420.0, 297.0), 3.0) {
                    fouten.push(format!("{printer}: nieuw A3 liggend = {}", mm(s_nieuw_liggend)));
                }
                if !is_ongeveer(s_nieuw_omgedraaid, (420.0, 297.0), 3.0) {
                    fouten.push(format!("{printer}: nieuw A3 omgedraaid = {}", mm(s_nieuw_omgedraaid)));
                }
            }
        }
        assert!(fouten.is_empty(), "nieuwe weg gaf geen A3:\n{}", fouten.join("\n"));
    }

    // ---- grote en verlengde vellen (A1, A0, A3L, A2L, A1L, A0L) ----
    //
    // Gemeten op "Microsoft Print to PDF" (Windows 11, build 26200): de driver
    // heeft een VASTE papierlijst (zijn PrintDeviceCapabilities kennen geen
    // CustomMediaSize). A1 en A0 staan erin als "ISOA1" en "ISOA0"; een eigen
    // maat in de DEVMODE (DMPAPER_USER met breedte en lengte, in elke variant)
    // negeert hij en hij geeft zijn standaardvel terug. De verlengde vellen
    // komen op deze driver dus op het papier van de printer uit, en de kop
    // van de printdialoog zegt dat. Op drivers die eigen maten of formulieren
    // van de printserver wel aannemen (plotters) komt het gevraagde vel eruit.

    /// De virtuele pdf-printers van de app: de huidige naam en die van oudere
    /// versies. Met de pdf-driver van Windows moeten A1 en A0 er exact uitkomen.
    const PDF_PRINTERS: [&str; 2] = ["Open PDF Studio", "Open PDF Printer"];

    /// Uitvoer van de proef met grote en verlengde vellen. Alleen hierin mag
    /// `grote_en_verlengde_vellen_naar_pdf_bestand` schrijven.
    fn proefmap_formaten() -> PathBuf {
        std::env::temp_dir().join("opds-printer-probe")
    }

    /// Vellen die de pdf-driver zelf aanbiedt: die moeten er exact uitkomen.
    const IN_DE_DRIVER: [(Papier, (f64, f64)); 2] = [(Papier::A1, (594.0, 841.0)), (Papier::A0, (841.0, 1189.0))];
    /// Vellen die alleen als eigen maat of formulier kunnen.
    const VERLENGD: [(Papier, (f64, f64)); 4] = [
        (Papier::A3L, (297.0, 630.0)),
        (Papier::A2L, (420.0, 804.0)),
        (Papier::A1L, (594.0, 1051.0)),
        (Papier::A0L, (841.0, 1399.0)),
    ];

    /// (d) Zonder opdracht, op elke geïnstalleerde printer: het vel van de DC
    /// voor elk groot of verlengd vel, staand, liggend en na ResetDC, naast
    /// wat de kop van de printdialoog zal melden (`papier_voor_opdracht`).
    ///
    /// - A1 en A0 op de pdf-printers van de app: exact het gevraagde vel.
    /// - Overal: het gevraagde vel als de driver het aanneemt, anders netjes
    ///   het papier van de printer; nooit iets daartussenin (een driver die
    ///   A1L afkapt op zijn grootste breedte telt als niet aangenomen).
    /// - Altijd: de kop meldt het vel dat de DC ook echt heeft.
    ///
    /// Er wordt alleen gelezen (DocumentProperties zonder venster,
    /// DeviceCapabilities, CreateIC/CreateDC, GetDeviceCaps): geen opdracht.
    #[test]
    #[ignore]
    fn grote_en_verlengde_vellen_zonder_opdracht() {
        use crate::print_devmode::papier_voor_opdracht;
        use crate::print_instelling::zelfde_maat_mm;
        let mut fouten = Vec::new();
        let mut gemeten = 0;
        for printer in alle_printers() {
            let printer = printer.as_str();
            let driver = drivernaam(printer).unwrap_or_default();
            let pdf_printer = PDF_PRINTERS.contains(&printer) && driver.eq_ignore_ascii_case(PROEF_DRIVER);
            if pdf_printer {
                gemeten += 1;
            }
            println!("\n=== {printer}  (driver: {driver})");
            let Some(standaard) = dc(printer, std::ptr::null()).map(|d| vel_mm(d.0)) else {
                println!("  geen DC; overgeslagen");
                continue;
            };
            println!("  DC zonder DEVMODE (papier van de printer): {}", mm(Some(standaard)));
            let lijst = papierlijst(printer);
            let alle = IN_DE_DRIVER.iter().map(|v| (*v, pdf_printer)).chain(VERLENGD.iter().map(|v| (*v, false)));
            for ((papier, verwacht), moet_exact) in alle {
                let in_lijst = lijst.iter().find(|s| {
                    zelfde_maat_mm(
                        (s.maat_tiende_mm.0 as f64 / 10.0, s.maat_tiende_mm.1 as f64 / 10.0),
                        verwacht,
                        1.0,
                    )
                });
                let dms = match OpdrachtDevmodes::maak(printer, None, papier) {
                    Ok(d) => d,
                    Err(e) => {
                        println!("  {:4} geen DEVMODE: {e}", papier.sleutel());
                        continue;
                    }
                };
                let staand = dc(printer, dms.voor(false).ptr()).map(|d| vel_mm(d.0));
                let liggend = dc(printer, dms.voor(true).ptr()).map(|d| vel_mm(d.0));
                let omgedraaid = dc(printer, dms.voor(false).ptr())
                    .and_then(|d| (!unsafe { ResetDCW(d.0, dms.voor(true).ptr()) }.is_null()).then(|| vel_mm(d.0)));
                let kop = papier_voor_opdracht(printer, None, papier);
                // Drivers ronden af op hun resolutie; 3 mm, net als het printpad zelf.
                let aangenomen = is_ongeveer(staand, verwacht, 3.0);
                println!(
                    "  {:4} {:24} {:9}: staand {} | liggend {} | ResetDC {} | kop {:?}",
                    papier.sleutel(),
                    match in_lijst {
                        Some(s) => format!("driver: code {} '{}'", s.code, s.naam),
                        None => "niet in de papierlijst".to_string(),
                    },
                    if aangenomen { "OK" } else { "TERUGVAL" },
                    mm(staand),
                    mm(liggend),
                    mm(omgedraaid),
                    kop.as_ref().map(|i| (i.papier, i.naam.as_str(), i.breedte_mm, i.hoogte_mm)),
                );
                // Het vel is het gevraagde, of precies het papier van de printer.
                let doel = if aangenomen { verwacht } else { standaard };
                if moet_exact && !aangenomen {
                    fouten.push(format!("{printer}: {} niet aangenomen: {}", papier.sleutel(), mm(staand)));
                }
                if !is_ongeveer(staand, doel, 3.0) {
                    fouten.push(format!("{printer}: {} staand = {}", papier.sleutel(), mm(staand)));
                }
                if !is_ongeveer(liggend, (doel.1, doel.0), 3.0) {
                    fouten.push(format!("{printer}: {} liggend = {}", papier.sleutel(), mm(liggend)));
                }
                if !is_ongeveer(omgedraaid, (doel.1, doel.0), 3.0) {
                    fouten.push(format!("{printer}: {} na ResetDC = {}", papier.sleutel(), mm(omgedraaid)));
                }
                // De kop meldt het vel dat de DC heeft, en bij een aangenomen vel ook de sleutel.
                match &kop {
                    Some(i) if zelfde_maat_mm((i.breedte_mm, i.hoogte_mm), doel, 3.0) => {
                        if aangenomen && i.papier != papier.sleutel() {
                            fouten.push(format!("{printer}: kop voor {} heet {}", papier.sleutel(), i.papier));
                        }
                        if !aangenomen && Some(i) != huidig_papier(printer, None).as_ref() {
                            fouten.push(format!("{printer}: kop voor {} is niet het papier van de printer", papier.sleutel()));
                        }
                    }
                    anders => fouten.push(format!("{printer}: kop voor {} = {anders:?}, DC = {}", papier.sleutel(), mm(staand))),
                }
            }
        }
        println!("\n{gemeten} pdf-printer(s) van de app gemeten");
        assert!(gemeten > 0, "geen van {PDF_PRINTERS:?} met driver '{PROEF_DRIVER}' gevonden");
        assert!(fouten.is_empty(), "afwijkende vellen:\n{}", fouten.join("\n"));
    }

    /// (g) Het bedrukbare gebied van elke geïnstalleerde printer, per vel en
    /// per oriëntatie, ZONDER opdracht: alleen `DocumentProperties` zonder
    /// venster en informatiecontexten (`CreateIC` + `GetDeviceCaps`). Er gaat
    /// niets naar een printer. Toont ook hoe lang het meten duurt, want de
    /// printdialoog vraagt het bij elke printer- en papierwissel.
    #[test]
    #[ignore]
    fn bedrukbaar_gebied_zonder_opdracht() {
        let vellen = [Papier::Printer, Papier::A4, Papier::A3, Papier::A1];
        let mut gemeten = 0;
        for printer in alle_printers() {
            println!("
=== {printer}  (driver: {})", drivernaam(&printer).unwrap_or_default());
            for papier in vellen {
                let t = std::time::Instant::now();
                let vel = print_devmode::papier_voor_opdracht(&printer, None, papier);
                let ms_vel = t.elapsed().as_millis();
                let t = std::time::Instant::now();
                let marges = bedrukbaar_voor_opdracht(&printer, None, papier);
                let ms = t.elapsed().as_millis();
                let beschrijf = |m: Option<&Marges>| match m {
                    Some(m) => format!(
                        "links {:5.1}  boven {:5.1}  rechts {:5.1}  onder {:5.1}",
                        m.links, m.boven, m.rechts, m.onder
                    ),
                    None => "onbekend".to_string(),
                };
                println!(
                    "  {:8} vel {:>21}  staand : {}  (vel {ms_vel} ms, gebied {ms} ms)",
                    papier.sleutel(),
                    vel.as_ref().map_or("-".to_string(), |v| format!("{:.1} x {:.1} mm", v.breedte_mm, v.hoogte_mm)),
                    beschrijf(marges.as_ref().map(|b| &b.staand)),
                );
                println!("  {:8} {:25}  liggend: {}", "", "", beschrijf(marges.as_ref().map(|b| &b.liggend)));
                if let (Some(vel), Some(b)) = (vel.as_ref(), marges.as_ref()) {
                    gemeten += 1;
                    // Het bedrukbare gebied ligt binnen het vel, in beide oriëntaties.
                    for (naam, m, (breedte, hoogte)) in [
                        ("staand", b.staand, (vel.breedte_mm, vel.hoogte_mm)),
                        ("liggend", b.liggend, (vel.hoogte_mm, vel.breedte_mm)),
                    ] {
                        assert!(
                            m.links >= 0.0 && m.boven >= 0.0 && m.rechts >= 0.0 && m.onder >= 0.0,
                            "{printer} {} {naam}: negatieve marge {m:?}",
                            papier.sleutel()
                        );
                        assert!(
                            m.links + m.rechts < breedte && m.boven + m.onder < hoogte,
                            "{printer} {} {naam}: marges groter dan het vel {m:?}",
                            papier.sleutel()
                        );
                    }
                }
            }
        }
        assert!(gemeten > 0, "geen enkele printer gaf een bedrukbaar gebied");
    }

    // ---- (b) eind-tot-eind naar een PDF-bestand ----

    fn init_pdfium() {
        let map = std::env::var("OPEN_PDF_STUDIO_TEST_DLL_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("win-x64"));
        pdfium_renderer::init_pdfium(&map).expect("init_pdfium");
    }

    /// Een PDF met één pagina per maat (in pt), met een rand en een diagonaal.
    fn maak_pdf(pad: &Path, maten: &[(i64, i64)]) {
        use lopdf::content::{Content, Operation};
        use lopdf::{dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut kids: Vec<Object> = Vec::new();
        for &(w, h) in maten {
            let inhoud = Content {
                operations: vec![
                    Operation::new("w", vec![4.into()]),
                    Operation::new("re", vec![20.into(), 20.into(), (w - 40).into(), (h - 40).into()]),
                    Operation::new("S", vec![]),
                    Operation::new("m", vec![20.into(), 20.into()]),
                    Operation::new("l", vec![(w - 20).into(), (h - 20).into()]),
                    Operation::new("S", vec![]),
                ],
            };
            let inhoud_id = doc.add_object(Stream::new(dictionary! {}, inhoud.encode().unwrap()));
            let pagina = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "Contents" => inhoud_id,
                "MediaBox" => vec![0.into(), 0.into(), w.into(), h.into()],
            });
            kids.push(pagina.into());
        }
        let aantal = kids.len() as i64;
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => aantal }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        doc.save(pad).expect("proef-PDF opslaan");
    }

    /// Paginamaten (pt) van een PDF, met overgeërfde MediaBox en /Rotate verwerkt.
    fn paginamaten(pad: &Path) -> Option<Vec<(f64, f64)>> {
        let doc = lopdf::Document::load(pad).ok()?;
        let mut maten = Vec::new();
        for (_, id) in doc.get_pages() {
            let mut dict = doc.get_dictionary(id).ok()?;
            let (mut kader, mut draai) = (None, None);
            loop {
                if kader.is_none() {
                    if let Ok(o) = dict.get(b"MediaBox") {
                        let (_, o) = doc.dereference(o).ok()?;
                        let getallen = o.as_array().ok()?.iter().map(|v| v.as_float().unwrap_or(0.0) as f64);
                        kader = Some(getallen.collect::<Vec<_>>());
                    }
                }
                if draai.is_none() {
                    if let Ok(o) = dict.get(b"Rotate") {
                        draai = o.as_i64().ok();
                    }
                }
                match dict.get(b"Parent").and_then(|p| p.as_reference()) {
                    Ok(ouder) => dict = doc.get_dictionary(ouder).ok()?,
                    Err(_) => break,
                }
            }
            let k = kader?;
            if k.len() < 4 {
                return None;
            }
            let (b, h) = ((k[2] - k[0]).abs(), (k[3] - k[1]).abs());
            maten.push(if draai.unwrap_or(0).rem_euclid(180) == 90 { (h, b) } else { (b, h) });
        }
        Some(maten)
    }

    /// Wacht tot de spooler het uitvoerbestand volledig heeft geschreven.
    fn wacht_op_pdf(pad: &Path) -> Vec<(f64, f64)> {
        let begin = std::time::Instant::now();
        while begin.elapsed() < std::time::Duration::from_secs(90) {
            if let Some(m) = paginamaten(pad).filter(|m| !m.is_empty()) {
                return m;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        panic!("geen leesbare uitvoer in {}", pad.display());
    }

    fn uitvoerpad(naam: &str) -> PathBuf {
        let pad = proefmap().join(naam);
        assert!(pad.starts_with(proefmap()));
        let _ = std::fs::remove_file(&pad);
        pad
    }

    /// Een opdracht op de oude manier (main of v2.3.0) met één pagina met een
    /// rechthoek, naar een bestand op de proefprinter.
    fn print_oude_weg(uitvoer: &Path, dc_devmode: *const DEVMODEW, reset: Option<&DEVMODEW>) {
        assert!(uitvoer.starts_with(proefmap()));
        let d = dc(PROEF_PRINTER, dc_devmode).expect("DC");
        let doc_name = breed("oude-weg");
        let uit = breed(&uitvoer.to_string_lossy());
        let di = DOCINFOW {
            cbSize: std::mem::size_of::<DOCINFOW>() as i32,
            lpszDocName: doc_name.as_ptr(),
            lpszOutput: uit.as_ptr(),
            lpszDatatype: std::ptr::null(),
            fwType: 0,
        };
        unsafe {
            assert!(StartDocW(d.0, &di) > 0, "StartDoc");
            if let Some(reset) = reset {
                let gelukt = !ResetDCW(d.0, reset).is_null();
                println!("    ResetDC tijdens opdracht: {}", if gelukt { "geaccepteerd" } else { "GEWEIGERD" });
            }
            assert!(StartPage(d.0) > 0);
            Rectangle(d.0, 100, 100, 1000, 1000);
            assert!(EndPage(d.0) > 0);
            assert!(EndDoc(d.0) > 0);
        }
    }

    fn pt(m: (f64, f64)) -> String {
        format!("{:7.1} x {:7.1} pt", m.0, m.1)
    }

    fn ongeveer_pt(m: (f64, f64), verwacht: (f64, f64)) -> bool {
        (m.0 - verwacht.0).abs() <= 3.0 && (m.1 - verwacht.1).abs() <= 3.0
    }

    /// (b) Eind-tot-eind op de virtuele PDF-printer, met uitvoerbestand.
    #[test]
    #[ignore]
    fn eind_tot_eind_naar_pdf_bestand() {
        // Veiligheid: alleen de virtuele PDF-printer, anders niets printen.
        let driver = drivernaam(PROEF_PRINTER).unwrap_or_default();
        assert!(
            driver.eq_ignore_ascii_case(PROEF_DRIVER),
            "'{PROEF_PRINTER}' ontbreekt of heeft driver '{driver}'; er wordt niets geprint"
        );
        init_pdfium();
        std::fs::create_dir_all(proefmap()).unwrap();
        let a4_staand = proefmap().join("bron-a4-staand.pdf");
        let a4_liggend = proefmap().join("bron-a4-liggend.pdf");
        let gemengd = proefmap().join("bron-gemengd.pdf");
        maak_pdf(&a4_staand, &[(595, 842)]);
        maak_pdf(&a4_liggend, &[(842, 595)]);
        maak_pdf(&gemengd, &[(595, 842), (842, 595), (842, 595), (595, 842)]);

        const A3_STAAND: (f64, f64) = (841.9, 1190.6);
        const A3_LIGGEND: (f64, f64) = (1190.6, 841.9);
        let mut fouten = Vec::new();
        let mut controleer = |naam: &str, maten: &[(f64, f64)], verwacht: &[(f64, f64)]| {
            let ok = maten.len() == verwacht.len() && maten.iter().zip(verwacht).all(|(m, v)| ongeveer_pt(*m, *v));
            println!(
                "  {naam}: {}  (verwacht {}) {}",
                maten.iter().map(|m| pt(*m)).collect::<Vec<_>>().join(", "),
                verwacht.iter().map(|m| pt(*m)).collect::<Vec<_>>().join(", "),
                if ok { "OK" } else { "FOUT" }
            );
            if !ok {
                fouten.push(naam.to_string());
            }
        };
        let nieuw = |naam: &str, bron: &Path, orientatie: Orientatie, papier: Papier, opgeslagen: Option<&[u8]>| {
            let uit = uitvoerpad(naam);
            print_pdf_bestand(bron, PROEF_PRINTER, orientatie, papier, Plaatsing::Passend, opgeslagen, Some(&uit)).expect("printen");
            wacht_op_pdf(&uit)
        };

        println!("\nNIEUWE WEG (print_pdf_bestand) naar {}", proefmap().display());
        controleer(
            "A4 staand, auto, papier a3        ",
            &nieuw("nieuw-a4-staand-a3.pdf", &a4_staand, Orientatie::Auto, Papier::A3, None),
            &[A3_STAAND],
        );
        controleer(
            "A4 liggend, auto, papier a3       ",
            &nieuw("nieuw-a4-liggend-a3.pdf", &a4_liggend, Orientatie::Auto, Papier::A3, None),
            &[A3_LIGGEND],
        );
        controleer(
            "gemengd (s,l,l,s), auto, papier a3",
            &nieuw("nieuw-gemengd-a3.pdf", &gemengd, Orientatie::Auto, Papier::A3, None),
            &[A3_STAAND, A3_LIGGEND, A3_LIGGEND, A3_STAAND],
        );
        let standaard = huidig_papier(PROEF_PRINTER, None).expect("standaardpapier");
        println!("  driverstandaard volgens printer_papier: {standaard:?}");
        let standaard_pt = (standaard.breedte_mm * 72.0 / 25.4, standaard.hoogte_mm * 72.0 / 25.4);
        controleer(
            "A4 staand, auto, papier printer   ",
            &nieuw("nieuw-a4-staand-printer.pdf", &a4_staand, Orientatie::Auto, Papier::Printer, None),
            &[standaard_pt],
        );
        // Wat het eigenschappenvenster bij OK teruggeeft, nagebootst: een
        // volledige DEVMODE van de driver met A3. Papier "printer" volgt die.
        let sessie = {
            let prn = Printer::open(PROEF_PRINTER).unwrap();
            let mut dm = prn.standaard().unwrap();
            dm.zet_papier(dmpaper(Papier::A3).unwrap());
            prn.valideren(&dm).unwrap()
        };
        println!("  sessie-DEVMODE volgens printer_papier: {:?}", huidig_papier(PROEF_PRINTER, Some(&sessie.bytes())));
        controleer(
            "A4 staand, papier printer + sessie-DEVMODE A3",
            &nieuw("nieuw-a4-staand-sessie-a3.pdf", &a4_staand, Orientatie::Auto, Papier::Printer, Some(&sessie.bytes())),
            &[A3_STAAND],
        );
        // Zelfde vel in de sessie en in de Pagina-instelling: het vel uit de
        // eigenschappen blijft staan en de uitkomst is A3.
        controleer(
            "A4 staand, papier a3 + sessie-DEVMODE A3",
            &nieuw("nieuw-a4-staand-sessie-a3-a3.pdf", &a4_staand, Orientatie::Auto, Papier::A3, Some(&sessie.bytes())),
            &[A3_STAAND],
        );
        // Andere keuze in de Pagina-instelling wint van de sessie.
        const A4_STAAND: (f64, f64) = (595.3, 841.9);
        controleer(
            "A4 staand, papier a4 + sessie-DEVMODE A3",
            &nieuw("nieuw-a4-staand-sessie-a3-a4.pdf", &a4_staand, Orientatie::Auto, Papier::A4, Some(&sessie.bytes())),
            &[A4_STAAND],
        );
        // Exemplaren uit de eigenschappen: de driver houdt dmCopies=2 vast,
        // maar een opdracht geeft er één (de app maakt kopieën zelf).
        let twee = {
            let prn = Printer::open(PROEF_PRINTER).unwrap();
            let mut dm = sessie.clone();
            dm.zet_exemplaren_voor_proef(2);
            prn.valideren(&dm).unwrap()
        };
        assert_eq!(twee.exemplaren(), Some(2), "de driver hield dmCopies=2 niet vast; proef zegt niets");
        controleer(
            "A4 staand, papier printer + sessie-DEVMODE met 2 exemplaren",
            &nieuw("nieuw-sessie-2-exemplaren.pdf", &a4_staand, Orientatie::Auto, Papier::Printer, Some(&twee.bytes())),
            &[A3_STAAND],
        );

        // Noodweg: een driver die geen DEVMODE geeft, nagebootst door de kern
        // zonder DEVMODE's aan te roepen (DC zonder DEVMODE + ResetDC).
        println!("\nNOODWEG (print_met_devmodes zonder DEVMODE) naar {}", proefmap().display());
        let nood = |naam: &str, bron: &Path, orientatie: Orientatie, papier: Papier| {
            let uit = uitvoerpad(naam);
            print_met_devmodes(bron, PROEF_PRINTER, orientatie, papier, Plaatsing::Passend, None, Some(&uit)).expect("printen");
            wacht_op_pdf(&uit)
        };
        controleer(
            "noodweg: A4 staand, liggend, papier a3",
            &nood("nood-a4-staand-liggend-a3.pdf", &a4_staand, Orientatie::Liggend, Papier::A3),
            &[A3_LIGGEND],
        );
        controleer(
            "noodweg: gemengd (s,l,l,s), auto, papier a3",
            &nood("nood-gemengd-a3.pdf", &gemengd, Orientatie::Auto, Papier::A3),
            &[A3_STAAND, A3_LIGGEND, A3_LIGGEND, A3_STAAND],
        );
        let standaard_liggend_pt = (standaard_pt.1, standaard_pt.0);
        controleer(
            "noodweg: gemengd (s,l,l,s), auto, papier printer",
            &nood("nood-gemengd-printer.pdf", &gemengd, Orientatie::Auto, Papier::Printer),
            &[standaard_pt, standaard_liggend_pt, standaard_liggend_pt, standaard_pt],
        );

        // Ter vergelijking de oude wegen: zelfde printer, zelfde soort opdracht.
        println!("\nOUDE WEGEN (ter vergelijking, niet getoetst)");
        let a3 = dmpaper(Papier::A3).unwrap();
        let uit = uitvoerpad("main-a3-staand.pdf");
        println!("  MAIN: DC zonder DEVMODE, ResetDC(lege DEVMODEW, ORIENTATION|PAPERSIZE=A3, staand)");
        print_oude_weg(&uit, std::ptr::null(), Some(&lege_devmode(PROEF_PRINTER, Some(a3), false)));
        println!("    -> {}", pt(wacht_op_pdf(&uit)[0]));
        let a3_dc = OpdrachtDevmodes::maak(PROEF_PRINTER, None, Papier::A3).unwrap();
        let uit = uitvoerpad("v230-op-a3-dc.pdf");
        println!("  V2.3.0: DC met volledige A3-DEVMODE, ResetDC(lege DEVMODEW, alleen ORIENTATION, staand)");
        print_oude_weg(&uit, a3_dc.voor(false).ptr(), Some(&lege_devmode(PROEF_PRINTER, None, false)));
        println!("    -> {}", pt(wacht_op_pdf(&uit)[0]));
        // Wat een DEVMODE met 2 exemplaren zonder de correctie oplevert (één
        // getekende pagina): laat zien dat de exemplarenproef hierboven iets zegt.
        let uit = uitvoerpad("zonder-correctie-2-exemplaren.pdf");
        println!("  DEVMODE met dmCopies=2 ongewijzigd naar CreateDC, één pagina getekend");
        print_oude_weg(&uit, twee.ptr(), None);
        println!("    -> {} pagina('s)", wacht_op_pdf(&uit).len());

        assert!(fouten.is_empty(), "afwijkende paginamaten: {fouten:?}");
    }

    /// (e) Eind-tot-eind met grote en verlengde vellen, vanaf een A4-pagina:
    /// A1 liggend en A0 staand moeten er exact uitkomen; A3L staand en A1L
    /// liggend komen eruit op het vel dat de kop van de printdialoog belooft
    /// (`papier_voor_opdracht`): het gevraagde vel als de driver het aanneemt,
    /// anders het papier van de printer. Alleen op de virtuele pdf-printer
    /// `PROEF_PRINTER`, en alleen naar een bestand in `proefmap_formaten()`.
    #[test]
    #[ignore]
    fn grote_en_verlengde_vellen_naar_pdf_bestand() {
        use crate::print_devmode::papier_voor_opdracht;
        let driver = drivernaam(PROEF_PRINTER).unwrap_or_default();
        assert!(
            driver.eq_ignore_ascii_case(PROEF_DRIVER),
            "'{PROEF_PRINTER}' ontbreekt of heeft driver '{driver}'; er wordt niets geprint"
        );
        init_pdfium();
        let map = proefmap_formaten();
        std::fs::create_dir_all(&map).unwrap();
        let bron = map.join("bron-a4-staand.pdf");
        maak_pdf(&bron, &[(595, 842)]);

        let mm_naar_pt = |mm: f64| mm * 72.0 / 25.4;
        // (bestand, oriëntatie, papier, gevraagd vel staand in mm, moet exact)
        let gevallen = [
            ("a1-liggend.pdf", Orientatie::Liggend, Papier::A1, (594.0, 841.0), true),
            ("a0-staand.pdf", Orientatie::Staand, Papier::A0, (841.0, 1189.0), true),
            ("a3l-staand.pdf", Orientatie::Staand, Papier::A3L, (297.0, 630.0), false),
            ("a1l-liggend.pdf", Orientatie::Liggend, Papier::A1L, (594.0, 1051.0), false),
        ];
        let mut fouten = Vec::new();
        for (naam, orientatie, papier, gevraagd, moet_exact) in gevallen {
            let uit = map.join(naam);
            // Veiligheid: uitsluitend naar een bestand direct in de proefmap.
            assert!(uit.parent() == Some(map.as_path()));
            let _ = std::fs::remove_file(&uit);
            let kop = papier_voor_opdracht(PROEF_PRINTER, None, papier).expect("kop");
            print_pdf_bestand(&bron, PROEF_PRINTER, orientatie, papier, Plaatsing::Passend, None, Some(&uit)).expect("printen");
            let maten = wacht_op_pdf(&uit);
            let liggend = orientatie == Orientatie::Liggend;
            let in_pt = |(b, h): (f64, f64)| {
                let (b, h) = (mm_naar_pt(b), mm_naar_pt(h));
                if liggend { (h, b) } else { (b, h) }
            };
            let beloofd = in_pt((kop.breedte_mm, kop.hoogte_mm));
            let aangenomen = kop.papier == papier.sleutel();
            let ok = maten.len() == 1
                && ongeveer_pt(maten[0], beloofd)
                && (!moet_exact || (aangenomen && ongeveer_pt(maten[0], in_pt(gevraagd))));
            println!(
                "  {:4} {:8} -> {}: {}  (gevraagd {}, kop belooft {} = {}) {}",
                papier.sleutel(),
                if liggend { "liggend" } else { "staand" },
                naam,
                maten.iter().map(|m| pt(*m)).collect::<Vec<_>>().join(", "),
                pt(in_pt(gevraagd)),
                kop.papier,
                pt(beloofd),
                match (ok, aangenomen) {
                    (true, true) => "OK",
                    (true, false) => "OK (terugval op het papier van de printer)",
                    _ => "FOUT",
                }
            );
            if !ok {
                fouten.push(naam);
            }
        }
        assert!(fouten.is_empty(), "afwijkende paginamaten: {fouten:?}");
    }

    /// Uitvoer van de schaalproef. Alleen hierin mag
    /// `schaal_op_vel_naar_pdf_bestand` lezen en schrijven.
    fn proefmap_schaal() -> PathBuf {
        std::env::temp_dir().join("opds-printschaal-probe")
    }

    /// (f) De schaal uit de printdialoog, eind-tot-eind: de tijdelijke
    /// print-PDF's die `scripts/print-schaal-proef.mjs` bouwt zoals
    /// runPrintJob dat doet (A4 op A3 bij werkelijke grootte, 50 %, 10 %,
    /// passend, ...), met hun plaatsing en papier (`proef.json`, standaard
    /// A3) naar een bestand in `proefmap_schaal()`. Meten:
    /// `scripts/meet-print-schaal-proef.py`. Alleen op de virtuele
    /// pdf-printer `PROEF_PRINTER`.
    #[test]
    #[ignore]
    fn schaal_op_vel_naar_pdf_bestand() {
        let driver = drivernaam(PROEF_PRINTER).unwrap_or_default();
        assert!(
            driver.eq_ignore_ascii_case(PROEF_DRIVER),
            "'{PROEF_PRINTER}' ontbreekt of heeft driver '{driver}'; er wordt niets geprint"
        );
        init_pdfium();
        let map = proefmap_schaal();
        let lijst = std::fs::read_to_string(map.join("proef.json"))
            .expect("proef.json ontbreekt: draai eerst node scripts/print-schaal-proef.mjs");
        let gevallen: Vec<serde_json::Value> = serde_json::from_str(&lijst).expect("proef.json");
        assert!(!gevallen.is_empty());
        println!("\nSCHAAL OP HET VEL naar {}", map.display());
        for geval in gevallen {
            let naam = geval["naam"].as_str().expect("naam");
            let bron = map.join(geval["bron"].as_str().expect("bron"));
            let plaatsing = Plaatsing::uit_keuze(geval["plaatsing"].as_str());
            // Het papier waarvoor de bron is opgemaakt; zonder opgave A3.
            let papier = Papier::uit_keuze(Some(geval["papier"].as_str().unwrap_or("a3")));
            let uit = map.join(format!("uit-{naam}.pdf"));
            // Veiligheid: uitsluitend uit en naar bestanden direct in de proefmap.
            assert!(uit.parent() == Some(map.as_path()) && bron.parent() == Some(map.as_path()), "{naam}");
            let _ = std::fs::remove_file(&uit);
            print_pdf_bestand(&bron, PROEF_PRINTER, Orientatie::Auto, papier, plaatsing, None, Some(&uit))
                .expect("printen");
            let maten = wacht_op_pdf(&uit);
            println!(
                "  {naam:28} {plaatsing:?} op {}: {}",
                papier.sleutel(),
                maten.iter().map(|m| pt(*m)).collect::<Vec<_>>().join(", ")
            );
        }
    }

    /// Drukt in een eigen dialoogvenster van DIT testproces op `knop` (IDOK of
    /// IDCANCEL) zodra het zichtbaar is. Raakt geen vensters van andere processen.
    fn druk_knop_in_eigen_dialoog(knop: i32) -> std::thread::JoinHandle<bool> {
        use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_COMMAND,
        };
        unsafe extern "system" fn zoek(hwnd: HWND, gevonden: LPARAM) -> BOOL {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != std::process::id() || IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let mut klasse = [0u16; 64];
            let n = GetClassNameW(hwnd, klasse.as_mut_ptr(), 64).max(0) as usize;
            if String::from_utf16_lossy(&klasse[..n]) == "#32770" {
                *(gevonden as *mut usize) = hwnd as usize;
                return 0;
            }
            1
        }
        std::thread::spawn(move || {
            let begin = std::time::Instant::now();
            while begin.elapsed() < std::time::Duration::from_secs(20) {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let mut gevonden = 0usize;
                unsafe {
                    EnumWindows(Some(zoek), &mut gevonden as *mut usize as LPARAM);
                    if gevonden != 0 {
                        // Even wachten tot het venster klaar is met opbouwen.
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        PostMessageW(gevonden as HWND, WM_COMMAND, knop as usize, 0);
                        return true;
                    }
                }
            }
            false
        })
    }

    /// (c) Het eigenschappenvenster wacht op de gebruiker, is vooringevuld met
    /// de bewaarde DEVMODE en geeft bij OK de gekozen DEVMODE terug, bij
    /// Annuleren niets. Alleen op de virtuele PDF-printer; de knoppen worden
    /// door de proef zelf ingedrukt.
    #[test]
    #[ignore]
    fn eigenschappenvenster_ok_en_annuleren() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IDCANCEL, IDOK};
        let driver = drivernaam(PROEF_PRINTER).unwrap_or_default();
        assert!(driver.eq_ignore_ascii_case(PROEF_DRIVER), "'{PROEF_PRINTER}' ontbreekt of heeft driver '{driver}'");
        let prn = Printer::open(PROEF_PRINTER).unwrap();
        let standaard = prn.standaard().unwrap();
        let a3 = {
            let mut dm = standaard.clone();
            dm.zet_papier(dmpaper(Papier::A3).unwrap());
            dm.zet_liggend(true);
            prn.valideren(&dm).unwrap()
        };

        let knop = druk_knop_in_eigen_dialoog(IDOK);
        let begin = std::time::Instant::now();
        let ok = prn.eigenschappen_venster(0, Some(&a3)).expect("venster");
        let duur = begin.elapsed();
        assert!(knop.join().unwrap(), "OK-knop niet gevonden");
        let ok = ok.expect("OK moet een DEVMODE geven");
        let info = papier_info(PROEF_PRINTER, &ok);
        println!("OK na {} ms, vooringevuld A3 liggend -> {:?}", duur.as_millis(), info);
        assert!(duur >= std::time::Duration::from_millis(500), "venster wachtte niet op de gebruiker");
        assert_eq!(info.as_ref().map(|i| (i.papier, i.orientatie)), Some(("a3", "landscape")));
        assert!(ok.bytes().len() > std::mem::size_of::<DEVMODEW>(), "driverdeel ontbreekt");

        let knop = druk_knop_in_eigen_dialoog(IDCANCEL);
        let geannuleerd = prn.eigenschappen_venster(0, Some(&a3)).expect("venster");
        assert!(knop.join().unwrap(), "Annuleren-knop niet gevonden");
        println!("Annuleren -> {:?}", geannuleerd.as_ref().map(|d| papier_info(PROEF_PRINTER, d)));
        assert!(geannuleerd.is_none());

        // Via eigenschappen_kiezen, zoals open_printer_properties het doet.
        drop(prn);
        let a4_staand = {
            let prn = Printer::open(PROEF_PRINTER).unwrap();
            let mut dm = standaard.clone();
            dm.zet_papier(dmpaper(Papier::A4).unwrap());
            dm.zet_liggend(false);
            prn.valideren(&dm).unwrap()
        };
        let kiezen = |knop: i32, opgeslagen: Option<&[u8]>, papier: Papier, orientatie: Orientatie| {
            let druk = druk_knop_in_eigen_dialoog(knop);
            let uit = eigenschappen_kiezen(PROEF_PRINTER, 0, opgeslagen, papier, orientatie).expect("venster");
            assert!(druk.join().unwrap(), "knop niet gevonden");
            uit
        };
        // 1. Geen sessie, Pagina-instelling A3 liggend: het venster opent op
        //    A3 liggend (niet op de A4 van de driver); OK zonder wijziging.
        let (bytes, keuze) = kiezen(IDOK, None, Papier::A3, Orientatie::Liggend).expect("OK");
        println!("geen sessie, vooraf a3 liggend, OK -> {keuze:?}");
        assert_eq!((keuze.info.papier, keuze.info.orientatie), ("a3", "landscape"));
        assert!(!keuze.papier_gewijzigd && !keuze.orientatie_gewijzigd, "OK zonder wijziging telde als wijziging");
        let bewaard = DevMode::uit_bytes(&bytes).unwrap();
        assert_eq!(papier_info(PROEF_PRINTER, &bewaard).map(|i| (i.papier, i.orientatie)), Some(("a3", "landscape")));
        // 2. Sessie A4 staand (eerder gekozen), Pagina-instelling nu A3: vooringevuld A3.
        let (_, keuze) = kiezen(IDOK, Some(&a4_staand.bytes()), Papier::A3, Orientatie::Auto).expect("OK");
        println!("sessie a4 staand, vooraf a3 auto, OK -> {keuze:?}");
        assert_eq!((keuze.info.papier, keuze.info.orientatie), ("a3", "portrait"));
        assert!(!keuze.papier_gewijzigd && !keuze.orientatie_gewijzigd);
        // 3. Papier "printer": het vel uit de sessie blijft (A3 liggend).
        let (_, keuze) = kiezen(IDOK, Some(&a3.bytes()), Papier::Printer, Orientatie::Auto).expect("OK");
        println!("sessie a3 liggend, vooraf printer auto, OK -> {keuze:?}");
        assert_eq!((keuze.info.papier, keuze.info.orientatie), ("a3", "landscape"));
        assert!(!keuze.papier_gewijzigd && !keuze.orientatie_gewijzigd);
        // 4. Annuleren: niets.
        assert!(kiezen(IDCANCEL, Some(&a3.bytes()), Papier::A4, Orientatie::Staand).is_none());

        // Niets aan de standaard van de printer veranderd.
        let na = Printer::open(PROEF_PRINTER).unwrap().standaard().unwrap();
        assert_eq!(na.papiercode(), standaard.papiercode());
        assert_eq!(na.liggend(), standaard.liggend());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nooddevmode_heeft_papier_en_orientatie() {
        let dm = nood_devmode("Een printer", Some(8), true);
        assert_eq!(dm.dmSize as usize, std::mem::size_of::<DEVMODEW>());
        assert_eq!(dm.dmDriverExtra, 0);
        assert_eq!(dm.dmFields, DM_ORIENTATION | DM_PAPERSIZE);
        let v = unsafe { dm.Anonymous1.Anonymous1 };
        assert_eq!(v.dmPaperSize, 8);
        assert_eq!(v.dmOrientation, DMORIENT_LANDSCAPE as i16);
        assert_eq!(String::from_utf16_lossy(&dm.dmDeviceName[..11]), "Een printer");
        assert_eq!(dm.dmDeviceName[11], 0);
    }

    #[test]
    fn nooddevmode_zonder_papier_alleen_orientatie() {
        let dm = nood_devmode("P", None, false);
        assert_eq!(dm.dmFields, DM_ORIENTATION);
        assert_eq!(unsafe { dm.Anonymous1.Anonymous1.dmOrientation }, DMORIENT_PORTRAIT as i16);
    }

    #[test]
    fn nooddevmode_kapt_lange_printernaam_af_met_afsluitende_nul() {
        let naam = "x".repeat(80);
        let dm = nood_devmode(&naam, Some(9), false);
        assert!(dm.dmDeviceName[..31].iter().all(|&c| c == 'x' as u16));
        assert_eq!(dm.dmDeviceName[31], 0);
    }

    /// Een PDF (bytes) met één pagina van `maat` pt en een zwart vlak
    /// `(x, y, breedte, hoogte)` in pt vanaf de linkerbovenhoek van de pagina.
    fn pdf_met_vlak(maat: (f32, f32), vlak: (f32, f32, f32, f32)) -> Vec<u8> {
        use lopdf::content::{Content, Operation};
        use lopdf::{dictionary, Document, Object, Stream};
        let (w, h) = maat;
        let (x, y, b, hoogte) = vlak;
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let inhoud = Content {
            operations: vec![
                Operation::new("g", vec![Object::Real(0.0)]),
                Operation::new(
                    "re",
                    vec![Object::Real(x), Object::Real(h - y - hoogte), Object::Real(b), Object::Real(hoogte)],
                ),
                Operation::new("f", vec![]),
            ],
        };
        let inhoud_id = doc.add_object(Stream::new(dictionary! {}, inhoud.encode().unwrap()));
        let pagina = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => inhoud_id,
            "MediaBox" => vec![Object::Real(0.0), Object::Real(0.0), Object::Real(w), Object::Real(h)],
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![pagina.into()], "Count" => 1 }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).expect("proef-PDF");
        bytes
    }

    /// Omhullende (x0, y0, x1, y1) van de donkere pixels van een RGBA-beeld.
    fn donker_kader(breedte: u32, rgba: &[u8]) -> Option<(u32, u32, u32, u32)> {
        let mut kader: Option<(u32, u32, u32, u32)> = None;
        for (i, px) in rgba.chunks_exact(4).enumerate() {
            if px[0] < 128 && px[1] < 128 && px[2] < 128 {
                let (x, y) = (i as u32 % breedte, i as u32 / breedte);
                kader = Some(match kader {
                    None => (x, y, x, y),
                    Some((a, b, c, d)) => (a.min(x), b.min(y), c.max(x), d.max(y)),
                });
            }
        }
        kader
    }

    /// Plaatsing Vel rendert een deel van de pagina exact op maat, ook op
    /// pagina's met gebroken puntmaten (A3 = 841,89 x 1190,55 pt, en een brede
    /// pagina waar een afgeronde of afgekapte paginamaat twee pixels zou
    /// schelen), en leest de inhoud van de pagina zonder te renderen. Heeft de
    /// PDFium-bibliotheek uit binaries/win-x64 nodig; zonder die bibliotheek
    /// overgeslagen.
    #[test]
    fn deel_voor_de_printer_exact_op_maat() {
        let map = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("win-x64");
        if let Err(e) = pdfium_renderer::init_pdfium(&map) {
            eprintln!("PDFium niet beschikbaar ({e}); overgeslagen");
            return;
        }
        // (paginamaat, vlak) in pt; het vlak rechtsonder, waar een afwijking het grootst is.
        let gevallen = [
            ((841.89_f32, 1190.55_f32), (780.0_f32, 1100.0_f32, 50.0_f32, 50.0_f32)),
            ((3000.5_f32, 1190.55_f32), (2900.0_f32, 1100.0_f32, 50.0_f32, 50.0_f32)),
        ];
        for (maat, vlak) in gevallen {
            let handle =
                pdfium_renderer::PdfiumDocumentHandle::load_from_bytes(Arc::new(pdf_met_vlak(maat, vlak))).unwrap();
            let doc = handle.document();

            // De inhoud: één object, het vlak, als deel vanaf linksboven.
            let inhoud = pdfium_renderer::page_content(doc, 0).unwrap();
            assert!(!inhoud.gedraaid);
            assert_eq!(inhoud.objecten.len(), 1);
            assert_eq!(inhoud.afbeelding_dpi, vec![None]);
            let deel = inhoud_deel(&inhoud.objecten, inhoud.kader).unwrap();
            let verwacht = [vlak.0 as f64, vlak.1 as f64, vlak.2 as f64, vlak.3 as f64];
            for (gemeten, verwacht) in [deel.x, deel.y, deel.breedte, deel.hoogte].into_iter().zip(verwacht) {
                assert!((gemeten - verwacht).abs() < 0.5, "{maat:?}: {deel:?}");
            }

            // Een deel rond het vlak op 300 dpi: het vlak op de verwachte pixels.
            let schaal = 300.0_f32 / 72.0;
            let (x, y) = (vlak.0 - 20.0, vlak.1 - 20.0);
            let (bw, bh, rgba) =
                pdfium_renderer::render_page_part_for_print(doc, 0, schaal, x, y, 100.0, 100.0).unwrap();
            assert_eq!((bw, bh), ((100.0 * schaal).ceil() as u32, (100.0 * schaal).ceil() as u32));
            let (x0, y0, x1, y1) = donker_kader(bw, &rgba).expect("vlak niet gerenderd");
            let px = |pt: f32| (pt * schaal) as f64;
            let meting = [
                ("links", x0 as f64, px(vlak.0 - x)),
                ("boven", y0 as f64, px(vlak.1 - y)),
                ("rechts", x1 as f64 + 1.0, px(vlak.0 + vlak.2 - x)),
                ("onder", y1 as f64 + 1.0, px(vlak.1 + vlak.3 - y)),
            ];
            for (rand, gemeten, verwacht) in meting {
                assert!(
                    (gemeten - verwacht).abs() <= 1.0,
                    "{maat:?} {rand}: {gemeten} px, verwacht {verwacht:.1} px"
                );
            }
        }
    }
}
