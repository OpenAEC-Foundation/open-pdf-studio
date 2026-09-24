import assert from 'node:assert/strict';
import test from 'node:test';

import { indeling } from './indeling.js';
import {
  elementMaat, tekenOpdrachten, paneelVormen, onderdeelVlak, arceerRechthoek, boogPunten,
  vakAfbeelding, vakNaarPagina, langsElement, puntOpElement, vormenNaarOpdrachten,
} from './weergave.js';
import { registreerPaneelType, registreerStijlType } from './catalogus.js';

const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

// 0,1 pt per mm: 3600 mm = 360 pt, diepte 150 mm = 15 pt.
const K = 0.1;
const PARAMS = {
  lengte: 3600,
  stijlen: [{ pos: 1200 }, { pos: 2400 }],
  panelen: ['glas', 'dicht', 'open'],
};
const vak = (params, preset = 'vliesgevel') => {
  const m = elementMaat(params, preset);
  return { x: 100, y: 200 - (m.bandMm * K) / 2, width: m.lengteMm * K, height: m.bandMm * K };
};

test('maten: lengte, diepte en een vak dat ook de draaicirkel omvat', () => {
  assert.deepEqual(elementMaat(PARAMS, 'vliesgevel'), { lengteMm: 3600, diepteMm: 150, bandMm: 150 });
  const metDeur = elementMaat({ ...PARAMS, panelen: ['glas', 'deur', 'glas'] }, 'vliesgevel');
  assert.equal(metDeur.bandMm, 150 + 2 * 1150, 'de deur (dag 1150) zwaait naar beide kanten binnen het vak');
  assert.equal(elementMaat({}, 'kozijn').diepteMm, 114);
});

test('stijlen: gevulde rechthoeken op werkelijke maat, op de elementlijn gecentreerd', () => {
  const b = vak(PARAMS);
  const cmds = tekenOpdrachten(PARAMS, 'vliesgevel', b);
  const stijlen = cmds.filter((c) => c.kind === 'polyline' && c.fill === true);
  assert.equal(stijlen.length, 4);
  const xs = (c) => c.points.map((p) => p.x), ys = (c) => c.points.map((p) => p.y);
  // Tussenstijl 1: hart 1200 mm → x 220, 50 mm breed = 5 pt, 150 mm diep = 15 pt.
  const s1 = stijlen[1];
  bijna(Math.min(...xs(s1)), 100 + 117.5, 1e-9, 'links');
  bijna(Math.max(...xs(s1)), 100 + 122.5, 1e-9, 'rechts');
  bijna(Math.min(...ys(s1)), 200 - 7.5, 1e-9, 'boven');
  bijna(Math.max(...ys(s1)), 200 + 7.5, 1e-9, 'onder');
  // Het kader ligt tegen de uiteinden.
  bijna(Math.min(...xs(stijlen[0])), 100, 1e-9, 'beginkader');
  bijna(Math.max(...xs(stijlen[3])), 460, 1e-9, 'eindkader');
});

test('glas: een dubbele dunne lijn van stijlvlak tot stijlvlak', () => {
  const b = vak(PARAMS);
  const lay = indeling(PARAMS, 'vliesgevel');
  const cmds = vormenNaarOpdrachten(paneelVormen(lay, lay.velden[0]), vakAfbeelding(lay, b));
  assert.equal(cmds.length, 2);
  for (const c of cmds) {
    assert.equal(c.kind, 'line');
    bijna(c.x1, 105, 1e-9, 'van het beginkader');
    bijna(c.x2, 217.5, 1e-9, 'tot stijl 1');
  }
  bijna(Math.abs(cmds[0].y1 - cmds[1].y1), 3.2, 1e-9, 'twee lijnen 32 mm uit elkaar');
  bijna((cmds[0].y1 + cmds[1].y1) / 2, 200, 1e-9, 'op de elementlijn');
});

test('dicht paneel: omtrek plus arcering binnen de omtrek; open veld: niets', () => {
  const lay = indeling(PARAMS, 'vliesgevel');
  const dicht = paneelVormen(lay, lay.velden[1]);
  assert.equal(dicht[0].soort, 'vlak');
  const arcering = dicht.filter((f) => f.rol === 'arcering');
  assert.ok(arcering.length > 5, 'gearceerd');
  for (const f of arcering) {
    for (const p of [f.van, f.tot]) {
      assert.ok(p.u >= lay.velden[1].dagVanMm - 1e-9 && p.u <= lay.velden[1].dagTotMm + 1e-9);
      assert.ok(p.v >= 45 - 1e-9 && p.v <= 105 + 1e-9, 'binnen de paneeldikte (60 mm om het hart)');
    }
  }
  assert.deepEqual(paneelVormen(lay, lay.velden[2]), []);
});

