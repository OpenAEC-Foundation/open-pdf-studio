// Compare alignment (#465): the alignment transform (shared by detection,
// split line and the old-page highlights), the measuring-scale fallback and
// the automatic alignment on synthetic plots: a plot shift with a small
// rotation, and the same drawing plotted to A1 and to A3.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignmentMatrix, matrixToAlignment, pixelMatrix, alignmentCss, invert, applyPoint, applyRect,
  measureScaleRatio, normalizeAlignment, isIdentityAlignment, IDENTITY_ALIGNMENT,
} from './alignment.js';
import { estimateAlignment } from './auto-align.js';
import { phaseCorrelate } from './fft.js';
import { planPair, detectionParams, PT_PER_MM } from './detect-plan.js';
import { detectMaskChanges } from './mask-detect.js';
import { SHEETS_MM, drawingFor, rasterize, plotMap, sheetPt } from './synthetic-sheets.mjs';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('identity maps page centre to page centre, also between paper sizes', () => {
  const a1 = sheetPt(SHEETS_MM.A1);
  const a3 = sheetPt(SHEETS_MM.A3);
  const m = alignmentMatrix(IDENTITY_ALIGNMENT, a1, a3);
  const [x, y] = applyPoint(m, a1.width / 2, a1.height / 2);
  near(x, a3.width / 2, 1e-9, 'x');
  near(y, a3.height / 2, 1e-9, 'y');
  assert.ok(isIdentityAlignment(normalizeAlignment({})));
  assert.equal(normalizeAlignment({ scale: -2 }).scale, 1);
});

test('dx/dy are millimetres on the new sheet, rotation and scale about the centre', () => {
  const s = sheetPt(SHEETS_MM.A3);
  const m = alignmentMatrix({ dx: 10, dy: -5, rotation: 90, scale: 2 }, s, s);
  const c = applyPoint(m, s.width / 2, s.height / 2);
  near(c[0], s.width / 2 + 10 * PT_PER_MM, 1e-9, 'shift x');
  near(c[1], s.height / 2 - 5 * PT_PER_MM, 1e-9, 'shift y');
  // A point 1 pt right of the centre lands 2 pt below it (90° clockwise in y-down).
  const p = applyPoint(m, s.width / 2 + 1, s.height / 2);
  near(p[0] - c[0], 0, 1e-9, 'rot x');
  near(p[1] - c[1], 2, 1e-9, 'rot y');
});

test('matrix and parameters round-trip', () => {
  const o = sheetPt(SHEETS_MM.A1);
  const n = sheetPt(SHEETS_MM.A3);
  const a = { dx: 1.25, dy: -0.75, rotation: 0.4, scale: 0.4994 };
  const back = matrixToAlignment(alignmentMatrix(a, o, n), o, n);
  for (const k of Object.keys(a)) near(back[k], a[k], 1e-9, k);
  const inv = invert(alignmentMatrix(a, o, n));
  const q = applyPoint(inv, ...applyPoint(alignmentMatrix(a, o, n), 100, 200));
  near(q[0], 100, 1e-9, 'inv x');
  near(q[1], 200, 1e-9, 'inv y');
  const r = applyRect([2, 0, 0, 2, 1, 1], { x: 0, y: 0, width: 3, height: 4 });
  assert.deepEqual(r, { x: 1, y: 1, width: 6, height: 8 });
});

test('the split line CSS transform is the detection transform in bitmap pixels', () => {
  const o = sheetPt(SHEETS_MM.A3);
  const n = sheetPt(SHEETS_MM.A3);
  const a = { dx: 2, dy: 1, rotation: 1.5, scale: 1.01 };
  const css = alignmentCss(a, o, n, 1.5);
  const nums = css.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
  const px = pixelMatrix(a, o, n, 1.5);
  nums.forEach((v, i) => near(v, px[i], 1e-5, `m${i}`));
});

