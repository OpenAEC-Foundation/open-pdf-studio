// Compare detection (#465): resolution from the paper size, tiling and memory
// bounds, millimetre-based cluster filters, sensitivity presets, background
// estimate and the mask detection itself on synthetic A0, A1 and A3 sheets.
// No timing assertions: the A0 timing is measured locally, not in CI.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planPair, planTiles, memoryFor, detectionParams, SENSITIVITY_PRESETS, normalizePreset,
  MAX_TILE_PX, MAX_TILE_EDGE, MAX_MASK_PX, TARGET_MM_PER_PX,
} from './detect-plan.js';
import { estimateBackground, rgbaToMask, createMask, writeInkTile, countInk, downsampleDensity } from './ink-mask.js';
import { detectMaskChanges, mergeBoxes } from './mask-detect.js';
import { handleDetectMessage, createDetectClient, DETECT_RESULT } from './change-detect-protocol.js';
import { SHEETS_MM, drawingFor, rasterize, sheetPt } from './synthetic-sheets.mjs';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('resolution follows the paper size: about 0.2 mm per pixel on A0, A1 and A3', () => {
  for (const name of ['A0', 'A1', 'A3', 'A4']) {
    const pt = sheetPt(SHEETS_MM[name]);
    const plan = planPair(pt, pt);
    near(plan.mmPerPx, TARGET_MM_PER_PX, 1e-9, name);
    // 0.2 mm/px: the long side in pixels is the long side in mm divided by 0.2.
    near(plan.new.width, Math.ceil(SHEETS_MM[name].width / 0.2), 1, `${name} width`);
  }
});

test('both sides share one resolution; the larger sheet decides the budget', () => {
  const a1 = sheetPt(SHEETS_MM.A1);
  const a3 = sheetPt(SHEETS_MM.A3);
  const plan = planPair(a1, a3);
  near(plan.mmPerPx, 0.2, 1e-9, 'A1 vs A3');
  assert.ok(plan.old.width > plan.new.width * 1.9);
  // A 10 m roll plot cannot get 0.2 mm/px within the mask budget: it gets a
  // coarser resolution and stays within the budget.
  const roll = { width: (10000 * 72) / 25.4, height: (914 * 72) / 25.4 };
  const p2 = planPair(roll, roll);
  assert.ok(p2.mmPerPx > 0.2);
  assert.ok(p2.new.width * p2.new.height <= MAX_MASK_PX * 1.001);
});

test('tiles cover the raster exactly and each stays within the tile budget', () => {
  for (const [w, h] of [[5945, 4205], [4205, 5945], [2100, 1485], [50000, 4570], [1, 1], [4097, 3]]) {
    const tiles = planTiles(w, h);
    let area = 0;
    for (const t of tiles) {
      assert.ok(t.w * t.h <= MAX_TILE_PX, `${w}x${h}: tile ${t.w}x${t.h}`);
      assert.ok(t.w <= MAX_TILE_EDGE && t.h <= MAX_TILE_EDGE);
      area += t.w * t.h;
    }
    assert.equal(area, w * h, `${w}x${h} covered once`);
  }
  // A0 at 0.2 mm/px: a 25 Mpx mask of one byte per pixel, RGBA only per tile.
  const plan = planPair(sheetPt(SHEETS_MM.A0), sheetPt(SHEETS_MM.A0));
  const mem = memoryFor(plan.new.width, plan.new.height);
  assert.ok(mem.maskBytes < 26 * 1024 * 1024, `mask ${mem.maskBytes}`);
  assert.ok(mem.tileBytes <= MAX_TILE_PX * 4, `tile ${mem.tileBytes}`);
  assert.ok(mem.tileBytes < plan.new.width * plan.new.height * 4 / 2, 'never the whole page as RGBA');
});

test('tiled mask writing gives the same mask as one buffer', () => {
  const W = 37, H = 23;
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let i = 0; i < W * H; i++) if ((i * 7) % 11 === 0) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 0; }
  const whole = rgbaToMask(rgba, W, H, { r: 255, g: 255, b: 255 }, 96);
  const tiled = createMask(W, H);
  for (const t of planTiles(W, H, { maxEdge: 8, maxPx: 64 })) {
    const tile = new Uint8ClampedArray(t.w * t.h * 4);
    for (let y = 0; y < t.h; y++) tile.set(rgba.subarray(((t.y + y) * W + t.x) * 4, ((t.y + y) * W + t.x + t.w) * 4), y * t.w * 4);
    writeInkTile(tiled, tile, t.w, t.h, t.x, t.y, { r: 255, g: 255, b: 255 }, 96);
  }
  assert.deepEqual(tiled.data, whole.data);
  assert.equal(whole.stride % 4, 0);
  // An unaligned buffer takes the per-byte path: same mask.
  const shifted = new Uint8ClampedArray(rgba.length + 1);
  shifted.set(rgba, 1);
  const slow = createMask(W, H);
  writeInkTile(slow, shifted.subarray(1), W, H, 0, 0, { r: 255, g: 255, b: 255 }, 96);
  assert.deepEqual(slow.data, whole.data);
});

