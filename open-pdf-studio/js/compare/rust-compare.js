// Pixel comparison in the PDFium worker (desktop) for Compare (#465).
//
// The desktop app renders both pages, builds the ink masks, aligns them and
// finds the change clusters in the PDFium worker process (Tauri command
// compare_pixel_pair, pdfium-worker/src/compare/), so no bitmap crosses IPC
// and the interface thread does no pixel work. The worker runs a line-by-line
// port of ink-mask.js, auto-align.js, fft.js and mask-detect.js; on the same
// masks it returns bit-identical results (pdfium-worker/src/compare/tests.rs).
// Its masks come from PDFium instead of pdf.js, so cluster edges can differ
// by about a pixel where anti-aliasing differs (docs/rust-stappen.md).
//
// The JS pipeline in compare-viewport.js stays: it is used in the browser
// build, on Android, for sides that only exist in memory (the version before
// the last save), when the worker is missing or older, and whenever the worker
// call fails (one warning, then JS). OPDS_RUST_COMPARE=0 in the environment of
// the app forces JS.

// Pure module apart from the dependencies handed to createRustCompare()
// (platform, byte cache), so it runs under node in rust-compare.test.mjs.

import { isCompareSource, compareSourceBytes, compareSourceInfo } from './compare-sources.js';

const TYPES = ['added', 'removed', 'modified'];
/** f64 values per cluster in the worker's answer (see compare/mod.rs). */
export const CLUSTER_FIELDS = 10;

const _absolute = (p) => typeof p === 'string' && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\'));

/**
 * The file on disk behind a compare path, with the byte length the app holds
 * for it (the worker refuses when the file on disk differs). null when the
 * side has no file of its own (an earlier version kept in memory).
 */
export function rustSideFile(path, deps = {}) {
  const { cachedBytes = () => null, isSource = isCompareSource, sourceBytes = compareSourceBytes, sourceInfo = compareSourceInfo } = deps;
  if (isSource(path)) {
    const info = sourceInfo(path);
    const bytes = sourceBytes(path);
    if (!info || info.kind !== 'file' || !_absolute(info.origin) || !bytes) return null;
    return { path: info.origin, expectLen: bytes.length };
  }
  if (!_absolute(path)) return null;
  const bytes = cachedBytes(path);
  return bytes ? { path, expectLen: bytes.length } : null;
}

/**
 * Request for compare_pixel_pair.
 * @param {{old:{path,expectLen}, new:{path,expectLen}, oldIndex:number, newIndex:number,
 *   oldSize:{width,height}, newSize:{width,height}, pxPerPt:number, params:object,
 *   alignment?:object, autoAlign?:boolean, measureRatio?:number|null, skipDetect?:boolean}} o
 */
export function buildRustRequest(o) {
  const side = (f, index, size) => ({
    path: f.path, page_index: index, width_pt: size.width, height_pt: size.height, expect_len: f.expectLen ?? null,
  });
  const p = o.params;
  const req = {
    old: side(o.old, o.oldIndex, o.oldSize),
    new: side(o.new, o.newIndex, o.newSize),
    px_per_pt: o.pxPerPt,
    threshold: p.threshold,
    params: { tolerance_px: p.tolerancePx, min_area_px: p.minAreaPx, merge_px: p.mergePx, noise_px: p.noisePx },
    skip_detect: !!o.skipDetect,
  };
  if (o.autoAlign) req.auto_align = { measure_ratio: o.measureRatio > 0 ? o.measureRatio : null };
  else if (o.alignment) req.alignment = o.alignment;
  return req;
}

/**
 * Decode the answer: u32 LE header length, JSON header, padding to 8, then
 * CLUSTER_FIELDS f64 per cluster (type, x, y, width, height, pixelCount,
 * old.x, old.y, old.width, old.height; mask pixels).
 * @returns {{head:object, clusters:Array}}
 */
export function decodeRustResponse(buffer) {
  const buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const len = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  const start = 4 + len + ((8 - ((4 + len) % 8)) % 8);
  const n = head.clusters || 0;
  const f = new Float64Array(buf.slice(start, start + n * CLUSTER_FIELDS * 8));
  const clusters = [];
  for (let i = 0; i < n; i++) {
    const o = i * CLUSTER_FIELDS;
    clusters.push({
      type: TYPES[f[o]] || 'modified', x: f[o + 1], y: f[o + 2], width: f[o + 3], height: f[o + 4], pixelCount: f[o + 5],
      old: { x: f[o + 6], y: f[o + 7], width: f[o + 8], height: f[o + 9] },
    });
  }
  return { head, clusters };
}

/**
 * The worker path with its state: after a failure that will not go away
 * (switched off, an app without the command) it stays off for the session;
 * a real failure is reported once on the console.
 * Android/iOS run in Tauri too, but have no PDFium worker: `mobile()` keeps
 * the path off there, like the PDFium render path (heeftRustRenderer).
 * @param {{inTauri:() => boolean, mobile?:() => boolean, call:(cmd:string, args:object) => Promise<ArrayBuffer>,
 *   cachedBytes:(path:string) => Uint8Array|null|undefined, warn?:(...a) => void}} deps
 */
export function createRustCompare(deps) {
  const { inTauri, call, cachedBytes } = deps;
  const mobile = deps.mobile || (() => false);
  // eslint-disable-next-line no-console
  const warn = deps.warn || ((...a) => console.warn(...a));
  let off = false;
  let warned = false;
  return {
    usable() {
      return !off && !!inTauri() && !mobile();
    },
    sideFile(path) {
      return rustSideFile(path, { cachedBytes });
    },
    /** Decoded answer, or null: the JS pipeline does it. */
    async run(request) {
      try {
        return decodeRustResponse(await call('compare_pixel_pair', { request }));
      } catch (err) {
        const msg = String((err && err.message) || err);
        // No pool yet (start-up) or no worker with `compare`: try again next
        // time (the answer is immediate), silently.
        if (/COMPARE_RUST_DISABLED|not found|unknown command|NIET_IN_BROWSER|not available in the browser/i.test(msg)) off = true;
        const quiet = /COMPARE_RUST_DISABLED|COMPARE_RUST_UNAVAILABLE: worker pool not ready|PDF_WORKER_UNAVAILABLE/.test(msg);
        if (!warned && !quiet) {
          warned = true;
          warn('[compare] pixel comparison in the PDFium worker failed, using the JS pipeline:', msg);
        }
        return null;
      }
    },
  };
}
