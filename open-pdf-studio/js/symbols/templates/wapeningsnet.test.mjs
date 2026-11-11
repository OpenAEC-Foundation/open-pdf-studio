// Wapeningsnet in plattegrond (#312): netnotatie, staafaantallen, tekening.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wapeningsnetTemplate as tpl, netNotatie, netOnderschrift, netStaven, wapeningsnetLayout,
  wapeningsnetParams, rijLengte,
} from './wapeningsnet.js';
import { defaultParams, getTemplate } from '../registry.js';
import { assertBinnenBbox, teksten } from './binnen-bbox.testhulp.mjs';

const BBOX = { x: 0, y: 0, width: 250, height: 107.5 };

test('geregistreerd, ware maat = netmaat', () => {
  assert.equal(getTemplate('wapeningsnet'), tpl);
  assert.deepEqual(tpl.realSizeMm(defaultParams(tpl)), { width: 5000, height: 2150 });
  assert.equal(tpl.fixedSize, true);
});

test('netnotatie en onderschrift', () => {
  assert.equal(netNotatie({}), 'Ø8-150/Ø8-150');
  assert.equal(netNotatie({ diameterL: 10, afstandL: 100, diameterB: 6, afstandB: 200, aantalNetten: 3 }), '3× Ø10-100/Ø6-200');
  assert.equal(netOnderschrift({ laag: 'boven' }), '5000×2150 boven B500A');
});

test('staafaantallen over lengte en breedte', () => {
  const s = netStaven({ lengte: 5000, breedte: 2150, afstandL: 150, afstandB: 150 });
  assert.deepEqual(s, {
    lengterichting: { aantal: 15, lengteMm: 5000 },
    breedterichting: { aantal: 34, lengteMm: 2150 },
  });
  const items = tpl.rebarItems({ aantalNetten: 2, staafnummerL: '5', staafnummerB: '6' });
  assert.deepEqual(items.map((i) => [i.staafnummer, i.aantal, i.lengteMm, i.diameter, i.staalkwaliteit]), [
    ['5', 30, 5000, 8, 'B500A'],
    ['6', 68, 2150, 8, 'B500A'],
  ]);
});

test('render: omtrek, onderbroken diagonaal, label; bovennet gestreept', () => {
  const onder = tpl.render(defaultParams(tpl), BBOX);
  assertBinnenBbox(onder, BBOX, 'ondernet');
  assert.equal(onder.filter((c) => c.role === 'diagonaal').length, 2, 'diagonaal rond het label onderbroken');
  assert.ok(!onder.some((c) => c.dash));
  assert.ok(teksten(onder).includes('5000×2150 onder B500A'));

  const boven = tpl.render({ ...defaultParams(tpl), laag: 'boven', staafnummerL: '3' }, BBOX);
  assertBinnenBbox(boven, BBOX, 'bovennet');
  assert.ok(boven.filter((c) => c.role === 'diagonaal' || c.role === 'net').every((c) => Array.isArray(c.dash)));
  assert.ok(boven.some((c) => c.role === 'staafnummer' && c.kind === 'text' && c.text === '3'));
});

test('het label past binnen het net, ook bij een smal net', () => {
  for (const p of [{}, { lengte: 1200, breedte: 2000 }, { lengte: 6000, breedte: 300 }]) {
    const L = wapeningsnetLayout(p);
    assert.ok(L.label.hw * 2 <= L.footprint.width, 'labelbreedte');
    assert.ok(L.diagonaal.t0 > 0 && L.diagonaal.t1 < 1);
  }
});

// ── Rij netten met overlap, tekenwijze volgens ISO 3766 ─────────────────────

// Rij van 3 netten 5000×2150 met 300 overlap: 3×5000 − 2×300 = 14400 lang.
const RIJ = { aantalNetten: 3 };
const RIJ_BBOX = { x: 10, y: 20, width: 720, height: 107.5 }; // schaal 1:20
const RX = (mm) => RIJ_BBOX.x + mm / 20;
const bijna = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('param overlap: standaard 300, minimaal 0, ontbreekt in oude symbolen', () => {
  const def = tpl.params.find((q) => q.key === 'overlap');
  assert.ok(def, 'param overlap bestaat');
  assert.equal(def.default, 300);
  assert.equal(def.min, 0);
  assert.equal(wapeningsnetParams({}).overlap, 300);
  assert.equal(wapeningsnetParams({ lengte: 5000, aantalNetten: 2 }).overlap, 300, 'opgeslagen symbool zonder overlap');
  assert.equal(wapeningsnetParams({ overlap: 0 }).overlap, 0);
  assert.equal(wapeningsnetParams({ overlap: -50 }).overlap, 300);
  assert.equal(wapeningsnetParams({ overlap: '450' }).overlap, 450);
});

