//! Radix-2 FFT en fasecorrelatie voor de automatische uitlijning: poort van
//! js/compare/fft.js, met dezelfde volgorde van bewerkingen.

use super::jsmath;
use std::collections::HashMap;

pub struct Twiddles {
    cos: Vec<f64>,
    sin: Vec<f64>,
}

/// Twiddle-tabellen per lengte (de JS-kant cachet ze per module).
#[derive(Default)]
pub struct FftCache {
    twiddles: HashMap<usize, Twiddles>,
}

impl FftCache {
    fn twiddles(&mut self, n: usize) -> &Twiddles {
        self.twiddles.entry(n).or_insert_with(|| {
            let half = n / 2;
            let mut cos = Vec::with_capacity(half);
            let mut sin = Vec::with_capacity(half);
            for i in 0..half {
                let a = (2.0 * std::f64::consts::PI * i as f64) / n as f64;
                cos.push(jsmath::cos(a));
                sin.push(jsmath::sin(a));
            }
            Twiddles { cos, sin }
        })
    }

    /// In-place complexe FFT van lengte n (macht van twee) op gestreepte data.
    #[allow(clippy::too_many_arguments)]
    pub fn fft1d(&mut self, re: &mut [f64], im: &mut [f64], off: usize, step: usize, n: usize, inverse: bool) {
        let mut j = 0usize;
        for i in 1..n {
            let mut bit = n >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if i < j {
                let a = off + i * step;
                let b = off + j * step;
                re.swap(a, b);
                im.swap(a, b);
            }
        }
        let t = self.twiddles(n);
        let sgn = if inverse { 1.0 } else { -1.0 };
        let mut len = 2;
        while len <= n {
            let half = len >> 1;
            let tstep = n / len;
            let mut i = 0;
            while i < n {
                for k in 0..half {
                    let wr = t.cos[k * tstep];
                    let wi = sgn * t.sin[k * tstep];
                    let a = off + (i + k) * step;
                    let b = off + (i + k + half) * step;
                    let xr = re[b] * wr - im[b] * wi;
                    let xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                }
                i += len;
            }
            len <<= 1;
        }
    }

    /// In-place 2D FFT van een n x n raster (rij voor rij).
    pub fn fft2d(&mut self, re: &mut [f64], im: &mut [f64], n: usize, inverse: bool) {
        for y in 0..n {
            self.fft1d(re, im, y * n, 1, n, inverse);
        }
        // Kolommen via een aaneengesloten kopie: dezelfde rekenstappen per
        // element als de gestreepte JS-versie (dus bitgelijk), maar zonder
        // cache-missers op elke stap.
        let mut cr = vec![0.0; n];
        let mut ci = vec![0.0; n];
        for x in 0..n {
            for y in 0..n {
                cr[y] = re[y * n + x];
                ci[y] = im[y * n + x];
            }
            self.fft1d(&mut cr, &mut ci, 0, 1, n, inverse);
            for y in 0..n {
                re[y * n + x] = cr[y];
                im[y * n + x] = ci[y];
            }
        }
        if inverse {
            let s = 1.0 / (n * n) as f64;
            for i in 0..n * n {
                re[i] *= s;
                im[i] *= s;
            }
        }
    }

    /// Voorwaarts spectrum van een reëel n x n raster.
    pub fn spectrum(&mut self, a: &[f64], n: usize) -> Spectrum {
        let mut re = a.to_vec();
        let mut im = vec![0.0; n * n];
        self.fft2d(&mut re, &mut im, n, false);
        Spectrum { re, im }
    }

    /// Fasecorrelatie: de verschuiving d waarvoor a(x) ≈ b(x − d), met
    /// subpixel-verfijning, en de piekhoogte.
    pub fn phase_correlate(&mut self, a: &[f64], b: &[f64], n: usize, max_shift: Option<f64>, a_spectrum: Option<&Spectrum>) -> Correlation {
        let nn = n * n;
        let own;
        let sa = match a_spectrum {
            Some(s) => s,
            None => {
                own = self.spectrum(a, n);
                &own
            }
        };
        let mut ar = sa.re.clone();
        let mut ai = sa.im.clone();
        let mut br = b.to_vec();
        let mut bi = vec![0.0; nn];
        self.fft2d(&mut br, &mut bi, n, false);
        for i in 0..nn {
            let r = ar[i] * br[i] + ai[i] * bi[i];
            let im = ai[i] * br[i] - ar[i] * bi[i];
            let mag = jsmath::hypot(r, im);
            if mag > 1e-12 {
                ar[i] = r / mag;
                ai[i] = im / mag;
            } else {
                ar[i] = 0.0;
                ai[i] = 0.0;
            }
        }
        self.fft2d(&mut ar, &mut ai, n, true);
        let max_shift = match max_shift {
            Some(m) if m.is_finite() => m,
            _ => n as f64 / 2.0,
        };
        let half = n as f64 / 2.0;
        let mut best = f64::NEG_INFINITY;
        let mut bx = 0usize;
        let mut by = 0usize;
        for y in 0..n {
            let sy = if (y as f64) < half { y as f64 } else { y as f64 - n as f64 };
            if sy.abs() > max_shift {
                continue;
            }
            for x in 0..n {
                let sx = if (x as f64) < half { x as f64 } else { x as f64 - n as f64 };
                if sx.abs() > max_shift {
                    continue;
                }
                let v = ar[y * n + x];
                if v > best {
                    best = v;
                    bx = x;
                    by = y;
                }
            }
        }
        let ni = n as isize;
        let at = |x: isize, y: isize| ar[(((y + ni) % ni) * ni + ((x + ni) % ni)) as usize];
        let sub = |m: f64, c: f64, p: f64| {
            let den = m - 2.0 * c + p;
            if den.abs() > 1e-12 {
                ((m - p) / (2.0 * den)).min(0.5).max(-0.5)
            } else {
                0.0
            }
        };
        let (bxi, byi) = (bx as isize, by as isize);
        let fx = sub(at(bxi - 1, byi), best, at(bxi + 1, byi));
        let fy = sub(at(bxi, byi - 1), best, at(bxi, byi + 1));
        let sx = (if (bx as f64) < half { bx as f64 } else { bx as f64 - n as f64 }) + fx;
        let sy = (if (by as f64) < half { by as f64 } else { by as f64 - n as f64 }) + fy;
        Correlation { dx: sx, dy: sy, peak: best }
    }
}

pub struct Spectrum {
    pub re: Vec<f64>,
    pub im: Vec<f64>,
}

#[derive(Debug, Clone, Copy)]
pub struct Correlation {
    pub dx: f64,
    pub dy: f64,
    pub peak: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_correlation_finds_an_integer_shift() {
        let n = 64;
        let mut a = vec![0.0; n * n];
        let mut b = vec![0.0; n * n];
        for (i, (x, y)) in [(10, 12), (30, 5), (40, 40), (22, 50)].iter().enumerate() {
            b[y * n + x] = 1.0 + i as f64;
            a[(y + 3) * n + (x + 5)] = 1.0 + i as f64;
        }
        let mut fft = FftCache::default();
        let r = fft.phase_correlate(&a, &b, n, None, None);
        assert!((r.dx - 5.0).abs() < 1e-9, "{:?}", r);
        assert!((r.dy - 3.0).abs() < 1e-9, "{:?}", r);
        assert!(r.peak > 0.99);
    }
}
