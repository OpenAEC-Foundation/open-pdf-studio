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
  systeemrasterFlatContour,
  flattenContour,
  pointInContour,
  segmentPoint,
  resolveSysteem,
  setPaneelType,
  setPaneelComponent,
  setRandProfiel,
  setEdgeProfiel,
  paneelKey,
  paneelAt,
  subElementAt,
  paneelStijlVoor,
  sparingRegime,
  addSparing,
  removeSparing,
  updateSparing,
  systeemSparingen,
  sparingenToJson,
  sparingenFromJson,
  insetPolygon,
  systeemToOps,
  systeemFromOps,
  copyPointKeepArc,
  rotFor,
  rotToWorld,
  rotToRaster,
  SYSTEEMRASTER_DEFAULTS,
  ARC_FLATTEN_STEPS,
} from '../js/annotations/systeemraster.js';
import {
  createDefaultSysteemTypen,
  migrateSysteemTypen,
  findSysteemType,
  mergeSysteemType,
  updateSysteemTypeIn,
  normalizeSysteemType,
  systeemTypeToJson,
  systeemTypeFromJson,
  duplicateSysteemType,
  removeSysteemTypeFrom,
  typeUsageCount,
  reassignSysteemType,
} from '../js/annotations/systeem-typen.js';

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

// ── boogsegmenten ──────────────────────────────────────────────────────────

// Vierkant 0..10 met de onderrand (segment punt0→punt1) als boog naar
// BUITEN (negatieve bulge: normaal (-dy,dx) wijst bij deze rand naar
// binnen, dus -0.5 buigt naar buiten, voorbij y=0).
function boogAnn(bulge, extra = {}) {
  return {
    type: 'systeemraster',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0, arc: true, bulge },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ],
    ...extra,
  };
}

test('boogsegment-contour: puntentest op de vlakke uitslag', () => {
  const flat = systeemrasterFlatContour(boogAnn(-0.5));
  // Uitslag: 3 rechte nodes + ARC_FLATTEN_STEPS boogstapjes.
  assert.equal(flat.length, 3 + ARC_FLATTEN_STEPS);
  // Punt tussen koorde en boog (buiten het rechte vierkant) is nu BINNEN…
  assert.ok(pointInContour(flat, 5, -1.5));
  // …het middelpunt ook nog…
  assert.ok(pointInContour(flat, 5, 5));
  // …maar ver buiten de boog niet.
  assert.ok(!pointInContour(flat, 5, -4));
  // Zonder boog is het gebied onder y=0 gewoon buiten.
  const recht = systeemrasterFlatContour(boogAnn(0));
  // bulge 0 telt niet als boog? arc:true met bulge 0 → vlakke boog; punt
  // onder de koorde blijft dan buiten.
  assert.ok(!pointInContour(recht, 5, -1.5));
});

test('boogsegment: segmentPoint(t=0,5) ligt op bulge·koorde/2 van de koorde', () => {
  const nodes = systeemrasterContour(boogAnn(-0.5));
  const mid = segmentPoint(nodes, 0, 0.5);
  // Koorde 10, bulge -0.5 → doorzakking = 0.5·10/2 = 2.5 naar buiten (y<0).
  assert.ok(Math.abs(mid.x - 5) < 1e-9);
  assert.ok(Math.abs(mid.y - -2.5) < 1e-9);
});

test('boog telt mee in het raster: AABB en clipping volgen de uitslag', () => {
  const g = buildSysteemraster(boogAnn(-0.5, { plaatBreedteMm: 20, plaatHoogteMm: 20 }), { pxPerMm: K });
  // AABB reikt tot de boogtop (y ≈ -2.5).
  assert.ok(g.contourAabb.y < -2.4);
  assert.ok(g.nodes.length === 4 && g.contour.length > 4);
});

// ── panelen ────────────────────────────────────────────────────────────────

test('paneel-classificatie: binnen (vol), rand (gesneden) en buiten', () => {
  // 1000×600 px, cel 200 px, origin 50 px → 6 kolommen (waarvan de
  // buitenste twee gesneden) × 3 rijen.
  const g = buildSysteemraster(rectAnn(1000, 600, { originXMm: 500 }), { pxPerMm: K });
  assert.equal(g.panels.length, 18);
  const vol = g.panels.filter(p => !p.rand);
  const rand = g.panels.filter(p => p.rand);
  assert.equal(vol.length, 12);
  assert.equal(rand.length, 6);
  // De linkerkolom (ix = -1) is gesneden, kolommen 0..3 zijn vol.
  assert.ok(g.panels.filter(p => p.ix === -1).every(p => p.rand));
  assert.ok(g.panels.filter(p => p.ix === 0).every(p => !p.rand));
  // Exact passend raster: alles vol.
  const g2 = buildSysteemraster(rectAnn(1000, 600), { pxPerMm: K });
  assert.equal(g2.panels.length, 15);
  assert.ok(g2.panels.every(p => !p.rand));
});

