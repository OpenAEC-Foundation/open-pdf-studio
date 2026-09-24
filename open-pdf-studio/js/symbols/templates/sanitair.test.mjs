import assert from 'node:assert/strict';
import test from 'node:test';

import {
  wandclosetTemplate, staandClosetTemplate, fonteinTemplate, hoekfonteinTemplate,
  wandclosetGeometrie, staandClosetGeometrie, fonteinGeometrie, hoekfonteinGeometrie,
  SANITAIR_TEMPLATES,
} from './sanitair.js';
import { coordinaten, spiegelVorm } from './mm-tekening.js';
import { getTemplate, defaultParams } from '../registry.js';
import { ifcCategoryForParametric } from '../../solid/data/ifcCategoryMap.js';

const GEOMETRIE = {
  wandcloset: wandclosetGeometrie,
  'staand-closet': staandClosetGeometrie,
  fontein: fonteinGeometrie,
  hoekfontein: hoekfonteinGeometrie,
};

function binnenPolygoon(p, poly) {
  let binnen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) binnen = !binnen;
  }
  return binnen;
}

test('werkelijke maat: de gangbare standaardmaten', () => {
  assert.deepEqual(wandclosetTemplate.realSizeMm(defaultParams(wandclosetTemplate)), { width: 360, height: 530 });
  assert.deepEqual(staandClosetTemplate.realSizeMm(defaultParams(staandClosetTemplate)), { width: 380, height: 680 });
  assert.deepEqual(fonteinTemplate.realSizeMm(defaultParams(fonteinTemplate)), { width: 380, height: 250 });
  assert.deepEqual(hoekfonteinTemplate.realSizeMm(defaultParams(hoekfonteinTemplate)), { width: 330, height: 330 });
});

test('werkelijke maat volgt de parameters en blijft binnen de grenzen', () => {
  assert.deepEqual(wandclosetTemplate.realSizeMm({ breedte: 400, diepte: 560 }), { width: 400, height: 560 });
  assert.deepEqual(fonteinTemplate.realSizeMm({ breedte: 450, diepte: 300 }), { width: 450, height: 300 });
  // Een half ingetypt getal (3 van 360) geeft geen piepklein symbool.
  const klein = wandclosetTemplate.realSizeMm({ breedte: 3, diepte: 5 });
  assert.ok(klein.width >= 250 && klein.height >= 350, JSON.stringify(klein));
  // Onzin valt terug op de standaard.
  assert.deepEqual(staandClosetTemplate.realSizeMm({ breedte: 'x', diepte: -4 }), { width: 380, height: 680 });
});

test('elke vorm ligt binnen de eigen maat', () => {
  for (const [id, geo] of Object.entries(GEOMETRIE)) {
    for (const params of [{}, { spiegelen: true }, { kraan: 'zijkant' }]) {
      const { maat, vormen } = geo(params);
      assert.ok(vormen.length > 0, `${id}: geen vormen`);
      const { xs, ys } = coordinaten(vormen);
      for (const x of xs) assert.ok(x >= -1e-6 && x <= maat.breedte + 1e-6, `${id}: x=${x}`);
      for (const y of ys) assert.ok(y >= -1e-6 && y <= maat.diepte + 1e-6, `${id}: y=${y}`);
    }
  }
});

test('wandcloset: de pot zit met de volle breedte tegen de wand en loopt uit tot de diepte', () => {
  const { maat, vormen } = wandclosetGeometrie({ breedte: 360, diepte: 530 });
  const pot = vormen[0];
  assert.equal(pot.kind, 'polyline');
  assert.ok(pot.points.some((p) => p.x === 0 && p.y === 0));
  assert.ok(pot.points.some((p) => p.x === 360 && p.y === 0));
  const diepst = Math.max(...pot.points.map((p) => p.y));
  assert.ok(Math.abs(diepst - maat.diepte) < 1e-6, `pot tot ${diepst}`);
  // De brilopening ligt helemaal binnen de pot.
  const bril = vormen[1];
  for (const p of bril.points) assert.ok(binnenPolygoon(p, pot.points), 'bril buiten de pot');
});

test('staand closet: reservoir tegen de wand, pot ervoor, opening binnen de pot', () => {
  const { maat, vormen } = staandClosetGeometrie({});
  const [reservoir, pot, bril] = vormen;
  const resY = reservoir.points.map((p) => p.y);
  assert.equal(Math.min(...resY), 0, 'reservoir tegen de wand');
  const potY = pot.points.map((p) => p.y);
  assert.ok(Math.abs(Math.min(...potY) - Math.max(...resY)) < 1e-6, 'pot sluit aan op het reservoir');
  assert.ok(Math.abs(Math.max(...potY) - maat.diepte) < 1e-6, 'pot loopt tot de diepte');
  for (const p of bril.points) assert.ok(binnenPolygoon(p, pot.points), 'bril buiten de pot');
  assert.ok(vormen.some((v) => v.kind === 'circle'), 'spoelknop op het reservoir');
});

test('fontein: kraan in het midden of opzij, en spiegelen zet hem aan de andere kant', () => {
  const kraan = (params) => fonteinGeometrie(params).vormen.find((v) => v.kind === 'circle' && v.rol === 'kraan');
  assert.equal(kraan({}).cx, 190);
  const opzij = kraan({ kraan: 'zijkant' });
  assert.ok(opzij.cx > 190, 'standaard rechts');
  const gespiegeld = kraan({ kraan: 'zijkant', spiegelen: true });
  assert.ok(Math.abs(gespiegeld.cx - (380 - opzij.cx)) < 1e-9);
  // De kraan staat achter de bak, niet erin.
  const bak = fonteinGeometrie({}).vormen.find((v) => v.rol === 'bak');
  const bakBoven = Math.min(...bak.points.map((p) => p.y));
  assert.ok(kraan({}).cy + kraan({}).r <= bakBoven, 'kraan overlapt de bak');
});

