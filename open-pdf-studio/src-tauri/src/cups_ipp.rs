//! Minimal IPP client for CUPS (RFC 8010 binary encoding, RFC 8011
//! operations), so printing does not depend on the `lpstat`/`lp` command-line
//! tools. Sandboxed packages (Flatpak, Snap) and minimal distributions often
//! ship no CUPS client tools, but they do get the CUPS socket (`--socket=cups`
//! in Flatpak, the `cups` interface in Snap).
//!
//! Only what printing needs is implemented: encoding requests with simple
//! values, decoding responses (including collections, multi-valued and
//! out-of-band values), the HTTP/1.1 framing around them (Content-Length and
//! chunked responses) and the connection to the server (a Unix domain socket
//! or TCP, chosen the way libcups does: `CUPS_SERVER`, `client.conf`, the
//! default socket, then `localhost:631`). There is no TLS and no
//! authentication: the local scheduler accepts printer queries and print jobs
//! from local users without either.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

// ---------------------------------------------------------------------------
// Tags and codes (RFC 8010 section 3.5, RFC 8011, CUPS Implementation of IPP)
// ---------------------------------------------------------------------------

pub const TAG_OPERATIE: u8 = 0x01;
pub const TAG_JOB: u8 = 0x02;
pub const TAG_EINDE: u8 = 0x03;
pub const TAG_PRINTER: u8 = 0x04;

pub const TAG_GEEN_WAARDE: u8 = 0x13;
pub const TAG_INTEGER: u8 = 0x21;
pub const TAG_BOOLEAN: u8 = 0x22;
pub const TAG_ENUM: u8 = 0x23;
pub const TAG_BEGIN_COLLECTIE: u8 = 0x34;
pub const TAG_TEKST_MET_TAAL: u8 = 0x35;
pub const TAG_NAAM_MET_TAAL: u8 = 0x36;
pub const TAG_EINDE_COLLECTIE: u8 = 0x37;
pub const TAG_TEKST: u8 = 0x41;
pub const TAG_NAAM: u8 = 0x42;
pub const TAG_KEYWORD: u8 = 0x44;
pub const TAG_URI: u8 = 0x45;
pub const TAG_CHARSET: u8 = 0x47;
pub const TAG_TAAL: u8 = 0x48;
pub const TAG_MIME: u8 = 0x49;
pub const TAG_LEDENNAAM: u8 = 0x4A;
pub const TAG_UITBREIDING: u8 = 0x7F;

pub const OP_PRINT_JOB: u16 = 0x0002;
pub const OP_GET_PRINTER_ATTRIBUTES: u16 = 0x000B;
pub const OP_CUPS_GET_DEFAULT: u16 = 0x4001;
pub const OP_CUPS_GET_PRINTERS: u16 = 0x4002;

/// `client-error-not-found`: CUPS-Get-Default without a default printer.
pub const STATUS_NIET_GEVONDEN: u16 = 0x0406;

// ---------------------------------------------------------------------------
// Values and messages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum Waarde {
    /// integer (0x21) and enum (0x23).
    Geheel(i32),
    Booleaans(bool),
    /// Every string syntax: text, name, keyword, uri, charset, language,
    /// mimeMediaType, memberAttrName; for textWithLanguage/nameWithLanguage
    /// only the text (the language is dropped).
    Tekst(String),
    /// octetString, dateTime, resolution, rangeOfInteger, extension values.
    Bytes(Vec<u8>),
    Collectie(Vec<Attribuut>),
    /// Out-of-band value (unsupported, unknown, no-value, ...): the tag.
    Buiten(u8),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Attribuut {
    pub naam: String,
    /// Value tag of the first value.
    pub tag: u8,
    pub waarden: Vec<Waarde>,
}

