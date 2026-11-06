// Compare viewport orchestration.
// Loads each chosen PDF (re-using cached bytes when available), renders the
// requested page from each into an offscreen canvas at a target scale, and
// either lays them side-by-side or composes them into an overlay.
//
// Public API:
//   renderCompareSideBySide(canvasOld, canvasNew, opts)
//   renderCompareOverlay(canvasOut, opts)
//   getDocPageCount(filePath)
//
// Where opts = { oldPath, newPath, oldPage, newPage, scale, offset, preset,
//               method, autoAlign }
//
// Change detection (#465): each page is rasterised in tiles to an ink mask at
// a resolution derived from the paper size (detect-plan.js), the pair is
// aligned automatically when asked (auto-align.js, in a worker) and the masks
// are compared in a worker (mask-detect.js); vector pages can be compared on
// their paths instead (vector-diff.js). Change records are in page points of
// the new page, with `old` the matching rectangle on the old page.

import * as pdfjsLib from 'pdfjs-dist';
import { OPS } from 'pdfjs-dist';
import { getCachedPdfBytes } from '../pdf/loader.js';
import { drawHighlights } from './overlay-renderer.js';
import { createDetectClient, WORKER_UNAVAILABLE } from './change-detect-protocol.js';
import {
  setChanges, setCompareDetecting, applyAutoAlignment, cancelAutoAlignment, setCompareTruncated, setCompareMethodUsed,
} from './compare-store.js';
import { pdfjsBronnen } from '../core/basis-url.js';
import { state } from '../core/state.js';
import { compareSourceBytes } from './compare-sources.js';
import { planPair, planTiles, detectionParams, presetSettings, MM_PER_PT, PT_PER_MM } from './detect-plan.js';
import { pathSegments, classifyPage, vectorComparable } from './vector-diff.js';
import { createMask, writeInkTile, estimateBackground } from './ink-mask.js';
import { alignmentMatrix, multiply, scaling, normalizeAlignment, measureScaleRatio } from './alignment.js';
import { extractSheetNumber, pageTokens, pairPages, thumbFromDensity } from './page-pairing.js';

let _detectTimer = null;
let _detectSeq = 0;

// Detection (#465) runs in module workers so neither the union-find over the
// page nor the alignment search freezes the interface. One client per kind of
// work, each "latest wins". Without Worker (or when it fails to load) the
// clients compute synchronously with the same functions.
let _detectClient = null;
let _alignClient = null;

function _createDetectWorker() {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./change-detect.worker.js', import.meta.url), { type: 'module' });
}

function _getDetectClient() {
  if (!_detectClient) _detectClient = createDetectClient({ createWorker: _createDetectWorker });
  return _detectClient;
}

function _getAlignClient() {
  if (!_alignClient) _alignClient = createDetectClient({ createWorker: _createDetectWorker });
  return _alignClient;
}

/** A pair of fresh clients for a batch job (the change report). */
export function createBatchClients() {
  return {
    detect: createDetectClient({ createWorker: _createDetectWorker }),
    align: createDetectClient({ createWorker: _createDetectWorker }),
    dispose() { this.detect.dispose(); this.align.dispose(); },
  };
}

// Cache of pdfjs documents per filePath used by compare mode only — we don't
// reuse the document loaded by the main viewer because pdf.js transfers the
// underlying buffer; we always slice() bytes from originalBytesCache.
const _docCache = new Map();

// Ink masks per (path, page, resolution, threshold), LRU with a byte budget:
// an A0 mask at 0.2 mm/px is 25 MB, so a handful of sheets fit (#465).
const _maskCache = new Map();
const _MASK_CACHE_BYTES = 192 * 1024 * 1024;
let _maskCacheBytes = 0;
// Small previews per page: background colour and a thumbnail for pairing.
const _previewCache = new Map();
// Path segments and page kind per page, for the vector comparison.
const _vectorCache = new Map();

// Cache van kant-en-klare detectieresultaten per pagina-paar (LRU). Bladeren
// door een multi-page vergelijking her-diffde voorheen élk bezoek aan een paar
// volledig; met deze cache is terugkeren naar een al bekeken paar direct.
// Sleutel bevat het uitlijnings-offset (en de schaal waarin dat offset is
// uitgedrukt) omdat detectie daarvan afhangt; zonder offset is de schaal
// irrelevant (zoom-only renders slaan detectie sowieso over).
const _changesCache = new Map();
const _CHANGES_CACHE_MAX = 24;

