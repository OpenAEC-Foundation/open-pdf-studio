//! Symbolen zoeken: regel voor regel uit js/search/symbol-matcher.js
//! (binaryImage, cropTemplate, transformTemplate, matchSymbols,
//! suppressMatches). Op hetzelfde binaire beeld en sjabloon geeft dit
//! dezelfde treffers in dezelfde volgorde, met bitgelijke scores (tests.rs).
//!
//! Anders dan de JS-versie pauzeert dit niet om de 16 rijen (het draait
//! buiten de interface-thread) en lopen de rijen van een variant op een paar
//! threads; de treffers worden daarna in rijvolgorde samengevoegd, zodat de
//! grens van 5000 kandidaten op dezelfde plek valt.

use crate::round;

/// Kandidaten waarna het zoeken stopt (matchSymbols).
const MAX_FOUND: usize = 5000;
/// Treffers in het antwoord.
const MAX_MATCHES: usize = 1000;

#[derive(Debug, Clone, PartialEq)]
pub struct Binary {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Variant {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
    pub rotation: u32,
    pub scale: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Match {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
    pub score: f64,
    pub rotation: u32,
    pub scale: f64,
}

/// binaryImage(): inkt = gemiddelde van de kleurkanalen onder 170 en alfa
/// boven 128. De som is voor BGRA en RGBA gelijk, en `(r + g + b) / 3 < 170`
/// is voor gehele kanalen hetzelfde als `r + g + b < 510`.
pub fn binary_image(data: &[u8], width: usize, height: usize, max_pixels: usize) -> Result<Binary, &'static str> {
    if width < 1 || height < 1 || width.checked_mul(height).map_or(true, |n| n > max_pixels) || data.len() != width * height * 4 {
        return Err("INVALID_IMAGE");
    }
    let pixels = data
        .chunks_exact(4)
        .map(|p| u8::from(u32::from(p[0]) + u32::from(p[1]) + u32::from(p[2]) < 510 && p[3] > 128))
        .collect();
    Ok(Binary { width, height, pixels })
}

/// cropTemplate()
pub fn crop_template(image: &Binary, rect: (f64, f64, f64, f64)) -> Result<Binary, &'static str> {
    let (x, y, width, height) = (rect.0.floor(), rect.1.floor(), rect.2.ceil(), rect.3.ceil());
    if ![x, y, width, height].iter().all(|v| v.is_finite())
        || x < 0.0
        || y < 0.0
        || width < 6.0
        || height < 6.0
        || width > 160.0
        || height > 160.0
        || x + width > image.width as f64
        || y + height > image.height as f64
    {
        return Err("TEMPLATE_BOUNDS");
    }
    let (x, y, width, height) = (x as usize, y as usize, width as usize, height as usize);
    let mut pixels = Vec::with_capacity(width * height);
    for row in 0..height {
        let start = (y + row) * image.width + x;
        pixels.extend_from_slice(&image.pixels[start..start + width]);
    }
    let count: usize = pixels.iter().map(|&p| p as usize).sum();
    if count < 8 || count as f64 > pixels.len() as f64 * 0.75 {
        return Err("TEMPLATE_NEEDS_CONTRAST");
    }
    Ok(Binary { width, height, pixels })
}

/// transformTemplate()
pub fn transform_template(template: &Binary, rotation: u32, scale: f64) -> Result<Variant, &'static str> {
    if ![0, 90, 180, 270].contains(&rotation) || !scale.is_finite() || !(0.5..=2.0).contains(&scale) {
        return Err("INVALID_TOLERANCE");
    }
    let w = round(template.width as f64 * scale).max(1.0) as usize;
    let h = round(template.height as f64 * scale).max(1.0) as usize;
    let (width, height) = if rotation % 180 != 0 { (h, w) } else { (w, h) };
    let mut pixels = vec![0u8; width * height];
    for y in 0..h {
        let sy = ((y as f64 / scale).floor() as usize).min(template.height - 1);
        for x in 0..w {
            let (dx, dy) = match rotation {
                90 => (h - y - 1, x),
                180 => (w - x - 1, h - y - 1),
                270 => (y, w - x - 1),
                _ => (x, y),
            };
            let sx = ((x as f64 / scale).floor() as usize).min(template.width - 1);
            pixels[dy * width + dx] = template.pixels[sy * template.width + sx];
        }
    }
    Ok(Variant { width, height, pixels, rotation, scale })
}

fn intersection(a: &Match, b: &Match) -> f64 {
    let w = ((a.x + a.width).min(b.x + b.width) as f64 - a.x.max(b.x) as f64).max(0.0);
    let h = ((a.y + a.height).min(b.y + b.height) as f64 - a.y.max(b.y) as f64).max(0.0);
    w * h
}

/// suppressMatches(): beste eerst, overlappende treffers vallen weg.
pub fn suppress_matches(matches: &[Match], limit: usize) -> Vec<Match> {
    let mut sorted = matches.to_vec();
    // Stabiel, zoals Array.prototype.sort: score aflopend, dan y, dan x.
    sorted.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then(a.y.cmp(&b.y)).then(a.x.cmp(&b.x)));
    let mut out: Vec<Match> = Vec::new();
    for m in sorted {
        let overlaps = out.iter().any(|p| intersection(p, &m) / ((p.width * p.height).min(m.width * m.height) as f64) > 0.4);
        if !overlaps {
            out.push(m);
            if out.len() == limit {
                break;
            }
        }
    }
    out
}

