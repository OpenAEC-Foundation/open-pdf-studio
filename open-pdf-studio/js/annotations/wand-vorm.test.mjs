// Wandvorm met T-aansluitingen (#476).
//
// Aanleiding: een binnenwand (kalkzandsteen 100) die haaks op een andere wand
// stopt, kreeg een losse kap om zijn uiteinde en stak tot de hartlijn in de
// doorgaande wand: een rechthoekje over de doorgaande wand. Een bouwkundige
// verwacht:
//   - zelfde materiaal: de wanden vloeien in elkaar over. Geen kap op de
//     aansluitende wand en de vlaklijn van de doorgaande wand is over de
//     breedte van de aansluitende wand onderbroken.
//   - ander materiaal: de aansluitende wand stopt stomp tegen het VLAK van de
//     doorgaande wand, met een lijn op de naad; de doorgaande wand blijft heel.
//   - join uit op het aansluitende uiteinde: de oude losse kap.
// Het eindpunt van de aansluitende wand mag op de hartlijn, op het vlak, net
// ervoor of in de dikte van de doorgaande wand liggen.

import assert from 'node:assert/strict';
import test from 'node:test';

import { wandVorm, onderbreekRand } from './wand-vorm.js';
import { zoekJoinPartner, tAansluiting } from './wand-join.js';
import { buildWallAP } from '../pdf/saver/appearance-vectors.js';

const KZS = 'nen47-metselwerk-kunststeen';
const MET = 'nen47-metselwerk-baksteen';
const BETON = 'nen47-beton-gewapend';

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
const rp = (p) => ({ x: r(p.x), y: r(p.y) });
const rl = (l) => [r(l.x1), r(l.y1), r(l.x2), r(l.y2)];

/** Lijnstukken die op de horizontale lijn y liggen, als [xmin, xmax], gesorteerd. */
function stukkenOpY(vorm, y) {
  return vorm.lijnen
    .filter((l) => Math.abs(l.y1 - y) < 1e-6 && Math.abs(l.y2 - y) < 1e-6)
    .map((l) => [r(Math.min(l.x1, l.x2)), r(Math.max(l.x1, l.x2))])
    .sort((a, b) => a[0] - b[0]);
}

// Doorgaande wand A langs de x-as, band y ∈ [-50, 50]. De aansluitende wand
// B komt van boven (y = 1000) en stopt bij de doorgaande wand; het nabije
// vlak van A is dus y = 50.
function tOpstelling(eindY, extraB = {}, extraA = {}) {
  const a = wand(0, 0, 2000, 0, { id: 'A', ...extraA });
  const b = wand(1000, 1000, 1000, eindY, { id: 'B', ...extraB });
  return { a, b, wanden: [a, b] };
}

// ── herkenning ────────────────────────────────────────────────────────────

for (const [waar, y] of [['op de hartlijn', 0], ['op het vlak', 50], ['net ervoor', 70], ['in de dikte', 20], ['net voorbij de hartlijn', -20]]) {
  test(`T wordt herkend met het eindpunt ${waar}`, () => {
    const { a, b, wanden } = tOpstelling(y);
    const t = tAansluiting(b, 'end', a, halfW);
    assert.ok(t, 'T herkend');
    assert.equal(t.zijde, 1, 'B komt van de +n-kant van A');
    const p = zoekJoinPartner(b, 'end', wanden, halfW);
    assert.equal(p?.soort, 'T');
    assert.equal(p.wall, a);
    assert.equal(p.zelfdeLaag, true);
  });
}

test('geen T als het eindpunt te ver voor het vlak ligt, buiten de wand valt of evenwijdig loopt', () => {
  assert.equal(tAansluiting(wand(1000, 1000, 1000, 200), 'end', wand(0, 0, 2000, 0), halfW), null, 'te ver ervoor');
  assert.equal(tAansluiting(wand(2500, 1000, 2500, 0), 'end', wand(0, 0, 2000, 0), halfW), null, 'naast de wand');
  assert.equal(tAansluiting(wand(0, 30, 900, 30), 'end', wand(0, 0, 2000, 0), halfW), null, 'evenwijdig');
  // Een wand die er helemaal doorheen steekt, eindigt aan de andere kant.
  assert.equal(tAansluiting(wand(1000, 1000, 1000, -300), 'end', wand(0, 0, 2000, 0), halfW), null, 'erdoorheen');
});

