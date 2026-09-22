//! Rasterbestanden lezen voor de import (#400).
//!
//! JPEG gaat ongewijzigd de PDF in (`DCTDecode`), maar pas nadat de koptekst
//! is nagelopen: alleen wat elke PDF-lezer aankan (gewoon of progressief,
//! 8 bits, grijs of drie kleurkanalen) komt erdoor. Het bestand wordt afgekapt
//! op zijn eigen einde (de eerste EOI na de scans): wat iemand achter het beeld
//! heeft geplakt, lift niet mee de PDF in. PNG wordt hier uitgepakt, ontfilterd
//! en meteen weer ingepakt als `FlateDecode`. Ondersteund: grijs (kleurtype 0),
//! ware kleur (2), palet (3, met `tRNS`), grijs met doorzichtigheid (4) en ware
//! kleur met doorzichtigheid (6), in 1, 2, 4, 8 of 16 bits per monster;
//! doorzichtigheid wordt op wit gezet. Vervlochten PNG (Adam7) wordt geweigerd.
//!
//! De controlesommen (CRC) van de PNG-stukken worden niet nagerekend. Ze
//! beschermen tegen beschadiging onderweg, niet tegen opzet, en elke byte die
//! hier gebruikt wordt, wordt zelf gecontroleerd: een kapotte stroom pakt niet
//! uit of levert niet het aantal regels dat de koptekst belooft, en dan wordt
//! het beeld geweigerd. Een bestand met alleen een foute CRC komt er dus door.
//!
//! Alles komt uit een bestand, dus niets hier mag op rare bytes vastlopen:
//! geen indexering zonder controle, geen `unwrap`.
//!
//! # Grenzen
//!
//! Een tekening kan naar honderden beelden wijzen, en een PNG van een paar
//! kilobyte kan honderden megabytes beloven. Vier grenzen houden het werk en
//! het geheugen van één import in de hand; ze gelden voor de hele import
//! (alle ruimtes, alle externe verwijzingen) en worden getoetst vóórdat het
//! werk begint:
//!
//! - **Lezen** ([`MAX_IMAGE_READ_BYTES`]): de som van alle gelezen
//!   bestandsbytes, ook van bestanden die daarna niets blijken op te leveren.
//!   Eén bestand is hooguit [`MAX_IMAGE_BYTES`], er zijn er hooguit
//!   [`MAX_IMAGE_FILES`].
//! - **Uitpakken** ([`MAX_IMAGE_WORK_BYTES`]): wat de kopteksten samen aan
//!   uitgepakte bytes beloven (PNG: regels maal bytes per regel, of de
//!   beeldpunten maal de kanalen van de uitvoer als dat meer is; JPEG:
//!   breedte maal hoogte maal kanalen, want al pakt de import een JPEG niet
//!   uit, wie de PDF bekijkt doet dat wel). De belofte van een
//!   koptekst wordt tegen wat er over is gehouden vóór het uitpakken, en
//!   afgeschreven zodra het uitpakken begint, ook als de stroom daarna kapot
//!   blijkt: anders kosten 256 kapotte beelden alsnog 256 keer het werk.
//! - **Vasthouden en insluiten** ([`MAX_IMAGE_TOTAL_BYTES`]): wat de import
//!   aan beeldgegevens in het geheugen houdt en in de PDF zet. Een PNG wordt
//!   regel voor regel uitgepakt en in dezelfde gang weer ingepakt; het
//!   uitgepakte beeld bestaat nooit als geheel. Vastgehouden worden alleen de
//!   ingepakte bytes (en van een JPEG de bestandsbytes), en daarop wordt
//!   begroot: dat is wat het geheugen en de PDF werkelijk kost. Het inpakken
//!   stopt zodra het boven het restant uitkomt. Deze grens is de enige
//!   bovengrens op de beelduitvoer: beelden tellen niet mee in
//!   `max_content_bytes` van de import.
//! - **Beeldpunten** ([`MAX_IMAGE_PIXELS`], [`MAX_IMAGE_SIDE`]): een vangnet
//!   tegen onzinnige maten, niet de echte rem. De rem is het uitpakwerk: een
//!   PNG in ware kleur van 200 miljoen beeldpunten belooft 600 MB en valt
//!   daar al buiten, een grijze van 200 MB past er één keer in. De grens staat
//!   daarom ruim (luchtfoto's en gescande bladen van A0 halen 100 tot 200
//!   miljoen beeldpunten) en is via `max_image_pixels` alleen te verlagen.
//!
//! Waarom begroten op ingepakte bytes en niet op een lager dak in uitgepakte
//! bytes: het uitgepakte beeld wordt nergens vastgehouden, dus een dak daarop
//! zou echte tekeningen met een paar grote beelden weigeren zonder dat het
//! geheugen er iets mee wint. Het werk dat uitgepakte bytes wél kosten, heeft
//! zijn eigen grens.

use super::pdf_writer::Packer;
use super::xref::{ExternalKind, ExternalList, ExternalStatus, Located, SearchPaths};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// Hoogste aantal beeldpunten dat één afbeelding mag hebben. Een vangnet; de
/// echte rem is [`MAX_IMAGE_WORK_BYTES`] (zie de moduledoc).
pub const MAX_IMAGE_PIXELS: u64 = 200_000_000;
/// Langste zijde van een afbeelding (de grens van JPEG). Zonder deze grens
/// zou één regel van een PNG van 200 miljoen bij 1 honderden megabytes vragen.
pub const MAX_IMAGE_SIDE: u32 = 65_535;
/// Hoogste bestandsgrootte van één afbeelding.
pub const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
/// Hoogste aantal verschillende afbeeldingen dat één import leest.
pub const MAX_IMAGE_FILES: usize = 256;
/// Hoogste aantal verschillende paden waar één import naar zoekt. Elke
/// zoekactie kost tot een paar dozijn bestandsoproepen (op een netwerkschijf
/// elk een rondgang); wat de tekening daarboven nog noemt, wordt geweigerd.
pub const MAX_IMAGE_LOOKUPS: usize = 1024;
/// Hoogste aantal bestandsbytes dat één import aan afbeeldingen leest, ook
/// van bestanden die daarna niets opleveren.
pub const MAX_IMAGE_READ_BYTES: u64 = 512 * 1024 * 1024;
/// Hoogste aantal uitgepakte bytes dat één import aan afbeeldingen verwerkt,
/// zoals de kopteksten het beloven.
pub const MAX_IMAGE_WORK_BYTES: u64 = 512 * 1024 * 1024;
/// Hoogste aantal bytes aan beeldgegevens (ingepakt, of de JPEG-bytes) dat
/// één import in het geheugen houdt en insluit. De enige bovengrens op de
/// beelduitvoer.
pub const MAX_IMAGE_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
/// Extensies die als afbeelding gezocht worden.
pub const IMAGE_EXTENSIONS: [&str; 3] = ["png", "jpg", "jpeg"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Pixels {
    /// De oorspronkelijke JPEG-bytes, met het aantal kleurkanalen (1 of 3).
    Jpeg { data: Vec<u8>, components: u8 },
    /// Eén byte per beeldpunt.
    Gray8(Vec<u8>),
    /// Drie bytes per beeldpunt.
    Rgb8(Vec<u8>),
    /// Beeldpunten van 8 bits (grijs: één byte, anders drie), al ingepakt
    /// met Flate. Zo houdt de import een beeld vast.
    Flate { data: Vec<u8>, gray: bool },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Raster {
    pub width: u32,
    pub height: u32,
    pub pixels: Pixels,
}

impl Raster {
    /// Kleurruimte voor het beeld-XObject.
    pub fn color_space(&self) -> &'static str {
        match &self.pixels {
            Pixels::Gray8(_) | Pixels::Jpeg { components: 1, .. } | Pixels::Flate { gray: true, .. } => "DeviceGray",
            _ => "DeviceRGB",
        }
    }

    /// Aantal bytes aan beeldgegevens dat dit beeld vasthoudt.
    pub fn byte_len(&self) -> u64 {
        match &self.pixels {
            Pixels::Jpeg { data, .. } | Pixels::Gray8(data) | Pixels::Rgb8(data) | Pixels::Flate { data, .. } => data.len() as u64,
        }
    }
}

/// Waarom een gevonden bestand geen beeld oplevert.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// Boven een grens: beeldpunten, zijde, bestandsgrootte of een begroting.
    TooLarge,
    /// Geen ondersteunde soort, of beschadigd.
    Unsupported,
    /// Afgebroken tijdens het uitpakken.
    Cancelled,
}

/// Wat de koptekst van een JPEG zegt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JpegInfo {
    pub width: u32,
    pub height: u32,
    pub components: u8,
    pub precision: u8,
    /// De SOF-markering: 0xC0 gewoon, 0xC1 uitgebreid, 0xC2 progressief, …
    pub frame: u8,
    /// Er volgt na de kop ook echt een scan (SOS).
    pub has_scan: bool,
}

/// Een nagelopen koptekst: genoeg om te weten wat het beeld gaat kosten,
/// zonder dat er iets is uitgepakt.
enum Header<'d> {
    Jpeg { info: JpegInfo, end: usize },
    Png(PngHeader<'d>),
}

