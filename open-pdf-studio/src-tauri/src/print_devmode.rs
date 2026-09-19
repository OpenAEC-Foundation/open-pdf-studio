//! DEVMODE van een Windows-printer: ophalen, laten valideren door de driver,
//! papier en oriëntatie zetten, en het vel beschrijven (`PapierInfo`).
//!
//! Een DEVMODE is een publiek deel (`DEVMODEW`, `dmSize` bytes) met direct
//! daarachter een driver-eigen deel (`dmDriverExtra` bytes). Veel drivers
//! bewaren hun instellingen, ook het papier, in dat eigen deel en controleren
//! een DEVMODE tegen hun eigen standaard. Daarom werken we hier altijd met de
//! volledige DEVMODE zoals de driver hem teruggeeft, en nooit met een zelf
//! gevulde, verder lege `DEVMODEW`.
//!
//! Nooit `DM_UPDATE` en nooit `SetPrinter`: niets hier verandert de standaard
//! van de printer of van de gebruiker.
//!
//! Aantal exemplaren: de app maakt kopieën zelf (één opdracht per kopie, zie
//! print-job.js). Een opdracht-DEVMODE vraagt daarom altijd één exemplaar,
//! anders vermenigvuldigen een aantal uit de eigenschappen of de
//! voorkeursinstellingen en het veld Exemplaren in de printdialoog elkaar.

use std::mem::size_of;

use windows_sys::Win32::Foundation::{HANDLE, HWND, POINT};
use windows_sys::Win32::Graphics::Gdi::{
    DEVMODEW, DMORIENT_LANDSCAPE, DMORIENT_PORTRAIT, DM_COPIES, DM_FORMNAME, DM_IN_BUFFER, DM_IN_PROMPT,
    DM_ORIENTATION, DM_OUT_BUFFER, DM_PAPERLENGTH, DM_PAPERSIZE, DM_PAPERWIDTH,
};
use windows_sys::Win32::Graphics::Printing::{ClosePrinter, DocumentPropertiesW, OpenPrinterW};
use windows_sys::Win32::Storage::Xps::{DeviceCapabilitiesW, DC_PAPERNAMES, DC_PAPERS, DC_PAPERSIZE};
use windows_sys::Win32::UI::WindowsAndMessaging::{IDCANCEL, IDOK};

use crate::print_instelling::{beschrijft_vel, dmpaper, EigenschappenKeuze, Orientatie, Papier, PapierInfo};