// ── zelfde materiaal: in elkaar overvloeien ───────────────────────────────

for (const [waar, y] of [['op de hartlijn', 0], ['op het vlak', 50], ['net ervoor', 70]]) {
  test(`zelfde materiaal, eindpunt ${waar}: geen kap, B stopt op het vlak, de vlaklijn van A is onderbroken`, () => {
    const { a, b, wanden } = tOpstelling(y);
    const vb = wandVorm(b, wanden, halfW);
    // Einde van B (poly[1] en poly[2]) ligt op het vlak y = 50.
    assert.deepEqual([rp(vb.poly[1]), rp(vb.poly[2])].sort((p, q) => p.x - q.x), [{ x: 950, y: 50 }, { x: 1050, y: 50 }]);
    assert.equal(vb.joinedEnd, true);
    assert.deepEqual(stukkenOpY(vb, 50), [], 'geen kap op de naad');

    const va = wandVorm(a, wanden, halfW);
    assert.deepEqual(stukkenOpY(va, 50), [[0, 950], [1050, 2000]], 'vlaklijn onderbroken over de breedte van B');
    assert.deepEqual(stukkenOpY(va, -50), [[0, 2000]], 'de andere kant blijft heel');
  });
}

test('T onder een hoek: beide randen van B eindigen op het vlak', () => {
  const a = wand(0, 0, 2000, 0, { id: 'A' });
  const b = wand(1500, 800, 1000, 0, { id: 'B' });   // schuin, eindpunt op de hartlijn
  const vb = wandVorm(b, [a, b], halfW);
  assert.equal(r(vb.poly[1].y), 50);
  assert.equal(r(vb.poly[2].y), 50);
  const va = wandVorm(a, [a, b], halfW);
  const stukken = stukkenOpY(va, 50);
  assert.equal(stukken.length, 2, 'één onderbreking');
  const gat = [stukken[0][1], stukken[1][0]];
  const xs = [vb.poly[1].x, vb.poly[2].x].map(r).sort((p, q) => p - q);
  assert.deepEqual(gat, xs, 'het gat valt precies tussen de randen van B');
});

// ── ander materiaal: stomp tegen het vlak ─────────────────────────────────

for (const [waar, y] of [['op de hartlijn', 0], ['op het vlak', 50], ['net ervoor', 70]]) {
  test(`ander materiaal, eindpunt ${waar}: B stopt stomp op het vlak met een naadlijn, A blijft heel`, () => {
    const { a, b, wanden } = tOpstelling(y, { hatchPattern: KZS }, { hatchPattern: BETON });
    const vb = wandVorm(b, wanden, halfW);
    assert.deepEqual([rp(vb.poly[1]), rp(vb.poly[2])].sort((p, q) => p.x - q.x), [{ x: 950, y: 50 }, { x: 1050, y: 50 }]);
    assert.equal(vb.joinedEnd, false);
    assert.deepEqual(stukkenOpY(vb, 50), [[950, 1050]], 'naadlijn op het vlak');
    const va = wandVorm(a, wanden, halfW);
    assert.deepEqual(stukkenOpY(va, 50), [[0, 2000]], 'doorgaande wand heel');
  });
}

// ── join uit ──────────────────────────────────────────────────────────────

test('join uit op het aansluitende uiteinde: de losse kap van vroeger, A blijft heel', () => {
  const { a, b, wanden } = tOpstelling(0, { noJoinEnd: true });
  assert.equal(zoekJoinPartner(b, 'end', wanden, halfW), null);
  const vb = wandVorm(b, wanden, halfW);
  assert.deepEqual([rp(vb.poly[1]), rp(vb.poly[2])].sort((p, q) => p.x - q.x), [{ x: 950, y: 0 }, { x: 1050, y: 0 }]);
  assert.equal(vb.joinedEnd, false);
  assert.deepEqual(stukkenOpY(vb, 0), [[950, 1050]], 'kap op het eigen eindpunt');
  assert.deepEqual(stukkenOpY(wandVorm(a, wanden, halfW), 50), [[0, 2000]]);
});

