//! Inktmaskers van Vergelijken: poort van js/compare/ink-mask.js.
//!
//! Een gerenderde pagina wordt één byte per pixel: 1 = inkt, 0 = papier. Het
//! papier is de achtergrondkleur die uit de pagina zelf geschat wordt. De
//! rijbreedte (stride) is een veelvoud van 4, zodat de detectie vier pixels
//! per 32-bits woord kan verwerken; opvulbytes blijven 0.

use super::jsmath;

/// Een inktmasker. De data staat in 32-bits woorden (vier pixels per woord,
/// little-endian bytevolgorde, net als de Uint32Array-weergave in JS).
#[derive(Clone)]
pub struct Mask {
    pub width: usize,
    pub height: usize,
    pub stride: usize,
    pub words: Vec<u32>,
}

/// maskStride (detect-plan.js)
pub fn mask_stride(width: usize) -> usize {
    (width + 3) & !3
}

impl Mask {
    /// createMask
    pub fn new(width: usize, height: usize) -> Self {
        let w = width.max(1);
        let h = height.max(1);
        let stride = mask_stride(w);
        Mask { width: w, height: h, stride, words: vec![0; stride * h / 4] }
    }

    pub fn bytes(&self) -> &[u8] {
        // Safety: u32 -> u8 heeft geen uitlijningseisen; lengte in bytes klopt.
        unsafe { std::slice::from_raw_parts(self.words.as_ptr() as *const u8, self.words.len() * 4) }
    }

    pub fn bytes_mut(&mut self) -> &mut [u8] {
        // Safety: zie bytes().
        unsafe { std::slice::from_raw_parts_mut(self.words.as_mut_ptr() as *mut u8, self.words.len() * 4) }
    }

    /// Uit losse bytes (stride * height), bijv. een testfixture.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_bytes(width: usize, height: usize, stride: usize, data: &[u8]) -> Self {
        assert_eq!(stride % 4, 0);
        assert_eq!(data.len(), stride * height);
        let mut m = Mask { width, height, stride, words: vec![0; stride * height / 4] };
        m.bytes_mut().copy_from_slice(data);
        m
    }

    pub fn byte_len(&self) -> usize {
        self.words.len() * 4
    }
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

pub const WHITE: Rgb = Rgb { r: 255, g: 255, b: 255 };

/// Kanaalvolgorde van een 4-bytes-per-pixel buffer: offsets van R en B
/// (G zit altijd op 1, alfa op 3). PDFium levert BGRA, canvas RGBA.
#[derive(Clone, Copy)]
pub struct Order {
    pub r: usize,
    pub b: usize,
}

#[cfg_attr(not(test), allow(dead_code))]
pub const RGBA: Order = Order { r: 0, b: 2 };
pub const BGRA: Order = Order { r: 2, b: 0 };

/// estimateBackground: de dominante kleur (4 bits per kanaal), gemiddeld
/// binnen die bak. Volledig transparante pixels tellen als wit.
pub fn estimate_background(px: &[u8], order: Order, width: usize, height: usize, max_samples: f64) -> Rgb {
    let n = width * height;
    if n == 0 || px.is_empty() {
        return WHITE;
    }
    let step = ((n as f64 / max_samples).sqrt().floor() as usize).max(1);
    let mut counts = vec![0u32; 4096];
    let mut sums = vec![0f64; 4096 * 3];
    let mut y = 0;
    while y < height {
        let mut p = y * width * 4;
        let mut x = 0;
        while x < width {
            let (mut r, mut g, mut b) = (px[p + order.r], px[p + 1], px[p + order.b]);
            if px[p + 3] == 0 {
                r = 255;
                g = 255;
                b = 255;
            }
            let bin = (((r >> 4) as usize) << 8) | (((g >> 4) as usize) << 4) | (b >> 4) as usize;
            counts[bin] += 1;
            sums[bin * 3] += r as f64;
            sums[bin * 3 + 1] += g as f64;
            sums[bin * 3 + 2] += b as f64;
            x += step;
            p += 4 * step;
        }
        y += step;
    }
    let mut best = 0;
    for i in 1..4096 {
        if counts[i] > counts[best] {
            best = i;
        }
    }
    let c = if counts[best] == 0 { 1.0 } else { counts[best] as f64 };
    Rgb {
        r: jsmath::round(sums[best * 3] / c) as u8,
        g: jsmath::round(sums[best * 3 + 1] / c) as u8,
        b: jsmath::round(sums[best * 3 + 2] / c) as u8,
    }
}