impl Header<'_> {
    /// Uitgepakte bytes die het verwerken van dit beeld kost.
    fn work_bytes(&self) -> u64 {
        match self {
            // De import pakt een JPEG niet uit, de kijker van de PDF wel: de
            // belofte van de koptekst telt, niet de paar bytes in het bestand.
            Header::Jpeg { info, end } => {
                (u64::from(info.width) * u64::from(info.height)).saturating_mul(u64::from(info.components)).max(*end as u64)
            }
            Header::Png(png) => png.work_bytes(),
        }
    }
}

/// Herkent JPEG of PNG aan de eerste bytes (niet aan de extensie) en loopt de
/// koptekst na, zonder iets uit te pakken.
fn inspect(data: &[u8], max_pixels: u64) -> Result<Header<'_>, Failure> {
    if data.starts_with(&[0xFF, 0xD8]) {
        let info = jpeg_info(data).ok_or(Failure::Unsupported)?;
        let plain = matches!(info.frame, 0xC0 | 0xC1 | 0xC2) && info.precision == 8 && matches!(info.components, 1 | 3);
        if !plain || !info.has_scan {
            return Err(Failure::Unsupported);
        }
        if u64::from(info.width) * u64::from(info.height) > max_pixels {
            return Err(Failure::TooLarge);
        }
        let end = jpeg_end(data).ok_or(Failure::Unsupported)?;
        return Ok(Header::Jpeg { info, end });
    }
    png_header(data, max_pixels).map(Header::Png)
}

/// Levert het beeld onverpakt (JPEG: de eigen bytes, afgekapt op het einde van
/// het beeld), of `None` als het bestand niet deugt of boven de grens gaat. De
/// import zelf houdt een PNG ingepakt vast (zie [`ImageStore`]).
pub fn decode(mut data: Vec<u8>, max_pixels: u64, cancelled: &dyn Fn() -> bool) -> Option<Raster> {
    let (info, end) = match inspect(&data, max_pixels).ok()? {
        Header::Jpeg { info, end } => (info, end),
        Header::Png(header) => return png_plain(&header, cancelled).ok(),
    };
    data.truncate(end);
    Some(Raster { width: info.width, height: info.height, pixels: Pixels::Jpeg { data, components: info.components } })
}

/// Breedte en hoogte uit de SOF-markering van een JPEG.
pub fn jpeg_size(data: &[u8]) -> Option<(u32, u32)> {
    jpeg_info(data).map(|info| (info.width, info.height))
}

/// Loopt de markeringen van een JPEG na tot en met het begin van de eerste
/// scan. Elke lengte wordt tegen het eind van het bestand gehouden.
pub fn jpeg_info(data: &[u8]) -> Option<JpegInfo> {
    if !data.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut frame: Option<JpegInfo> = None;
    let mut i = 2usize;
    loop {
        // Tussen segmenten mag opvulling met 0xFF staan; iets anders niet.
        if *data.get(i)? != 0xFF {
            return None;
        }
        let marker = *data.get(i.checked_add(1)?)?;
        if marker == 0xFF {
            i += 1;
            continue;
        }
        // EOI vóór een scan, of markeringen die hier niet horen.
        if marker == 0xD9 || marker == 0x00 || marker == 0xD8 || (0xD0..=0xD7).contains(&marker) {
            return None;
        }
        if marker == 0x01 {
            i += 2;
            continue;
        }
        let length = u16::from_be_bytes([*data.get(i + 2)?, *data.get(i + 3)?]) as usize;
        let next = i.checked_add(2)?.checked_add(length)?;
        if length < 2 || next > data.len() {
            return None;
        }
        let is_frame = (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
        if is_frame {
            if frame.is_some() || length < 8 {
                return None;
            }
            let precision = *data.get(i + 4)?;
            let height = u32::from(u16::from_be_bytes([*data.get(i + 5)?, *data.get(i + 6)?]));
            let width = u32::from(u16::from_be_bytes([*data.get(i + 7)?, *data.get(i + 8)?]));
            let components = *data.get(i + 9)?;
            if width == 0 || height == 0 || length != 8 + 3 * usize::from(components) {
                return None;
            }
            frame = Some(JpegInfo { width, height, components, precision, frame: marker, has_scan: false });
        } else if marker == 0xDA {
            // Een scan zonder kop ervoor is geen beeld.
            return frame.map(|info| JpegInfo { has_scan: true, ..info });
        }
        i = next;
    }
}

/// Waar het beeld van een JPEG ophoudt: direct na de eerste EOI die op de
/// scans volgt. Wat daarachter staat hoort niet bij het beeld. Binnen een scan
/// zijn een gevulde `FF 00`, herstartmarkeringen en opvulling met `FF` geen
/// einde; na een scan mogen nog tabellen en verdere scans volgen (progressief).
/// Een bestand zonder EOI (afgekapt) houdt op waar het ophoudt. `None` als een
/// segment niet deugt.
pub fn jpeg_end(data: &[u8]) -> Option<usize> {
    if !data.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut i = 2usize;
    loop {
        // Op een markering. Het bestand mag hier ophouden (afgekapt).
        let Some(first) = data.get(i) else { return Some(data.len()) };
        if *first != 0xFF {
            return None;
        }
        let Some(marker) = data.get(i + 1).copied() else { return Some(data.len()) };
        match marker {
            0xFF => {
                i += 1;
                continue;
            }
            0xD9 => return Some(i + 2),
            0x00 | 0xD8 => return None,
            0x01 | 0xD0..=0xD7 => {
                i += 2;
                continue;
            }
            _ => {}
        }
        let (Some(high), Some(low)) = (data.get(i + 2), data.get(i + 3)) else { return Some(data.len()) };
        let length = usize::from(u16::from_be_bytes([*high, *low]));
        let next = i.checked_add(2)?.checked_add(length)?;
        if length < 2 || next > data.len() {
            return None;
        }
        i = next;
        if marker != 0xDA {
            continue;
        }
        // In de scan: door tot de eerste echte markering.
        loop {
            let Some(byte) = data.get(i) else { return Some(data.len()) };
            if *byte != 0xFF {
                i += 1;
                continue;
            }
            match data.get(i + 1) {
                None => return Some(data.len()),
                Some(0x00) | Some(0xD0..=0xD7) => i += 2,
                Some(0xFF) => i += 1,
                Some(_) => break,
            }
        }
    }
}

fn be32(data: &[u8], at: usize) -> Option<u32> {
    let bytes = data.get(at..at.checked_add(4)?)?;
    Some(u32::from_be_bytes([*bytes.first()?, *bytes.get(1)?, *bytes.get(2)?, *bytes.get(3)?]))
}

/// Pakt een PNG uit naar grijs of ware kleur.
pub fn decode_png(data: &[u8], max_pixels: u64) -> Option<Raster> {
    decode_png_with(data, max_pixels, &|| false)
}

/// Als [`decode_png`], af te breken via `cancelled`.
pub fn decode_png_with(data: &[u8], max_pixels: u64, cancelled: &dyn Fn() -> bool) -> Option<Raster> {
    png_plain(&png_header(data, max_pixels).ok()?, cancelled).ok()
}

/// Een lezer over alle IDAT-stukken achter elkaar, zonder ze te kopiëren.
struct Chunks<'c, 'd> {
    parts: &'c [&'d [u8]],
    part: usize,
    at: usize,
}

impl Read for Chunks<'_, '_> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        loop {
            let Some(current) = self.parts.get(self.part) else { return Ok(0) };
            let rest = current.get(self.at..).unwrap_or(&[]);
            if rest.is_empty() {
                self.part += 1;
                self.at = 0;
                continue;
            }
            let n = rest.len().min(out.len());
            match (out.get_mut(..n), rest.get(..n)) {
                (Some(target), Some(source)) => target.copy_from_slice(source),
                _ => return Ok(0),
            }
            self.at += n;
            return Ok(n);
        }
    }
}

/// De voorspeller van Paeth (PNG-filter 4).
fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let (ia, ib, ic) = (i32::from(a), i32::from(b), i32::from(c));
    let p = ia + ib - ic;
    let (pa, pb, pc) = ((p - ia).abs(), (p - ib).abs(), (p - ic).abs());
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

/// De nagelopen koptekst van een PNG: maten, soort en waar de gegevens staan.
/// Er is nog niets uitgepakt.
struct PngHeader<'d> {
    width: u32,
    height: u32,
    depth: u8,
    color_type: u8,
    palette: &'d [u8],
    /// Het tRNS-stuk: per paletkleur een dekking, of bij grijs en ware kleur
    /// de ene monsterwaarde die doorzichtig is (de kleursleutel).
    palette_alpha: &'d [u8],
    idat: Vec<&'d [u8]>,
    /// Kanalen per beeldpunt in het bestand.
    channels: usize,
    /// Bytes per regel in het bestand, zonder de filterbyte.
    stride: usize,
    /// De uitvoer is grijs (één byte per beeldpunt), anders ware kleur (drie).
    gray: bool,
    /// Bytes van het hele uitgepakte beeld in de uitvoer.
    out_len: usize,
}