/// Ontdubbelen zoals `new Set(...)`: eerste voorkomen blijft, volgorde ook.
fn unique<T: Copy>(values: &[T], same: impl Fn(T, T) -> bool) -> Vec<T> {
    let mut out: Vec<T> = Vec::new();
    for &v in values {
        if !out.iter().any(|&o| same(o, v)) {
            out.push(v);
        }
    }
    out
}

/// De treffers van één rij van één variant, in x-volgorde.
#[allow(clippy::too_many_arguments)]
fn scan_row(image: &Binary, integral: &[u32], t: &Variant, foreground: usize, offsets: &[usize], threshold: f64, y: usize, out: &mut Vec<Match>) {
    let stride = image.width + 1;
    let fg = foreground as f64;
    let need = offsets.len() as f64 * (threshold * 0.75).max(0.5);
    for x in 0..=image.width - t.width {
        let count = f64::from(
            integral[(y + t.height) * stride + x + t.width]
                .wrapping_sub(integral[y * stride + x + t.width])
                .wrapping_sub(integral[(y + t.height) * stride + x])
                .wrapping_add(integral[y * stride + x]),
        );
        if count.min(fg) / 1f64.max(count).max(fg) < threshold {
            continue;
        }
        let start = y * image.width + x;
        let hits: u32 = offsets.iter().map(|&o| u32::from(image.pixels[start + o])).sum();
        if f64::from(hits) < need {
            continue;
        }
        let (mut both, mut union) = (0u32, 0u32);
        for row in 0..t.height {
            let a = &t.pixels[row * t.width..(row + 1) * t.width];
            let b = &image.pixels[start + row * image.width..start + row * image.width + t.width];
            for (&p, &q) in a.iter().zip(b) {
                both += u32::from(p & q);
                union += u32::from(p | q);
            }
        }
        let score = f64::from(both) / f64::from(union.max(1));
        if score >= threshold {
            out.push(Match { x, y, width: t.width, height: t.height, score, rotation: t.rotation, scale: t.scale });
        }
    }
}

pub struct Found {
    pub matches: Vec<Match>,
    pub truncated: bool,
}

/// matchSymbols()
pub fn match_symbols(image: &Binary, template: &Binary, threshold: f64, rotations: &[u32], scales: &[f64]) -> Result<Found, &'static str> {
    if !threshold.is_finite() || !(0.5..=1.0).contains(&threshold) || rotations.is_empty() || rotations.len() > 4 || scales.is_empty() || scales.len() > 3 {
        return Err("INVALID_TOLERANCE");
    }
    let mut variants = Vec::new();
    for &rotation in &unique(rotations, |a, b| a == b) {
        for &scale in &unique(scales, |a: f64, b: f64| a == b || (a.is_nan() && b.is_nan())) {
            variants.push(transform_template(template, rotation, scale)?);
        }
    }
    // Voorgrondsommen: lege en volle vensters vallen af vóór het vergelijken.
    let stride = image.width + 1;
    let mut integral = vec![0u32; stride * (image.height + 1)];
    for y in 0..image.height {
        let mut row = 0u32;
        for x in 0..image.width {
            row += u32::from(image.pixels[y * image.width + x]);
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1].wrapping_add(row);
        }
    }
    let threads = std::thread::available_parallelism().map(|v| v.get()).unwrap_or(1).clamp(1, 8);
    let mut found: Vec<Match> = Vec::new();
    let mut truncated = false;
    'variants: for t in &variants {
        let foreground: Vec<usize> = (0..t.pixels.len()).filter(|&i| t.pixels[i] != 0).collect();
        if foreground.is_empty() || t.height > image.height || t.width > image.width {
            continue;
        }
        let n = foreground.len().min(16);
        let offsets: Vec<usize> = (0..n)
            .map(|i| foreground[(i * foreground.len()) / n])
            .map(|i| (i / t.width) * image.width + i % t.width)
            .collect();
        let rows = image.height - t.height + 1;
        // In banden, zodat een beeld vol treffers na 5000 kandidaten stopt
        // zonder eerst alle rijen af te lopen.
        let band = threads * 16;
        let mut y0 = 0;
        while y0 < rows {
            let y1 = (y0 + band).min(rows);
            let mut per_row: Vec<Vec<Match>> = vec![Vec::new(); y1 - y0];
            let chunk = (y1 - y0).div_ceil(threads).max(1);
            std::thread::scope(|s| {
                for (c, part) in per_row.chunks_mut(chunk).enumerate() {
                    let (integral, offsets, fg) = (&integral, &offsets, foreground.len());
                    s.spawn(move || {
                        for (i, out) in part.iter_mut().enumerate() {
                            scan_row(image, integral, t, fg, offsets, threshold, y0 + c * chunk + i, out);
                        }
                    });
                }
            });
            for row in per_row {
                for m in row {
                    found.push(m);
                    if found.len() >= MAX_FOUND {
                        truncated = true;
                        break 'variants;
                    }
                }
            }
            y0 = y1;
        }
    }
    let reduced = suppress_matches(&found, MAX_MATCHES + 1);
    let truncated = truncated || reduced.len() > MAX_MATCHES;
    Ok(Found { matches: reduced.into_iter().take(MAX_MATCHES).collect(), truncated })
}
