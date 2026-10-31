//! Printing on Linux and macOS: the printer list and print jobs, with a
//! fallback order instead of a hard dependency on the CUPS command-line tools.
//!
//! Backends, tried in order until one works:
//! - **IPP**: talk to the CUPS scheduler directly over its socket or
//!   `localhost:631` (cups_ipp.rs). Works wherever the scheduler is reachable,
//!   also in a Flatpak (`--socket=cups`) or Snap (`cups` interface) whose
//!   runtime has no `lpstat`/`lp`.
//! - **lp/lpstat**: the CUPS client tools, when they are installed.
//! - **Print portal** (Linux, inside a sandbox only): org.freedesktop.portal.Print
//!   over D-Bus. The desktop then shows its own print dialog.
//!
//! On macOS `lp`/`lpstat` always exist and stay the first choice; IPP is the
//! fallback there. The decisions are pure functions so they are testable
//! without a printer; the functions that talk to CUPS are at the bottom.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::json;

use crate::cups_ipp::{self, Bericht, Server, Verzoek, Waarde};

/// The list entry that stands for "let the desktop's print dialog choose"
/// (print portal). Only listed inside a sandbox when CUPS shows no printers.
pub const PORTAAL_PRINTER: &str = "System print dialog";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Ipp,
    Lp,
    Portaal,
}

impl Backend {
    fn naam(self) -> &'static str {
        match self {
            Backend::Ipp => "ipp",
            Backend::Lp => "lp",
            Backend::Portaal => "portal",
        }
    }
}

/// Where the printer list comes from, in order. `lpstat` only when it is
/// installed.
pub fn lijst_volgorde(macos: bool, lpstat_aanwezig: bool) -> Vec<Backend> {
    let mut v = if macos { vec![Backend::Lp, Backend::Ipp] } else { vec![Backend::Ipp, Backend::Lp] };
    if !lpstat_aanwezig {
        v.retain(|b| *b != Backend::Lp);
    }
    v
}

/// How a job is sent, in order. The portal is a last resort inside a
/// sandbox (outside one there is a desktop-independent way or nothing), and
/// the only way for the portal list entry.
pub fn print_volgorde(macos: bool, sandbox: bool, lp_aanwezig: bool, printer: &str) -> Vec<Backend> {
    if printer == PORTAAL_PRINTER {
        return vec![Backend::Portaal];
    }
    let mut v = lijst_volgorde(macos, lp_aanwezig);
    if sandbox && !macos {
        v.push(Backend::Portaal);
    }
    v
}

/// The full path of `programma` on `path` (the PATH value), if it is an
/// executable file there.
pub fn zoek_programma(programma: &str, path: Option<&OsStr>) -> Option<PathBuf> {
    std::env::split_paths(path?)
        .map(|map| map.join(programma))
        .find(|kandidaat| is_uitvoerbaar(kandidaat))
}

