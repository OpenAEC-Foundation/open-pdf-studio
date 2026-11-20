//! PNG naar de streams van een beeld-XObject.
//!
//! De JS-route pakt de PNG uit tot acht-bit RGBA, splitst in RGB en alfa en
//! pakt beide opnieuw in; een alfastream komt er alleen als ergens alfa < 255
//! is. Hier gebeurt hetzelfde, met dezelfde uitkomst per pixel. De gepakte
//! bytes mogen verschillen, de inhoud niet.
//!
//! Wat naar JavaScript gaat (`Skip`): zestien bit, geïnterlinieerd, elk
//! transparantie-blok (`tRNS`), animatie, en alles wat de decoder afkeurt
//! (controlesommen worden hier wel nagekeken).

use std::io::Cursor;

/// Bovengrens in pixels; daarboven blijft het in JavaScript.
pub const MAX_PIXELS: u64 = 250_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PngStreams {
    pub width: u32,
    pub height: u32,
    /// Altijd 8.
    pub bits: u8,
    /// DeviceRGB, Flate.
    pub rgb: Vec<u8>,
    /// DeviceGray, Flate; alleen als er een pixel met alfa < 255 is.
    pub alpha: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PngOutcome {
    Skip(&'static str),
    Streams(PngStreams),
}

// De blokken zoals de JS-decoder ze afloopt (zonder controlesom): staat er
// ergens transparantie of animatie in, dan is het voor JavaScript.
fn heeft_bijzonder_blok(bytes: &[u8]) -> bool {
    let mut offset = 8usize;
    while offset + 8 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]) as usize;
        let soort = &bytes[offset + 4..offset + 8];
        if matches!(soort, b"tRNS" | b"acTL" | b"fcTL" | b"fdAT") {
            return true;
        }
        if soort == b"IEND" {
            return false;
        }
        offset = match offset.checked_add(len).and_then(|o| o.checked_add(12)) {
            Some(o) => o,
            None => return true,
        };
    }
    false
}

/// Ongepakte RGB (3 bytes per pixel) en alfa (1 byte per pixel).
pub struct Kanalen {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<u8>,
    pub alpha: Vec<u8>,
    pub heeft_alfa: bool,
}

/// PNG uitpakken tot RGB en alfa, pixel voor pixel zoals de JS-route.
pub fn kanalen(bytes: &[u8]) -> Result<Kanalen, &'static str> {
    if bytes.len() < 8 || bytes[..8] != [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return Err("not-png");
    }
    if heeft_bijzonder_blok(bytes) {
        return Err("transparency-or-animation");
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::IDENTITY);
    decoder.ignore_checksums(false);
    let mut reader = decoder.read_info().map_err(|_| "invalid-png")?;
    let (width, height, kleur, diepte) = {
        let info = reader.info();
        if info.interlaced {
            return Err("interlaced");
        }
        if info.trns.is_some() || info.animation_control.is_some() {
            return Err("transparency-or-animation");
        }
        (info.width, info.height, info.color_type, info.bit_depth as u8)
    };
    if diepte == 16 {
        return Err("sixteen-bit");
    }
    let area64 = width as u64 * height as u64;
    if area64 == 0 || area64 > MAX_PIXELS {
        return Err("size");
    }
    let (w, h, area) = (width as usize, height as usize, area64 as usize);
    let palet: Option<Vec<u8>> = reader.info().palette.as_ref().map(|p| p.to_vec());
    let mut data = vec![0u8; reader.output_buffer_size().ok_or("size")?];
    reader.next_frame(&mut data).map_err(|_| "invalid-png")?;

    let mut rgb = vec![0u8; area * 3];
    let mut alpha = vec![255u8; area];
    let mut heeft_alfa = false;
    use png::ColorType::*;
    match (kleur, diepte) {
        (Rgba, 8) => {
            if data.len() < area * 4 {
                return Err("invalid-png");
            }
            let mut laagste = 255u8;
            for ((bron, doel), a) in data.chunks_exact(4).zip(rgb.chunks_exact_mut(3)).zip(alpha.iter_mut()) {
                doel[0] = bron[0];
                doel[1] = bron[1];
                doel[2] = bron[2];
                *a = bron[3];
                laagste &= bron[3];
            }
            heeft_alfa = laagste != 255;
        }
        (Rgb, 8) => {
            if data.len() < area * 3 {
                return Err("invalid-png");
            }
            rgb.copy_from_slice(&data[..area * 3]);
        }
        (GrayscaleAlpha, 8) => {
            if data.len() < area * 2 {
                return Err("invalid-png");
            }
            let mut laagste = 255u8;
            for ((bron, doel), a) in data.chunks_exact(2).zip(rgb.chunks_exact_mut(3)).zip(alpha.iter_mut()) {
                doel[0] = bron[0];
                doel[1] = bron[0];
                doel[2] = bron[0];
                *a = bron[1];
                laagste &= bron[1];
            }
            heeft_alfa = laagste != 255;
        }
        (Grayscale, 1 | 2 | 4 | 8) | (Indexed, 1 | 2 | 4 | 8) => {
            let d = diepte as usize;
            let bpl = (w * d).div_ceil(8);
            if data.len() < bpl * h {
                return Err("invalid-png");
            }
            let masker = ((1u16 << d) - 1) as u8;
            let schaal = 255 / masker; // 255, 85, 17, 1
            let per_byte = 8 / d;
            let palet = if kleur == Indexed { Some(palet.ok_or("invalid-png")?) } else { None };
            for y in 0..h {
                let rij = &data[y * bpl..(y + 1) * bpl];
                let doel = &mut rgb[y * w * 3..(y + 1) * w * 3];
                for x in 0..w {
                    let v = if d == 8 { rij[x] } else { (rij[x / per_byte] >> (8 - d - (x % per_byte) * d)) & masker };
                    let px = &mut doel[x * 3..x * 3 + 3];
                    match &palet {
                        // Een index buiten het palet geeft nul, zoals in JS.
                        Some(p) => {
                            let o = v as usize * 3;
                            px[0] = p.get(o).copied().unwrap_or(0);
                            px[1] = p.get(o + 1).copied().unwrap_or(0);
                            px[2] = p.get(o + 2).copied().unwrap_or(0);
                        }
                        None => {
                            let g = v * schaal;
                            px[0] = g;
                            px[1] = g;
                            px[2] = g;
                        }
                    }
                }
            }
        }
        _ => return Err("unsupported-png"),
    }
    Ok(Kanalen { width, height, rgb, alpha, heeft_alfa })
}

