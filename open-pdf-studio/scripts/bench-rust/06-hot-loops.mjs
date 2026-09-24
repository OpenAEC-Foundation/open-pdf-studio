// The remaining compute-heavy loops in the interactive path:
//   - performSnap()        — runs on every pointer move while drawing/dragging
//   - buildSysteemraster() — parametric grid, rebuilt from scratch every frame
//   - detectChanges()      — connected-component labelling over two page bitmaps
//
// Run: node scripts/bench-rust/06-hot-loops.mjs

import './dom-shim.mjs';
import { bench, report, rng } from './lib.mjs';
import { loadAppModules } from './bundle.mjs';

const m = await loadAppModules('hotloops', [
  ['js/tools/snap-engine.js', ['performSnap', 'collectSnapPoints']],
  ['js/annotations/systeemraster.js', ['buildSysteemraster']],
  ['js/compare/change-detector.js', ['detectChanges']],
]);

const rows = [];
const r = rng(19);

// performSnap reads the snap settings out of the preferences store.
m.state.preferences.enableObjectSnap = true;
m.state.preferences.objectSnapRadius = 12;
m.state.preferences.snapToPdfContent = false;

// ------------------------------------------------------------------ snapping
function sheet(n) {
  const out = [];
  const types = ['line', 'rectangle', 'polyline', 'circle', 'arrow'];
  for (let i = 0; i < n; i++) {
    const t = types[i % types.length];
    const x = r() * 2300, y = r() * 3300, w = 20 + r() * 300, h = 20 + r() * 200;
    const a = { id: `a${i}`, type: t, page: 1, x, y, width: w, height: h, rotation: 0,
      startX: x, startY: y, endX: x + w, endY: y + h, lineWidth: 1 };
    if (t === 'polyline') {
      a.points = [];
      for (let k = 0; k < 8; k++) a.points.push({ x: x + r() * w, y: y + r() * h });
    }
    out.push(a);
  }
  return out;
}
for (const n of [100, 500, 2000]) {
  const anns = sheet(n);
  rows.push(bench(`performSnap, ${n} annotations on the page`, () => {
    m.performSnap(r() * 2300, r() * 3300, anns, 1, 1.5, null, null);
  }, { iters: n >= 2000 ? 5 : 40, warm: 1, repeat: 3 }));
  rows.push(bench(`collectSnapPoints only, ${n} annotations`, () => {
    m.collectSnapPoints(anns, 1, null);
  }, { iters: n >= 2000 ? 20 : 100, warm: 1, repeat: 3 }));
}

// -------------------------------------------------------------- system grid
function raster(wMm, hMm) {
  // The contour lives in `points` (app units); plate size is in mm.
  return {
    id: 'sr1', type: 'systeemraster', page: 1,
    x: 100, y: 100, width: wMm, height: hMm, rotation: 0,
    points: [
      { x: 100, y: 100 }, { x: 100 + wMm, y: 100 },
      { x: 100 + wMm, y: 100 + hMm }, { x: 100, y: 100 + hMm },
    ],
    plaatBreedteMm: 600, plaatHoogteMm: 600, rasterHoek: 0,
    originXMm: 0, originYMm: 0, sparingen: [],
  };
}
for (const [w, h, label] of [[1200, 1200, 'small 4 cells'], [6000, 6000, 'medium 100 cells'], [18000, 12000, 'large 600 cells']]) {
  const ann = raster(w, h);
  const res = m.buildSysteemraster(ann, { pxPerMm: 1 }) || {};
  const counted = Object.entries(res).filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}:${v.length}`).join(' ');
  rows.push(bench(`buildSysteemraster ${label} [${counted}]`, () => {
    m.buildSysteemraster(ann, { pxPerMm: 1 });
  }, { iters: 20, warm: 1, repeat: 3 }));
}

// ---------------------------------------------------- page comparison (pixels)
// Two renders of the same A3 sheet at 150 dpi, with a few hundred changed pixels.
function pageBitmap(w, h, seedInk) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < seedInk; i++) {
    const p = ((r() * w * h) | 0) * 4;
    d[p] = 20; d[p + 1] = 20; d[p + 2] = 20;
  }
  return { data: d, width: w, height: h };
}
const r2 = rng(101);
function pageBitmap2(w, h, seedInk) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < seedInk; i++) {
    const p = ((r2() * w * h) | 0) * 4;
    d[p] = 20; d[p + 1] = 20; d[p + 2] = 20;
  }
  return { data: d, width: w, height: h };
}
// The last row is the resolution #465 asks for: ~0.2 mm per pixel on A0.
for (const [w, h, label] of [[1240, 1754, 'A4 at 150 dpi (2.2 MP)'], [2480, 3508, 'A3 at 300 dpi (8.7 MP)'], [4205, 5945, 'A0 at 0.2 mm/px (25 MP, what #465 asks for)']]) {
  const a = pageBitmap2(w, h, Math.round(w * h * 0.03));
  const b = { data: Uint8ClampedArray.from(a.data), width: w, height: h };
  for (let i = 0; i < 4000; i++) {
    const p = ((r2() * w * h) | 0) * 4;
    b.data[p] = 10; b.data[p + 1] = 10; b.data[p + 2] = 10;
  }
  rows.push(bench(`detectChanges ${label}`, () => {
    m.detectChanges(a, b);
  }, { iters: 1, warm: 2, repeat: 5 }));
}

report(rows);
