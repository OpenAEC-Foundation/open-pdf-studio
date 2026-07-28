// Unittests voor de systeemraster-geometriekern (annotations/systeemraster.js).
// Draaien:  node --test scripts/test-systeemraster.mjs   (vanuit open-pdf-studio/)
// Ook opgenomen in `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSysteemraster,
  computeAxisOffset,
  clipVerticalLine,
  clipHorizontalLine,
  resolveSysteemrasterParams,
  systeemrasterContour,
  SYSTEEMRASTER_DEFAULTS,
} from '../js/annotations/systeemraster.js';

// Rechthoekige contour 0..W × 0..H (app-px). pxPerMm = 0.1 → 1000 mm = 100 px.
const K = 0.1;
function rectAnn(W, H, extra = {}) {
  return {
    type: 'systeemraster',
    points: [
      { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H },
    ],
    ...extra,
  };
}

test('defaults: 2000x2000-plaat, randconditie tonen, hoek 0', () => {
  const p = resolveSysteemrasterParams({});
  assert.equal(p.plaatBreedteMm, 2000);
  assert.equal(p.plaatHoogteMm, 2000);
  assert.equal(p.randConditie, 'tonen');
  assert.equal(p.rasterHoek, 0);
  assert.equal(p.equalizeX, false);
  assert.equal(p.tagTonen, true);
});

test('contour: gesloten aangeleverde ring wordt genormaliseerd, < 3 punten → null', () => {
  const c = systeemrasterContour({ points: [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 },
  ] });
  assert.equal(c.length, 3);
  assert.equal(systeemrasterContour({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), null);
});

test('rastercellen binnen rechthoekige contour: juiste lijnaantallen', () => {
  // 1000x600 px = 10000x6000 mm bij K=0.1; plaat 2000x2000 → cel 200x200 px.
  // Grid exact passend: binnenlijnen op 200,400,600,800 (verticaal, 4 stuks;
  // de lijnen op 0 en 1000 vallen op de contourrand → geen binnen-segment)
  // en 200,400 (horizontaal, 2 stuks).
  const g = buildSysteemraster(rectAnn(1000, 600), { pxPerMm: K });
  assert.ok(g);
  assert.equal(g.cellW, 200);
  assert.equal(g.linesV.length, 4);
  assert.equal(g.linesH.length, 2);
  for (const l of g.linesV) {
    assert.equal(l.segs.length, 1);
    assert.ok(Math.abs(l.segs[0].a - 0) < 1e-9 && Math.abs(l.segs[0].b - 600) < 1e-9);
  }
  // Exact passend → nergens randstukken.
  assert.deepEqual(g.randMm, { links: 0, rechts: 0, boven: 0, onder: 0 });
});

test('clip-randgeval: contourrand precies op een rasterlijn → geen segment', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.deepEqual(clipVerticalLine(pts, 0), []);
  assert.deepEqual(clipVerticalLine(pts, 10), []);
  assert.deepEqual(clipHorizontalLine(pts, 0), []);
  const mid = clipVerticalLine(pts, 5);
  assert.equal(mid.length, 1);
  assert.ok(Math.abs(mid[0].a - 0) < 1e-9 && Math.abs(mid[0].b - 10) < 1e-9);
});

test('clip: L-vormige contour geeft twee segmenten door de inham', () => {
  // L: buiten 0..10 × 0..10 met een uitsparing rechtsmidden (4..10 × 4..6).
  const L = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 },
    { x: 4, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ];
  const segs = clipVerticalLine(L, 7);
  assert.equal(segs.length, 2);
  assert.ok(Math.abs(segs[0].a - 0) < 1e-9 && Math.abs(segs[0].b - 4) < 1e-9);
  assert.ok(Math.abs(segs[1].a - 6) < 1e-9 && Math.abs(segs[1].b - 10) < 1e-9);
});

test('origin-offset verschuift de rasterlijnen exact', () => {
  // 500 mm origin bij K=0.1 → 50 px; contour 1000 px breed, cel 200 px.
  const g = buildSysteemraster(rectAnn(1000, 600, { originXMm: 500 }), { pxPerMm: K });
  assert.equal(g.linesV[0].x, 50);
  assert.ok(Math.abs(g.origin.x - 50) < 1e-9);
  // Randstukken: links 500 mm, rechts (1000-50) mod 200 = 150 px = 1500 mm.
  assert.ok(Math.abs(g.randMm.links - 500) < 1e-6);
  assert.ok(Math.abs(g.randMm.rechts - 1500) < 1e-6);
  // Origin is periodiek: 2500 mm ≡ 500 mm (mod plaatmaat).
  const g2 = buildSysteemraster(rectAnn(1000, 600, { originXMm: 2500 }), { pxPerMm: K });
  assert.ok(Math.abs(g2.linesV[0].x - 50) < 1e-9);
  // Negatieve offsets wikkelen ook netjes: -500 mm ≡ 1500 mm.
  const g3 = buildSysteemraster(rectAnn(1000, 600, { originXMm: -500 }), { pxPerMm: K });
  assert.ok(Math.abs(g3.linesV[0].x - 150) < 1e-9);
});

test('equalize x: randstukken links en rechts exact gelijk', () => {
  // 1100 px breed, cel 200 → rest 100 px; equalize → 50 px per kant = 500 mm.
  const g = buildSysteemraster(
    rectAnn(1100, 600, { originXMm: 700, equalizeX: true }), { pxPerMm: K });
  assert.ok(Math.abs(g.randMm.links - g.randMm.rechts) < 1e-6);
  assert.ok(Math.abs(g.randMm.links - 500) < 1e-6);
  // De y-as volgt nog gewoon de origin (equalizeY uit).
  assert.equal(resolveSysteemrasterParams({ equalizeX: true }).equalizeY, false);
});