impl PngHeader<'_> {
    /// Wat het uitpakken kost: de regels zoals ze in het bestand staan, of de
    /// uitvoer als die groter is (1 bit per beeldpunt wordt 8).
    fn work_bytes(&self) -> u64 {
        let raw = (self.stride as u64).saturating_add(1).saturating_mul(u64::from(self.height));
        raw.max(self.out_len as u64)
    }
}

/// Loopt de stukken van een PNG na tot IEND. De maten gaan tegen de grenzen
/// vóórdat er iets gerekend of gealloceerd wordt.
fn png_header(data: &[u8], max_pixels: u64) -> Result<PngHeader<'_>, Failure> {
    const BAD: Failure = Failure::Unsupported;
    if !data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(BAD);
    }
    let mut i = 8usize;
    let (mut width, mut height) = (0u32, 0u32);
    let (mut depth, mut color_type, mut interlace) = (0u8, 0u8, 0u8);
    let mut palette: &[u8] = &[];
    let mut palette_alpha: &[u8] = &[];
    let mut idat: Vec<&[u8]> = Vec::new();
    let mut seen_header = false;
    while i.checked_add(8).ok_or(BAD)? <= data.len() {
        let length = be32(data, i).ok_or(BAD)? as usize;
        let kind = data.get(i + 4..i + 8).ok_or(BAD)?;
        let body_at = i + 8;
        let body = data.get(body_at..body_at.checked_add(length).ok_or(BAD)?).ok_or(BAD)?;
        // De koptekst hoort vooraan te staan: zonder maat wordt er niets
        // verzameld.
        if !seen_header && kind != b"IHDR" {
            return Err(BAD);
        }
        match kind {
            b"IHDR" => {
                if seen_header || length != 13 {
                    return Err(BAD);
                }
                width = be32(body, 0).ok_or(BAD)?;
                height = be32(body, 4).ok_or(BAD)?;
                depth = *body.get(8).ok_or(BAD)?;
                color_type = *body.get(9).ok_or(BAD)?;
                let (compression, filter) = (*body.get(10).ok_or(BAD)?, *body.get(11).ok_or(BAD)?);
                interlace = *body.get(12).ok_or(BAD)?;
                if compression != 0 || filter != 0 {
                    return Err(BAD);
                }
                seen_header = true;
            }
            b"PLTE" => palette = body,
            b"tRNS" => palette_alpha = body,
            b"IDAT" => {
                if !body.is_empty() {
                    idat.try_reserve(1).map_err(|_| Failure::TooLarge)?;
                    idat.push(body);
                }
            }
            b"IEND" => break,
            _ => {}
        }
        i = body_at.checked_add(length).and_then(|v| v.checked_add(4)).ok_or(BAD)?; // + CRC
    }
    if !seen_header || width == 0 || height == 0 || interlace != 0 || idat.is_empty() {
        return Err(BAD);
    }
    if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
        return Err(Failure::TooLarge);
    }
    // Eerst de maat tegen de grens, dan pas rekenen en alloceren.
    if u64::from(width).checked_mul(u64::from(height)).ok_or(Failure::TooLarge)? > max_pixels {
        return Err(Failure::TooLarge);
    }
    let channels: usize = match (color_type, depth) {
        (0, 1 | 2 | 4 | 8 | 16) => 1,
        (2, 8 | 16) => 3,
        (3, 1 | 2 | 4 | 8) => 1,
        (4, 8 | 16) => 2,
        (6, 8 | 16) => 4,
        _ => return Err(BAD),
    };
    if color_type == 3 && palette.len() < 3 {
        return Err(BAD);
    }
    let (w, h) = (usize::try_from(width).map_err(|_| Failure::TooLarge)?, usize::try_from(height).map_err(|_| Failure::TooLarge)?);
    let bits_per_pixel = channels * usize::from(depth);
    // Bytes per regel, naar boven afgerond.
    let stride = w.checked_mul(bits_per_pixel).and_then(|v| v.checked_add(7)).ok_or(Failure::TooLarge)? / 8;
    let gray = matches!(color_type, 0 | 4);
    let out_len = w.checked_mul(h).and_then(|v| v.checked_mul(if gray { 1 } else { 3 })).ok_or(Failure::TooLarge)?;
    Ok(PngHeader { width, height, depth, color_type, palette, palette_alpha, idat, channels, stride, gray, out_len })
}

/// Pakt de regels van een PNG één voor één uit, ontfiltert ze en geeft elke
/// regel als beeldpunten van 8 bits aan `row`. Er wordt nooit meer uitgepakt
/// dan de maten vragen, en naast de regel van `row` staan er maar twee regels
/// in het geheugen.
fn png_rows(header: &PngHeader<'_>, cancelled: &dyn Fn() -> bool, row: &mut dyn FnMut(&[u8]) -> Result<(), Failure>) -> Result<(), Failure> {
    const BAD: Failure = Failure::Unsupported;
    let (depth, channels, color_type, stride) = (header.depth, header.channels, header.color_type, header.stride);
    let w = header.width as usize;
    // De afstand waarover de filters terugkijken (minstens één byte).
    let back = (channels * usize::from(depth) / 8).max(1);
    let mut decoder = flate2::read::ZlibDecoder::new(Chunks { parts: &header.idat, part: 0, at: 0 });
    let mut line = vec![0u8; stride.checked_add(1).ok_or(Failure::TooLarge)?];
    let mut previous = vec![0u8; stride];
    let mut out: Vec<u8> = Vec::with_capacity(w * if header.gray { 1 } else { 3 });
    let max_sample = (1u32 << depth.min(8)) - 1;
    // tRNS bij grijs of ware kleur: één monsterwaarde (16 bits per kanaal, in
    // de bitdiepte van het bestand) die doorzichtig is. Die wordt wit, net als
    // een doorzichtige paletkleur. Een stuk van de verkeerde lengte telt niet.
    let be16 = |at: usize| header.palette_alpha.get(at..at + 2).map(|b| u32::from(u16::from_be_bytes([b[0], b[1]])));
    let color_key: Option<Vec<u32>> = match (color_type, header.palette_alpha.len()) {
        (0, 2) => be16(0).map(|v| vec![v]),
        (2, 6) => (0..3).map(|c| be16(c * 2)).collect(),
        _ => None,
    };
    for y in 0..header.height {
        if y % 64 == 0 && cancelled() {
            return Err(Failure::Cancelled);
        }
        // Precies één regel: een afgekapte of kapotte stroom stopt hier.
        decoder.read_exact(&mut line).map_err(|_| BAD)?;
        let (filter, current) = line.split_first_mut().ok_or(BAD)?;
        for x in 0..stride {
            let a = if x >= back { *current.get(x - back).ok_or(BAD)? } else { 0 };
            let b = *previous.get(x).ok_or(BAD)?;
            let c = if x >= back { *previous.get(x - back).ok_or(BAD)? } else { 0 };
            let predicted = match *filter {
                0 => 0,
                1 => a,
                2 => b,
                3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
                4 => paeth(a, b, c),
                _ => return Err(BAD),
            };
            let value = current.get_mut(x).ok_or(BAD)?;
            *value = value.wrapping_add(predicted);
        }
        // Eén monster: bij 16 bits de hoge byte, onder de 8 bits het stukje
        // van de byte dat bij dit beeldpunt hoort.
        let sample = |pixel: usize, channel: usize| -> Result<u32, Failure> {
            match depth {
                8 => current.get(pixel * channels + channel).map(|v| u32::from(*v)).ok_or(BAD),
                16 => current.get((pixel * channels + channel) * 2).map(|v| u32::from(*v)).ok_or(BAD),
                _ => {
                    let bit = pixel * usize::from(depth);
                    let byte = u32::from(*current.get(bit / 8).ok_or(BAD)?);
                    let shift = 8 - u32::from(depth) - (bit % 8) as u32;
                    Ok((byte >> shift) & max_sample)
                }
            }
        };
        // Het hele monster, voor de vergelijking met de kleursleutel: bij 16
        // bits beide bytes.
        let whole = |pixel: usize, channel: usize| -> Result<u32, Failure> {
            if depth == 16 {
                let at = (pixel * channels + channel) * 2;
                let (hi, lo) = (*current.get(at).ok_or(BAD)?, *current.get(at + 1).ok_or(BAD)?);
                Ok(u32::from(u16::from_be_bytes([hi, lo])))
            } else {
                sample(pixel, channel)
            }
        };
        let keyed = |pixel: usize| -> Result<bool, Failure> {
            match &color_key {
                Some(key) => {
                    for (channel, wanted) in key.iter().enumerate() {
                        if whole(pixel, channel)? != *wanted {
                            return Ok(false);
                        }
                    }
                    Ok(true)
                }
                None => Ok(false),
            }
        };
        let on_white = |value: u32, alpha: u32| -> u8 { ((value * alpha + 255 * (255 - alpha)) / 255).min(255) as u8 };
        out.clear();
        for pixel in 0..w {
            match color_type {
                0 => {
                    let v = sample(pixel, 0)?;
                    out.push(if keyed(pixel)? {
                        255
                    } else if depth < 8 {
                        (v * 255 / max_sample) as u8
                    } else {
                        v as u8
                    });
                }
                2 => {
                    let keyed = keyed(pixel)?;
                    for channel in 0..3 {
                        out.push(if keyed { 255 } else { sample(pixel, channel)? as u8 });
                    }
                }
                3 => {
                    let index = sample(pixel, 0)? as usize;
                    let alpha = u32::from(*header.palette_alpha.get(index).unwrap_or(&255));
                    for channel in 0..3 {
                        // Een index buiten het palet wordt zwart, geen fout.
                        let v = u32::from(*header.palette.get(index * 3 + channel).unwrap_or(&0));
                        out.push(on_white(v, alpha));
                    }
                }
                4 => out.push(on_white(sample(pixel, 0)?, sample(pixel, 1)?)),
                _ => {
                    let alpha = sample(pixel, 3)?;
                    for channel in 0..3 {
                        out.push(on_white(sample(pixel, channel)?, alpha));
                    }
                }
            }
        }
        row(&out)?;
        let (_, current) = line.split_first().ok_or(BAD)?;
        previous.copy_from_slice(current);
    }
    Ok(())
}

