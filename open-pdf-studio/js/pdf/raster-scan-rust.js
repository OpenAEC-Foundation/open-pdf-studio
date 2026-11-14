// Pixel work on a bounded page raster in Rust (desktop): symbol search
// (js/search/symbol-matcher.js) and form recognition
// (js/pdf/form-recognition.js). The Rust code is a line-by-line port of those
// modules (crate open-pdf-scan); on the same raster it returns identical
// results, floats included (open-pdf-scan/src/tests.rs).
//
// Two ways in, see docs/rust-stappen.md:
// - match(): the app renders the page with pdf.js as before and hands the
//   binary raster to the Tauri command symbol_match_raster. Same raster, so
//   the same matches as the JS matcher, without its pauses and off the
//   interface thread. This is what symbol search uses.
// - form() and symbol(): the PDFium worker renders the page itself at the
//   same size (command raster_scan_page, pdfium-worker/src/raster_scan/), so
//   the pdf.js render and getImageData disappear too. Its raster differs from
//   that of pdf.js by about a pixel along edges; form recognition finds the
//   same fields on it. For symbol search that pixel moves matches across the
//   threshold, so that route is only used when asked for.
//
// The JS path stays: browser build, Android/iOS, a document whose bytes differ
// from the file on disk (worker routes), a missing or older backend, and any
// failure (one warning, then JS). An error the JS functions give themselves
// (TEMPLATE_BOUNDS, ...) is passed on. OPDS_RUST_SCAN=0 in the environment of
// the app forces JS.

// Pure module apart from the dependencies handed to createRasterScan(), so it
// runs under node in raster-scan-rust.test.mjs.

/** Errors the JS functions throw themselves; the worker's are the same codes. */
export const SCAN_CODES = ['INVALID_IMAGE', 'TEMPLATE_BOUNDS', 'TEMPLATE_NEEDS_CONTRAST', 'INVALID_TOLERANCE', 'INVALID_RASTER'];

const FORM_TYPES = ['text', 'checkbox', 'radio'];

const _absolute = (p) => typeof p === 'string' && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\'));

/**
 * The file on disk behind a document, with the byte length the app holds for
 * it (the worker refuses when the file on disk differs), or null.
 */
export function rasterFile(path, cachedBytes = () => null) {
  if (!_absolute(path)) return null;
  const bytes = cachedBytes(path);
  return bytes ? { path, expectLen: bytes.length } : null;
}

/** Answer of `symbol_scan`: matches as [x, y, width, height, score, rotation, scale]. */
export function decodeSymbolAnswer(resp) {
  return {
    template: resp.template,
    matches: (resp.matches || []).map(([x, y, width, height, score, rotation, scale]) => ({ x, y, width, height, score, rotation, scale })),
    truncated: !!resp.truncated,
  };
}

/** Answer of `form_shapes`: shapes as [x, y, width, height, type, confidence, outline]. */
export function decodeFormAnswer(resp) {
  return (resp.shapes || []).map(([x, y, width, height, type, confidence, outline]) => ({
    x, y, width, height, type: FORM_TYPES[type] || 'text', confidence, source: outline ? 'empty-outline' : 'writing-line',
  }));
}

/** Answer of `symbol_match_raster`: matches in the same row form. */
export function decodeMatchAnswer(resp) {
  const { matches, truncated } = decodeSymbolAnswer(resp);
  return { matches, truncated };
}

/**
 * Body and header for `symbol_match_raster`: the template pixels followed by
 * the image pixels (one byte each), sizes and tolerances in the header.
 */
export function encodeSymbolMatch(image, template, { threshold = 0.75, rotations = [0], scales = [1] } = {}) {
  const body = new Uint8Array(template.pixels.length + image.pixels.length);
  body.set(template.pixels, 0);
  body.set(image.pixels, template.pixels.length);
  return {
    body,
    header: JSON.stringify({
      width: image.width, height: image.height, templateWidth: template.width, templateHeight: template.height, threshold, rotations, scales,
    }),
  };
}

/** What matchSymbols() checks before it computes; kept in JS so a bad
 * tolerance gives the same error whether or not Rust is there. */
function tolerancesOk({ threshold = 0.75, rotations = [0], scales = [1] }) {
  return Number.isFinite(threshold) && threshold >= 0.5 && threshold <= 1
    && Array.isArray(rotations) && rotations.length > 0 && rotations.length <= 4 && rotations.every((r) => typeof r === 'number')
    && Array.isArray(scales) && scales.length > 0 && scales.length <= 3 && scales.every((s) => typeof s === 'number' && Number.isFinite(s));
}

