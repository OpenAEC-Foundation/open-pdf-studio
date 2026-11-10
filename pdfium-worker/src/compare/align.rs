//! Automatische uitlijning van een vergelijkingspaar: poort van
//! js/compare/auto-align.js.
//!
//! Grof naar fijn: een grove zoektocht op een dichtheidsraster van ~192 px
//! (alle kandidaat-schalen en -rotaties, gescoord met fasecorrelatie), daarna
//! verfijning op ~768 en ~2048 px met een raster van patches, een robuuste
//! kleinste-kwadratenfit van een gelijkvormigheidstransformatie, en een
//! betrouwbaarheid (F-score van inkt-overlap). De identiteit blijft staan als
//! die even goed is.

use super::fft::{FftCache, Spectrum};
use super::ink::{downsample_density, Density, Mask};
use super::jsmath;
use super::matrix::{apply_point, invert, matrix_to_alignment, multiply, pixel_matrix, scaling, Alignment, Matrix, Size, IDENTITY_ALIGNMENT};
use serde::Serialize;
use std::collections::HashMap;

const COARSE_SIDE: f64 = 192.0;
const COARSE_N: usize = 256;
const LEVELS: [f64; 2] = [768.0, 2048.0];
const PATCH: usize = 64;
const PATCH_GRID: usize = 7;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct AlignResult {
    pub alignment: Alignment,
    pub confidence: f64,
    #[serde(rename = "identityConfidence")]
    pub identity_confidence: f64,
    pub method: &'static str,
}

pub struct AlignOptions {
    pub px_per_pt: f64,
    pub old_size: Size,
    pub new_size: Size,
    pub measure_ratio: Option<f64>,
    pub rotation_range: Option<f64>,
}

fn bilinear(d: &Density, x: f64, y: f64) -> f64 {
    let fx = x - 0.5;
    let fy = y - 0.5;
    let x0f = fx.floor();
    let y0f = fy.floor();
    let wf = d.width as f64;
    let hf = d.height as f64;
    if x0f < -1.0 || y0f < -1.0 || x0f >= wf || y0f >= hf {
        return 0.0;
    }
    // JS rekent met NaN door en komt dan op NaN uit.
    if x0f.is_nan() || y0f.is_nan() {
        return f64::NAN;
    }
    let tx = fx - x0f;
    let ty = fy - y0f;
    let x0 = x0f as i64;
    let y0 = y0f as i64;
    let w = d.width as i64;
    let h = d.height as i64;
    let data = &d.data;
    let in_x0 = x0 >= 0;
    let in_x1 = x0 + 1 < w;
    let in_y0 = y0 >= 0;
    let in_y1 = y0 + 1 < h;
    let r0 = y0 * w;
    let r1 = r0 + w;
    let at = |i: i64| data[i as usize] as f64;
    let v00 = if in_x0 && in_y0 { at(r0 + x0) } else { 0.0 };
    let v10 = if in_x1 && in_y0 { at(r0 + x0 + 1) } else { 0.0 };
    let v01 = if in_x0 && in_y1 { at(r1 + x0) } else { 0.0 };
    let v11 = if in_x1 && in_y1 { at(r1 + x0 + 1) } else { 0.0 };
    (v00 * (1.0 - tx) + v10 * tx) * (1.0 - ty) + (v01 * (1.0 - tx) + v11 * tx) * ty
}

/// De oude dichtheid in een n x n raster in coördinaten van het nieuwe niveau.
#[allow(clippy::too_many_arguments)]
fn warp_into(old_d: &Density, m: &Matrix, k: f64, n: usize, x0: f64, y0: f64, out: &mut [f64]) {
    let inv = invert(*m);
    for y in 0..n {
        for x in 0..n {
            let px = (x0 + x as f64 + 0.5) * k;
            let py = (y0 + y as f64 + 0.5) * k;
            let ox = inv[0] * px + inv[2] * py + inv[4];
            let oy = inv[1] * px + inv[3] * py + inv[5];
            out[y * n + x] = bilinear(old_d, ox / k, oy / k);
        }
    }
}