test('equalize y: randstukken boven en onder exact gelijk', () => {
  const g = buildSysteemraster(
    rectAnn(1000, 700, { equalizeY: true }), { pxPerMm: K });
  assert.ok(Math.abs(g.randMm.boven - g.randMm.onder) < 1e-6);
  assert.ok(Math.abs(g.randMm.boven - 500) < 1e-6);
});

test('randconditie minmaat: geen randstuk smaller dan de minimale maat', () => {
  // 1100 px breed, cel 200, origin 0 → links 0 (vol), rechts 100 px = 1000 mm?
  // Nee: rest = 1100 mod 200 = 100 px → rechts 1000 mm bij origin 0. Kies een
  // origin die een te smal randstuk maakt: origin 100 mm → links 10 px =
  // 100 mm < minRand 300 mm → conditie grijpt in.
  const g = buildSysteemraster(rectAnn(1100, 600, {
    originXMm: 100, randConditie: 'minmaat', minRandMm: 300,
  }), { pxPerMm: K });
  for (const side of ['links', 'rechts']) {
    const v = g.randMm[side];
    assert.ok(v === 0 || v >= 300 - 1e-6,
      `randstuk ${side} = ${v} mm is smaller dan de minmaat`);
  }
});

test('randconditie minmaat: onhaalbaar krap veld → best haalbare verdeling', () => {
  // Veld 250 px, cel 200 px, minmaat 190 px: geen enkele offset haalt de
  // minmaat aan beide kanten. De conditie valt terug op de kandidaat met het
  // GROOTSTE KLEINSTE randstuk: offset 190 (links 190, rechts 60; min 60)
  // wint van equalize 25 (min 25) en van "vol beginnen" 0 (min 50).
  const off = computeAxisOffset({
    lengthPx: 250, cellPx: 200, originPx: 20, equalize: false,
    params: { randConditie: 'minmaat' }, minPx: 190,
  });
  assert.ok(Math.abs(off - 190) < 1e-9);
});

test('randconditie tonen: origin blijft ongemoeid, ook onder de minmaat', () => {
  const g = buildSysteemraster(rectAnn(1100, 600, {
    originXMm: 100, randConditie: 'tonen', minRandMm: 300,
  }), { pxPerMm: K });
  assert.ok(Math.abs(g.randMm.links - 100) < 1e-6);
});

test('fallback-schaal 1:100 zonder pxPerMm', () => {
  const g = buildSysteemraster(rectAnn(100, 100), {});
  // 2000 mm × (72/25.4/100) ≈ 56.69 px per cel.
  assert.ok(Math.abs(g.cellW - 2000 * (72 / 25.4 / 100)) < 1e-9);
});

test('tag: plaatmaat "BxH" bij de oorsprong; uit te zetten', () => {
  const g = buildSysteemraster(rectAnn(1000, 600, { plaatBreedteMm: 1200, plaatHoogteMm: 600 }), { pxPerMm: K });
  assert.equal(g.tag.text, '1200x600');
  const g2 = buildSysteemraster(rectAnn(1000, 600, { tagTonen: false }), { pxPerMm: K });
  assert.equal(g2.tag, null);
});

test('aabb omvat contour én tag', () => {
  const g = buildSysteemraster(rectAnn(1000, 600), { pxPerMm: K });
  assert.ok(g.aabb.x <= 0 && g.aabb.y <= g.contourAabb.y);
  assert.ok(g.aabb.width >= 1000 && g.aabb.height >= 600);
});

test('rasterHoek: veld wordt bewaard (gereserveerd), v1 rekent met 0', () => {
  const p = resolveSysteemrasterParams({ rasterHoek: 30 });
  assert.equal(p.rasterHoek, 30);
  // v1: de lijnen blijven as-parallel — verticale lijnen hebben één vaste x.
  const g = buildSysteemraster(rectAnn(1000, 600, { rasterHoek: 30 }), { pxPerMm: K });
  assert.ok(g.linesV.every(l => typeof l.x === 'number'));
});

test('degeneraat: contour zonder oppervlak of ontbrekende punten → null', () => {
  assert.equal(buildSysteemraster({ points: [] }, { pxPerMm: K }), null);
  assert.equal(buildSysteemraster({}, { pxPerMm: K }), null);
  // Collineaire "contour": clip levert nergens segmenten op, maar crasht niet.
  const g = buildSysteemraster({ points: [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 },
  ] }, { pxPerMm: K });
  assert.ok(g === null || g.linesV.every(l => l.segs.length === 0));
});

test('originGrip: nooit samenvallend met een AABB-hoek (bij offset 0 één cel naar binnen)', () => {
  const g = buildSysteemraster(rectAnn(1000, 600), { pxPerMm: K });
  // offset 0/0 → grip één cel naar binnen (200, 200) t.o.v. AABB-min (0, 0).
  assert.ok(Math.abs(g.originGrip.x - 200) < 1e-9);
  assert.ok(Math.abs(g.originGrip.y - 200) < 1e-9);
  // Met een echte offset ligt de grip gewoon op de oorsprong zelf.
  const g2 = buildSysteemraster(rectAnn(1000, 600, { originXMm: 500, originYMm: 300 }), { pxPerMm: K });
  assert.ok(Math.abs(g2.originGrip.x - 50) < 1e-9);
  assert.ok(Math.abs(g2.originGrip.y - 30) < 1e-9);
});

test('defaults-object is compleet en consistent met resolve', () => {
  const p = resolveSysteemrasterParams({});
  for (const k of Object.keys(SYSTEEMRASTER_DEFAULTS)) {
    assert.ok(k in p, `resolve mist sleutel ${k}`);
  }
});
