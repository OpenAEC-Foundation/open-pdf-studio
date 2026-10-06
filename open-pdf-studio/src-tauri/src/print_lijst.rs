//! De printers van Windows, rechtstreeks uit de spooler: `EnumPrintersW`
//! (lokale printers en verbindingen, niveau 2) en `GetDefaultPrinterW`.
//! Alleen lezen.
//!
//! Hiervoor startte de app PowerShell (`Get-Printer`, `Get-CimInstance
//! Win32_Printer`), ook bij elke start. Endpoint-beveiliging beëindigt een
//! documentprogramma dat powershell.exe start (#524).
//!
//! `printers_json` geeft de vorm van `Get-CimInstance Win32_Printer |
//! Select-Object Name, DriverName, PortName, Default, PrinterStatus`, zodat de
//! printerlijst van de app (printerStore.js), de printdialoog en
//! `app_list_printers` niet veranderen.

use std::mem::size_of;

use windows_sys::Win32::Foundation::{GetLastError, ERROR_INSUFFICIENT_BUFFER};
use windows_sys::Win32::Graphics::Printing::{
    EnumPrintersW, GetDefaultPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
    PRINTER_STATUS_BUSY, PRINTER_STATUS_DOOR_OPEN, PRINTER_STATUS_ERROR, PRINTER_STATUS_INITIALIZING,
    PRINTER_STATUS_IO_ACTIVE, PRINTER_STATUS_MANUAL_FEED, PRINTER_STATUS_NOT_AVAILABLE, PRINTER_STATUS_NO_TONER,
    PRINTER_STATUS_OFFLINE, PRINTER_STATUS_OUTPUT_BIN_FULL, PRINTER_STATUS_OUT_OF_MEMORY, PRINTER_STATUS_PAGE_PUNT,
    PRINTER_STATUS_PAPER_JAM, PRINTER_STATUS_PAPER_OUT, PRINTER_STATUS_PAPER_PROBLEM, PRINTER_STATUS_PAUSED,
    PRINTER_STATUS_PENDING_DELETION, PRINTER_STATUS_PRINTING, PRINTER_STATUS_PROCESSING,
    PRINTER_STATUS_SERVER_OFFLINE, PRINTER_STATUS_SERVER_UNKNOWN, PRINTER_STATUS_USER_INTERVENTION,
    PRINTER_STATUS_WAITING, PRINTER_STATUS_WARMING_UP,
};

use crate::print_devmode::uit_pwstr;

/// Eén printer zoals de spooler hem meldt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrinterRegel {
    pub naam: String,
    pub driver: String,
    pub poort: String,
    /// `PRINTER_INFO_2.Status`, een bitveld.
    pub status: u32,
}

/// Spoolerbits waarbij de printer stilstaat of om ingrijpen vraagt.
const STIL: u32 = PRINTER_STATUS_PAUSED
    | PRINTER_STATUS_ERROR
    | PRINTER_STATUS_PENDING_DELETION
    | PRINTER_STATUS_PAPER_JAM
    | PRINTER_STATUS_PAPER_OUT
    | PRINTER_STATUS_MANUAL_FEED
    | PRINTER_STATUS_PAPER_PROBLEM
    | PRINTER_STATUS_OFFLINE
    | PRINTER_STATUS_OUTPUT_BIN_FULL
    | PRINTER_STATUS_NOT_AVAILABLE
    | PRINTER_STATUS_WAITING
    | PRINTER_STATUS_NO_TONER
    | PRINTER_STATUS_PAGE_PUNT
    | PRINTER_STATUS_USER_INTERVENTION
    | PRINTER_STATUS_OUT_OF_MEMORY
    | PRINTER_STATUS_DOOR_OPEN
    | PRINTER_STATUS_SERVER_OFFLINE;
/// Spoolerbits waarbij de printer met een opdracht bezig is.
const BEZIG: u32 = PRINTER_STATUS_IO_ACTIVE | PRINTER_STATUS_BUSY | PRINTER_STATUS_PRINTING | PRINTER_STATUS_PROCESSING;
/// Spoolerbits waarbij de printer opstart.
const OPWARMEN: u32 = PRINTER_STATUS_INITIALIZING | PRINTER_STATUS_WARMING_UP;

/// Code van `Win32_Printer.PrinterStatus` per groep spoolerbits, in volgorde
/// van voorrang: 1 overig (zo meldt Win32_Printer ook een offline printer),
/// 2 onbekend, 4 bezig, 5 opwarmen. Geen bit uit een groep: 3, klaar. Toner
/// bijna op, energiebesparing en een driverupdate staan in geen groep: de
/// printer blijft bruikbaar.
const STATUSCODES: [(u32, u16); 4] = [(STIL, 1), (PRINTER_STATUS_SERVER_UNKNOWN, 2), (BEZIG, 4), (OPWARMEN, 5)];