test('join uit op de DOORGAANDE wand verandert niets aan de T (het gaat om het aansluitende uiteinde)', () => {
  const { a, b, wanden } = tOpstelling(0, {}, { noJoinStart: true, noJoinEnd: true });
  assert.equal(zoekJoinPartner(b, 'end', wanden, halfW)?.soort, 'T');
  assert.deepEqual(stukkenOpY(wandVorm(a, wanden, halfW), 50), [[0, 950], [1050, 2000]]);
});

// ── doorgaande wand in stukken ────────────────────────────────────────────

test('doorgaande wand opgeknipt bij een deur: de T hoort bij het stuk waar hij op landt', () => {
  const a1 = wand(0, 0, 800, 0, { id: 'A1' });
  const a2 = wand(1700, 0, 3000, 0, { id: 'A2' });     // 900 mm deur ertussen
  const b = wand(400, 1000, 400, 0, { id: 'B' });
  const wanden = [a1, a2, b];
  assert.equal(zoekJoinPartner(b, 'end', wanden, halfW)?.wall, a1);
  assert.deepEqual(stukkenOpY(wandVorm(a1, wanden, halfW), 50), [[0, 350], [450, 800]]);
  assert.deepEqual(stukkenOpY(wandVorm(a2, wanden, halfW), 50), [[1700, 3000]]);
});

test('aansluiting precies op de naad tussen twee stukken: beide stukken krijgen hun deel van het gat', () => {
  const a1 = wand(0, 0, 1000, 0, { id: 'A1' });
  const a2 = wand(1000, 0, 2000, 0, { id: 'A2' });
  const b = wand(990, 1000, 990, 0, { id: 'B' });       // voetafdruk 940..1040
  const wanden = [a1, a2, b];
  assert.equal(zoekJoinPartner(b, 'end', wanden, halfW)?.soort, 'T');
  assert.deepEqual(stukkenOpY(wandVorm(a1, wanden, halfW), 50), [[0, 940]]);
  assert.deepEqual(stukkenOpY(wandVorm(a2, wanden, halfW), 50), [[1040, 2000]]);
  const vb = wandVorm(b, wanden, halfW);
  assert.deepEqual(stukkenOpY(vb, 50), [], 'geen kap');
});

test('aansluiting exact op het eindpunt van twee stukken: T, geen hoek met één van de stukken', () => {
  const a1 = wand(0, 0, 1000, 0, { id: 'A1' });
  const a2 = wand(1000, 0, 2000, 0, { id: 'A2' });
  const b = wand(1000, 1000, 1000, 0, { id: 'B' });
  const wanden = [a1, a2, b];
  assert.equal(zoekJoinPartner(b, 'end', wanden, halfW)?.soort, 'T');
  const va1 = wandVorm(a1, wanden, halfW), va2 = wandVorm(a2, wanden, halfW);
  assert.deepEqual(stukkenOpY(va1, 50), [[0, 950]]);
  assert.deepEqual(stukkenOpY(va2, 50), [[1050, 2000]]);
  assert.deepEqual(stukkenOpY(va1, -50), [[0, 1000]], 'de andere kant loopt door');
  assert.equal(va1.joinedEnd, true, 'de stukken sluiten op elkaar aan, zonder kap');
  assert.deepEqual(stukkenOpY(wandVorm(b, wanden, halfW), 50), [], 'geen kap op de aansluitende wand');
});

// ── spouwmuur ─────────────────────────────────────────────────────────────

test('binnenwand tegen het binnenblad van een spouwmuur: vloeit over in de kalkzandsteen, niet in de isolatie', () => {
  // Gevel langs de x-as, buitenvlak y = 0; lagen: metselwerk (hart 50),
  // isolatie (hart 190), kalkzandsteen 120 (hart 300, binnenvlak 360).
  const met = wand(0, 50, 5000, 50, { id: 'MET', hatchPattern: MET });
  const iso = wand(0, 190, 5000, 190, { id: 'ISO', hatchPattern: 'isolatie' });
  const kzs = wand(0, 300, 5000, 300, { id: 'KZS', dikteMm: 120 });
  const binnen = wand(2000, 3000, 2000, 360, { id: 'BIN' });   // stopt op het binnenvlak
  const wanden = [met, iso, kzs, binnen];
  const p = zoekJoinPartner(binnen, 'end', wanden, halfW);
  assert.equal(p?.wall, kzs);
  assert.equal(p.soort, 'T');
  const vk = wandVorm(kzs, wanden, halfW);
  assert.deepEqual(stukkenOpY(vk, 360), [[0, 1950], [2050, 5000]], 'binnenvlak onderbroken');
  assert.deepEqual(stukkenOpY(vk, 240), [[0, 5000]], 'kant van de isolatie heel');
  assert.deepEqual(stukkenOpY(wandVorm(iso, wanden, halfW), 240), [[0, 5000]]);
});

