// Real-world sizing for parametric symbols ("dynamic block" behaviour).
//
// A template that declares `realSizeMm(params) -> { width, height }` gets its
// annotation bbox sized to the REAL dimensions, converted to page units via
// the measure scale at the anchor point (scale region > scale bar > document
// scale > 1 px/mm fallback). ONE engine for both entry points:
//   * placement (annotation-creators.js, parametricSymbol case)
//   * param changes from the properties panel (propertiesStore 'params' case)
// Never duplicate this conversion in tool code.

import { getTemplate } from './registry.js';
import { getMeasureScale } from '../annotations/measurement.js';
import { resizeTwoPointGeometry } from './two-point.js';

const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/** Page-pixels per real-world millimetre at a point (scale-region aware). */
export function pxPerMmAt(pageNum, x, y) {
  const ms = getMeasureScale(pageNum, x, y) || {};
  const mmPerUnit = UNIT_TO_MM[ms.unit || 'mm'] || 1;
  const ppu = ms.pixelsPerUnit > 0 ? ms.pixelsPerUnit : 1;
  return ppu / mmPerUnit;
}

/**
 * Resize a parametricSymbol annotation to its template's real-world size.
 * anchor: 'center' keeps the bbox centre fixed (param edits), 'topleft'
 * keeps x/y. Returns true when a resize was applied.
 */
export function applyTemplateRealSize(ann, anchor = 'center') {
  if (!ann || ann.type !== 'parametricSymbol') return false;
  const tpl = getTemplate(ann.symbolId);
  if (!tpl || typeof tpl.realSizeMm !== 'function') return false;
  const mm = tpl.realSizeMm(ann.params || {});
  // width may be null = FREE axis (line-form beam views: only the height is
  // profile-locked, the length stays whatever the user dragged it to).
  if (!mm || !(mm.height > 0)) return false;

  const cx = ann.x + (ann.width || 0) / 2;
  const cy = ann.y + (ann.height || 0) / 2;
  const k = pxPerMmAt(ann.page, cx, cy);
  const h = mm.height * k;
  let w;
  if (mm.width > 0) {
    w = mm.width * k;
  } else {
    // Free length: keep the current width; seed a workable beam length when
    // the bbox comes from a doorsnede or a bare click.
    w = ann.width && ann.width > h * 1.05 ? ann.width : h * 4;
  }
  if (tpl.placement === 'two-point') {
    return resizeTwoPointGeometry(ann, w, h);
  }
  if (anchor === 'center') {
    ann.x = cx - w / 2;
    ann.y = cy - h / 2;
  }
  ann.width = w;
  ann.height = h;
  return true;
}
