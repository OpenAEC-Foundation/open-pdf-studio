// Drukgevoelige inkt (#385): breedte uit druk, gladmaken, de gevulde omtrek
// (geen uitschieters of gaten bij scherpe hoeken, ronde kappen), de
// coalesced monsters, palmafwijzing en de terugval van de muis (vaste
// breedte). Pure geometrie: geen app-modules, geen zwaar werk.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breedteUitDruk, klemDruk, klemMinBreedte, klemGladheid, drukReeksVoorOpslag, inktEigenschappen,
  heeftDruk, isGladdeInkt, breedtesVan, gladFilter, catmullRom, gladdeStreek, omtrekRingen,
  inktGeometrie, inktAppearanceInhoud, monstersVanEvent, maakPalmFilter, aanwijzerMetDruk,
} from './pressure-ink.js';

const bijna = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/** Afstand van punt p tot de polylijn. */
function afstandTotLijn(p, lijn) {
  if (lijn.length === 1) return Math.hypot(p.x - lijn[0].x, p.y - lijn[0].y);
  let best = Infinity;
  for (let i = 0; i < lijn.length - 1; i++) {
    const a = lijn[i], b = lijn[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Windingsgetal van p over alle ringen samen (nonzero: ≠ 0 is gevuld). */
function winding(p, ringen) {
  let w = 0;
  for (const ring of ringen) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const kruis = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y) { if (b.y > p.y && kruis > 0) w++; }
      else if (b.y <= p.y && kruis < 0) w--;
    }
  }
  return w;
}

function geldigeRingen(ringen) {
  for (const ring of ringen) {
    assert.ok(ring.length >= 3, 'een ring heeft minstens drie punten');
    for (const p of ring) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'geen NaN/Infinity');
  }
}

/** Geen uitschieter: elk omtrekpunt ligt binnen de halve breedte van de middellijn. */
function geenUitschieters(ringen, lijn, maxHalf) {
  for (const ring of ringen) {
    for (const p of ring) {
      const d = afstandTotLijn(p, lijn);
      assert.ok(d <= maxHalf + 1e-6, `omtrekpunt (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) ligt ${d.toFixed(3)} van de lijn (max ${maxHalf})`);
    }
  }
}

/** Elk punt van de middellijn (en tussenpunten) is gevuld. */
function middellijnGevuld(ringen, lijn) {
  for (let i = 0; i < lijn.length - 1; i++) {
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const p = { x: lijn[i].x + (lijn[i + 1].x - lijn[i].x) * t, y: lijn[i].y + (lijn[i + 1].y - lijn[i].y) * t };
      assert.notEqual(winding(p, ringen), 0, `middellijn bij segment ${i}, t=${t} is niet gevuld (gat)`);
    }
  }
  assert.notEqual(winding(lijn[lijn.length - 1], ringen), 0, 'eindpunt gevuld');
}

/** Rond elk punt van de middellijn is de streek gevuld (geen gat binnen de breedte). */
function lichaamGevuld(ringen, lijn, breedtes, deel = 0.6) {
  lijn.forEach((c, i) => {
    const r = (breedtes[i] / 2) * deel;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const p = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
      assert.notEqual(winding(p, ringen), 0, `gat bij punt ${i} richting ${k}`);
    }
  });
}

// ── Breedte uit druk ────────────────────────────────────────────────────────

test('breedte uit druk: min bij 0, max bij 1, lineair ertussen, geklemd', () => {
  assert.equal(breedteUitDruk(0, 10, 30), 3);
  assert.equal(breedteUitDruk(1, 10, 30), 10);
  assert.ok(bijna(breedteUitDruk(0.5, 10, 30), 6.5));
  assert.equal(breedteUitDruk(2, 10, 30), 10, 'druk boven 1 wordt 1');
  assert.equal(breedteUitDruk(-1, 10, 30), 3, 'druk onder 0 wordt 0');
  assert.ok(bijna(breedteUitDruk(NaN, 10, 30), 6.5), 'onbekende druk: de helft');
  assert.equal(breedteUitDruk(0, 10, 100), 10, 'min 100 %: vaste breedte');
  assert.equal(breedteUitDruk(0, 10, 0), 0.5, 'min wordt nooit kleiner dan 5 %');
  assert.equal(breedteUitDruk(1, 0, 30), 2, 'zonder geldige lijndikte: 2');
  assert.equal(klemDruk(undefined), 0.5);
  assert.equal(klemMinBreedte('abc'), 30);
  assert.equal(klemGladheid(150), 100);
  assert.equal(klemGladheid(-3), 0);
});

