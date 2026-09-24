//! Afbeeldingen van RGB naar CMYK.
//!
//! Indexed op een RGB-basis: alleen het palet verandert. Alle andere
//! RGB-afbeeldingen worden gedecodeerd (ASCIIHex, ASCII85, RunLength, Flate
//! met of zonder predictor, en DCT als laatste filter), omgezet en als Flate
//! met `/ColorSpace /DeviceCMYK` en 8 bits per component teruggeschreven.
//! `/Decode` wordt in de pixels verwerkt (en daarna weggelaten); `/SMask`
//! blijft gewoon staan.

use crate::lexer::{hex_string, is_ws};
use crate::transform::{to_u8, CmykTransform};
use lopdf::{Dictionary, Object};

/// Gedecodeerde afbeeldingsgegevens.
#[derive(Debug, PartialEq)]
pub enum Decoded {
    /// Ruwe samples.
    Raw(Vec<u8>),
    /// JPEG-bytes (DCTDecode was het laatste filter).
    Jpeg(Vec<u8>),
}

/// Past de filters in volgorde toe. `parms[i]` hoort bij `filters[i]`.
pub fn decode_filters(data: &[u8], filters: &[Vec<u8>], parms: &[Option<&Dictionary>]) -> Result<Decoded, &'static str> {
    let mut cur = data.to_vec();
    for (i, filter) in filters.iter().enumerate() {
        let parm = parms.get(i).copied().flatten();
        cur = match filter.as_slice() {
            b"ASCIIHexDecode" | b"AHx" => {
                let end = cur.iter().position(|&b| b == b'>').unwrap_or(cur.len());
                hex_string(&cur[..end])
            }
            b"ASCII85Decode" | b"A85" => ascii85(&cur)?,
            b"FlateDecode" | b"Fl" => predictor(inflate(&cur)?, parm)?,
            b"RunLengthDecode" | b"RL" => run_length(&cur),
            b"DCTDecode" | b"DCT" => {
                if i + 1 != filters.len() {
                    return Err("unsupportedFilter");
                }
                return Ok(Decoded::Jpeg(cur));
            }
            b"JPXDecode" => return Err("jpeg2000"),
            _ => return Err("unsupportedFilter"),
        };
    }
    Ok(Decoded::Raw(cur))
}

fn ascii85(data: &[u8]) -> Result<Vec<u8>, &'static str> {
    let data = data.strip_prefix(b"<~").unwrap_or(data);
    let mut out = Vec::with_capacity(data.len() * 4 / 5 + 4);
    let mut group = [0u8; 5];
    let mut n = 0;
    for &c in data {
        match c {
            b'~' => break,
            b'z' if n == 0 => out.extend_from_slice(&[0, 0, 0, 0]),
            b'!'..=b'u' => {
                group[n] = c - b'!';
                n += 1;
                if n == 5 {
                    let v = group.iter().fold(0u64, |acc, &d| acc * 85 + d as u64);
                    out.extend_from_slice(&(v as u32).to_be_bytes());
                    n = 0;
                }
            }
            c if is_ws(c) => {}
            _ => return Err("decodeFailed"),
        }
    }
    if n > 0 {
        for slot in group.iter_mut().skip(n) {
            *slot = 84;
        }
        let v = group.iter().fold(0u64, |acc, &d| acc * 85 + d as u64);
        out.extend_from_slice(&(v as u32).to_be_bytes()[..n - 1]);
    }
    Ok(out)
}

/// Zlib, en anders ruwe deflate. Een afgebroken stroom levert op wat er was,
/// zoals lezers dat ook tonen.
fn inflate(data: &[u8]) -> Result<Vec<u8>, &'static str> {
    use std::io::Read;
    let mut out = Vec::with_capacity(data.len().saturating_mul(3));
    let zlib = flate2::read::ZlibDecoder::new(data).read_to_end(&mut out);
    if zlib.is_ok() || !out.is_empty() {
        return Ok(out);
    }
    out.clear();
    let raw = flate2::read::DeflateDecoder::new(data).read_to_end(&mut out);
    if raw.is_ok() || !out.is_empty() {
        Ok(out)
    } else {
        Err("decodeFailed")
    }
}

fn parm_int(parm: Option<&Dictionary>, key: &[u8], default: i64) -> i64 {
    parm.and_then(|p| p.get(key).ok()).and_then(|o| o.as_i64().ok()).unwrap_or(default)
}