// Detection depends on the pair, the sensitivity preset and the alignment
// (not on the zoom: change records are in page points).
const _r6 = (v) => Math.round((Number(v) || 0) * 1e6) / 1e6;
export function alignmentKey(offset) {
  const a = normalizeAlignment(offset);
  return `${_r6(a.dx)},${_r6(a.dy)},${_r6(a.rotation)},${_r6(a.scale)}`;
}

function _changesCacheKey(opts, offset = opts.offset) {
  const { oldPath, newPath, oldPage, newPage, preset = 'line', method = 'pixel' } = opts;
  return `${oldPath}|${oldPage}|${newPath}|${newPage}|${preset}|${method}|${alignmentKey(offset)}`;
}

function _maskCacheGet(key) {
  const v = _maskCache.get(key);
  if (!v) return null;
  _maskCache.delete(key);
  _maskCache.set(key, v);
  return v;
}
function _maskCacheSet(key, mask) {
  if (_maskCache.has(key)) {
    _maskCacheBytes -= _maskCache.get(key).data.byteLength;
    _maskCache.delete(key);
  }
  _maskCache.set(key, mask);
  _maskCacheBytes += mask.data.byteLength;
  while (_maskCacheBytes > _MASK_CACHE_BYTES && _maskCache.size > 2) {
    const first = _maskCache.keys().next().value;
    _maskCacheBytes -= _maskCache.get(first).data.byteLength;
    _maskCache.delete(first);
  }
}

