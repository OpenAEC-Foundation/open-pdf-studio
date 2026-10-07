//! De printerlijst zoals `get_printers` hem op Windows teruggeeft (#524).
//!
//! ALLEEN LEZEN: `EnumPrintersW` en `GetDefaultPrinterW`, verder niets. Op
//! stdout de JSON van `get_printers`; op stderr per printer het bitveld
//! `PRINTER_INFO_2.Status` en de code die daaruit volgt, en wat
//! `is_virtual_printer_installed` en `virtual_printer_catch_enabled` zouden
//! zeggen. Te vergelijken met (ook alleen lezen):
//!   Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName, Default, PrinterStatus, PrinterState
//!
//! Gebruik: cargo run --example printerlijst

#[cfg(not(windows))]
fn main() {
    eprintln!("Alleen op Windows.");
}

#[cfg(windows)]
fn main() {
    use app_lib::print_formulieren::{OUDE_PRINTERNAAM, PRINTERNAAM};
    use app_lib::print_lijst::{
        cim_printerstatus, heeft_printer, poort_van, printers_als_json, printers_opvragen, standaardprinter,
        vangt_in_spoolbestand,
    };

    match printers_opvragen() {
        Ok(printers) => {
            for p in &printers {
                eprintln!("{:#010x} -> {}  {}", p.status, cim_printerstatus(p.status), p.naam);
            }
            // Zoals lib.rs: vp_spool_dir() is %LOCALAPPDATA%\OpenPDFPrinter\spool.
            let spoolbestand = dirs::data_local_dir()
                .map(|d| d.join("OpenPDFPrinter").join("spool").join("latest.pdf").to_string_lossy().to_string())
                .unwrap_or_default();
            eprintln!("virtuele printer: {}", heeft_printer(&printers, &[PRINTERNAAM, OUDE_PRINTERNAAM]));
            eprintln!("opvang: {}", vangt_in_spoolbestand(poort_van(&printers, PRINTERNAAM), &spoolbestand));
        }
        Err(e) => eprintln!("{e}"),
    }
    eprintln!("standaard: {:?}", standaardprinter());
    match printers_als_json() {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