test('drukreeks: zonder variatie (muis, pen zonder sensor) geen druk; anders afgerond', () => {
  assert.equal(drukReeksVoorOpslag([0.5, 0.5, 0.5]), null);
  assert.equal(drukReeksVoorOpslag([0, 0, 0.01]), null);
  assert.deepEqual(drukReeksVoorOpslag([0.12345, 0.9, 1.4]), [0.123, 0.9, 1]);
  assert.equal(drukReeksVoorOpslag([0.1, 0.9], 3), null, 'aantal moet bij de punten passen');
  assert.equal(drukReeksVoorOpslag(null), null);
});

test('muis: vaste breedte — geen druk in het model, elke breedte de lijndikte', () => {
  assert.equal(aanwijzerMetDruk('mouse'), false);
  assert.equal(aanwijzerMetDruk('touch'), false);
  assert.equal(aanwijzerMetDruk('pen'), true);
  const prefs = { drawSmoothing: 40, drawPressureMinWidth: 25 };
  // De muis meldt 0,5 bij een ingedrukte knop; ook met variatie telt hij niet.
  const muis = inktEigenschappen(prefs, { metDruk: false, drukken: [0.5, 0.2, 0.9] }, 3);
  assert.deepEqual(muis, { inkSmoothing: 40 });
  const ann = { type: 'draw', path: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }], lineWidth: 4, ...muis };
  assert.equal(heeftDruk(ann), false);
  assert.deepEqual(breedtesVan(ann), [4, 4, 4]);
  const geo = inktGeometrie(ann);
  assert.equal(geo.variabel, false, 'een muisstreek wordt een lijn, geen vlak');
  assert.ok(geo.breedtes.every((w) => w === 4));
  assert.match(inktAppearanceInhoud(ann, (x) => x, (y) => 100 - y, [0, 0, 0]), /^4 w$/m);

  const pen = inktEigenschappen(prefs, { metDruk: true, drukken: [0.1, 0.5, 0.9] }, 3);
  assert.deepEqual(pen, { inkSmoothing: 40, pressures: [0.1, 0.5, 0.9], inkMinWidth: 25 });
  const penZonderSensor = inktEigenschappen(prefs, { metDruk: true, drukken: [0.5, 0.5, 0.5] }, 3);
  assert.equal(penZonderSensor.pressures, undefined, 'pen zonder druksensor: vaste breedte');
});

test('druk uit (inkPressure false) of niet passend: vaste breedte', () => {
  const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  assert.equal(heeftDruk({ path, pressures: [0.1, 0.9, 0.5] }), true);
  assert.equal(heeftDruk({ path, pressures: [0.1, 0.9, 0.5], inkPressure: false }), false);
  assert.equal(heeftDruk({ path, pressures: [0.1, 0.9] }), false);
  assert.deepEqual(breedtesVan({ path, pressures: [0, 1, 0.5], inkMinWidth: 50, lineWidth: 8 }), [4, 8, 6]);
  assert.equal(isGladdeInkt({ path }), false, 'oude streek: de oude kale polylijn');
  assert.equal(isGladdeInkt({ path, inkSmoothing: 0 }), false);
  assert.equal(isGladdeInkt({ path, inkSmoothing: 30 }), true);
});

// ── Gladmaken ───────────────────────────────────────────────────────────────

test('gladfilter: begin en eind blijven, ruis neemt af, sterkte 0 doet niets', () => {
  const ruis = Array.from({ length: 60 }, (_, i) => (i % 2 ? 1 : -1) + i * 0.1);
  const glad = gladFilter(ruis, 70);
  assert.equal(glad[0], ruis[0]);
  assert.equal(glad[glad.length - 1], ruis[ruis.length - 1]);
  const ruwheid = (r) => r.slice(2).reduce((s, v, i) => s + (v - 2 * r[i + 1] + r[i]) ** 2, 0);
  assert.ok(ruwheid(glad) < ruwheid(ruis) * 0.1, 'zigzag sterk gedempt');
  assert.deepEqual(gladFilter(ruis, 0), ruis);
  // Geen vertraging: een rechte lijn blijft (binnenin) op zijn plaats.
  const recht = Array.from({ length: 20 }, (_, i) => i);
  gladFilter(recht, 80).forEach((v, i) => assert.ok(Math.abs(v - i) < 1.5, `geen naijlen bij ${i}`));
});