/// UTF-16 met afsluitende nul, voor de W-functies.
pub fn breed(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn uit_breed(tekens: &[u16]) -> String {
    let eind = tekens.iter().position(|&c| c == 0).unwrap_or(tekens.len());
    String::from_utf16_lossy(&tekens[..eind])
}

/// Het publieke deel moet minstens tot en met `dmFormName` lopen: alle velden
/// die we lezen of schrijven liggen daarvoor (DEVMODE-versies van vóór
/// `dmFormName` bestaan niet meer).
const MIN_PUBLIEK: usize = std::mem::offset_of!(DEVMODEW, dmFormName) + size_of::<[u16; 32]>();

/// Een volledige DEVMODE (publiek deel plus driverdeel) in een buffer die
/// uitgelijnd is voor `DEVMODEW` en altijd minstens `size_of::<DEVMODEW>()`
/// groot, zodat elk publiek veld veilig te lezen is.
#[derive(Clone)]
pub struct DevMode {
    buf: Vec<u64>,
    /// `dmSize + dmDriverExtra`: het deel dat telt.
    lengte: usize,
}

impl DevMode {
    /// Nullen-buffer voor een DEVMODE van `lengte` bytes.
    fn leeg(lengte: usize) -> DevMode {
        let bytes = lengte.max(size_of::<DEVMODEW>());
        DevMode { buf: vec![0u64; bytes.div_ceil(8)], lengte }
    }

    fn ruwe_bytes_mut(&mut self) -> &mut [u8] {
        let n = self.buf.len() * 8;
        // Veilig: u64-buffer van n bytes, elk bitpatroon is een geldige u8.
        unsafe { std::slice::from_raw_parts_mut(self.buf.as_mut_ptr() as *mut u8, n) }
    }

    fn ruwe_bytes(&self) -> &[u8] {
        let n = self.buf.len() * 8;
        unsafe { std::slice::from_raw_parts(self.buf.as_ptr() as *const u8, n) }
    }

    /// Na een aanroep die de buffer vulde: lengte uit `dmSize` en
    /// `dmDriverExtra` halen en controleren.
    fn lengte_bijwerken(&mut self) -> Result<(), String> {
        let (grootte, extra) = (self.publiek().dmSize as usize, self.publiek().dmDriverExtra as usize);
        if grootte < MIN_PUBLIEK || grootte + extra > self.buf.len() * 8 {
            return Err(format!("Ongeldige DEVMODE (dmSize {grootte}, dmDriverExtra {extra})"));
        }
        self.lengte = grootte + extra;
        Ok(())
    }

    /// Uit eerder bewaarde bytes (`bytes()`), met controle op de lengtes.
    pub fn uit_bytes(bytes: &[u8]) -> Result<DevMode, String> {
        if bytes.len() < MIN_PUBLIEK {
            return Err(format!("DEVMODE te kort ({} bytes)", bytes.len()));
        }
        let mut dm = DevMode::leeg(bytes.len());
        dm.ruwe_bytes_mut()[..bytes.len()].copy_from_slice(bytes);
        dm.lengte_bijwerken()?;
        if dm.lengte > bytes.len() {
            return Err("DEVMODE afgekapt".to_string());
        }
        Ok(dm)
    }

    /// De volledige DEVMODE als bytes (publiek deel plus driverdeel).
    pub fn bytes(&self) -> Vec<u8> {
        self.ruwe_bytes()[..self.lengte].to_vec()
    }

    pub fn ptr(&self) -> *const DEVMODEW {
        self.buf.as_ptr() as *const DEVMODEW
    }

    fn ptr_mut(&mut self) -> *mut DEVMODEW {
        self.buf.as_mut_ptr() as *mut DEVMODEW
    }

    /// Het publieke deel. Veilig: de buffer is uitgelijnd (u64), minstens
    /// `size_of::<DEVMODEW>()` groot en volledig geïnitialiseerd, en
    /// `DEVMODEW` bestaat alleen uit gehele getallen.
    pub fn publiek(&self) -> &DEVMODEW {
        unsafe { &*self.ptr() }
    }

    fn publiek_mut(&mut self) -> &mut DEVMODEW {
        unsafe { &mut *self.ptr_mut() }
    }

    pub fn velden(&self) -> u32 {
        self.publiek().dmFields
    }

    /// `dmPaperSize` als `DM_PAPERSIZE` gezet is.
    pub fn papiercode(&self) -> Option<i16> {
        (self.velden() & DM_PAPERSIZE != 0).then(|| unsafe { self.publiek().Anonymous1.Anonymous1.dmPaperSize })
    }

    /// `dmPaperWidth` x `dmPaperLength` in 0,1 mm als beide gezet en positief zijn.
    pub fn eigen_maat_tiende_mm(&self) -> Option<(i32, i32)> {
        if self.velden() & (DM_PAPERWIDTH | DM_PAPERLENGTH) != (DM_PAPERWIDTH | DM_PAPERLENGTH) {
            return None;
        }
        let v = unsafe { self.publiek().Anonymous1.Anonymous1 };
        (v.dmPaperWidth > 0 && v.dmPaperLength > 0).then_some((v.dmPaperWidth as i32, v.dmPaperLength as i32))
    }

    /// `dmFormName` als `DM_FORMNAME` gezet is en de naam niet leeg is.
    pub fn formuliernaam(&self) -> Option<String> {
        if self.velden() & DM_FORMNAME == 0 {
            return None;
        }
        let naam = uit_breed(&self.publiek().dmFormName);
        let naam = naam.trim();
        (!naam.is_empty()).then(|| naam.to_string())
    }

    /// `dmOrientation` (`DMORIENT_*`); zonder `DM_ORIENTATION` staand.
    pub fn orientatie_code(&self) -> i16 {
        if self.velden() & DM_ORIENTATION == 0 {
            return DMORIENT_PORTRAIT as i16;
        }
        unsafe { self.publiek().Anonymous1.Anonymous1.dmOrientation }
    }

    pub fn liggend(&self) -> bool {
        self.orientatie_code() == DMORIENT_LANDSCAPE as i16
    }

    /// Zet het papier. Een formuliernaam of eigen maat zou de code overrulen,
    /// dus die gaan eruit (vlag weg en veld leeg).
    pub fn zet_papier(&mut self, code: i16) {
        let d = self.publiek_mut();
        d.dmFields |= DM_PAPERSIZE;
        d.dmFields &= !(DM_PAPERLENGTH | DM_PAPERWIDTH | DM_FORMNAME);
        d.dmFormName = [0; 32];
        // Schrijven in een union-veld is veilig; alleen lezen vraagt `unsafe`.
        d.Anonymous1.Anonymous1.dmPaperSize = code;
        d.Anonymous1.Anonymous1.dmPaperLength = 0;
        d.Anonymous1.Anonymous1.dmPaperWidth = 0;
    }

    /// Zet alleen de oriëntatie; al het andere blijft.
    pub fn zet_liggend(&mut self, liggend: bool) {
        let d = self.publiek_mut();
        d.dmFields |= DM_ORIENTATION;
        d.Anonymous1.Anonymous1.dmOrientation =
            (if liggend { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT }) as i16;
    }

    /// `dmCopies` als `DM_COPIES` gezet is.
    pub fn exemplaren(&self) -> Option<i16> {
        (self.velden() & DM_COPIES != 0).then(|| unsafe { self.publiek().Anonymous1.Anonymous1.dmCopies })
    }

    /// Eén exemplaar per opdracht: de app maakt kopieën zelf.
    pub fn zet_een_exemplaar(&mut self) {
        let d = self.publiek_mut();
        d.dmFields |= DM_COPIES;
        d.Anonymous1.Anonymous1.dmCopies = 1;
    }

    /// Alleen voor proeven: een aantal zoals het eigenschappenvenster het kan zetten.
    #[cfg(test)]
    pub fn zet_exemplaren_voor_proef(&mut self, n: i16) {
        let d = self.publiek_mut();
        d.dmFields |= DM_COPIES;
        d.Anonymous1.Anonymous1.dmCopies = n;
    }

    /// De velden die samen het papier bepalen, om twee DEVMODE's te
    /// vergelijken als geen van beide een beschrijfbaar vel heeft.
    fn papier_velden(&self) -> (Option<i16>, Option<(i32, i32)>, Option<String>) {
        (self.papiercode(), self.eigen_maat_tiende_mm(), self.formuliernaam())
    }
}

/// Een geopende printer; `ClosePrinter` gebeurt in `Drop`, dus op elk pad.
pub struct Printer {
    handle: HANDLE,
    naam: Vec<u16>,
    tekst: String,
}

impl Drop for Printer {
    fn drop(&mut self) {
        unsafe {
            ClosePrinter(self.handle);
        }
    }
}

impl Printer {
    /// Opent de printer alleen om te lezen; er start geen opdracht.
    pub fn open(naam: &str) -> Result<Printer, String> {
        let naam_w = breed(naam);
        let mut handle: HANDLE = std::ptr::null_mut();
        let gelukt = unsafe { OpenPrinterW(naam_w.as_ptr(), &mut handle, std::ptr::null()) };
        if gelukt == 0 || handle.is_null() {
            return Err(format!("Cannot open printer '{naam}'"));
        }
        Ok(Printer { handle, naam: naam_w, tekst: naam.to_string() })
    }

    pub fn naam(&self) -> &str {
        &self.tekst
    }

    /// De ruwe handle, alleen voor proeven (bijv. GetPrinterW).
    #[cfg(test)]
    pub fn handle_voor_proef(&self) -> HANDLE {
        self.handle
    }

    /// Hoeveel bytes de volledige DEVMODE van deze driver beslaat.
    fn devmode_grootte(&self) -> Result<usize, String> {
        let n = unsafe {
            DocumentPropertiesW(
                std::ptr::null_mut(),
                self.handle,
                self.naam.as_ptr(),
                std::ptr::null_mut(),
                std::ptr::null(),
                0,
            )
        };
        if n <= 0 || (n as usize) < MIN_PUBLIEK {
            return Err(format!("DocumentProperties gaf geen DEVMODE-grootte ({n})"));
        }
        Ok(n as usize)
    }

    /// De huidige standaard van de driver voor deze gebruiker (`DM_OUT_BUFFER`).
    pub fn standaard(&self) -> Result<DevMode, String> {
        let mut uit = DevMode::leeg(self.devmode_grootte()?);
        let r = unsafe {
            DocumentPropertiesW(
                std::ptr::null_mut(),
                self.handle,
                self.naam.as_ptr(),
                uit.ptr_mut(),
                std::ptr::null(),
                DM_OUT_BUFFER,
            )
        };
        if r != IDOK {
            return Err(format!("DocumentProperties (standaard) mislukte ({r})"));
        }
        uit.lengte_bijwerken()?;
        Ok(uit)
    }

    /// Laat de driver `invoer` samenvoegen met zijn eigen instellingen en
    /// controleren (`DM_IN_BUFFER | DM_OUT_BUFFER`). Geeft een nieuwe,
    /// volledige DEVMODE terug.
    pub fn valideren(&self, invoer: &DevMode) -> Result<DevMode, String> {
        let mut uit = DevMode::leeg(self.devmode_grootte()?);
        let r = unsafe {
            DocumentPropertiesW(
                std::ptr::null_mut(),
                self.handle,
                self.naam.as_ptr(),
                uit.ptr_mut(),
                invoer.ptr(),
                DM_IN_BUFFER | DM_OUT_BUFFER,
            )
        };
        if r != IDOK {
            return Err(format!("DocumentProperties (valideren) mislukte ({r})"));
        }
        uit.lengte_bijwerken()?;
        Ok(uit)
    }

    /// Toont het eigenschappenvenster van de driver, modaal voor venster
    /// `eigenaar` (een HWND als getal, 0 = geen eigenaar), en wacht erop.
    /// Vooringevuld met `invoer`, anders met de standaard.
    /// OK -> `Some(devmode)`, Annuleren -> `None`.
    pub fn eigenschappen_venster(&self, eigenaar: usize, invoer: Option<&DevMode>) -> Result<Option<DevMode>, String> {
        let mut uit = DevMode::leeg(self.devmode_grootte()?);
        let mut modus = DM_IN_PROMPT | DM_OUT_BUFFER;
        if invoer.is_some() {
            modus |= DM_IN_BUFFER;
        }
        let r = unsafe {
            DocumentPropertiesW(
                eigenaar as HWND,
                self.handle,
                self.naam.as_ptr(),
                uit.ptr_mut(),
                invoer.map_or(std::ptr::null(), |d| d.ptr()),
                modus,
            )
        };
        match r {
            IDOK => {
                uit.lengte_bijwerken()?;
                Ok(Some(uit))
            }
            IDCANCEL => Ok(None),
            anders => Err(format!("Printer properties dialog failed ({anders})")),
        }
    }
}

/// Een papiersoort zoals de driver hem opgeeft.
#[derive(Debug, Clone)]
pub struct DriverPapier {
    pub code: i16,
    /// Staand of zoals de driver het opgeeft, in 0,1 mm.
    pub maat_tiende_mm: (i32, i32),
    pub naam: String,
}

/// De papierlijst van de driver (`DC_PAPERS`, `DC_PAPERSIZE`, `DC_PAPERNAMES`).
/// Leeg als de driver hem niet geeft.
pub fn papierlijst(printer: &str) -> Vec<DriverPapier> {
    let naam = breed(printer);
    let aantal = |soort| unsafe {
        DeviceCapabilitiesW(naam.as_ptr(), std::ptr::null(), soort, std::ptr::null_mut(), std::ptr::null())
    };
    let n = aantal(DC_PAPERS);
    if n <= 0 || n > 4096 || aantal(DC_PAPERSIZE) != n {
        return Vec::new();
    }
    let n = n as usize;
    let mut codes = vec![0u16; n];
    let mut maten = vec![POINT { x: 0, y: 0 }; n];
    let gelezen = unsafe {
        DeviceCapabilitiesW(naam.as_ptr(), std::ptr::null(), DC_PAPERS, codes.as_mut_ptr(), std::ptr::null()) as usize == n
            && DeviceCapabilitiesW(
                naam.as_ptr(),
                std::ptr::null(),
                DC_PAPERSIZE,
                maten.as_mut_ptr() as *mut u16,
                std::ptr::null(),
            ) as usize
                == n
    };
    if !gelezen {
        return Vec::new();
    }
    // Namen zijn een extraatje: 64 tekens per soort.
    let mut namen = vec![0u16; n * 64];
    let met_namen = aantal(DC_PAPERNAMES) as usize == n
        && unsafe {
            DeviceCapabilitiesW(naam.as_ptr(), std::ptr::null(), DC_PAPERNAMES, namen.as_mut_ptr(), std::ptr::null())
        } as usize
            == n;
    (0..n)
        .map(|i| DriverPapier {
            code: codes[i] as i16,
            maat_tiende_mm: (maten[i].x, maten[i].y),
            naam: if met_namen { uit_breed(&namen[i * 64..(i + 1) * 64]).trim().to_string() } else { String::new() },
        })
        .collect()
}

/// Het vel van deze DEVMODE. Maat uit `dmPaperWidth`/`dmPaperLength` als die
/// gezet zijn, anders uit de papierlijst van de driver, anders uit de vaste
/// tabel (`PapierInfo::uit_devmode`).
pub fn papier_info(printer: &str, dm: &DevMode) -> Option<PapierInfo> {
    let code = dm.papiercode().unwrap_or(0);
    let eigen_maat = dm.eigen_maat_tiende_mm();
    let formulier = dm.formuliernaam();
    let lijst = if eigen_maat.is_none() || formulier.is_none() { papierlijst(printer) } else { Vec::new() };
    // Op code; zonder code (alleen een formuliernaam) op naam.
    let soort = lijst
        .iter()
        .find(|s| code != 0 && s.code == code)
        .or_else(|| {
            formulier
                .as_ref()
                .and_then(|f| lijst.iter().find(|s| !s.naam.is_empty() && s.naam.eq_ignore_ascii_case(f)))
        });
    let code = if code == 0 { soort.map_or(0, |s| s.code) } else { code };
    let maat = eigen_maat.or_else(|| soort.map(|s| s.maat_tiende_mm));
    let naam = formulier.or_else(|| soort.map(|s| s.naam.clone()).filter(|n| !n.is_empty()));
    PapierInfo::uit_devmode(code, maat, naam.as_deref(), dm.orientatie_code())
}

/// Leest een eerder bewaarde DEVMODE; valt terug op de standaard van de
/// driver als er niets (bruikbaars) bewaard is. De bool zegt of het de
/// bewaarde keuze uit het eigenschappenvenster is.
fn basis_devmode(prn: &Printer, opgeslagen: Option<&[u8]>) -> Result<(DevMode, bool), String> {
    if let Some(bytes) = opgeslagen {
        match DevMode::uit_bytes(bytes) {
            Ok(dm) => return Ok((dm, true)),
            Err(e) => log::warn!("[print] bewaarde DEVMODE onbruikbaar, standaard van de driver: {e}"),
        }
    }
    Ok((prn.standaard()?, false))
}

/// Zet het gevraagde papier in `dm`, behalve bij `Papier::Printer` of als
/// `huidig` (het vel dat `dm` nu beschrijft) al hetzelfde vel is. Dat laatste
/// houdt een keuze uit het eigenschappenvenster intact die de
/// Pagina-instelling niet kan uitdrukken: een gedraaide variant (A4_ROTATED),
/// of een driver-eigen formulier of lade met dezelfde maat. Geeft terug of
/// `dm` veranderde.
pub fn papier_toepassen(dm: &mut DevMode, papier: Papier, huidig: Option<&PapierInfo>) -> bool {
    match dmpaper(papier) {
        Some(code) if !beschrijft_vel(huidig, papier) => {
            dm.zet_papier(code);
            true
        }
        _ => false,
    }
}

/// Het vel van `dm`, maar alleen als het een bewaarde keuze uit het
/// eigenschappenvenster is: die heeft de driver zelf samengesteld, dus code,
/// formulier en maat spreken elkaar niet tegen. In de standaard van de driver
/// zetten we het papier altijd, zoals de proeven het meten.
fn vel_van_sessie(printer: &str, dm: &DevMode, uit_sessie: bool) -> Option<PapierInfo> {
    if uit_sessie {
        papier_info(printer, dm)
    } else {
        None
    }
}

/// Het vel dat de volgende opdracht op deze printer gebruikt als het papier
/// op "printer" staat: de in deze sessie gekozen eigenschappen, anders de
/// standaard van de driver. `None` als het niet te bepalen is.
pub fn huidig_papier(printer: &str, opgeslagen: Option<&[u8]>) -> Option<PapierInfo> {
    let dm = match Printer::open(printer).and_then(|prn| basis_devmode(&prn, opgeslagen)) {
        Ok((dm, _)) => dm,
        Err(e) => {
            log::warn!("[print] papier van '{printer}' niet te bepalen: {e}");
            return None;
        }
    };
    papier_info(printer, &dm)
}

/// De DEVMODE voor een printopdracht: de in deze sessie gekozen eigenschappen
/// (anders de standaard van de driver), met het gevraagde papier erin
/// (`papier_toepassen`) en één exemplaar, door de driver samengevoegd en
/// gecontroleerd. Bij `Papier::Printer` blijft het papier van de basis staan.
pub fn devmode_voor_opdracht(prn: &Printer, opgeslagen: Option<&[u8]>, papier: Papier) -> Result<DevMode, String> {
    let (mut dm, uit_sessie) = basis_devmode(prn, opgeslagen)?;
    let huidig = vel_van_sessie(prn.naam(), &dm, uit_sessie);
    papier_toepassen(&mut dm, papier, huidig.as_ref());
    dm.zet_een_exemplaar();
    match prn.valideren(&dm) {
        Ok(gevalideerd) => Ok(gevalideerd),
        Err(e) => {
            // Nog steeds een volledige DEVMODE van deze driver; de DC
            // controleert hem bij het aanmaken opnieuw.
            log::warn!("[print] {e}; DEVMODE ongevalideerd gebruikt");
            Ok(dm)
        }
    }
}

/// `dm` met alleen een andere oriëntatie, opnieuw door de driver gecontroleerd.
pub fn met_orientatie(prn: &Printer, dm: &DevMode, liggend: bool) -> DevMode {
    let mut nieuw = dm.clone();
    nieuw.zet_liggend(liggend);
    match prn.valideren(&nieuw) {
        Ok(gevalideerd) => gevalideerd,
        Err(e) => {
            log::warn!("[print] {e}; oriëntatie ongevalideerd gezet");
            nieuw
        }
    }
}

/// Waarmee het eigenschappenvenster opent: de in deze sessie gekozen
/// eigenschappen (anders de standaard van de driver), met het papier en de
/// oriëntatie die de volgende afdruk krijgt (uit de Pagina-instelling, via de
/// printdialoog). Zo toont de driver wat de printdialoog belooft, en is OK
/// zonder wijziging ook echt geen wijziging. `None` als de driver geen
/// DEVMODE geeft; dan opent het venster op zijn eigen standaard.
fn voorinvulling(prn: &Printer, opgeslagen: Option<&[u8]>, papier: Papier, orientatie: Orientatie) -> Option<DevMode> {
    let (mut dm, uit_sessie) = match basis_devmode(prn, opgeslagen) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("[print] geen voorinvulling voor '{}': {e}", prn.naam());
            return None;
        }
    };
    let huidig = vel_van_sessie(prn.naam(), &dm, uit_sessie);
    let mut veranderd = papier_toepassen(&mut dm, papier, huidig.as_ref());
    let liggend = match orientatie {
        Orientatie::Staand => Some(false),
        Orientatie::Liggend => Some(true),
        Orientatie::Auto => None,
    };
    if let Some(l) = liggend.filter(|&l| l != dm.liggend()) {
        dm.zet_liggend(l);
        veranderd = true;
    }
    if !veranderd {
        return Some(dm);
    }
    match prn.valideren(&dm) {
        Ok(gevalideerd) => Some(gevalideerd),
        Err(e) => {
            log::warn!("[print] {e}; voorinvulling ongevalideerd gebruikt");
            Some(dm)
        }
    }
}