test('rijlengte = aantal × lengte − (aantal − 1) × overlap; ware maat volgt de rij', () => {
  assert.equal(rijLengte({}), 5000);
  assert.equal(rijLengte(RIJ), 14400);
  assert.equal(rijLengte({ aantalNetten: 2, lengte: 4000, overlap: 0 }), 8000);
  assert.equal(rijLengte({ aantalNetten: 4, lengte: 6000, overlap: 450 }), 22650);
  assert.deepEqual(tpl.realSizeMm(RIJ), { width: 14400, height: 2150 });
  assert.deepEqual(wapeningsnetLayout(RIJ).footprint, { width: 14400, height: 2150 });
});

test('één net: omtrek, één diagonaal en een haaks streepje aan het begin (linksonder)', () => {
  const cmds = tpl.render(defaultParams(tpl), BBOX);
  assertBinnenBbox(cmds, BBOX, 'één net');
  assert.equal(cmds.filter((c) => c.role === 'net').length, 1);
  assert.equal(cmds.filter((c) => c.role === 'overlap').length, 0);
  const streep = cmds.filter((c) => c.role === 'beginstreep');
  assert.equal(streep.length, 1);
  const s = streep[0];
  assert.equal(s.kind, 'line');
  // Haaks op de diagonaal (linksonder → rechtsboven).
  bijna((s.x2 - s.x1) * BBOX.width - (s.y2 - s.y1) * BBOX.height, 0);
  // Het midden ligt op de diagonaal, dicht bij de hoek linksonder en vóór het label.
  const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
  const t = (mx - BBOX.x) / BBOX.width;
  bijna(my, BBOX.y + BBOX.height - t * BBOX.height);
  const eerste = cmds.find((c) => c.role === 'diagonaal');
  assert.ok(t > 0 && mx < eerste.x2, 'streepje op het eerste diagonaaldeel');
  assert.ok(t < 0.2, 'streepje bij het begin van de diagonaal');
  const lengte = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  assert.ok(lengte > 1 && lengte < BBOX.height * 0.25, 'kort streepje');
});

test('rij: omtrek van de hele rij en één doorgaande, onderbroken diagonaal', () => {
  const cmds = tpl.render(RIJ, RIJ_BBOX);
  assertBinnenBbox(cmds, RIJ_BBOX, 'rij');
  const omtrek = cmds.filter((c) => c.role === 'net');
  assert.equal(omtrek.length, 1, 'één omtrek voor de hele rij');
  const xs = omtrek[0].points.map((q) => q.x), ys = omtrek[0].points.map((q) => q.y);
  bijna(Math.min(...xs), RX(0)); bijna(Math.max(...xs), RX(14400));
  bijna(Math.min(...ys), RIJ_BBOX.y); bijna(Math.max(...ys), RIJ_BBOX.y + RIJ_BBOX.height);
  const d = cmds.filter((c) => c.role === 'diagonaal');
  assert.equal(d.length, 2, 'diagonaal alleen rond het label onderbroken');
  bijna(d[0].x1, RX(0)); bijna(d[0].y1, RIJ_BBOX.y + RIJ_BBOX.height);
  bijna(d[1].x2, RX(14400)); bijna(d[1].y2, RIJ_BBOX.y);
  // Beide delen liggen op dezelfde lijn hoek → hoek.
  for (const l of d) {
    for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
      const t = (x - RIJ_BBOX.x) / RIJ_BBOX.width;
      bijna(y, RIJ_BBOX.y + RIJ_BBOX.height * (1 - t));
    }
  }
  assert.equal(cmds.filter((c) => c.role === 'beginstreep').length, 1);
});

test('rij: op elke overlap twee evenwijdige lijnen over de volle breedte', () => {
  const cmds = tpl.render(RIJ, RIJ_BBOX);
  const o = cmds.filter((c) => c.role === 'overlap');
  assert.equal(o.length, 4, '2 overlappen × 2 lijnen');
  for (const l of o) {
    assert.equal(l.kind, 'line');
    bijna(l.x1, l.x2);
    bijna(Math.min(l.y1, l.y2), RIJ_BBOX.y);
    bijna(Math.max(l.y1, l.y2), RIJ_BBOX.y + RIJ_BBOX.height);
  }
  // Net 2 begint op 4700 en net 1 eindigt op 5000; net 3 begint op 9400, net 2 eindigt op 9700.
  const xs = o.map((l) => l.x1).sort((a, b) => a - b);
  [4700, 5000, 9400, 9700].forEach((mm, i) => bijna(xs[i], RX(mm)));

  // Zonder overlap vallen de randen samen: één lijn per naad.
  const stuik = tpl.render({ aantalNetten: 3, overlap: 0 }, { x: 0, y: 0, width: 750, height: 107.5 });
  const xs0 = stuik.filter((c) => c.role === 'overlap').map((l) => l.x1).sort((a, b) => a - b);
  assert.equal(xs0.length, 2);
  bijna(xs0[0], 250); bijna(xs0[1], 500);
});

