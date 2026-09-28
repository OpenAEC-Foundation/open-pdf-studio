/**
 * Scale Region — rectangular calibration viewport that overrides the
 * document-global scale for any annotation whose centroid falls inside.
 *
 * A scaleRegion stores:
 *   - scaleString: human-readable "1:100"
 *   - units: 'mm' | 'cm' | 'm' | 'in' | 'ft'
 *   - label: optional user label
 *
 * Resolution priority (handled inside getMeasureScale):
 *   1. innermost (smallest area) scaleRegion containing the point
 *   2. existing scaleBar / viewport / doc.measureScale fallbacks
 */
import { getActiveDocument } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { schaalgebiedenOpPagina } from './schaal-op-punt.js';
import { schaalBronnenInDoorloop, vergeetSchaalBronnen } from './schaal-bronnen.js';

// Parse "1:100" → 100 (the denominator of the drawing-to-world ratio)
export function parseScaleString(s) {
  if (!s) return null;
  const m = String(s).match(/1\s*[:/]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const denom = parseFloat(m[1]);
  if (!denom || denom <= 0) return null;
  return denom;
}

// Compute pixelsPerUnit for a scale region given its scaleString + units.
// PDF user units = 1/72 inch. We keep this consistent with the viewport tool:
//   1 mm at 1:N maps to (72 / 25.4) / N pixels.
//   1 cm = 10mm; 1 m = 1000mm; 1 in = 25.4mm; 1 ft = 304.8mm.
export function pixelsPerUnitFor(scaleString, units) {
  const denom = parseScaleString(scaleString);
  if (!denom) return 1;
  const ppmm = (72 / 25.4) / denom;
  switch (units) {
    case 'mm': return ppmm;
    case 'cm': return ppmm * 10;
    case 'm':  return ppmm * 1000;
    case 'in': return ppmm * 25.4;
    case 'ft': return ppmm * 304.8;
    default:   return ppmm;
  }
}

// Per-redraw cache keyed by document instance.
// Map<doc, Map<pageNum, scaleRegion[] sorted by area asc>>
let _cache = new WeakMap();
let _cacheGen = 0;

// Bump on every annotation change (call from rendering before pass).
// Also drops the scale sources of a running pass (schaal-bronnen.js), so a
// change made in the middle of a pass is seen by the next lookup.
export function invalidateScaleRegionCache() {
  _cacheGen++;
  _cache = new WeakMap();
  vergeetSchaalBronnen();
}

function _getRegionsForPage(doc, pageNum) {
  // Inside a pass (metSchaalBronnen) the regions come from the sources that
  // pass collected once: fresh for that pass, so never stale.
  const bronnen = schaalBronnenInDoorloop(doc);
  if (bronnen) return schaalgebiedenOpPagina(bronnen, pageNum);
  let docCache = _cache.get(doc);
  if (!docCache) {
    docCache = new Map();
    _cache.set(doc, docCache);
  }
  let arr = docCache.get(pageNum);
  if (!arr) {
    arr = (doc.annotations || []).filter(
      a => a.type === 'scaleRegion' && a.page === pageNum
    );
    // Smallest area first → innermost wins
    arr.sort((a, b) => (a.width * a.height) - (b.width * b.height));
    docCache.set(pageNum, arr);
  }
  return arr;
}

/**
 * Find the innermost scaleRegion containing point (x, y) on a given page.
 * Returns null if none found.
 */
export function getScaleRegionAt(pageNum, x, y) {
  const doc = getActiveDocument();
  if (!doc || pageNum == null || x == null || y == null) return null;
  const regions = _getRegionsForPage(doc, pageNum);
  for (const r of regions) {
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
      return r;
    }
  }
  return null;
}

/**
 * Resolve the effective scale at (pageNum, x, y) from scale regions.
 * Returns { pixelsPerUnit, unit, source: 'scaleRegion', regionId } or null.
 */
export function getScaleFromRegion(pageNum, x, y) {
  const r = getScaleRegionAt(pageNum, x, y);
  if (!r) return null;
  const ppu = pixelsPerUnitFor(r.scaleString || '1:100', r.units || 'mm');
  return {
    pixelsPerUnit: ppu,
    unit: r.units || 'mm',
    source: 'scaleRegion',
    regionId: r.id,
    method: 'scaleRegion',
  };
}

// Visual-density factor for pattern-like rendering (hatch spacing) at a
// point. Inside a scale region the hatch must scale WITH the region so the
// same material pattern keeps the same real-world density across regions of
// different scales. Baseline = 1:100 (the common drawing scale): a 1:50
// region returns 2.0, a 1:200 region 0.5, outside any region 1.0.
const _PPU_1_100 = 72 / (25.4 * 100);
export function getRegionScaleFactor(pageNum, x, y) {
  if (pageNum == null || x == null || y == null) return 1;
  const region = getScaleFromRegion(pageNum, x, y);
  if (!region || !region.pixelsPerUnit) return 1;
  return region.pixelsPerUnit / _PPU_1_100;
}

/**
 * Create a full-page scaleRegion on the active document's current page,
 * push it, invalidate cache and return it. Caller is responsible for
 * triggering recordAdd, redraw and (optionally) opening the calibration dialog.
 * Returns null if no active document or page dimensions cannot be resolved.
 */
export function createFullPageScaleRegion(opts = {}) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const pageNum = opts.page || doc.currentPage || 1;
  const dims = doc.pageDims && doc.pageDims[pageNum];
  if (!dims || !dims.widthPt || !dims.heightPt) return null;
  const ann = createScaleRegion({
    page: pageNum,
    x: 0,
    y: 0,
    width: dims.widthPt,
    height: dims.heightPt,
    scaleString: opts.scaleString || '1:100',
    units: opts.units || 'mm',
    label: opts.label || '',
  });
  doc.annotations.push(ann);
  return ann;
}

/**
 * Factory for scaleRegion annotations.
 */
export function createScaleRegion(props) {
  const scaleString = props.scaleString || '1:100';
  const units = props.units || 'mm';
  return createAnnotation({
    type: 'scaleRegion',
    page: props.page,
    x: props.x,
    y: props.y,
    width: props.width,
    height: props.height,
    scaleString,
    units,
    label: props.label || '',
    color: props.color || '#ff9800',
    lineWidth: 1.5,
    borderStyle: 'dashed',
    opacity: 1,
  });
}
