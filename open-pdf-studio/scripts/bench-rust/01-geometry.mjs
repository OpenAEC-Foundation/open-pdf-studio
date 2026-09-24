// Measure the pure-geometry work in the annotation layer:
//   - the cloud (wolk) outline, both the canvas path and the saver's point list
//   - the appearance-stream builders that turn a shape into PDF operators
//   - the quantities (takeoff) schedule engine
//   - annotation text search
// All of these import cleanly into node: no DOM, no canvas, no Tauri.
//
// Run: node scripts/bench-rust/01-geometry.mjs

import { bench, report, rng, pathRecorder, env } from './lib.mjs';
import { buildCloudPath, buildCloudPolylinePath } from '../../js/annotations/rendering/shapes.js';
import { cloudPolyOutlinePts, buildCloudAP, buildFilledAreaAP } from '../../js/pdf/saver/appearance-vectors.js';
import { buildSchedule } from '../../js/quantities/engine.js';
import { zoekInAnnotaties } from '../../js/search/search-sources.js';

env();

const rows = [];
const r = rng(7);

// ---------------------------------------------------------------- cloud outline
// A revision cloud drawn over an A1 detail: 40 vertices, edges of a few hundred
// points. This is the shape that is rebuilt on every frame while dragging.
function poly(n, radius) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: 800 + Math.cos(a) * radius, y: 600 + Math.sin(a) * radius });
  }
  return pts;
}
const cloud40 = poly(40, 400);
const cloud200 = poly(200, 400);
const ctx = pathRecorder();

rows.push(bench('cloud rect 600x400 puff15 -> canvas path', () => {
  buildCloudPath(ctx, 100, 100, 600, 400, 15);
}, { iters: 2000 }));

rows.push(bench('cloud poly 40 pts -> canvas path', () => {
  buildCloudPolylinePath(ctx, cloud40, true);
}, { iters: 2000 }));

rows.push(bench('cloud poly 200 pts -> canvas path', () => {
  buildCloudPolylinePath(ctx, cloud200, true);
}, { iters: 500 }));

rows.push(bench('cloud poly 40 pts -> saver point list', () => {
  cloudPolyOutlinePts(cloud40, true);
}, { iters: 2000 }));

// ---------------------------------------------------------- appearance streams
rows.push(bench('buildCloudAP (poly 40) -> PDF operators', () => {
  buildCloudAP({
    kind: 'poly', points: cloud40, X: (v) => v, Y: (v) => v,
    fillColorHex: '#ffeeaa', strokeColorHex: '#cc0000',
    lineWidth: 1.5, borderStyle: 'solid', heeftRand: true,
  });
}, { iters: 2000 }));

const areaPts = poly(120, 300);
rows.push(bench('buildFilledAreaAP 120 pts + hatch', () => {
  buildFilledAreaAP({
    points: areaPts, holes: null, X: (v) => v, Y: (v) => v,
    fillColorHex: '#cce5ff', strokeColorHex: '#003366',
    lineWidth: 1, borderStyle: 'solid',
    hatchPattern: 'diagonal', hatchColorHex: '#003366',
    hatchScale: 100, hatchAngle: 45, heeftRand: true, // 100 % = the default spacing
  });
}, { iters: 200 }));

// ------------------------------------------------------------------- quantities
// The takeoff schedule over a sheet full of measured objects.
function fakeElements(n) {
  const out = [];
  const types = ['measureDistance', 'measureArea', 'wall', 'betonbalk', 'filledArea', 'rectangle'];
  for (let i = 0; i < n; i++) {
    const t = types[i % types.length];
    out.push({
      id: `a${i}`, type: t, page: 1 + (i % 12),
      x: r() * 2000, y: r() * 1400, width: 10 + r() * 400, height: 10 + r() * 300,
      lengthMm: r() * 12000, areaM2: r() * 40,
      subject: `item ${i % 37}`, layer: `L${i % 9}`, author: 'bench',
      color: '#123456', strokeColor: '#123456',
      measurement: { value: r() * 100, unit: 'm' },
    });
  }
  return out;
}
for (const n of [500, 5000]) {
  const els = fakeElements(n);
  rows.push(bench(`buildSchedule over ${n} objects`, () => {
    buildSchedule(els, {});
  }, { iters: n >= 5000 ? 20 : 100 }));
}

// ------------------------------------------------------------ annotation search
function fakeAnnotations(n) {
  const words = ['beam', 'column', 'slab', 'revision', 'detail', 'note', 'check', 'level'];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `n${i}`, type: i % 3 === 0 ? 'text' : 'comment', page: 1 + (i % 12),
      x: r() * 2000, y: r() * 1400, width: 120, height: 40,
      text: `${words[i % words.length]} ${i} ${words[(i * 3) % words.length]}`,
      content: `remark ${i}`,
    });
  }
  return out;
}
const anns2000 = fakeAnnotations(2000);
const pattern = /detail/gi;
rows.push(bench('zoekInAnnotaties over 2000 annotations', () => {
  for (let p = 1; p <= 12; p++) zoekInAnnotaties(anns2000, p, pattern, null);
}, { iters: 50 }));

report(rows);
