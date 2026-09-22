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
//! Vellen zonder vaste `DMPAPER_*`-code (A1, A0 en de verlengde vellen A3L,
//! A2L, A1L, A0L): biedt de driver de maat zelf aan (een eigen papiersoort of
//! een formulier van de printserver), dan gaat diens code in de DEVMODE;
//! anders de maat zelf (`DMPAPER_USER` met `dmPaperWidth`/`dmPaperLength`).
//! De driver controleert het, en wat hij ervan maakt meten we na op een
//! informatiecontext (geen opdracht). Neemt hij het vel niet over, dan blijft
//! het papier van de printer staan (`met_papier`). Zo'n driver is de
//! ingebouwde pdf-driver van Windows: zijn papierlijst ligt vast, een eigen
//! maat negeert hij. A1 en A0 biedt hij zelf aan, de verlengde vellen niet.
//!
//! Liggende pagina's op een printer die een document schrijft (een
//! PDF-printer, `schrijft_document`) krijgen niet de liggende stand maar het
//! liggende vel als eigen maat met een staande stand
//! (`liggend_voor_opdracht`): zo'n stuurprogramma schrijft "liggend"
//! anders als een staand medium met de inhoud een kwartslag gedraaid. Neemt
//! het stuurprogramma de maat niet over — nagemeten op een informatiecontext
//! — dan de liggende stand, net als bij elke papieren printer.
//!
//! Aantal exemplaren: de app maakt kopieën zelf (één opdracht per kopie, zie
//! print-job.js). Een opdracht-DEVMODE vraagt daarom altijd één exemplaar,
//! anders vermenigvuldigen een aantal uit de eigenschappen of de
//! voorkeursinstellingen en het veld Exemplaren in de printdialoog elkaar.

use std::mem::size_of;

use windows_sys::Win32::Foundation::{HANDLE, HWND, POINT};
use windows_sys::Win32::Graphics::Gdi::{
    CreateICW, DeleteDC, GetDeviceCaps, DEVMODEW, DMORIENT_LANDSCAPE, DMORIENT_PORTRAIT, DMPAPER_USER, DM_COPIES,
    DM_FORMNAME, DM_IN_BUFFER, DM_IN_PROMPT, DM_ORIENTATION, DM_OUT_BUFFER, DM_PAPERLENGTH, DM_PAPERSIZE,
    DM_PAPERWIDTH, LOGPIXELSX, LOGPIXELSY, PHYSICALHEIGHT, PHYSICALWIDTH,
};
use windows_sys::Win32::Graphics::Printing::{
    ClosePrinter, DocumentPropertiesW, GetPrinterW, OpenPrinterW, PRINTER_INFO_2W,
};
use windows_sys::Win32::Storage::Xps::{DeviceCapabilitiesW, DC_PAPERNAMES, DC_PAPERS, DC_PAPERSIZE};
use windows_sys::Win32::UI::WindowsAndMessaging::{IDCANCEL, IDOK};

use crate::print_instelling::{
    beschrijft_vel, dmpaper, liggend_vel_aangenomen, liggend_vel_uitgezet, liggende_eigen_maat_tiende_mm,
    liggende_soort, meld, schrijft_document, velkeuze_regel, zelfde_maat_mm, EigenschappenKeuze, LiggendeWeg,
    Orientatie, Papier, PapierInfo, VelKeuze, LIGGEND_VEL_OMGEVING,
};