/// Het hele beeld onverpakt in het geheugen.
fn png_plain(header: &PngHeader<'_>, cancelled: &dyn Fn() -> bool) -> Result<Raster, Failure> {
    let mut out: Vec<u8> = Vec::new();
    out.try_reserve_exact(header.out_len).map_err(|_| Failure::TooLarge)?;
    png_rows(header, cancelled, &mut |row| {
        out.extend_from_slice(row);
        Ok(())
    })?;
    if out.len() != header.out_len {
        return Err(Failure::Unsupported);
    }
    let pixels = if header.gray { Pixels::Gray8(out) } else { Pixels::Rgb8(out) };
    Ok(Raster { width: header.width, height: header.height, pixels })
}

/// Het beeld regel voor regel uitgepakt en in dezelfde gang ingepakt met
/// Flate: het uitgepakte beeld bestaat nooit als geheel. `limit` is het
/// hoogste aantal ingepakte bytes; daarboven is het beeld te groot.
fn png_packed(header: &PngHeader<'_>, cancelled: &dyn Fn() -> bool, limit: u64) -> Result<Vec<u8>, Failure> {
    let mut packer = Packer::new(Some(limit));
    let mut rows = 0u32;
    // Geen ruimte voor de uitvoer (de grens of het geheugen): te groot.
    png_rows(header, cancelled, &mut |row| {
        rows += 1;
        packer.write(row).map_err(|_| Failure::TooLarge)
    })?;
    if rows != header.height {
        return Err(Failure::Unsupported);
    }
    packer.finish().map_err(|_| Failure::TooLarge)
}

/// Uitkomst van het opzoeken van een afbeelding.
#[derive(Clone, Debug)]
pub enum Lookup {
    /// Gevonden en gelezen. `key` is uniek per bestand, zodat hetzelfde beeld
    /// maar één keer in de PDF komt; hij komt zelf nooit in de PDF.
    Found { key: String, raster: Rc<Raster> },
    /// Niet gevonden.
    Missing,
    /// Geweigerd: een onveilig pad, buiten de toegestane mappen, of boven het
    /// aantal bestanden dat één import leest.
    Refused,
    /// Geweigerd om de naam: het systeem leest hem als apparaat of knipt er
    /// een punt of spatie af (zie [`Located::OddName`]).
    OddName,
    /// Te groot: beeldpunten, zijde of bestandsgrootte, of het past niet meer
    /// in wat de import aan lezen, uitpakken of vasthouden over heeft.
    TooLarge,
    /// Gevonden, maar niet te lezen, geen ondersteunde soort, of beschadigd.
    Unsupported,
}

/// De grenzen van één voorraad. De standaard is wat de constanten van deze
/// module zeggen; tests zetten ze lager om met kleine, echte bestanden te
/// kunnen werken.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub max_pixels: u64,
    pub files: usize,
    /// Verschillende paden waar naar gezocht wordt.
    pub lookups: usize,
    pub file_bytes: u64,
    pub read_bytes: u64,
    pub work_bytes: u64,
    pub total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_pixels: MAX_IMAGE_PIXELS,
            files: MAX_IMAGE_FILES,
            lookups: MAX_IMAGE_LOOKUPS,
            file_bytes: MAX_IMAGE_BYTES,
            read_bytes: MAX_IMAGE_READ_BYTES,
            work_bytes: MAX_IMAGE_WORK_BYTES,
            total_bytes: MAX_IMAGE_TOTAL_BYTES,
        }
    }
}

struct Store {
    paths: SearchPaths,
    limits: Limits,
    files_left: usize,
    lookups_left: usize,
    read_left: u64,
    work_left: u64,
    total_left: u64,
    /// Per pad zoals het in de tekening staat (plus de map waaruit gezocht
    /// werd) waar het zoeken op uitkwam, gevonden of niet: een blok met een
    /// ontbrekend beeld dat duizenden keren staat, zoekt één keer.
    by_name: HashMap<(String, Option<PathBuf>), Located>,
    /// Per bestand (gecanonicaliseerd pad) wat het lezen opleverde.
    by_file: HashMap<PathBuf, Lookup>,
    /// Wat het verslag bij naam noemt: alleen bestandsnamen, begrensd.
    listed: ExternalList,
}

impl Store {
    /// Leest één gevonden bestand binnen wat er van de begrotingen over is.
    /// Elke toets komt vóór het werk waar hij over gaat.
    fn read(&mut self, path: &Path, cancelled: &dyn Fn() -> bool) -> Result<Raster, Failure> {
        // Eén keer openen: grootte en bytes komen van dezelfde handle.
        let open = super::xref::open_regular(path).ok_or(Failure::Unsupported)?;
        if open.size() == 0 {
            return Err(Failure::Unsupported);
        }
        if open.size() > self.limits.file_bytes || open.size() > self.read_left {
            return Err(Failure::TooLarge);
        }
        self.read_left -= open.size();
        let mut data = open.read().ok_or(Failure::Unsupported)?;

        let header = inspect(&data, self.limits.max_pixels)?;
        // Wat de koptekst belooft, tegen wat er over is: vóór het uitpakken.
        // Afgeschreven wordt er meteen, ook als de stroom kapot blijkt.
        let work = header.work_bytes();
        if work > self.work_left {
            return Err(Failure::TooLarge);
        }
        self.work_left -= work;
        let raster = match header {
            Header::Jpeg { info, end } => {
                if end as u64 > self.total_left {
                    return Err(Failure::TooLarge);
                }
                data.truncate(end);
                data.shrink_to_fit();
                Raster { width: info.width, height: info.height, pixels: Pixels::Jpeg { data, components: info.components } }
            }
            Header::Png(png) => {
                let packed = png_packed(&png, cancelled, self.total_left)?;
                Raster { width: png.width, height: png.height, pixels: Pixels::Flate { data: packed, gray: png.gray } }
            }
        };
        self.total_left = self.total_left.saturating_sub(raster.byte_len());
        Ok(raster)
    }
}

/// De afbeeldingen van één import: gedeeld door alle wandelingen (grenzen en
/// tekenen, elke ruimte, elke externe verwijzing), zodat elk bestand één keer
/// gelezen wordt en de begrotingen voor de hele import gelden.
#[derive(Clone)]
pub struct ImageStore(Rc<RefCell<Store>>);

impl ImageStore {
    /// `max_pixels` kan de grens op beeldpunten alleen verlagen.
    pub fn new(paths: SearchPaths, max_pixels: u64) -> ImageStore {
        ImageStore::with_limits(paths, Limits { max_pixels: max_pixels.min(MAX_IMAGE_PIXELS), ..Limits::default() })
    }

    pub fn with_limits(paths: SearchPaths, limits: Limits) -> ImageStore {
        ImageStore(Rc::new(RefCell::new(Store {
            paths,
            limits,
            files_left: limits.files,
            lookups_left: limits.lookups,
            read_left: limits.read_bytes,
            work_left: limits.work_bytes,
            total_left: limits.total_bytes,
            by_name: HashMap::new(),
            by_file: HashMap::new(),
            listed: ExternalList::default(),
        })))
    }