fn place_into(d: &Density, n: usize, x0: i64, y0: i64, out: &mut [f64]) {
    for y in 0..n {
        let sy = y0 + y as i64;
        if sy < 0 || sy >= d.height as i64 {
            continue;
        }
        for x in 0..n {
            let sx = x0 + x as i64;
            if sx < 0 || sx >= d.width as i64 {
                continue;
            }
            out[y * n + x] = d.data[sy as usize * d.width + sx as usize] as f64;
        }
    }
}

fn hann(n: usize) -> Vec<f64> {
    let mut w = vec![0.0; n * n];
    for y in 0..n {
        let wy = 0.5 - 0.5 * jsmath::cos((2.0 * std::f64::consts::PI * (y as f64 + 0.5)) / n as f64);
        for x in 0..n {
            w[y * n + x] = wy * (0.5 - 0.5 * jsmath::cos((2.0 * std::f64::consts::PI * (x as f64 + 0.5)) / n as f64));
        }
    }
    w
}

fn sum(a: &[f64]) -> f64 {
    let mut s = 0.0;
    for &v in a {
        s += v;
    }
    s
}

/// Onafhankelijke stappen (kandidaten, patches) over een paar threads, met
/// het resultaat in de oorspronkelijke volgorde: de keuze die erop volgt is
/// daardoor dezelfde als bij de sequentiële JS-lus.
fn par_map<T: Send>(n: usize, f: impl Fn(usize, &mut FftCache) -> T + Sync) -> Vec<T> {
    let threads = std::thread::available_parallelism().map(|v| v.get()).unwrap_or(1).clamp(1, 8).min(n);
    if threads <= 1 {
        let mut fft = FftCache::default();
        return (0..n).map(|i| f(i, &mut fft)).collect();
    }
    let chunk = n.div_ceil(threads);
    std::thread::scope(|s| {
        let f = &f;
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                s.spawn(move || {
                    let mut fft = FftCache::default();
                    (t * chunk..((t + 1) * chunk).min(n)).map(|i| f(i, &mut fft)).collect::<Vec<T>>()
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().expect("compare thread")).collect()
    })
}

fn dedupe(list: &[f64], rel: f64) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::new();
    for &v in list {
        if !(v > 0.0) || !v.is_finite() {
            continue;
        }
        if !out.iter().any(|&u| (u - v).abs() / v < rel) {
            out.push(v);
        }
    }
    out
}

#[derive(Clone, Copy)]
struct Pair {
    px: f64,
    py: f64,
    qx: f64,
    qy: f64,
    w: f64,
}

/// Gewogen kleinste kwadraten voor q = [a −b; b a]·p + t.
fn fit_similarity(pairs: &[Pair]) -> Option<Matrix> {
    if pairs.len() < 3 {
        return None;
    }
    let (mut sw, mut mpx, mut mpy, mut mqx, mut mqy) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for c in pairs {
        sw += c.w;
        mpx += c.w * c.px;
        mpy += c.w * c.py;
        mqx += c.w * c.qx;
        mqy += c.w * c.qy;
    }
    mpx /= sw;
    mpy /= sw;
    mqx /= sw;
    mqy /= sw;
    let (mut sxx, mut sab, mut sba) = (0.0, 0.0, 0.0);
    for c in pairs {
        let (px, py, qx, qy) = (c.px - mpx, c.py - mpy, c.qx - mqx, c.qy - mqy);
        sxx += c.w * (px * px + py * py);
        sab += c.w * (px * qx + py * qy);
        sba += c.w * (px * qy - py * qx);
    }
    if sxx < 1e-9 {
        return None;
    }
    let a = sab / sxx;
    let b = sba / sxx;
    let tx = mqx - (a * mpx - b * mpy);
    let ty = mqy - (b * mpx + a * mpy);
    Some([a, b, -b, a, tx, ty])
}

/// Dichtheidsrasters per (masker, factor), elk maar één keer berekend.
struct Densities<'a> {
    old: &'a Mask,
    new: &'a Mask,
    memo: HashMap<(bool, usize), Density>,
}

