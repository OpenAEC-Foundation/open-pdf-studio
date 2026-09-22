// Een wolk kleiner dan 1 pt wordt op zijn EIGEN maat getekend, in de app en in
// de vector-appearance van de PDF. Beide bouwers spiegelen elkaar bewust;
// deze test houdt ze samen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudPath, buildCloudPolylinePath } from './shapes.js';
import { cloudRectOutlinePts, cloudPolyOutlinePts } from '../../pdf/saver/appearance-vectors.js';
import { MIN_VORM_MAAT_PT } from '../minimummaat.js';

/** Canvas-stub die alleen de boogjes vastlegt. */
function stubCtx() {
  const arcs = [];
  return {
    arcs,
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc(cx, cy, r) { arcs.push({ cx, cy, r }); },
  };
}

function omhullende(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

test('rechthoekwolk van 0,2 pt: boogjes blijven bij de vorm, niet bij een vak van 1 pt', () => {
  const ctx = stubCtx();
  buildCloudPath(ctx, 10, 10, 0.2, 0.2);
  assert.ok(ctx.arcs.length >= 8, `${ctx.arcs.length} boogjes`);
  for (const a of ctx.arcs) {
    // Middelpunt en straal horen bij een vorm van 0,2 pt (straal < 0,2).
    assert.ok(a.r > 0 && a.r < 0.2, `straal ${a.r}`);
    assert.ok(a.cx > 9.5 && a.cx < 10.7 && a.cy > 9.5 && a.cy < 10.7, `middelpunt ${a.cx},${a.cy}`);
  }
  // Saver: dezelfde vorm, dezelfde omhullende (ruim binnen 1 pt).
  const pts = cloudRectOutlinePts(10, 10, 0.2, 0.2);
  assert.ok(pts.length > 8);
  const o = omhullende(pts);
  assert.ok(o.maxX - o.minX < 0.6 && o.maxY - o.minY < 0.6, JSON.stringify(o));
  assert.ok(o.minX > 9.5 && o.minY > 9.5);
});

test('rechthoekwolk op de technische ondergrens tekent nog een pad, en nul of NaN blaast niet op', () => {
  const ctx = stubCtx();
  buildCloudPath(ctx, 0, 0, MIN_VORM_MAAT_PT, MIN_VORM_MAAT_PT);
  assert.ok(ctx.arcs.length >= 8);
  for (const a of ctx.arcs) assert.ok(Number.isFinite(a.cx) && Number.isFinite(a.cy) && a.r > 0);
  const kapot = stubCtx();
  buildCloudPath(kapot, 0, 0, 0, NaN);
  for (const a of kapot.arcs) assert.ok(Number.isFinite(a.cx) && Number.isFinite(a.cy) && Number.isFinite(a.r));
  const pts = cloudRectOutlinePts(0, 0, 0, NaN);
  for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const o = omhullende(pts);
  assert.ok(o.maxX - o.minX < 0.1, 'nul-maat wordt de ondergrens, niet 1 pt');
});

test('wolk-polylijn met randen van 0,3 pt is zichtbaar in de app en in de PDF', () => {
  const punten = [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.3 }, { x: 0, y: 0.3 }];
  const ctx = stubCtx();
  buildCloudPolylinePath(ctx, punten, true);
  assert.equal(ctx.arcs.length, 4, 'één boogje per rand');
  for (const a of ctx.arcs) assert.ok(a.r > 0 && a.r <= 0.15);
  const pts = cloudPolyOutlinePts(punten, true);
  assert.ok(pts.length >= 4 * 8);
  const o = omhullende(pts);
  assert.ok(o.maxX - o.minX < 0.7 && o.maxY - o.minY < 0.7, JSON.stringify(o));
});

test('wolk-polylijn: samenvallende punten (rand nul) worden overgeslagen zonder NaN', () => {
  const punten = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 8, y: 5 }];
  const ctx = stubCtx();
  buildCloudPolylinePath(ctx, punten, false);
  assert.equal(ctx.arcs.length, 1);
  const pts = cloudPolyOutlinePts(punten, false);
  for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