async function _getDoc(filePath) {
  if (_docCache.has(filePath)) return _docCache.get(filePath);
  // An open tab, or a side picked from disk / an earlier version (#465).
  const bytes = getCachedPdfBytes(filePath) || compareSourceBytes(filePath);
  if (!bytes) throw new Error('Compare: no cached bytes for ' + filePath);
  const doc = await pdfjsLib.getDocument({
    data: bytes.slice(), // pdf.js transfers the buffer — must clone
    ...pdfjsBronnen(),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  _docCache.set(filePath, doc);
  return doc;
}

// Het compare-eigen pdf.js-document voor een pad — ook gebruikt door de
// tekstvergelijking (text-compare.js) zodat die geen tweede kopie laadt.
export function getCompareDoc(filePath) {
  return _getDoc(filePath);
}

export function clearCompareDocCache() {
  for (const d of _docCache.values()) {
    try { d.loadingTask.destroy(); } catch {}
  }
  _docCache.clear();
  _maskCache.clear();
  _maskCacheBytes = 0;
  _previewCache.clear();
  _vectorCache.clear();
  _changesCache.clear();
}

export async function getDocPageCount(filePath) {
  if (!filePath) return 0;
  try {
    const d = await _getDoc(filePath);
    return d.numPages;
  } catch {
    return 0;
  }
}

async function _renderPageToCanvas(filePath, pageNum, scale, targetCanvas, fillWhite = true) {
  const doc = await _getDoc(filePath);
  const page = await doc.getPage(Math.max(1, Math.min(doc.numPages, pageNum)));
  const viewport = page.getViewport({ scale });
  targetCanvas.width = Math.ceil(viewport.width);
  targetCanvas.height = Math.ceil(viewport.height);
  const ctx = targetCanvas.getContext('2d');
  if (fillWhite) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  }
  await page.render({ canvasContext: ctx, viewport, intent: 'display' }).promise;
  return { width: targetCanvas.width, height: targetCanvas.height, viewport };
}

export async function renderCompareSideBySide(canvasOld, canvasNew, opts) {
  const { oldPath, newPath, oldPage, newPage, scale = 1.5, skipDetection = false } = opts;
  await Promise.all([
    _renderPageToCanvas(oldPath, oldPage, scale, canvasOld),
    _renderPageToCanvas(newPath, newPage, scale, canvasNew),
  ]);
  // Change detection is mode-independent: bboxes live in a fixed detection-px
  // space regardless of whether the pages are shown overlaid or side-by-side.
  // Kick it off here too so side-by-side gets the same red/green/yellow diff
  // highlights and the change list. Skipped on zoom-only re-renders.
  if (!skipDetection) scheduleChangeDetection(opts);
  return { width: canvasNew.width, height: canvasNew.height };
}

/**
 * Render the compare overlay.
 *
 * The base canvas (canvasNew) shows the NEW page rendered NORMALLY — black ink
 * on white background, no tint. The differences between OLD and NEW are then
 * highlighted by translucent colored rectangles drawn on a separate overlay
 * canvas (canvasHighlights). The OLD canvas is kept hidden (still rasterized
 * for change detection only).
 *
 * Returns { width, height } of the rendered surface so the caller can size
 * its DOM containers.
 */
export async function renderCompareOverlay(canvasOld, canvasNew, opts, canvasHighlights = null) {
  const { newPath, newPage, scale = 1.5, skipDetection = false } = opts;

  // Render NEW normally — this is the visible base layer. The OLD page is
  // never drawn into a visible canvas in overlay mode (only rasterized for
  // change detection below). This avoids one full PDF.js render pass on
  // every zoom step, which was the dominant cost.
  await _renderPageToCanvas(newPath, newPage, scale, canvasNew);

  // Size the highlights canvas to match NEW; the actual rectangles are drawn
  // separately by paintHighlights() once changes are detected.
  if (canvasHighlights) {
    canvasHighlights.width = canvasNew.width;
    canvasHighlights.height = canvasNew.height;
    const ctx = canvasHighlights.getContext('2d');
    ctx.clearRect(0, 0, canvasHighlights.width, canvasHighlights.height);
  }

  // Kick off async, debounced change detection on a separately rasterized copy
  // of both pages. Visual rendering is not blocked. Skipped when the caller
  // knows only zoom (which doesn't affect detection results) has changed.
  if (!skipDetection) scheduleChangeDetection(opts);

  return { width: canvasNew.width, height: canvasNew.height };
}

/**
 * Paint diff highlights onto an overlay canvas. Pure presentation — the change
 * list itself is computed elsewhere (change-detector.js / scheduleChangeDetection).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array} changes
 * @param {Object} opts — { ratio, visibleTypes, selected }
 */
export function paintHighlights(canvas, changes, opts) {
  drawHighlights(canvas, changes, opts);
}

/**
 * Run the change detection for the pair in `opts` (debounced) and push the
 * result into the compare store. With `opts.autoAlign` the pair is first
 * aligned automatically; the alignment goes to the store and the changes are
 * cached under it, so the render that follows is a cache hit.
 */
export function scheduleChangeDetection(opts) {
  if (_detectTimer) {
    clearTimeout(_detectTimer);
    _detectTimer = null;
  }
  const seq = ++_detectSeq;
  const key = opts.autoAlign ? null : _changesCacheKey(opts);
  const cached = key ? _changesCache.get(key) : null;
  if (cached) {
    // LRU-bump en direct toepassen — geen debounce nodig voor een cache-hit,
    // zodat bladeren naar een al bekeken paar meteen de juiste lijst toont.
    _changesCache.delete(key);
    _changesCache.set(key, cached);
    setChanges(cached.changes);
    setCompareTruncated(cached.truncated);
    setCompareMethodUsed(cached.method);
    setCompareDetecting(false);
    return;
  }
  setCompareDetecting(true);
  _detectTimer = setTimeout(async () => {
    _detectTimer = null;
    try {
      let result;
      try {
        result = await computePairChanges(opts, { seq: () => seq === _detectSeq, detect: _getDetectClient(), align: _getAlignClient(), id: seq });
      } catch (err) {
        // De worker zelf faalde (laden, CSP, DataCloneError): opnieuw — de
        // client rekent nu synchroon.
        if (!err || err.code !== WORKER_UNAVAILABLE) throw err;
        result = await computePairChanges(opts, { seq: () => seq === _detectSeq, detect: _getDetectClient(), align: _getAlignClient(), id: seq });
      }
      // null = ingehaald voordat er gerekend werd.
      if (!result) return;
      const entry = { changes: result.changes, truncated: result.truncated, method: result.method };
      _changesCache.set(_changesCacheKey(opts, result.alignment), entry);
      while (_changesCache.size > _CHANGES_CACHE_MAX) {
        _changesCache.delete(_changesCache.keys().next().value);
      }
      if (opts.autoAlign) {
        if (result.alignInfo) applyAutoAlignment(opts.oldPage, opts.newPage, result.alignInfo);
        else cancelAutoAlignment(opts.oldPage, opts.newPage);
      }
      // Drop result if a newer detection has been queued.
      if (seq !== _detectSeq) return;
      setChanges(entry.changes);
      setCompareTruncated(entry.truncated);
      setCompareMethodUsed(entry.method);
      setCompareDetecting(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[compare] change detection failed', err);
      if (opts.autoAlign) cancelAutoAlignment(opts.oldPage, opts.newPage);
      if (seq === _detectSeq) {
        setChanges([]);
        setCompareDetecting(false);
      }
    }
  }, 200);
}

async function _getPage(filePath, pageNum) {
  const doc = await _getDoc(filePath);
  return doc.getPage(Math.max(1, Math.min(doc.numPages, pageNum)));
}

/** Page size in points (viewport at scale 1, page rotation applied). */
export async function getComparePageSize(filePath, pageNum) {
  const page = await _getPage(filePath, pageNum);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

const _yieldToUi = () => new Promise((r) => setTimeout(r, 0));

function _canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Small render of a page: its background colour (the page itself decides
 * what paper is) and a 16 x 16 ink thumbnail for page pairing.
 */
async function _preview(filePath, pageNum) {
  const key = `${filePath}|${pageNum}`;
  if (_previewCache.has(key)) return _previewCache.get(key);
  const promise = (async () => {
    const page = await _getPage(filePath, pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = 256 / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale });
    const c = _canvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'display' }).promise;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const bg = estimateBackground(img.data, c.width, c.height);
    const dens = new Float32Array(c.width * c.height);
    for (let i = 0, p = 0; i < dens.length; i++, p += 4) {
      const d = Math.abs(img.data[p] - bg.r) + Math.abs(img.data[p + 1] - bg.g) + Math.abs(img.data[p + 2] - bg.b);
      dens[i] = Math.min(1, d / 255);
    }
    c.width = 0;
    c.height = 0;
    return { bg, thumb: thumbFromDensity(dens, img.width, img.height, 16) };
  })();
  _previewCache.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    _previewCache.delete(key);
    throw err;
  }
}