impl<'a> Densities<'a> {
    fn get(&mut self, is_new: bool, k: usize) -> &Density {
        let mask = if is_new { self.new } else { self.old };
        self.memo.entry((is_new, k)).or_insert_with(|| downsample_density(mask, k))
    }
    fn ensure(&mut self, k: usize) {
        self.get(true, k);
        self.get(false, k);
    }
    fn pair(&self, k: usize) -> (&Density, &Density) {
        (&self.memo[&(false, k)], &self.memo[&(true, k)])
    }
}

struct Refined {
    m: Matrix,
    k: usize,
}

fn refine_level(dens: &mut Densities, m: Matrix, target_side: f64, win: &[f64]) -> Refined {
    let max_dim = dens.new.width.max(dens.new.height) as f64;
    let k = ((max_dim / target_side).ceil() as usize).max(1);
    dens.ensure(k);
    let (old_d, new_d) = dens.pair(k);
    let kf = k as f64;
    let p = PATCH;
    let pf = p as f64;
    let inv = invert(m);
    let span_x = new_d.width.saturating_sub(p) as f64;
    let span_y = new_d.height.saturating_sub(p) as f64;
    let patch = |idx: usize, fft: &mut FftCache| -> Option<Pair> {
        let (gy, gx) = (idx / PATCH_GRID, idx % PATCH_GRID);
        let mut a = vec![0.0; p * p];
        let mut b = vec![0.0; p * p];
        let x0 = jsmath::round((span_x * (gx as f64 + 0.5)) / PATCH_GRID as f64);
        let y0 = jsmath::round((span_y * (gy as f64 + 0.5)) / PATCH_GRID as f64);
        place_into(new_d, p, x0 as i64, y0 as i64, &mut a);
        warp_into(old_d, &m, kf, p, x0, y0, &mut b);
        let sa = sum(&a);
        let sb = sum(&b);
        if sa < pf * pf * 0.004 || sb < pf * pf * 0.004 {
            return None;
        }
        for i in 0..p * p {
            a[i] *= win[i];
            b[i] *= win[i];
        }
        let r = fft.phase_correlate(&a, &b, p, Some(pf / 4.0), None);
        if !(r.peak > 0.06) {
            return None;
        }
        let cx = x0 + pf / 2.0;
        let cy = y0 + pf / 2.0;
        let (px, py) = apply_point(&inv, (cx - r.dx) * kf, (cy - r.dy) * kf);
        Some(Pair { px, py, qx: cx * kf, qy: cy * kf, w: r.peak })
    };
    let pairs: Vec<Pair> = par_map(PATCH_GRID * PATCH_GRID, patch).into_iter().flatten().collect();
    if pairs.is_empty() {
        return Refined { m, k };
    }
    let mut fit = fit_similarity(&pairs);
    if let Some(f) = fit {
        let res: Vec<f64> = pairs
            .iter()
            .map(|c| {
                let (x, y) = apply_point(&f, c.px, c.py);
                jsmath::hypot(x - c.qx, y - c.qy)
            })
            .collect();
        let mut sorted = res.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let med = sorted[sorted.len() / 2];
        let lim = (3.0 * med).max(1.5 * kf);
        let inliers: Vec<Pair> = pairs.iter().zip(res.iter()).filter(|(_, &r)| r <= lim).map(|(c, _)| *c).collect();
        if let Some(f2) = fit_similarity(&inliers) {
            fit = Some(f2);
        }
    }
    let fit = match fit {
        Some(f) => f,
        None => {
            // Alleen translatie: gewogen gemiddelde van de patchverschuivingen.
            let (mut sw, mut sx, mut sy) = (0.0, 0.0, 0.0);
            for c in &pairs {
                let (x, y) = apply_point(&m, c.px, c.py);
                sw += c.w;
                sx += c.w * (c.qx - x);
                sy += c.w * (c.qy - y);
            }
            let mut out = m;
            out[4] += sx / sw;
            out[5] += sy / sw;
            return Refined { m: out, k };
        }
    };
    // Onwaarschijnlijke sprongen weg van de grove schatting afwijzen.
    let s0 = jsmath::hypot(m[0], m[1]);
    let s1 = jsmath::hypot(fit[0], fit[1]);
    let r0 = jsmath::atan2(m[1], m[0]);
    let r1 = jsmath::atan2(fit[1], fit[0]);
    if (s1 / s0 - 1.0).abs() > 0.05 || (r1 - r0).abs() > (2.0 * std::f64::consts::PI) / 180.0 {
        return Refined { m, k };
    }
    Refined { m: fit, k }
}