test('paneelAt: celindex op positie, buiten de panelen null', () => {
  const g = buildSysteemraster(rectAnn(1000, 600), { pxPerMm: K });
  assert.deepEqual(paneelAt(g, 250, 250), { ix: 1, iy: 1 });
  assert.deepEqual(paneelAt(g, 10, 10), { ix: 0, iy: 0 });
  assert.equal(paneelAt(g, -50, 300), null);
});

test('paneel-overrides: type uit het systeem, default tegel', () => {
  const ann = rectAnn(1000, 600, {
    system: { type: 'plafond', layers: [{
      panels: { '1,1': 'ventilatie', '2,0': 'licht', '9,9': 'kapot-type' },
      edge: { profiel: 'geen' },
    }] },
  });
  const g = buildSysteemraster(ann, { pxPerMm: K });
  const byKey = new Map(g.panels.map(p => [paneelKey(p.ix, p.iy), p]));
  assert.equal(byKey.get('1,1').type, 'ventilatie');
  assert.equal(byKey.get('2,0').type, 'licht');
  assert.equal(byKey.get('0,0').type, 'tegel');
});

test('setPaneelType/setEdgeProfiel: muteren het systeem; tegel wist de override', () => {
  const ann = rectAnn(1000, 600);
  setPaneelType(ann, 2, 1, 'licht');
  setEdgeProfiel(ann, 'hoeklijn');
  assert.equal(resolveSysteem(ann).layers[0].panels['2,1'], 'licht');
  assert.equal(resolveSysteem(ann).layers[0].edge.profiel, 'hoeklijn');
  setPaneelType(ann, 2, 1, 'tegel');
  assert.ok(!('2,1' in resolveSysteem(ann).layers[0].panels));
  // Ongeldig profiel wordt genegeerd.
  setEdgeProfiel(ann, 'onzin');
  assert.equal(resolveSysteem(ann).layers[0].edge.profiel, 'hoeklijn');
});

// ── randprofiel ────────────────────────────────────────────────────────────

test('randprofiel: schaduwvoeg levert een naar binnen gezette contour', () => {
  const ann = rectAnn(1000, 600, {
    system: { type: 'plafond', layers: [{ panels: {}, edge: { profiel: 'schaduwvoeg' } }] },
  });
  const g = buildSysteemraster(ann, { pxPerMm: K });
  assert.equal(g.edgeProfiel, 'schaduwvoeg');
  assert.ok(Array.isArray(g.schaduwvoeg) && g.schaduwvoeg.length === 4);
  // 25 mm inzet bij K=0.1 → 2.5 px, aan alle kanten naar binnen.
  const xs = g.schaduwvoeg.map(p => p.x), ys = g.schaduwvoeg.map(p => p.y);
  assert.ok(Math.abs(Math.min(...xs) - 2.5) < 1e-6);
  assert.ok(Math.abs(Math.max(...xs) - 997.5) < 1e-6);
  assert.ok(Math.abs(Math.min(...ys) - 2.5) < 1e-6);
  // 'geen' en 'hoeklijn': geen schaduwvoeg-polygoon.
  const g2 = buildSysteemraster(rectAnn(1000, 600), { pxPerMm: K });
  assert.equal(g2.edgeProfiel, 'geen');
  assert.equal(g2.schaduwvoeg, null);
});

test('insetPolygon: werkt onafhankelijk van de omloopzin', () => {
  const cw = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
  const inCw = insetPolygon(cw, 1);
  const xs = inCw.map(p => p.x);
  assert.ok(Math.abs(Math.min(...xs) - 1) < 1e-9 && Math.abs(Math.max(...xs) - 9) < 1e-9);
});

// ── persistentie (model → OPS-waarden → model) ─────────────────────────────

test('round-trip: bogen, systeemtype, randprofiel en overrides overleven OPS', () => {
  const ann = boogAnn(-0.4, {
    system: { type: 'plafond', layers: [{
      panels: { '0,0': 'licht', '1,2': 'ventilatie' },
      edge: { profiel: 'schaduwvoeg' },
    }] },
  });
  const ops = systeemToOps(ann);
  assert.equal(ops.hasArcs, true);
  assert.deepEqual(ops.arcFlags, [0, 1, 0, 0]);
  assert.ok(Math.abs(ops.arcBulges[1] - -0.4) < 1e-12);
  assert.equal(ops.sysType, 'plafond');
  assert.equal(ops.edgeProfiel, 'schaduwvoeg');
  assert.ok(typeof ops.panelsJson === 'string');

  // Simuleer heropenen: kale punten uit /Vertices + de OPS-waarden.
  const pts = ann.points.map(p => ({ x: p.x, y: p.y }));
  const sys = systeemFromOps(pts, JSON.parse(JSON.stringify(ops)));
  assert.equal(pts[1].arc, true);
  assert.ok(Math.abs(pts[1].bulge - -0.4) < 1e-12);
  assert.equal(sys.type, 'plafond');
  assert.equal(sys.layers[0].edge.profiel, 'schaduwvoeg');
  assert.deepEqual(sys.layers[0].panels, { '0,0': 'licht', '1,2': 'ventilatie' });

  // En de herbouwde annotatie geeft identieke OPS-waarden (idempotent).
  const ops2 = systeemToOps({ points: pts, system: sys });
  assert.deepEqual(ops2, ops);
});

