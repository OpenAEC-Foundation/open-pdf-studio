// Drukgevoelige inkt (#385): opslaan en heropenen met de echte saver en de
// echte lader (rondgang.testhulp.mjs).
//
// - /InkList blijft de middellijn, /BS /W de grootste breedte: een andere
//   lezer toont een gewone inktlijn met vaste breedte;
// - de appearance is een gevuld vlak (f) dat de variabele breedte toont;
// - de druk per punt, de minimale breedte en de gladheid komen terug, ook na
//   een tweede opslag en op een gedraaide pagina;
// - een muisstreek (zonder druk) blijft een lijn met vaste breedte (S).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';

const basis = {
  page: 1, rotation: 0, color: '#1144cc', strokeColor: '#1144cc', fillColor: null,
  lineWidth: 6, borderStyle: 'solid', opacity: 1, author: 'Tester',
  createdAt: '2026-10-27T10:00:00.000Z', modifiedAt: '2026-10-27T10:00:00.000Z',
};

function golf(n = 30) {
  const path = [], pressures = [];
  for (let i = 0; i < n; i++) {
    path.push({ x: 100 + i * 8, y: 300 + Math.sin(i / 4) * 30 });
    pressures.push(Math.round((0.15 + 0.8 * (i / (n - 1))) * 1000) / 1000);
  }
  return { path, pressures };
}

async function rondgang(modellen, { keer = 1, rotatie = 0 } = {}) {
  let bytes = await leegBlad({ rotatie });
  let huidig = modellen;
  for (let i = 0; i < keer; i++) {
    bytes = await opslaan(bytes, huidig);
    huidig = await laad(bytes);
  }
  return { modellen: huidig, bytes };
}

async function inkDict(bytes) {
  const lijst = await woordenboeken(bytes);
  const inkt = lijst.filter(({ dict }) => String(dict.get(PDFName.of('Subtype'))) === '/Ink');
  assert.equal(inkt.length, 1, 'precies één /Ink');
  const ctx = lijst.doc.context;
  const { dict } = inkt[0];
  const ap = ctx.lookup(dict.get(PDFName.of('AP')));
  const n = ap && ctx.lookup(ap.get(PDFName.of('N')));
  const inhoud = n ? Buffer.from(n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : n.getContents()).toString('latin1') : '';
  return { dict, ctx, inhoud };
}

test('pen-streek: /InkList is de middellijn, de appearance een gevuld vlak, de druk komt terug', async () => {
  const { path, pressures } = golf();
  const ann = { ...basis, id: 'pen', type: 'draw', path, pressures, inkMinWidth: 20, inkSmoothing: 60 };
  const { modellen, bytes } = await rondgang([ann]);

  const { dict, ctx, inhoud } = await inkDict(bytes);
  const inkList = ctx.lookup(dict.get(PDFName.of('InkList')));
  assert.equal(inkList.size(), 1, 'één streek');
  assert.equal(ctx.lookup(inkList.get(0)).size(), path.length * 2, 'de middellijn: elk punt één keer');
  const bs = ctx.lookup(dict.get(PDFName.of('BS')));
  assert.equal(ctx.lookup(bs.get(PDFName.of('W'))).asNumber(), 6, 'terugval voor andere lezers: vaste breedte');
  assert.match(inhoud, /\brg\b/, 'vulkleur');
  assert.match(inhoud, /\nf\n?$/m, 'gevuld (nonzero)');
  assert.doesNotMatch(inhoud, /\bS\n/, 'geen lijn: de breedte zit in het vlak');
  assert.ok(dict.get(PDFName.of('OPS_InkPressure')), 'druk per punt in een eigen sleutel');

  assert.equal(modellen.length, 1);
  const [m] = modellen;
  assert.equal(m.type, 'draw');
  assert.equal(m.path.length, path.length);
  assert.deepEqual(m.pressures, pressures);
  assert.equal(m.inkMinWidth, 20);
  assert.equal(m.inkSmoothing, 60);
  assert.equal(m.lineWidth, 6);
  m.path.forEach((p, i) => {
    assert.ok(Math.abs(p.x - path[i].x) < 0.01 && Math.abs(p.y - path[i].y) < 0.01, `punt ${i}`);
  });
});

test('twee keer opslaan: druk, gladheid en vorm blijven gelijk, geen dubbele annotatie', async () => {
  const { path, pressures } = golf(20);
  const ann = { ...basis, id: 'pen2', type: 'draw', path, pressures, inkMinWidth: 35, inkSmoothing: 40 };
  const een = await rondgang([ann], { keer: 1 });
  const twee = await rondgang([ann], { keer: 2 });
  assert.equal(twee.modellen.length, 1);
  assert.deepEqual(twee.modellen[0].pressures, een.modellen[0].pressures);
  assert.equal(twee.modellen[0].inkSmoothing, 40);
  assert.equal(twee.modellen[0].inkMinWidth, 35);
  const a = await inkDict(een.bytes), b = await inkDict(twee.bytes);
  // Dezelfde appearance na nogmaals opslaan (op de afronding van de
  // coördinaten in het bestand na).
  const getallen = (t) => t.match(/-?\d+(\.\d+)?/g).map(Number);
  const ga = getallen(a.inhoud), gb = getallen(b.inhoud);
  assert.equal(gb.length, ga.length, 'evenveel punten');
  assert.ok(ga.every((v, i) => Math.abs(v - gb[i]) < 0.01), 'dezelfde omtrek');
  assert.equal(b.inhoud.replace(/[\d.-]+/g, '#'), a.inhoud.replace(/[\d.-]+/g, '#'), 'dezelfde operatoren');
});