/// overlapScore: F-score van inktcellen die binnen één cel inkt aan de
/// andere kant vinden, in beide richtingen.
fn overlap_score(dens: &mut Densities, m: Matrix, k: usize) -> f64 {
    dens.ensure(k);
    let (old_d, new_d) = dens.pair(k);
    let kf = k as f64;
    let has = |d: &Density, x: f64, y: f64| -> bool {
        if !x.is_finite() || !y.is_finite() {
            return false;
        }
        let xi = x.floor() as i64;
        let yi = y.floor() as i64;
        for yy in yi - 1..=yi + 1 {
            if yy < 0 || yy >= d.height as i64 {
                continue;
            }
            for xx in xi - 1..=xi + 1 {
                if xx < 0 || xx >= d.width as i64 {
                    continue;
                }
                if d.data[yy as usize * d.width + xx as usize] > 0.0 {
                    return true;
                }
            }
        }
        false
    };
    let ratio = |from: &Density, to: &Density, mm: &Matrix| -> f64 {
        let mut total = 0u64;
        let mut hit = 0u64;
        let step = ((((from.width * from.height) as f64) / 1_000_000.0).sqrt().floor() as usize).max(1);
        let mut y = 0;
        while y < from.height {
            let mut x = 0;
            while x < from.width {
                if from.data[y * from.width + x] > 0.0 {
                    total += 1;
                    let (tx, ty) = apply_point(mm, (x as f64 + 0.5) * kf, (y as f64 + 0.5) * kf);
                    if has(to, tx / kf, ty / kf) {
                        hit += 1;
                    }
                }
                x += step;
            }
            y += step;
        }
        if total > 0 {
            hit as f64 / total as f64
        } else {
            0.0
        }
    };
    let inv = invert(m);
    let recall = ratio(new_d, old_d, &inv);
    let precision = ratio(old_d, new_d, &m);
    if precision + recall > 0.0 {
        (2.0 * precision * recall) / (precision + recall)
    } else {
        0.0
    }
}

#[derive(Clone, Copy)]
struct Candidate {
    m: Matrix,
    peak: f64,
    scale: f64,
    rotation: f64,
}

