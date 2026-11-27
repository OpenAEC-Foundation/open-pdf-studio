// De vorm van een wand met gehoste openingen (#1229).
//
// De wand blijft één annotatie. Waar een kozijn staat is de band open: de
// lange randen stoppen bij de dagkanten, op elke dagkant staat een lijn dwars
// door de band, en vulling en arcering komen alleen op de solide stukken. Op
// het scherm en in de opgeslagen appearance, want die tekenen beide uit
// dezelfde vorm.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { wandVorm } from './wand-vorm.js';
import { openingIntervallen } from './wand-openingen.js';
import { buildWallAP } from '../pdf/saver/appearance-vectors.js';

const KZS = 'nen47-metselwerk-kunststeen';
let teller = 0;
function wand(sx, sy, ex, ey, extra = {}) {
  return {
    id: extra.id || `w${++teller}`, type: 'wall', page: 1,
    startX: sx, startY: sy, endX: ex, endY: ey,
    dikteMm: 100, hatchPattern: KZS, ...extra,
  };
}
// 1 pt = 1 mm in deze tests.
const halfW = (w) => (w.dikteMm || 100) / 2;
const r = (v) => Math.round(v * 1000) / 1000;
const rp = (p) => [r(p.x), r(p.y)];
const rl = (l) => [r(l.x1), r(l.y1), r(l.x2), r(l.y2)];

/** Lijnstukken op de horizontale lijn y, als [xmin, xmax], gesorteerd. */
function stukkenOpY(vorm, y) {
  return vorm.lijnen
    .filter((l) => Math.abs(l.y1 - y) < 1e-6 && Math.abs(l.y2 - y) < 1e-6)
    .map((l) => [r(Math.min(l.x1, l.x2)), r(Math.max(l.x1, l.x2))])
    .sort((a, b) => a[0] - b[0]);
}
/** Lijnen dwars door de band (verticaal bij een horizontale wand), op x. */
function dwarsOpX(vorm) {
  return vorm.lijnen
    .filter((l) => Math.abs(l.x1 - l.x2) < 1e-6)
    .map((l) => r(l.x1))
    .sort((a, b) => a - b);
}

test('zonder openingen verandert er niets: de band is het ene solide stuk', () => {
  const w = wand(0, 0, 4000, 0);
  const zonder = wandVorm(w, [w], halfW);
  assert.equal(zonder.lijnen.length, 4);
  assert.deepEqual(zonder.stukken, [zonder.poly]);
  assert.deepEqual(wandVorm(w, [w], halfW, []).lijnen.map(rl), zonder.lijnen.map(rl));
});

test('een deur: de randen stoppen bij de dagkanten en de wand blijft een band', () => {
  const w = wand(0, 0, 4000, 0);
  // Deur van 900 op 2000 mm van het begin: open van 1550 tot 2450.
  const v = wandVorm(w, [w], halfW, [{ t0: 1550, t1: 2450 }]);
  assert.deepEqual(stukkenOpY(v, 50), [[0, 1550], [2450, 4000]], 'de +n-rand is onderbroken');
  assert.deepEqual(stukkenOpY(v, -50), [[0, 1550], [2450, 4000]], 'de -n-rand ook');
  assert.deepEqual(dwarsOpX(v), [0, 1550, 2450, 4000], 'twee kappen en twee dagkanten');
  // De hele band blijft beschikbaar (raakvlak, snap); de vulling krijgt twee stukken.
  assert.deepEqual(v.poly.map(rp), [[0, 50], [4000, 50], [4000, -50], [0, -50]]);
  assert.deepEqual(v.stukken.map((s) => s.map(rp)), [
    [[0, 50], [1550, 50], [1550, -50], [0, -50]],
    [[2450, 50], [4000, 50], [4000, -50], [2450, -50]],
  ]);
});

test('twee openingen geven drie solide stukken', () => {
  const w = wand(0, 0, 10000, 0, { dikteMm: 300 });
  const v = wandVorm(w, [w], halfW, [{ t0: 5400, t1: 6600 }, { t0: 1550, t1: 2450 }]);
  assert.deepEqual(stukkenOpY(v, 150), [[0, 1550], [2450, 5400], [6600, 10000]]);
  assert.equal(v.stukken.length, 3);
  assert.deepEqual(dwarsOpX(v), [0, 1550, 2450, 5400, 6600, 10000]);
});

test('een schuine wand: de dagkant staat haaks op de as', () => {
  const w = wand(0, 0, 3000, 4000);            // lengte 5000, u = (0.6, 0.8)
  const v = wandVorm(w, [w], halfW, [{ t0: 2000, t1: 3000 }]);
  // Dagkant op t = 2000: midden (1200, 1600), dwars n = (-0.8, 0.6) x 50.
  const dag = v.lijnen.map(rl).find((l) => l[0] === 1160 && l[1] === 1630);
  assert.deepEqual(dag, [1160, 1630, 1240, 1570]);
  assert.equal(v.stukken.length, 2);
});

test('een opening tot aan het uiteinde: geen kap en geen dagkant daar', () => {
  const w = wand(0, 0, 4000, 0);
  const v = wandVorm(w, [w], halfW, [{ t0: 3100, t1: 4000 }]);
  assert.deepEqual(stukkenOpY(v, 50), [[0, 3100]]);
  assert.deepEqual(dwarsOpX(v), [0, 3100], 'alleen de kap aan het begin en de ene dagkant');
  assert.equal(v.stukken.length, 1);
  // Buiten de wand vallende delen tellen niet mee.
  const ruim = wandVorm(w, [w], halfW, [{ t0: -500, t1: 900 }]);
  assert.deepEqual(stukkenOpY(ruim, 50), [[900, 4000]]);
  assert.deepEqual(dwarsOpX(ruim), [900, 4000]);
});