    /// Zoekt en leest de afbeelding waar `raw` (een pad uit de tekening) naar
    /// wijst. `from` is de map van het bestand waar het pad in staat.
    pub fn get(&self, raw: &str, from: Option<&Path>, cancelled: &dyn Fn() -> bool) -> Lookup {
        let Ok(mut store) = self.0.try_borrow_mut() else { return Lookup::Missing };
        // Eerst het geheugen: zoeken kost bestandsoproepen, en dezelfde
        // verwijzing komt in een blok net zo vaak langs als het blok staat.
        let name = (raw.trim().to_string(), from.map(Path::to_path_buf));
        let located = match store.by_name.get(&name) {
            Some(known) => known.clone(),
            None if store.lookups_left == 0 => {
                store.listed.note(raw, ExternalKind::Image, ExternalStatus::Refused);
                return Lookup::Refused;
            }
            None => {
                store.lookups_left -= 1;
                let located = store.paths.locate(raw, from, &IMAGE_EXTENSIONS);
                store.by_name.insert(name, located.clone());
                located
            }
        };
        let (path, unfound) = match located {
            Located::Found(path) => (Some(path), Lookup::Missing),
            Located::Missing => (None, Lookup::Missing),
            Located::Refused => (None, Lookup::Refused),
            Located::OddName => (None, Lookup::OddName),
        };
        let Some(path) = path else {
            store.listed.note(raw, ExternalKind::Image, status_of(&unfound));
            return unfound;
        };
        if let Some(known) = store.by_file.get(&path) {
            return known.clone();
        }
        let outcome = if store.files_left == 0 {
            Lookup::Refused
        } else {
            store.files_left -= 1;
            match store.read(&path, cancelled) {
                Ok(raster) => Lookup::Found { key: path.to_string_lossy().into_owned(), raster: Rc::new(raster) },
                Err(Failure::TooLarge) => Lookup::TooLarge,
                Err(Failure::Unsupported) => Lookup::Unsupported,
                Err(Failure::Cancelled) => Lookup::Missing,
            }
        };
        // Afgebroken is geen uitkomst om te onthouden.
        if !cancelled() {
            store.listed.note_path(&path, ExternalKind::Image, status_of(&outcome));
            store.by_file.insert(path, outcome.clone());
        }
        outcome
    }

    /// De afbeeldingen bij naam, voor het verslag: alleen bestandsnamen,
    /// begrensd in aantal.
    pub fn listed(&self) -> ExternalList {
        self.0.try_borrow().map(|store| store.listed.clone()).unwrap_or_default()
    }
}

fn status_of(lookup: &Lookup) -> ExternalStatus {
    match lookup {
        Lookup::Found { .. } => ExternalStatus::Loaded,
        Lookup::Missing => ExternalStatus::Missing,
        Lookup::Refused => ExternalStatus::Refused,
        Lookup::OddName => ExternalStatus::OddName,
        Lookup::TooLarge => ExternalStatus::TooLarge,
        Lookup::Unsupported => ExternalStatus::Unsupported,
    }
}

// Een PNG van 2 x 2 in ware kleur; alleen voor tests (ook van andere
/// modules): rood, groen / blauw, wit.
#[cfg(test)]
pub(crate) fn tests_sample_png() -> Vec<u8> {
    let raw = [0u8, 255, 0, 0, 0, 255, 0, 0u8, 0, 0, 255, 255, 255, 255];
    tests_png(2, 2, 8, 2, &raw, &[])
}

/// Bouwt een PNG uit ruwe (al gefilterde) regels; de CRC's zijn nul, de lezer
/// controleert ze niet. `extra` zijn stukken tussen IHDR en IDAT.
#[cfg(test)]
pub(crate) fn tests_png(width: u32, height: u32, depth: u8, color_type: u8, raw: &[u8], extra: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
    fn chunk(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = (body.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(body);
        out.extend_from_slice(&[0, 0, 0, 0]);
        out
    }
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[depth, color_type, 0, 0, 0]);
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
    let packed = std::io::Write::write_all(&mut encoder, raw).ok().and_then(|_| encoder.finish().ok()).unwrap_or_default();
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    out.extend(chunk(b"IHDR", &ihdr));
    for (kind, body) in extra {
        out.extend(chunk(kind, body));
    }
    // In twee stukken: de lezer moet ze aan elkaar rijgen.
    let (first, second) = packed.split_at(packed.len() / 2);
    out.extend(chunk(b"IDAT", first));
    out.extend(chunk(b"IDAT", second));
    out.extend(chunk(b"IEND", &[]));
    out
}