test('background is estimated from the page: dark CAD background and grey scan', () => {
  const W = 64, H = 48;
  const dark = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { dark[i * 4 + 3] = 255; }
  for (let x = 0; x < W; x++) { const p = (10 * W + x) * 4; dark[p] = 255; dark[p + 1] = 255; dark[p + 2] = 0; }
  const bg = estimateBackground(dark, W, H);
  assert.deepEqual(bg, { r: 0, g: 0, b: 0 });
  const m = rgbaToMask(dark, W, H, bg, SENSITIVITY_PRESETS.line.threshold);
  assert.equal(countInk(m), W, 'the yellow line on black is ink, the black paper is not');

  const grey = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { grey[i * 4] = 200 + (i % 5); grey[i * 4 + 1] = 198; grey[i * 4 + 2] = 196; grey[i * 4 + 3] = 255; }
  for (let y = 0; y < H; y++) { const p = (y * W + 20) * 4; grey[p] = grey[p + 1] = grey[p + 2] = 30; }
  const gbg = estimateBackground(grey, W, H);
  assert.ok(gbg.r >= 196 && gbg.r <= 206, JSON.stringify(gbg));
  assert.equal(countInk(rgbaToMask(grey, W, H, gbg, SENSITIVITY_PRESETS.scan.threshold)), H);
  // Assuming white paper would have marked the whole grey sheet as ink.
  assert.equal(countInk(rgbaToMask(grey, W, H, { r: 255, g: 255, b: 255 }, 96)), W * H);
});

test('presets set threshold, minimum size and merge distance together, in mm on paper', () => {
  assert.deepEqual(Object.keys(SENSITIVITY_PRESETS), ['line', 'scan', 'text']);
  assert.equal(normalizePreset('nope'), 'line');
  const line = detectionParams('line', 0.2);
  const scan = detectionParams('scan', 0.2);
  assert.ok(scan.threshold > line.threshold);
  assert.ok(scan.minAreaPx > line.minAreaPx);
  assert.ok(scan.mergePx > line.mergePx);
  assert.ok(scan.tolerancePx > line.tolerancePx);
  // Same millimetres at another resolution: the pixel values scale with it.
  const coarse = detectionParams('line', 0.4);
  assert.equal(coarse.mergePx, Math.round(line.mergePx / 2));
  near(coarse.minAreaPx * 0.4 * 0.4, line.minAreaPx * 0.2 * 0.2, 0.2, 'area in mm²');
});

// Line of `lenMm` at (x, y) mm on the sheet.
const mark = (x, y, lenMm, t = 0.25) => ({ x1: x, y1: y, x2: x + lenMm, y2: y, t });

for (const name of ['A3', 'A1', 'A0']) {
  test(`${name}: a 2 mm change on paper is found, and only that`, () => {
    const sheet = SHEETS_MM[name];
    const pt = sheetPt(sheet);
    const plan = planPair(pt, pt);
    const params = detectionParams('line', plan.mmPerPx);
    const segs = drawingFor(sheet, 11, { strokes: 800 });
    const oldM = rasterize(sheet, segs, plan.mmPerPx);
    // New revision: a 2 mm stroke added, and a 20 mm wall line moved by 2 mm.
    const ax = sheet.width * 0.31, ay = sheet.height * 0.42;
    const mx = sheet.width * 0.66, my = sheet.height * 0.27;
    const oldWithWall = rasterize(sheet, [mark(mx, my, 20)], plan.mmPerPx, null, rasterize(sheet, segs, plan.mmPerPx));
    const newM = rasterize(sheet, [mark(ax, ay, 2), mark(mx, my + 2, 20)], plan.mmPerPx, null, rasterize(sheet, segs, plan.mmPerPx));
    const r = detectMaskChanges(oldWithWall, newM, params);
    assert.equal(r.truncated, false);
    const toMm = (c) => ({ x: c.x * plan.mmPerPx, y: c.y * plan.mmPerPx, w: c.width * plan.mmPerPx, h: c.height * plan.mmPerPx });
    const hit = (x, y) => r.clusters.find((c) => {
      const m = toMm(c);
      return x >= m.x - 1 && x <= m.x + m.w + 1 && y >= m.y - 1 && y <= m.y + m.h + 1;
    });
    const added = hit(ax + 1, ay);
    assert.ok(added, `${name}: 2 mm stroke found`);
    assert.equal(added.type, 'added');
    near(toMm(added).w, 2, 0.6, `${name}: size in mm`);
    // The moved line: removed at its old place, added at its new place
    // (one "modified" change when both fall within the merge distance).
    const was = hit(mx + 10, my);
    const now = hit(mx + 10, my + 2);
    assert.ok(was && ['removed', 'modified'].includes(was.type), `${name}: old place of the moved line`);
    assert.ok(now && ['added', 'modified'].includes(now.type), `${name}: new place of the moved line`);
    // Nothing else on the sheet.
    const known = new Set([added, was, now]);
    assert.deepEqual(r.clusters.filter((c) => !known.has(c)).map(toMm), [], `${name}: nothing else`);
    // Identical pages: no changes at all.
    assert.equal(detectMaskChanges(oldM, rasterize(sheet, segs, plan.mmPerPx), params).clusters.length, 0);
  });
}