test('spiegelen = elke coördinaat gespiegeld om de middellijn', () => {
  for (const [id, geo] of [['fontein', fonteinGeometrie], ['hoekfontein', hoekfonteinGeometrie]]) {
    const params = id === 'fontein' ? { kraan: 'zijkant' } : {};
    const recht = geo(params);
    const gespiegeld = geo({ ...params, spiegelen: true });
    const verwacht = recht.vormen.map((v) => spiegelVorm(v, recht.maat.breedte));
    assert.deepEqual(gespiegeld.vormen, verwacht, id);
    assert.ok(fonteinTemplate.params.some((p) => p.key === 'spiegelen'));
    assert.ok(hoekfonteinTemplate.params.some((p) => p.key === 'spiegelen'));
  }
});

test('closets zijn symmetrisch: spiegelen verandert niets, dus geen spiegel-parameter', () => {
  for (const [t, geo] of [[wandclosetTemplate, wandclosetGeometrie], [staandClosetTemplate, staandClosetGeometrie]]) {
    const { maat, vormen } = geo({});
    const punten = vormen.flatMap((v) => (v.kind === 'circle' ? [{ x: v.cx, y: v.cy }] : v.points));
    for (const p of punten) {
      const spiegelbeeld = { x: maat.breedte - p.x, y: p.y };
      assert.ok(punten.some((q) => Math.hypot(q.x - spiegelbeeld.x, q.y - spiegelbeeld.y) < 1e-6),
        `${t.id}: geen spiegelbeeld voor (${p.x}, ${p.y})`);
    }
    assert.ok(!t.params.some((p) => p.key === 'spiegelen'), t.id);
  }
});

test('hoekfontein: de hoek ligt linksboven, gespiegeld rechtsboven', () => {
  const contour = (params) => hoekfonteinGeometrie(params).vormen[0].points;
  assert.ok(contour({}).some((p) => p.x === 0 && p.y === 0));
  assert.ok(contour({ spiegelen: true }).some((p) => p.x === 330 && p.y === 0));
  // Wandvlakken: achterkant langs y=0 over de volle breedte, zijkant langs x=0.
  assert.ok(contour({}).some((p) => p.x === 330 && p.y === 0));
  assert.ok(contour({}).some((p) => p.x === 0 && Math.abs(p.y - 330) < 1e-9));
});

test('render: tekencommando\'s in het vak, en een groter vak geeft een grotere tekening', () => {
  for (const t of SANITAIR_TEMPLATES) {
    const p = defaultParams(t);
    const m = t.realSizeMm(p);
    const vak = { x: 50, y: 70, width: m.width * 0.1, height: m.height * 0.1 };
    const cmds = t.render(p, vak);
    assert.ok(cmds.length > 0, t.id);
    for (const c of cmds) {
      const xs = c.kind === 'line' ? [c.x1, c.x2] : c.kind === 'circle' ? [c.cx] : c.kind === 'text' ? [c.x] : c.points.map((q) => q.x);
      const ys = c.kind === 'line' ? [c.y1, c.y2] : c.kind === 'circle' ? [c.cy] : c.kind === 'text' ? [c.y] : c.points.map((q) => q.y);
      for (const x of xs) assert.ok(x >= vak.x - 1e-6 && x <= vak.x + vak.width + 1e-6, `${t.id} x`);
      for (const y of ys) assert.ok(y >= vak.y - 1e-6 && y <= vak.y + vak.height + 1e-6, `${t.id} y`);
    }
    const dubbel = t.render(p, { ...vak, width: vak.width * 2, height: vak.height * 2 });
    const c0 = cmds.find((c) => c.kind === 'polyline');
    const c1 = dubbel.find((c) => c.kind === 'polyline');
    assert.ok(Math.abs((c1.points[1].x - vak.x) - 2 * (c0.points[1].x - vak.x)) < 1e-6, `${t.id} schaalt mee`);
  }
});

test('grepen: een versleept vak wordt de nieuwe maat, afgerond op 10 mm', () => {
  const p = wandclosetTemplate.paramsUitMaat({ breedte: 360, diepte: 530 }, { breedteMm: 412.3, hoogteMm: 548 });
  assert.equal(p.breedte, 410);
  assert.equal(p.diepte, 550);
  const h = hoekfonteinTemplate.paramsUitMaat({ spiegelen: true }, { breedteMm: 301, hoogteMm: 356 });
  assert.deepEqual(h, { spiegelen: true, breedte: 300, diepte: 360 });
});

test('een maatwijziging houdt de wandzijde vast', () => {
  assert.equal(wandclosetTemplate.maatAnker({}), 'back');
  assert.equal(staandClosetTemplate.maatAnker({}), 'back');
  assert.equal(fonteinTemplate.maatAnker({}), 'back');
  assert.equal(hoekfonteinTemplate.maatAnker({}), 'back-left');
  assert.equal(hoekfonteinTemplate.maatAnker({ spiegelen: true }), 'back-right');
});

test('geregistreerd, in de sanitair-categorie en als sanitair toestel voor IFC', () => {
  for (const t of SANITAIR_TEMPLATES) {
    assert.equal(getTemplate(t.id), t, t.id);
    assert.equal(t.category, 'NL Sanitair');
    assert.equal(ifcCategoryForParametric(t.id), 'IfcSanitaryTerminal', t.id);
    assert.ok(t.name && t.nameEn, `${t.id} heeft een NL- en EN-naam`);
  }
  assert.deepEqual(SANITAIR_TEMPLATES.map((t) => t.id), ['wandcloset', 'staand-closet', 'fontein', 'hoekfontein']);
});