fn is_uitvoerbaar(pad: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(pad) else { return false };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub fn programma_aanwezig(programma: &str) -> bool {
    zoek_programma(programma, std::env::var_os("PATH").as_deref()).is_some()
}

// ---------------------------------------------------------------------------
// Printer list
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CupsPrinter {
    pub naam: String,
    /// printer-state: 3 idle, 4 processing, 5 stopped.
    pub staat: i32,
    pub accepteert: bool,
    pub standaard: bool,
    pub kleur: Option<bool>,
    pub media: Vec<String>,
    pub media_standaard: Option<String>,
    pub info: Option<String>,
    pub model: Option<String>,
}

/// CUPS_PRINTER_DEFAULT in printer-type.
const TYPE_STANDAARD: i32 = 0x0002_0000;

pub const GEVRAAGDE_ATTRIBUTEN: &[&str] = &[
    "printer-name",
    "printer-state",
    "printer-is-accepting-jobs",
    "printer-type",
    "printer-info",
    "printer-make-and-model",
    "color-supported",
    "media-supported",
    "media-default",
];

/// The printers in a CUPS-Get-Printers (or Get-Printer-Attributes) response.
pub fn printers_uit_ipp(bericht: &Bericht) -> Vec<CupsPrinter> {
    bericht
        .groepen_met(cups_ipp::TAG_PRINTER)
        .filter_map(|g| {
            let naam = g.zoek("printer-name")?.tekst()?.trim().to_string();
            if naam.is_empty() {
                return None;
            }
            let tekst = |n: &str| g.zoek(n).and_then(|a| a.tekst()).map(str::to_string).filter(|s| !s.is_empty());
            Some(CupsPrinter {
                staat: g.zoek("printer-state").and_then(|a| a.geheel()).unwrap_or(3),
                accepteert: g.zoek("printer-is-accepting-jobs").and_then(|a| a.booleaans()).unwrap_or(true),
                standaard: g
                    .zoek("printer-type")
                    .and_then(|a| a.geheel())
                    .is_some_and(|t| t & TYPE_STANDAARD != 0),
                kleur: g.zoek("color-supported").and_then(|a| a.booleaans()),
                media: g.zoek("media-supported").map(|a| a.teksten()).unwrap_or_default(),
                media_standaard: tekst("media-default"),
                info: tekst("printer-info"),
                model: tekst("printer-make-and-model"),
                naam,
            })
        })
        .collect()
}

/// The default printer a user chose for themselves, as libcups reads it:
/// `LPDEST`, then `PRINTER` (unless it is "lp"), then the `Default` line of
/// `~/.cups/lpoptions` (without an instance suffix).
pub fn gebruikers_standaard(lpdest: Option<&str>, printer: Option<&str>, lpoptions: Option<&str>) -> Option<String> {
    let schoon = |s: &str| s.split('/').next().unwrap_or("").trim().to_string();
    if let Some(d) = lpdest.map(schoon).filter(|s| !s.is_empty()) {
        return Some(d);
    }
    if let Some(p) = printer.map(schoon).filter(|s| !s.is_empty() && s != "lp") {
        return Some(p);
    }
    lpoptions?.lines().find_map(|regel| {
        let mut delen = regel.split_whitespace();
        let sleutel = delen.next()?;
        if !sleutel.eq_ignore_ascii_case("Default") {
            return None;
        }
        Some(schoon(delen.next()?)).filter(|s| !s.is_empty())
    })
}

/// Marks exactly one printer as default: the user's own choice if it is in
/// the list, else the server default, else what printer-type says.
pub fn kies_standaard(printers: &mut [CupsPrinter], gebruiker: Option<&str>, server: Option<&str>) {
    let gekozen = [gebruiker, server]
        .into_iter()
        .flatten()
        .find(|n| printers.iter().any(|p| p.naam == *n))
        .map(str::to_string)
        .or_else(|| printers.iter().find(|p| p.standaard).map(|p| p.naam.clone()));
    for p in printers.iter_mut() {
        p.standaard = gekozen.as_deref() == Some(p.naam.as_str());
    }
}

/// Parses `lpstat -p` and `lpstat -d` output:
///   printer NAME is idle.  enabled since ...
///   printer NAME disabled since ...
///   system default destination: NAME
pub fn parse_lpstat(printers: &str, standaard: &str) -> Vec<CupsPrinter> {
    let standaard_naam = standaard
        .lines()
        .find_map(|regel| {
            regel.split_once(':').and_then(|(_, v)| {
                let v = v.trim();
                (!v.is_empty() && !v.starts_with("no ")).then(|| v.to_string())
            })
        })
        .unwrap_or_default();
    printers
        .lines()
        .filter_map(|regel| {
            let rest = regel.trim().strip_prefix("printer ")?;
            let naam = rest.split_whitespace().next()?.to_string();
            Some(CupsPrinter {
                staat: if rest.contains("disabled") { 5 } else { 3 },
                accepteert: true,
                standaard: naam == standaard_naam,
                naam,
                ..CupsPrinter::default()
            })
        })
        .collect()
}

/// PrinterStatus in the Win32_Printer shape the JS side shares with Windows:
/// 3 idle, 4 printing, 0 for a stopped queue (as before with lpstat).
fn printer_status(staat: i32) -> i32 {
    match staat {
        4 => 4,
        5 => 0,
        _ => 3,
    }
}

/// The JSON array `get_printers` returns: the Windows shape (Name,
/// DriverName, PortName, Default, PrinterStatus) plus what CUPS knows extra.
/// With `portaal` the print-dialog entry is added (default when it is the
/// only one).
pub fn printers_json(printers: &[CupsPrinter], bron: Backend, portaal: bool) -> String {
    let mut lijst: Vec<serde_json::Value> = printers
        .iter()
        .map(|p| {
            json!({
                "Name": p.naam,
                "DriverName": "CUPS",
                "PortName": "",
                "Default": p.standaard,
                "PrinterStatus": printer_status(p.staat),
                "AcceptingJobs": p.accepteert,
                "ColorSupported": p.kleur,
                "MediaSupported": p.media,
                "MediaDefault": p.media_standaard,
                "Comment": p.info,
                "Model": p.model,
                "Backend": bron.naam(),
            })
        })
        .collect();
    if portaal {
        lijst.push(json!({
            "Name": PORTAAL_PRINTER,
            "DriverName": "xdg-desktop-portal",
            "PortName": "",
            "Default": printers.iter().all(|p| !p.standaard),
            "PrinterStatus": 3,
            "Backend": Backend::Portaal.naam(),
        }));
    }
    serde_json::Value::Array(lijst).to_string()
}

// ---------------------------------------------------------------------------
// Job options
// ---------------------------------------------------------------------------

/// The colour mode of the Print dialog ('color' | 'grayscale' | 'bw') as an
/// `-o` option. Colour leaves the printer default alone, as before.
pub fn kleur_optie(kleur: Option<&str>) -> Option<String> {
    match kleur {
        Some("grayscale") | Some("bw") => Some("print-color-mode=monochrome".to_string()),
        _ => None,
    }
}

/// The `lp` options as IPP job attributes. Same names and values (lp sends
/// them the same way), so both routes ask the printer for the same thing.
pub fn ipp_job_attributen(lp_opties: &[String]) -> Result<Vec<(u8, String, Waarde)>, String> {
    let mut uit = Vec::new();
    for paar in lp_opties.chunks(2) {
        let [o, optie] = paar else { return Err(format!("incomplete lp option {paar:?}")) };
        if o != "-o" {
            return Err(format!("unexpected lp argument {o}"));
        }
        let (naam, waarde) = optie.split_once('=').ok_or_else(|| format!("lp option without value: {optie}"))?;
        let (tag, w) = match naam {
            "orientation-requested" => {
                let g = waarde.parse().map_err(|_| format!("bad orientation {waarde}"))?;
                (cups_ipp::TAG_ENUM, Waarde::Geheel(g))
            }
            "copies" => {
                let g = waarde.parse().map_err(|_| format!("bad copies {waarde}"))?;
                (cups_ipp::TAG_INTEGER, Waarde::Geheel(g))
            }
            _ => (cups_ipp::TAG_KEYWORD, Waarde::Tekst(waarde.to_string())),
        };
        uit.push((tag, naam.to_string(), w));
    }
    Ok(uit)
}

/// The Print-Job request for `printer` (an empty name is resolved to the
/// default by the caller).
pub fn print_job_verzoek(
    server: &Server,
    printer: &str,
    gebruiker: &str,
    jobnaam: &str,
    lp_opties: &[String],
) -> Result<Verzoek, String> {
    let mut v = Verzoek::nieuw(cups_ipp::OP_PRINT_JOB, 1);
    v.tekst(cups_ipp::TAG_OPERATIE, cups_ipp::TAG_URI, "printer-uri", &cups_ipp::printer_uri(server, printer));
    if !gebruiker.is_empty() {
        v.tekst(cups_ipp::TAG_OPERATIE, cups_ipp::TAG_NAAM, "requesting-user-name", gebruiker);
    }
    if !jobnaam.is_empty() {
        v.tekst(cups_ipp::TAG_OPERATIE, cups_ipp::TAG_NAAM, "job-name", jobnaam);
    }
    v.tekst(cups_ipp::TAG_OPERATIE, cups_ipp::TAG_MIME, "document-format", "application/pdf");
    for (tag, naam, w) in ipp_job_attributen(lp_opties)? {
        v.attribuut(cups_ipp::TAG_JOB, tag, &naam, vec![w]);
    }
    Ok(v)
}

/// The job name: the temp file is named after the document.
pub fn jobnaam(pad: &Path) -> String {
    pad.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn fouten_samen(fouten: &[String]) -> String {
    fouten.join("; ")
}

// ---------------------------------------------------------------------------
// Talking to CUPS
// ---------------------------------------------------------------------------

const LIJST_WACHTTIJD: Duration = Duration::from_secs(15);
const JOB_WACHTTIJD: Duration = Duration::from_secs(120);

fn ipp_fout(b: &Bericht, wat: &str) -> String {
    match b.status_melding() {
        Some(m) => format!("{wat}: IPP status 0x{:04x} ({m})", b.code),
        None => format!("{wat}: IPP status 0x{:04x}", b.code),
    }
}

fn ipp_server_standaard(server: &Server) -> Option<String> {
    let mut v = Verzoek::nieuw(cups_ipp::OP_CUPS_GET_DEFAULT, 2);
    v.teksten(cups_ipp::TAG_OPERATIE, cups_ipp::TAG_KEYWORD, "requested-attributes", &["printer-name"]);
    let b = cups_ipp::verstuur(server, "/", &v, None, LIJST_WACHTTIJD).ok()?;
    if !b.is_gelukt() {
        return None;
    }
    printers_uit_ipp(&b).into_iter().next().map(|p| p.naam)
}

fn ipp_printers_van(server: &Server) -> Result<Vec<CupsPrinter>, String> {
    let mut v = Verzoek::nieuw(cups_ipp::OP_CUPS_GET_PRINTERS, 1);
    v.teksten(cups_ipp::TAG_OPERATIE, cups_ipp::TAG_KEYWORD, "requested-attributes", GEVRAAGDE_ATTRIBUTEN);
    let b = cups_ipp::verstuur(server, "/", &v, None, LIJST_WACHTTIJD)?;
    if b.code == cups_ipp::STATUS_NIET_GEVONDEN {
        return Ok(Vec::new()); // "no printers": not an error
    }
    if !b.is_gelukt() {
        return Err(ipp_fout(&b, "CUPS-Get-Printers"));
    }
    let mut printers = printers_uit_ipp(&b);
    let lpoptions = dirs::home_dir().and_then(|h| std::fs::read_to_string(h.join(".cups/lpoptions")).ok());
    let gebruiker = gebruikers_standaard(
        std::env::var("LPDEST").ok().as_deref(),
        std::env::var("PRINTER").ok().as_deref(),
        lpoptions.as_deref(),
    );
    let server_standaard = ipp_server_standaard(server);
    kies_standaard(&mut printers, gebruiker.as_deref(), server_standaard.as_deref());
    Ok(printers)
}

/// First server that answers wins.
fn ipp_printers() -> Result<Vec<CupsPrinter>, String> {
    let mut fouten = Vec::new();
    for server in cups_ipp::kandidaten_van_systeem() {
        match ipp_printers_van(&server) {
            Ok(p) => return Ok(p),
            Err(e) => fouten.push(e),
        }
    }
    Err(format!("CUPS (IPP): {}", fouten_samen(&fouten)))
}

fn lpstat_printers() -> Result<Vec<CupsPrinter>, String> {
    let output = std::process::Command::new("lpstat")
        .arg("-p")
        .output()
        .map_err(|e| format!("lpstat: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // No printers configured is not an error.
        if stderr.trim().is_empty() {
            return Ok(Vec::new());
        }
        return Err(format!("lpstat: {}", stderr.trim()));
    }
    let standaard = std::process::Command::new("lpstat")
        .arg("-d")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    Ok(parse_lpstat(&String::from_utf8_lossy(&output.stdout), &standaard))
}

/// The printer list as JSON for `get_printers`. Errors only when every
/// backend failed and there is no portal to fall back on.
pub fn lijst_printers(sandbox: bool) -> Result<String, String> {
    let macos = cfg!(target_os = "macos");
    let portaal_mogelijk = sandbox && !macos;
    let mut fouten = Vec::new();
    for backend in lijst_volgorde(macos, programma_aanwezig("lpstat")) {
        let uitkomst = match backend {
            Backend::Ipp => ipp_printers(),
            Backend::Lp => lpstat_printers(),
            Backend::Portaal => continue,
        };
        match uitkomst {
            Ok(printers) => {
                let portaal = portaal_mogelijk && printers.is_empty();
                return Ok(printers_json(&printers, backend, portaal));
            }
            Err(e) => fouten.push(e),
        }
    }
    if !programma_aanwezig("lpstat") {
        fouten.push("lpstat: not installed".to_string());
    }
    if portaal_mogelijk {
        log::warn!("printer list: {}; offering the system print dialog", fouten_samen(&fouten));
        return Ok(printers_json(&[], Backend::Portaal, true));
    }
    Err(format!("No printer list: {}", fouten_samen(&fouten)))
}

fn ipp_print(pad: &Path, printer: &str, lp_opties: &[String]) -> Result<(), String> {
    let gebruiker = whoami::username();
    let jobnaam = jobnaam(pad);
    let mut fouten = Vec::new();
    for server in cups_ipp::kandidaten_van_systeem() {
        let wachtrij = if printer.is_empty() {
            match ipp_server_standaard(&server) {
                Some(n) => n,
                None => {
                    fouten.push(format!("{}: no default printer", server.beschrijving()));
                    continue;
                }
            }
        } else {
            printer.to_string()
        };
        let verzoek = print_job_verzoek(&server, &wachtrij, &gebruiker, &jobnaam, lp_opties)?;
        match cups_ipp::verstuur(&server, &cups_ipp::printer_pad(&wachtrij), &verzoek, Some(pad), JOB_WACHTTIJD) {
            Ok(b) if b.is_gelukt() => return Ok(()),
            // The scheduler answered and refused: another server will not do better.
            Ok(b) => return Err(format!("CUPS (IPP) refused the job: {}", ipp_fout(&b, "Print-Job"))),
            Err(e) => fouten.push(e),
        }
    }
    Err(format!("CUPS (IPP): {}", fouten_samen(&fouten)))
}

fn lp_print(pad: &Path, printer: &str, lp_opties: &[String]) -> Result<(), String> {
    let mut cmd = std::process::Command::new("lp");
    // No queue name means "system default", which is what lp does without -d.
    if !printer.is_empty() {
        cmd.arg("-d").arg(printer);
    }
    // The caller always passes an absolute temp path, so the filename can
    // never be mistaken for an option; `--` is not portable across lp
    // implementations and is deliberately left out.
    let output = cmd.args(lp_opties).arg(pad).output().map_err(|e| format!("lp: {e}"))?;
    if !output.status.success() {
        // lp reports rejected jobs on stderr, but a few builds use stdout.
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        let detail = if detail.is_empty() { "no output".to_string() } else { detail };
        return Err(format!("lp could not queue the job: {detail}"));
    }
    Ok(())
}

/// Whether an IPP error means the scheduler refused the job itself (then
/// `lp` would be refused too and the portal is the only other way).
fn is_weigering(fout: &str) -> bool {
    fout.contains("refused the job")
}

/// Sends `pad` (a PDF) to `printer` ("" = default queue) with the given `lp`
/// options, through the first backend that works.
pub fn print_bestand(pad: &Path, printer: &str, lp_opties: &[String], sandbox: bool, kleur: Option<&str>) -> Result<(), String> {
    let printer = printer.trim();
    let macos = cfg!(target_os = "macos");
    let lp_aanwezig = programma_aanwezig("lp");
    let mut fouten: Vec<String> = Vec::new();
    for backend in print_volgorde(macos, sandbox, lp_aanwezig, printer) {
        let uitkomst = match backend {
            Backend::Ipp => ipp_print(pad, printer, lp_opties),
            Backend::Lp => {
                if fouten.iter().any(|f| is_weigering(f)) {
                    continue;
                }
                lp_print(pad, printer, lp_opties)
            }
            Backend::Portaal => portaal_print(pad, printer, lp_opties, kleur),
        };
        match uitkomst {
            Ok(()) => {
                if !fouten.is_empty() {
                    log::info!("printed through {} after: {}", backend.naam(), fouten_samen(&fouten));
                }
                return Ok(());
            }
            Err(e) => fouten.push(e),
        }
    }
    if !lp_aanwezig && printer != PORTAAL_PRINTER {
        fouten.push("lp: not installed".to_string());
    }
    Err(fouten_samen(&fouten))
}

#[cfg(target_os = "linux")]
fn portaal_print(pad: &Path, printer: &str, lp_opties: &[String], kleur: Option<&str>) -> Result<(), String> {
    let printer = if printer == PORTAAL_PRINTER { "" } else { printer };
    portaal::print(pad, &portaal::instellingen(printer, lp_opties, kleur))
}

#[cfg(not(target_os = "linux"))]
fn portaal_print(_pad: &Path, _printer: &str, _lp_opties: &[String], _kleur: Option<&str>) -> Result<(), String> {
    Err("the print portal is only available on Linux".to_string())
}

/// org.freedesktop.portal.Print: PreparePrint shows the desktop's print
/// dialog (pre-filled with our choices) and hands back a token; Print sends
/// the PDF through a file descriptor with that token, without a second
/// dialog. Both answer through an org.freedesktop.portal.Request Response
/// signal.
#[cfg(target_os = "linux")]
pub mod portaal {
    use std::collections::HashMap;
    use std::path::Path;

    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::{Fd, OwnedObjectPath, OwnedValue, Value};

    const BESTEMMING: &str = "org.freedesktop.portal.Desktop";
    const PAD: &str = "/org/freedesktop/portal/desktop";
    const INTERFACE: &str = "org.freedesktop.portal.Print";

    /// GtkPrintSettings keys (all string values) for PreparePrint.
    pub fn instellingen(printer: &str, lp_opties: &[String], kleur: Option<&str>) -> Vec<(&'static str, String)> {
        let mut uit = vec![("n-copies", "1".to_string())];
        if !printer.is_empty() {
            uit.push(("printer", printer.to_string()));
        }
        for optie in lp_opties {
            match optie.as_str() {
                "orientation-requested=3" => uit.push(("orientation", "portrait".to_string())),
                "orientation-requested=4" => uit.push(("orientation", "landscape".to_string())),
                _ => {}
            }
        }
        match kleur {
            Some("grayscale") | Some("bw") => uit.push(("use-color", "no".to_string())),
            Some("color") => uit.push(("use-color", "yes".to_string())),
            _ => {}
        }
        uit
    }

    /// The Request object path the portal will use for `token`.
    pub fn verzoek_pad(unieke_naam: &str, token: &str) -> String {
        format!("{PAD}/request/{}/{token}", unieke_naam.trim_start_matches(':').replace('.', "_"))
    }

    fn token(stap: &str) -> String {
        let nu = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("opds_{stap}_{}_{nu}", std::process::id())
    }

    fn fout(e: zbus::Error) -> String {
        format!("print portal: {e}")
    }

    /// Calls `methode` with `maak_body(handle_token)` and waits for its
    /// Response. The signal subscription is made before the call, on the
    /// path the portal will use, so the answer cannot be missed.
    fn met_antwoord<B>(conn: &Connection, methode: &str, stap: &str, body: impl FnOnce(&str) -> B) -> Result<HashMap<String, OwnedValue>, String>
    where
        B: serde::Serialize + zbus::zvariant::DynamicType,
    {
        let token = token(stap);
        let unieke = conn.unique_name().ok_or_else(|| "print portal: no D-Bus name".to_string())?;
        let pad = verzoek_pad(unieke.as_str(), &token);
        let verzoek = Proxy::new(conn, BESTEMMING, pad.clone(), "org.freedesktop.portal.Request").map_err(fout)?;
        let mut signalen = verzoek.receive_signal("Response").map_err(fout)?;
        let antwoord = conn
            .call_method(Some(BESTEMMING), PAD, Some(INTERFACE), methode, &body(&token))
            .map_err(fout)?;
        let handle: OwnedObjectPath = antwoord.body().deserialize().map_err(fout)?;
        if handle.as_str() != pad {
            // Very old portals ignore handle_token: listen on the path they gave.
            let ander = Proxy::new(conn, BESTEMMING, handle.as_str().to_string(), "org.freedesktop.portal.Request")
                .map_err(fout)?;
            signalen = ander.receive_signal("Response").map_err(fout)?;
        }
        let bericht = signalen.next().ok_or_else(|| "print portal closed the request".to_string())?;
        let (code, resultaten): (u32, HashMap<String, OwnedValue>) = bericht.body().deserialize().map_err(fout)?;
        match code {
            0 => Ok(resultaten),
            1 => Err("printing was cancelled in the print dialog".to_string()),
            _ => Err(format!("print portal {methode} failed")),
        }
    }

    pub fn print(pad: &Path, instellingen: &[(&'static str, String)]) -> Result<(), String> {
        let bestand = std::fs::File::open(pad).map_err(|e| format!("cannot open {}: {e}", pad.display()))?;
        let titel = super::jobnaam(pad);
        let conn = Connection::session().map_err(fout)?;

        let resultaten = met_antwoord(&conn, "PreparePrint", "voorbereiden", |token| {
            let settings: HashMap<&str, Value> =
                instellingen.iter().map(|(k, v)| (*k, Value::from(v.as_str()))).collect();
            let page_setup: HashMap<&str, Value> = HashMap::new();
            let mut opties: HashMap<&str, Value> = HashMap::new();
            opties.insert("handle_token", Value::from(token.to_string()));
            opties.insert("modal", Value::from(true));
            ("", titel.as_str(), settings, page_setup, opties)
        })?;
        let print_token = resultaten
            .get("token")
            .and_then(|w| u32::try_from(w).ok())
            .ok_or_else(|| "print portal returned no token".to_string())?;

        met_antwoord(&conn, "Print", "printen", |token| {
            let mut opties: HashMap<&str, Value> = HashMap::new();
            opties.insert("handle_token", Value::from(token.to_string()));
            opties.insert("token", Value::from(print_token));
            opties.insert("modal", Value::from(true));
            ("", titel.as_str(), Fd::from(&bestand), opties)
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::print_instelling::{lp_opties, Orientatie, Papier};
    use crate::print_plaatsing::Plaatsing;

    #[test]
    fn volgorde_van_de_printerlijst() {
        assert_eq!(lijst_volgorde(false, true), vec![Backend::Ipp, Backend::Lp]);
        assert_eq!(lijst_volgorde(false, false), vec![Backend::Ipp]);
        assert_eq!(lijst_volgorde(true, true), vec![Backend::Lp, Backend::Ipp]);
    }

    #[test]
    fn volgorde_van_een_printopdracht() {
        // Gewone Linux: IPP, dan lp; geen portaal buiten een sandbox.
        assert_eq!(print_volgorde(false, false, true, "Laser"), vec![Backend::Ipp, Backend::Lp]);
        assert_eq!(print_volgorde(false, false, false, "Laser"), vec![Backend::Ipp]);
        // Flatpak/Snap zonder lp: IPP, dan het portaal.
        assert_eq!(print_volgorde(false, true, false, "Laser"), vec![Backend::Ipp, Backend::Portaal]);
        assert_eq!(print_volgorde(false, true, true, ""), vec![Backend::Ipp, Backend::Lp, Backend::Portaal]);
        // De portaalregel uit de lijst gaat altijd rechtstreeks naar het portaal.
        assert_eq!(print_volgorde(false, true, true, PORTAAL_PRINTER), vec![Backend::Portaal]);
        // macOS: lp eerst, nooit het portaal.
        assert_eq!(print_volgorde(true, true, true, "Laser"), vec![Backend::Lp, Backend::Ipp]);
    }

    #[test]
    fn programma_zoeken_op_path() {
        let map = std::env::temp_dir().join(format!("opds-path-{}", std::process::id()));
        let leeg = map.join("leeg");
        let bin = map.join("bin");
        std::fs::create_dir_all(&leeg).unwrap();
        std::fs::create_dir_all(&bin).unwrap();
        let lp = bin.join("lp");
        std::fs::write(&lp, "#!/bin/sh\n").unwrap();
        let path = std::env::join_paths([&leeg, &bin]).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&lp, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert_eq!(zoek_programma("lp", Some(&path)), None, "not executable");
            std::fs::set_permissions(&lp, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(zoek_programma("lp", Some(&path)), Some(lp));
        assert_eq!(zoek_programma("lpstat", Some(&path)), None);
        assert_eq!(zoek_programma("leeg", Some(&path)), None, "a directory is no program");
        assert_eq!(zoek_programma("lp", None), None);
        std::fs::remove_dir_all(&map).unwrap();
    }

    #[test]
    fn printers_uit_een_ipp_antwoord() {
        let b = cups_ipp::decodeer(&cups_ipp::tests::printers_antwoord()).unwrap();
        let p = printers_uit_ipp(&b);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].naam, "Kantoor_Laser");
        assert_eq!(p[0].staat, 3);
        assert!(p[0].accepteert);
        assert!(p[0].standaard, "printer-type has the default bit");
        assert_eq!(p[0].kleur, Some(false));
        assert_eq!(p[0].media, vec!["iso_a4_210x297mm", "na_letter_8.5x11in"]);
        assert_eq!(p[0].media_standaard.as_deref(), Some("iso_a4_210x297mm"));
        assert_eq!(p[0].info.as_deref(), Some("Laser op kantoor"));
        assert_eq!(p[0].model.as_deref(), Some("Generic PCL Laser"));
        assert_eq!(p[1].naam, "Foto");
        assert_eq!((p[1].staat, p[1].accepteert, p[1].standaard), (5, false, false));
        assert_eq!(p[1].kleur, Some(true));
        assert_eq!(p[1].media_standaard, None, "no-value");
    }

    #[test]
    fn standaardprinter_van_gebruiker_server_of_type() {
        assert_eq!(gebruikers_standaard(Some("Foto/duplex"), Some("Laser"), None).as_deref(), Some("Foto"));
        assert_eq!(gebruikers_standaard(None, Some("Laser"), None).as_deref(), Some("Laser"));
        assert_eq!(gebruikers_standaard(None, Some("lp"), Some("Default Foto\n")).as_deref(), Some("Foto"));
        assert_eq!(gebruikers_standaard(Some(" "), None, Some("Dest Laser\ndefault Foto/a4 sides=one-sided\n")).as_deref(), Some("Foto"));
        assert_eq!(gebruikers_standaard(None, None, Some("Dest Laser media=A4\n")), None);

        let lijst = || {
            vec![
                CupsPrinter { naam: "A".into(), standaard: true, ..Default::default() },
                CupsPrinter { naam: "B".into(), ..Default::default() },
            ]
        };
        let namen = |p: &[CupsPrinter]| p.iter().filter(|p| p.standaard).map(|p| p.naam.clone()).collect::<Vec<_>>();
        let mut p = lijst();
        kies_standaard(&mut p, Some("B"), Some("A"));
        assert_eq!(namen(&p), vec!["B"]);
        let mut p = lijst();
        kies_standaard(&mut p, Some("Weg"), Some("B"));
        assert_eq!(namen(&p), vec!["B"], "a user default that no longer exists is skipped");
        let mut p = lijst();
        kies_standaard(&mut p, None, None);
        assert_eq!(namen(&p), vec!["A"], "printer-type decides last");
    }

    #[test]
    fn lpstat_uitvoer() {
        let p = parse_lpstat(
            "printer Laser is idle.  enabled since Mon 01 Jan\nprinter Foto disabled since Tue -\n\treason unknown\n",
            "system default destination: Laser\n",
        );
        assert_eq!(p.iter().map(|p| (p.naam.as_str(), p.staat, p.standaard)).collect::<Vec<_>>(),
            vec![("Laser", 3, true), ("Foto", 5, false)]);
        assert!(parse_lpstat("printer A is idle.\n", "no system default destination\n").iter().all(|p| !p.standaard));
    }

    #[test]
    fn json_houdt_de_vorm_van_windows() {
        let b = cups_ipp::decodeer(&cups_ipp::tests::printers_antwoord()).unwrap();
        let json: serde_json::Value = serde_json::from_str(&printers_json(&printers_uit_ipp(&b), Backend::Ipp, false)).unwrap();
        let lijst = json.as_array().unwrap();
        assert_eq!(lijst.len(), 2);
        assert_eq!(lijst[0]["Name"], "Kantoor_Laser");
        assert_eq!(lijst[0]["DriverName"], "CUPS");
        assert_eq!(lijst[0]["PortName"], "");
        assert_eq!(lijst[0]["Default"], true);
        assert_eq!(lijst[0]["PrinterStatus"], 3);
        assert_eq!(lijst[0]["ColorSupported"], false);
        assert_eq!(lijst[0]["Backend"], "ipp");
        assert_eq!(lijst[1]["PrinterStatus"], 0, "stopped queue as before");

        // Sandbox zonder printers: alleen de regel voor de printdialoog, als standaard.
        let json: serde_json::Value = serde_json::from_str(&printers_json(&[], Backend::Portaal, true)).unwrap();
        assert_eq!(json[0]["Name"], PORTAAL_PRINTER);
        assert_eq!(json[0]["Default"], true);
        assert_eq!(json.as_array().unwrap().len(), 1);
    }

    #[test]
    fn ipp_attributen_volgen_de_lp_opties() {
        let mut opties = lp_opties(Orientatie::Liggend, Papier::A1L, Plaatsing::Vel);
        opties.extend(kleur_optie(Some("grayscale")).map(|o| ["-o".to_string(), o]).into_iter().flatten());
        let attr = ipp_job_attributen(&opties).unwrap();
        assert_eq!(
            attr,
            vec![
                (cups_ipp::TAG_ENUM, "orientation-requested".to_string(), Waarde::Geheel(4)),
                (cups_ipp::TAG_KEYWORD, "media".to_string(), Waarde::Tekst("Custom.594x1051mm".into())),
                (cups_ipp::TAG_KEYWORD, "print-scaling".to_string(), Waarde::Tekst("none".into())),
                (cups_ipp::TAG_KEYWORD, "print-color-mode".to_string(), Waarde::Tekst("monochrome".into())),
            ]
        );
        assert!(ipp_job_attributen(&lp_opties(Orientatie::Auto, Papier::Printer, Plaatsing::Passend)).unwrap().is_empty());
        assert!(ipp_job_attributen(&["-o".into()]).is_err());
        assert!(ipp_job_attributen(&["-n".into(), "2".into()]).is_err());
        assert_eq!(kleur_optie(Some("bw")).as_deref(), Some("print-color-mode=monochrome"));
        assert_eq!(kleur_optie(Some("color")), None);
        assert_eq!(kleur_optie(None), None);
    }

    #[test]
    fn print_job_verzoek_codeert_naar_de_wachtrij() {
        let server = Server::Socket("/var/run/cups/cups.sock".into());
        let opties = lp_opties(Orientatie::Staand, Papier::A4, Plaatsing::Passend);
        let v = print_job_verzoek(&server, "Kantoor Laser", "piet", "Tekening", &opties).unwrap();
        let b = cups_ipp::decodeer(&v.codeer().unwrap()).unwrap();
        assert_eq!(b.code, cups_ipp::OP_PRINT_JOB);
        let op = &b.groepen[0];
        let namen: Vec<&str> = op.attributen.iter().map(|a| a.naam.as_str()).collect();
        assert_eq!(namen, vec![
            "attributes-charset", "attributes-natural-language", "printer-uri",
            "requesting-user-name", "job-name", "document-format",
        ]);
        assert_eq!(op.zoek("printer-uri").unwrap().tekst(), Some("ipp://localhost/printers/Kantoor%20Laser"));
        assert_eq!(op.zoek("document-format").unwrap().tag, cups_ipp::TAG_MIME);
        let job = &b.groepen[1];
        assert_eq!(job.tag, cups_ipp::TAG_JOB);
        assert_eq!(job.zoek("orientation-requested").unwrap().geheel(), Some(3));
        assert_eq!(job.zoek("media").unwrap().tekst(), Some("A4"));
        // Zonder opties geen lege jobgroep.
        let v = print_job_verzoek(&server, "A", "", "", &[]).unwrap();
        let b = cups_ipp::decodeer(&v.codeer().unwrap()).unwrap();
        assert_eq!(b.groepen.len(), 1);
        assert_eq!(jobnaam(Path::new("/tmp/x/Plattegrond begane grond.pdf")), "Plattegrond begane grond");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn portaal_instellingen_en_verzoekpad() {
        let opties = lp_opties(Orientatie::Liggend, Papier::A3, Plaatsing::Passend);
        let s = portaal::instellingen("Laser", &opties, Some("bw"));
        assert!(s.contains(&("printer", "Laser".to_string())));
        assert!(s.contains(&("orientation", "landscape".to_string())));
        assert!(s.contains(&("use-color", "no".to_string())));
        assert!(s.contains(&("n-copies", "1".to_string())));
        assert!(!portaal::instellingen("", &[], None).iter().any(|(k, _)| *k == "printer"));
        assert_eq!(
            portaal::verzoek_pad(":1.42", "opds_x"),
            "/org/freedesktop/portal/desktop/request/1_42/opds_x"
        );
    }
}