test('measuring scales: same drawing at 1:50 on A1 and 1:100 on A3 gives 0.5', () => {
  // pixelsPerUnit = points on paper per real-world unit.
  const at = (ratio, unit = 'mm', perMm = 1) => ({ pixelsPerUnit: (PT_PER_MM / ratio) * perMm, unit, width: 500, height: 300 });
  near(measureScaleRatio([at(50)], [at(100)]), 0.5, 1e-12, 'ratio');
  near(measureScaleRatio(at(50, 'm', 1000), at(100)), 0.5, 1e-12, 'units');
  // The largest viewport of a page decides.
  near(measureScaleRatio([{ ...at(10), width: 10, height: 10 }, at(50)], [at(100)]), 0.5, 1e-12, 'largest');
  assert.equal(measureScaleRatio(null, [at(100)]), null);
  assert.equal(measureScaleRatio([{ pixelsPerUnit: 2, unit: 'parsec' }], [at(100)]), null);
});

test('phase correlation finds a known shift', () => {
  const n = 64;
  const a = new Float64Array(n * n);
  const b = new Float64Array(n * n);
  for (let i = 0; i < 40; i++) {
    const x = (i * 13) % 50 + 5;
    const y = (i * 29) % 50 + 5;
    b[y * n + x] = 1;
    a[(y + 3) * n + (x - 5)] = 1;
  }
  const r = phaseCorrelate(a, b, n);
  near(r.dx, -5, 0.01, 'dx');
  near(r.dy, 3, 0.01, 'dy');
  assert.ok(r.peak > 0.9);
});

test('automatic alignment recovers a 1 mm plot shift with a 0.3° rotation, and then only the real change remains', () => {
  const sheet = SHEETS_MM.A3;
  const pt = sheetPt(sheet);
  const plan = planPair(pt, pt);
  const segs = drawingFor(sheet, 7, { strokes: 1200 });
  // Old plot: the drawing shifted by (1, -0.6) mm and turned 0.3°.
  const oldM = rasterize(sheet, segs, plan.mmPerPx, plotMap(sheet, sheet, { dx: 1, dy: -0.6, rotation: 0.3 }));
  const newSegs = [...segs, { x1: 120, y1: 180, x2: 122, y2: 180, t: 0.25 }];
  const newM = rasterize(sheet, newSegs, plan.mmPerPx);
  const params = detectionParams('line', plan.mmPerPx);

  // Without alignment the shift reads as change across the whole sheet.
  const raw = detectMaskChanges(oldM, newM, params);
  const rawArea = raw.clusters.reduce((s, c) => s + c.width * c.height, 0);
  assert.ok(rawArea > newM.width * newM.height * 0.5, `unaligned covers the sheet (${rawArea})`);

  const est = estimateAlignment(oldM, newM, { pxPerPt: plan.pxPerPt, oldSize: pt, newSize: pt });
  // Old -> new undoes the plot transform.
  const inv = invert(alignmentMatrix({ dx: 1, dy: -0.6, rotation: 0.3, scale: 1 }, pt, pt));
  const want = matrixToAlignment(inv, pt, pt);
  near(est.alignment.dx, want.dx, 0.1, 'dx mm');
  near(est.alignment.dy, want.dy, 0.1, 'dy mm');
  near(est.alignment.rotation, -0.3, 0.03, 'rotation');
  near(est.alignment.scale, 1, 0.002, 'scale');
  assert.ok(est.confidence > 0.9, `confidence ${est.confidence}`);
  assert.ok(est.identityConfidence < est.confidence);

  const T = pixelMatrix(est.alignment, pt, pt, plan.pxPerPt);
  const aligned = detectMaskChanges(oldM, newM, { ...params, transform: T });
  assert.equal(aligned.clusters.length, 1, JSON.stringify(aligned.clusters));
  assert.equal(aligned.clusters[0].type, 'added');
  near(aligned.clusters[0].x * plan.mmPerPx, 120, 1, 'change x mm');
});