fn predictor(data: Vec<u8>, parm: Option<&Dictionary>) -> Result<Vec<u8>, &'static str> {
    let predictor = parm_int(parm, b"Predictor", 1);
    if predictor <= 1 {
        return Ok(data);
    }
    let colors = parm_int(parm, b"Colors", 1).clamp(1, 64) as usize;
    let bpc = parm_int(parm, b"BitsPerComponent", 8).clamp(1, 16) as usize;
    let columns = parm_int(parm, b"Columns", 1).clamp(1, 1 << 24) as usize;
    let row = (colors * bpc * columns).div_ceil(8);
    if predictor == 2 {
        if bpc != 8 {
            return Err("unsupportedFilter");
        }
        let mut out = data;
        for line in out.chunks_mut(row) {
            for i in colors..line.len() {
                line[i] = line[i].wrapping_add(line[i - colors]);
            }
        }
        return Ok(out);
    }
    if !(10..=15).contains(&predictor) {
        return Err("unsupportedFilter");
    }
    let bpp = (colors * bpc).div_ceil(8).max(1);
    let mut out = Vec::with_capacity(data.len());
    let mut prev = vec![0u8; row];
    for chunk in data.chunks(row + 1) {
        let (kind, src) = (chunk[0], &chunk[1..]);
        let mut cur = vec![0u8; row];
        cur[..src.len()].copy_from_slice(src);
        for i in 0..row {
            let left = if i >= bpp { cur[i - bpp] } else { 0 };
            let up = prev[i];
            let up_left = if i >= bpp { prev[i - bpp] } else { 0 };
            cur[i] = cur[i].wrapping_add(match kind {
                0 => 0,
                1 => left,
                2 => up,
                3 => ((left as u16 + up as u16) / 2) as u8,
                4 => paeth(left, up, up_left),
                _ => return Err("decodeFailed"),
            });
        }
        out.extend_from_slice(&cur[..src.len()]);
        prev = cur;
    }
    Ok(out)
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let p = a as i16 + b as i16 - c as i16;
    let (pa, pb, pc) = ((p - a as i16).abs(), (p - b as i16).abs(), (p - c as i16).abs());
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

fn run_length(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() * 2);
    let mut i = 0;
    while i < data.len() {
        let n = data[i] as usize;
        i += 1;
        match n {
            0..=127 => {
                let end = (i + n + 1).min(data.len());
                out.extend_from_slice(&data[i..end]);
                i = end;
            }
            128 => break,
            _ => {
                if let Some(&b) = data.get(i) {
                    out.extend(std::iter::repeat(b).take(257 - n));
                }
                i += 1;
            }
        }
    }
    out
}

/// Filternamen en hun parameters uit een (al opgelost) woordenboek, onder de
/// volledige of (bij een ingebedde afbeelding) de afgekorte sleutel.
pub fn filters_of<'a>(dict: &'a Dictionary, inline: bool) -> (Vec<Vec<u8>>, Vec<Option<&'a Dictionary>>) {
    let get = |long: &[u8], short: &[u8]| dict.get(long).ok().or_else(|| if inline { dict.get(short).ok() } else { None });
    let filters: Vec<Vec<u8>> = match get(b"Filter", b"F") {
        Some(Object::Name(n)) => vec![n.clone()],
        Some(Object::Array(a)) => a.iter().filter_map(|o| o.as_name().ok().map(|n| n.to_vec())).collect(),
        _ => Vec::new(),
    };
    let mut parms: Vec<Option<&Dictionary>> = match get(b"DecodeParms", b"DP") {
        Some(Object::Dictionary(d)) => vec![Some(d)],
        Some(Object::Array(a)) => a.iter().map(|o| o.as_dict().ok()).collect(),
        _ => Vec::new(),
    };
    parms.resize(filters.len(), None);
    (filters, parms)
}

/// Palet van een Indexed-ruimte op RGB-basis: `(hival + 1)` RGB-drietallen in,
/// evenveel CMYK-viertallen uit. Ontbrekende items tellen als zwart (0,0,0).
pub fn convert_palette(lookup: &[u8], hival: usize, t: &dyn CmykTransform) -> Vec<u8> {
    let entries = hival.min(4095) + 1;
    let mut rgb = vec![0u8; entries * 3];
    let n = lookup.len().min(rgb.len());
    rgb[..n].copy_from_slice(&lookup[..n]);
    let mut cmyk = vec![0u8; entries * 4];
    t.rgb8_to_cmyk8(&rgb, &mut cmyk);
    cmyk
}