test('catmull-rom: gaat door elk punt, verfijnt, waarden lineair mee', () => {
  const punten = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }];
  const { punten: uit, waarden } = catmullRom(punten, [1, 2, 3, 4], { stap: 1 });
  assert.ok(uit.length > 30, 'verfijnd');
  for (const p of punten) assert.ok(uit.some((q) => bijna(q.x, p.x, 1e-9) && bijna(q.y, p.y, 1e-9)), 'door elk invoerpunt');
  assert.equal(waarden[0], 1);
  assert.equal(waarden[waarden.length - 1], 4);
  for (const q of uit) assert.ok(q.y > -3 && q.y < 13, 'geen grote doorschieter');
});

test('gladde streek: zonder gladheid de punten zelf, met gladheid hetzelfde begin en eind', () => {
  const path = [{ x: 0, y: 0 }, { x: 5, y: 1 }, { x: 10, y: -1 }, { x: 15, y: 1 }, { x: 20, y: 0 }];
  const kaal = gladdeStreek(path, [2, 2, 2, 2, 2], 0);
  assert.deepEqual(kaal.punten, path);
  const glad = gladdeStreek(path, [2, 2, 2, 2, 2], 60);
  assert.deepEqual(glad.punten[0], path[0]);
  assert.deepEqual(glad.punten[glad.punten.length - 1], path[path.length - 1]);
  assert.ok(Math.max(...glad.punten.map((p) => Math.abs(p.y))) < 1, 'de zigzag is afgevlakt');
});

// ── Omtrek ──────────────────────────────────────────────────────────────────

test('omtrek van een rechte streek: één ring, ronde kappen voorbij de eindpunten', () => {
  const lijn = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  const ringen = omtrekRingen(lijn, [2, 6, 2]);
  geldigeRingen(ringen);
  assert.equal(ringen.length, 1);
  geenUitschieters(ringen, lijn, 3);
  middellijnGevuld(ringen, lijn);
  const xs = ringen[0].map((p) => p.x);
  assert.ok(bijna(Math.min(...xs), -1, 0.05), 'beginkap: halve breedte voor het beginpunt');
  assert.ok(bijna(Math.max(...xs), 21, 0.05), 'eindkap: halve breedte na het eindpunt');
  const ys = ringen[0].map((p) => p.y);
  assert.ok(bijna(Math.max(...ys), 3, 1e-9), 'in het midden de volle breedte');
  assert.equal(winding({ x: 10, y: 3.5 }, ringen), 0, 'naast de streek leeg');
});

test('scherpe hoek (haarspeld en V): geen uitschieters, geen gaten', () => {
  for (const lijn of [
    [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 1 }],            // haarspeld, bijna 180°
    [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 8 }],            // spitse V
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], // twee rechte hoeken
  ]) {
    const ringen = omtrekRingen(lijn, lijn.map(() => 8));
    geldigeRingen(ringen);
    geenUitschieters(ringen, lijn, 4);
    middellijnGevuld(ringen, lijn);
    lichaamGevuld(ringen, lijn, lijn.map(() => 8));
  }
});

test('krappe bocht smaller dan de streek en een zigzag: geen uitschieters, geen gaten', () => {
  const spiraal = Array.from({ length: 80 }, (_, i) => ({ x: Math.cos(i / 4) * (1 + i / 20), y: Math.sin(i / 4) * (1 + i / 20) }));
  const breed = spiraal.map((_, i) => 4 + 4 * Math.sin(i / 7) ** 2);
  const ringen = omtrekRingen(spiraal, breed);
  geldigeRingen(ringen);
  geenUitschieters(ringen, spiraal, 4);
  middellijnGevuld(ringen, spiraal);
  lichaamGevuld(ringen, spiraal, breed);

  const zigzag = Array.from({ length: 30 }, (_, i) => ({ x: i * 1.2, y: i % 2 ? 3 : 0 }));
  const zr = omtrekRingen(zigzag, zigzag.map((_, i) => 1 + (i % 5)));
  geldigeRingen(zr);
  geenUitschieters(zr, zigzag, 2.5);
  middellijnGevuld(zr, zigzag);
  lichaamGevuld(zr, zigzag, zigzag.map((_, i) => 1 + (i % 5)));
});

test('breedtesprong (dikke punt naast dunne): de grote cirkel, geen omgeslagen ring', () => {
  const lijn = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const ringen = omtrekRingen(lijn, [0.5, 10]);
  geldigeRingen(ringen);
  geenUitschieters(ringen, lijn, 5);
  middellijnGevuld(ringen, lijn);
});