/// estimateAlignment
pub fn estimate_alignment(old: &Mask, new: &Mask, opts: &AlignOptions) -> AlignResult {
    let (px_per_pt, old_size, new_size) = (opts.px_per_pt, opts.old_size, opts.new_size);
    let rot_range = match opts.rotation_range {
        Some(r) if r.is_finite() => r,
        _ => 3.0,
    };
    let measure = opts.measure_ratio.filter(|v| !v.is_nan()).unwrap_or(0.0);
    let swapped = (old_size.width > old_size.height) != (new_size.width > new_size.height)
        && (old_size.width - old_size.height).abs() > 1.0
        && (new_size.width - new_size.height).abs() > 1.0;
    let ow = if swapped { old_size.height } else { old_size.width };
    let oh = if swapped { old_size.width } else { old_size.height };
    let scales = dedupe(
        &[1.0, new_size.width / ow, new_size.height / oh, ((new_size.width * new_size.height) / (ow * oh)).sqrt(), measure],
        0.01,
    );
    let bases: [f64; 2] = if swapped { [90.0, -90.0] } else { [0.0, 180.0] };

    let max_dim = new.width.max(new.height).max(old.width).max(old.height) as f64;
    let kc = ((max_dim / COARSE_SIDE).ceil() as usize).max(1);
    let kcf = kc as f64;
    let mut dens = Densities { old, new, memo: HashMap::new() };
    let mut fft = FftCache::default();
    dens.ensure(kc);
    let n = COARSE_N;
    let mut a = vec![0.0; n * n];
    {
        let (_, new_c) = dens.pair(kc);
        place_into(new_c, n, 0, 0, &mut a);
    }
    let a_spectrum: Spectrum = fft.spectrum(&a, n);

    let old_c = dens.pair(kc).0;
    let evaluate = |fft: &mut FftCache, scale: f64, rotation: f64| -> Option<Candidate> {
        let m = pixel_matrix(Alignment { dx: 0.0, dy: 0.0, rotation, scale }, old_size, new_size, px_per_pt);
        let mut b = vec![0.0; n * n];
        warp_into(old_c, &m, kcf, n, 0.0, 0.0, &mut b);
        if sum(&b) <= 0.0 {
            return None;
        }
        let r = fft.phase_correlate(&a, &b, n, Some(n as f64 / 4.0), Some(&a_spectrum));
        let mut out = m;
        out[4] += r.dx * kcf;
        out[5] += r.dy * kcf;
        Some(Candidate { m: out, peak: r.peak, scale, rotation })
    };
    // Alle kandidaten van één basisrotatie tegelijk, daarna in volgorde kiezen.
    let search = |base: f64, fine: &[f64]| -> Vec<Option<Candidate>> {
        let list: Vec<(f64, f64)> = scales.iter().flat_map(|&s| fine.iter().map(move |&fr| (s, base + fr))).collect();
        par_map(list.len(), |i, fft| evaluate(fft, list[i].0, list[i].1))
    };

    let mut best: Option<Candidate> = None;
    let consider = |best: &mut Option<Candidate>, c: Option<Candidate>| {
        if let Some(c) = c {
            if best.map_or(true, |b| c.peak > b.peak) {
                *best = Some(c);
            }
        }
    };
    let mut fine = Vec::new();
    let mut r = -rot_range;
    while r <= rot_range + 1e-9 {
        fine.push(jsmath::round(r * 10.0) / 10.0);
        r += 0.5;
    }
    for c in search(bases[0], &fine) {
        consider(&mut best, c);
    }
    if best.map_or(true, |b| b.peak < 0.12) {
        for c in search(bases[1], &fine) {
            consider(&mut best, c);
        }
    }
    if best.is_none() {
        return AlignResult { alignment: IDENTITY_ALIGNMENT, confidence: 0.0, identity_confidence: 0.0, method: "identity" };
    }
    // Lokale schaal- en rotatiepolijst op het grove niveau (leest steeds de
    // actuele beste, net als de JS-lus).
    for mf in [0.985, 0.993, 1.007, 1.015] {
        let cur = best.unwrap();
        let c = evaluate(&mut fft, cur.scale * mf, cur.rotation);
        consider(&mut best, c);
    }
    for d in [-0.25, 0.25] {
        let cur = best.unwrap();
        let c = evaluate(&mut fft, cur.scale, cur.rotation + d);
        consider(&mut best, c);
    }
    let best = best.unwrap();

    let win = hann(PATCH);
    let mut m = best.m;
    let mut k = kc;
    for side in LEVELS {
        let res = refine_level(&mut dens, m, side, &win);
        m = res.m;
        k = res.k;
    }
    m = refine_level(&mut dens, m, LEVELS[LEVELS.len() - 1], &win).m;

    let identity_m = pixel_matrix(IDENTITY_ALIGNMENT, old_size, new_size, px_per_pt);
    let confidence = overlap_score(&mut dens, m, k);
    let identity_confidence = overlap_score(&mut dens, identity_m, k);
    if measure > 0.0 && confidence < 0.5 {
        let measured = Alignment { dx: 0.0, dy: 0.0, rotation: bases[0], scale: measure };
        let mc = overlap_score(&mut dens, pixel_matrix(measured, old_size, new_size, px_per_pt), k);
        if mc > confidence && mc > identity_confidence {
            return AlignResult { alignment: measured, confidence: mc, identity_confidence, method: "measure" };
        }
    }
    if identity_confidence >= confidence - 0.005 {
        return AlignResult { alignment: IDENTITY_ALIGNMENT, confidence: identity_confidence, identity_confidence, method: "identity" };
    }
    let mpt = multiply(scaling(1.0 / px_per_pt), multiply(m, scaling(px_per_pt)));
    let alignment = matrix_to_alignment(mpt, old_size, new_size);
    let from_measure = measure != 0.0 && (best.scale / measure - 1.0).abs() < 0.004;
    AlignResult { alignment, confidence, identity_confidence, method: if from_measure { "measure" } else { "phase" } }
}
