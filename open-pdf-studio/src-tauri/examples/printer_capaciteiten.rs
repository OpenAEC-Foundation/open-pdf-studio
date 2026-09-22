//! Wat een printer aan papier, standen en eigen maten aanbiedt.
//!
//! ALLEEN LEZEN. Dit programma start geen opdracht (geen `StartDoc`, geen
//! `CreateDC` op een echte DC) en verandert niets aan printers, poorten,
//! formulieren of standaarden. Het gebruikt: `EnumPrintersW`, `OpenPrinterW`
//! (leesrecht), `GetPrinterW` (niveau 2), `DeviceCapabilitiesW`,
//! `DocumentPropertiesW` met alleen `DM_OUT_BUFFER` of
//! `DM_IN_BUFFER | DM_OUT_BUFFER` (nooit `DM_UPDATE`, nooit `DM_IN_PROMPT`)
//! en `CreateICW` + `GetDeviceCaps` + `DeleteDC` (een informatiecontext, geen
//! printer-DC).
//!
//! Gebruik:
//!   cargo run --example printer_capaciteiten                 (namen van de printers)
//!   cargo run --example printer_capaciteiten -- "<printer>" [papier]
//! `papier` is een sleutel uit de Pagina-instelling (a4, a3, a2, a1, a0,
//! a3l, ...); zonder sleutel telt het vel van de printer zelf.

#[cfg(not(windows))]
fn main() {
    eprintln!("Alleen op Windows.");
}

#[cfg(windows)]
fn main() {
    windows_uitvraag::hoofd();
}

