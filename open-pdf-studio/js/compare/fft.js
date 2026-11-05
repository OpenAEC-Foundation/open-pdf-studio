// Small radix-2 FFT and phase correlation for automatic alignment (#465).
// Pure module, no dependencies.

const _twiddles = new Map();

function twiddles(n) {
  let t = _twiddles.get(n);
  if (!t) {
    t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) {
      t.cos[i] = Math.cos((2 * Math.PI * i) / n);
      t.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    _twiddles.set(n, t);
  }
  return t;
}

/**
 * In-place complex FFT of length n (power of two) on strided data.
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {number} off first element
 * @param {number} step distance between elements
 * @param {number} n
 * @param {boolean} inverse
 */
export function fft1d(re, im, off, step, n, inverse) {
  // Bit reversal.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * step;
      const b = off + j * step;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  const { cos, sin } = twiddles(n);
  const sgn = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const tstep = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * tstep];
        const wi = sgn * sin[k * tstep];
        const a = off + (i + k) * step;
        const b = off + (i + k + half) * step;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** In-place 2D FFT of an n x n grid (row-major). */
export function fft2d(re, im, n, inverse = false) {
  for (let y = 0; y < n; y++) fft1d(re, im, y * n, 1, n, inverse);
  for (let x = 0; x < n; x++) fft1d(re, im, x, n, n, inverse);
  if (inverse) {
    const s = 1 / (n * n);
    for (let i = 0; i < n * n; i++) { re[i] *= s; im[i] *= s; }
  }
}

export function nextPow2(v) {
  let n = 1;
  while (n < v) n <<= 1;
  return n;
}

/** Forward spectrum of an n x n real grid. */
export function spectrum(a, n) {
  const re = Float64Array.from(a);
  const im = new Float64Array(n * n);
  fft2d(re, im, n);
  return { re, im };
}

/**
 * Phase correlation of two n x n real grids. Returns the shift d for which
 * a(x) ≈ b(x − d), with sub-pixel refinement, and the peak height (1 for a
 * perfect match, lower for partial overlap).
 * @param {Float64Array|Float32Array} a
 * @param {Float64Array|Float32Array} b
 * @param {number} n
 * @param {{maxShift?:number, aSpectrum?:{re:Float64Array,im:Float64Array}}} [opts]
 *   maxShift: only search |d| <= maxShift
 */
export function phaseCorrelate(a, b, n, opts = {}) {
  const N = n * n;
  // opts.aSpectrum: the spectrum of `a` from spectrum(), reused across calls.
  const sa = opts.aSpectrum || spectrum(a, n);
  const ar = Float64Array.from(sa.re);
  const ai = Float64Array.from(sa.im);
  const br = Float64Array.from(b);
  const bi = new Float64Array(N);
  fft2d(br, bi, n);
  for (let i = 0; i < N; i++) {
    // a · conj(b)
    const r = ar[i] * br[i] + ai[i] * bi[i];
    const im = ai[i] * br[i] - ar[i] * bi[i];
    const mag = Math.hypot(r, im);
    if (mag > 1e-12) { ar[i] = r / mag; ai[i] = im / mag; } else { ar[i] = 0; ai[i] = 0; }
  }
  fft2d(ar, ai, n, true);
  const maxShift = Number.isFinite(opts.maxShift) ? opts.maxShift : n / 2;
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < n; y++) {
    const sy = y < n / 2 ? y : y - n;
    if (Math.abs(sy) > maxShift) continue;
    for (let x = 0; x < n; x++) {
      const sx = x < n / 2 ? x : x - n;
      if (Math.abs(sx) > maxShift) continue;
      const v = ar[y * n + x];
      if (v > best) { best = v; bx = x; by = y; }
    }
  }
  const at = (x, y) => ar[((y + n) % n) * n + ((x + n) % n)];
  const sub = (m, c, p) => {
    const den = m - 2 * c + p;
    return Math.abs(den) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * den))) : 0;
  };
  const fx = sub(at(bx - 1, by), best, at(bx + 1, by));
  const fy = sub(at(bx, by - 1), best, at(bx, by + 1));
  const sx = (bx < n / 2 ? bx : bx - n) + fx;
  const sy = (by < n / 2 ? by : by - n) + fy;
  return { dx: sx, dy: sy, peak: best };
}