impl Attribuut {
    pub fn tekst(&self) -> Option<&str> {
        self.waarden.iter().find_map(|w| match w {
            Waarde::Tekst(t) => Some(t.as_str()),
            _ => None,
        })
    }
    pub fn teksten(&self) -> Vec<String> {
        self.waarden
            .iter()
            .filter_map(|w| match w {
                Waarde::Tekst(t) => Some(t.clone()),
                _ => None,
            })
            .collect()
    }
    pub fn geheel(&self) -> Option<i32> {
        self.waarden.iter().find_map(|w| match w {
            Waarde::Geheel(g) => Some(*g),
            _ => None,
        })
    }
    pub fn booleaans(&self) -> Option<bool> {
        self.waarden.iter().find_map(|w| match w {
            Waarde::Booleaans(b) => Some(*b),
            _ => None,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Groep {
    pub tag: u8,
    pub attributen: Vec<Attribuut>,
}

impl Groep {
    pub fn zoek(&self, naam: &str) -> Option<&Attribuut> {
        self.attributen.iter().find(|a| a.naam == naam)
    }
}

/// A decoded IPP message. In a response `code` is the status-code.
#[derive(Debug, Clone, PartialEq)]
pub struct Bericht {
    pub versie: (u8, u8),
    pub code: u16,
    pub verzoek_id: u32,
    pub groepen: Vec<Groep>,
    pub data: Vec<u8>,
}

impl Bericht {
    pub fn is_gelukt(&self) -> bool {
        // successful-ok .. successful-ok-* (0x0000-0x00FF)
        self.code <= 0x00FF
    }
    pub fn groepen_met(&self, tag: u8) -> impl Iterator<Item = &Groep> {
        self.groepen.iter().filter(move |g| g.tag == tag)
    }
    /// The `status-message` from the operation group, if the server sent one.
    pub fn status_melding(&self) -> Option<String> {
        self.groepen_met(TAG_OPERATIE)
            .find_map(|g| g.zoek("status-message").and_then(|a| a.tekst().map(str::to_string)))
    }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/// Builds a request. Attributes are written in the order they are added; a
/// new group starts whenever the group tag changes.
pub struct Verzoek {
    operatie: u16,
    verzoek_id: u32,
    attributen: Vec<(u8, u8, String, Vec<Waarde>)>,
}

impl Verzoek {
    /// A request with the two attributes RFC 8011 requires first:
    /// attributes-charset and attributes-natural-language.
    pub fn nieuw(operatie: u16, verzoek_id: u32) -> Self {
        let mut v = Verzoek { operatie, verzoek_id, attributen: Vec::new() };
        v.tekst(TAG_OPERATIE, TAG_CHARSET, "attributes-charset", "utf-8");
        v.tekst(TAG_OPERATIE, TAG_TAAL, "attributes-natural-language", "en");
        v
    }

    pub fn attribuut(&mut self, groep: u8, tag: u8, naam: &str, waarden: Vec<Waarde>) -> &mut Self {
        self.attributen.push((groep, tag, naam.to_string(), waarden));
        self
    }
    pub fn tekst(&mut self, groep: u8, tag: u8, naam: &str, waarde: &str) -> &mut Self {
        self.attribuut(groep, tag, naam, vec![Waarde::Tekst(waarde.to_string())])
    }
    pub fn teksten(&mut self, groep: u8, tag: u8, naam: &str, waarden: &[&str]) -> &mut Self {
        let w = waarden.iter().map(|s| Waarde::Tekst(s.to_string())).collect();
        self.attribuut(groep, tag, naam, w)
    }
    pub fn geheel(&mut self, groep: u8, tag: u8, naam: &str, waarde: i32) -> &mut Self {
        self.attribuut(groep, tag, naam, vec![Waarde::Geheel(waarde)])
    }
    pub fn booleaans(&mut self, groep: u8, naam: &str, waarde: bool) -> &mut Self {
        self.attribuut(groep, TAG_BOOLEAN, naam, vec![Waarde::Booleaans(waarde)])
    }

    /// The binary request without document data (append that after it).
    pub fn codeer(&self) -> Result<Vec<u8>, String> {
        let mut uit = Vec::with_capacity(256);
        uit.extend_from_slice(&[0x01, 0x01]); // IPP/1.1: every CUPS version speaks it
        uit.extend_from_slice(&self.operatie.to_be_bytes());
        uit.extend_from_slice(&self.verzoek_id.to_be_bytes());
        let mut huidige_groep = None;
        for (groep, tag, naam, waarden) in &self.attributen {
            if huidige_groep != Some(*groep) {
                uit.push(*groep);
                huidige_groep = Some(*groep);
            }
            if waarden.is_empty() {
                return Err(format!("IPP attribute {naam} has no value"));
            }
            for (i, w) in waarden.iter().enumerate() {
                uit.push(*tag);
                schrijf_kort(&mut uit, if i == 0 { naam.as_bytes() } else { b"" })?;
                schrijf_kort(&mut uit, &codeer_waarde(*tag, w)?)?;
            }
        }
        uit.push(TAG_EINDE);
        Ok(uit)
    }
}

fn schrijf_kort(uit: &mut Vec<u8>, bytes: &[u8]) -> Result<(), String> {
    let n = u16::try_from(bytes.len()).map_err(|_| "IPP value longer than 65535 bytes".to_string())?;
    uit.extend_from_slice(&n.to_be_bytes());
    uit.extend_from_slice(bytes);
    Ok(())
}

fn codeer_waarde(tag: u8, w: &Waarde) -> Result<Vec<u8>, String> {
    match (tag, w) {
        (TAG_INTEGER | TAG_ENUM, Waarde::Geheel(g)) => Ok(g.to_be_bytes().to_vec()),
        (TAG_BOOLEAN, Waarde::Booleaans(b)) => Ok(vec![u8::from(*b)]),
        (0x40..=0x5F, Waarde::Tekst(t)) if tag != TAG_TEKST_MET_TAAL && tag != TAG_NAAM_MET_TAAL => {
            Ok(t.as_bytes().to_vec())
        }
        (_, Waarde::Bytes(b)) => Ok(b.clone()),
        (_, Waarde::Buiten(_)) => Ok(Vec::new()),
        _ => Err(format!("cannot encode {w:?} with IPP value tag 0x{tag:02x}")),
    }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

struct Lezer<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Lezer<'a> {
    fn neem(&mut self, n: usize) -> Result<&'a [u8], String> {
        let eind = self.pos.checked_add(n).filter(|&e| e <= self.bytes.len());
        let Some(eind) = eind else {
            return Err(format!("IPP message truncated at byte {}", self.pos));
        };
        let s = &self.bytes[self.pos..eind];
        self.pos = eind;
        Ok(s)
    }
    fn byte(&mut self) -> Result<u8, String> {
        Ok(self.neem(1)?[0])
    }
    fn kort(&mut self) -> Result<u16, String> {
        let b = self.neem(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }
    fn lang(&mut self) -> Result<u32, String> {
        let b = self.neem(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }
    /// One attribute entry after its value tag: name and raw value.
    fn naam_en_waarde(&mut self) -> Result<(String, &'a [u8]), String> {
        let n = self.kort()? as usize;
        let naam = String::from_utf8_lossy(self.neem(n)?).into_owned();
        let n = self.kort()? as usize;
        Ok((naam, self.neem(n)?))
    }
}

fn decodeer_waarde(tag: u8, ruw: &[u8]) -> Result<Waarde, String> {
    let fout = || format!("IPP value with tag 0x{tag:02x} has a wrong length ({})", ruw.len());
    Ok(match tag {
        0x10..=0x1F => Waarde::Buiten(tag),
        TAG_INTEGER | TAG_ENUM => {
            let b: [u8; 4] = ruw.try_into().map_err(|_| fout())?;
            Waarde::Geheel(i32::from_be_bytes(b))
        }
        TAG_BOOLEAN => {
            let [b] = ruw else { return Err(fout()) };
            Waarde::Booleaans(*b != 0)
        }
        TAG_TEKST_MET_TAAL | TAG_NAAM_MET_TAAL => {
            // language length, language, text length, text
            let mut l = Lezer { bytes: ruw, pos: 0 };
            let n = l.kort()? as usize;
            l.neem(n)?;
            let n = l.kort()? as usize;
            Waarde::Tekst(String::from_utf8_lossy(l.neem(n)?).into_owned())
        }
        0x40..=0x5F => Waarde::Tekst(String::from_utf8_lossy(ruw).into_owned()),
        _ => Waarde::Bytes(ruw.to_vec()),
    })
}

/// The members of a collection, after its begCollection value, up to and
/// including the matching endCollection (RFC 8010 section 3.1.6).
fn decodeer_collectie(l: &mut Lezer<'_>, diepte: usize) -> Result<Vec<Attribuut>, String> {
    if diepte > 16 {
        return Err("IPP collections nested too deeply".to_string());
    }
    let mut leden: Vec<Attribuut> = Vec::new();
    loop {
        let tag = l.byte()?;
        let (_, ruw) = l.naam_en_waarde()?;
        match tag {
            TAG_EINDE_COLLECTIE => return Ok(leden),
            TAG_LEDENNAAM => leden.push(Attribuut {
                naam: String::from_utf8_lossy(ruw).into_owned(),
                tag: 0,
                waarden: Vec::new(),
            }),
            _ => {
                let waarde = if tag == TAG_BEGIN_COLLECTIE {
                    Waarde::Collectie(decodeer_collectie(l, diepte + 1)?)
                } else {
                    decodeer_waarde(tag, ruw)?
                };
                let lid = leden
                    .last_mut()
                    .ok_or_else(|| "IPP collection value without a member name".to_string())?;
                if lid.waarden.is_empty() {
                    lid.tag = tag;
                }
                lid.waarden.push(waarde);
            }
        }
    }
}

pub fn decodeer(bytes: &[u8]) -> Result<Bericht, String> {
    let mut l = Lezer { bytes, pos: 0 };
    let versie = (l.byte()?, l.byte()?);
    let code = l.kort()?;
    let verzoek_id = l.lang()?;
    let mut groepen: Vec<Groep> = Vec::new();
    loop {
        let tag = l.byte()?;
        if tag == TAG_EINDE {
            break;
        }
        if tag < 0x10 {
            groepen.push(Groep { tag, attributen: Vec::new() });
            continue;
        }
        let (naam, ruw) = l.naam_en_waarde()?;
        let waarde = if tag == TAG_BEGIN_COLLECTIE {
            Waarde::Collectie(decodeer_collectie(&mut l, 0)?)
        } else {
            decodeer_waarde(tag, ruw)?
        };
        let groep = groepen
            .last_mut()
            .ok_or_else(|| "IPP attribute outside an attribute group".to_string())?;
        if naam.is_empty() {
            // An additional value of the previous attribute.
            let vorige = groep
                .attributen
                .last_mut()
                .ok_or_else(|| "IPP additional value without an attribute".to_string())?;
            vorige.waarden.push(waarde);
        } else {
            groep.attributen.push(Attribuut { naam, tag, waarden: vec![waarde] });
        }
    }
    Ok(Bericht { versie, code, verzoek_id, groepen, data: bytes[l.pos..].to_vec() })
}

// ---------------------------------------------------------------------------
// HTTP framing
// ---------------------------------------------------------------------------

/// The HTTP request header for an IPP POST of `lengte` body bytes.
pub fn http_kop(pad: &str, host: &str, lengte: u64) -> String {
    format!(
        "POST {pad} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/ipp\r\n\
         Content-Length: {lengte}\r\nConnection: close\r\nUser-Agent: Open PDF Studio\r\n\r\n"
    )
}

/// The body of an HTTP response that was read up to the closed connection:
/// skips interim 1xx responses, rejects anything but 200 and undoes chunked
/// transfer encoding.
pub fn http_lichaam(antwoord: &[u8]) -> Result<Vec<u8>, String> {
    let mut rest = antwoord;
    loop {
        let eind = zoek(rest, b"\r\n\r\n").ok_or_else(|| "incomplete HTTP response from CUPS".to_string())?;
        let kop = String::from_utf8_lossy(&rest[..eind]).into_owned();
        rest = &rest[eind + 4..];
        let mut regels = kop.split("\r\n");
        let statusregel = regels.next().unwrap_or("");
        let mut delen = statusregel.splitn(3, ' ');
        let protocol = delen.next().unwrap_or("");
        let status: u16 = delen.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        if !protocol.starts_with("HTTP/") || status == 0 {
            return Err(format!("unexpected reply from CUPS: {statusregel:?}"));
        }
        if (100..200).contains(&status) {
            continue;
        }
        if status != 200 {
            let reden = delen.next().unwrap_or("").trim();
            return Err(format!("CUPS answered HTTP {status} {reden}").trim_end().to_string());
        }
        let mut chunked = false;
        let mut lengte: Option<usize> = None;
        for regel in regels {
            let Some((sleutel, waarde)) = regel.split_once(':') else { continue };
            let sleutel = sleutel.trim().to_ascii_lowercase();
            let waarde = waarde.trim();
            if sleutel == "transfer-encoding" && waarde.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            } else if sleutel == "content-length" {
                lengte = waarde.parse().ok();
            }
        }
        if chunked {
            return ontchunk(rest);
        }
        return Ok(match lengte {
            Some(n) if n <= rest.len() => rest[..n].to_vec(),
            Some(_) => return Err("HTTP response from CUPS is shorter than its Content-Length".to_string()),
            None => rest.to_vec(),
        });
    }
}

fn zoek(hooiberg: &[u8], naald: &[u8]) -> Option<usize> {
    hooiberg.windows(naald.len()).position(|w| w == naald)
}

fn ontchunk(mut rest: &[u8]) -> Result<Vec<u8>, String> {
    let mut uit = Vec::new();
    loop {
        let eind = zoek(rest, b"\r\n").ok_or_else(|| "broken chunked HTTP response".to_string())?;
        let regel = String::from_utf8_lossy(&rest[..eind]);
        let hex = regel.split(';').next().unwrap_or("").trim();
        let n = usize::from_str_radix(hex, 16).map_err(|_| format!("bad HTTP chunk size {hex:?}"))?;
        rest = &rest[eind + 2..];
        if n == 0 {
            return Ok(uit);
        }
        if rest.len() < n {
            return Err("truncated chunked HTTP response".to_string());
        }
        uit.extend_from_slice(&rest[..n]);
        rest = &rest[n..];
        rest = rest.strip_prefix(b"\r\n").unwrap_or(rest);
    }
}

// ---------------------------------------------------------------------------
// Server address
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Server {
    Socket(PathBuf),
    Tcp { host: String, poort: u16 },
}

impl Server {
    /// The host part of `ipp://` URIs and the HTTP Host header. CUPS accepts
    /// "localhost" on its domain socket.
    pub fn host(&self) -> String {
        match self {
            Server::Socket(_) => "localhost".to_string(),
            Server::Tcp { host, poort } if host.contains(':') => format!("[{host}]:{poort}"),
            Server::Tcp { host, poort } => format!("{host}:{poort}"),
        }
    }
    pub fn beschrijving(&self) -> String {
        match self {
            Server::Socket(p) => p.display().to_string(),
            Server::Tcp { .. } => self.host(),
        }
    }
}

/// Parses a CUPS server name the way libcups does: an absolute path is a
/// domain socket, otherwise `host`, `host:port` or `[v6]:port`, optionally
/// followed by `/version=...` (ignored).
pub fn parse_server(waarde: &str, standaard_poort: u16) -> Option<Server> {
    let waarde = waarde.trim();
    if waarde.is_empty() {
        return None;
    }
    if waarde.starts_with('/') {
        return Some(Server::Socket(PathBuf::from(waarde)));
    }
    if waarde.starts_with('~') {
        return None; // a socket in someone's home: not something we can expand reliably
    }
    let zonder_versie = waarde.split('/').next().unwrap_or(waarde);
    let (host, poort) = if let Some(v6) = zonder_versie.strip_prefix('[') {
        let (h, na) = v6.split_once(']')?;
        let poort = na.strip_prefix(':').and_then(|p| p.parse().ok()).unwrap_or(standaard_poort);
        (h.to_string(), poort)
    } else {
        match zonder_versie.rsplit_once(':') {
            Some((h, p)) if !h.contains(':') => (h.to_string(), p.parse().ok()?),
            _ => (zonder_versie.to_string(), standaard_poort),
        }
    };
    if host.is_empty() {
        return None;
    }
    Some(Server::Tcp { host, poort })
}

/// The `ServerName` from a client.conf text.
pub fn servernaam_uit_client_conf(tekst: &str) -> Option<String> {
    tekst.lines().find_map(|regel| {
        let regel = regel.trim();
        let (sleutel, waarde) = regel.split_once(char::is_whitespace)?;
        sleutel.eq_ignore_ascii_case("ServerName").then(|| waarde.trim().to_string())
    })
}

/// The domain sockets a local scheduler is known to listen on: the default
/// of most distributions and macOS, and the path the Snap `cups` interface
/// mounts the socket at.
pub const BEKENDE_SOCKETS: &[&str] =
    &["/run/cups/cups.sock", "/var/run/cups/cups.sock", "/private/var/run/cupsd", "/var/cups/cups.sock"];

/// Which servers to try, in order. `geconfigureerd` is the first of
/// `CUPS_SERVER`, `~/.cups/client.conf` and `/etc/cups/client.conf` that
/// names a server; after it come the known local sockets that exist and
/// finally `localhost` on `IPP_PORT` (default 631). Duplicates are dropped.
pub fn kandidaten(
    geconfigureerd: Option<&str>,
    ipp_poort: Option<&str>,
    bestaat: &dyn Fn(&Path) -> bool,
) -> Vec<Server> {
    let poort = ipp_poort.and_then(|p| p.trim().parse().ok()).unwrap_or(631);
    let mut lijst = Vec::new();
    if let Some(s) = geconfigureerd.and_then(|g| parse_server(g, poort)) {
        lijst.push(s);
    }
    for pad in BEKENDE_SOCKETS {
        let pad = Path::new(pad);
        if bestaat(pad) {
            lijst.push(Server::Socket(pad.to_path_buf()));
        }
    }
    lijst.push(Server::Tcp { host: "localhost".to_string(), poort });
    let mut uniek: Vec<Server> = Vec::new();
    for s in lijst {
        if !uniek.contains(&s) {
            uniek.push(s);
        }
    }
    uniek
}

/// The candidates for this process, from its environment and files.
pub fn kandidaten_van_systeem() -> Vec<Server> {
    let uit_bestand = |pad: PathBuf| std::fs::read_to_string(pad).ok().and_then(|t| servernaam_uit_client_conf(&t));
    let geconfigureerd = std::env::var("CUPS_SERVER")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| dirs::home_dir().and_then(|h| uit_bestand(h.join(".cups/client.conf"))))
        .or_else(|| uit_bestand(PathBuf::from("/etc/cups/client.conf")));
    let poort = std::env::var("IPP_PORT").ok();
    kandidaten(geconfigureerd.as_deref(), poort.as_deref(), &|p: &Path| p.exists())
}

/// `/printers/<name>` with the name percent-encoded.
pub fn printer_pad(naam: &str) -> String {
    format!("/printers/{}", urlencoding::encode(naam))
}

pub fn printer_uri(server: &Server, naam: &str) -> String {
    format!("ipp://{}{}", server.host(), printer_pad(naam))
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const MAX_ANTWOORD: u64 = 16 * 1024 * 1024;

trait Stroom: Read + Write {}
impl<T: Read + Write> Stroom for T {}

fn verbind(server: &Server, wachttijd: Duration) -> Result<Box<dyn Stroom>, String> {
    match server {
        #[cfg(unix)]
        Server::Socket(pad) => {
            let s = std::os::unix::net::UnixStream::connect(pad)
                .map_err(|e| format!("cannot connect to {}: {e}", pad.display()))?;
            s.set_read_timeout(Some(wachttijd)).ok();
            s.set_write_timeout(Some(wachttijd)).ok();
            Ok(Box::new(s))
        }
        #[cfg(not(unix))]
        Server::Socket(pad) => Err(format!("domain sockets are not supported here ({})", pad.display())),
        Server::Tcp { host, poort } => {
            use std::net::ToSocketAddrs;
            let adressen = (host.as_str(), *poort)
                .to_socket_addrs()
                .map_err(|e| format!("cannot resolve {}: {e}", server.host()))?;
            let mut laatste = format!("no address for {}", server.host());
            for adres in adressen {
                match std::net::TcpStream::connect_timeout(&adres, Duration::from_secs(3)) {
                    Ok(s) => {
                        s.set_read_timeout(Some(wachttijd)).ok();
                        s.set_write_timeout(Some(wachttijd)).ok();
                        return Ok(Box::new(s));
                    }
                    Err(e) => laatste = format!("cannot connect to {}: {e}", server.host()),
                }
            }
            Err(laatste)
        }
    }
}

/// Sends one IPP request (with optional document data streamed after it) and
/// returns the decoded response. A non-successful IPP status is returned as
/// a response, not as an error: the caller decides what it means.
pub fn verstuur(
    server: &Server,
    pad: &str,
    verzoek: &Verzoek,
    document: Option<&Path>,
    wachttijd: Duration,
) -> Result<Bericht, String> {
    let kop_ipp = verzoek.codeer()?;
    let (bestand, doc_lengte) = match document {
        Some(p) => {
            let f = std::fs::File::open(p).map_err(|e| format!("cannot open {}: {e}", p.display()))?;
            let n = f.metadata().map_err(|e| e.to_string())?.len();
            (Some(f), n)
        }
        None => (None, 0),
    };
    let mut stroom = verbind(server, wachttijd)?;
    let lengte = kop_ipp.len() as u64 + doc_lengte;
    let schrijf_fout = |e: std::io::Error| format!("sending to CUPS at {} failed: {e}", server.beschrijving());
    stroom.write_all(http_kop(pad, &server.host(), lengte).as_bytes()).map_err(schrijf_fout)?;
    stroom.write_all(&kop_ipp).map_err(schrijf_fout)?;
    if let Some(mut f) = bestand {
        std::io::copy(&mut f, &mut stroom).map_err(schrijf_fout)?;
    }
    stroom.flush().map_err(schrijf_fout)?;
    let mut antwoord = Vec::new();
    stroom
        .take(MAX_ANTWOORD)
        .read_to_end(&mut antwoord)
        .map_err(|e| format!("reading the CUPS reply from {} failed: {e}", server.beschrijving()))?;
    decodeer(&http_lichaam(&antwoord)?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// RFC 8010 appendix A.1 (Print-Job request), byte for byte: IPP/1.1,
    /// request-id 1, the operation attributes, `copies` 20 and `sides`
    /// two-sided-long-edge in the job group, then the document data.
    fn rfc_print_job() -> Vec<u8> {
        let mut b: Vec<u8> = vec![0x01, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x01];
        let mut attr = |tag: u8, naam: &str, waarde: &[u8]| {
            b.push(tag);
            b.extend_from_slice(&(naam.len() as u16).to_be_bytes());
            b.extend_from_slice(naam.as_bytes());
            b.extend_from_slice(&(waarde.len() as u16).to_be_bytes());
            b.extend_from_slice(waarde);
        };
        attr(0x47, "attributes-charset", b"utf-8");
        attr(0x48, "attributes-natural-language", b"en-us");
        attr(0x45, "printer-uri", b"ipp://printer.example.com/ipp/print/pinetree");
        attr(0x42, "job-name", b"foobar");
        attr(0x22, "ipp-attribute-fidelity", &[0x01]);
        b.push(0x02);
        let mut attr = |tag: u8, naam: &str, waarde: &[u8]| {
            b.push(tag);
            b.extend_from_slice(&(naam.len() as u16).to_be_bytes());
            b.extend_from_slice(naam.as_bytes());
            b.extend_from_slice(&(waarde.len() as u16).to_be_bytes());
            b.extend_from_slice(waarde);
        };
        attr(0x21, "copies", &20i32.to_be_bytes());
        attr(0x44, "sides", b"two-sided-long-edge");
        b.push(0x03);
        b
    }

    #[test]
    fn codeert_het_print_job_voorbeeld_uit_de_rfc() {
        let mut v = Verzoek { operatie: OP_PRINT_JOB, verzoek_id: 1, attributen: Vec::new() };
        v.tekst(TAG_OPERATIE, TAG_CHARSET, "attributes-charset", "utf-8")
            .tekst(TAG_OPERATIE, TAG_TAAL, "attributes-natural-language", "en-us")
            .tekst(TAG_OPERATIE, TAG_URI, "printer-uri", "ipp://printer.example.com/ipp/print/pinetree")
            .tekst(TAG_OPERATIE, TAG_NAAM, "job-name", "foobar")
            .booleaans(TAG_OPERATIE, "ipp-attribute-fidelity", true)
            .geheel(TAG_JOB, TAG_INTEGER, "copies", 20)
            .tekst(TAG_JOB, TAG_KEYWORD, "sides", "two-sided-long-edge");
        assert_eq!(v.codeer().unwrap(), rfc_print_job());
    }

    #[test]
    fn decodeert_het_print_job_voorbeeld_met_documentdata() {
        let mut bytes = rfc_print_job();
        bytes.extend_from_slice(b"%PDF-1.7\n");
        let b = decodeer(&bytes).unwrap();
        assert_eq!(b.versie, (1, 1));
        assert_eq!(b.code, OP_PRINT_JOB);
        assert_eq!(b.verzoek_id, 1);
        assert_eq!(b.groepen.len(), 2);
        let op = &b.groepen[0];
        assert_eq!(op.tag, TAG_OPERATIE);
        assert_eq!(op.zoek("job-name").unwrap().tekst(), Some("foobar"));
        assert_eq!(op.zoek("ipp-attribute-fidelity").unwrap().booleaans(), Some(true));
        let job = &b.groepen[1];
        assert_eq!(job.zoek("copies").unwrap().geheel(), Some(20));
        assert_eq!(job.zoek("sides").unwrap().tag, TAG_KEYWORD);
        assert_eq!(b.data, b"%PDF-1.7\n");
    }

    #[test]
    fn meerdere_waarden_krijgen_een_lege_naam() {
        let mut v = Verzoek::nieuw(OP_CUPS_GET_PRINTERS, 7);
        v.teksten(TAG_OPERATIE, TAG_KEYWORD, "requested-attributes", &["printer-name", "printer-state"]);
        let bytes = v.codeer().unwrap();
        // ... 0x44 len(20) "requested-attributes" len(12) "printer-name"
        //     0x44 0x0000 len(13) "printer-state" 0x03
        let staart: Vec<u8> = [
            &[0x44, 0x00, 0x14][..],
            b"requested-attributes",
            &[0x00, 0x0C],
            b"printer-name",
            &[0x44, 0x00, 0x00, 0x00, 0x0D],
            b"printer-state",
            &[0x03],
        ]
        .concat();
        assert!(bytes.ends_with(&staart), "{bytes:02x?}");
        let terug = decodeer(&bytes).unwrap();
        let attr = terug.groepen[0].zoek("requested-attributes").unwrap();
        assert_eq!(attr.teksten(), vec!["printer-name", "printer-state"]);
        assert_eq!(terug.groepen[0].attributen.len(), 3, "charset, language, requested-attributes");
    }

    #[test]
    fn verkeerde_waarden_worden_geweigerd() {
        let mut v = Verzoek::nieuw(OP_PRINT_JOB, 1);
        v.attribuut(TAG_JOB, TAG_INTEGER, "copies", vec![Waarde::Tekst("twee".into())]);
        assert!(v.codeer().is_err());
        let mut v = Verzoek::nieuw(OP_PRINT_JOB, 1);
        v.attribuut(TAG_JOB, TAG_INTEGER, "copies", vec![]);
        assert!(v.codeer().is_err());
    }

    /// A CUPS-Get-Printers response as cupsd sends it: two printer groups,
    /// textWithLanguage, a multi-valued keyword, a collection with a nested
    /// collection and an out-of-band no-value.
    pub(crate) fn printers_antwoord() -> Vec<u8> {
        let mut b: Vec<u8> = vec![0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02];
        fn attr(b: &mut Vec<u8>, tag: u8, naam: &str, waarde: &[u8]) {
            b.push(tag);
            b.extend_from_slice(&(naam.len() as u16).to_be_bytes());
            b.extend_from_slice(naam.as_bytes());
            b.extend_from_slice(&(waarde.len() as u16).to_be_bytes());
            b.extend_from_slice(waarde);
        }
        b.push(0x01);
        attr(&mut b, 0x47, "attributes-charset", b"utf-8");
        attr(&mut b, 0x48, "attributes-natural-language", b"en");
        attr(&mut b, 0x41, "status-message", b"successful-ok");
        // printer 1
        b.push(0x04);
        attr(&mut b, 0x42, "printer-name", b"Kantoor_Laser");
        attr(&mut b, 0x23, "printer-state", &3i32.to_be_bytes());
        attr(&mut b, 0x22, "printer-is-accepting-jobs", &[1]);
        attr(&mut b, 0x23, "printer-type", &0x0002_100Ci32.to_be_bytes());
        attr(&mut b, 0x22, "color-supported", &[0]);
        attr(&mut b, 0x44, "media-supported", b"iso_a4_210x297mm");
        attr(&mut b, 0x44, "", b"na_letter_8.5x11in");
        attr(&mut b, 0x44, "media-default", b"iso_a4_210x297mm");
        // printer-info as textWithLanguage: lang "nl", text "Laser op kantoor"
        let mut info = vec![0x00, 0x02];
        info.extend_from_slice(b"nl");
        info.extend_from_slice(&(16u16).to_be_bytes());
        info.extend_from_slice(b"Laser op kantoor");
        attr(&mut b, 0x35, "printer-info", &info);
        // media-col-default = { media-size = { x-dimension 21000 }, media-type "stationery" }
        attr(&mut b, 0x34, "media-col-default", b"");
        attr(&mut b, 0x4A, "", b"media-size");
        attr(&mut b, 0x34, "", b"");
        attr(&mut b, 0x4A, "", b"x-dimension");
        attr(&mut b, 0x21, "", &21000i32.to_be_bytes());
        attr(&mut b, 0x37, "", b"");
        attr(&mut b, 0x4A, "", b"media-type");
        attr(&mut b, 0x44, "", b"stationery");
        attr(&mut b, 0x37, "", b"");
        attr(&mut b, 0x41, "printer-make-and-model", b"Generic PCL Laser");
        // printer 2
        b.push(0x04);
        attr(&mut b, 0x42, "printer-name", b"Foto");
        attr(&mut b, 0x23, "printer-state", &5i32.to_be_bytes());
        attr(&mut b, 0x22, "printer-is-accepting-jobs", &[0]);
        attr(&mut b, 0x22, "color-supported", &[1]);
        attr(&mut b, 0x13, "media-default", b"");
        b.push(0x03);
        b
    }

    #[test]
    fn decodeert_een_printerlijst_met_collecties_en_taal() {
        let b = decodeer(&printers_antwoord()).unwrap();
        assert!(b.is_gelukt());
        assert_eq!(b.status_melding().as_deref(), Some("successful-ok"));
        let printers: Vec<&Groep> = b.groepen_met(TAG_PRINTER).collect();
        assert_eq!(printers.len(), 2);
        let p = printers[0];
        assert_eq!(p.zoek("printer-info").unwrap().tekst(), Some("Laser op kantoor"));
        assert_eq!(
            p.zoek("media-supported").unwrap().teksten(),
            vec!["iso_a4_210x297mm", "na_letter_8.5x11in"]
        );
        let col = p.zoek("media-col-default").unwrap();
        let Waarde::Collectie(leden) = &col.waarden[0] else { panic!("{col:?}") };
        assert_eq!(leden.len(), 2);
        assert_eq!(leden[0].naam, "media-size");
        let Waarde::Collectie(maat) = &leden[0].waarden[0] else { panic!() };
        assert_eq!(maat[0].naam, "x-dimension");
        assert_eq!(maat[0].geheel(), Some(21000));
        assert_eq!(leden[1].tekst(), Some("stationery"));
        // The attribute after the collection still lands in the right group.
        assert_eq!(p.zoek("printer-make-and-model").unwrap().tekst(), Some("Generic PCL Laser"));
        let foto = printers[1];
        assert_eq!(foto.zoek("media-default").unwrap().waarden, vec![Waarde::Buiten(TAG_GEEN_WAARDE)]);
        assert_eq!(foto.zoek("printer-state").unwrap().geheel(), Some(5));
    }

    #[test]
    fn afgekapte_of_kapotte_berichten_geven_een_fout() {
        let heel = printers_antwoord();
        for n in [0, 3, 8, 12, heel.len() - 1] {
            assert!(decodeer(&heel[..n]).is_err(), "cut at {n}");
        }
        // integer with three bytes
        let mut b = vec![0x01, 0x01, 0x00, 0x00, 0, 0, 0, 1, 0x01, 0x21, 0x00, 0x01, b'x', 0x00, 0x03, 1, 2, 3, 0x03];
        assert!(decodeer(&b).is_err());
        // value before any group
        b = vec![0x01, 0x01, 0x00, 0x00, 0, 0, 0, 1, 0x21, 0x00, 0x01, b'x', 0x00, 0x04, 0, 0, 0, 1, 0x03];
        assert!(decodeer(&b).is_err());
    }

    #[test]
    fn foutstatus_met_melding() {
        let mut b: Vec<u8> = vec![0x01, 0x01, 0x04, 0x06, 0, 0, 0, 9, 0x01];
        b.extend_from_slice(&[0x41, 0x00, 0x0E]);
        b.extend_from_slice(b"status-message");
        b.extend_from_slice(&[0x00, 0x13]);
        b.extend_from_slice(b"No default printer.");
        b.push(0x03);
        let bericht = decodeer(&b).unwrap();
        assert!(!bericht.is_gelukt());
        assert_eq!(bericht.code, STATUS_NIET_GEVONDEN);
        assert_eq!(bericht.status_melding().as_deref(), Some("No default printer."));
    }

    #[test]
    fn http_met_lengte_chunks_en_tussenantwoord() {
        let ipp = printers_antwoord();
        let mut gewoon = format!("HTTP/1.1 200 OK\r\nContent-Type: application/ipp\r\nContent-Length: {}\r\n\r\n", ipp.len())
            .into_bytes();
        gewoon.extend_from_slice(&ipp);
        assert_eq!(http_lichaam(&gewoon).unwrap(), ipp);

        let (a, z) = ipp.split_at(10);
        let mut chunked = b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
        chunked.extend_from_slice(format!("{:x}\r\n", a.len()).as_bytes());
        chunked.extend_from_slice(a);
        chunked.extend_from_slice(format!("\r\n{:X};ext=1\r\n", z.len()).as_bytes());
        chunked.extend_from_slice(z);
        chunked.extend_from_slice(b"\r\n0\r\n\r\n");
        assert_eq!(http_lichaam(&chunked).unwrap(), ipp);

        let fout = http_lichaam(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n").unwrap_err();
        assert!(fout.contains("401"), "{fout}");
        assert!(http_lichaam(b"garbage").is_err());
        assert!(http_lichaam(b"HTTP/1.1 200 OK\r\nContent-Length: 50\r\n\r\nshort").is_err());
    }

    #[test]
    fn http_kop_voor_ipp() {
        let kop = http_kop("/printers/A", "localhost", 42);
        assert!(kop.starts_with("POST /printers/A HTTP/1.1\r\n"));
        assert!(kop.contains("\r\nHost: localhost\r\n"));
        assert!(kop.contains("\r\nContent-Type: application/ipp\r\n"));
        assert!(kop.contains("\r\nContent-Length: 42\r\n"));
        assert!(kop.ends_with("\r\n\r\n"));
        assert!(!kop.contains("Expect"), "no 100-continue round trip");
    }

    #[test]
    fn servernamen_zoals_libcups() {
        assert_eq!(parse_server("/var/run/cups/cups.sock", 631), Some(Server::Socket("/var/run/cups/cups.sock".into())));
        assert_eq!(parse_server("print.local", 631), Some(Server::Tcp { host: "print.local".into(), poort: 631 }));
        assert_eq!(parse_server("print.local:8631", 631), Some(Server::Tcp { host: "print.local".into(), poort: 8631 }));
        assert_eq!(parse_server("print.local/version=1.1", 631), Some(Server::Tcp { host: "print.local".into(), poort: 631 }));
        assert_eq!(parse_server("[::1]:632", 631), Some(Server::Tcp { host: "::1".into(), poort: 632 }));
        assert_eq!(parse_server("::1", 631), Some(Server::Tcp { host: "::1".into(), poort: 631 }));
        assert_eq!(parse_server("  ", 631), None);
        assert_eq!(parse_server("~/.cups/sock", 631), None);
        assert_eq!(parse_server("host:geen", 631), None);
        assert_eq!(
            servernaam_uit_client_conf("# comment\r\nEncryption Never\r\nservername  /tmp/cups.sock\r\n").as_deref(),
            Some("/tmp/cups.sock")
        );
        assert_eq!(servernaam_uit_client_conf("Encryption Never\n"), None);
    }

    #[test]
    fn volgorde_van_de_servers() {
        // Flatpak: CUPS_SERVER points at the mounted socket.
        let flatpak = kandidaten(Some("/var/run/cups/cups.sock"), None, &|p: &Path| p == Path::new("/var/run/cups/cups.sock"));
        assert_eq!(
            flatpak,
            vec![Server::Socket("/var/run/cups/cups.sock".into()), Server::Tcp { host: "localhost".into(), poort: 631 }]
        );
        // Nothing configured, only the Snap socket exists.
        let snap = kandidaten(None, Some("8631"), &|p: &Path| p == Path::new("/var/cups/cups.sock"));
        assert_eq!(
            snap,
            vec![Server::Socket("/var/cups/cups.sock".into()), Server::Tcp { host: "localhost".into(), poort: 8631 }]
        );
        // A remote server first, then the local fallbacks.
        let remote = kandidaten(Some("print.local"), None, &|_: &Path| false);
        assert_eq!(remote[0], Server::Tcp { host: "print.local".into(), poort: 631 });
        assert_eq!(remote.last(), Some(&Server::Tcp { host: "localhost".into(), poort: 631 }));
    }

    #[test]
    fn printer_uri_en_pad() {
        let sock = Server::Socket("/run/cups/cups.sock".into());
        assert_eq!(printer_uri(&sock, "Kantoor Laser"), "ipp://localhost/printers/Kantoor%20Laser");
        let v6 = Server::Tcp { host: "::1".into(), poort: 631 };
        assert_eq!(printer_uri(&v6, "A"), "ipp://[::1]:631/printers/A");
        assert_eq!(printer_pad("a/b#c"), "/printers/a%2Fb%23c");
    }
}