/// UTF-16 met afsluitende nul, voor de W-functies.
pub fn breed(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn uit_breed(tekens: &[u16]) -> String {
    let eind = tekens.iter().position(|&c| c == 0).unwrap_or(tekens.len());
    String::from_utf16_lossy(&tekens[..eind])
}

/// Een tekst met afsluitende nul uit een Windows-structuur. Leeg bij een
/// nulwijzer. De aanroeper staat ervoor in dat de tekst nog leeft.
unsafe fn uit_pwstr(p: *const u16) -> String {
    if p.is_null() {
        return String::new();
    }
    let mut n = 0;
    while unsafe { *p.add(n) } != 0 {
        n += 1;
    }
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(p, n) })
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

    /// Zet een eigen maat (in 0,1 mm): `DMPAPER_USER` met
    /// `dmPaperWidth`/`dmPaperLength`. Een formuliernaam zou de maat
    /// overrulen, dus die gaat eruit. Meestal staand (breedte < lengte); voor
    /// een liggend vel juist breedte > lengte (`liggend_als_eigen_maat`).
    pub fn zet_eigen_maat(&mut self, breedte: i16, lengte: i16) {
        self.zet_eigen_maat_met_code(DMPAPER_USER as i16, breedte, lengte);
    }

    /// Dezelfde eigen maat met een zelfgekozen `dmPaperSize`. De documentatie
    /// van `DEVMODEW` noemt 0 als de maat in `dmPaperWidth`/`dmPaperLength`
    /// staat; stuurprogramma's nemen meestal ook `DMPAPER_USER`. Waar een
    /// stuurprogramma mee overweg kan, meet `examples/printer_capaciteiten.rs`.
    pub fn zet_eigen_maat_met_code(&mut self, code: i16, breedte: i16, lengte: i16) {
        let d = self.publiek_mut();
        d.dmFields |= DM_PAPERSIZE | DM_PAPERWIDTH | DM_PAPERLENGTH;
        d.dmFields &= !DM_FORMNAME;
        d.dmFormName = [0; 32];
        d.Anonymous1.Anonymous1.dmPaperSize = code;
        d.Anonymous1.Anonymous1.dmPaperWidth = breedte;
        d.Anonymous1.Anonymous1.dmPaperLength = lengte;
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

    /// De naam van het stuurprogramma en van de poort (`PRINTER_INFO_2`).
    /// `None` als de spooler ze niet geeft.
    pub fn stuurprogramma_en_poort(&self) -> Option<(String, String)> {
        let mut nodig = 0u32;
        unsafe {
            GetPrinterW(self.handle, 2, std::ptr::null_mut(), 0, &mut nodig);
            if (nodig as usize) < size_of::<PRINTER_INFO_2W>() {
                return None;
            }
            let mut buf = vec![0u64; (nodig as usize).div_ceil(8)];
            if GetPrinterW(self.handle, 2, buf.as_mut_ptr() as *mut u8, nodig, &mut nodig) == 0 {
                return None;
            }
            // De tekstvelden wijzen in `buf`; ze worden hier meteen gekopieerd.
            let info = &*(buf.as_ptr() as *const PRINTER_INFO_2W);
            Some((uit_pwstr(info.pDriverName), uit_pwstr(info.pPortName)))
        }
    }

    /// Schrijft deze printer een document in plaats van papier
    /// (`schrijft_document`)? Alleen dan gaat een liggend vel als eigen maat.
    /// Zonder gegevens van de spooler: nee, dus het gedrag van altijd.
    pub fn schrijft_document(&self) -> bool {
        match self.stuurprogramma_en_poort() {
            Some((stuurprogramma, poort)) => schrijft_document(&stuurprogramma, &poort),
            None => {
                log::warn!("[print] geen stuurprogramma en poort van '{}'; als papieren printer behandeld", self.tekst);
                false
            }
        }
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

/// Speling bij het terugzoeken van een maat in de papierlijst: 1 mm, in 0,1 mm.
const LIJST_SPELING: i32 = 10;

/// De code van het driverpapier met deze maat (staand, in 0,1 mm). Alleen
/// soorten die zelf ook staand zijn opgegeven tellen: een gedraaide variant
/// ("A3 (gedraaid)") zou de oriëntatie van de opdracht omkeren.
pub fn code_op_maat(lijst: &[DriverPapier], maat: (i16, i16)) -> Option<i16> {
    let (breedte, lengte) = (maat.0 as i32, maat.1 as i32);
    lijst
        .iter()
        .find(|s| {
            s.code != 0
                && (s.maat_tiende_mm.0 - breedte).abs() <= LIJST_SPELING
                && (s.maat_tiende_mm.1 - lengte).abs() <= LIJST_SPELING
        })
        .map(|s| s.code)
}

/// Het vel (breedte x hoogte in mm, zoals de DC staat) dat een DC met deze
/// DEVMODE krijgt. Gemeten op een informatiecontext: er start geen opdracht
/// en er gaat niets naar de printer.
pub fn gemeten_vel_mm(printer: &str, dm: &DevMode) -> Option<(f64, f64)> {
    let naam = breed(printer);
    let ic = unsafe { CreateICW(std::ptr::null(), naam.as_ptr(), std::ptr::null(), dm.ptr()) };
    if ic.is_null() {
        return None;
    }
    unsafe {
        let (pw, ph) = (GetDeviceCaps(ic, PHYSICALWIDTH as i32), GetDeviceCaps(ic, PHYSICALHEIGHT as i32));
        let (dx, dy) = (GetDeviceCaps(ic, LOGPIXELSX as i32), GetDeviceCaps(ic, LOGPIXELSY as i32));
        DeleteDC(ic);
        (pw > 0 && ph > 0 && dx > 0 && dy > 0).then(|| (pw as f64 * 25.4 / dx as f64, ph as f64 * 25.4 / dy as f64))
    }
}

/// Speling bij het nameten van een vel: drivers ronden af op hun resolutie.
const MEET_SPELING_MM: f64 = 3.0;

/// Maakt de driver van `dm` echt het gevraagde vel? Gemeten op een
/// informatiecontext; lukt dat niet, dan telt wat de DEVMODE zelf zegt.
fn neemt_vel(printer: &str, dm: &DevMode, papier: Papier) -> bool {
    let Some(gevraagd) = papier.staande_maat_mm() else {
        return true;
    };
    match gemeten_vel_mm(printer, dm) {
        Some(gemeten) => zelfde_maat_mm(gemeten, gevraagd, MEET_SPELING_MM),
        None => beschrijft_vel(papier_info(printer, dm).as_ref(), papier),
    }
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
///
/// Een vel zonder vaste `DMPAPER_*`-code krijgt de code waaronder de driver
/// die maat zelf aanbiedt (`lijst`, zie `papierlijst`), en anders de maat
/// zelf als eigen maat.
pub fn papier_toepassen(dm: &mut DevMode, papier: Papier, huidig: Option<&PapierInfo>, lijst: &[DriverPapier]) -> bool {
    if papier == Papier::Printer || beschrijft_vel(huidig, papier) {
        return false;
    }
    if let Some(code) = dmpaper(papier) {
        dm.zet_papier(code);
        return true;
    }
    match papier.eigen_maat_tiende_mm() {
        Some(maat) => {
            match code_op_maat(lijst, maat) {
                Some(code) => dm.zet_papier(code),
                None => dm.zet_eigen_maat(maat.0, maat.1),
            }
            true
        }
        None => false,
    }
}

/// `basis` met het gevraagde papier erin (`papier_toepassen`), en of dat iets
/// veranderde.
///
/// Een vel zonder vaste code moet de driver ook echt overnemen: hij
/// controleert de DEVMODE en het vel wordt nagemeten (`neemt_vel`). Weigert
/// hij het of kapt hij het af (A0L is langer dan de pdf-driver aankan), dan
/// blijft het papier van `basis` staan: de standaard van de printer, of wat
/// de gebruiker in de eigenschappen koos. De printdialoog toont dat vel dan
/// ook (`papier_voor_opdracht`).
fn met_papier(prn: &Printer, basis: &DevMode, uit_sessie: bool, papier: Papier) -> (DevMode, bool) {
    let huidig = vel_van_sessie(prn.naam(), basis, uit_sessie);
    let zonder_code = papier.eigen_maat_tiende_mm().is_some();
    let lijst = if zonder_code { papierlijst(prn.naam()) } else { Vec::new() };
    let mut dm = basis.clone();
    if !papier_toepassen(&mut dm, papier, huidig.as_ref(), &lijst) {
        return (dm, false);
    }
    if zonder_code {
        let gecontroleerd = prn.valideren(&dm).unwrap_or_else(|_| dm.clone());
        if !neemt_vel(prn.naam(), &gecontroleerd, papier) {
            log::warn!(
                "[print] '{}' neemt papier {} niet over; het papier van de printer blijft staan",
                prn.naam(),
                papier.sleutel()
            );
            return (basis.clone(), false);
        }
    }
    (dm, true)
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
    let (basis, uit_sessie) = basis_devmode(prn, opgeslagen)?;
    let (mut dm, _) = met_papier(prn, &basis, uit_sessie, papier);
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

/// Het vel dat een opdracht met dit papier uit de Pagina-instelling op deze
/// printer écht krijgt: dat van `devmode_voor_opdracht`. Neemt de driver het
/// gevraagde vel niet over, dan is dit het papier van de printer; zo kan de
/// printdialoog tonen waarop er werkelijk geprint wordt. `None` als het niet
/// te bepalen is.
pub fn papier_voor_opdracht(printer: &str, opgeslagen: Option<&[u8]>, papier: Papier) -> Option<PapierInfo> {
    if papier == Papier::Printer {
        return huidig_papier(printer, opgeslagen);
    }
    let dm = match Printer::open(printer).and_then(|prn| devmode_voor_opdracht(&prn, opgeslagen, papier)) {
        Ok(dm) => dm,
        Err(e) => {
            log::warn!("[print] papier van '{printer}' voor {} niet te bepalen: {e}", papier.sleutel());
            return None;
        }
    };
    papier_info(printer, &dm)
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

/// `staand` met het vel een kwartslag gedraaid als eigen maat
/// (`DMPAPER_USER` met breedte > lengte) en de stand op staand, als het
/// stuurprogramma dat overneemt.
///
/// Een stuurprogramma dat "liggend" als een staand medium met gedraaide
/// inhoud wegschrijft (de gewone PostScript-werkwijze) krijgt zo een liggend
/// medium en hoeft niets te draaien. Het vel is dat van `staand` zelf,
/// nagemeten op een informatiecontext, dus ook goed bij papier "printer".
///
/// `None` als het vel niet te meten is, niet in een DEVMODE past, of als het
/// stuurprogramma het niet overneemt: het vervangt de eigen maat stil door
/// zijn eigen vel, kapt hem af, of draait de maat terug en zet de stand op
/// liggend. Dat wordt nagemeten op een informatiecontext
/// (`liggend_vel_aangenomen`); er start geen opdracht en er gaat niets naar
/// de printer.
/// Eén poging: `staand` aangepast met `zet`, door het stuurprogramma laten
/// controleren en het vel nameten op een informatiecontext. `Some` alleen als
/// dat echt het gevraagde liggende vel is (`liggend_vel_aangenomen`).
fn probeer_liggend_vel(
    prn: &Printer,
    staand: &DevMode,
    maat: (i16, i16),
    keuze: &mut VelKeuze,
    zet: impl Fn(&mut DevMode),
) -> Option<DevMode> {
    let mut dm = staand.clone();
    zet(&mut dm);
    let dm = match prn.valideren(&dm) {
        Ok(gevalideerd) => gevalideerd,
        Err(e) => {
            log::warn!("[print] {e}");
            keuze.reden = "stuurprogramma controleerde de DEVMODE niet";
            return None;
        }
    };
    let gemeten = gemeten_vel_mm(prn.naam(), &dm);
    keuze.papiercode = dm.papiercode();
    keuze.eigen_maat_tiende_mm = dm.eigen_maat_tiende_mm();
    keuze.devmode_liggend = Some(dm.liggend());
    keuze.gemeten_mm = gemeten;
    liggend_vel_aangenomen(maat, gemeten, dm.liggend(), MEET_SPELING_MM).then_some(dm)
}

/// Vult onderweg `keuze` in, zodat `liggend_voor_opdracht` er één regel van
/// kan maken (`velkeuze_regel`).
fn liggend_als_eigen_maat(prn: &Printer, staand: &DevMode, keuze: &mut VelKeuze) -> Option<DevMode> {
    let vel = gemeten_vel_mm(prn.naam(), staand);
    keuze.staand_vel_mm = vel;
    let Some(vel) = vel else {
        keuze.reden = "vel van de staande DEVMODE niet te meten";
        return None;
    };
    let maat = liggende_eigen_maat_tiende_mm(vel);
    keuze.gevraagde_maat_tiende_mm = maat;
    let Some(maat) = maat else {
        keuze.reden = "vel past niet als eigen maat in een DEVMODE";
        return None;
    };
    // Eerst een papiersoort van het stuurprogramma die zelf al liggend is
    // (bij een PostScript-stuurprogramma een echt liggend medium in de PPD);
    // die laat geen ruimte voor een eigen invoerrichting.
    let soorten: Vec<(i16, (i32, i32))> =
        papierlijst(prn.naam()).iter().map(|s| (s.code, s.maat_tiende_mm)).collect();
    if let Some(code) = liggende_soort(&soorten, maat, LIJST_SPELING) {
        if let Some(dm) = probeer_liggend_vel(prn, staand, maat, keuze, |dm| {
            dm.zet_papier(code);
            dm.zet_liggend(false);
        }) {
            keuze.weg = LiggendeWeg::Soort;
            return Some(dm);
        }
    }
    // Anders het vel als eigen maat.
    let dm = probeer_liggend_vel(prn, staand, maat, keuze, |dm| {
        dm.zet_eigen_maat(maat.0, maat.1);
        dm.zet_liggend(false);
    });
    match dm {
        Some(dm) => {
            keuze.weg = LiggendeWeg::EigenMaat;
            Some(dm)
        }
        None => {
            if keuze.reden.is_empty() {
                keuze.reden = "stuurprogramma nam het liggende vel niet over";
            }
            None
        }
    }
}

/// De DEVMODE voor de liggende pagina's van een opdracht.
///
/// Bij een printer die een document schrijft (`Printer::schrijft_document`)
/// eerst het liggende vel als eigen maat: dan bepaalt het vel de stand en
/// hoeft het stuurprogramma niets te draaien. Neemt het dat niet over, en bij
/// elke papieren printer, de liggende stand (`met_orientatie`) zoals altijd:
/// daar is een liggend vel als eigen maat juist verkeerd, want de printer
/// heeft dat medium niet.
///
/// Met `OPDS_LIGGEND_VEL=0` in de omgeving krijgt elke printer de liggende
/// stand, zoals vóór deze regel (`liggend_vel_uitgezet`).
///
/// Meldt in één regel welke weg het werd en waarom (`velkeuze_regel`,
/// `meld`), zodat een afdruk achteraf na te gaan is.
pub fn liggend_voor_opdracht(prn: &Printer, basis: &DevMode, staand: &DevMode, papier: Papier) -> DevMode {
    let gegevens = prn.stuurprogramma_en_poort();
    let (stuurprogramma, poort) = match &gegevens {
        Some((s, p)) => (Some(s.as_str()), Some(p.as_str())),
        None => (None, None),
    };
    let mut keuze = VelKeuze {
        printer: prn.naam(),
        stuurprogramma,
        poort,
        schrijft_document: gegevens.as_ref().is_some_and(|(s, p)| schrijft_document(s, p)),
        papier,
        staand_vel_mm: None,
        gevraagde_maat_tiende_mm: None,
        papiercode: None,
        eigen_maat_tiende_mm: None,
        devmode_liggend: None,
        gemeten_mm: None,
        weg: LiggendeWeg::Stand,
        reden: "",
    };
    let uit = std::env::var(LIGGEND_VEL_OMGEVING).ok();
    let dm = if liggend_vel_uitgezet(uit.as_deref()) {
        keuze.reden = "uitgezet in de omgeving";
        None
    } else if !keuze.schrijft_document {
        keuze.reden = if gegevens.is_none() { "stuurprogramma en poort onbekend" } else { "papieren printer" };
        None
    } else {
        liggend_als_eigen_maat(prn, staand, &mut keuze)
    };
    meld(&velkeuze_regel(&keuze));
    dm.unwrap_or_else(|| met_orientatie(prn, basis, true))
}

/// Waarmee het eigenschappenvenster opent: de in deze sessie gekozen
/// eigenschappen (anders de standaard van de driver), met het papier en de
/// oriëntatie die de volgende afdruk krijgt (uit de Pagina-instelling, via de
/// printdialoog). Zo toont de driver wat de printdialoog belooft, en is OK
/// zonder wijziging ook echt geen wijziging. `None` als de driver geen
/// DEVMODE geeft; dan opent het venster op zijn eigen standaard.
fn voorinvulling(prn: &Printer, opgeslagen: Option<&[u8]>, papier: Papier, orientatie: Orientatie) -> Option<DevMode> {
    let (basis, uit_sessie) = match basis_devmode(prn, opgeslagen) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("[print] geen voorinvulling voor '{}': {e}", prn.naam());
            return None;
        }
    };
    let (mut dm, mut veranderd) = met_papier(prn, &basis, uit_sessie, papier);
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
        assert!(!papier_toepassen(&mut dm, Papier::A4, huidig.as_ref(), &[]));
        assert_eq!(dm.papiercode(), Some(77));
        // Ander vel gevraagd: wel overschrijven.
        assert!(papier_toepassen(&mut dm, Papier::A3, huidig.as_ref(), &[]));
        assert_eq!(dm.papiercode(), Some(8));
        // Standaard van de driver (geen huidig vel): altijd zetten.
        let mut standaard = devmode_met(DM_PAPERSIZE, 9, false);
        assert!(papier_toepassen(&mut standaard, Papier::A4, None, &[]));
        assert_eq!(standaard.papiercode(), Some(9));
        // Papier "printer": nooit iets zetten.
        let mut blijft = devmode_met(DM_PAPERSIZE, 77, false);
        assert!(!papier_toepassen(&mut blijft, Papier::Printer, None, &[]));
        assert_eq!(blijft.papiercode(), Some(77));
    }

    fn soort(code: i16, breedte: i32, lengte: i32, naam: &str) -> DriverPapier {
        DriverPapier { code, maat_tiende_mm: (breedte, lengte), naam: naam.to_string() }
    }

    #[test]
    fn eigen_maat_in_de_devmode() {
        let mut dm = devmode_met(DM_PAPERSIZE | DM_ORIENTATION | DM_FORMNAME, 9, true);
        dm.publiek_mut().dmFormName[..2].copy_from_slice(&[b'A' as u16, b'4' as u16]);
        dm.zet_eigen_maat(2970, 6300);
        // DMPAPER_USER met breedte en lengte in 0,1 mm, alle drie de vlaggen.
        assert_eq!(DMPAPER_USER, 256);
        assert_eq!(dm.papiercode(), Some(256));
        assert_eq!(dm.eigen_maat_tiende_mm(), Some((2970, 6300)));
        let v = unsafe { dm.publiek().Anonymous1.Anonymous1 };
        assert_eq!((v.dmPaperSize, v.dmPaperWidth, v.dmPaperLength), (256, 2970, 6300));
        assert_eq!(
            dm.velden() & (DM_PAPERSIZE | DM_PAPERWIDTH | DM_PAPERLENGTH),
            DM_PAPERSIZE | DM_PAPERWIDTH | DM_PAPERLENGTH
        );
        // De formuliernaam zou de maat overrulen en gaat eruit; de oriëntatie blijft.
        assert_eq!(dm.formuliernaam(), None);
        assert!(dm.velden() & DM_FORMNAME == 0);
        assert!(dm.liggend());
        // Een vaste code daarna haalt de eigen maat weer weg.
        dm.zet_papier(8);
        assert_eq!(dm.eigen_maat_tiende_mm(), None);
        assert_eq!(dm.papiercode(), Some(8));
    }

    #[test]
    fn vel_zonder_vaste_code_als_eigen_maat_of_als_code_van_de_driver() {
        // De driver kent de maat niet: de maat zelf gaat in de DEVMODE.
        let lijst = vec![soort(9, 2100, 2970, "A4"), soort(8, 2970, 4200, "A3")];
        let mut dm = devmode_met(DM_PAPERSIZE, 9, false);
        assert!(papier_toepassen(&mut dm, Papier::A3L, None, &lijst));
        assert_eq!((dm.papiercode(), dm.eigen_maat_tiende_mm()), (Some(256), Some((2970, 6300))));
        let mut dm = devmode_met(DM_PAPERSIZE, 9, false);
        assert!(papier_toepassen(&mut dm, Papier::A1L, None, &[]));
        assert_eq!(dm.eigen_maat_tiende_mm(), Some((5940, 10510)));
        let mut dm = devmode_met(DM_PAPERSIZE, 9, false);
        assert!(papier_toepassen(&mut dm, Papier::A0L, None, &[]));
        assert_eq!(dm.eigen_maat_tiende_mm(), Some((8410, 13990)));

        // De driver biedt de maat zelf aan (pdf-driver: "ISOA1" = 140; of een
        // formulier van de printserver): dan diens code, zonder eigen maat.
        let lijst = vec![soort(9, 2100, 2970, "A4"), soort(140, 5940, 8410, "ISOA1"), soort(300, 2970, 6300, "A3L")];
        let mut dm = devmode_met(DM_PAPERSIZE, 9, false);
        assert!(papier_toepassen(&mut dm, Papier::A1, None, &lijst));
        assert_eq!((dm.papiercode(), dm.eigen_maat_tiende_mm()), (Some(140), None));
        let mut dm = devmode_met(DM_PAPERSIZE, 9, false);
        assert!(papier_toepassen(&mut dm, Papier::A3L, None, &lijst));
        assert_eq!((dm.papiercode(), dm.eigen_maat_tiende_mm()), (Some(300), None));

        // Hetzelfde vel al in de eigenschappen gekozen: niets overschrijven.
        let huidig = PapierInfo::uit_devmode(300, Some((2970, 6300)), Some("A3L"), 1);
        let mut dm = devmode_met(DM_PAPERSIZE, 300, false);
        assert!(!papier_toepassen(&mut dm, Papier::A3L, huidig.as_ref(), &lijst));
        assert_eq!(dm.papiercode(), Some(300));
    }

    #[test]
    fn code_op_maat_negeert_gedraaide_soorten_en_verkeerde_maten() {
        let lijst = vec![
            soort(76, 4200, 2970, "A3 (gedraaid)"),
            soort(8, 2970, 4200, "A3"),
            soort(141, 5936, 8413, "A1 afgerond"),
            soort(0, 8410, 11890, "zonder code"),
        ];
        assert_eq!(code_op_maat(&lijst, (2970, 4200)), Some(8));
        // Binnen 1 mm.
        assert_eq!(code_op_maat(&lijst, (5940, 8410)), Some(141));
        // Alleen een gedraaide soort: geen treffer.
        assert_eq!(code_op_maat(&lijst[..1], (2970, 4200)), None);
        // Code 0 telt niet; onbekende maat ook niet.
        assert_eq!(code_op_maat(&lijst, (8410, 11890)), None);
        assert_eq!(code_op_maat(&lijst, (2970, 6300)), None);
        assert_eq!(code_op_maat(&[], (2970, 6300)), None);
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