/**
 * Ink mask of a page at pxPerPt, rendered in tiles so that only one tile of
 * RGBA pixels exists at a time (detect-plan.js bounds the tile size). The
 * UI thread renders (pdf.js needs it) and yields between tiles.
 */
export async function getCompareMask(filePath, pageNum, pxPerPt, threshold) {
  const key = `${filePath}|${pageNum}|${_r6(pxPerPt)}|${threshold}`;
  const cached = _maskCacheGet(key);
  if (cached) return cached;
  const [{ bg }, page] = await Promise.all([_preview(filePath, pageNum), _getPage(filePath, pageNum)]);
  const vp = page.getViewport({ scale: pxPerPt });
  const W = Math.max(1, Math.ceil(vp.width));
  const H = Math.max(1, Math.ceil(vp.height));
  const mask = createMask(W, H);
  const tiles = planTiles(W, H);
  const c = _canvas(tiles[0].w, tiles[0].h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  try {
    for (const t of tiles) {
      if (c.width !== t.w || c.height !== t.h) { c.width = t.w; c.height = t.h; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, t.w, t.h);
      await page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: [1, 0, 0, 1, -t.x, -t.y],
        intent: 'display',
      }).promise;
      const img = ctx.getImageData(0, 0, t.w, t.h);
      writeInkTile(mask, img.data, t.w, t.h, t.x, t.y, bg, threshold);
      await _yieldToUi();
    }
  } finally {
    c.width = 0;
    c.height = 0;
  }
  _maskCacheSet(key, mask);
  return mask;
}

/**
 * Path segments of a page (page points) and what kind of page it is
 * ('vector' | 'scan' | 'text'), from its pdf.js operator list.
 */
export async function getCompareVectorData(filePath, pageNum) {
  const key = `${filePath}|${pageNum}`;
  if (_vectorCache.has(key)) return _vectorCache.get(key);
  const promise = (async () => {
    const page = await _getPage(filePath, pageNum);
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const { segments, stats } = pathSegments(ops, OPS, vp.transform);
    return { segments, stats, kind: classifyPage(stats, vp.width * vp.height) };
  })();
  _vectorCache.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    _vectorCache.delete(key);
    throw err;
  }
}

