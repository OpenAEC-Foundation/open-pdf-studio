//! Zoektekst van pagina's (aanvraag `page_text`): de tekstitems die pdf.js
//! `getTextContent()` voor de zoekfunctie van de app zou geven, maar gelezen
//! door PDFium in het workerproces, met per teken het stuk basislijn dat het
//! beslaat zodat de zoekmarkering precies op de tekens valt.
//!
//! - pdfium.rs: glyphs uit PDFium in de volgorde van de inhoud;
//! - pdfjs.rs: de itemregels van pdf.js daarover (spaties, regeleinden,
//!   itemgrenzen, normalisatie, bidi);
//! - bidi.rs: de bidi-stap van pdf.js.
//!
//! Het zoeken zelf (hoofdletters, hele woorden, de reguliere expressie) blijft
//! in JavaScript: dat is per pagina een paar microseconden en moet precies de
//! regels van RegExp volgen.
//!
//! Uitvoer (`encode`), little-endian, 4-byte-uitgelijnd:
//!   0  "OPT1"
//!   4  u32 aantal pagina's in dit antwoord (P)
//!   8  u32 aantal pagina's van het document
//!   12 u32 0
//!   P × pagina:
//!     u32 pagina-index, f32 view[4] (CropBox ∩ MediaBox),
//!     u32 items (I), u32 code-eenheden (U), u32 fonts (F),
//!     u32 vlaggen (bit 0: verticaal schrift, bit 1: schrift van rechts naar
//!         links, bit 2: tekst die PDFium niet leest (een tekstobject zonder
//!         tekens, een glyph zonder Unicode) — de app leest zo'n pagina met
//!         pdf.js, zie docs/rust-stappen.md),
//!     F × (u32 bytes, UTF-8, aangevuld tot een veelvoud van 4),
//!     I × (f32 transform[6], f32 width, f32 height, u32 begin, u32 lengte,
//!          u32 font, u32 vlaggen (bit 0 hasEOL, bit 1 rechts naar links)),
//!     U × u16 tekst (UTF-16, de str van alle items achter elkaar),
//!         aangevuld tot een veelvoud van 4,
//!     U × (u16 begin, u16 eind): het vak van elke code-eenheid als deel van
//!         de itembreedte × 65535.

mod bidi;
mod pdfium;
pub mod pdfjs;

use anyhow::{anyhow, Result};
use pdfium_render::prelude::*;

pub const MAGIC: &[u8; 4] = b"OPT1";
pub const VLAG_VERTICAAL: u32 = 1;
pub const VLAG_RTL: u32 = 2;
pub const VLAG_ONGELEZEN: u32 = 4;
pub const ITEM_EOL: u32 = 1;
pub const ITEM_RTL: u32 = 2;

/// De zoektekst van één pagina.
pub struct PaginaTekst {
    pub index: u32,
    pub view: [f64; 4],
    pub fonts: Vec<String>,
    pub items: Vec<pdfjs::Item>,
    pub verticaal: bool,
    pub rtl: bool,
    pub ongelezen: bool,
}

/// Een tweede, ruwe documenthandle op dezelfde bytes als het gecachete
/// document van de renderer: de tekst-API van PDFium heeft een paginahandle
/// nodig die pdfium-render niet naar buiten geeft. Sluit bij drop.
pub struct RuwDocument {
    handle: FPDF_DOCUMENT,
    bindings: &'static dyn PdfiumLibraryBindings,
}

impl RuwDocument {
    /// Safety: `bytes` blijft ongewijzigd en levend zolang dit document bestaat.
    pub unsafe fn open(bindings: &'static dyn PdfiumLibraryBindings, bytes: &[u8]) -> Result<Self> {
        let handle = bindings.FPDF_LoadMemDocument64(bytes, None);
        if handle.is_null() {
            return Err(anyhow!("PDFium parse (text): error {}", bindings.FPDF_GetLastError()));
        }
        Ok(Self { handle, bindings })
    }

    pub fn page_count(&self) -> u32 {
        unsafe { self.bindings.FPDF_GetPageCount(self.handle).max(0) as u32 }
    }

    pub fn pagina(&self, index: u32) -> Result<PaginaTekst> {
        let ruw = unsafe { pdfium::lees(self.bindings, self.handle, index as i32)? };
        let items = pdfjs::items(ruw.view, &ruw.gebeurtenissen);
        Ok(PaginaTekst { index, view: ruw.view, fonts: ruw.fonts, items, verticaal: ruw.verticaal, rtl: ruw.rtl, ongelezen: ruw.ongelezen })
    }
}

impl Drop for RuwDocument {
    fn drop(&mut self) {
        unsafe { self.bindings.FPDF_CloseDocument(self.handle) };
    }
}

fn pad4(uit: &mut Vec<u8>) {
    while uit.len() % 4 != 0 {
        uit.push(0);
    }
}

fn u32le(uit: &mut Vec<u8>, v: u32) {
    uit.extend_from_slice(&v.to_le_bytes());
}

fn f32le(uit: &mut Vec<u8>, v: f64) {
    uit.extend_from_slice(&(v as f32).to_le_bytes());
}

/// Voeg één pagina toe aan een antwoord (zie de moduledocumentatie).
pub fn encode_page(uit: &mut Vec<u8>, p: &PaginaTekst) {
    let units: usize = p.items.iter().map(|i| i.str.len()).sum();
    u32le(uit, p.index);
    for v in p.view {
        f32le(uit, v);
    }
    u32le(uit, p.items.len() as u32);
    u32le(uit, units as u32);
    u32le(uit, p.fonts.len() as u32);
    u32le(
        uit,
        (if p.verticaal { VLAG_VERTICAAL } else { 0 }) | (if p.rtl { VLAG_RTL } else { 0 }) | (if p.ongelezen { VLAG_ONGELEZEN } else { 0 }),
    );
    for f in &p.fonts {
        u32le(uit, f.len() as u32);
        uit.extend_from_slice(f.as_bytes());
        pad4(uit);
    }
    let mut begin = 0u32;
    for it in &p.items {
        for v in it.transform {
            f32le(uit, v);
        }
        f32le(uit, it.width);
        f32le(uit, it.height);
        u32le(uit, begin);
        u32le(uit, it.str.len() as u32);
        u32le(uit, it.font);
        u32le(uit, (if it.has_eol { ITEM_EOL } else { 0 }) | (if it.rtl { ITEM_RTL } else { 0 }));
        begin += it.str.len() as u32;
    }
    for it in &p.items {
        for &u in &it.str {
            uit.extend_from_slice(&u.to_le_bytes());
        }
    }
    pad4(uit);
    for it in &p.items {
        let w = it.width;
        let deel = |v: f64| -> u16 {
            if !(w > 0.0) || !v.is_finite() {
                return 0;
            }
            ((v / w).clamp(0.0, 1.0) * 65535.0).round() as u16
        };
        for &(a, b) in &it.vakken {
            uit.extend_from_slice(&deel(a).to_le_bytes());
            uit.extend_from_slice(&deel(b).to_le_bytes());
        }
    }
}

/// Kop van een antwoord; `aantal` wordt na het coderen ingevuld met
/// `zet_aantal`.
pub fn encode_header(uit: &mut Vec<u8>, pagina_aantal_document: u32) {
    uit.extend_from_slice(MAGIC);
    u32le(uit, 0);
    u32le(uit, pagina_aantal_document);
    u32le(uit, 0);
}

pub fn zet_aantal(uit: &mut [u8], aantal: u32) {
    uit[4..8].copy_from_slice(&aantal.to_le_bytes());
}

#[cfg(test)]
mod tests;