// ── T of hoek ─────────────────────────────────────────────────────────────

test('steekt de doorgaande wand ver voorbij de aansluitende wand, dan is het een T en geen hoek', () => {
  const a = wand(-300, 0, 2000, 0, { id: 'A' });   // loopt 300 voorbij de hartlijn van B door
  const b = wand(0, 1000, 0, 10, { id: 'B' });
  const p = zoekJoinPartner(b, 'end', [a, b], halfW);
  assert.equal(p?.soort, 'T');
  assert.equal(zoekJoinPartner(a, 'start', [a, b], halfW), null, 'A zelf joint daar niet');
  assert.deepEqual(stukkenOpY(wandVorm(a, [a, b], halfW), 50), [[-300, -50], [50, 2000]]);
});

test('liggen beide einden in elkaars dikte, dan blijft het een (verstekte) hoek', () => {
  const a = wand(-20, 0, 2000, 0, { id: 'A' });
  const b = wand(0, 1000, 0, 10, { id: 'B' });
  const p = zoekJoinPartner(b, 'end', [a, b], halfW);
  assert.equal(p?.soort, 'kruisend');
  assert.equal(zoekJoinPartner(a, 'start', [a, b], halfW)?.soort, 'kruisend');
});

// ── lijnen en opgeslagen appearance ───────────────────────────────────────

test('onderbreekRand knipt gaten uit een rand en laat de rest staan', () => {
  const S = { x: 0, y: 0 }, u = { x: 1, y: 0 };
  const stukken = onderbreekRand({ x: 0, y: 50 }, { x: 1000, y: 50 }, S, u, [{ t0: 100, t1: 200 }, { t0: 150, t1: 300 }, { t0: 900, t1: 1200 }]);
  assert.deepEqual(stukken.map(rl), [[0, 50, 100, 50], [300, 50, 900, 50]]);
  assert.deepEqual(onderbreekRand({ x: 0, y: 50 }, { x: 1000, y: 50 }, S, u, []).map(rl), [[0, 50, 1000, 50]]);
});

test('een vrije wand heeft vier lijnen; een verstekte hoek laat de naad open', () => {
  const vrij = wandVorm(wand(0, 0, 1000, 0), [], halfW);
  assert.equal(vrij.lijnen.length, 4);
  const a = wand(0, 0, 1000, 0), b = wand(1000, 0, 1000, 1000);
  const va = wandVorm(a, [a, b], halfW);
  assert.equal(va.lijnen.length, 3, 'geen kap op het verstekte uiteinde');
});

test('de opgeslagen appearance tekent dezelfde lijnen als het scherm', () => {
  const { a, wanden } = tOpstelling(0);
  const va = wandVorm(a, wanden, halfW);
  const id = (v) => v;
  const ap = buildWallAP({
    bandPoints: va.poly, outlineSegments: va.lijnen, X: id, Y: id,
    strokeColorHex: '#000000', lineWidth: 0.7,
  });
  const strepen = (ap.content.match(/ m [-\d.]+ [-\d.]+ l S/g) || []).length;
  assert.equal(strepen, va.lijnen.length, 'één streep per lijnstuk');
  assert.ok(!/ h\s*S|h\nS/.test(ap.content.split('RG').pop()), 'geen gesloten omtrek meer');
  // Zonder lijnstukken blijft het oude gedrag (gesloten omtrek).
  const oud = buildWallAP({ bandPoints: va.poly, X: id, Y: id, strokeColorHex: '#000000', lineWidth: 0.7 });
  assert.ok(oud.content.length > 0);
});