/// writeInkTile: schrijf de inkt van een tegel (tile_w x tile_h, 4 bytes per
/// pixel) op (ox, oy) in het masker. Geeft het aantal inktpixels terug.
#[allow(clippy::too_many_arguments)]
pub fn write_ink_tile(mask: &mut Mask, px: &[u8], order: Order, tile_w: usize, tile_h: usize, ox: usize, oy: usize, bg: Rgb, threshold: f64) -> u64 {
    let (width, height, stride) = (mask.width, mask.height, mask.stride);
    let (br, bgc, bb) = (bg.r as i32, bg.g as i32, bg.b as i32);
    let transparent_ink: u8 = if ((255 - br).abs() + (255 - bgc).abs() + (255 - bb).abs()) as f64 > threshold { 1 } else { 0 };
    let w = tile_w.min(width.saturating_sub(ox));
    let h = tile_h.min(height.saturating_sub(oy));
    if w == 0 || h == 0 {
        return 0;
    }
    // Papier exact in de achtergrondkleur (verreweg de meeste pixels van een
    // tekening) als één 32-bits woord vergelijken, net als de JS-sneltak.
    let mut paper = [0u8; 4];
    paper[order.r] = bg.r;
    paper[1] = bg.g;
    paper[order.b] = bg.b;
    paper[3] = 255;
    let paper = u32::from_ne_bytes(paper);
    let row = |src: &[u8], dst: &mut [u8]| -> u64 {
        let mut ink = 0u64;
        for (p, q) in src.chunks_exact(4).zip(dst.iter_mut()) {
            let v: u8 = if u32::from_ne_bytes([p[0], p[1], p[2], p[3]]) == paper {
                0
            } else if p[3] == 0 {
                transparent_ink
            } else {
                let s = (p[order.r] as i32 - br).abs() + (p[1] as i32 - bgc).abs() + (p[order.b] as i32 - bb).abs();
                u8::from(s as f64 > threshold)
            };
            *q = v;
            ink += v as u64;
        }
        ink
    };
    let data = &mut mask.bytes_mut()[oy * stride..(oy + h) * stride];
    let src_rows = px.chunks(tile_w * 4).take(h);
    // Rijbanden parallel: elke pixel hangt alleen van zichzelf af.
    let threads = std::thread::available_parallelism().map(|v| v.get()).unwrap_or(1).clamp(1, 8);
    if threads == 1 || w * h < 1 << 18 {
        let mut ink = 0;
        for (src, dst) in src_rows.zip(data.chunks_mut(stride)) {
            ink += row(&src[..w * 4], &mut dst[ox..ox + w]);
        }
        return ink;
    }
    let band = h.div_ceil(threads);
    let src_rows: Vec<&[u8]> = src_rows.collect();
    std::thread::scope(|sc| {
        let row = &row;
        let handles: Vec<_> = data
            .chunks_mut(band * stride)
            .zip(src_rows.chunks(band))
            .map(|(dst, srcs)| {
                sc.spawn(move || {
                    let mut ink = 0;
                    for (src, d) in srcs.iter().zip(dst.chunks_mut(stride)) {
                        ink += row(&src[..w * 4], &mut d[ox..ox + w]);
                    }
                    ink
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().expect("ink thread")).sum()
    })
}


/// Inktdichtheid per cel (0..1), box-downsample met een gehele factor.
pub struct Density {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
}

/// downsampleDensity
pub fn downsample_density(mask: &Mask, factor: usize) -> Density {
    let f = factor.max(1);
    let w = mask.width.div_ceil(f);
    let h = mask.height.div_ceil(f);
    let mut out = vec![0f32; w * h];
    let s4 = mask.stride / 4;
    let bytes = mask.bytes();
    for y in 0..mask.height {
        let row = y * mask.stride;
        let orow = (y / f) * w;
        let wrow = y * s4;
        for i in 0..s4 {
            if mask.words[wrow + i] == 0 {
                continue;
            }
            let x0 = i << 2;
            for j in 0..4 {
                let x = x0 + j;
                if x < mask.width && bytes[row + x] != 0 {
                    out[orow + x / f] += 1.0;
                }
            }
        }
    }
    let inv = 1.0 / (f * f) as f64;
    for v in out.iter_mut() {
        // JS: Float32Array-element * inv in f64, terug naar f32 bij opslaan.
        *v = ((*v as f64) * inv) as f32;
    }
    Density { width: w, height: h, data: out }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_is_the_dominant_colour() {
        let (w, h) = (40, 30);
        let mut px = vec![0u8; w * h * 4];
        for (i, p) in px.chunks_mut(4).enumerate() {
            let ink = i % 7 == 0;
            p.copy_from_slice(if ink { &[0, 0, 0, 255] } else { &[30, 40, 50, 255] });
        }
        assert_eq!(estimate_background(&px, RGBA, w, h, 250_000.0), Rgb { r: 30, g: 40, b: 50 });
        // Zelfde buffer als BGRA gelezen: R en B wisselen.
        assert_eq!(estimate_background(&px, BGRA, w, h, 250_000.0), Rgb { r: 50, g: 40, b: 30 });
    }

    #[test]
    fn ink_follows_the_threshold_and_padding_stays_zero() {
        let mut m = Mask::new(5, 2);
        assert_eq!(m.stride, 8);
        let mut px = vec![255u8; 5 * 2 * 4];
        px[4..8].copy_from_slice(&[100, 100, 100, 255]); // afstand 465
        px[8..12].copy_from_slice(&[230, 230, 230, 255]); // afstand 75
        px[12..16].copy_from_slice(&[0, 0, 0, 0]); // transparant = papier
        let ink = write_ink_tile(&mut m, &px, RGBA, 5, 2, 0, 0, WHITE, 96.0);
        assert_eq!(ink, 1);
        assert_eq!(&m.bytes()[0..8], &[0, 1, 0, 0, 0, 0, 0, 0]);
        let d = downsample_density(&m, 2);
        assert_eq!((d.width, d.height), (3, 1));
        assert_eq!(d.data, vec![0.25, 0.0, 0.0]);
    }
}