test('changes below the minimum size in mm² are dropped, larger ones kept', () => {
  const sheet = SHEETS_MM.A4;
  const plan = planPair(sheetPt(sheet), sheetPt(sheet));
  const params = detectionParams('line', plan.mmPerPx);
  const oldM = rasterize(sheet, [], plan.mmPerPx);
  // A speck of 0.1 x 0.1 mm (well below 0.2 mm²) and a 1 mm dot.
  const newM = createMask(oldM.width, oldM.height);
  newM.data[100 * newM.stride + 100] = 1;
  rasterize(sheet, [mark(150, 100, 1, 0.5)], plan.mmPerPx, null, newM);
  const r = detectMaskChanges(oldM, newM, params);
  assert.equal(r.clusters.length, 1);
  assert.ok(r.clusters[0].x > 600);
});

test('tolerance: a sub-tolerance shift of the same ink is not a change', () => {
  const sheet = SHEETS_MM.A4;
  const plan = planPair(sheetPt(sheet), sheetPt(sheet));
  const params = detectionParams('line', plan.mmPerPx);
  const segs = drawingFor(sheet, 5, { strokes: 300 });
  const a = rasterize(sheet, segs, plan.mmPerPx);
  const b = rasterize(sheet, segs, plan.mmPerPx, (x, y) => [x + 0.15, y - 0.1]);
  assert.equal(detectMaskChanges(a, b, params).clusters.length, 0);
});

test('merging is in mm: strokes of one changed figure become one change', () => {
  const sheet = SHEETS_MM.A4;
  const plan = planPair(sheetPt(sheet), sheetPt(sheet));
  const oldM = rasterize(sheet, [], plan.mmPerPx);
  // "2350": four short strokes 1 mm apart.
  const digits = [0, 1, 2, 3].map((i) => mark(100 + i * 1.6, 50, 0.8, 0.3));
  const newM = rasterize(sheet, digits, plan.mmPerPx);
  assert.equal(detectMaskChanges(oldM, newM, detectionParams('line', plan.mmPerPx)).clusters.length, 1);
  assert.equal(detectMaskChanges(oldM, newM, { ...detectionParams('line', plan.mmPerPx), mergePx: 0 }).clusters.length, 4);
});

test('mergeBoxes joins chains of nearby boxes and keeps far ones apart', () => {
  const b = (x, y) => ({ x1: x, y1: y, x2: x + 2, y2: y + 2, count: 4, flags: 1 });
  const out = mergeBoxes([b(0, 0), b(6, 0), b(12, 0), b(100, 100)], 4);
  assert.equal(out.length, 2);
  const big = out.find((o) => o.x1 === 0);
  assert.equal(big.x2, 14);
  assert.equal(big.count, 12);
});

test('downsampleDensity counts ink per cell', () => {
  const m = createMask(8, 4);
  m.data[0] = 1; m.data[1] = 1; m.data[m.stride + 5] = 1;
  const d = downsampleDensity(m, 2);
  assert.equal(d.width, 4);
  assert.equal(d.height, 2);
  near(d.data[0], 0.5, 1e-9, 'cell 0');
  near(d.data[2], 0.25, 1e-9, 'cell 2');
});

test('worker protocol: the masks task gives the same result as the direct call', async () => {
  const sheet = SHEETS_MM.A4;
  const plan = planPair(sheetPt(sheet), sheetPt(sheet));
  const params = detectionParams('line', plan.mmPerPx);
  const segs = drawingFor(sheet, 3, { strokes: 200 });
  const a = rasterize(sheet, segs, plan.mmPerPx);
  const b = rasterize(sheet, [...segs, mark(40, 40, 3)], plan.mmPerPx);
  const direct = detectMaskChanges(a, b, params);
  const reply = handleDetectMessage({ type: 'opds-detect', id: 4, task: 'masks', old: a, new: b, options: params });
  assert.equal(reply.type, DETECT_RESULT);
  assert.deepEqual(reply.changes, direct);
  const client = createDetectClient();
  const r = await client.run(a, b, { id: 1, task: 'masks', options: params });
  assert.deepEqual(r.changes, direct);
  const bad = handleDetectMessage({ type: 'opds-detect', id: 5, task: 'nope', old: a, new: b });
  assert.match(bad.error, /unknown detection task/);
});
