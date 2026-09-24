import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPOUWMUUR_STANDAARD, KOZIJN_IN_SPOUW, normaliseerPakket, kozijnInPakket,
  laagSparingMm, laagLijnen, zoekLaagHoek,
} from './spouwmuur.js';

const bijna = (a, b, tol = 1e-6, wat = '') => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);
const K = 0.5;

test('de standaard spouwmuur: 100 metselwerk, 40 spouw, 100 isolatie, 120 kalkzandsteen', () => {
  const p = normaliseerPakket(SPOUWMUUR_STANDAARD);
  assert.equal(p.dikteMm, 360);
  assert.deepEqual(p.lagen.map((l) => [l.v0Mm, l.v1Mm, l.rol, l.getekend]), [
    [0, 100, 'blad', true],
    [100, 140, 'lucht', false],
    [140, 240, 'isolatie', true],
    [240, 360, 'blad', true],
  ]);
  assert.equal(KOZIJN_IN_SPOUW.aanslagMm, 20);
  assert.ok(KOZIJN_IN_SPOUW.spelingMm > 0);
});

test('lagen zonder materiaal krijgen een zinnig materiaal', () => {
  const p = normaliseerPakket([
    { thicknessMm: 100 }, { thicknessMm: 40 }, { thicknessMm: 100, insulation: 'pir' }, { thicknessMm: 120 },
  ]);
  assert.deepEqual(p.lagen.map((l) => l.materiaal), [
    'nen47-metselwerk-baksteen', 'none', 'isolatie', 'nen47-metselwerk-kunststeen',
  ]);
  assert.equal(p.lagen[2].isolatie, 'pir');
  // Engelse en Nederlandse sleutels allebei.
  const q = normaliseerPakket([{ dikteMm: 90, materiaal: 'nen47-beton-gewapend' }]);
  assert.equal(q.dikteMm, 90);
  assert.equal(q.lagen[0].materiaal, 'nen47-beton-gewapend');
});

test('het kozijn staat standaard in de spouw, direct achter het buitenblad', () => {
  const p = normaliseerPakket(SPOUWMUUR_STANDAARD);
  const k = kozijnInPakket(p, {});
  assert.equal(k.positieMm, 100);
  assert.equal(k.diepteMm, 114);
  assert.equal(k.aanslagMm, 20);
  assert.equal(k.spelingMm, KOZIJN_IN_SPOUW.spelingMm);
  // Instelbaar, en binnen het pakket gehouden.
  assert.equal(kozijnInPakket(p, { positieMm: 126 }).positieMm, 126);
  assert.equal(kozijnInPakket(p, { positieMm: 999 }).positieMm, 360 - 114);
  assert.equal(kozijnInPakket(p, { aanslagMm: 0 }).aanslagMm, 0, 'geen aanslag mag ook');
});

test('een enkele wand: kozijn in het midden, zonder aanslag of speling', () => {
  const p = normaliseerPakket([{ dikteMm: 300, materiaal: 'nen47-beton-gewapend' }]);
  const k = kozijnInPakket(p, {});
  assert.equal(k.positieMm, (300 - 114) / 2);
  assert.equal(k.aanslagMm, 0);
  assert.equal(k.spelingMm, 0);
  const dun = kozijnInPakket(normaliseerPakket([{ dikteMm: 100 }]), {});
  assert.equal(dun.diepteMm, 100, 'binnenwand: kozijn gelijk aan de wand');
  assert.equal(dun.positieMm, 0);
});

test('de sparing per laag: aanslag in het buitenblad, isolatie tegen het kozijn, speling in het binnenblad', () => {
  const p = normaliseerPakket(SPOUWMUUR_STANDAARD);
  const k = { breedteMm: 1200, ...kozijnInPakket(p, {}) };
  const [buitenblad, spouw, isolatie, binnenblad] = p.lagen;
  assert.equal(laagSparingMm(buitenblad, k), 1200 - 2 * 20, 'metselwerk iets smaller dan het kozijn');
  assert.equal(laagSparingMm(spouw, k), 1200);
  assert.equal(laagSparingMm(isolatie, k), 1200, 'isolatie sluit tegen het kozijn');
  assert.equal(laagSparingMm(binnenblad, k), 1200 + 2 * KOZIJN_IN_SPOUW.spelingMm, 'dagkant met speling');

  // Kozijn verder naar binnen (in het binnenblad): het binnenblad sluit aan.
  const diep = { breedteMm: 1200, ...kozijnInPakket(p, { positieMm: 240 }) };
  assert.equal(laagSparingMm(binnenblad, diep), 1200);
  assert.equal(laagSparingMm(isolatie, diep), 1200 - 40, 'alles ervoor heeft aanslag');
});

test('laaglijnen: de getekende lijn is het buitenvlak, de lagen liggen aan de binnenzijde', () => {
  const p = normaliseerPakket(SPOUWMUUR_STANDAARD);
  const lijnen = laagLijnen({ x: 0, y: 0 }, { x: 1000, y: 0 }, p, K, 'rechts');
  // Rechts van de tekenrichting (+x) is +y in schermcoördinaten.
  assert.deepEqual(lijnen.map((l) => l.startY), [25, 60, 95, 150]);
  const links = laagLijnen({ x: 0, y: 0 }, { x: 1000, y: 0 }, p, K, 'links');
  assert.deepEqual(links.map((l) => l.startY), [-25, -60, -95, -150]);
});