test('the same drawing plotted to A1 and to A3 aligns without input (scale correction)', () => {
  const A1 = SHEETS_MM.A1, A3 = SHEETS_MM.A3;
  const p1 = sheetPt(A1), p3 = sheetPt(A3);
  const plan = planPair(p1, p3);
  const segs = drawingFor(A1, 3, { strokes: 1200 });
  const oldM = rasterize(A1, segs, plan.mmPerPx);
  // A3 plot: scaled to fit (0.4994) and slightly off centre.
  const s = 0.4994;
  const newM = rasterize(A3, segs, plan.mmPerPx, plotMap(A1, A3, { scale: s, dx: 0.7, dy: -0.4 }));
  const est = estimateAlignment(oldM, newM, { pxPerPt: plan.pxPerPt, oldSize: p1, newSize: p3 });
  near(est.alignment.scale, s, 0.002, 'scale');
  near(est.alignment.dx, 0.7, 0.15, 'dx');
  near(est.alignment.dy, -0.4, 0.15, 'dy');
  near(est.alignment.rotation, 0, 0.05, 'rotation');
  assert.ok(est.confidence > 0.9, `confidence ${est.confidence}`);

  // The detection renders the old page at the scale it is shown at (here:
  // rasterised at mmPerPx / scale) and finds no change in an unchanged plot,
  // but does find a 2 mm addition on the A3 sheet.
  const oldPx = plan.pxPerPt * est.alignment.scale;
  const oldScaled = rasterize(A1, segs, plan.mmPerPx / est.alignment.scale);
  const T = [plan.pxPerPt, 0, 0, plan.pxPerPt, 0, 0];
  const A = alignmentMatrix(est.alignment, p1, p3);
  const M = [A[0] * plan.pxPerPt / oldPx, A[1] * plan.pxPerPt / oldPx, A[2] * plan.pxPerPt / oldPx, A[3] * plan.pxPerPt / oldPx, A[4] * T[0], A[5] * T[0]];
  const params = detectionParams('line', plan.mmPerPx);
  assert.deepEqual(detectMaskChanges(oldScaled, newM, { ...params, transform: M }).clusters, []);
  const newPlus = rasterize(A3, [{ x1: 300, y1: 100, x2: 302, y2: 100, t: 0.25 }], plan.mmPerPx, null,
    rasterize(A3, segs, plan.mmPerPx, plotMap(A1, A3, { scale: s, dx: 0.7, dy: -0.4 })));
  const found = detectMaskChanges(oldScaled, newPlus, { ...params, transform: M }).clusters;
  assert.equal(found.length, 1, JSON.stringify(found));
  near(found[0].x * plan.mmPerPx, 300, 1, 'x of the 2 mm change on A3');
});

test('a measuring-scale ratio is used as a scale candidate', () => {
  const A1 = SHEETS_MM.A1, A3 = SHEETS_MM.A3;
  const p1 = sheetPt(A1), p3 = sheetPt(A3);
  const plan = planPair(p1, p3);
  const segs = drawingFor(A1, 9, { strokes: 800 });
  const oldM = rasterize(A1, segs, plan.mmPerPx);
  // Plotted at exactly half scale (1:50 -> 1:100), not the fit-to-paper ratio.
  const newM = rasterize(A3, segs, plan.mmPerPx, plotMap(A1, A3, { scale: 0.45 }));
  const est = estimateAlignment(oldM, newM, { pxPerPt: plan.pxPerPt, oldSize: p1, newSize: p3, measureRatio: 0.45 });
  near(est.alignment.scale, 0.45, 0.002, 'scale');
  assert.equal(est.method, 'measure');
});

test('pages that already line up keep the identity', () => {
  const sheet = SHEETS_MM.A4;
  const pt = sheetPt(sheet);
  const plan = planPair(pt, pt);
  const segs = drawingFor(sheet, 2, { strokes: 400 });
  const m = rasterize(sheet, segs, plan.mmPerPx);
  const est = estimateAlignment(m, rasterize(sheet, segs, plan.mmPerPx), { pxPerPt: plan.pxPerPt, oldSize: pt, newSize: pt });
  assert.equal(est.method, 'identity');
  assert.ok(isIdentityAlignment(est.alignment));
  assert.ok(est.confidence > 0.99);
});