/// Boven dit aantal pixels wordt een afbeelding niet omgezet: de buffers
/// (RGB en CMYK samen 7 bytes per pixel) zouden gigabytes worden.
const MAX_PIXELS: u64 = 256 * 1024 * 1024;

/// Kwaliteit van de CMYK-JPEG voor afbeeldingen die als JPEG binnenkwamen.
pub const JPEG_QUALITY: i32 = 92;

/// Een omgezette afbeelding: CMYK, 8 bits, ongecomprimeerd.
struct CmykPixels {
    data: Vec<u8>,
    width: usize,
    height: usize,
    /// De bron was een JPEG: dan gaat hij ook als JPEG terug. Als Flate zou
    /// een foto vele malen groter worden.
    from_jpeg: bool,
}

/// CMYK-JPEG in de Adobe-vorm: de waarden omgekeerd opgeslagen (255 = geen
/// inkt), met de APP14-markering die libjpeg-turbo bij CMYK zelf schrijft, en
/// in het afbeeldingswoordenboek `/Decode [1 0 1 0 1 0 1 0]` om terug te keren.
/// Zo ziet vrijwel elke CMYK-JPEG in bestaande PDF's eruit. PDF-lezers keren
/// een CMYK-JPEG niet uit zichzelf om (nagegaan met PDFium en PDF.js); ze
/// volgen `/Decode`.
fn encode_cmyk_jpeg(cmyk: &[u8], width: usize, height: usize) -> Result<Vec<u8>, &'static str> {
    let inverted: Vec<u8> = cmyk.iter().map(|v| 255 - v).collect();
    let image = turbojpeg::Image {
        pixels: &inverted[..],
        width,
        pitch: width * 4,
        height,
        format: turbojpeg::PixelFormat::CMYK,
    };
    turbojpeg::compress(image, JPEG_QUALITY, turbojpeg::Subsamp::None)
        .map(|buf| buf.to_vec())
        .map_err(|_| "encodeFailed")
}

/// De pixels van een RGB-afbeelding als CMYK, 8 bits, ongecomprimeerd.
/// `dict` gebruikt de volledige sleutelnamen.
fn cmyk_pixels(dict: &Dictionary, content: &[u8], t: &dyn CmykTransform, inline: bool) -> Result<CmykPixels, &'static str> {
    if matches!(dict.get(b"Mask"), Ok(Object::Array(_))) {
        return Err("colourKeyMask");
    }
    let int = |key: &[u8]| dict.get(key).ok().and_then(|o| o.as_i64().ok());
    let (w, h) = match (int(b"Width"), int(b"Height")) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w as usize, h as usize),
        _ => return Err("malformed"),
    };
    if (w as u64) * (h as u64) > MAX_PIXELS {
        return Err("tooLarge");
    }
    let bpc = int(b"BitsPerComponent").unwrap_or(8);
    let (filters, parms) = filters_of(dict, inline);
    let decode = decode_array(dict);
    let decoded = decode_filters(content, &filters, &parms)?;
    let from_jpeg = matches!(decoded, Decoded::Jpeg(_));
    let rgb = match decoded {
        Decoded::Raw(samples) => unpack_rgb8(&samples, w, h, bpc, decode)?,
        Decoded::Jpeg(bytes) => {
            let (jw, jh, mut px) = decode_jpeg(&bytes)?;
            if (jw as usize, jh as usize) != (w, h) {
                return Err("decodeFailed");
            }
            if let Some(d) = decode {
                for (i, v) in px.iter_mut().enumerate() {
                    let c = i % 3;
                    *v = to_u8(d[2 * c] + (*v as f32 / 255.0) * (d[2 * c + 1] - d[2 * c]));
                }
            }
            px
        }
    };
    let mut cmyk = vec![0u8; w * h * 4];
    t.rgb8_to_cmyk8(&rgb, &mut cmyk);
    Ok(CmykPixels { data: cmyk, width: w, height: h, from_jpeg })
}

/// `/Decode` voor drie componenten, of `None` als hij ontbreekt of de
/// standaard [0 1 0 1 0 1] is.
fn decode_array(dict: &Dictionary) -> Option<[f32; 6]> {
    let arr = dict.get(b"Decode").ok()?.as_array().ok()?;
    if arr.len() != 6 {
        return None;
    }
    let mut d = [0f32; 6];
    for (slot, o) in d.iter_mut().zip(arr) {
        *slot = o.as_float().ok()?;
    }
    (d != [0.0, 1.0, 0.0, 1.0, 0.0, 1.0]).then_some(d)
}