test('gedraaide pagina (90°): de streek en de druk komen terug waar ze getekend zijn', async () => {
  const { path, pressures } = golf(16);
  const ann = { ...basis, id: 'rot', type: 'draw', path, pressures, inkMinWidth: 25, inkSmoothing: 50 };
  const { modellen, bytes } = await rondgang([ann], { rotatie: 90, keer: 2 });
  assert.equal(modellen.length, 1);
  const [m] = modellen;
  assert.deepEqual(m.pressures, pressures);
  m.path.forEach((p, i) => {
    assert.ok(Math.abs(p.x - path[i].x) < 0.02 && Math.abs(p.y - path[i].y) < 0.02, `punt ${i}: ${p.x},${p.y}`);
  });
  const { inhoud } = await inkDict(bytes);
  assert.match(inhoud, /\nf\n?$/m);
});

test('druk uitgezet: blijft bewaard, de appearance is een lijn met vaste breedte', async () => {
  const { path, pressures } = golf(12);
  const ann = { ...basis, id: 'uit', type: 'draw', path, pressures, inkMinWidth: 30, inkSmoothing: 50, inkPressure: false };
  const { modellen, bytes } = await rondgang([ann]);
  const [m] = modellen;
  assert.equal(m.inkPressure, false);
  assert.deepEqual(m.pressures, pressures, 'de druk zelf gaat niet verloren');
  const { inhoud } = await inkDict(bytes);
  assert.match(inhoud, /^6 w$/m);
  assert.match(inhoud, /\nS\n?$/m);
});

test('gestreepte streek: de appearance is gestreept, ook met druk (andere lezers tonen het patroon)', async () => {
  const { path, pressures } = golf(16);
  const ann = { ...basis, id: 'streep', type: 'draw', path, pressures, inkMinWidth: 30, inkSmoothing: 50, borderStyle: 'dashed' };
  const { modellen, bytes } = await rondgang([ann]);
  const { dict, ctx, inhoud } = await inkDict(bytes);
  assert.match(inhoud, /^\[3 4\] 0 d$/m, 'dash-operator in de /AP');
  assert.match(inhoud, /^6 w$/m, 'volle breedte');
  assert.match(inhoud, /\nS\n?$/m, 'getrokken, niet gevuld');
  assert.doesNotMatch(inhoud, /^f$/m);
  const bs = ctx.lookup(dict.get(PDFName.of('BS')));
  assert.equal(String(bs.get(PDFName.of('S'))), '/D', '/BS blijft gestreept');
  const [m] = modellen;
  assert.equal(m.borderStyle, 'dashed');
  assert.deepEqual(m.pressures, pressures, 'de druk blijft bewaard');
});

test('muisstreek (geen druk): vaste breedte, gladde lijn, geen druksleutel', async () => {
  const path = [{ x: 100, y: 100 }, { x: 140, y: 130 }, { x: 180, y: 110 }, { x: 220, y: 150 }];
  const ann = { ...basis, id: 'muis', type: 'draw', path, lineWidth: 3, inkSmoothing: 50 };
  const { modellen, bytes } = await rondgang([ann]);
  const { dict, inhoud } = await inkDict(bytes);
  assert.equal(dict.get(PDFName.of('OPS_InkPressure')), undefined);
  assert.match(inhoud, /^3 w$/m, 'de lijndikte zelf');
  assert.match(inhoud, /^1 J$/m, 'ronde kappen');
  const [m] = modellen;
  assert.equal(m.pressures, undefined);
  assert.equal(m.inkSmoothing, 50);
});

test('oude streek zonder inkt-eigenschappen: blijft precies zoals hij was (geen eigen sleutels)', async () => {
  const path = [{ x: 300, y: 300 }, { x: 340, y: 330 }, { x: 380, y: 310 }];
  const { modellen, bytes } = await rondgang([{ ...basis, id: 'oud', type: 'draw', path, lineWidth: 2 }]);
  const { dict } = await inkDict(bytes);
  for (const k of ['OPS_InkPressure', 'OPS_InkSmoothing', 'OPS_InkMinWidth']) {
    assert.equal(dict.get(PDFName.of(k)), undefined, k);
  }
  assert.equal(modellen[0].inkSmoothing, undefined);
  assert.equal(modellen[0].pressures, undefined);
});

test('druk die niet bij de punten past (ander programma bewerkte de streek): valt weg', async () => {
  const { inktUitBestand } = await import('./loader/inkt-uit-bestand.js');
  assert.deepEqual(inktUitBestand({ inkPressures: [0.1, 0.5], inkSmoothing: 20 }, 3), { inkSmoothing: 20 });
  assert.deepEqual(inktUitBestand({ inkPressures: [0.1, 0.5, 0.9], inkMinWidth: 40 }, 3),
    { pressures: [0.1, 0.5, 0.9], inkMinWidth: 40 });
});
