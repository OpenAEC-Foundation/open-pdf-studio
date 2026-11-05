// Vector comparison for pages drawn as vectors (#465, gap 8).
//
// A PDF from CAD carries its drawing as path operators. Comparing those
// paths is exact: it does not depend on the plot resolution or on line
// weights, where the pixel diff has to guess. This module:
//
//   - turns a pdf.js operator list into line segments in page points
//     (CTM, form XObjects and the viewport applied; curves flattened),
//     with statistics that tell a vector page from a scan or a text page,
//   - matches the segments of the old page (through the alignment) against
//     those of the new page within a tolerance; what has no partner is a
//     removed or added segment, and nearby ones are merged into changes.
//
// Text is not part of this comparison: text changes come from the text
// comparison (text-compare.js), which is exact for text as well.
//
// Known limit (why the pixel diff stays the default): an exporter that
// splits one line into two collinear pieces in the next revision makes both
// pieces "added". Pure module; runs in the detection worker. Unit tested in
// compare-vector.test.mjs.

import { applyPoint, multiply, invert } from './alignment.js';
import { mergeBoxes } from './mask-detect.js';

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };
const CURVE_STEPS = 4;

/**
 * Line segments and statistics from a pdf.js operator list.
 * @param {{fnArray:number[], argsArray:any[]}} opList
 * @param {Record<string,number>} OPS pdf.js OPS table
 * @param {number[]} viewportTransform viewport.transform of the page at scale 1
 * @returns {{segments:Float32Array, stats:{paths:number, segments:number, imageArea:number, glyphs:number}}}
 */
export function pathSegments(opList, OPS, viewportTransform) {
  const out = [];
  let ctm = viewportTransform.slice();
  const stack = [];
  const stats = { paths: 0, segments: 0, imageArea: 0, glyphs: 0 };
  const push = (x1, y1, x2, y2) => {
    const [a, b] = applyPoint(ctm, x1, y1);
    const [c, d] = applyPoint(ctm, x2, y2);
    if (a === c && b === d) return;
    out.push(a, b, c, d);
  };
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice());
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = multiply(ctm, Array.from(args[0]));
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      // Images are drawn into the unit square of the current CTM.
      stats.imageArea += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
    } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      const glyphs = Array.isArray(args?.[0]) ? args[0].filter((g) => g && typeof g === 'object').length : 0;
      stats.glyphs += glyphs;
    } else if (fn === OPS.constructPath) {
      // pdf.js >= 5: [paintOp, [pathData], minMax]
      const data = args?.[1]?.[0];
      if (!data || !data.length) continue;
      if (args[0] === OPS.endPath) continue; // clipping path only
      stats.paths++;
      let cx = 0, cy = 0, sx = 0, sy = 0;
      for (let k = 0; k < data.length;) {
        const op = data[k++];
        if (op === DRAW.moveTo) { cx = sx = data[k++]; cy = sy = data[k++]; }
        else if (op === DRAW.lineTo) { const x = data[k++], y = data[k++]; push(cx, cy, x, y); cx = x; cy = y; }
        else if (op === DRAW.curveTo) {
          const x1 = data[k++], y1 = data[k++], x2 = data[k++], y2 = data[k++], x3 = data[k++], y3 = data[k++];
          let px = cx, py = cy;
          for (let s = 1; s <= CURVE_STEPS; s++) {
            const t = s / CURVE_STEPS, u = 1 - t;
            const x = u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
            const y = u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
            push(px, py, x, y);
            px = x; py = y;
          }
          cx = x3; cy = y3;
        } else if (op === DRAW.quadraticCurveTo) {
          k += 2; // control point: the chord is close enough for matching
          const x2 = data[k++], y2 = data[k++];
          push(cx, cy, x2, y2);
          cx = x2; cy = y2;
        } else if (op === DRAW.closePath) { push(cx, cy, sx, sy); cx = sx; cy = sy; }
        else break;
      }
    }
  }
  stats.segments = out.length / 4;
  return { segments: Float32Array.from(out), stats };
}

/**
 * What kind of page is it?
 *   'vector' — drawn with paths, no image covering a large part
 *   'scan'   — mostly one or more images
 *   'text'   — mostly text, few paths
 */
export function classifyPage(stats, pageArea) {
  if (stats.imageArea > pageArea * 0.3) return 'scan';
  if (stats.segments >= 50 && stats.segments >= stats.glyphs * 0.5) return 'vector';
  if (stats.glyphs > 0) return 'text';
  return stats.segments > 0 ? 'vector' : 'text';
}

/** Is a vector comparison of this pair meaningful? */
export function vectorComparable(oldKind, newKind) {
  return oldKind === 'vector' && newKind === 'vector';
}

