import assert from 'node:assert/strict';
import test from 'node:test';

import {
  kozijnMaten, kozijnIndeling, kozijnTekenopdrachten, heeftKozijnOpbouw, vakOffsetMm,
} from './kozijn.js';
import { deurbladBreedte } from './kozijnprofiel.js';

const bijna = (a, b, tol = 1e-6, wat = '') => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);
const K50 = 2.8346 / 50;
const K100 = 2.8346 / 100;

function omhulling(punten) {
  return {
    uMin: Math.min(...punten.map((p) => p.u)), uMax: Math.max(...punten.map((p) => p.u)),
    vMin: Math.min(...punten.map((p) => p.v)), vMax: Math.max(...punten.map((p) => p.v)),
  };
}

test('kozijnmaten: 67 x 114, in een dikke wand in het midden, in een dunne wand gelijk aan de wand', () => {
  const raam = kozijnMaten('raam', { width: 1200, wallThickness: 300 });
  assert.equal(raam.stijlBreedteMm, 67);
  assert.equal(raam.stijlDiepteMm, 114);
  assert.equal(raam.positieMm, (300 - 114) / 2, 'zonder positie: midden in de wand');
  assert.equal(raam.aanslagMm, 0);
  assert.equal(raam.spelingMm, 0);

  const binnendeur = kozijnMaten('deur', { width: 930, wallThickness: 100 });
  assert.equal(binnendeur.stijlDiepteMm, 100, 'binnendeur: het kozijn is zo diep als de wand');
  assert.equal(binnendeur.positieMm, 0);

  const spouw = kozijnMaten('raam', { width: 1200, wallThickness: 360, kozijnPositieMm: 100, aanslagMm: 20, binnenSpelingMm: 10 });
  assert.equal(spouw.positieMm, 100, 'achter het buitenblad');
  assert.equal(spouw.aanslagMm, 20);
  assert.equal(spouw.spelingMm, 10);

  const teVer = kozijnMaten('raam', { width: 1200, wallThickness: 360, kozijnPositieMm: 400 });
  assert.equal(teVer.positieMm, 360 - 114, 'het kozijn blijft in de wand');
  const smal = kozijnMaten('raam', { width: 150, wallThickness: 300 });
  assert.equal(smal.stijlBreedteMm, 50, 'twee stijlen raken elkaar niet');
});

test('oude deuren en ramen houden hun oude tekening', () => {
  assert.equal(heeftKozijnOpbouw({ width: 900, swing: 'left', angle: 90, showWall: false }), false);
  assert.equal(heeftKozijnOpbouw({ width: 900, wallThickness: 100 }), true);
  // Een oud raam heeft wel een wanddikte, maar geen kozijnhout.
  assert.equal(heeftKozijnOpbouw({ width: 1200, wallThickness: 240, type: 'fixed' }, 'raam'), false);
  assert.equal(heeftKozijnOpbouw({ width: 1200, wallThickness: 240, stijlBreedteMm: 67 }, 'raam'), true);
});

test('raam: twee stijlen in de dag, glas ertussen, borstwering in aanzicht', () => {
  const { vormen, vak } = kozijnIndeling('raam', { width: 1200, wallThickness: 300, borstweringMm: 850 });
  const stijlen = vormen.filter((v) => v.rol === 'stijl');
  assert.equal(stijlen.length, 2);
  const [l, r] = stijlen.map((s) => omhulling(s.punten));
  assert.deepEqual([l.uMin, l.uMax, l.vMin, l.vMax], [0, 67, 93, 207]);
  assert.deepEqual([r.uMin, r.uMax], [1133, 1200]);
  assert.equal(stijlen[0].punten.length, 6, 'met sponning');
  assert.equal(vormen.filter((v) => v.rol === 'glas').length, 2);
  const aanzicht = vormen.filter((v) => v.rol === 'aanzicht');
  assert.equal(aanzicht.length, 2, 'borstwering buiten en binnen');
  assert.deepEqual(vak, { uMin: 0, uMax: 1200, vMin: 0, vMax: 300 });

  const pui = kozijnIndeling('raam', { width: 1200, wallThickness: 300, borstweringMm: 0 });
  assert.equal(pui.vormen.filter((v) => v.rol === 'aanzicht').length, 0, 'zonder borstwering geen aanzicht');
});

test('raam in een spouwmuur: aanslag buiten, speling binnen', () => {
  const { vormen, vak } = kozijnIndeling('raam', {
    width: 1200, wallThickness: 360, kozijnPositieMm: 100, aanslagMm: 20, binnenSpelingMm: 10, borstweringMm: 850,
  });
  const [buiten, binnen] = vormen.filter((v) => v.rol === 'aanzicht');
  assert.deepEqual([buiten.van.u, buiten.tot.u, buiten.van.v], [20, 1180, 0]);
  assert.deepEqual([binnen.van.u, binnen.tot.u, binnen.van.v], [-10, 1210, 360]);
  assert.deepEqual(vak, { uMin: -10, uMax: 1210, vMin: 0, vMax: 360 });
  const l = omhulling(vormen.find((v) => v.rol === 'stijl').punten);
  assert.deepEqual([l.vMin, l.vMax], [100, 214], 'het kozijn staat in de spouw');
});