/// PNG naar de twee Flate-streams. Kleur en alfa worden naast elkaar gepakt.
pub fn png_to_xobject(bytes: &[u8]) -> PngOutcome {
    let k = match kanalen(bytes) {
        Ok(k) => k,
        Err(reden) => return PngOutcome::Skip(reden),
    };
    let (rgb, alpha) = std::thread::scope(|s| {
        let alfa_taak = k.heeft_alfa.then(|| s.spawn(|| crate::deflate(&k.alpha, 6)));
        let rgb = crate::deflate(&k.rgb, 6);
        (rgb, alfa_taak.map(|t| t.join().ok().flatten()))
    });
    let Some(rgb) = rgb else { return PngOutcome::Skip("deflate") };
    let alpha = match alpha {
        None => None,
        Some(Some(a)) => Some(a),
        Some(None) => return PngOutcome::Skip("deflate"),
    };
    if rgb.len() > u32::MAX as usize - 1 || alpha.as_ref().is_some_and(|a| a.len() > u32::MAX as usize - 1) {
        return PngOutcome::Skip("size");
    }
    PngOutcome::Streams(PngStreams { width: k.width, height: k.height, bits: 8, rgb, alpha })
}

/// Het antwoord van het commando `png_naar_xobject`:
///   byte 0 = 0: overslaan, daarna de reden (ASCII)
///   byte 0 = 1: byte 1 bits per component, byte 2 kleurruimte (1 = DeviceRGB),
///               byte 3 alfa (0/1), dan u32 LE breedte, hoogte, lengte kleur,
///               lengte alfa (0xFFFFFFFF = geen), dan kleur- en alfabytes.
pub fn response(uitkomst: PngOutcome) -> Vec<u8> {
    match uitkomst {
        PngOutcome::Skip(reden) => {
            let mut out = Vec::with_capacity(1 + reden.len());
            out.push(0);
            out.extend_from_slice(reden.as_bytes());
            out
        }
        PngOutcome::Streams(s) => {
            let alfa_len = s.alpha.as_ref().map(|a| a.len());
            let mut out = Vec::with_capacity(20 + s.rgb.len() + alfa_len.unwrap_or(0));
            out.extend_from_slice(&[1, s.bits, 1, alfa_len.is_some() as u8]);
            out.extend_from_slice(&s.width.to_le_bytes());
            out.extend_from_slice(&s.height.to_le_bytes());
            out.extend_from_slice(&(s.rgb.len() as u32).to_le_bytes());
            out.extend_from_slice(&alfa_len.map(|n| n as u32).unwrap_or(u32::MAX).to_le_bytes());
            out.extend_from_slice(&s.rgb);
            if let Some(a) = &s.alpha {
                out.extend_from_slice(a);
            }
            out
        }
    }
}