/// Wat de gebruiker in het venster veranderde: `(papier, oriëntatie)`.
/// Zonder voorinvulling is dat onbekend en telt alles als gewijzigd.
fn wijzigingen(printer: &str, vooraf: Option<&DevMode>, gekozen: &DevMode) -> (bool, bool) {
    let Some(vooraf) = vooraf else {
        return (true, true);
    };
    let papier = match (papier_info(printer, vooraf), papier_info(printer, gekozen)) {
        (Some(a), Some(b)) => !a.zelfde_vel(&b),
        (None, None) => vooraf.papier_velden() != gekozen.papier_velden(),
        _ => true,
    };
    (papier, vooraf.liggend() != gekozen.liggend())
}

/// Het eigenschappenvenster van de driver, vooringevuld (`voorinvulling`),
/// modaal voor `eigenaar` (HWND als getal, 0 = geen). Wacht op de gebruiker.
///
/// OK → de gekozen DEVMODE (bytes, om per printer voor deze sessie te
/// bewaren) en wat erin staat: het vel (altijd, desnoods "overig") en of de
/// gebruiker papier of oriëntatie veranderde. Annuleren → `None`.
/// Verandert nooit iets aan de standaard van de printer.
pub fn eigenschappen_kiezen(
    printer: &str,
    eigenaar: usize,
    opgeslagen: Option<&[u8]>,
    papier: Papier,
    orientatie: Orientatie,
) -> Result<Option<(Vec<u8>, EigenschappenKeuze)>, String> {
    let prn = Printer::open(printer)?;
    let vooraf = voorinvulling(&prn, opgeslagen, papier, orientatie);
    let Some(gekozen) = prn.eigenschappen_venster(eigenaar, vooraf.as_ref())? else {
        return Ok(None);
    };
    drop(prn);
    let (papier_gewijzigd, orientatie_gewijzigd) = wijzigingen(printer, vooraf.as_ref(), &gekozen);
    let info = papier_info(printer, &gekozen)
        .unwrap_or_else(|| PapierInfo::onbekend(gekozen.formuliernaam().as_deref(), gekozen.orientatie_code()));
    Ok(Some((gekozen.bytes(), EigenschappenKeuze { info, papier_gewijzigd, orientatie_gewijzigd })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn met_publiek(grootte: u16, extra: u16, totaal: usize) -> Vec<u8> {
        let mut dm = DevMode::leeg(totaal);
        dm.publiek_mut().dmSize = grootte;
        dm.publiek_mut().dmDriverExtra = extra;
        let mut b = dm.ruwe_bytes().to_vec();
        b.truncate(totaal);
        b
    }

    #[test]
    fn buffer_is_uitgelijnd_en_groot_genoeg() {
        let dm = DevMode::leeg(10);
        assert_eq!(dm.ptr() as usize % std::mem::align_of::<DEVMODEW>(), 0);
        assert!(dm.buf.len() * 8 >= size_of::<DEVMODEW>());
        let dm = DevMode::leeg(size_of::<DEVMODEW>() + 1234);
        assert!(dm.buf.len() * 8 >= size_of::<DEVMODEW>() + 1234);
    }

    #[test]
    fn bytes_heen_en_terug_met_driverdeel() {
        let grootte = size_of::<DEVMODEW>() as u16;
        let mut bytes = met_publiek(grootte, 100, grootte as usize + 100);
        let laatste = bytes.len() - 1;
        bytes[laatste] = 0xAB; // driverdeel moet mee
        let dm = DevMode::uit_bytes(&bytes).unwrap();
        assert_eq!(dm.bytes(), bytes);
    }

    #[test]
    fn onzinnige_lengtes_worden_geweigerd() {
        let grootte = size_of::<DEVMODEW>() as u16;
        assert!(DevMode::uit_bytes(&[0u8; 20]).is_err());
        // driverdeel langer dan de bytes
        assert!(DevMode::uit_bytes(&met_publiek(grootte, 500, grootte as usize + 10)).is_err());
        // publiek deel te klein voor dmFormName
        assert!(DevMode::uit_bytes(&met_publiek(100, 0, size_of::<DEVMODEW>())).is_err());
    }

    #[test]
    fn papier_zetten_haalt_formulier_en_eigen_maat_weg() {
        let mut dm = DevMode::leeg(size_of::<DEVMODEW>());
        {
            let d = dm.publiek_mut();
            d.dmSize = size_of::<DEVMODEW>() as u16;
            d.dmFields = DM_PAPERSIZE | DM_PAPERLENGTH | DM_PAPERWIDTH | DM_FORMNAME | DM_ORIENTATION;
            d.dmFormName[..2].copy_from_slice(&[b'A' as u16, b'4' as u16]);
            d.Anonymous1.Anonymous1.dmPaperSize = 9;
            d.Anonymous1.Anonymous1.dmPaperLength = 2970;
            d.Anonymous1.Anonymous1.dmPaperWidth = 2100;
            d.Anonymous1.Anonymous1.dmOrientation = DMORIENT_LANDSCAPE as i16;
        }
        assert_eq!(dm.formuliernaam().as_deref(), Some("A4"));
        assert_eq!(dm.eigen_maat_tiende_mm(), Some((2100, 2970)));
        dm.zet_papier(8);
        assert_eq!(dm.papiercode(), Some(8));
        assert_eq!(dm.formuliernaam(), None);
        assert_eq!(dm.eigen_maat_tiende_mm(), None);
        assert_eq!(dm.publiek().dmFormName, [0u16; 32]);
        assert!(dm.velden() & (DM_PAPERLENGTH | DM_PAPERWIDTH | DM_FORMNAME) == 0);
        // oriëntatie blijft
        assert!(dm.liggend());
        dm.zet_liggend(false);
        assert!(!dm.liggend());
        assert_eq!(dm.papiercode(), Some(8));
    }

    fn devmode_met(velden: u32, papier: i16, liggend: bool) -> DevMode {
        let mut dm = DevMode::leeg(size_of::<DEVMODEW>());
        let d = dm.publiek_mut();
        d.dmSize = size_of::<DEVMODEW>() as u16;
        d.dmFields = velden;
        d.Anonymous1.Anonymous1.dmPaperSize = papier;
        d.Anonymous1.Anonymous1.dmOrientation = (if liggend { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT }) as i16;
        dm
    }

    #[test]
    fn een_exemplaar_per_opdracht() {
        let mut dm = devmode_met(DM_PAPERSIZE | DM_ORIENTATION | DM_COPIES, 8, true);
        dm.publiek_mut().Anonymous1.Anonymous1.dmCopies = 3;
        assert_eq!(dm.exemplaren(), Some(3));
        dm.zet_een_exemplaar();
        assert_eq!(dm.exemplaren(), Some(1));
        // Papier en oriëntatie blijven.
        assert_eq!(dm.papiercode(), Some(8));
        assert!(dm.liggend());
        // Ook zonder DM_COPIES vooraf.
        let mut zonder = devmode_met(DM_PAPERSIZE, 9, false);
        assert_eq!(zonder.exemplaren(), None);
        zonder.zet_een_exemplaar();
        assert_eq!(zonder.exemplaren(), Some(1));
    }

    #[test]
    fn papier_toepassen_houdt_hetzelfde_vel_uit_de_eigenschappen() {
        // A4_ROTATED (77) uit het eigenschappenvenster, Pagina-instelling "a4".
        let mut dm = devmode_met(DM_PAPERSIZE | DM_ORIENTATION, 77, true);
        let huidig = PapierInfo::uit_devmode(77, None, None, 2);
        assert!(!papier_toepassen(&mut dm, Papier::A4, huidig.as_ref()));
        assert_eq!(dm.papiercode(), Some(77));
        // Ander vel gevraagd: wel overschrijven.
        assert!(papier_toepassen(&mut dm, Papier::A3, huidig.as_ref()));
        assert_eq!(dm.papiercode(), Some(8));
        // Standaard van de driver (geen huidig vel): altijd zetten.
        let mut standaard = devmode_met(DM_PAPERSIZE, 9, false);
        assert!(papier_toepassen(&mut standaard, Papier::A4, None));
        assert_eq!(standaard.papiercode(), Some(9));
        // Papier "printer": nooit iets zetten.
        let mut blijft = devmode_met(DM_PAPERSIZE, 77, false);
        assert!(!papier_toepassen(&mut blijft, Papier::Printer, None));
        assert_eq!(blijft.papiercode(), Some(77));
    }

    #[test]
    fn wijzigingen_zonder_voorinvulling_tellen_als_gewijzigd() {
        let gekozen = devmode_met(DM_PAPERSIZE | DM_ORIENTATION, 8, false);
        assert_eq!(wijzigingen("Bestaat-niet-406", None, &gekozen), (true, true));
    }

    #[test]
    fn wijzigingen_papier_en_orientatie() {
        // Een printernaam die niet bestaat: geen papierlijst, dus de vaste tabel.
        let p = "Bestaat-niet-406";
        let a3_staand = devmode_met(DM_PAPERSIZE | DM_ORIENTATION, 8, false);
        let a3_liggend = devmode_met(DM_PAPERSIZE | DM_ORIENTATION, 8, true);
        let a3_gedraaid = devmode_met(DM_PAPERSIZE | DM_ORIENTATION, 76, false);
        let a4_staand = devmode_met(DM_PAPERSIZE | DM_ORIENTATION, 9, false);
        assert_eq!(wijzigingen(p, Some(&a3_staand), &a3_staand.clone()), (false, false));
        assert_eq!(wijzigingen(p, Some(&a3_staand), &a3_liggend), (false, true));
        assert_eq!(wijzigingen(p, Some(&a3_staand), &a3_gedraaid), (false, false));
        assert_eq!(wijzigingen(p, Some(&a3_staand), &a4_staand), (true, false));
        // Geen van beide beschrijfbaar: de ruwe velden beslissen.
        let vreemd_1 = devmode_met(DM_PAPERSIZE, 999, false);
        let vreemd_2 = devmode_met(DM_PAPERSIZE, 998, false);
        assert_eq!(wijzigingen(p, Some(&vreemd_1), &vreemd_1.clone()), (false, false));
        assert_eq!(wijzigingen(p, Some(&vreemd_1), &vreemd_2), (true, false));
        // Van beschrijfbaar naar niet-beschrijfbaar: gewijzigd.
        assert_eq!(wijzigingen(p, Some(&a3_staand), &vreemd_1), (true, false));
    }
}
