import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPARING_STANDAARD, normaliseerSparing, sparingPlaatsing, controleerSparing,
  wandMetSparingen, sparingSymboolVak, hartUitPunt,
} from './sparing.js';

// 1:50 op 72 dpi ≈ 0,0567 pt/mm. Voor de leesbaarheid hier 0,5 pt/mm: een
// wand van 10 000 mm is dan 5000 pt lang.
const K = 0.5;
const wandOW = { id: 'w1', startX: 0, startY: 100, endX: 5000, endY: 100, dikteMm: 300 };

test('een sparing erft de standaardmaten van haar soort', () => {
  const raam = normaliseerSparing({ soort: 'raam', hartMm: 1000 });
  assert.equal(raam.dagmaatMm, SPARING_STANDAARD.raam.dagmaatMm);
  assert.equal(raam.borstweringMm, 850);
  assert.equal(raam.hoogteMm, 1500);
  const deur = normaliseerSparing({ soort: 'deur', hartMm: 0, dagmaatMm: 830 });
  assert.equal(deur.dagmaatMm, 830, 'een opgegeven dagmaat wint');
  assert.equal(deur.borstweringMm, 0, 'een deur heeft geen borstwering');
  assert.equal(normaliseerSparing({ soort: 'onzin' }).soort, 'deur', 'onbekende soort valt terug');
});

test('de sparing zit in de wand: dag breed, wand diep, wandhoek', () => {
  const p = sparingPlaatsing(wandOW, { id: 's1', soort: 'deur', dagmaatMm: 900, hartMm: 2000 }, K);
  assert.equal(p.breedtePt, 450);
  assert.equal(p.diktePt, 150, 'de diepte is de wanddikte, niet het symbool');
  assert.equal(p.rotatie, 0);
  assert.deepEqual(p.hart, { x: 1000, y: 100 });
  assert.deepEqual(p.van, { x: 775, y: 100 });
  assert.deepEqual(p.tot, { x: 1225, y: 100 });
  const vak = sparingSymboolVak(p);
  assert.deepEqual(vak, { x: 775, y: 25, width: 450, height: 150, rotation: 0 });
});

test('een sparing in een schuine wand neemt de hoek van de wand over', () => {
  const schuin = { id: 'w', startX: 0, startY: 0, endX: 0, endY: 1000, dikteMm: 200 };
  const p = sparingPlaatsing(schuin, { soort: 'raam', dagmaatMm: 1000, hartMm: 1000 }, K);
  assert.equal(Math.round(p.rotatie), 90);
  assert.deepEqual(p.hart, { x: 0, y: 500 });
});

test('de wand wordt opgeknipt: de arcering stopt bij de dag', () => {
  const sparingen = [
    { id: 'd1', soort: 'deur', dagmaatMm: 900, hartMm: 2000 },   // 775 … 1225 pt
    { id: 'r1', soort: 'raam', dagmaatMm: 1200, hartMm: 6000 },  // 2700 … 3300 pt
  ];
  const { segmenten, lengteMm } = wandMetSparingen(wandOW, sparingen, K);
  assert.equal(lengteMm, 10000);
  assert.equal(segmenten.length, 3);
  assert.deepEqual(segmenten.map((s) => [s.vanPt, s.totPt]), [[0, 775], [1225, 2700], [3300, 5000]]);
  assert.deepEqual(segmenten[0], {
    startX: 0, startY: 100, endX: 775, endY: 100, vanPt: 0, totPt: 775, lengteMm: 1550,
  });
  // De som van de solide stukken plus de dagmaten is de hele wand.
  const solide = segmenten.reduce((s, g) => s + g.lengteMm, 0);
  assert.equal(solide + 900 + 1200, 10000);
});

test('een sparing tegen de hoek levert geen segment van niets op', () => {
  const { segmenten } = wandMetSparingen(wandOW, [{ soort: 'deur', dagmaatMm: 900, hartMm: 450 }], K);
  assert.equal(segmenten.length, 1, 'alleen het stuk NA de deur blijft over');
  assert.equal(segmenten[0].vanPt, 450);
  assert.equal(segmenten[0].totPt, 5000);
});

test('sparingen die elkaar raken worden één gat', () => {
  const { segmenten } = wandMetSparingen(wandOW, [
    { id: 'a', soort: 'raam', dagmaatMm: 1000, hartMm: 2000 },   // 750 … 1250
    { id: 'b', soort: 'raam', dagmaatMm: 1000, hartMm: 2800 },   // 1150 … 1650
  ], K);
  assert.deepEqual(segmenten.map((s) => [s.vanPt, s.totPt]), [[0, 750], [1650, 5000]]);
});

test('de controle weigert wat er bouwkundig niet in past', () => {
  const past = { soort: 'deur', dagmaatMm: 900, hartMm: 2000 };
  assert.deepEqual(controleerSparing(wandOW, past, [], K), { ok: true });

  const steektUit = controleerSparing(wandOW, { soort: 'deur', dagmaatMm: 900, hartMm: 9800 }, [], K);
  assert.equal(steektUit.ok, false);
  assert.match(steektUit.reden, /outside the wall/);

  const geenPenant = controleerSparing(wandOW, { soort: 'deur', dagmaatMm: 900, hartMm: 450 }, [], K, 200);
  assert.equal(geenPenant.ok, false, 'met een geëiste penant past hij niet tegen de hoek');

  const botst = controleerSparing(
    wandOW, { id: 'b', soort: 'raam', dagmaatMm: 1000, hartMm: 2400 },
    [{ id: 'a', soort: 'raam', dagmaatMm: 1000, hartMm: 2000 }], K,
  );
  assert.equal(botst.ok, false);
  assert.match(botst.reden, /overlaps another opening/);

  // Dezelfde sparing opnieuw controleren botst niet met zichzelf.
  assert.deepEqual(
    controleerSparing(wandOW, { id: 'a', soort: 'raam', dagmaatMm: 1000, hartMm: 2000 },
      [{ id: 'a', soort: 'raam', dagmaatMm: 1000, hartMm: 2000 }], K),
    { ok: true },
  );
});

test('een aangewezen punt wordt een plaats langs de wand', () => {
  assert.equal(hartUitPunt(wandOW, { x: 1000, y: 140 }, K), 2000);
  assert.equal(hartUitPunt(wandOW, { x: -500, y: 100 }, K), 0, 'buiten de wand wordt geklemd');
  assert.equal(hartUitPunt(wandOW, { x: 9999, y: 100 }, K), 10000);
});

test('de sparing schuift mee als de wand verschuift', () => {
  const sparing = { id: 's', soort: 'deur', dagmaatMm: 900, hartMm: 2000 };
  const voor = sparingPlaatsing(wandOW, sparing, K);
  const verschoven = { ...wandOW, startY: 300, endY: 300 };
  const na = sparingPlaatsing(verschoven, sparing, K);
  assert.equal(na.hart.x, voor.hart.x);
  assert.equal(na.hart.y, voor.hart.y + 200);
  // En dieper als de wand dikker wordt.
  const dikker = sparingPlaatsing({ ...wandOW, dikteMm: 400 }, sparing, K);
  assert.equal(dikker.diktePt, 200);
  assert.equal(dikker.breedtePt, voor.breedtePt, 'de dagmaat verandert niet mee');
});
