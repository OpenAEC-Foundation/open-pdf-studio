import assert from 'node:assert/strict';
import test from 'node:test';

import {
  naarWandvlak, spouwmuurLagen, verstekLagen, sparingIntervallen, gehostePlaatsing, afstandLangsWandMm,
} from './wand-geometrie.js';

const bijna = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} ≠ ${b}`);
const K = 0.5; // pt per mm in de tests

test('naarWandvlak: eindpunt landt op het dichtstbijzijnde vlak, niet op de hartlijn', () => {
  // Horizontale wand op y=100, dikte 200 mm → halve dikte 50 pt (K=0.5).
  const wand = { id: 'w1', startX: 0, startY: 100, endX: 400, endY: 100, dikteMm: 200 };
  const halfW = () => 50;
  // Binnenwand komt van boven en eindigt 10 pt vóór de bovenkant.
  const r = naarWandvlak({ x: 200, y: 45 }, [wand], halfW);
  assert.ok(r, 'treffer');
  bijna(r.x, 200, 'x'); bijna(r.y, 50, 'op het bovenvlak (100-50)');
  assert.equal(r.zijde, -1);
  // Van onderen, al in de band gestoken → onderste vlak.
  const r2 = naarWandvlak({ x: 100, y: 130 }, [wand], halfW);
  bijna(r2.y, 150, 'op het ondervlak');
  // Te ver weg: niets.
  assert.equal(naarWandvlak({ x: 100, y: 0 }, [wand], halfW, { tol: 8 }), null);
  // Buiten de lengte: niets.
  assert.equal(naarWandvlak({ x: 480, y: 55 }, [wand], halfW), null);
});

test('naarWandvlak: sluit de eigen wand uit en kiest bij twee wanden de dichtstbijzijnde', () => {
  const a = { id: 'a', startX: 0, startY: 100, endX: 400, endY: 100, dikteMm: 200 };
  const b = { id: 'b', startX: 0, startY: 300, endX: 400, endY: 300, dikteMm: 200 };
  const halfW = () => 50;
  const r = naarWandvlak({ x: 200, y: 245 }, [a, b], halfW, { uitsluiten: a });
  assert.equal(r.wand.id, 'b'); bijna(r.y, 250, 'bovenvlak van b');
});

test('spouwmuurLagen: drie evenwijdige hartlijnen aan de binnenzijde van de getekende lijn', () => {
  const lagen = [{ dikteMm: 100, naam: 'buiten' }, { dikteMm: 150, naam: 'spouw' }, { dikteMm: 100, naam: 'binnen' }];
  // Getekend van links naar rechts; rechts van de tekenrichting = omlaag (y+) op het scherm.
  const uit = spouwmuurLagen({ x: 0, y: 0 }, { x: 1000, y: 0 }, lagen, K, 'rechts');
  assert.equal(uit.length, 3);
  bijna(uit[0].startY, 25, 'buitenblad: 0..50 pt → hartlijn 25');
  bijna(uit[1].startY, 50 + 37.5, 'spouw: 50..125 → 87.5');
  bijna(uit[2].startY, 125 + 25, 'binnenblad: 125..175 → 150');
  assert.equal(uit[2].naam, 'binnen');
  const links = spouwmuurLagen({ x: 0, y: 0 }, { x: 1000, y: 0 }, lagen, K, 'links');
  bijna(links[0].startY, -25, 'binnenzijde links → lagen omhoog');
});

test('verstekLagen: opeenvolgende segmenten sluiten per laag op het snijpunt', () => {
  const lagen = [{ dikteMm: 100 }, { dikteMm: 150 }, { dikteMm: 100 }];
  // Rechthoek met de klok mee: eerst naar rechts, dan omlaag.
  const v = spouwmuurLagen({ x: 0, y: 0 }, { x: 1000, y: 0 }, lagen, K);
  const n = spouwmuurLagen({ x: 1000, y: 0 }, { x: 1000, y: 800 }, lagen, K);
  verstekLagen(v, n);
  for (let i = 0; i < 3; i++) {
    bijna(v[i].endX, n[i].startX, `laag ${i}: eindpunt = beginpunt (x)`);
    bijna(v[i].endY, n[i].startY, `laag ${i}: eindpunt = beginpunt (y)`);
  }
  // Buitenblad: hartlijn y=25 snijdt hartlijn x=1000-25 → hoek op (975, 25).
  bijna(v[0].endX, 975, 'buitenblad hoek x'); bijna(v[0].endY, 25, 'buitenblad hoek y');
  // Binnenblad: y=150 en x=850.
  bijna(v[2].endX, 850, 'binnenblad hoek x'); bijna(v[2].endY, 150, 'binnenblad hoek y');
});

test('verstekLagen: evenwijdige (doorlopende) segmenten blijven ongemoeid', () => {
  const lagen = [{ dikteMm: 100 }];
  const v = spouwmuurLagen({ x: 0, y: 0 }, { x: 500, y: 0 }, lagen, K);
  const n = spouwmuurLagen({ x: 500, y: 0 }, { x: 900, y: 0 }, lagen, K);
  const eindVoor = v[0].endX;
  verstekLagen(v, n);
  bijna(v[0].endX, eindVoor, 'ongewijzigd');
});

test('sparingIntervallen en gehostePlaatsing', () => {
  const w = { id: 'w', startX: 100, startY: 100, endX: 100, endY: 600, dikteMm: 200 }; // verticaal, 500 pt
  const deur = { params: { hostWallId: 'w', hostAfstandMm: 400, width: 900 } };      // midden 200 pt, breed 450 pt
  const raam = { params: { hostWallId: 'w', hostAfstandMm: 950, width: 200 } };      // midden 475, breed 100 → afgeknipt op 500
  const los = { params: { hostWallId: 'x', hostAfstandMm: 1, width: 100 } };
  const iv = sparingIntervallen(w, [raam, deur, los], K);
  assert.equal(iv.length, 2);
  bijna(iv[0].t0, 0, 'deur t0 afgeknipt op het begin'); bijna(iv[0].t1, 200 + 225, 'deur t1');
  bijna(iv[1].t1, 500, 'raam afgeknipt op de wandlengte');
  const pl = gehostePlaatsing(w, deur.params, K);
  bijna(pl.width, 450, 'breedte'); bijna(pl.height, 100, 'hoogte = dikte');
  bijna(pl.x + pl.width / 2, 100, 'midden x op de hartlijn'); bijna(pl.y + pl.height / 2, 300, 'midden y = 100 + 200');
  bijna(pl.rotation, 90, 'rotatie volgt de wand');
  bijna(afstandLangsWandMm({ x: 140, y: 300 }, w, K), 400, 'afstand langs de wand in mm');
});