/// Samples van 1, 2, 4, 8 of 16 bits naar RGB met 8 bits, met `/Decode`.
/// Te korte gegevens worden met nullen aangevuld, zoals een lezer doet.
fn unpack_rgb8(samples: &[u8], w: usize, h: usize, bpc: i64, decode: Option<[f32; 6]>) -> Result<Vec<u8>, &'static str> {
    if ![1, 2, 4, 8, 16].contains(&bpc) {
        return Err("bitsPerComponent");
    }
    let bpc = bpc as usize;
    let row_bytes = (w * 3 * bpc).div_ceil(8);
    let mut out = vec![0u8; w * h * 3];
    if bpc == 8 && decode.is_none() {
        let n = samples.len().min(out.len());
        out[..n].copy_from_slice(&samples[..n]);
        return Ok(out);
    }
    let max = ((1u32 << bpc) - 1) as f32;
    let (dmin, dmax) = match decode {
        Some(d) => ([d[0], d[2], d[4]], [d[1], d[3], d[5]]),
        None => ([0.0; 3], [1.0; 3]),
    };
    for y in 0..h {
        let row = samples.get(y * row_bytes..).unwrap_or(&[]);
        let row = &row[..row.len().min(row_bytes)];
        for s in 0..w * 3 {
            let v = match bpc {
                16 => row.get(2 * s..2 * s + 2).map_or(0, |b| u16::from_be_bytes([b[0], b[1]]) as u32),
                8 => row.get(s).copied().unwrap_or(0) as u32,
                _ => {
                    let bit = s * bpc;
                    let byte = row.get(bit / 8).copied().unwrap_or(0) as u32;
                    (byte >> (8 - bpc - bit % 8)) & ((1 << bpc) - 1)
                }
            };
            let c = s % 3;
            out[y * w * 3 + s] = to_u8(dmin[c] + (v as f32 / max) * (dmax[c] - dmin[c]));
        }
    }
    Ok(out)
}

fn decode_jpeg(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), &'static str> {
    use image::ImageDecoder;
    let decoder = image::codecs::jpeg::JpegDecoder::new(std::io::Cursor::new(bytes)).map_err(|_| "decodeFailed")?;
    let (w, h) = decoder.dimensions();
    if decoder.color_type() != image::ColorType::Rgb8 {
        return Err("decodeFailed");
    }
    let mut px = vec![0u8; decoder.total_bytes() as usize];
    decoder.read_image(&mut px).map_err(|_| "decodeFailed")?;
    Ok((w, h, px))
}

pub(crate) fn deflate(data: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut e = flate2::write::ZlibEncoder::new(Vec::with_capacity(data.len() / 2), flate2::Compression::default());
    e.write_all(data).expect("schrijven naar een Vec faalt niet");
    e.finish().expect("schrijven naar een Vec faalt niet")
}

/// Zet een RGB-afbeelding (XObject) om. `dict` is het woordenboek met
/// opgeloste verwijzingen voor Width, Height, BitsPerComponent, Filter,
/// DecodeParms, Decode en Mask. Geeft het nieuwe woordenboek en de nieuwe
/// (Flate-gecomprimeerde) inhoud.
pub fn convert_rgb_image(dict: &Dictionary, content: &[u8], t: &dyn CmykTransform) -> Result<(Dictionary, Vec<u8>), &'static str> {
    let px = cmyk_pixels(dict, content, t, false)?;
    let (filter, compressed) = if px.from_jpeg {
        ("DCTDecode", encode_cmyk_jpeg(&px.data, px.width, px.height)?)
    } else {
        ("FlateDecode", deflate(&px.data))
    };
    let mut nd = dict.clone();
    nd.set("ColorSpace", Object::Name(b"DeviceCMYK".to_vec()));
    nd.set("BitsPerComponent", 8);
    nd.set("Filter", Object::Name(filter.as_bytes().to_vec()));
    nd.remove(b"DecodeParms");
    nd.remove(b"Decode");
    if px.from_jpeg {
        nd.set("Decode", Object::Array([1, 0, 1, 0, 1, 0, 1, 0].into_iter().map(Object::Integer).collect()));
    }
    nd.set("Length", compressed.len() as i64);
    Ok((nd, compressed))
}

/// Afgekorte sleutels van een ingebedde afbeelding naar de volledige namen.
const INLINE_KEYS: [(&[u8], &[u8]); 9] = [
    (b"W", b"Width"),
    (b"H", b"Height"),
    (b"BPC", b"BitsPerComponent"),
    (b"CS", b"ColorSpace"),
    (b"F", b"Filter"),
    (b"DP", b"DecodeParms"),
    (b"D", b"Decode"),
    (b"IM", b"ImageMask"),
    (b"I", b"Interpolate"),
];