test('round-trip: kapotte OPS-waarden degraderen stil naar defaults', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const sys = systeemFromOps(pts, {
    arcFlags: [1, 0],           // verkeerde lengte → genegeerd
    panelsJson: '{kapot json',  // parse-fout → geen overrides
    sysType: 'iets-anders',     // onbekend → 'raster'
    edgeProfiel: 'x',           // onbekend → 'geen'
  });
  assert.ok(!pts[0].arc);
  assert.equal(sys.type, 'raster');
  assert.equal(sys.layers[0].edge.profiel, 'geen');
  assert.deepEqual(sys.layers[0].panels, {});
});

test('copyPointKeepArc: hoekpunt verplaatsen behoudt arc/bulge', () => {
  // Regressie: de node-sleep in transforms.js herbouwde points[] met kale
  // {x,y}, waardoor een eerder via de middengrip gebogen segment weer
  // recht werd zodra je daarna een HOEKPUNT versleepte.
  const moved = copyPointKeepArc({ x: 10, y: 0, arc: true, bulge: -0.4 }, 12, 3);
  assert.deepEqual(moved, { x: 12, y: 3, arc: true, bulge: -0.4 });
  // Recht punt blijft kaal (geen zwevende arc-velden).
  assert.deepEqual(copyPointKeepArc({ x: 1, y: 2 }, 5, 6), { x: 5, y: 6 });
  // Hele contour verschoven: beide aangrenzende bogen blijven bestaan.
  const pts = boogAnn(-0.4).points.map(p => copyPointKeepArc(p, p.x + 7, p.y + 7));
  assert.equal(pts[1].arc, true);
  assert.ok(Math.abs(pts[1].bulge - -0.4) < 1e-12);
});

test('bbox: vlakke uitslag omvat de boog-uitstulping (groter dan koorde-bbox)', () => {
  const nodes = systeemrasterContour(boogAnn(-0.5));
  const flat = flattenContour(nodes);
  const bbox = (pts) => ({
    minX: Math.min(...pts.map(p => p.x)), minY: Math.min(...pts.map(p => p.y)),
    maxX: Math.max(...pts.map(p => p.x)), maxY: Math.max(...pts.map(p => p.y)),
  });
  const bN = bbox(nodes), bF = bbox(flat);
  // De boog stulpt onder de koorde uit (y < 0): de vlakke bbox is groter.
  assert.ok(bF.minY < bN.minY - 2);
  assert.ok(Math.abs(bF.minY - -2.5) < 0.05); // sagitta 0.5·10/2 = 2.5
  // Overige zijden ongewijzigd.
  assert.equal(bF.minX, bN.minX);
  assert.equal(bF.maxX, bN.maxX);
  assert.equal(bF.maxY, bN.maxY);
  // En de rastergeometrie clipt óók op die uitslag: er ligt een
  // rasterlijn-segment mét bereik onder y=0 (de boogzone wordt gevuld).
  const g = buildSysteemraster(boogAnn(-0.5, { plaatBreedteMm: 20, plaatHoogteMm: 20 }), { pxPerMm: K });
  assert.ok(g.linesV.some(l => l.segs.some(s => s.a < -0.5)));
});

test('resolveSysteem: default raster zonder system-object', () => {
  const sys = resolveSysteem({});
  assert.equal(sys.type, 'raster');
  assert.equal(sys.layers.length, 1);
  assert.deepEqual(sys.layers[0].panels, {});
  assert.equal(sys.layers[0].edge.profiel, 'geen');
});

// ── systeemtypen (type ≠ instance) ─────────────────────────────────────────