/**
 * Match segments within a tolerance.
 * @param {Float32Array} oldSegs x1,y1,x2,y2 per segment, old page points
 * @param {Float32Array} newSegs new page points
 * @param {{transform?:number[], tolPt?:number, mergePt?:number, minLenPt?:number}} [opts]
 *   transform: old page points -> new page points (alignment.js)
 * @returns {{clusters:Array<{type:string,x:number,y:number,width:number,height:number,lengthPt:number,old:object}>, matched:number, removed:number, added:number}}
 */
export function diffSegments(oldSegs, newSegs, opts = {}) {
  const tol = opts.tolPt > 0 ? opts.tolPt : 0.7;
  const merge = opts.mergePt >= 0 ? opts.mergePt : 4;
  const minLen = opts.minLenPt >= 0 ? opts.minLenPt : 0.5;
  const T = opts.transform || [1, 0, 0, 1, 0, 0];
  const nOld = oldSegs.length / 4;
  const nNew = newSegs.length / 4;
  const cell = Math.max(tol * 4, 2);
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;

  // Index of new segments by midpoint.
  const grid = new Map();
  for (let j = 0; j < nNew; j++) {
    const k = key((newSegs[j * 4] + newSegs[j * 4 + 2]) / 2, (newSegs[j * 4 + 1] + newSegs[j * 4 + 3]) / 2);
    const l = grid.get(k);
    if (l) l.push(j); else grid.set(k, [j]);
  }
  const usedNew = new Uint8Array(nNew);
  const oldT = new Float64Array(nOld * 4);
  const unmatchedOld = [];
  const t2 = tol * tol;
  const close = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by) <= t2;
  let matched = 0;
  for (let i = 0; i < nOld; i++) {
    const [x1, y1] = applyPoint(T, oldSegs[i * 4], oldSegs[i * 4 + 1]);
    const [x2, y2] = applyPoint(T, oldSegs[i * 4 + 2], oldSegs[i * 4 + 3]);
    oldT.set([x1, y1, x2, y2], i * 4);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const cx = Math.floor(mx / cell), cy = Math.floor(my / cell);
    let found = -1;
    for (let dy = -1; dy <= 1 && found < 0; dy++) {
      for (let dx = -1; dx <= 1 && found < 0; dx++) {
        const l = grid.get(`${cx + dx},${cy + dy}`);
        if (!l) continue;
        for (const j of l) {
          if (usedNew[j]) continue;
          const a = newSegs[j * 4], b = newSegs[j * 4 + 1], c = newSegs[j * 4 + 2], d = newSegs[j * 4 + 3];
          if ((close(x1, y1, a, b) && close(x2, y2, c, d)) || (close(x1, y1, c, d) && close(x2, y2, a, b))) { found = j; break; }
        }
      }
    }
    if (found >= 0) { usedNew[found] = 1; matched++; } else unmatchedOld.push(i);
  }

  // Boxes in units of 0.1 pt so the pixel merge works on integers.
  const U = 10;
  const boxes = [];
  const box = (x1, y1, x2, y2, flags, len) => {
    boxes.push({
      x1: Math.floor(Math.min(x1, x2) * U), y1: Math.floor(Math.min(y1, y2) * U),
      x2: Math.ceil(Math.max(x1, x2) * U), y2: Math.ceil(Math.max(y1, y2) * U),
      count: Math.max(1, Math.round(len * U)), flags,
    });
  };
  for (const i of unmatchedOld) {
    const s = oldT.subarray(i * 4, i * 4 + 4);
    box(s[0], s[1], s[2], s[3], 1, Math.hypot(s[2] - s[0], s[3] - s[1]));
  }
  let added = 0;
  for (let j = 0; j < nNew; j++) {
    if (usedNew[j]) continue;
    added++;
    const a = newSegs[j * 4], b = newSegs[j * 4 + 1], c = newSegs[j * 4 + 2], d = newSegs[j * 4 + 3];
    box(a, b, c, d, 2, Math.hypot(c - a, d - b));
  }
  const merged = mergeBoxes(boxes, Math.round(merge * U));
  const toOld = invert(T);
  const clusters = [];
  for (const m of merged) {
    if (m.count / U < minLen) continue;
    const type = (m.flags & 3) === 3 ? 'modified' : (m.flags & 1) ? 'removed' : 'added';
    // Thin lines get a minimal box so they stay visible and clickable.
    const pad = 0.5;
    const r = { x: m.x1 / U - pad, y: m.y1 / U - pad, width: (m.x2 - m.x1) / U + 2 * pad, height: (m.y2 - m.y1) / U + 2 * pad };
    const corners = [applyPoint(toOld, r.x, r.y), applyPoint(toOld, r.x + r.width, r.y + r.height),
      applyPoint(toOld, r.x + r.width, r.y), applyPoint(toOld, r.x, r.y + r.height)];
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    clusters.push({
      type, ...r, lengthPt: m.count / U,
      old: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
    });
  }
  clusters.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return { clusters, matched, removed: unmatchedOld.length, added };
}

/** Worker task: (old, new) are {segments} objects, options as diffSegments. */
export function vectorTask(oldData, newData, options) {
  return diffSegments(oldData.segments, newData.segments, options);
}