test('deur: blad op 90° vanaf het scharnier, boog van dicht naar open', () => {
  const params = { ...PARAMS, panelen: ['glas', { type: 'deur', scharnier: 'begin', draaiNaar: 'binnen' }, 'glas'] };
  const lay = indeling(params, 'vliesgevel');
  const v = lay.velden[1];                              // dag 1225 .. 2375 = 1150
  const [boog, blad] = paneelVormen(lay, v);
  assert.equal(boog.soort, 'boog');
  assert.deepEqual(boog.midden, { u: 1225, v: 150 }, 'scharnier op het binnenvlak aan de beginkant');
  assert.equal(boog.straal, 1150);
  assert.equal(boog.vanRad, 0);
  bijna(boog.totRad, Math.PI / 2, 1e-12, 'naar binnen (+v)');
  assert.equal(blad.soort, 'vlak');
  assert.ok(blad.punten.some((p) => p.v === 150 + 1150), 'het blad staat haaks, zo lang als de dag');
  // Scharnier aan het eind, naar buiten: boog van π naar 3π/2.
  const omg = indeling({ ...params, panelen: ['glas', { type: 'deur', scharnier: 'eind', draaiNaar: 'buiten' }, 'glas'] }, 'vliesgevel');
  const [b2] = paneelVormen(omg, omg.velden[1]);
  assert.deepEqual(b2.midden, { u: 2375, v: 0 });
  assert.equal(b2.vanRad, Math.PI);
  bijna(b2.totRad, 1.5 * Math.PI, 1e-12, 'naar buiten (-v)');
  // Getekend: de boog als polylijn die op het scharnier-middelpunt straal houdt.
  const b = vak(params);
  const afb = vakAfbeelding(lay, b);
  const [cBoog] = vormenNaarOpdrachten([boog], afb);
  const m = afb.punt(1225, 150);
  for (const p of cBoog.points) bijna(Math.hypot(p.x - m.x, p.y - m.y), 115, 1e-9, 'straal');
  assert.ok(cBoog.points.every((p) => p.y >= m.y - 1e-9), 'binnen = rechts van de tekenrichting = +y');
});

test('deur in alle vier standen: een kwartcirkel van dicht naar open', () => {
  for (const scharnier of ['begin', 'eind']) {
    for (const draaiNaar of ['binnen', 'buiten']) {
      const lay = indeling({ ...PARAMS, panelen: ['glas', { type: 'deur', scharnier, draaiNaar }, 'glas'] }, 'vliesgevel');
      const v = lay.velden[1];
      const [boog] = paneelVormen(lay, v);
      // Door de afbeelding met k = 1 en het vak op de oorsprong: x = u, y = v - D/2.
      const [c] = vormenNaarOpdrachten([boog], vakAfbeelding(lay, { x: 0, y: -lay.diepteMm / 2, width: lay.lengteMm, height: lay.diepteMm }));
      const eerste = c.points[0], laatste = c.points[c.points.length - 1];
      const uh = scharnier === 'begin' ? v.dagVanMm : v.dagTotMm;
      const vh = (draaiNaar === 'binnen' ? lay.diepteMm : 0) - lay.diepteMm / 2;
      bijna(eerste.x, scharnier === 'begin' ? v.dagTotMm : v.dagVanMm, 1e-6, `${scharnier}/${draaiNaar}: dicht op de andere dagkant`);
      bijna(eerste.y, vh, 1e-6, `${scharnier}/${draaiNaar}: dicht in het vlak`);
      bijna(laatste.x, uh, 1e-6, `${scharnier}/${draaiNaar}: open haaks op het scharnier`);
      bijna(laatste.y, vh + (draaiNaar === 'binnen' ? 1 : -1) * v.dagMm, 1e-6, `${scharnier}/${draaiNaar}: naar de juiste kant`);
      const midden = c.points[Math.floor(c.points.length / 2)];
      bijna(Math.hypot(midden.x - uh, midden.y - vh), v.dagMm, 1e-6, `${scharnier}/${draaiNaar}: kwartcirkel, geen driekwart`);
      assert.ok((midden.y - vh) * (draaiNaar === 'binnen' ? 1 : -1) > 0, `${scharnier}/${draaiNaar}: boog aan de draaikant`);
    }
  }
});

test('draairaam (kozijn): glas plus gestreepte draaicirkel', () => {
  const lay = indeling({ lengte: 1800, panelen: ['draairaam', 'glas'] }, 'kozijn');
  const vormen = paneelVormen(lay, lay.velden[0]);
  assert.equal(vormen.filter((f) => f.rol === 'glas').length, 2);
  const boog = vormen.find((f) => f.soort === 'boog');
  assert.deepEqual(boog.streep, [3, 2]);
  const cmds = vormenNaarOpdrachten(vormen, vakAfbeelding(lay, { x: 0, y: 0, width: 180, height: 100 }));
  assert.ok(cmds.some((c) => c.kind === 'polyline' && Array.isArray(c.dash)));
});