#[cfg(windows)]
mod windows_uitvraag {
    use app_lib::print_devmode::{
        breed, devmode_voor_opdracht, gemeten_vel_mm, met_orientatie, papier_info, papierlijst, DevMode, Printer,
    };
    use app_lib::print_instelling::{liggende_eigen_maat_tiende_mm, Papier};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateDCW, CreateICW, DeleteDC, GetDeviceCaps, HORZRES, LOGPIXELSX, LOGPIXELSY, PHYSICALHEIGHT,
        PHYSICALWIDTH, VERTRES,
    };
    use windows_sys::Win32::Graphics::Printing::{EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W};
    use windows_sys::Win32::Storage::Xps::{
        DeviceCapabilitiesW, ExtEscape, DC_FIELDS, DC_MAXEXTENT, DC_MINEXTENT, DC_ORIENTATION, DC_PERSONALITY,
    };

    fn tekst(p: *const u16) -> String {
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

    fn printers() -> Vec<String> {
        let vlag = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (mut nodig, mut aantal) = (0u32, 0u32);
        unsafe {
            EnumPrintersW(vlag, std::ptr::null(), 4, std::ptr::null_mut(), 0, &mut nodig, &mut aantal);
            let mut buf = vec![0u64; (nodig as usize).div_ceil(8).max(1)];
            if EnumPrintersW(vlag, std::ptr::null(), 4, buf.as_mut_ptr() as *mut u8, nodig, &mut nodig, &mut aantal) == 0
            {
                return Vec::new();
            }
            let info = std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_4W, aantal as usize);
            info.iter().map(|i| tekst(i.pPrinterName)).collect()
        }
    }

    /// `DeviceCapabilities` zonder uitvoerbuffer: het getal dat het teruggeeft.
    fn cap(printer: &str, soort: u16) -> i32 {
        let naam = breed(printer);
        unsafe { DeviceCapabilitiesW(naam.as_ptr(), std::ptr::null(), soort, std::ptr::null_mut(), std::ptr::null()) }
    }

    /// `DC_PERSONALITY`: de paginabeschrijvingstalen van het stuurprogramma.
    fn personality(printer: &str) -> Vec<String> {
        let naam = breed(printer);
        let n = cap(printer, DC_PERSONALITY);
        if n <= 0 || n > 64 {
            return Vec::new();
        }
        let mut buf = vec![0u16; n as usize * 32];
        let gelezen = unsafe {
            DeviceCapabilitiesW(naam.as_ptr(), std::ptr::null(), DC_PERSONALITY, buf.as_mut_ptr(), std::ptr::null())
        };
        if gelezen <= 0 {
            return Vec::new();
        }
        (0..gelezen as usize)
            .map(|i| {
                let deel = &buf[i * 32..(i + 1) * 32];
                let eind = deel.iter().position(|&c| c == 0).unwrap_or(deel.len());
                String::from_utf16_lossy(&deel[..eind]).trim().to_string()
            })
            .collect()
    }

    /// `ExtEscape`-nummers (wingdi.h). Alleen vragen, nooit zetten.
    const QUERYESCSUPPORT: i32 = 8;
    const PASSTHROUGH: i32 = 19;
    const POSTSCRIPT_INJECTION: i32 = 3610;
    const POSTSCRIPT_PASSTHROUGH: i32 = 4115;
    const GET_PS_FEATURESETTING: i32 = 4121;
    const FEATURESETTING_PSLEVEL: i32 = 2;
    const FEATURESETTING_CUSTPAPER: i32 = 3;

    /// Wat een PostScript-stuurprogramma van een eigen paginamaat maakt:
    /// `PSFEATURE_CUSTPAPER` (breedte, hoogte en de invoerrichting uit de
    /// PPD, in punten). Dit is de richting die in `*CustomPageSize` terecht
    /// komt, en dus of het medium liggend of staand wordt.
    fn ps_eigen_pagina(ic: isize) -> Option<(i32, i32, i32, i32, i32)> {
        let invoer = FEATURESETTING_CUSTPAPER.to_le_bytes();
        let mut uit = [0u8; 20];
        let n = unsafe {
            ExtEscape(
                ic as _,
                GET_PS_FEATURESETTING,
                invoer.len() as i32,
                invoer.as_ptr(),
                uit.len() as i32,
                uit.as_mut_ptr(),
            )
        };
        if n <= 0 {
            return None;
        }
        let g = |i: usize| i32::from_le_bytes([uit[i * 4], uit[i * 4 + 1], uit[i * 4 + 2], uit[i * 4 + 3]]);
        Some((g(0), g(1), g(2), g(3), g(4)))
    }

    /// PostScript-taalniveau volgens `GET_PS_FEATURESETTING`.
    fn ps_niveau(ic: isize) -> Option<i32> {
        let invoer = FEATURESETTING_PSLEVEL.to_le_bytes();
        let mut uit = [0u8; 4];
        let n = unsafe {
            ExtEscape(
                ic as _,
                GET_PS_FEATURESETTING,
                invoer.len() as i32,
                invoer.as_ptr(),
                uit.len() as i32,
                uit.as_mut_ptr(),
            )
        };
        (n > 0).then(|| i32::from_le_bytes(uit))
    }

    /// Ondersteunt het stuurprogramma deze escape? (`QUERYESCSUPPORT`: vraagt
    /// alleen, voert niets uit.)
    fn kent_escape(ic: isize, escape: i32) -> bool {
        let invoer = escape.to_le_bytes();
        unsafe {
            ExtEscape(ic as _, QUERYESCSUPPORT, invoer.len() as i32, invoer.as_ptr(), 0, std::ptr::null_mut()) > 0
        }
    }

    /// Een context met deze DEVMODE. `echt` maakt een printer-DC in plaats
    /// van een informatiecontext, omdat sommige vragen (`GET_PS_FEATURESETTING`)
    /// alleen op een printer-DC antwoorden. Er volgt GEEN `StartDoc`, dus er
    /// komt niets in de wachtrij en er wordt niets geprint.
    fn context(printer: &str, dm: &DevMode, echt: bool) -> Option<isize> {
        let naam = breed(printer);
        let h = unsafe {
            if echt {
                CreateDCW(std::ptr::null(), naam.as_ptr(), std::ptr::null(), dm.ptr())
            } else {
                CreateICW(std::ptr::null(), naam.as_ptr(), std::ptr::null(), dm.ptr())
            }
        };
        (!h.is_null()).then(|| h as isize)
    }

    /// Wat het stuurprogramma met deze DEVMODE van een eigen paginamaat maakt.
    fn ps_regel(printer: &str, dm: &DevMode, echt: bool) -> String {
        let Some(h) = context(printer, dm, echt) else {
            return "geen context".to_string();
        };
        let escapes = [
            ("PASSTHROUGH", PASSTHROUGH),
            ("POSTSCRIPT_PASSTHROUGH", POSTSCRIPT_PASSTHROUGH),
            ("POSTSCRIPT_INJECTION", POSTSCRIPT_INJECTION),
            ("GET_PS_FEATURESETTING", GET_PS_FEATURESETTING),
        ];
        let kent: Vec<&str> = escapes.iter().filter(|(_, e)| kent_escape(h, *e)).map(|(n, _)| *n).collect();
        let custpaper = match ps_eigen_pagina(h) {
            Some((o, b, hh, bo, ho)) => format!(
                "CUSTPAPER lOrientation={o} lWidth={b} pt lHeight={hh} pt offsets {bo}/{ho} -> medium {}",
                match o {
                    0 | 2 => "ONGEDRAAID (gebruikersruimte = hoogte x breedte)",
                    1 | 3 => "GEDRAAID (kwartslag in /Install)",
                    _ => "geen eigen paginamaat gekozen",
                }
            ),
            None => "CUSTPAPER niet op te vragen".to_string(),
        };
        let niveau = ps_niveau(h).map_or("-".to_string(), |n| n.to_string());
        unsafe { DeleteDC(h as _) };
        let soort = if echt { "printer-DC" } else { "informatiecontext" };
        format!("({soort}) escapes {kent:?}, PostScript-niveau {niveau}, {custpaper}")
    }

    /// Het vel van een informatiecontext met deze DEVMODE, in pixels en mm.
    /// Een informatiecontext kan niet printen; er start geen opdracht.
    fn meet(printer: &str, dm: &DevMode) -> String {
        let naam = breed(printer);
        let ic = unsafe { CreateICW(std::ptr::null(), naam.as_ptr(), std::ptr::null(), dm.ptr()) };
        if ic.is_null() {
            return "geen informatiecontext".to_string();
        }
        let g = |index: u32| unsafe { GetDeviceCaps(ic, index as i32) };
        let (pw, ph, hr, vr, dx, dy) = (
            g(PHYSICALWIDTH),
            g(PHYSICALHEIGHT),
            g(HORZRES),
            g(VERTRES),
            g(LOGPIXELSX).max(1),
            g(LOGPIXELSY).max(1),
        );
        unsafe { DeleteDC(ic) };
        format!(
            "fysiek {pw} x {ph} px = {:.1} x {:.1} mm, bedrukbaar {hr} x {vr} px, {dx} x {dy} dpi -> {}",
            pw as f64 * 25.4 / dx as f64,
            ph as f64 * 25.4 / dy as f64,
            if pw > ph { "LIGGEND" } else { "staand" }
        )
    }

    fn beschrijf(printer: &str, dm: &DevMode) -> String {
        format!(
            "dmFields 0x{:08x} papiercode {:?} eigen maat {:?} formulier {:?} stand {} | vel {:?}",
            dm.velden(),
            dm.papiercode(),
            dm.eigen_maat_tiende_mm(),
            dm.formuliernaam(),
            if dm.liggend() { "LIGGEND" } else { "staand" },
            papier_info(printer, dm).map(|i| (i.papier, i.naam, i.breedte_mm, i.hoogte_mm, i.orientatie))
        )
    }

    /// Een variant proberen: DEVMODE aanpassen, laten controleren en nameten.
    fn probeer(printer: &str, prn: &Printer, naam: &str, basis: &DevMode, maak: impl Fn(&mut DevMode)) {
        let mut dm = basis.clone();
        maak(&mut dm);
        println!("\n-- {naam}");
        println!("   gevraagd    : {}", beschrijf(printer, &dm));
        match prn.valideren(&dm) {
            Ok(v) => {
                println!("   gecontroleerd: {}", beschrijf(printer, &v));
                println!("   nagemeten   : {}", meet(printer, &v));
                println!("   PostScript  : {}", ps_regel(printer, &v, false));
                println!("   PostScript  : {}", ps_regel(printer, &v, true));
            }
            Err(e) => println!("   controle mislukt: {e}"),
        }
    }

    pub fn hoofd() {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let Some(printer) = args.first() else {
            println!("Printers op deze machine:");
            for p in printers() {
                println!("  {p}");
            }
            return;
        };
        let papier = Papier::uit_keuze(args.get(1).map(String::as_str));
        let prn = match Printer::open(printer) {
            Ok(p) => p,
            Err(e) => {
                println!("{e}");
                return;
            }
        };
        println!("=== {printer}");
        match prn.stuurprogramma_en_poort() {
            Some((stuur, poort)) => println!("stuurprogramma {stuur:?} poort {poort:?}"),
            None => println!("stuurprogramma en poort onbekend"),
        }
        println!("schrijft_document: {}", prn.schrijft_document());
        println!("talen (DC_PERSONALITY): {:?}", personality(printer));
        println!(
            "DC_ORIENTATION {} graden, DC_MINEXTENT {:#x}, DC_MAXEXTENT {:#x}, DC_FIELDS {:#010x}",
            cap(printer, DC_ORIENTATION),
            cap(printer, DC_MINEXTENT),
            cap(printer, DC_MAXEXTENT),
            cap(printer, DC_FIELDS)
        );
        // DC_MINEXTENT/DC_MAXEXTENT: breedte in het lage woord, hoogte in het
        // hoge, in tienden van een millimeter.
        for (naam, waarde) in [("kleinste", cap(printer, DC_MINEXTENT)), ("grootste", cap(printer, DC_MAXEXTENT))] {
            let (b, h) = ((waarde & 0xffff) as f64 / 10.0, ((waarde >> 16) & 0xffff) as f64 / 10.0);
            println!("  {naam} eigen maat: {b:.1} x {h:.1} mm");
        }
        let lijst = papierlijst(printer);
        println!("papierlijst ({} soorten): code, maat in 0,1 mm, naam", lijst.len());
        for s in &lijst {
            let liggend = if s.maat_tiende_mm.0 > s.maat_tiende_mm.1 { "  <- BREDER DAN HOOG" } else { "" };
            println!("  {:5} {:6} x {:6}  {}{liggend}", s.code, s.maat_tiende_mm.0, s.maat_tiende_mm.1, s.naam);
        }

        let standaard = match prn.standaard() {
            Ok(dm) => dm,
            Err(e) => {
                println!("geen standaard-DEVMODE: {e}");
                return;
            }
        };
        println!("\nstandaard van het stuurprogramma: {}", beschrijf(printer, &standaard));
        println!("   nagemeten   : {}", meet(printer, &standaard));

        let basis = match devmode_voor_opdracht(&prn, None, papier) {
            Ok(dm) => dm,
            Err(e) => {
                println!("geen opdracht-DEVMODE: {e}");
                return;
            }
        };
        println!("\nopdracht met papier {:?}: {}", papier.sleutel(), beschrijf(printer, &basis));
        let staand = met_orientatie(&prn, &basis, false);
        println!("\n-- staand (DM_ORIENTATION)");
        println!("   gecontroleerd: {}", beschrijf(printer, &staand));
        println!("   nagemeten   : {}", meet(printer, &staand));
        let liggend = met_orientatie(&prn, &basis, true);
        println!("\n-- liggend (DM_ORIENTATION, de weg van vóór deze wijziging)");
        println!("   gecontroleerd: {}", beschrijf(printer, &liggend));
        println!("   nagemeten   : {}", meet(printer, &liggend));

        let vel = gemeten_vel_mm(printer, &staand).unwrap_or((0.0, 0.0));
        let Some(maat) = liggende_eigen_maat_tiende_mm(vel) else {
            println!("\nhet vel van de staande DEVMODE ({vel:?}) geeft geen liggende eigen maat");
            return;
        };
        println!("\nliggend vel als eigen maat: {} x {} (0,1 mm)", maat.0, maat.1);
        probeer(printer, &prn, "eigen maat met DMPAPER_USER (256), stand staand", &staand, |dm| {
            dm.zet_eigen_maat(maat.0, maat.1);
            dm.zet_liggend(false);
        });
        probeer(printer, &prn, "eigen maat met dmPaperSize 0, stand staand", &staand, |dm| {
            dm.zet_eigen_maat_met_code(0, maat.0, maat.1);
            dm.zet_liggend(false);
        });
        probeer(printer, &prn, "eigen maat met DMPAPER_USER, stand liggend", &staand, |dm| {
            dm.zet_eigen_maat(maat.0, maat.1);
            dm.zet_liggend(true);
        });
        // Biedt het stuurprogramma zelf een soort aan die breder is dan hoog?
        for s in lijst.iter().filter(|s| s.maat_tiende_mm.0 > s.maat_tiende_mm.1) {
            let code = s.code;
            probeer(printer, &prn, &format!("papiersoort {code} van het stuurprogramma ({})", s.naam), &staand, |dm| {
                dm.zet_papier(code);
                dm.zet_liggend(false);
            });
        }
    }
}