test('rij: tekst "aantal× nettype" met onderschrift, midden op de diagonaal', () => {
  const L = wapeningsnetLayout(RIJ);
  assert.equal(L.r1, '3× Ø8-150/Ø8-150');
  assert.equal(L.r2, '5000×2150 onder B500A');
  assert.equal(L.label.cx, 7200);
  assert.equal(L.label.cy, 1075);
  assert.ok(L.diagonaal.t0 > 0 && L.diagonaal.t0 < 0.5 && L.diagonaal.t1 > 0.5 && L.diagonaal.t1 < 1);
  const cmds = tpl.render(RIJ, RIJ_BBOX);
  assert.ok(teksten(cmds).includes('3× '), 'aantal vóór het nettype');
  const onder = cmds.find((c) => c.role === 'onderschrift');
  assert.equal(onder.text, '5000×2150 onder B500A');
  bijna(onder.x, RX(7200));
  const label = cmds.filter((c) => c.role === 'label');
  assert.ok(label.length > 0 && label.every((c) => c.y < onder.y), 'onderschrift onder de netnotatie');
});

test('rij: bovennet gestreept, ook de overlaplijnen', () => {
  const boven = tpl.render({ ...RIJ, laag: 'boven' }, RIJ_BBOX);
  const lijnen = boven.filter((c) => ['net', 'diagonaal', 'overlap'].includes(c.role));
  assert.equal(lijnen.length, 7);
  assert.ok(lijnen.every((c) => Array.isArray(c.dash)));
  const onder = tpl.render(RIJ, RIJ_BBOX);
  assert.ok(!onder.some((c) => c.dash));
});

test('rij: snappunten volgen de omtrek van de hele rij', () => {
  const snaps = tpl.snapPoints(RIJ, RIJ_BBOX);
  const omtrek = tpl.render(RIJ, RIJ_BBOX).find((c) => c.role === 'net');
  const hoeken = snaps.filter((s) => s.kind === 'endpoint');
  bijna(Math.max(...omtrek.points.map((q) => q.x)), RX(14400));
  for (const q of omtrek.points) {
    assert.ok(hoeken.some((s) => Math.abs(s.x - q.x) < 1e-6 && Math.abs(s.y - q.y) < 1e-6), 'hoek van de rij is snappunt');
  }
  const midden = snaps.find((s) => s.kind === 'center');
  bijna(midden.x, RX(7200)); bijna(midden.y, RIJ_BBOX.y + RIJ_BBOX.height / 2);
});

test('hoeveelheden: per net dezelfde staven, × het aantal netten (overlap telt niet mee)', () => {
  const een = netStaven({});
  for (const overlap of [0, 300, 600]) {
    assert.deepEqual(netStaven({ aantalNetten: 3, overlap }), een);
    const items = tpl.rebarItems({ aantalNetten: 3, overlap });
    assert.deepEqual(items.map((i) => [i.aantal, i.lengteMm]), [[45, 5000], [102, 2150]]);
  }
});

test('rij: label en streepje passen, ook bij smalle of korte netten', () => {
  for (const p of [
    { aantalNetten: 2, lengte: 1200, breedte: 2000 },
    { aantalNetten: 6, lengte: 6000, breedte: 300 },
    { aantalNetten: 2, lengte: 400, breedte: 3000, overlap: 100 },
  ]) {
    const L = wapeningsnetLayout(p);
    assert.ok(L.label.hw * 2 <= L.footprint.width, 'labelbreedte');
    assert.ok(L.diagonaal.t0 > 0 && L.diagonaal.t1 < 1);
    const { width, height } = tpl.realSizeMm(p);
    const bbox = { x: 0, y: 0, width: width / 20, height: height / 20 };
    const cmds = tpl.render(p, bbox);
    assertBinnenBbox(cmds, bbox, JSON.stringify(p));
    assert.equal(cmds.filter((c) => c.role === 'beginstreep').length, 1);
  }
});

test('een overlaplijn die door het label zou lopen wordt daar onderbroken', () => {
  // Twee netten: de overlap ligt midden in de rij, precies waar het label staat.
  const params = { aantalNetten: 2, lengte: 5000, breedte: 2150, overlap: 300 };
  const L = wapeningsnetLayout(params);
  const cmds = tpl.render(params, { x: 0, y: 0, width: L.footprint.width, height: L.footprint.height });
  const randen = cmds.filter((c) => c.role === 'overlap');
  assert.equal(randen.length, 4, 'elke netrand in twee delen: boven en onder het label');
  for (const r of randen) {
    const [boven, onder] = [Math.min(r.y1, r.y2), Math.max(r.y1, r.y2)];
    assert.ok(onder <= L.label.cy - L.label.hh + 1e-6 || boven >= L.label.cy + L.label.hh - 1e-6, 'geen lijn door het label');
  }
  // Drie netten: de overlappen liggen naast het label en blijven heel.
  const drie = { ...params, aantalNetten: 3 };
  const L3 = wapeningsnetLayout(drie);
  const c3 = tpl.render(drie, { x: 0, y: 0, width: L3.footprint.width, height: L3.footprint.height });
  assert.equal(c3.filter((c) => c.role === 'overlap').length, 4);
});