test('deur: het blad draait vanuit het binnenvlak van het kozijn de ruimte in', () => {
  const { vormen, vak, maten } = kozijnIndeling('deur', { width: 930, wallThickness: 100 });
  const boog = vormen.find((v) => v.rol === 'draaicirkel');
  bijna(boog.midden.v, 100, 1e-9, 'scharnier op het binnenvlak');
  const L = deurbladBreedte({ vanU: 67, totU: 863 });
  bijna(boog.straal, L, 1e-9, 'straal = bladbreedte');
  bijna(vak.vMax, 100 + L, 1e-6, 'vak loopt tot het eind van de draaicirkel');
  assert.equal(vak.vMin, 0);
  assert.equal(maten.draaiNaar, 'binnen');
  // De stijlen hebben een deursponning aan de binnenzijde.
  const l = vormen.find((v) => v.rol === 'stijl').punten;
  assert.ok(l.some((p) => p.u === 67 - 17 && p.v === 100));

  const naarBuiten = kozijnIndeling('deur', { width: 930, wallThickness: 100, draaiNaar: 'buiten' });
  bijna(naarBuiten.vak.vMin, -L, 1e-6, 'naar buiten: het vak loopt aan de buitenkant door');
  assert.equal(naarBuiten.vak.vMax, 100);
});

test('tekenopdrachten: de binnenzijde staat bovenaan, alles binnen het vak', () => {
  const params = { width: 1200, wallThickness: 300, borstweringMm: 850 };
  const bbox = { x: 10, y: 20, width: 1200 * K50, height: 300 * K50 };
  const cmds = kozijnTekenopdrachten('raam', params, bbox);
  const punten = cmds.flatMap((c) => (c.kind === 'polyline' ? c.points
    : c.kind === 'line' ? [{ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }] : []));
  for (const p of punten) {
    assert.ok(p.x >= bbox.x - 1e-6 && p.x <= bbox.x + bbox.width + 1e-6, `x ${p.x} in het vak`);
    assert.ok(p.y >= bbox.y - 1e-6 && p.y <= bbox.y + bbox.height + 1e-6, `y ${p.y} in het vak`);
  }
  const stijl = cmds.find((c) => c.kind === 'polyline' && c.fill);
  assert.equal(stijl.points.length, 6, '1:50: kozijnhout met sponning');
  // Sponning aan de binnenzijde → bovenaan (kleine y) in het symbool.
  const ys = stijl.points.map((p) => p.y);
  const sponningY = stijl.points.filter((p) => Math.abs(p.x - (bbox.x + 50 * K50)) < 1e-6).map((p) => p.y);
  assert.ok(Math.min(...sponningY) <= Math.min(...ys) + 1e-6, 'de sponning ligt aan de bovenkant');

  const grof = kozijnTekenopdrachten('raam', params, { x: 0, y: 0, width: 1200 * K100, height: 300 * K100 });
  const grofStijl = grof.find((c) => c.kind === 'polyline' && c.fill);
  assert.equal(grofStijl.points.length, 4, '1:100: vereenvoudigd, zonder sponning');
  assert.equal(grof.filter((c) => c.kind === 'line' && c.lineWidthFactor === 0.5).length, 1, 'één glaslijn');
});

test('een los raam met een ander vak vult zijn vak', () => {
  // Door de gebruiker getrokken: 200 x 10 pt, terwijl de params 1200 x 240 zeggen.
  const bbox = { x: 0, y: 0, width: 200, height: 10 };
  const cmds = kozijnTekenopdrachten('raam', { width: 1200, wallThickness: 240, type: 'fixed' }, bbox);
  assert.ok(cmds.length > 0);
  for (const c of cmds) {
    const ys = c.kind === 'polyline' ? c.points.map((p) => p.y) : [c.y1, c.y2];
    for (const y of ys) assert.ok(y >= -1e-6 && y <= 10 + 1e-6, `y ${y} in het vak`);
  }
});

test('een gehost deurvak past precies om de indeling', () => {
  const params = { width: 930, wallThickness: 100 };
  const { vak } = kozijnIndeling('deur', params);
  const bbox = { x: 0, y: 0, width: (vak.uMax - vak.uMin) * K50, height: (vak.vMax - vak.vMin) * K50 };
  const cmds = kozijnTekenopdrachten('deur', params, bbox);
  const boog = cmds.find((c) => c.kind === 'arc');
  // Binnenzijde boven: het scharnier ligt op het binnenvlak, de boog loopt omhoog.
  bijna(boog.cy, (vak.vMax - 100) * K50, 1e-6, 'scharnier op het binnenvlak');
  bijna(boog.cy - boog.r, 0, 1e-6, 'de boog raakt de bovenrand');
});

test('vakOffsetMm: van een punt in de indeling naar het midden van het vak', () => {
  const vak = { uMin: -10, uMax: 1210, vMin: 0, vMax: 360 };
  assert.deepEqual(vakOffsetMm(vak, 600, 180), { dx: 0, dy: 0 });
  assert.deepEqual(vakOffsetMm(vak, 0, 0), { dx: -600, dy: 180 }, 'buitenvlak = naar beneden in het symbool');
});

test('draairichting: links blijft links gezien vanaf de kant waar de deur van weg draait', () => {
  const scharnierU = (params) => kozijnIndeling('deur', { width: 930, wallThickness: 100, ...params })
    .vormen.find((v) => v.rol === 'draaicirkel').midden.u;
  // Naar binnen, links: scharnier aan de linker stijl van het symbool (zoals het oude symbool).
  assert.ok(scharnierU({ swing: 'left' }) < 100);
  assert.ok(scharnierU({ swing: 'right' }) > 800);
  // Naar buiten draaiend kijk je vanaf de andere kant: links ligt in het symbool rechts.
  assert.ok(scharnierU({ swing: 'left', draaiNaar: 'buiten' }) > 800);
  assert.ok(scharnierU({ swing: 'right', draaiNaar: 'buiten' }) < 100);
});
