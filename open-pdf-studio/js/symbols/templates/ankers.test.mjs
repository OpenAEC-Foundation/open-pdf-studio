// Parametrisch anker in beton: alle typen en maten, standaardwaarden,
// werkelijke maat = getekende omvang, snappunten en typespecifieke delen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ankerTemplate, ankerParams, ankerGeometrie, ANKER_TYPEN, ANKER_MATEN, HEF_STANDAARD, boorgatChemisch,
} from './ankers.js';
import { BOUT_MATEN, zeskantHoekmaat } from './bout.js';
import { getTemplate } from '../registry.js';
import { NL_CATEGORIES } from '../../solid/data/nlSymbolLibrary.js';
import { puntenVan, assertBinnenBbox } from './binnen-bbox.testhulp.mjs';

const TYPEN = ANKER_TYPEN.map((t) => t.value);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b}`);

function omvang(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cmds) {
    for (const [x, y] of puntenVan(c)) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function teken(p, k = 2) {
  const mm = ankerTemplate.realSizeMm(p);
  const bbox = { x: 13, y: 7, width: mm.width * k, height: mm.height * k };
  return { mm, bbox, cmds: ankerTemplate.render(p, bbox) };
}

test('geregistreerd, in het palet en met de verwachte parameters', () => {
  assert.equal(getTemplate('anker'), ankerTemplate);
  const cat = NL_CATEGORIES.find((c) => c.id === 'nl-ifc-bouw');
  assert.ok(cat.symbols.some((s) => s.parametricId === 'anker'));
  const p = Object.fromEntries(ankerTemplate.params.map((q) => [q.key, q.default]));
  assert.deepEqual(p, {
    type: 'stort-moer', maat: 'M16', aanzicht: 'zij', hef: 0, plaatDikte: 10,
    uitsteek: 0, haakLengte: 0, betonArcering: true, schaal: 1,
  });
  assert.deepEqual(ANKER_MATEN, ['M8', 'M10', 'M12', 'M16', 'M20', 'M22', 'M24']);
  assert.deepEqual(TYPEN, ['stort-moer', 'stort-plaat', 'stort-L', 'stort-J', 'chemisch', 'keil', 'kopbout']);
});

test('standaardwaarden: hef per familie, uitsteek en haaklengte', () => {
  for (const maat of ANKER_MATEN) {
    const g = BOUT_MATEN[maat];
    assert.equal(ankerParams({ maat, type: 'chemisch' }).hef, HEF_STANDAARD.chemisch[maat]);
    assert.equal(ankerParams({ maat, type: 'keil' }).hef, HEF_STANDAARD.keil[maat]);
    assert.equal(ankerParams({ maat, type: 'stort-L' }).hef, HEF_STANDAARD.stort[maat]);
    const q = ankerParams({ maat, type: 'chemisch', plaatDikte: 12 });
    near(q.uitsteek, 12 + g.ringT + g.m + 0.6 * g.d, 1e-9, `${maat} uitsteek auto`);
    assert.equal(ankerParams({ maat, type: 'stort-L' }).haakLengte, 4 * g.d);
    assert.equal(ankerParams({ maat, type: 'stort-J' }).haakLengte, 3 * g.d);
  }
  // Opgegeven waarden tellen, maar nooit kleiner dan tekenbaar.
  assert.equal(ankerParams({ maat: 'M12', type: 'chemisch', hef: 150 }).hef, 150);
  assert.equal(ankerParams({ maat: 'M12', type: 'chemisch', hef: 10 }).hef, 48);
  assert.equal(ankerParams({ maat: 'M12', type: 'chemisch', uitsteek: 200 }).uitsteek, 200);
  near(ankerParams({ maat: 'M12', type: 'chemisch', uitsteek: 5 }).uitsteek, 10 + 2.5 + 10 + 7.2, 1e-9, 'uitsteek minimaal');
  assert.equal(ankerParams({ maat: 'M12', type: 'kopbout' }).uitsteek, 0);
  // Onbekende waarden vallen terug.
  const q = ankerParams({ maat: 'M6', type: 'x', aanzicht: 'y' });
  assert.equal(q.maat, 'M16');
  assert.equal(q.type, 'stort-moer');
  assert.equal(q.aanzicht, 'zij');
});

test('boorgaten: chemisch d + 2 / d + 4, keilbout d', () => {
  assert.equal(boorgatChemisch(12), 14);
  assert.equal(boorgatChemisch(16), 18);
  assert.equal(boorgatChemisch(20), 24);
  assert.equal(ankerGeometrie({ maat: 'M12', type: 'chemisch' }).d0, 14);
  assert.equal(ankerGeometrie({ maat: 'M12', type: 'keil' }).d0, 12);
});

test('realSizeMm = getekende omvang, alles binnen de bbox (alle typen, maten, aanzichten)', () => {
  for (const maat of ANKER_MATEN) {
    for (const type of TYPEN) {
      for (const aanzicht of ['zij', 'boven']) {
        for (const extra of [{}, { plaatDikte: 0, betonArcering: false }, { hef: 400, uitsteek: 120, haakLengte: 90 }]) {
          const p = { maat, type, aanzicht, ...extra };
          const naam = `${maat} ${type} ${aanzicht} ${JSON.stringify(extra)}`;
          const { bbox, cmds } = teken(p);
          assertBinnenBbox(cmds, bbox, naam);
          const o = omvang(cmds);
          if (aanzicht === 'boven') {
            // Bovenaanzicht: zeskant met de hoeken links/rechts (hoogte s),
            // ring of kop rond; het geheel ligt gecentreerd in de bbox.
            const g = BOUT_MATEN[maat];
            const kop = type === 'kopbout';
            const h = (kop ? 2 * g.d : Math.max(g.s, g.ringD)) * 2;
            near(o.width, bbox.width, 1e-6, `${naam} breedte`);
            near(o.height, h, 1e-6, `${naam} hoogte`);
            near(o.y, bbox.y + (bbox.height - h) / 2, 1e-6, `${naam} boven`);
            continue;
          }
          const tol = 1e-6;
          near(o.x, bbox.x, tol, `${naam} links`);
          near(o.width, bbox.width, tol, `${naam} breedte`);
          near(o.y, bbox.y, tol, `${naam} boven`);
          // Zonder arcering eindigt de tekening bij het diepste deel.
          if (extra.betonArcering === false) {
            const geo = ankerGeometrie(p);
            near(o.height, (geo.boven + geo.diepste) * 2, 1e-6, `${naam} diepte zonder arcering`);
          } else {
            near(o.height, bbox.height, tol, `${naam} hoogte`);
          }
        }
      }
    }
  }
});

test('schaal vermenigvuldigt de werkelijke maat', () => {
  const a = ankerTemplate.realSizeMm({ maat: 'M20', type: 'keil' });
  const b = ankerTemplate.realSizeMm({ maat: 'M20', type: 'keil', schaal: 0.5 });
  near(b.width, a.width / 2, 1e-9, 'breedte');
  near(b.height, a.height / 2, 1e-9, 'hoogte');
});

test('zijaanzicht: oppervlak, plaat, ring en moer bovenop, betonarcering met opening', () => {
  const { mm, bbox, cmds } = teken({ maat: 'M16', type: 'stort-moer' }, 1);
  const geo = ankerGeometrie({ maat: 'M16', type: 'stort-moer' });
  const g = BOUT_MATEN.M16;
  const yOpp = bbox.y + geo.boven;
  const rand = cmds.filter((c) => c.role === 'betonrand');
  assert.equal(rand.length, 2);
  assert.ok(rand.every((c) => Math.abs(c.y1 - yOpp) < 1e-9 && Math.abs(c.y2 - yOpp) < 1e-9));
  assert.equal(cmds.filter((c) => c.role === 'plaat').length, 2, 'plaat met doorvoergat');
  assert.equal(cmds.filter((c) => c.role === 'moer').length, 2, 'moer boven + moer onderaan');
  assert.equal(cmds.filter((c) => c.role === 'ring').length, 2);
  const beton = cmds.find((c) => c.role === 'beton');
  assert.equal(beton.kind, 'hatch');
  assert.equal(beton.loops.length, 2, 'arcering met uitsparing voor het anker');
  // De onderste moer: zeskant met drie vlakken (hoekmaat e).
  const moeren = cmds.filter((c) => c.role === 'moer');
  const onder = moeren.find((c) => Math.min(...c.points.map((q) => q.y)) > yOpp);
  const xs = onder.points.map((q) => q.x);
  near(Math.max(...xs) - Math.min(...xs), zeskantHoekmaat(g.s), 1e-9, 'moer over de hoeken');
  assert.ok(mm.height > geo.hef);
  assert.ok(cmds.some((c) => c.role === 'draadeinde'), 'draadeinde-lijnen');
  assert.ok(cmds.some((c) => c.role === 'hartlijn' && Array.isArray(c.dash)));

  const zonder = teken({ maat: 'M16', type: 'stort-moer', betonArcering: false, plaatDikte: 0 }, 1).cmds;
  assert.ok(!zonder.some((c) => c.role === 'beton'));
  assert.ok(!zonder.some((c) => c.role === 'plaat'));
  assert.equal(zonder.filter((c) => c.role === 'betonrand').length, 2, 'oppervlaktelijn blijft');
});

test('typespecifieke onderdelen', () => {
  const rollen = (p) => new Set(teken(p, 1).cmds.map((c) => c.role));
  const chem = teken({ maat: 'M12', type: 'chemisch' }, 1);
  assert.ok(chem.cmds.some((c) => c.role === 'mortel' && c.kind === 'hatch' && c.loops.length === 2));
  const gat = chem.cmds.find((c) => c.role === 'boorgat');
  const gx = gat.points.map((q) => q.x);
  near(Math.max(...gx) - Math.min(...gx), 14, 1e-9, 'boorgat M12 chemisch');
  assert.ok(!chem.cmds.some((c) => c.role === 'draadeinde'), 'draadstang: draad over de hele lengte');

  const keil = rollen({ maat: 'M12', type: 'keil' });
  for (const r of ['boorgat', 'spreidclip', 'kegel', 'draadeinde', 'moer']) assert.ok(keil.has(r), `keil: ${r}`);
  const plaat = rollen({ maat: 'M20', type: 'stort-plaat' });
  assert.ok(plaat.has('ankerplaat'));
  const kop = teken({ maat: 'M16', type: 'kopbout' }, 1).cmds;
  assert.ok(kop.some((c) => c.role === 'kop'));
  assert.equal(kop.filter((c) => c.role === 'las').length, 2);
  assert.ok(!kop.some((c) => c.role === 'moer'), 'kopbout heeft geen moer');

  // Haken: L reikt R + haak naar rechts, J 2R + d/2; links blijft smal.
  for (const type of ['stort-L', 'stort-J']) {
    const geo = ankerGeometrie({ maat: 'M20', type });
    const d = 20, R = 2.5 * d;
    const reik = type === 'stort-L' ? R + 4 * d : 2 * R + d / 2;
    near(geo.rechts, reik + d, 1e-9, `${type} rechts`);
    assert.ok(geo.links < geo.rechts);
    const { bbox, cmds } = teken({ maat: 'M20', type }, 1);
    const staaf = cmds.filter((c) => c.role === 'anker' && c.kind === 'polyline');
    const maxX = Math.max(...staaf.flatMap((c) => c.points.map((q) => q.x)));
    near(maxX - (bbox.x + geo.links), reik, 1e-6, `${type} haakpunt`);
  }
  // Bovenaanzicht: ring, zeskant, draad als 3/4-cirkel.
  const boven = teken({ maat: 'M12', type: 'keil', aanzicht: 'boven' }, 1).cmds;
  assert.ok(boven.some((c) => c.role === 'ring' && c.kind === 'circle'));
  assert.ok(boven.some((c) => c.role === 'moer' && c.kind === 'polyline'));
  const boog = boven.find((c) => c.kind === 'arc');
  near(boog.a1 - boog.a0, 1.5 * Math.PI, 1e-12, 'driekwart');
});

test('snappunten: bbox plus de ankeras op het betonoppervlak', () => {
  const p = { maat: 'M12', type: 'stort-L' };
  const mm = ankerTemplate.realSizeMm(p);
  const bbox = { x: 10, y: 20, width: mm.width, height: mm.height };
  const pts = ankerTemplate.snapPoints(p, bbox);
  assert.equal(pts.length, 10);
  assert.deepEqual(pts[0], { kind: 'center', x: 10 + mm.width / 2, y: 20 + mm.height / 2 });
  const geo = ankerGeometrie(p);
  const as = pts[9];
  near(as.x, 10 + geo.links, 1e-9, 'ankeras x');
  near(as.y, 20 + geo.boven, 1e-9, 'betonoppervlak y');
  const boven = ankerTemplate.snapPoints({ ...p, aanzicht: 'boven' }, { x: 0, y: 0, width: 30, height: 30 });
  assert.equal(boven.length, 9);
});