// Measuring scales of a page, when the document is open in a tab: the PDF
// viewports (/VP + /Measure) of that page, else the document scale.
function _measureScales(filePath, pageNum) {
  const doc = (state.documents || []).find((d) => d && d.filePath === filePath);
  if (!doc) return null;
  const vps = doc.pdfViewports?.[pageNum];
  if (Array.isArray(vps) && vps.length) return vps;
  return doc.measureScale && doc.measureScale.pixelsPerUnit > 0 ? doc.measureScale : null;
}

// Old pages drawn at another scale than the new page are rendered at that
// scale (vector sharp lines) instead of resampling the mask; the factor is
// rounded so small changes keep using the cache.
const _quantScale = (s) => Math.exp(Math.round(Math.log(s) / 0.005) * 0.005);

/**
 * Changes for one page pair.
 * @param {{oldPath,newPath,oldPage,newPage,offset?,preset?,autoAlign?:boolean}} opts
 * @param {{detect, align, id?:number, seq?:() => boolean}} clients
 * @returns {Promise<null|{changes:Array, alignment:object, alignInfo:object|null, truncated:boolean, mmPerPx:number}>}
 *   null when the request was overtaken.
 */
export async function computePairChanges(opts, clients) {
  const { oldPath, newPath, oldPage, newPage } = opts;
  if (!oldPath || !newPath) return { changes: [], alignment: normalizeAlignment(opts.offset), alignInfo: null, truncated: false, mmPerPx: 0 };
  const current = clients.seq || (() => true);
  const [oldSize, newSize] = await Promise.all([
    getComparePageSize(oldPath, oldPage),
    getComparePageSize(newPath, newPage),
  ]);
  const plan = planPair(oldSize, newSize);
  const params = detectionParams(opts.preset || 'line', plan.mmPerPx);

  // Vector comparison (gap 8) where both pages are vector drawings; the pixel
  // comparison is the fallback.
  let vector = null;
  if (opts.method === 'vector') {
    try {
      const [ov, nv] = await Promise.all([getCompareVectorData(oldPath, oldPage), getCompareVectorData(newPath, newPage)]);
      if (vectorComparable(ov.kind, nv.kind)) vector = { ov, nv };
    } catch (_) { vector = null; }
    if (!current()) return null;
  }

  const masks = async () => Promise.all([
    getCompareMask(oldPath, oldPage, plan.pxPerPt, params.threshold),
    getCompareMask(newPath, newPage, plan.pxPerPt, params.threshold),
  ]);
  let oldMask = null;
  let newMask = null;
  if (!vector || opts.autoAlign) {
    [oldMask, newMask] = await masks();
    if (!current()) return null;
  }

  let alignment = normalizeAlignment(opts.offset);
  let alignInfo = null;
  if (opts.autoAlign) {
    const r = await clients.align.run(oldMask, newMask, {
      task: 'align',
      options: {
        pxPerPt: plan.pxPerPt,
        oldSize,
        newSize,
        measureRatio: measureScaleRatio(_measureScales(oldPath, oldPage), _measureScales(newPath, newPage)),
      },
    });
    if (!r.changes || !current()) return null;
    alignInfo = r.changes;
    alignment = normalizeAlignment(alignInfo.alignment);
  }

  if (vector) {
    const p = presetSettings(opts.preset || 'line');
    const r = await clients.detect.run({ segments: vector.ov.segments }, { segments: vector.nv.segments }, {
      id: clients.id,
      task: 'vector',
      options: {
        transform: alignmentMatrix(alignment, oldSize, newSize),
        tolPt: p.toleranceMm * PT_PER_MM,
        mergePt: p.mergeMm * PT_PER_MM,
        minLenPt: 0.2 * PT_PER_MM,
      },
    });
    if (!r.changes) return null;
    const changes = r.changes.clusters.map((c) => ({
      type: c.type, source: 'vector', x: c.x, y: c.y, width: c.width, height: c.height,
      lengthMm: c.lengthPt * MM_PER_PT, old: c.old,
    }));
    return { changes, alignment, alignInfo, truncated: false, mmPerPx: plan.mmPerPx, method: 'vector' };
  }

  // Scale correction: render the old page at the scale it is shown at.
  let oldDet = oldMask;
  let oldPx = plan.pxPerPt;
  if (Math.abs(alignment.scale - 1) > 0.02) {
    oldPx = plan.pxPerPt * _quantScale(alignment.scale);
    oldDet = await getCompareMask(oldPath, oldPage, oldPx, params.threshold);
    if (!current()) return null;
  }
  const transform = multiply(scaling(plan.pxPerPt), multiply(alignmentMatrix(alignment, oldSize, newSize), scaling(1 / oldPx)));
  const r = await clients.detect.run(oldDet, newMask, {
    id: clients.id,
    task: 'masks',
    options: { ...params, transform },
  });
  if (!r.changes) return null;
  const k = plan.pxPerPt;
  const changes = r.changes.clusters.map((c) => ({
    type: c.type,
    source: 'pixel',
    x: c.x / k,
    y: c.y / k,
    width: c.width / k,
    height: c.height / k,
    pixelCount: c.pixelCount,
    areaMm2: c.pixelCount * plan.mmPerPx * plan.mmPerPx,
    old: { x: c.old.x / oldPx, y: c.old.y / oldPx, width: c.old.width / oldPx, height: c.old.height / oldPx },
  }));
  return { changes, alignment, alignInfo, truncated: !!r.changes.truncated, mmPerPx: plan.mmPerPx, method: 'pixel' };
}