fn full_key(key: &[u8]) -> &[u8] {
    INLINE_KEYS.iter().find(|(short, _)| *short == key).map(|(_, long)| *long).unwrap_or(key)
}

/// Zet een ingebedde RGB-afbeelding om en geeft het vervangende `BI … EI`-blok.
/// De gegevens gaan als `[/AHx /Fl]`: hexcijfers kunnen nooit een losse `EI`
/// vormen, dus elke lezer vindt het einde terug.
pub fn convert_inline_rgb(dict: &Dictionary, data: &[u8], t: &dyn CmykTransform) -> Result<Vec<u8>, &'static str> {
    let mut full = Dictionary::new();
    for (k, v) in dict.iter() {
        full.set(full_key(k).to_vec(), v.clone());
    }
    // Ingebed altijd als hex-Flate, ook uit een JPEG: klein, en zonder
    // binaire bytes waarin een lezer een valse `EI` zou kunnen vinden.
    let px = cmyk_pixels(&full, data, t, true)?;
    let hex: String = deflate(&px.data).iter().map(|b| format!("{b:02X}")).collect();
    let mut out = b"BI".to_vec();
    for (k, v) in dict.iter() {
        let skip = matches!(full_key(k), b"ColorSpace" | b"Filter" | b"DecodeParms" | b"Decode" | b"BitsPerComponent" | b"L" | b"Length");
        if !skip {
            out.extend_from_slice(format!(" {} {}", fmt_obj(&Object::Name(k.clone())), fmt_obj(v)).as_bytes());
        }
    }
    out.extend_from_slice(b" /BPC 8 /CS /CMYK /F [/AHx /Fl] ID\n");
    out.extend_from_slice(hex.as_bytes());
    out.extend_from_slice(b">\nEI");
    Ok(out)
}

/// Een ingebedde Indexed-afbeelding: nieuw kleurruimte-array, gegevens
/// ongewijzigd (de indices blijven gelden).
pub fn inline_with_space(dict: &Dictionary, space: Object, data: &[u8]) -> Vec<u8> {
    let mut out = b"BI".to_vec();
    let mut wrote_space = false;
    for (k, v) in dict.iter() {
        let v = if full_key(k) == b"ColorSpace" {
            wrote_space = true;
            &space
        } else {
            v
        };
        out.extend_from_slice(format!(" {} {}", fmt_obj(&Object::Name(k.clone())), fmt_obj(v)).as_bytes());
    }
    if !wrote_space {
        out.extend_from_slice(format!(" /CS {}", fmt_obj(&space)).as_bytes());
    }
    out.extend_from_slice(b" ID\n");
    out.extend_from_slice(data);
    out.extend_from_slice(b"\nEI");
    out
}

