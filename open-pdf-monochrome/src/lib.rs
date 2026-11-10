//! Verliesloze monochroom-hercompressie per beeld (#902), het rekenwerk van
//! `optimizeMonochromeImage()` in `js/pdf/monochrome-image.js`.
//!
//! De JS-kant blijft de PDF-structuur lezen en beslissen óf een beeld in
//! aanmerking komt (filters, kleurruimte, maskers, grenzen); hierheen komen
//! alleen de ruwe streambytes plus de afgeleide getallen. Hier gebeurt:
//! Flate uitpakken, acht-bit grijs/RGB tot één bit pakken (alleen zuiver
//! zwart/wit), Flate en CCITT G4 coderen en de kleinste complete stream
//! kiezen. Volgorde van controles en redenen is gelijk aan de JS-route.

mod ccitt_g4;

pub use ccitt_g4::{encode_ccitt_g4, G4Error};

use flate2::{Decompress, FlushDecompress, Status};

/// Wat de JS-kant al uit het beeldwoordenboek heeft afgeleid.
#[derive(Debug, Clone)]
pub struct Params {
    pub width: usize,
    pub height: usize,
    /// 1 of 8.
    pub bits: u8,
    /// 1 (grijs/één bit) of 3 (DeviceRGB, acht bit).
    pub channels: u8,
    /// De bron is /FlateDecode (anders ongecodeerd).
    pub flate_source: bool,
    /// ceil(width * channels * bits / 8) * height.
    pub decoded_size: usize,
    /// Bovengrens voor elke gecodeerde kandidaat (Flate en CCITT).
    pub output_cap: usize,
    /// Past de CCITT-kandidaat binnen het werkgeheugenbudget?
    pub ccitt_fits: bool,
    pub black_is1: bool,
    /// Acht bit: is /Decode bruikbaar? Zo niet: 'unsupported-decode' na het uitpakken.
    pub decode_ok: bool,
    /// Grootte van de complete oorspronkelijke streamobject.
    pub before: u64,
    /// Grootte van het complete Flate- resp. CCITT-streamobject met /Length 0
    /// en lege data; met n databytes wordt dat `base - 1 + cijfers(n) + n`.
    pub flate_base: u64,
    pub ccitt_base: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    Flate,
    Ccitt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Beeld blijft staan; reden zoals in de JS-route.
    Skip(&'static str),
    Encoded { filter: Filter, data: Vec<u8>, flate_len: Option<usize>, ccitt_len: Option<usize> },
}

fn digits(n: usize) -> u64 {
    n.to_string().len() as u64
}

/// Grootte van een serialiseerde stream met `base` (bij /Length 0) en `n` databytes.
pub fn stream_size(base: u64, n: usize) -> u64 {
    base - 1 + digits(n) + n as u64
}

enum Inflate {
    Ok(Vec<u8>),
    Limit,
    Invalid,
}

// Zoals DecompressionStream('deflate'): zlib-formaat, afgekapte invoer en
// rommel na het einde zijn fouten; meer dan `limit` bytes is de grens.
fn inflate(input: &[u8], limit: usize) -> Inflate {
    let mut d = Decompress::new(true);
    let mut out = vec![0u8; limit.saturating_add(1)];
    match d.decompress(input, &mut out, FlushDecompress::Finish) {
        Ok(status) => {
            let produced = d.total_out() as usize;
            if produced > limit {
                return Inflate::Limit;
            }
            if status != Status::StreamEnd {
                return Inflate::Invalid;
            }
            if (d.total_in() as usize) != input.len() {
                return Inflate::Invalid;
            }
            out.truncate(produced);
            Inflate::Ok(out)
        }
        Err(_) => {
            if d.total_out() as usize > limit { Inflate::Limit } else { Inflate::Invalid }
        }
    }
}

// Zoals CompressionStream('deflate') (zlib-formaat, standaardniveau 6) met een
// uitvoerplafond: None als het resultaat niet binnen `cap` bytes past.
// zlib-rs i.p.v. flate2/miniz_oxide: ruim twee keer zo snel en iets kleiner
// op scans; de bytes verschillen van de webview-zlib, de inhoud niet.
fn deflate(input: &[u8], cap: usize) -> Option<Vec<u8>> {
    let mut out = vec![0u8; cap];
    let (data, rc) = zlib_rs::compress_slice(&mut out, input, zlib_rs::DeflateConfig::default());
    if rc != zlib_rs::ReturnCode::Ok {
        return None;
    }
    let n = data.len();
    out.truncate(n);
    Some(out)
}

/// Acht-bit samples naar één bit (bit 1 = 255); None als een sample niet
/// zuiver zwart/wit is (of bij RGB de kanalen niet gelijk zijn).
pub fn pack_bilevel(samples: &[u8], width: usize, height: usize, channels: usize) -> Option<Vec<u8>> {
    let stride = width.div_ceil(8);
    let mut packed = vec![0u8; stride * height];
    for y in 0..height {
        let row = &samples[y * width * channels..(y + 1) * width * channels];
        let out = &mut packed[y * stride..(y + 1) * stride];
        if channels == 1 {
            for (x, &v) in row.iter().enumerate() {
                if v == 255 {
                    out[x >> 3] |= 128 >> (x & 7);
                } else if v != 0 {
                    return None;
                }
            }
        } else {
            for (x, px) in row.chunks_exact(channels).enumerate() {
                let v = px[0];
                if (v != 0 && v != 255) || px[1..].iter().any(|&c| c != v) {
                    return None;
                }
                if v == 255 {
                    out[x >> 3] |= 128 >> (x & 7);
                }
            }
        }
    }
    Some(packed)
}

/// Het rekenwerk van één beeld. `input` zijn de ruwe streambytes.
pub fn optimize(input: &[u8], p: &Params) -> Outcome {
    if p.width == 0 || p.height == 0 || !(p.bits == 1 || p.bits == 8) || !(p.channels == 1 || p.channels == 3) {
        return Outcome::Skip("invalid-image-data");
    }
    let owned;
    let samples: &[u8] = if p.flate_source {
        match inflate(input, p.decoded_size) {
            Inflate::Ok(v) => {
                owned = v;
                &owned
            }
            Inflate::Limit => return Outcome::Skip("decoded-or-output-limit"),
            Inflate::Invalid => return Outcome::Skip("invalid-image-data"),
        }
    } else {
        input
    };
    if samples.len() != p.decoded_size {
        return Outcome::Skip("invalid-sample-length");
    }
    let packed_owned;
    let packed: &[u8] = if p.bits == 8 {
        if !p.decode_ok {
            return Outcome::Skip("unsupported-decode");
        }
        match pack_bilevel(samples, p.width, p.height, p.channels as usize) {
            Some(v) => {
                packed_owned = v;
                &packed_owned
            }
            None => return Outcome::Skip("not-black-and-white"),
        }
    } else {
        samples
    };
    let flate = deflate(packed, p.output_cap);
    let ccitt = if p.ccitt_fits {
        // Alleen interessant als het kleiner is dan Flate: daar stopt de encoder.
        let max = flate.as_ref().map(|f| f.len()).unwrap_or(p.output_cap);
        encode_ccitt_g4(packed, p.width, p.height, p.black_is1, Some(max)).ok()
    } else {
        None
    };
    if flate.is_none() && ccitt.is_none() {
        return Outcome::Skip("decoded-or-output-limit");
    }
    let flate_len = flate.as_ref().map(|f| f.len());
    let ccitt_len = ccitt.as_ref().map(|c| c.len());
    // Complete streamobjecten vergelijken; bij gelijke grootte wint Flate.
    let mut best: Option<(Filter, Vec<u8>)> = None;
    let mut after = u64::MAX;
    for (filter, data, base) in [(Filter::Flate, flate, p.flate_base), (Filter::Ccitt, ccitt, p.ccitt_base)] {
        if let Some(data) = data {
            let size = stream_size(base, data.len());
            if size < after {
                after = size;
                best = Some((filter, data));
            }
        }
    }
    if after >= p.before {
        return Outcome::Skip("not-smaller");
    }
    let (filter, data) = best.expect("minstens één kandidaat");
    Outcome::Encoded { filter, data, flate_len, ccitt_len }
}

#[cfg(test)]
mod tests;