/**
 * The Rust path with its state: after a failure that will not go away
 * (switched off, an app without the command) it stays off for the session; a
 * real failure is reported once on the console.
 * Android/iOS run in Tauri too, but have no PDFium worker: `mobile()` keeps
 * the path off there.
 * @param {{inTauri:() => boolean, mobile?:() => boolean, call:(cmd:string, args:object) => Promise<object>,
 *   cachedBytes:(path:string) => Uint8Array|null|undefined, warn?:(...a) => void}} deps
 */
export function createRasterScan(deps) {
  const { inTauri, call, cachedBytes } = deps;
  const mobile = deps.mobile || (() => false);
  // eslint-disable-next-line no-console
  const warn = deps.warn || ((...a) => console.warn(...a));
  let off = false;
  let warned = false;
  /** Decoded answer; null = the JS path does it; throws a SCAN_CODES error. */
  async function run(op, request, decode) {
    return guarded(() => call('raster_scan_page', { op, request }), decode);
  }
  async function guarded(invoke, decode) {
    try {
      return decode(await invoke());
    } catch (err) {
      const msg = String((err && err.message) || err);
      const code = SCAN_CODES.find((c) => msg === `SCAN_RUST_FAILED: ${c}`);
      if (code) throw new Error(code);
      if (/SCAN_RUST_DISABLED|not found|unknown command|NIET_IN_BROWSER|not available in the browser/i.test(msg)) off = true;
      // No pool yet (start-up), no worker with `raster_scan`, or a file that
      // changed on disk: try again next time, silently.
      const quiet = /SCAN_RUST_DISABLED|SCAN_RUST_UNAVAILABLE: worker pool not ready|PDF_WORKER_UNAVAILABLE|PDF_SCAN_STALE/.test(msg);
      if (!warned && !quiet) {
        warned = true;
        warn('[scan] page raster work in Rust failed, using the JS path:', msg);
      }
      return null;
    }
  }
  return {
    usable() {
      return !off && !!inTauri() && !mobile();
    },
    file(path) {
      return rasterFile(path, cachedBytes);
    },
    /**
     * matchSymbols() in Rust on the raster the app made: `{ matches,
     * truncated }` as the JS matcher returns them, or null (use the JS
     * matcher). Tolerances the header cannot carry go to JS, which rejects
     * them with its own error.
     */
    match(image, template, tolerances = {}) {
      if (!tolerancesOk(tolerances)) return Promise.resolve(null);
      const { body, header } = encodeSymbolMatch(image, template, tolerances);
      return guarded(() => call('symbol_match_raster', body, { headers: { 'x-opds-symbol': header } }), decodeMatchAnswer);
    },
    symbol(request) {
      return run('symbol_scan', request, decodeSymbolAnswer);
    },
    form(request) {
      return run('form_shapes', request, decodeFormAnswer);
    },
  };
}

/**
 * A symbol search over pages in the worker: the template page first (cut the
 * template, and search there when it is one of the pages), then the other
 * pages with the template the worker returned.
 * @param {{symbol:(request:object) => Promise<object|null>}} scan
 * @param {{rasterFor:(page:number) => Promise<object>, templatePage:number, crop:number[], pages:number[],
 *   threshold:number, rotations:number[], scales:number[], signal?:AbortSignal, onPage?:(page:number) => void}} o
 * @returns {Promise<Map<number, {matches:Array, truncated:boolean}>|null>} per
 *   page in the order asked, or null: run the whole search in JS.
 */
export async function searchSymbolsInWorker(scan, o) {
  const pages = [...new Set(o.pages)];
  const tolerances = { threshold: o.threshold, rotations: o.rotations, scales: o.scales };
  const stop = () => {
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  stop();
  const first = await scan.symbol({
    raster: await o.rasterFor(o.templatePage), crop: o.crop, search: pages.includes(o.templatePage), ...tolerances,
  });
  if (!first) return null;
  const found = new Map();
  for (const page of pages) {
    let answer = first;
    if (page !== o.templatePage) {
      stop();
      answer = await scan.symbol({ raster: await o.rasterFor(page), template: first.template, search: true, ...tolerances });
      if (!answer) return null;
    }
    found.set(page, { matches: answer.matches, truncated: answer.truncated });
    o.onPage?.(page);
    stop();
  }
  return found;
}