// ── Page pairing ──────────────────────────────────────────────────────────

async function _pageInfo(doc, filePath, p, labels) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  let items = [];
  try {
    const tc = await page.getTextContent();
    items = tc.items
      .filter((it) => it && typeof it.str === 'string' && it.str.trim())
      .map((it) => {
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const h = Math.abs(it.height || it.transform[3] || 8);
        return { str: it.str, x, y: y - h, w: it.width || 0, h };
      });
  } catch (_) { items = []; }
  const tokens = pageTokens(items);
  // Pages with hardly any text get a thumbnail fingerprint.
  let thumb = null;
  if (tokens.size < 8) {
    try { thumb = (await _preview(filePath, p)).thumb; } catch (_) { thumb = null; }
  }
  return {
    index: p,
    label: labels?.[p - 1] || null,
    sheet: extractSheetNumber(items, vp.width, vp.height),
    tokens,
    thumb,
  };
}

/** Collect what page pairing needs for every page of a document. */
export async function collectPairingInfo(filePath, isCurrent = () => true) {
  const doc = await _getDoc(filePath);
  let labels = null;
  try { labels = await doc.getPageLabels(); } catch (_) { labels = null; }
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    if (!isCurrent()) return null;
    out.push(await _pageInfo(doc, filePath, p, labels));
    if (p % 8 === 0) await _yieldToUi();
  }
  return out;
}

/** Pair the pages of two compare documents (page-pairing.js). */
export async function autoPairPages(oldPath, newPath, isCurrent = () => true) {
  const [o, n] = await Promise.all([collectPairingInfo(oldPath, isCurrent), collectPairingInfo(newPath, isCurrent)]);
  if (!o || !n) return null;
  return { pairs: pairPages(o, n), oldPages: o, newPages: n };
}

/** Sheet numbers and labels per page, for display (from collectPairingInfo). */
export function pageNames(infos) {
  const m = new Map();
  for (const p of infos || []) m.set(p.index, { sheet: p.sheet, label: p.label });
  return m;
}

/**
 * PNG crop of a page around a rectangle in points, for the report.
 * @returns {Promise<Uint8Array|null>}
 */
export async function renderCompareCrop(filePath, pageNum, rect, { maxPx = 360, marginMm = 6 } = {}) {
  const page = await _getPage(filePath, pageNum);
  const base = page.getViewport({ scale: 1 });
  const margin = marginMm / MM_PER_PT;
  const minSide = 25 / MM_PER_PT; // at least 25 mm of context
  let w = Math.max(rect.width + 2 * margin, minSide);
  let h = Math.max(rect.height + 2 * margin, minSide * 0.6);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  let x0 = Math.max(0, cx - w / 2);
  let y0 = Math.max(0, cy - h / 2);
  w = Math.min(w, base.width - x0);
  h = Math.min(h, base.height - y0);
  if (!(w > 0 && h > 0)) return null;
  const scale = Math.min(4, maxPx / Math.max(w, h));
  const vp = page.getViewport({ scale });
  const c = _canvas(Math.max(1, Math.ceil(w * scale)), Math.max(1, Math.ceil(h * scale)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale], intent: 'display' }).promise;
  // Outline the change itself.
  ctx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect((rect.x - x0) * scale - 1, (rect.y - y0) * scale - 1, rect.width * scale + 2, rect.height * scale + 2);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  c.width = 0;
  c.height = 0;
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
