// Hit testing: findAnnotationAt() walks every annotation in the document in
// reverse order (js/annotations/geometry.js:207) and runs the full precise test
// per candidate, rebuilding derived geometry for some types inside that loop.
// The grid in js/annotations/spatial-index.js is never consulted on this path:
// rebuildSpatialIndex() (js/annotations/rendering.js:2700) has no callers.
//
// Run: node scripts/bench-rust/05-hittest.mjs

import './dom-shim.mjs';
import { bench, report, rng } from './lib.mjs';
import { loadAppModules } from './bundle.mjs';

const { findAnnotationAt, spatialIndex, annotationBounds, state } = await loadAppModules('geometry', [
  ['js/annotations/geometry.js', ['findAnnotationAt', 'isPointInsideAnnotation']],
  ['js/annotations/spatial-index.js', ['spatialIndex', 'annotationBounds']],
]);

// ---------------------------------------------------------------- the sheets
const r = rng(3);
function makeAnnotations(n, pages) {
  const types = ['rectangle', 'circle', 'line', 'arrow', 'polyline', 'draw', 'text', 'cloud', 'filledArea', 'wall'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = types[i % types.length];
    const x = r() * 2300, y = r() * 3300;
    const w = 20 + r() * 300, h = 20 + r() * 200;
    const a = {
      id: `a${i}`, type: t, page: 1 + (i % pages),
      x, y, width: w, height: h, rotation: 0,
      color: '#c00000', strokeColor: '#c00000', fillColor: 'none',
      lineWidth: 1, borderStyle: 'solid', opacity: 1,
      startX: x, startY: y, endX: x + w, endY: y + h,
    };
    if (t === 'polyline' || t === 'cloud' || t === 'filledArea') {
      a.points = [];
      for (let k = 0; k < 16; k++) a.points.push({ x: x + r() * w, y: y + r() * h });
    }
    if (t === 'draw') {
      a.path = [];
      for (let k = 0; k < 120; k++) a.path.push({ x: x + r() * w, y: y + r() * h });
    }
    out.push(a);
  }
  return out;
}

const rows = [];
for (const [n, pages] of [[200, 1], [2000, 1], [10000, 1], [10000, 20]]) {
  const anns = makeAnnotations(n, pages);
  state.documents = [{ filePath: 'x.pdf', currentPage: 1, scale: 1.5, annotations: anns, pageRotations: {} }];
  state.activeDocumentIndex = 0;
  const onPage1 = anns.filter((a) => a.page === 1).length;

  // One hit test per pointer move. 60 fps means one every 16.7 ms.
  rows.push(bench(`findAnnotationAt, ${n} annots / ${pages} page(s) (${onPage1} on page 1)`, (i) => {
    findAnnotationAt(r() * 2300, r() * 3300, 1);
  }, { iters: 200, warm: 2, repeat: 5 }));

  // What a spatial prefilter would cost instead: rebuild-free query of the grid.
  spatialIndex.clear?.();
  const t0 = process.hrtime.bigint();
  if (spatialIndex.rebuild) spatialIndex.rebuild(anns);
  else if (spatialIndex.insert) for (const a of anns) spatialIndex.insert(a);
  const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  spatial index build for ${n} annotations: ${buildMs.toFixed(2)} ms`);
}

// The worst realistic case: a pointer resting over a dense corner while the
// user drags, i.e. one hit test per mousemove at ~120 Hz for a second.
const dense = makeAnnotations(10000, 1);
state.documents = [{ filePath: 'x.pdf', currentPage: 1, scale: 1.5, annotations: dense, pageRotations: {} }];
rows.push(bench('120 hit tests (one second of dragging at 120 Hz), 10k annots', () => {
  for (let k = 0; k < 120; k++) findAnnotationAt(r() * 2300, r() * 3300, 1);
}, { iters: 1, warm: 1, repeat: 5 }));

// annotationBounds is the per-annotation cost the spatial index pays on rebuild.
rows.push(bench('annotationBounds over 10000 annotations', () => {
  for (const a of dense) annotationBounds(a);
}, { iters: 1, warm: 1, repeat: 5 }));

report(rows);