/// `PRINTER_INFO_2.Status` als code van `Win32_Printer.PrinterStatus`.
pub fn cim_printerstatus(status: u32) -> u16 {
    STATUSCODES.iter().find(|(bits, _)| status & bits != 0).map_or(3, |&(_, code)| code)
}

/// Windows vergelijkt printernamen zonder onderscheid in hoofdletters.
pub fn zelfde_naam(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// Staat er een printer met een van deze namen in de lijst?
pub fn heeft_printer(printers: &[PrinterRegel], namen: &[&str]) -> bool {
    printers.iter().any(|p| namen.iter().any(|n| zelfde_naam(&p.naam, n)))
}

/// De poort van printer `naam`, als die er is.
pub fn poort_van<'a>(printers: &'a [PrinterRegel], naam: &str) -> Option<&'a str> {
    printers.iter().find(|p| zelfde_naam(&p.naam, naam)).map(|p| p.poort.as_str())
}

/// Schrijft een printer op `poort` stil naar `spoolbestand` (de opvang van de
/// virtuele printer)? Getrimd en zonder onderscheid in hoofdletters, zoals
/// Windows paden vergelijkt.
pub fn vangt_in_spoolbestand(poort: Option<&str>, spoolbestand: &str) -> bool {
    let poort = poort.unwrap_or("").trim();
    !poort.is_empty() && poort.to_lowercase() == spoolbestand.to_lowercase()
}

/// Eén printer in de JSON van `get_printers`: de velden van `Win32_Printer`,
/// in dezelfde volgorde.
#[derive(serde::Serialize)]
struct JsonRegel<'a> {
    #[serde(rename = "Name")]
    naam: &'a str,
    #[serde(rename = "DriverName")]
    driver: &'a str,
    #[serde(rename = "PortName")]
    poort: &'a str,
    #[serde(rename = "Default")]
    standaard: bool,
    #[serde(rename = "PrinterStatus")]
    status: u16,
}

/// De JSON-lijst van `get_printers`; `standaard` is wat `GetDefaultPrinterW`
/// gaf.
pub fn printers_json(printers: &[PrinterRegel], standaard: Option<&str>) -> String {
    let regels: Vec<JsonRegel> = printers
        .iter()
        .map(|p| JsonRegel {
            naam: &p.naam,
            driver: &p.driver,
            poort: &p.poort,
            standaard: standaard.is_some_and(|s| zelfde_naam(s, &p.naam)),
            status: cim_printerstatus(p.status),
        })
        .collect();
    serde_json::to_string(&regels).unwrap_or_else(|_| "[]".to_string())
}

/// De velden van één `PRINTER_INFO_2W`, gekopieerd. De tekstwijzers moeten
/// nul zijn of naar levende tekst met een afsluitende nul wijzen.
unsafe fn regel_uit(info: &PRINTER_INFO_2W) -> PrinterRegel {
    PrinterRegel {
        naam: uit_pwstr(info.pPrinterName),
        driver: uit_pwstr(info.pDriverName),
        poort: uit_pwstr(info.pPortName),
        status: info.Status,
    }
}

/// Alle printers, lokaal en verbindingen: dezelfde als in Win32_Printer.
pub fn printers_opvragen() -> Result<Vec<PrinterRegel>, String> {
    let (mut nodig, mut aantal) = (0u32, 0u32);
    // Komt er tussen twee aanroepen een printer bij, dan is de buffer te klein.
    for _ in 0..4 {
        // u64: PRINTER_INFO_2W bevat wijzers en moet zo uitgelijnd zijn.
        let mut buf = vec![0u64; (nodig as usize).div_ceil(8).max(1)];
        let gelukt = unsafe {
            EnumPrintersW(
                PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
                std::ptr::null(),
                2,
                buf.as_mut_ptr() as *mut u8,
                nodig,
                &mut nodig,
                &mut aantal,
            )
        };
        if gelukt != 0 {
            if aantal as usize * size_of::<PRINTER_INFO_2W>() > buf.len() * 8 {
                return Err(format!("EnumPrintersW returned {aantal} printers in {nodig} bytes"));
            }
            // De tekstvelden wijzen in `buf`; regel_uit kopieert ze meteen.
            let info = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_2W, aantal as usize) };
            return Ok(info.iter().map(|i| unsafe { regel_uit(i) }).collect());
        }
        let fout = unsafe { GetLastError() };
        if fout != ERROR_INSUFFICIENT_BUFFER {
            return Err(format!("EnumPrintersW failed (error {fout})"));
        }
    }
    Err("EnumPrintersW failed: the printer list kept changing".to_string())
}