test('één punt (een tik) wordt een stip; lege invoer niets', () => {
  const ringen = omtrekRingen([{ x: 5, y: 5 }], [4]);
  assert.equal(ringen.length, 1);
  geenUitschieters(ringen, [{ x: 5, y: 5 }], 2);
  assert.notEqual(winding({ x: 5, y: 5 }, ringen), 0);
  assert.deepEqual(omtrekRingen([], []), []);
  assert.deepEqual(omtrekRingen([{ x: 1, y: 1 }, { x: 1, y: 1 }], [3, 3]).length, 1, 'dubbele punten: één stip');
});

test('alle ringen hebben dezelfde omloop (nonzero voegt ze samen)', () => {
  const lijn = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 2 }, { x: 30, y: 4 }];
  const ringen = omtrekRingen(lijn, [3, 6, 3, 6]);
  assert.ok(ringen.length >= 2);
  const oppervlak = (r) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
  const tekens = ringen.map((r) => Math.sign(oppervlak(r)));
  assert.ok(tekens.every((t) => t === tekens[0]), `omloop ${tekens}`);
});

test('inktgeometrie van een pen-streek: gevuld, binnen de breedte, cache bij dezelfde streek', () => {
  const path = Array.from({ length: 40 }, (_, i) => ({ x: i * 3, y: Math.sin(i / 5) * 12 + (i % 2 ? 0.4 : -0.4) }));
  const ann = { type: 'draw', path, pressures: path.map((_, i) => i / 39), lineWidth: 6, inkMinWidth: 20, inkSmoothing: 60 };
  const geo = inktGeometrie(ann);
  assert.equal(geo.variabel, true);
  geldigeRingen(geo.ringen);
  geenUitschieters(geo.ringen, geo.punten, 3);
  middellijnGevuld(geo.ringen, geo.punten);
  lichaamGevuld(geo.ringen, geo.punten, geo.breedtes);
  assert.ok(geo.breedtes[0] < geo.breedtes[geo.breedtes.length - 1], 'dun begin, dik eind');
  assert.equal(inktGeometrie(ann), geo, 'zelfde streek: uit de cache');
  ann.path = path.map((p) => ({ x: p.x + 1, y: p.y }));
  assert.notEqual(inktGeometrie(ann), geo, 'verschoven: opnieuw berekend');
  const inhoud = inktAppearanceInhoud(ann, (x) => x, (y) => 500 - y, [1, 0, 0]);
  assert.match(inhoud, /^1 0 0 rg$/m);
  assert.match(inhoud, /^h$/m);
  assert.match(inhoud, /^f$/m);
});

// ── Invoer ──────────────────────────────────────────────────────────────────

test('coalesced monsters: alle tussenliggende metingen, anders het event zelf', () => {
  const e = {
    clientX: 30, clientY: 3, pressure: 0.7,
    getCoalescedEvents: () => [
      { clientX: 10, clientY: 1, pressure: 0.3 },
      { clientX: 20, clientY: 2, pressure: 0.5 },
      { clientX: 30, clientY: 3, pressure: 0.7 },
    ],
  };
  assert.deepEqual(monstersVanEvent(e).map((m) => m.pressure), [0.3, 0.5, 0.7]);
  assert.deepEqual(monstersVanEvent({ clientX: 1, clientY: 2, pressure: 0.4 }), [{ clientX: 1, clientY: 2, pressure: 0.4 }]);
  assert.equal(monstersVanEvent({ clientX: 1, clientY: 2, getCoalescedEvents: () => [] }).length, 1, 'lege lijst: het event zelf');
  assert.equal(monstersVanEvent({ clientX: 1, clientY: 2, getCoalescedEvents: () => { throw new Error('x'); } }).length, 1);
});

test('palmafwijzing: aanraking telt niet zolang de pen in de buurt is, of nooit met "alleen pen"', () => {
  const palm = maakPalmFilter({ nawerking: 500 });
  const vinger = { pointerType: 'touch' };
  assert.equal(palm.weiger(vinger, 0), false, 'zonder pen: een vinger mag tekenen');
  palm.noteer({ pointerType: 'pen' }, 1000);
  assert.equal(palm.weiger(vinger, 1200), true, 'pen zweeft/schrijft: de palm telt niet');
  assert.equal(palm.weiger(vinger, 1600), false, 'pen weg: de vinger weer wel');
  assert.equal(palm.weiger({ pointerType: 'mouse' }, 1200), false, 'een muis nooit');
  assert.equal(palm.weiger({ pointerType: 'pen' }, 1200), false, 'de pen zelf nooit');
  assert.equal(palm.weiger(vinger, 99999, { alleenPen: true }), true, 'alleen pen');
});