test('binnenzijde links spiegelt de dwarsrichting', () => {
  const rechts = indeling({ ...PARAMS, panelen: ['deur', 'glas', 'glas'] }, 'vliesgevel');
  const links = indeling({ ...PARAMS, panelen: ['deur', 'glas', 'glas'], binnenzijde: 'links' }, 'vliesgevel');
  const b = { x: 0, y: -50, width: 360, height: 100 };
  const pr = vakAfbeelding(rechts, b).punt(0, 150), pl = vakAfbeelding(links, b).punt(0, 150);
  bijna(pr.y, 7.5, 1e-9, 'binnenvlak rechts');
  bijna(pl.y, -7.5, 1e-9, 'binnenvlak links');
});

test('uitbreidingen: een eigen stijlcontour en eigen paneelvormen worden getekend', () => {
  registreerStijlType({
    id: 'test-sponning', naam: 'Sponning', breedteMm: 60, diepteMm: 100, presets: ['kozijn'],
    contour: () => [{ u: -30, v: 0 }, { u: 30, v: 0 }, { u: 30, v: 100 }, { u: 0, v: 100 }, { u: 0, v: 80 }, { u: -30, v: 80 }],
  });
  registreerPaneelType({
    id: 'test-kruis', naam: 'Kruis', presets: ['kozijn'],
    vormen: ({ vanU, totU, diepteMm }) => [{ soort: 'lijn', van: { u: vanU, v: 0 }, tot: { u: totU, v: diepteMm } }],
  });
  const params = { lengte: 1200, kader: ['test-sponning', 'test-sponning'], stijlen: [], panelen: ['test-kruis'] };
  const cmds = tekenOpdrachten(params, 'kozijn', { x: 0, y: 0, width: 120, height: 10 });
  const stijl = cmds.find((c) => c.fill === true);
  assert.equal(stijl.points.length, 6, 'de contour van het type, niet de rechthoek');
  assert.equal(cmds.filter((c) => c.kind === 'line').length, 1, 'de vormen van het paneeltype');
});

test('onderdeelvlak voor het oplichten van de selectie', () => {
  const b = vak(PARAMS);
  const stijl = onderdeelVlak(PARAMS, 'vliesgevel', b, { soort: 'stijl', index: 2 });
  assert.equal(stijl.length, 4);
  bijna(stijl[0].x, 100 + 237.5, 1e-9, 'stijl 2 links');
  bijna(stijl[1].x, 100 + 242.5, 1e-9, 'stijl 2 rechts');
  const paneel = onderdeelVlak(PARAMS, 'vliesgevel', b, { soort: 'paneel', index: 0 });
  bijna(paneel[0].x, 105, 1e-9, 'dag van veld 0');
  bijna(paneel[1].x, 217.5, 1e-9, 'tot stijl 1');
  assert.equal(onderdeelVlak(PARAMS, 'vliesgevel', b, { soort: 'paneel', index: 5 }), null);
});

test('omrekenen tussen paginapunten en de assen van het element', () => {
  const lijn = { startX: 0, startY: 0, endX: 0, endY: 360 };        // omlaag getekend
  const r = langsElement(lijn, 3600, { x: -10, y: 120 });
  bijna(r.uMm, 1200, 1e-9, 'langs');
  bijna(r.dMm, 100, 1e-9, 'rechts van omlaag is -x');
  assert.deepEqual(puntOpElement(lijn, 3600, 1800), { x: 0, y: 180 });
  const p = vakNaarPagina({ x: 0, y: 0, width: 20, height: 10 }, 90, { x: 20, y: 5 });
  bijna(p.x, 10, 1e-9, 'draaiing om het vakmidden');
  bijna(p.y, 15, 1e-9, 'draaiing om het vakmidden');
});

test('hulpgeometrie: arcering en boogpunten', () => {
  const lijnen = arceerRechthoek(0, 100, 0, 10, 10);
  assert.ok(lijnen.length >= 10);
  for (const [a, b] of lijnen) bijna(b.u - a.u, b.v - a.v, 1e-9, '45°');
  assert.deepEqual(arceerRechthoek(0, 0, 0, 10, 5), []);
  const boog = boogPunten({ u: 0, v: 0 }, 2, 0, Math.PI / 2, 4);
  assert.equal(boog.length, 5);
  bijna(boog[4].u, 0, 1e-12, 'eindpunt');
  bijna(boog[4].v, 2, 1e-12, 'eindpunt');
});