/// De standaardprinter van de gebruiker, of `None` als er geen is.
pub fn standaardprinter() -> Option<String> {
    // Eerst de lengte in tekens, met de afsluitende nul.
    let mut lengte = 0u32;
    unsafe { GetDefaultPrinterW(std::ptr::null_mut(), &mut lengte) };
    if lengte == 0 {
        return None;
    }
    let mut buf = vec![0u16; lengte as usize];
    if unsafe { GetDefaultPrinterW(buf.as_mut_ptr(), &mut lengte) } == 0 {
        return None;
    }
    let eind = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let naam = String::from_utf16_lossy(&buf[..eind]);
    (!naam.is_empty()).then_some(naam)
}

/// `get_printers` op Windows: alle printers als JSON, met de standaardprinter.
pub fn printers_als_json() -> Result<String, String> {
    let printers = printers_opvragen()?;
    Ok(printers_json(&printers, standaardprinter().as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::print_formulieren::{OUDE_PRINTERNAAM, PRINTERNAAM};
    use windows_sys::Win32::Graphics::Printing::{
        PRINTER_STATUS_DRIVER_UPDATE_NEEDED, PRINTER_STATUS_POWER_SAVE, PRINTER_STATUS_TONER_LOW,
    };

    /// Wat `printers_json` voor `voorbeeld()` geeft, met `Kantoor "A3"` als
    /// standaardprinter. js/pdf/printerlijst-afnemers.test.mjs voert deze
    /// tekst door de afnemers in de app.
    const VOORBEELD_JSON: &str = r#"[{"Name":"Kantoor \"A3\"","DriverName":"Generic PCL 6","PortName":"WSD-1234","Default":true,"PrinterStatus":3},{"Name":"Open PDF Printer","DriverName":"Microsoft Print To PDF","PortName":"PORTPROMPT:","Default":false,"PrinterStatus":3},{"Name":"\\\\server\\Plotter","DriverName":"Generic Plotter","PortName":"IP_10.0.0.9","Default":false,"PrinterStatus":1},{"Name":"Opvang","DriverName":"Microsoft Print To PDF","PortName":"C:\\Users\\a\\AppData\\Local\\OpenPDFPrinter\\spool\\latest.pdf","Default":false,"PrinterStatus":4}]"#;

    const SPOOLBESTAND: &str = r"C:\Users\a\AppData\Local\OpenPDFPrinter\spool\latest.pdf";
    const VIRTUEEL: [&str; 2] = [PRINTERNAAM, OUDE_PRINTERNAAM];

    fn regel(naam: &str, driver: &str, poort: &str, status: u32) -> PrinterRegel {
        PrinterRegel { naam: naam.into(), driver: driver.into(), poort: poort.into(), status }
    }

    fn voorbeeld() -> Vec<PrinterRegel> {
        vec![
            regel("Kantoor \"A3\"", "Generic PCL 6", "WSD-1234", 0),
            regel("Open PDF Printer", "Microsoft Print To PDF", "PORTPROMPT:", 0),
            regel(r"\\server\Plotter", "Generic Plotter", "IP_10.0.0.9", 0x80),
            regel("Opvang", "Microsoft Print To PDF", SPOOLBESTAND, 0x400),
        ]
    }

    #[test]
    fn json_heeft_de_vorm_van_win32_printer() {
        assert_eq!(printers_json(&voorbeeld(), Some("Kantoor \"A3\"")), VOORBEELD_JSON);
    }

    #[test]
    fn standaard_zonder_onderscheid_in_hoofdletters() {
        let json = printers_json(&voorbeeld(), Some("OPEN PDF PRINTER"));
        let lijst: serde_json::Value = serde_json::from_str(&json).unwrap();
        let standaard: Vec<bool> = lijst.as_array().unwrap().iter().map(|p| p["Default"].as_bool().unwrap()).collect();
        assert_eq!(standaard, [false, true, false, false]);
    }

    #[test]
    fn zonder_standaard_of_zonder_printers() {
        assert!(!printers_json(&voorbeeld(), None).contains("\"Default\":true"));
        assert!(!printers_json(&voorbeeld(), Some("Verdwenen")).contains("\"Default\":true"));
        assert_eq!(printers_json(&[], None), "[]");
        assert_eq!(printers_json(&[], Some("Kantoor")), "[]");
    }

    /// Codes van Win32_Printer.PrinterStatus: 1 overig, 2 onbekend, 3 klaar,
    /// 4 bezig, 5 opwarmen. Gemeten (Get-CimInstance Win32_Printer, alleen
    /// lezen): status 0 geeft 3, een offline printer (PrinterState 128) 1.
    /// js/pdf/printerlijst-bron.test.mjs toetst dezelfde gevallen.
    #[test]
    fn statuscode_volgt_win32_printer() {
        assert_eq!(cim_printerstatus(0x0), 3);
        assert_eq!(cim_printerstatus(0x80), 1);
        assert_eq!(cim_printerstatus(0x1), 1);
        assert_eq!(cim_printerstatus(0x2), 1);
        assert_eq!(cim_printerstatus(0xa), 1);
        assert_eq!(cim_printerstatus(0x2000), 1);
        assert_eq!(cim_printerstatus(0x2000000), 1);
        assert_eq!(cim_printerstatus(0x400), 4);
        assert_eq!(cim_printerstatus(0x200), 4);
        assert_eq!(cim_printerstatus(0x100), 4);
        assert_eq!(cim_printerstatus(0x4000), 4);
        assert_eq!(cim_printerstatus(0x10000), 5);
        assert_eq!(cim_printerstatus(0x8000), 5);
        assert_eq!(cim_printerstatus(0x800000), 2);
        // Toner bijna op, energiebesparing, driverupdate: nog bruikbaar.
        assert_eq!(cim_printerstatus(0x20000), 3);
        assert_eq!(cim_printerstatus(0x1000000), 3);
        assert_eq!(cim_printerstatus(0x4000000), 3);
        // Meer bits: stilstand, dan onbekend, dan bezig, dan opwarmen.
        assert_eq!(cim_printerstatus(0x20400), 4);
        assert_eq!(cim_printerstatus(0x401), 1);
        assert_eq!(cim_printerstatus(0x400400), 1);
        assert_eq!(cim_printerstatus(0x800080), 1);
        assert_eq!(cim_printerstatus(0x800400), 2);
        assert_eq!(cim_printerstatus(0x10400), 4);
        // Een onbekende bit verandert niets.
        assert_eq!(cim_printerstatus(0x80000000), 3);
    }

    #[test]
    fn statusgroepen_overlappen_niet() {
        let mut gezien = 0u32;
        for (bits, _) in STATUSCODES {
            assert_eq!(gezien & bits, 0);
            gezien |= bits;
        }
        let waarschuwingen = PRINTER_STATUS_TONER_LOW | PRINTER_STATUS_POWER_SAVE | PRINTER_STATUS_DRIVER_UPDATE_NEEDED;
        assert_eq!(gezien & waarschuwingen, 0);
        // Alle 27 bits uit winspool.h: 0x1 tot en met 0x4000000.
        assert_eq!(gezien | waarschuwingen, 0x7ff_ffff);
    }

    #[test]
    fn virtuele_printer_op_naam() {
        assert!(heeft_printer(&voorbeeld(), &VIRTUEEL));
        assert!(heeft_printer(&[regel("open pdf studio", "Microsoft Print To PDF", "PORTPROMPT:", 0)], &VIRTUEEL));
        assert!(!heeft_printer(&[regel("Open PDF Printer (kopie 1)", "x", "y", 0)], &VIRTUEEL));
        assert!(!heeft_printer(&[regel(r"\\server\Open PDF Printer", "x", "y", 0)], &VIRTUEEL));
        assert!(!heeft_printer(&[], &VIRTUEEL));
        assert!(zelfde_naam("Kantoor ÉÉN", "kantoor één"));
        assert!(!zelfde_naam("Kantoor", "Kantoor "));
    }

    #[test]
    fn opvang_vergelijkt_de_poort_met_het_spoolbestand() {
        let eigen = [regel(
            "Open PDF Printer",
            "Microsoft Print To PDF",
            r"c:\users\A\appdata\local\openpdfprinter\spool\LATEST.PDF ",
            0,
        )];
        assert!(vangt_in_spoolbestand(poort_van(&eigen, "open pdf printer"), SPOOLBESTAND));
        // Op PORTPROMPT: (opslaan-venster), ook al vangt een andere printer wel.
        assert_eq!(poort_van(&voorbeeld(), "Opvang"), Some(SPOOLBESTAND));
        assert!(!vangt_in_spoolbestand(poort_van(&voorbeeld(), "Open PDF Printer"), SPOOLBESTAND));
        assert!(!vangt_in_spoolbestand(poort_van(&voorbeeld(), "Ontbreekt"), SPOOLBESTAND));
        assert!(!vangt_in_spoolbestand(Some(""), ""));
        assert!(!vangt_in_spoolbestand(None, ""));
    }

    /// De tekstvelden van `PRINTER_INFO_2W` worden gekopieerd; een nulwijzer
    /// is een lege tekst.
    #[test]
    fn regel_uit_printer_info() {
        let breed = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
        let (mut naam, mut poort) = (breed("Büro Ω"), breed("LPT1:"));
        let mut info: PRINTER_INFO_2W = unsafe { std::mem::zeroed() };
        info.pPrinterName = naam.as_mut_ptr();
        info.pPortName = poort.as_mut_ptr();
        info.Status = 0x80;
        let r = unsafe { regel_uit(&info) };
        assert_eq!(r, regel("Büro Ω", "", "LPT1:", 0x80));
    }
}