/// Een minimale JPEG-kop (geen echt beeld): SOI, SOF, SOS, EOI.
#[cfg(test)]
pub(crate) fn tests_sample_jpeg(width: u16, height: u16, components: u8, frame: u8, precision: u8) -> Vec<u8> {
    let mut data = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, b'J', b'F'];
    data.extend_from_slice(&[0xFF, frame]);
    data.extend_from_slice(&(8 + 3 * u16::from(components)).to_be_bytes());
    data.push(precision);
    data.extend_from_slice(&height.to_be_bytes());
    data.extend_from_slice(&width.to_be_bytes());
    data.push(components);
    for c in 0..components {
        data.extend_from_slice(&[c + 1, 0x11, 0]);
    }
    data.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x02, 0x00, 0xFF, 0xD9]);
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_png_is_decoded_to_rgb() {
        let raster = decode_png(&tests_sample_png(), MAX_IMAGE_PIXELS).expect("png");
        assert_eq!((raster.width, raster.height), (2, 2));
        assert_eq!(raster.color_space(), "DeviceRGB");
        match raster.pixels {
            Pixels::Rgb8(data) => {
                assert_eq!(data.len(), 2 * 2 * 3);
                assert_eq!(&data[0..3], &[255, 0, 0]);
                assert_eq!(&data[9..12], &[255, 255, 255]);
            }
            other => panic!("verwachtte ware kleur: {other:?}"),
        }
    }

    #[test]
    fn every_filter_is_undone() {
        // Vier regels van 3 grijze beeldpunten, elk met een ander filter, die
        // alle vier 10, 20, 30 moeten opleveren (Paeth op de laatste).
        let raw = [
            0, 10, 20, 30, // geen
            2, 0, 0, 0, // boven
            1, 10, 10, 10, // links
            3, 5, 5, 5, // gemiddelde van links en boven: (0+10)/2, (10+20)/2, (20+30)/2
            4, 0, 0, 0, // Paeth: neemt boven (10, 20, 30)
        ];
        let raster = decode_png(&tests_png(3, 5, 8, 0, &raw, &[]), MAX_IMAGE_PIXELS).expect("png");
        assert_eq!(raster.color_space(), "DeviceGray");
        let Pixels::Gray8(data) = raster.pixels else { panic!("grijs verwacht") };
        assert_eq!(data, [10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30]);
    }

    #[test]
    fn low_bit_depths_a_palette_and_transparency_are_handled() {
        // 1 bit grijs, 10 beeldpunten breed: 1010101010 over twee bytes.
        let raster = decode_png(&tests_png(10, 1, 1, 0, &[0, 0b1010_1010, 0b1000_0000], &[]), MAX_IMAGE_PIXELS).expect("1 bit");
        let Pixels::Gray8(data) = raster.pixels else { panic!("grijs verwacht") };
        assert_eq!(data, [255, 0, 255, 0, 255, 0, 255, 0, 255, 0]);

        // Palet van 2 bits: rood, groen, (doorzichtig) blauw; index 3 bestaat niet.
        let palette: &[u8] = &[255, 0, 0, 0, 255, 0, 0, 0, 255];
        let alpha: &[u8] = &[255, 255, 0];
        let png = tests_png(4, 1, 2, 3, &[0, 0b00_01_10_11], &[(b"PLTE", palette), (b"tRNS", alpha)]);
        let raster = decode_png(&png, MAX_IMAGE_PIXELS).expect("palet");
        let Pixels::Rgb8(data) = raster.pixels else { panic!("kleur verwacht") };
        assert_eq!(data, [255, 0, 0, 0, 255, 0, 255, 255, 255, 0, 0, 0], "doorzichtig wordt wit, buiten het palet zwart");

        // 16 bits ware kleur met doorzichtigheid: de hoge byte telt.
        let raw = [0, 0x80, 0x12, 0x40, 0x34, 0x20, 0x56, 0xFF, 0xFF];
        let raster = decode_png(&tests_png(1, 1, 16, 6, &raw, &[]), MAX_IMAGE_PIXELS).expect("16 bits");
        assert_eq!(raster.pixels, Pixels::Rgb8(vec![0x80, 0x40, 0x20]));

        // Grijs met halve doorzichtigheid: halverwege naar wit.
        let raster = decode_png(&tests_png(1, 1, 8, 4, &[0, 0, 128], &[]), MAX_IMAGE_PIXELS).expect("grijs met alfa");
        assert_eq!(raster.pixels, Pixels::Gray8(vec![127]));
    }

    #[test]
    fn a_colour_key_in_trns_makes_that_colour_transparent_in_gray_and_true_colour() {
        // Grijs, 8 bits: monsterwaarde 20 is doorzichtig (wit).
        let key: &[u8] = &[0, 20];
        let raster = decode_png(&tests_png(3, 1, 8, 0, &[0, 10, 20, 30], &[(b"tRNS", key)]), MAX_IMAGE_PIXELS).expect("grijs");
        assert_eq!(raster.pixels, Pixels::Gray8(vec![10, 255, 30]));
        // Grijs, 1 bit: de sleutel staat in de bitdiepte van het bestand.
        let key: &[u8] = &[0, 1];
        let raster = decode_png(&tests_png(2, 1, 1, 0, &[0, 0b0100_0000], &[(b"tRNS", key)]), MAX_IMAGE_PIXELS).expect("1 bit");
        assert_eq!(raster.pixels, Pixels::Gray8(vec![0, 255]));
        // Ware kleur, 8 bits: magenta is de sleutel; rood blijft.
        let key: &[u8] = &[0, 255, 0, 0, 0, 255];
        let png = tests_png(2, 1, 8, 2, &[0, 255, 0, 255, 255, 0, 0], &[(b"tRNS", key)]);
        let raster = decode_png(&png, MAX_IMAGE_PIXELS).expect("ware kleur");
        assert_eq!(raster.pixels, Pixels::Rgb8(vec![255, 255, 255, 255, 0, 0]));
        // 16 bits: de hele waarde telt, niet alleen de hoge byte.
        let key: &[u8] = &[0x12, 0x34];
        let png = tests_png(2, 1, 16, 0, &[0, 0x12, 0x34, 0x12, 0x00], &[(b"tRNS", key)]);
        let raster = decode_png(&png, MAX_IMAGE_PIXELS).expect("16 bits");
        assert_eq!(raster.pixels, Pixels::Gray8(vec![255, 0x12]));
        // Een tRNS van de verkeerde lengte wordt genegeerd.
        let key: &[u8] = &[20];
        let raster = decode_png(&tests_png(1, 1, 8, 0, &[0, 20], &[(b"tRNS", key)]), MAX_IMAGE_PIXELS).expect("kort");
        assert_eq!(raster.pixels, Pixels::Gray8(vec![20]));
    }

    #[test]
    fn nonsense_and_oversized_images_are_refused_without_panic() {
        let good = tests_sample_png();
        assert!(decode_png(b"", MAX_IMAGE_PIXELS).is_none());
        assert!(decode_png(b"\x89PNG\r\n\x1a\n", MAX_IMAGE_PIXELS).is_none());
        assert!(decode_png(&good[..20], MAX_IMAGE_PIXELS).is_none());
        assert!(decode_png(&good, 3).is_none(), "boven de grens");
        assert!(decode_png(&good, 4).is_some(), "precies op de grens");
        // Elke afkapping en elke verminkte byte: nooit vastlopen.
        for cut in 0..good.len() {
            let _ = decode_png(&good[..cut], MAX_IMAGE_PIXELS);
        }
        for at in 0..good.len() {
            for value in [0u8, 1, 0x7F, 0x80, 0xFF] {
                let mut broken = good.clone();
                broken[at] = value;
                let _ = decode_png(&broken, MAX_IMAGE_PIXELS);
            }
        }
        // Vervlochten, een onbekend filter, een onmogelijke combinatie en te
        // weinig gegevens worden geweigerd.
        let mut interlaced = good.clone();
        interlaced[8 + 8 + 12] = 1;
        assert!(decode_png(&interlaced, MAX_IMAGE_PIXELS).is_none());
        assert!(decode_png(&tests_png(1, 1, 8, 0, &[9, 0], &[]), MAX_IMAGE_PIXELS).is_none(), "filter 9 bestaat niet");
        assert!(decode_png(&tests_png(1, 1, 4, 2, &[0, 0, 0, 0], &[]), MAX_IMAGE_PIXELS).is_none(), "ware kleur in 4 bits");
        assert!(decode_png(&tests_png(2, 2, 8, 0, &[0, 1, 2], &[]), MAX_IMAGE_PIXELS).is_none(), "te weinig regels");
        assert!(decode_png(&tests_png(1, 1, 8, 3, &[0, 0], &[]), MAX_IMAGE_PIXELS).is_none(), "palet ontbreekt");
        // Afgebroken tijdens het uitpakken.
        assert!(decode_png_with(&good, MAX_IMAGE_PIXELS, &|| true).is_none());
    }

    #[test]
    fn a_decompression_bomb_is_refused_before_anything_is_allocated() {
        // De kop belooft 60 000 x 60 000 beeldpunten (3,6 miljard); de stroom
        // erachter is een paar bytes.
        let bomb = tests_png(60_000, 60_000, 8, 6, &[0; 64], &[]);
        assert!(bomb.len() < 200);
        assert!(decode_png(&bomb, MAX_IMAGE_PIXELS).is_none());
        // Binnen de grens van het aantal beeldpunten, maar de stroom houdt
        // na een paar regels op: er wordt niet verder uitgepakt dan er is.
        let short = tests_png(5_000, 5_000, 8, 0, &[0; 12_000], &[]);
        assert!(decode_png(&short, MAX_IMAGE_PIXELS).is_none());
        // Een stroom die veel meer uitpakt dan de kop vraagt: alleen wat bij
        // de maat hoort wordt gelezen.
        let long = tests_png(2, 1, 8, 0, &vec![0u8; 5_000_000], &[]);
        let raster = decode_png(&long, MAX_IMAGE_PIXELS).expect("alleen de eerste regel");
        assert_eq!(raster.byte_len(), 2);
        // Eén regel van 40 miljoen beeldpunten: binnen het aantal, maar de
        // regelbuffer zou honderden megabytes vragen.
        let wide = tests_png(40_000_000, 1, 16, 6, &[0; 8], &[]);
        assert!(decode_png(&wide, MAX_IMAGE_PIXELS).is_none());
        // Maten die bij het vermenigvuldigen overlopen.
        let huge = tests_png(u32::MAX, u32::MAX, 16, 6, &[0; 8], &[]);
        assert!(decode_png(&huge, u64::MAX).is_none());
    }

    #[test]
    fn a_jpeg_keeps_its_own_bytes_after_its_header_is_checked() {
        let data = tests_sample_jpeg(4, 8, 3, 0xC0, 8);
        assert_eq!(jpeg_size(&data), Some((4, 8)));
        let raster = decode(data.clone(), MAX_IMAGE_PIXELS, &|| false).expect("jpeg");
        assert_eq!((raster.width, raster.height), (4, 8));
        assert_eq!(raster.pixels, Pixels::Jpeg { data, components: 3 });
        assert_eq!(decode(tests_sample_jpeg(4, 8, 1, 0xC2, 8), 32, &|| false).map(|r| r.color_space()), Some("DeviceGray"));

        assert!(jpeg_size(b"geen jpeg").is_none());
        assert!(decode(tests_sample_jpeg(4, 8, 3, 0xC0, 8), 31, &|| false).is_none(), "boven de grens");
        assert!(decode(tests_sample_jpeg(4, 8, 4, 0xC0, 8), MAX_IMAGE_PIXELS, &|| false).is_none(), "vier kanalen");
        assert!(decode(tests_sample_jpeg(4, 8, 3, 0xC0, 12), MAX_IMAGE_PIXELS, &|| false).is_none(), "12 bits");
        assert!(decode(tests_sample_jpeg(4, 8, 3, 0xC3, 8), MAX_IMAGE_PIXELS, &|| false).is_none(), "verliesvrij");
        assert!(decode(tests_sample_jpeg(4, 8, 3, 0xC9, 8), MAX_IMAGE_PIXELS, &|| false).is_none(), "rekenkundig gecodeerd");
        assert!(decode(tests_sample_jpeg(0, 8, 3, 0xC0, 8), MAX_IMAGE_PIXELS, &|| false).is_none(), "breedte nul");
        // Een kop zonder scan, en een segment dat langer zegt te zijn dan het bestand.
        let good = tests_sample_jpeg(4, 8, 3, 0xC0, 8);
        let without_scan = &good[..good.len() - 7];
        assert!(decode(without_scan.to_vec(), MAX_IMAGE_PIXELS, &|| false).is_none());
        let mut lying = good.clone();
        lying[4] = 0xFF;
        lying[5] = 0xFF;
        assert!(decode(lying, MAX_IMAGE_PIXELS, &|| false).is_none());
        // Elke afkapping en elke verminkte byte: nooit vastlopen.
        for cut in 0..good.len() {
            let _ = jpeg_info(&good[..cut]);
        }
        for at in 0..good.len() {
            for value in [0u8, 0x7F, 0xC0, 0xD9, 0xDA, 0xFF] {
                let mut broken = good.clone();
                broken[at] = value;
                let _ = decode(broken, MAX_IMAGE_PIXELS, &|| false);
            }
        }
    }

    /// Tijdelijke map met een paar beelden.
    fn image_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("opds-image-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Bytes die zich niet laten inpakken.
    fn noise(len: usize) -> Vec<u8> {
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        (0..len)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                (state >> 24) as u8
            })
            .collect()
    }

    /// Grijze PNG van `side` x `side` met ruis als beeldpunten (filter 0).
    fn noisy_png(side: u32) -> Vec<u8> {
        let mut raw = Vec::new();
        for row in noise((side * side) as usize).chunks(side as usize) {
            raw.push(0);
            raw.extend_from_slice(row);
        }
        tests_png(side, side, 8, 0, &raw, &[])
    }

    fn inflate(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        flate2::read::ZlibDecoder::new(data).read_to_end(&mut out).unwrap();
        out
    }

    #[test]
    fn the_store_reads_each_file_once_and_names_what_is_wrong() {
        let dir = image_dir("store");
        std::fs::write(dir.join("kaart.png"), tests_sample_png()).unwrap();
        std::fs::write(dir.join("kapot.png"), b"\x89PNG\r\n\x1a\n kapot").unwrap();
        std::fs::write(dir.join("leeg.png"), b"").unwrap();
        std::fs::write(dir.join("vermomd.png"), tests_sample_jpeg(4, 8, 3, 0xC0, 8)).unwrap();
        std::fs::write(dir.join("scan.tif"), b"II*\x00").unwrap();

        let store = ImageStore::new(SearchPaths::new(Some(&dir), &[]), MAX_IMAGE_PIXELS);
        let never = || false;
        let Lookup::Found { key, raster } = store.get("kaart.png", None, &never) else { panic!("gevonden verwacht") };
        let Lookup::Found { key: again, raster: same } = store.get("C:\\elders\\KAART.png", None, &never) else {
            panic!("gevonden verwacht")
        };
        assert!(key == again && Rc::ptr_eq(&raster, &same), "hetzelfde bestand wordt één keer gelezen");
        assert!(matches!(store.get("kapot.png", None, &never), Lookup::Unsupported));
        assert!(matches!(store.get("leeg.png", None, &never), Lookup::Unsupported));
        assert!(matches!(store.get("bestaat-niet.png", None, &never), Lookup::Missing));
        assert!(matches!(store.get("scan.tif", None, &never), Lookup::Missing), "geen soort waarnaar gezocht wordt");
        assert!(matches!(store.get("\\\\server\\deel\\kaart.png", None, &never), Lookup::Refused));
        assert!(matches!(store.get("https://elders/kaart.png", None, &never), Lookup::Refused));
        assert!(matches!(store.get("NUL.png", None, &never), Lookup::OddName));
        // De inhoud telt, niet de extensie.
        assert!(matches!(store.get("vermomd.png", None, &never), Lookup::Found { .. }));

        // Een eigen, lagere grens op het aantal beeldpunten.
        let small = ImageStore::new(SearchPaths::new(Some(&dir), &[]), 3);
        assert!(matches!(small.get("kaart.png", None, &never), Lookup::TooLarge));
        // En de grens op het aantal bestanden.
        let few = ImageStore::with_limits(SearchPaths::new(Some(&dir), &[]), Limits { files: 1, ..Limits::default() });
        assert!(matches!(few.get("kaart.png", None, &never), Lookup::Found { .. }));
        assert!(matches!(few.get("vermomd.png", None, &never), Lookup::Refused));
        assert!(matches!(few.get("kaart.png", None, &never), Lookup::Found { .. }), "wat er al is, blijft");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_path_is_looked_up_once_per_import_found_or_not() {
        let dir = image_dir("opzoeken");
        let store = ImageStore::new(SearchPaths::new(Some(&dir), &[]), MAX_IMAGE_PIXELS);
        let never = || false;
        // Niet gevonden; komt het bestand er daarna alsnog, dan is die
        // uitkomst voor deze import al bekend: er wordt niet opnieuw gezocht.
        assert!(matches!(store.get("later.png", None, &never), Lookup::Missing));
        std::fs::write(dir.join("later.png"), tests_sample_png()).unwrap();
        assert!(matches!(store.get("later.png", None, &never), Lookup::Missing), "de opzoeking is onthouden");
        // Een andere schrijfwijze is een andere opzoeking, en vindt het wel.
        assert!(matches!(store.get("map\\later.png", None, &never), Lookup::Found { .. }));
        // De map waaruit gezocht wordt hoort bij de sleutel.
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("eigen.png"), tests_sample_png()).unwrap();
        // (De map van een verwijzing is gecanonicaliseerd, zoals `XrefDoc::dir`.)
        let sub = sub.canonicalize().unwrap();
        assert!(matches!(store.get("eigen.png", None, &never), Lookup::Missing));
        assert!(matches!(store.get("eigen.png", Some(&sub), &never), Lookup::Found { .. }));

        // Boven het aantal verschillende opzoekingen wordt een nieuwe naam
        // geweigerd; wat al bekend is, blijft.
        let few = ImageStore::with_limits(SearchPaths::new(Some(&dir), &[]), Limits { lookups: 2, ..Limits::default() });
        assert!(matches!(few.get("later.png", None, &never), Lookup::Found { .. }));
        assert!(matches!(few.get("weg.png", None, &never), Lookup::Missing));
        assert!(matches!(few.get("nog-een.png", None, &never), Lookup::Refused));
        assert!(matches!(few.get("later.png", None, &never), Lookup::Found { .. }));
        assert!(matches!(few.get("weg.png", None, &never), Lookup::Missing));
        let listed: Vec<String> = few.listed().files().iter().map(|f| f.name.clone()).collect();
        assert!(listed.iter().any(|n| n == "nog-een.png"), "{listed:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_default_limits_are_the_documented_ones() {
        let limits = Limits::default();
        assert_eq!(limits.max_pixels, MAX_IMAGE_PIXELS);
        assert_eq!(limits.files, MAX_IMAGE_FILES);
        assert_eq!(limits.lookups, MAX_IMAGE_LOOKUPS);
        assert!(MAX_IMAGE_LOOKUPS >= MAX_IMAGE_FILES);
        assert_eq!(limits.file_bytes, MAX_IMAGE_BYTES);
        assert_eq!(limits.read_bytes, MAX_IMAGE_READ_BYTES);
        assert_eq!(limits.work_bytes, MAX_IMAGE_WORK_BYTES);
        assert_eq!(limits.total_bytes, MAX_IMAGE_TOTAL_BYTES);
        assert_eq!(MAX_IMAGE_PIXELS, 200_000_000);
        assert_eq!(MAX_IMAGE_TOTAL_BYTES, 128 * 1024 * 1024, "het geheugendak van de beelden");
        // De aanroeper kan de grens op beeldpunten alleen verlagen.
        let dir = image_dir("grens");
        let paths = SearchPaths::new(Some(&dir), &[]);
        assert_eq!(ImageStore::new(paths.clone(), u64::MAX).0.borrow().limits.max_pixels, MAX_IMAGE_PIXELS);
        assert_eq!(ImageStore::new(paths, 1000).0.borrow().limits.max_pixels, 1000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_jpeg_is_budgeted_on_what_it_unpacks_to_not_on_its_file_size() {
        // De import pakt een JPEG niet uit, maar wie de PDF daarna bekijkt wel:
        // een bestandje van een paar honderd bytes dat 12 000 x 10 000
        // beeldpunten in kleur belooft, kost de kijker 360 MB. De belofte van
        // de koptekst (breedte x hoogte x kanalen) gaat daarom van hetzelfde
        // werk af als bij een PNG.
        let dir = image_dir("jpeg-bom");
        let bomb = tests_sample_jpeg(12_000, 10_000, 3, 0xC0, 8);
        assert!(bomb.len() < 1_000);
        for i in 0..8 {
            std::fs::write(dir.join(format!("j{i}.jpg")), &bomb).unwrap();
        }
        let store = ImageStore::new(SearchPaths::new(Some(&dir), &[]), MAX_IMAGE_PIXELS);
        let never = || false;
        let per_image = 12_000u64 * 10_000 * 3;
        assert_eq!(MAX_IMAGE_WORK_BYTES / per_image, 1, "er past er één");
        let mut kept = 0;
        let mut too_large = 0;
        for i in 0..8 {
            match store.get(&format!("j{i}.jpg"), None, &never) {
                Lookup::Found { .. } => kept += 1,
                Lookup::TooLarge => too_large += 1,
                other => panic!("onverwacht: {other:?}"),
            }
        }
        assert_eq!((kept, too_large), (1, 7));
        assert_eq!(store.0.borrow().work_left, MAX_IMAGE_WORK_BYTES - per_image);
        // Grijs kost een derde.
        let gray = tests_sample_jpeg(1_000, 1_000, 1, 0xC0, 8);
        std::fs::write(dir.join("grijs.jpg"), &gray).unwrap();
        assert!(matches!(store.get("grijs.jpg", None, &never), Lookup::Found { .. }));
        assert_eq!(store.0.borrow().work_left, MAX_IMAGE_WORK_BYTES - per_image - 1_000_000);
    }

    #[test]
    fn what_a_header_promises_is_held_against_the_budget_before_decoding() {
        // Het scenario uit de review, met echte bestanden en de echte
        // grenzen: 256 beelden die elk 40 miljoen beeldpunten in ware kleur
        // beloven (120 MB uitpakwerk per stuk, 30 GB samen). De stroom erachter
        // is hier een paar bytes, zodat de test niets kost; het gaat om wat de
        // voorraad doet voordat hij gaat uitpakken.
        let dir = image_dir("bom");
        let bomb = tests_png(8_000, 5_000, 8, 2, &[0; 64], &[]);
        assert!(bomb.len() < 200);
        for i in 0..MAX_IMAGE_FILES {
            std::fs::write(dir.join(format!("b{i}.png")), &bomb).unwrap();
        }
        let store = ImageStore::new(SearchPaths::new(Some(&dir), &[]), MAX_IMAGE_PIXELS);
        let never = || false;
        let per_image = 8_000u64 * 5_000 * 3 + 5_000;
        let started = (MAX_IMAGE_WORK_BYTES / per_image) as usize;
        assert_eq!(started, 4, "meer dan vier van zulke beelden begint de import niet uit te pakken");
        let mut too_large = 0;
        for i in 0..MAX_IMAGE_FILES {
            match store.get(&format!("b{i}.png"), None, &never) {
                // Begonnen: het werk is afgeschreven, ook al bleek de stroom kapot.
                Lookup::Unsupported => assert!(i < started, "beeld {i} is toch uitgepakt"),
                Lookup::TooLarge => too_large += 1,
                other => panic!("onverwacht: {other:?}"),
            }
        }
        assert_eq!(too_large, MAX_IMAGE_FILES - started);
        assert_eq!(store.0.borrow().work_left, MAX_IMAGE_WORK_BYTES - started as u64 * per_image);

        // Geweigerd voor het uitpakken, niet erna: een gaaf beeld dat niet meer
        // in het werk past wordt "te groot", en tijdens het uitpakken zou de
        // afbreekvlag gevraagd zijn.
        std::fs::write(dir.join("gaaf.png"), noisy_png(64)).unwrap();
        let work = 64 * 65;
        let tight = ImageStore::with_limits(SearchPaths::new(Some(&dir), &[]), Limits { work_bytes: work - 1, ..Limits::default() });
        let polls = std::cell::Cell::new(0u32);
        let counting = || {
            polls.set(polls.get() + 1);
            false
        };
        assert!(matches!(tight.get("gaaf.png", None, &counting), Lookup::TooLarge));
        assert_eq!(polls.get(), 1, "alleen de vraag achteraf of er is afgebroken");
        let enough = ImageStore::with_limits(SearchPaths::new(Some(&dir), &[]), Limits { work_bytes: work, ..Limits::default() });
        assert!(matches!(enough.get("gaaf.png", None, &never), Lookup::Found { .. }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_is_budgeted_too() {
        // Bestanden die niets opleveren kosten wel leeswerk: ook dat houdt op.
        let dir = image_dir("lezen");
        for i in 0..4 {
            std::fs::write(dir.join(format!("r{i}.png")), noise(1_000)).unwrap();
        }
        std::fs::write(dir.join("kaart.png"), tests_sample_png()).unwrap();
        let store = ImageStore::with_limits(SearchPaths::new(Some(&dir), &[]), Limits { read_bytes: 2_500, ..Limits::default() });
        let never = || false;
        assert!(matches!(store.get("r0.png", None, &never), Lookup::Unsupported));
        assert!(matches!(store.get("r1.png", None, &never), Lookup::Unsupported));
        assert!(matches!(store.get("r2.png", None, &never), Lookup::TooLarge), "het leeswerk is op");
        assert_eq!(store.0.borrow().read_left, 500);
        // Wat nog wel past, wordt nog gelezen.
        assert!(matches!(store.get("kaart.png", None, &never), Lookup::Found { .. }));
        // Eén bestand boven de grens per bestand wordt niet eens gelezen.
        let big = ImageStore::with_limits(SearchPaths::new(Some(&dir), &[]), Limits { file_bytes: 999, ..Limits::default() });
        assert!(matches!(big.get("r3.png", None, &never), Lookup::TooLarge));
        assert_eq!(big.0.borrow().read_left, MAX_IMAGE_READ_BYTES);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_image_is_held_packed_and_budgeted_by_what_is_held() {
        let dir = image_dir("ingepakt");
        // 256 x 256 grijs, allemaal nul: 65 536 bytes uitgepakt, een handvol ingepakt.
        let mut raw = Vec::new();
        for _ in 0..256 {
            raw.push(0u8);
            raw.extend_from_slice(&[0u8; 256]);
        }
        std::fs::write(dir.join("vlak.png"), tests_png(256, 256, 8, 0, &raw, &[])).unwrap();
        std::fs::write(dir.join("ruis.png"), noisy_png(64)).unwrap();
        std::fs::write(dir.join("kleur.png"), tests_sample_png()).unwrap();
        let never = || false;

        let store = ImageStore::new(SearchPaths::new(Some(&dir), &[]), MAX_IMAGE_PIXELS);
        let Lookup::Found { raster, .. } = store.get("vlak.png", None, &never) else { panic!("gevonden verwacht") };
        let Pixels::Flate { data, gray } = &raster.pixels else { panic!("ingepakt verwacht: {:?}", raster.pixels) };
        assert!(*gray && raster.color_space() == "DeviceGray");
        assert!(data.len() < 400, "{} bytes vastgehouden voor 65 536 beeldpunten", data.len());
        assert!(inflate(data) == vec![0u8; 256 * 256]);
        assert_eq!(store.0.borrow().total_left, MAX_IMAGE_TOTAL_BYTES - data.len() as u64, "begroot op wat vastgehouden wordt");
        assert_eq!(store.0.borrow().work_left, MAX_IMAGE_WORK_BYTES - 256 * 257, "het werk telt uitgepakt");

        // Ware kleur: dezelfde beeldpunten als de losse decoder, ingepakt.
        let Lookup::Found { raster, .. } = store.get("kleur.png", None, &never) else { panic!("gevonden verwacht") };
        let Pixels::Flate { data, gray } = &raster.pixels else { panic!("ingepakt verwacht") };
        let Some(Raster { pixels: Pixels::Rgb8(plain), .. }) = decode_png(&tests_sample_png(), MAX_IMAGE_PIXELS) else { panic!("kleur") };
        assert!(!*gray && inflate(data) == plain);

        // Wat vastgehouden wordt heeft een dak: ruis laat zich niet inpakken
        // en past niet onder een dak van 1000 bytes; het vlak wel.
        let low = ImageStore::with_limits(SearchPaths::new(Some(&dir), &[]), Limits { total_bytes: 1_000, ..Limits::default() });
        assert!(matches!(low.get("ruis.png", None, &never), Lookup::TooLarge));
        assert_eq!(low.0.borrow().total_left, 1_000, "wat niet vastgehouden wordt, kost niets");
        assert!(matches!(low.get("vlak.png", None, &never), Lookup::Found { .. }));
        // Een JPEG telt met zijn eigen bytes.
        std::fs::write(dir.join("foto.jpg"), tests_sample_jpeg(4, 8, 3, 0xC0, 8)).unwrap();
        let tiny = ImageStore::with_limits(SearchPaths::new(Some(&dir), &[]), Limits { total_bytes: 10, ..Limits::default() });
        assert!(matches!(tiny.get("foto.jpg", None, &never), Lookup::TooLarge));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn packing_row_by_row_gives_the_same_stream_as_packing_the_whole_image() {
        let png = noisy_png(200);
        let Some(Raster { pixels: Pixels::Gray8(plain), .. }) = decode_png(&png, MAX_IMAGE_PIXELS) else { panic!("grijs") };
        let header = png_header(&png, MAX_IMAGE_PIXELS).unwrap();
        let packed = png_packed(&header, &|| false, u64::MAX).unwrap();
        let mut whole = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
        std::io::Write::write_all(&mut whole, &plain).unwrap();
        assert!(packed == whole.finish().unwrap());
        assert_eq!(png_packed(&header, &|| true, u64::MAX), Err(Failure::Cancelled));
        assert_eq!(png_packed(&header, &|| false, 100), Err(Failure::TooLarge));
    }

    #[test]
    fn a_jpeg_ends_at_its_end_of_image_marker() {
        let good = tests_sample_jpeg(4, 8, 3, 0xC0, 8);
        assert_eq!(jpeg_end(&good), Some(good.len()));
        // Iets wat achter het beeld is geplakt, lift niet mee de PDF in.
        let mut carrying = good.clone();
        carrying.extend_from_slice(b"PK\x03\x04 een heel ander bestand \xFF\xD9 en nog wat");
        assert_eq!(jpeg_end(&carrying), Some(good.len()));
        let raster = decode(carrying, MAX_IMAGE_PIXELS, &|| false).expect("jpeg");
        assert_eq!(raster.pixels, Pixels::Jpeg { data: good.clone(), components: 3 });

        // Binnen de scan: een gevulde FF (FF 00), een herstartmarkering en
        // opvulling met FF zijn geen einde; een tweede scan met zijn tabel
        // hoort er nog bij (progressief).
        let mut scans = good[..good.len() - 2].to_vec();
        scans.extend_from_slice(&[0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56, 0xFF, 0xFF, 0xC4, 0x00, 0x03, 0xD9]);
        scans.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x02, 0x78, 0xFF, 0xD9]);
        let end = scans.len();
        scans.extend_from_slice(b"meelifter");
        assert_eq!(jpeg_end(&scans), Some(end));
        // Zonder einde (afgekapt bestand): alles wat er is, en niets erachter.
        let cut = &good[..good.len() - 2];
        assert_eq!(jpeg_end(cut), Some(cut.len()));
        // Een segment na de scan dat langer zegt te zijn dan het bestand.
        let mut lying = good[..good.len() - 2].to_vec();
        lying.extend_from_slice(&[0xFF, 0xE1, 0xFF, 0xFF, 0x00]);
        assert_eq!(jpeg_end(&lying), None);
        assert!(decode(lying, MAX_IMAGE_PIXELS, &|| false).is_none());
        for cut in 0..scans.len() {
            let _ = jpeg_end(&scans[..cut]);
        }
    }
}