test('systeemtypen: defaults, migratie-round-trip en merge', () => {
  const d = createDefaultSysteemTypen();
  assert.ok(d.typen.length >= 3);
  assert.ok(findSysteemType(d, 'st-plafond-600x600'));
  assert.equal(findSysteemType(d, 'st-plafond-600x600').ifcPredefinedType, 'CEILING');
  // Round-trip door JSON (zoals preferences-opslag): identiek na migratie.
  const rt = migrateSysteemTypen(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(rt, d);
  // Onbruikbare data → verse defaults.
  assert.ok(migrateSysteemTypen(null).typen.length >= 3);
  assert.ok(migrateSysteemTypen({ version: 1, typen: [null, {}] }).typen.length >= 3);
  // Merge van een PDF-meegereisd snapshot: nieuw id komt erbij…
  const vreemd = { id: 'st-x', naam: 'Extern type', celXMm: 450, celYMm: 450 };
  const m = mergeSysteemType(d, vreemd);
  assert.equal(findSysteemType(m, 'st-x').celXMm, 450);
  // …maar een bestaand (lokaal mogelijk bewerkt) id wint.
  const m2 = mergeSysteemType(m, { id: 'st-x', celXMm: 999 });
  assert.equal(findSysteemType(m2, 'st-x').celXMm, 450);
});

test('systeemtypen: type-snapshot JSON round-trip + updateSysteemTypeIn', () => {
  const d = createDefaultSysteemTypen();
  const t = findSysteemType(d, 'st-plafond-600x1200');
  const json = systeemTypeToJson(t);
  assert.deepEqual(systeemTypeFromJson(json), t);
  assert.equal(systeemTypeFromJson('{kapot'), null);
  // Type bewerken (puur): alleen dat type verandert.
  const d2 = updateSysteemTypeIn(d, 'st-plafond-600x1200', { celYMm: 900, edgeProfiel: 'hoeklijn' });
  assert.equal(findSysteemType(d2, 'st-plafond-600x1200').celYMm, 900);
  assert.equal(findSysteemType(d2, 'st-plafond-600x1200').edgeProfiel, 'hoeklijn');
  assert.equal(findSysteemType(d2, 'st-plafond-600x600').celYMm, 600);
});

test('typeDef stuurt celmaat en randprofiel; overrides blijven bij type-wissel', () => {
  const typeA = normalizeSysteemType({ id: 'a', celXMm: 2000, celYMm: 2000, edgeProfiel: 'hoeklijn' });
  const typeB = normalizeSysteemType({ id: 'b', celXMm: 1000, celYMm: 1000, edgeProfiel: 'schaduwvoeg' });
  const ann = rectAnn(1000, 600, {
    system: { type: 'plafond', layers: [{ panels: { '1,1': 'licht' }, edge: { profiel: 'geen' } }] },
  });
  const gA = buildSysteemraster(ann, { pxPerMm: K, typeDef: typeA });
  assert.equal(gA.cellW, 200); // 2000 mm × 0.1
  assert.equal(gA.edgeProfiel, 'hoeklijn');
  assert.equal(gA.panels.find(p => p.ix === 1 && p.iy === 1).type, 'licht');
  // Type wisselen: celmaat/randprofiel volgen het nieuwe type, de
  // paneel-OVERRIDES (instance-data) blijven op hun celindex staan.
  const gB = buildSysteemraster(ann, { pxPerMm: K, typeDef: typeB });
  assert.equal(gB.cellW, 100);
  assert.equal(gB.edgeProfiel, 'schaduwvoeg');
  assert.ok(gB.schaduwvoeg);
  assert.equal(gB.panels.find(p => p.ix === 1 && p.iy === 1).type, 'licht');
});

// ── rasterhoek ─────────────────────────────────────────────────────────────

test('rasterhoek 90°: raster rekent in de gedraaide rasterruimte', () => {
  // Rechthoek 1000×600, cel 200×100. Ongedraaid: 5×6 = 30 panelen.
  const g0 = buildSysteemraster(rectAnn(1000, 600, {
    plaatBreedteMm: 2000, plaatHoogteMm: 1000,
  }), { pxPerMm: K });
  assert.equal(g0.rot, null);
  assert.equal(g0.panels.length, 30);
  // 90° gedraaid: de rasterruimte-contour is 600×1000 → 3×10 = 30 panelen
  // (zelfde vlak, andere celoriëntatie), en rot is gezet.
  const g90 = buildSysteemraster(rectAnn(1000, 600, {
    plaatBreedteMm: 2000, plaatHoogteMm: 1000, rasterHoek: 90,
  }), { pxPerMm: K });
  assert.ok(g90.rot && Math.abs(g90.rot.deg - 90) < 1e-9);
  assert.equal(g90.panels.length, 30);
  // Rasterruimte-AABB is de gedraaide contour (600 breed, 1000 hoog):
  // verticale rasterlijnen (cel 200) → 2 binnenlijnen; horizontaal (cel
  // 100) → 9 binnenlijnen.
  assert.equal(g90.linesV.length, 2);
  assert.equal(g90.linesH.length, 9);
  // De wereld-AABB (/Rect-basis) blijft die van de contour zelf.
  assert.ok(Math.abs(g90.contourAabb.width - 1000) < 1e-9);
  assert.ok(Math.abs(g90.contourAabb.height - 600) < 1e-9);
});

test('rasterhoek: rotToWorld/rotToRaster zijn elkaars inverse; paneelAt is hoek-bewust', () => {
  const g = buildSysteemraster(rectAnn(1000, 600, { rasterHoek: 30 }), { pxPerMm: K });
  assert.ok(g.rot);
  const p = { x: 731, y: 245 };
  const terug = rotToWorld(g.rot, rotToRaster(g.rot, p));
  assert.ok(Math.hypot(terug.x - p.x, terug.y - p.y) < 1e-9);
  // Het contourmidden is rotatie-invariant → paneelAt vindt daar een cel,
  // en wel dezelfde cel als het rasterruimte-punt voorspelt.
  const mid = { x: 500, y: 300 };
  const cel = paneelAt(g, mid.x, mid.y);
  assert.ok(cel);
  const midR = rotToRaster(g.rot, mid);
  const verwacht = g.panels.find(q =>
    midR.x >= q.x && midR.x < q.x + q.w && midR.y >= q.y && midR.y < q.y + q.h);
  assert.deepEqual(cel, { ix: verwacht.ix, iy: verwacht.iy });
});

test('rasterhoek 0/360: geen rot-tak (identiek aan ongedraaid)', () => {
  assert.equal(buildSysteemraster(rectAnn(1000, 600, { rasterHoek: 360 }), { pxPerMm: K }).rot, null);
  assert.equal(rotFor(0, { x: 0, y: 0 }), null);
});

test('typebeheer: nieuw/dupliceren geeft een nieuw stabiel id met dezelfde inhoud', () => {
  const d = createDefaultSysteemTypen();
  const bron = findSysteemType(d, 'st-plafond-600x1200');
  const kopie = duplicateSysteemType(bron);
  assert.notEqual(kopie.id, bron.id);
  assert.ok(/^st-/.test(kopie.id));
  assert.equal(kopie.celXMm, bron.celXMm);
  assert.equal(kopie.celYMm, bron.celYMm);
  assert.equal(kopie.naam, `${bron.naam} (kopie)`);
  // Twee kopieën → twee verschillende id's (stabiel uniek).
  assert.notEqual(duplicateSysteemType(bron).id, kopie.id);
  // Eigen naam meegeven werkt ook (Nieuw-knop).
  assert.equal(duplicateSysteemType(bron, 'Nieuw systeemtype').naam, 'Nieuw systeemtype');
});

test('typebeheer: verwijderen met in-gebruik-detectie + omzetten van instanties', () => {
  const d = createDefaultSysteemTypen();
  const a1 = { type: 'systeemraster', systeemTypeId: 'st-plafond-600x600' };
  const a2 = { type: 'systeemraster', systeemTypeId: 'st-plafond-600x600' };
  const a3 = { type: 'systeemraster', systeemTypeId: 'st-bandraster-300x1200' };
  const anders = { type: 'textbox' };
  const anns = [a1, a2, a3, anders];
  // In-gebruik-detectie telt alleen systeemraster-instanties met dat id.
  assert.equal(typeUsageCount(anns, 'st-plafond-600x600'), 2);
  assert.equal(typeUsageCount(anns, 'st-plafond-600x1200'), 0);
  // Omzetten: verwijzing + IFC volgen het doeltype; ander werk blijft staan.
  const doel = findSysteemType(d, 'st-stelcon-2000x2000');
  const n = reassignSysteemType(anns, 'st-plafond-600x600', doel);
  assert.equal(n, 2);
  assert.equal(a1.systeemTypeId, 'st-stelcon-2000x2000');
  assert.equal(a1.ifcPredefinedType, 'FLOORING');
  assert.equal(a3.systeemTypeId, 'st-bandraster-300x1200');
  assert.equal(typeUsageCount(anns, 'st-plafond-600x600'), 0);
  // Daarna kan het type veilig weg.
  const d2 = removeSysteemTypeFrom(d, 'st-plafond-600x600');
  assert.equal(findSysteemType(d2, 'st-plafond-600x600'), null);
  assert.equal(d2.typen.length, d.typen.length - 1);
  // Het laatste type kan nooit weg.
  let alles = d2;
  for (const t of d2.typen.slice()) alles = removeSysteemTypeFrom(alles, t.id);
  assert.equal(alles.typen.length, 1);
});

// ── sub-element-selectie ───────────────────────────────────────────────────

test('subElementAt: prioriteit rand > rasterlijn > paneel', () => {
  const g = buildSysteemraster(rectAnn(1000, 600), { pxPerMm: K });
  // Op de contour (onderrand, segment 0) — óók vlak bij rasterlijn x=200:
  // de RAND wint.
  const rand = subElementAt(g, 200, 0.5, 2);
  assert.equal(rand.kind, 'rand');
  assert.equal(rand.seg, 0);
  assert.ok(Math.abs(rand.lengthMm - 10000) < 1e-6); // 1000 px / 0.1
  // Binnenin, precies op rasterlijn x=200 → LIJN (verticaal, index 1,
  // positie 2000 mm vanaf de oorsprong).
  const lijn = subElementAt(g, 200, 300, 2);
  assert.deepEqual(lijn, { kind: 'lijn', as: 'v', index: 1, posMm: 2000 });
  // Midden in een cel → PANEEL.
  assert.deepEqual(subElementAt(g, 300, 300, 2), { kind: 'paneel', ix: 1, iy: 1 });
  // Ver buiten alles → null.
  assert.equal(subElementAt(g, -100, -100, 2), null);
});

test('subElementAt: rasterlijn-identificatie op hoek ≠ 0', () => {
  const g = buildSysteemraster(rectAnn(1000, 600, {
    plaatBreedteMm: 2000, plaatHoogteMm: 1000, rasterHoek: 90,
  }), { pxPerMm: K });
  assert.ok(g.rot);
  // Pak een echte verticale rasterlijn in rasterruimte en prik er in de
  // WERELD op (via rotToWorld): zelfde as/index/positie terugkrijgen.
  const l = g.linesV[0];
  const midR = { x: l.x, y: (l.segs[0].a + l.segs[0].b) / 2 };
  const w = rotToWorld(g.rot, midR);
  const sub = subElementAt(g, w.x, w.y, 1.5);
  assert.equal(sub.kind, 'lijn');
  assert.equal(sub.as, 'v');
  assert.equal(sub.index, Math.round((l.x - g.origin.x) / g.cellW));
  assert.ok(Math.abs(sub.posMm - (l.x - g.origin.x) / K) < 1e-6);
});

test('randsegment-overrides: per segment, round-trip door OPS', () => {
  const ann = rectAnn(1000, 600, {
    system: { type: 'plafond', layers: [{ panels: {}, edges: {},
      edge: { profiel: 'schaduwvoeg' } }] },
  });
  setRandProfiel(ann, 0, 'hoeklijn');
  setRandProfiel(ann, 2, 'geen');
  const g = buildSysteemraster(ann, { pxPerMm: K });
  const perSeg = new Map(g.edgeSegs.map(e => [e.seg, e.profiel]));
  assert.equal(perSeg.get(0), 'hoeklijn');   // override
  assert.equal(perSeg.get(1), 'schaduwvoeg'); // basis (instance-edge)
  assert.equal(perSeg.get(2), 'geen');        // override: segment zonder rand
  assert.equal(perSeg.get(3), 'schaduwvoeg');
  // Alleen schaduwvoeg-segmenten hebben een binnenlijn.
  assert.ok(Array.isArray(g.edgeSegs.find(e => e.seg === 1).insetPts));
  assert.equal(g.edgeSegs.find(e => e.seg === 0).insetPts, null);
  // Round-trip door de OPS-waarden.
  const ops = systeemToOps(ann);
  assert.ok(typeof ops.edgesJson === 'string');
  const sys = systeemFromOps(ann.points.map(p => ({ x: p.x, y: p.y })),
    JSON.parse(JSON.stringify(ops)));
  assert.deepEqual(sys.layers[0].edges, { 0: 'hoeklijn', 2: 'geen' });
  // Wissen (Delete op randsegment): override weg → erft weer de basis.
  setRandProfiel(ann, 0, null);
  assert.ok(!('0' in resolveSysteem(ann).layers[0].edges));
});

test('delete-reset: paneel-override (stijl én component) terug naar default', () => {
  const ann = rectAnn(1000, 600);
  setPaneelType(ann, 1, 1, 'ventilatie');
  setPaneelComponent(ann, 2, 1, 'nen1414-Tb01', 'Brandmeldcentrale (BMC)');
  assert.equal(resolveSysteem(ann).layers[0].panels['1,1'], 'ventilatie');
  assert.deepEqual(resolveSysteem(ann).layers[0].panels['2,1'],
    { soort: 'component', symbolId: 'nen1414-Tb01', naam: 'Brandmeldcentrale (BMC)' });
  // Delete = setPaneelType(...,'tegel'): wist óók een component-override.
  setPaneelType(ann, 1, 1, 'tegel');
  setPaneelType(ann, 2, 1, 'tegel');
  assert.deepEqual(resolveSysteem(ann).layers[0].panels, {});
});

// ── component-in-cel ───────────────────────────────────────────────────────

test('component-in-cel: round-trip door OPS en meedraaien met de rasterhoek', () => {
  const ann = rectAnn(1000, 600, { rasterHoek: 30 });
  setPaneelComponent(ann, 1, 1, 'nen1414-Tw01', 'Sprinklerinstallatie (water)');
  const ops = systeemToOps(ann);
  const sys = systeemFromOps(ann.points.map(p => ({ x: p.x, y: p.y })),
    JSON.parse(JSON.stringify(ops)));
  assert.deepEqual(sys.layers[0].panels['1,1'],
    { soort: 'component', symbolId: 'nen1414-Tw01', naam: 'Sprinklerinstallatie (water)' });
  // Geometrie: het paneel draagt de component-info en het CENTRUM van de
  // cel transformeert met de rasterhoek mee (rasterruimte → wereld →
  // paneelAt vindt dezelfde cel terug).
  const g = buildSysteemraster(ann, { pxPerMm: K });
  const p = g.panels.find(q => q.ix === 1 && q.iy === 1);
  assert.equal(p.type, 'component');
  assert.equal(p.component.symbolId, 'nen1414-Tw01');
  const centerWorld = rotToWorld(g.rot, { x: p.x + p.w / 2, y: p.y + p.h / 2 });
  assert.deepEqual(paneelAt(g, centerWorld.x, centerWorld.y), { ix: 1, iy: 1 });
});

test('paneeltype-assortiment als data: renderStijl via typeDef.paneelTypen', () => {
  const typeDef = normalizeSysteemType({
    id: 'x', celXMm: 2000, celYMm: 2000,
    paneelTypen: [
      { id: 'tegel', naam: 'Tegel', renderStijl: 'tegel' },
      { id: 'akoestisch', naam: 'Akoestisch paneel', renderStijl: 'licht' },
    ],
  });
  assert.equal(paneelStijlVoor('akoestisch', typeDef), 'licht');
  assert.equal(paneelStijlVoor('ventilatie', typeDef), 'ventilatie'); // ingebouwd
  assert.equal(paneelStijlVoor('onbekend-id', typeDef), 'tegel');    // degradeert
  // In de geometrie: override met een custom paneeltype-id → stijl volgt
  // het assortiment; het id blijft behouden (round-trip-veilig).
  const ann = rectAnn(1000, 600, {
    system: { type: 'plafond', layers: [{ panels: { '1,1': 'akoestisch' }, edge: { profiel: 'geen' } }] },
  });
  const g = buildSysteemraster(ann, { pxPerMm: K, typeDef });
  const p = g.panels.find(q => q.ix === 1 && q.iy === 1);
  assert.equal(p.type, 'akoestisch');
  assert.equal(p.stijl, 'licht');
  // normalize garandeert dat 'tegel' altijd in het assortiment zit.
  const zonder = normalizeSysteemType({ id: 'y', paneelTypen: [
    { id: 'special', naam: 'S', renderStijl: 'ventilatie' },
  ] });
  assert.ok(zonder.paneelTypen.some(q => q.id === 'tegel'));
});

// ── strook-layout (kanaalplaatvloer) ───────────────────────────────────────

const KANAALPLAAT = normalizeSysteemType({
  id: 'kp', naam: 'Kanaalplaat', layout: 'strook', strookBreedteMm: 1200,
  categorie: 'vloer', ifcCategory: 'IfcSlab', ifcPredefinedType: 'FLOOR',
  sparingRegels: { kleineSparingMaxMm: 400, raveelVanafMm: 800 },
});

test('strook-layout: stroken over de volle overspanning, geen dwarsnaden', () => {
  // Veld 500×300 px = 5000×3000 mm bij K=0.1; strook 1200 mm = 120 px.
  // 5000/1200 = 4 volle stroken + pas van 200 mm.
  const g = buildSysteemraster(rectAnn(500, 300), { pxPerMm: K, typeDef: KANAALPLAAT });
  assert.equal(g.layout, 'strook');
  assert.equal(g.linesH.length, 0);              // geen dwarsnaden
  assert.equal(g.panels.length, 0);              // geen cellen — stroken
  assert.equal(g.stroken.length, 5);
  const vol = g.stroken.filter(s => !s.pas);
  const pas = g.stroken.filter(s => s.pas);
  assert.equal(vol.length, 4);
  assert.equal(pas.length, 1);
  assert.ok(Math.abs(pas[0].breedteMm - 200) < 1e-6);   // pasbreedte
  assert.ok(Math.abs(vol[0].breedteMm - 1200) < 1e-6);
  assert.ok(Math.abs(vol[0].lengteMm - 3000) < 1e-6);   // volle overspanning
  // Pas-markering (dunne dubbele lijn aan de paszijde) aanwezig.
  assert.equal(g.pasLijnen.length, 1);
  // Tweede klik in een strook selecteert die strook.
  const sub = subElementAt(g, 60, 150, 2);
  assert.equal(sub.kind, 'strook');
  assert.equal(sub.index, 0);
  assert.ok(Math.abs(sub.breedteMm - 1200) < 1e-6);
});

// ── sparingen ──────────────────────────────────────────────────────────────

test('sparingsregime: drempels incl. exact op de grens', () => {
  const R = { kleineSparingMaxMm: 400, raveelVanafMm: 800 };
  assert.equal(sparingRegime(300, 200, R, 'strook'), 'klein');
  assert.equal(sparingRegime(400, 100, R, 'strook'), 'klein');     // exact ≤
  assert.equal(sparingRegime(401, 100, R, 'strook'), 'verzwaard');
  assert.equal(sparingRegime(799, 200, R, 'strook'), 'verzwaard');
  assert.equal(sparingRegime(800, 200, R, 'strook'), 'raveel');    // exact ≥
  assert.equal(sparingRegime(200, 900, R, 'strook'), 'raveel');    // grootste zijde
  // Raster-layout: raveel degradeert naar verzwaard (gat + zware rand).
  assert.equal(sparingRegime(900, 900, R, 'raster'), 'verzwaard');
});

test('sparing onderbreekt naden; raveel eindigt op de eerstvolgende naden', () => {
  // Kanaalplaat op 500×300 px; naden op x=120,240,360,480. Sparing 1200×900
  // mm (raveel) op xMm=1300..2500 → px 130..250, yMm 1000..1900 → px 100..190.
  const ann = rectAnn(500, 300, {
    sparingen: [{ id: 'sp1', xMm: 1300, yMm: 1000, bMm: 1200, hMm: 900 }],
  });
  const g = buildSysteemraster(ann, { pxPerMm: K, typeDef: KANAALPLAAT });
  assert.equal(g.sparingen.length, 1);
  assert.equal(g.sparingen[0].regime, 'raveel');
  // De naad op x=240 loopt door de sparing → onderbroken op y 100..190.
  const naad240 = g.linesV.find(l => Math.abs(l.x - 240) < 1e-6);
  assert.equal(naad240.segs.length, 2);
  assert.ok(Math.abs(naad240.segs[0].b - 100) < 1e-6);
  assert.ok(Math.abs(naad240.segs[1].a - 190) < 1e-6);
  // De naad op x=120 raakt de sparing niet (sparing begint op 130).
  const naad120 = g.linesV.find(l => Math.abs(l.x - 120) < 1e-6);
  assert.equal(naad120.segs.length, 1);
  // Raveels: boven en onder de sparing, doorlopend tot de eerstvolgende
  // naad aan weerszijden: links 120 (≤130), rechts 360 (≥250).
  assert.equal(g.raveels.length, 2);
  for (const r of g.raveels) {
    assert.ok(Math.abs(r.x1 - 120) < 1e-6);
    assert.ok(Math.abs(r.x2 - 360) < 1e-6);
  }
  assert.ok(Math.abs(g.raveels[0].y - 100) < 1e-6);
  assert.ok(Math.abs(g.raveels[1].y - 190) < 1e-6);
  // Kleine sparing: geen raveel.
  const ann2 = rectAnn(500, 300, {
    sparingen: [{ id: 'sp2', xMm: 1300, yMm: 1000, bMm: 300, hMm: 300 }],
  });
  const g2 = buildSysteemraster(ann2, { pxPerMm: K, typeDef: KANAALPLAAT });
  assert.equal(g2.sparingen[0].regime, 'klein');
  assert.equal(g2.raveels.length, 0);
});

test('sparing: sub-element-selectie (boven rasterlijn/strook) en beheer-helpers', () => {
  const ann = rectAnn(500, 300, {
    sparingen: [{ id: 'sp1', xMm: 1300, yMm: 1000, bMm: 1000, hMm: 900 }],
  });
  const g = buildSysteemraster(ann, { pxPerMm: K, typeDef: KANAALPLAAT });
  // Klik midden in de sparing — óók op naad-x — selecteert de SPARING.
  const sub = subElementAt(g, 180, 145, 2);
  assert.equal(sub.kind, 'sparing');
  assert.equal(sub.id, 'sp1');
  assert.equal(sub.regime, 'raveel');
  assert.equal(sub.bMm, 1000);
  // updateSparing/removeSparing (Delete) werken op id.
  updateSparing(ann, 'sp1', { bMm: 300, hMm: 300 });
  assert.equal(systeemSparingen(ann)[0].bMm, 300);
  removeSparing(ann, 'sp1');
  assert.equal(systeemSparingen(ann).length, 0);
  // addSparing genereert een id en valideert.
  const sp = addSparing(ann, { xMm: 100, yMm: 100, bMm: 600, hMm: 600 });
  assert.ok(sp && sp.id);
  assert.equal(addSparing(ann, { xMm: 0, yMm: 0, bMm: -5, hMm: 10 }), null);
});

test('sparingen + layout: round-trip door OPS (JSON)', () => {
  const ann = rectAnn(500, 300, {
    sparingen: [
      { id: 'a', xMm: 1300, yMm: 1000, bMm: 1000, hMm: 900 },
      { id: 'b', xMm: 200, yMm: 200, bMm: 300, hMm: 300 },
      { kapot: true },  // ongeldig → valt weg
    ],
  });
  const json = sparingenToJson(ann);
  const terug = sparingenFromJson(json);
  assert.equal(terug.length, 2);
  assert.deepEqual(terug[0], { id: 'a', xMm: 1300, yMm: 1000, bMm: 1000, hMm: 900 });
  // Kapotte JSON degradeert stil naar een lege lijst.
  assert.deepEqual(sparingenFromJson('{kapot'), []);
  // Layout round-tript via het type-snapshot.
  const snap = systeemTypeFromJson(systeemTypeToJson(KANAALPLAAT));
  assert.equal(snap.layout, 'strook');
  assert.equal(snap.strookBreedteMm, 1200);
  assert.deepEqual(snap.sparingRegels, { kleineSparingMaxMm: 400, raveelVanafMm: 800 });
});

test('center: equalize op beide assen centreert het raster (Centreer-knop)', () => {
  const g = buildSysteemraster(rectAnn(1100, 700, {
    originXMm: 700, originYMm: 300, equalizeX: true, equalizeY: true,
  }), { pxPerMm: K });
  assert.ok(Math.abs(g.randMm.links - g.randMm.rechts) < 1e-6);
  assert.ok(Math.abs(g.randMm.boven - g.randMm.onder) < 1e-6);
  assert.ok(g.randMm.links > 0 && g.randMm.boven > 0);
});