test('een verstekte hoek blijft verstekt; het stuk aan het eind houdt de hoek', () => {
  const a = wand(0, 0, 4000, 0);
  const b = wand(4000, 0, 4000, 3000);
  const v = wandVorm(a, [a, b], halfW, [{ t0: 1000, t1: 1900 }]);
  assert.equal(v.joinedEnd, true);
  const laatste = v.stukken[v.stukken.length - 1];
  assert.deepEqual(laatste.map(rp), [[1900, 50], v.poly[1], v.poly[2], [1900, -50]].map((p) => (Array.isArray(p) ? p : rp(p))));
  // Geen kap op het verstekte eind: dwars alleen het begin en de twee dagkanten.
  assert.deepEqual(dwarsOpX(v), [0, 1000, 1900]);
});

test('een T-aansluiting en een opening onderbreken dezelfde rand', () => {
  // Doorgaande wand langs de x-as; een wand van hetzelfde materiaal komt van
  // boven (y > 0) en stopt erop bij x = 3000.
  const a = wand(0, 0, 4000, 0);
  const b = wand(3000, 1000, 3000, 0);
  const v = wandVorm(a, [a, b], halfW, [{ t0: 500, t1: 1400 }]);
  assert.deepEqual(stukkenOpY(v, 50), [[0, 500], [1400, 2950], [3050, 4000]]);
  assert.deepEqual(stukkenOpY(v, -50), [[0, 500], [1400, 4000]]);
});

test('de intervallen uit de lijst van de wand geven dezelfde vorm', () => {
  const w = wand(0, 0, 2000, 0, {
    openingen: [{ id: 'd', key: 'k', afstandMm: 2000, breedteMm: 900, soort: 'deur', zijde: 1 }],
  });
  // 0,5 pt per mm: 4000 mm wand, deur open van 775 tot 1225 pt.
  const open = openingIntervallen(2000, w.openingen, 0.5);
  const v = wandVorm(w, [w], () => 25, open);
  assert.deepEqual(stukkenOpY(v, 25), [[0, 775], [1225, 2000]]);
});

/** De x-bereiken van de vlakken die eindigen op `slot` ('f' = gevuld, 'W n' = knipvlak). */
function vlakkenMet(inhoud, slot) {
  const uit = [];
  const patroon = new RegExp(`((?:[-\\d.]+ [-\\d.]+ [ml]\\n)+)h\\n${slot}\\n`, 'g');
  for (const m of inhoud.matchAll(patroon)) {
    const xs = m[1].trim().split('\n').map((regel) => Number(regel.split(' ')[0]));
    uit.push([Math.min(...xs), Math.max(...xs)]);
  }
  return uit;
}

test('de opgeslagen appearance: omtrek en arcering stoppen bij de dagkanten', () => {
  const w = wand(0, 0, 4000, 0);
  const v = wandVorm(w, [w], halfW, [{ t0: 1550, t1: 2450 }]);
  const id = (x) => x;
  const ap = buildWallAP({
    bandPoints: v.poly, bandPieces: v.stukken, outlineSegments: v.lijnen, X: id, Y: id,
    strokeColorHex: '#000000', lineWidth: 0.7, fillBgHex: '#C0C0C0',
    hatchPattern: 'diagonal-right', hatchColorHex: '#000000', hatchScale: 100, hatchAngle: 0,
  });
  // De achtergrondkleur: twee gevulde vlakken, elk een solide stuk; niets in het gat.
  assert.deepEqual(vlakkenMet(ap.content, 'f'), [[0, 1550], [2450, 4000]]);
  // De arcering wordt per solide stuk geknipt en stopt dus op de dagkanten.
  assert.deepEqual(vlakkenMet(ap.content, 'W n'), [[0, 1550], [2450, 4000]]);
  // De omtrek: precies de lijnstukken van het scherm (kappen, randen, dagkanten).
  const omtrek = ap.content.slice(ap.content.lastIndexOf('Q\n') + 2);
  const strepen = (omtrek.match(/ m [-\d.]+ [-\d.]+ l S/g) || []).length;
  assert.equal(strepen, v.lijnen.length);
  assert.equal(v.lijnen.length, 8, 'vier randstukken, twee kappen, twee dagkanten');

  // Zonder stukken (een wand zonder openingen) blijft het de hele band.
  const heel = buildWallAP({
    bandPoints: v.poly, outlineSegments: v.lijnen, X: id, Y: id,
    strokeColorHex: '#000000', lineWidth: 0.7, fillBgHex: '#C0C0C0',
    hatchPattern: 'diagonal-right', hatchColorHex: '#000000', hatchScale: 100, hatchAngle: 0,
  });
  assert.deepEqual(vlakkenMet(heel.content, 'f'), [[0, 4000]]);
  assert.deepEqual(vlakkenMet(heel.content, 'W n'), [[0, 4000]]);
});

test('scherm en saver gebruiken de solide stukken', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const walls = lees('./rendering/walls.js');
  assert.match(walls, /openingIntervallen\(len, openingen, wallPxPerMm\(ann\)\)/, 'de wandweergave rekent de open delen uit de lijst');
  assert.match(walls, /for \(const stuk of \(shape\.stukken \|\| \[shape\.poly\]\)\)/, 'arcering per solide stuk');
  const saver = lees('../pdf/saver.js');
  assert.match(saver, /bandPieces: wallShape\.stukken/, 'de saver geeft de stukken door aan de appearance');
});