/// Een object als PDF-tekst, met spaties tussen de delen (leesbaar in de
/// inhoudsstroom). Strings gaan als hex.
pub(crate) fn fmt_obj(o: &Object) -> String {
    match o {
        Object::Null | Object::Stream(_) => "null".into(),
        Object::Boolean(b) => b.to_string(),
        Object::Integer(i) => i.to_string(),
        // Kortste weergave die precies terugleest; Rust schrijft nooit een exponent.
        Object::Real(r) if r.is_finite() && *r != 0.0 => r.to_string(),
        Object::Real(_) => "0".into(),
        Object::Name(n) => {
            let mut s = String::from("/");
            for &b in n {
                if (33..=126).contains(&b) && !b"()<>[]{}/%#".contains(&b) {
                    s.push(b as char);
                } else {
                    s.push_str(&format!("#{b:02X}"));
                }
            }
            s
        }
        Object::String(bytes, _) => format!("<{}>", bytes.iter().map(|b| format!("{b:02X}")).collect::<String>()),
        Object::Array(a) => format!("[{}]", a.iter().map(fmt_obj).collect::<Vec<_>>().join(" ")),
        Object::Dictionary(d) => {
            let inner: Vec<String> =
                d.iter().map(|(k, v)| format!("{} {}", fmt_obj(&Object::Name(k.clone())), fmt_obj(v))).collect();
            format!("<< {} >>", inner.join(" "))
        }
        Object::Reference((id, gen)) => format!("{id} {gen} R"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transform::NaiveCmyk;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use lopdf::StringFormat;
    use std::io::Write;

    fn flate(data: &[u8]) -> Vec<u8> {
        let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
        e.write_all(data).unwrap();
        e.finish().unwrap()
    }

    fn inflate(data: &[u8]) -> Vec<u8> {
        use std::io::Read;
        let mut out = Vec::new();
        flate2::read::ZlibDecoder::new(data).read_to_end(&mut out).unwrap();
        out
    }

    fn names(list: &[&str]) -> Vec<Vec<u8>> {
        list.iter().map(|s| s.as_bytes().to_vec()).collect()
    }

    fn image_dict(w: i64, h: i64, bpc: i64) -> Dictionary {
        let mut d = Dictionary::new();
        d.set("Type", Object::Name(b"XObject".to_vec()));
        d.set("Subtype", Object::Name(b"Image".to_vec()));
        d.set("Width", w);
        d.set("Height", h);
        d.set("BitsPerComponent", bpc);
        d.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
        d
    }

    #[test]
    fn flate_and_ascii_filters_decode_in_order() {
        let raw = b"hello pixels".to_vec();
        let hex: String = flate(&raw).iter().map(|b| format!("{b:02X} ")).collect::<String>() + ">";
        let out = decode_filters(hex.as_bytes(), &names(&["ASCIIHexDecode", "FlateDecode"]), &[None, None]);
        assert_eq!(out, Ok(Decoded::Raw(raw.clone())));
        // ASCII85 van "hello" is "BOu!rDZ", met z-afkorting en ~>-einde.
        let out = decode_filters(b"z BOu!rDZ~>", &names(&["A85"]), &[None]);
        assert_eq!(out, Ok(Decoded::Raw(b"\0\0\0\0hello".to_vec())));
        // RunLength: 2 letterlijk, dan 3× 'x', dan einde.
        let out = decode_filters(&[1, b'a', b'b', 254, b'x', 128], &names(&["RL"]), &[None]);
        assert_eq!(out, Ok(Decoded::Raw(b"abxxx".to_vec())));
    }

    #[test]
    fn png_up_predictor_is_undone() {
        // Twee rijen van 2 RGB-pixels; rij 2 met filter Up (2).
        let rows = [0u8, 10, 20, 30, 40, 50, 60, 2, 1, 1, 1, 1, 1, 1];
        let mut parms = Dictionary::new();
        parms.set("Predictor", 15);
        parms.set("Colors", 3);
        parms.set("Columns", 2);
        let out = decode_filters(&flate(&rows), &names(&["FlateDecode"]), &[Some(&parms)]);
        assert_eq!(out, Ok(Decoded::Raw(vec![10, 20, 30, 40, 50, 60, 11, 21, 31, 41, 51, 61])));
    }

    #[test]
    fn tiff_predictor_adds_the_left_pixel() {
        let mut parms = Dictionary::new();
        parms.set("Predictor", 2);
        parms.set("Colors", 3);
        parms.set("Columns", 2);
        let out = decode_filters(&flate(&[10, 20, 30, 1, 2, 3]), &names(&["Fl"]), &[Some(&parms)]);
        assert_eq!(out, Ok(Decoded::Raw(vec![10, 20, 30, 11, 22, 33])));
    }

    #[test]
    fn dct_must_be_last_and_other_filters_are_refused_with_a_reason() {
        assert_eq!(decode_filters(b"x", &names(&["JPXDecode"]), &[None]), Err("jpeg2000"));
        assert_eq!(decode_filters(b"x", &names(&["LZWDecode"]), &[None]), Err("unsupportedFilter"));
        assert_eq!(decode_filters(b"x", &names(&["DCTDecode", "FlateDecode"]), &[None, None]), Err("unsupportedFilter"));
        assert_eq!(decode_filters(b"jpg", &names(&["DCT"]), &[None]), Ok(Decoded::Jpeg(b"jpg".to_vec())));
    }

    #[test]
    fn filters_of_reads_names_arrays_and_abbreviations() {
        let mut d = Dictionary::new();
        d.set("Filter", Object::Array(vec![Object::Name(b"A85".to_vec()), Object::Name(b"FlateDecode".to_vec())]));
        let mut p = Dictionary::new();
        p.set("Predictor", 12);
        d.set("DecodeParms", Object::Array(vec![Object::Null, Object::Dictionary(p)]));
        let (f, parms) = filters_of(&d, false);
        assert_eq!(f, names(&["A85", "FlateDecode"]));
        assert!(parms[0].is_none());
        assert_eq!(parms[1].unwrap().get(b"Predictor").unwrap().as_i64().unwrap(), 12);

        let mut inline = Dictionary::new();
        inline.set("F", Object::Name(b"Fl".to_vec()));
        let (f, parms) = filters_of(&inline, true);
        assert_eq!(f, names(&["Fl"]));
        assert_eq!(parms, vec![None]);
    }

    #[test]
    fn palette_converts_each_entry_and_pads_missing_ones() {
        let pal = [255, 0, 0, 255, 255, 255];
        assert_eq!(convert_palette(&pal, 2, &NaiveCmyk), vec![0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255]);
    }

    #[test]
    fn raw_rgb_image_becomes_flate_cmyk() {
        let mut d = image_dict(2, 1, 8);
        d.set("SMask", Object::Reference((9, 0)));
        d.set("DecodeParms", Object::Dictionary(Dictionary::new()));
        d.set("Length", 6);
        let (nd, content) = convert_rgb_image(&d, &[255, 0, 0, 255, 255, 255], &NaiveCmyk).unwrap();
        assert_eq!(nd.get(b"ColorSpace").unwrap(), &Object::Name(b"DeviceCMYK".to_vec()));
        assert_eq!(nd.get(b"Filter").unwrap(), &Object::Name(b"FlateDecode".to_vec()));
        assert_eq!(nd.get(b"BitsPerComponent").unwrap().as_i64().unwrap(), 8);
        assert_eq!(nd.get(b"SMask").unwrap(), &Object::Reference((9, 0)));
        assert!(nd.get(b"DecodeParms").is_err());
        assert_eq!(nd.get(b"Length").unwrap().as_i64().unwrap(), content.len() as i64);
        assert_eq!(inflate(&content), vec![0, 255, 255, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn decode_array_is_applied_and_dropped() {
        let mut d = image_dict(1, 1, 8);
        d.set("Decode", Object::Array([1, 0, 1, 0, 1, 0].iter().map(|&v| Object::Integer(v)).collect()));
        let (nd, content) = convert_rgb_image(&d, &[0, 0, 0], &NaiveCmyk).unwrap();
        assert!(nd.get(b"Decode").is_err());
        // Zwart met omgekeerde Decode is wit.
        assert_eq!(inflate(&content), vec![0, 0, 0, 0]);
    }

    #[test]
    fn four_and_sixteen_bit_samples_are_unpacked() {
        // 4 bits: pixel 1 = (F,0,0) rood, pixel 2 = (0,0,0) zwart; rij = 3 bytes.
        let d = image_dict(2, 1, 4);
        let (_, content) = convert_rgb_image(&d, &[0xF0, 0x00, 0x00], &NaiveCmyk).unwrap();
        assert_eq!(inflate(&content), vec![0, 255, 255, 0, 0, 0, 0, 255]);
        // 16 bits, big-endian: wit.
        let d = image_dict(1, 1, 16);
        let (_, content) = convert_rgb_image(&d, &[0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], &NaiveCmyk).unwrap();
        assert_eq!(inflate(&content), vec![0, 0, 0, 0]);
    }

    #[test]
    fn short_data_is_padded_like_a_reader_would() {
        let d = image_dict(2, 1, 8);
        let (_, content) = convert_rgb_image(&d, &[255, 255, 255], &NaiveCmyk).unwrap();
        assert_eq!(inflate(&content), vec![0, 0, 0, 0, 0, 0, 0, 255]);
    }

    #[test]
    fn colour_key_mask_is_refused() {
        let mut d = image_dict(1, 1, 8);
        d.set("Mask", Object::Array(vec![0.into(), 0.into(), 0.into(), 0.into(), 0.into(), 0.into()]));
        assert_eq!(convert_rgb_image(&d, &[0, 0, 0], &NaiveCmyk).err(), Some("colourKeyMask"));
    }

    fn red_jpeg(size: u32) -> Vec<u8> {
        let mut jpeg = Vec::new();
        let pixels: Vec<u8> = (0..size * size).flat_map(|_| [255u8, 0, 0]).collect();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 100)
            .encode(&pixels, size, size, image::ExtendedColorType::Rgb8)
            .unwrap();
        jpeg
    }

    #[test]
    fn jpeg_image_is_written_back_as_an_adobe_cmyk_jpeg() {
        let mut d = image_dict(8, 8, 8);
        d.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        d.set("DecodeParms", Object::Dictionary(Dictionary::new()));
        let (nd, content) = convert_rgb_image(&d, &red_jpeg(8), &NaiveCmyk).unwrap();
        assert_eq!(nd.get(b"Filter").unwrap(), &Object::Name(b"DCTDecode".to_vec()));
        assert_eq!(nd.get(b"ColorSpace").unwrap(), &Object::Name(b"DeviceCMYK".to_vec()));
        assert!(nd.get(b"DecodeParms").is_err());
        // De Adobe-vorm: omgekeerd opgeslagen, en /Decode keert terug. PDF-
        // lezers keren een CMYK-JPEG niet zelf om; ze volgen /Decode.
        let decode: Vec<i64> = nd.get(b"Decode").unwrap().as_array().unwrap().iter().map(|o| o.as_i64().unwrap()).collect();
        assert_eq!(decode, vec![1, 0, 1, 0, 1, 0, 1, 0]);
        assert_eq!(nd.get(b"Length").unwrap().as_i64().unwrap(), content.len() as i64);
        assert!(content.windows(5).any(|w| w == b"Adobe"), "APP14-markering");
        let img = turbojpeg::decompress(&content, turbojpeg::PixelFormat::CMYK).unwrap();
        assert_eq!((img.width, img.height), (8, 8));
        let px = &img.pixels[..4];
        // Rood is (0, 1, 1, 0); omgekeerd opgeslagen is dat (255, 0, 0, 255).
        assert!(px[0] > 245 && px[1] < 10 && px[2] < 10 && px[3] > 245, "{px:?}");
    }

    #[test]
    fn a_photo_like_jpeg_stays_small() {
        // Vloeiende verlopen met wat ruis, zoals een foto: Flate kan daar
        // weinig mee, JPEG wel.
        let (w, h) = (128u32, 128u32);
        let mut seed = 7u32;
        let pixels: Vec<u8> = (0..w * h)
            .flat_map(|i| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                let noise = (seed >> 24) as u8 % 12;
                let (x, y) = ((i % w) as u8, (i / w) as u8);
                [x.wrapping_mul(2).wrapping_add(noise), y.wrapping_mul(2), (x / 2 + y / 2).wrapping_add(noise)]
            })
            .collect();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
            .encode(&pixels, w, h, image::ExtendedColorType::Rgb8)
            .unwrap();
        let mut d = image_dict(w as i64, h as i64, 8);
        d.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        let (_, content) = convert_rgb_image(&d, &jpeg, &NaiveCmyk).unwrap();
        let raw = (w * h * 4) as usize;
        assert!(content.len() * 4 < raw, "{} van {raw} bytes", content.len());
    }

    #[test]
    fn jpeg_with_the_wrong_size_is_refused() {
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode(&[0u8; 3 * 4], 2, 2, image::ExtendedColorType::Rgb8)
            .unwrap();
        let mut d = image_dict(3, 3, 8);
        d.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        assert_eq!(convert_rgb_image(&d, &jpeg, &NaiveCmyk).err(), Some("decodeFailed"));
    }

    #[test]
    fn inline_rgb_image_is_rewritten_with_hex_flate_data() {
        let mut d = Dictionary::new();
        d.set("W", 1);
        d.set("H", 1);
        d.set("BPC", 8);
        d.set("CS", Object::Name(b"RGB".to_vec()));
        d.set("I", true);
        let out = convert_inline_rgb(&d, &[255, 0, 0], &NaiveCmyk).unwrap();
        let text = String::from_utf8(out.clone()).unwrap();
        assert!(text.starts_with("BI "), "{text}");
        assert!(text.contains("/CS /CMYK"), "{text}");
        assert!(text.contains("/F [/AHx /Fl]"), "{text}");
        assert!(text.contains("/I true"), "{text}");
        assert!(text.ends_with(">\nEI"), "{text}");
        let hex = &text[text.find(" ID\n").unwrap() + 4..text.len() - 3];
        let bytes = crate::lexer::hex_string(hex.trim_end_matches('>').as_bytes());
        assert_eq!(inflate(&bytes), vec![0, 255, 255, 0]);
    }

    #[test]
    fn inline_indexed_image_keeps_its_data() {
        let mut d = Dictionary::new();
        d.set("W", 2);
        d.set("H", 1);
        d.set("BPC", 8);
        let space = Object::Array(vec![
            Object::Name(b"I".to_vec()),
            Object::Name(b"CMYK".to_vec()),
            Object::Integer(0),
            Object::String(vec![0, 0, 0, 255], StringFormat::Hexadecimal),
        ]);
        let out = inline_with_space(&d, space, b"\x00\x00");
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("/CS [/I /CMYK 0 <000000FF>]"), "{text}");
        assert!(out.ends_with(b" ID\n\x00\x00\nEI"), "{text}");
    }
}