test('hoek: het laageinde van de vorige gevel wordt gevonden en verstekt', () => {
  const p = normaliseerPakket(SPOUWMUUR_STANDAARD);
  // Noordgevel west→oost, eindigt in de hoek (1000, 0); binnenzijde rechts.
  const noord = laagLijnen({ x: 0, y: 0 }, { x: 1000, y: 0 }, p, K, 'rechts');
  const wanden = noord.filter((l) => l.getekend).map((l, i) => ({
    id: `n${i}`, type: 'wall', page: 1, startX: l.startX, startY: l.startY, endX: l.endX, endY: l.endY,
    dikteMm: l.dikteMm, hatchPattern: l.materiaal,
  }));
  // Oostgevel noord→zuid vanuit dezelfde hoek.
  const oost = laagLijnen({ x: 1000, y: 0 }, { x: 1000, y: 800 }, p, K, 'rechts');
  const binnenblad = oost[3];
  const hoek = zoekLaagHoek({ x: 1000, y: 0 }, binnenblad, wanden, { pxPerMm: K, binnenzijde: 'rechts' });
  assert.ok(hoek, 'de noordgevel sluit hier aan');
  assert.equal(hoek.wand.id, 'n2', 'de binnenbladlaag van de noordgevel');
  assert.equal(hoek.eind, 'end');
  // Binnenblad hart op 300 mm van het buitenvlak = 150 pt: hoek op (850, 150).
  bijna(hoek.snijpunt.x, 850, 1e-9, 'x');
  bijna(hoek.snijpunt.y, 150, 1e-9, 'y');

  // De isolatie vindt de isolatie, niet het metselwerk.
  const iso = zoekLaagHoek({ x: 1000, y: 0 }, oost[2], wanden, { pxPerMm: K, binnenzijde: 'rechts' });
  assert.equal(iso.wand.id, 'n1');
  bijna(iso.snijpunt.x, 1000 - 95, 1e-9, 'isolatiehoek');
});

test('geen hoek zonder aansluitende gevel, en geen hoek bij een doorlopende wand', () => {
  const p = normaliseerPakket(SPOUWMUUR_STANDAARD);
  const oost = laagLijnen({ x: 1000, y: 0 }, { x: 1000, y: 800 }, p, K, 'rechts');
  assert.equal(zoekLaagHoek({ x: 1000, y: 0 }, oost[0], [], { pxPerMm: K, binnenzijde: 'rechts' }), null);
  // Een gevel in het verlengde (evenwijdig) is geen hoek.
  const verder = laagLijnen({ x: 1000, y: 800 }, { x: 1000, y: 1600 }, p, K, 'rechts');
  const wanden = oost.filter((l) => l.getekend).map((l, i) => ({
    id: `o${i}`, type: 'wall', page: 1, startX: l.startX, startY: l.startY, endX: l.endX, endY: l.endY,
    dikteMm: l.dikteMm, hatchPattern: l.materiaal,
  }));
  assert.equal(zoekLaagHoek({ x: 1000, y: 800 }, verder[0], wanden, { pxPerMm: K, binnenzijde: 'rechts' }), null);
});

test('ruimteherkenning: de laagringen van een spouwmuur zijn geen ruimten, een schacht in een ruimte wel', async () => {
  const { ruimtenUitWanden } = await import('./ruimte.js');
  const lus = (x0, y0, x1, y1, dikteMm, id) => [
    { id: `${id}n`, startX: x0, startY: y0, endX: x1, endY: y0, dikteMm },
    { id: `${id}o`, startX: x1, startY: y0, endX: x1, endY: y1, dikteMm },
    { id: `${id}z`, startX: x1, startY: y1, endX: x0, endY: y1, dikteMm },
    { id: `${id}w`, startX: x0, startY: y1, endX: x0, endY: y0, dikteMm },
  ];
  // Drie geneste laaglussen (hartlijnen 50, 190 en 300 mm van het buitenvlak).
  const lagen = [...lus(25, 25, 4975, 3975, 100, 'b'), ...lus(95, 95, 4905, 3905, 100, 'i'), ...lus(150, 150, 4850, 3850, 120, 'k')];
  const { ruimten } = ruimtenUitWanden(lagen, { pxPerMm: K });
  assert.equal(ruimten.length, 1);
  bijna(ruimten[0].oppervlakteM2, 9.28 * 7.28, 0.01, 'binnen het binnenblad');

  // Een ruimte van 10 x 8 m met een losse schacht van 1 x 1 m erin.
  const woning = [...lus(0, 0, 5000, 4000, 300, 'w'), ...lus(2000, 2000, 2500, 2500, 100, 's')];
  const r2 = ruimtenUitWanden(woning, { pxPerMm: K }).ruimten;
  assert.equal(r2.length, 2, 'de ruimte blijft, naast de schacht');
});
