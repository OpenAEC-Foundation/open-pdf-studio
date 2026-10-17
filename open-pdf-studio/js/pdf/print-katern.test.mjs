// Boeken in katernen (#607): een dik boek wordt niet één geniet boekje maar
// een stapel katernen van een vast aantal vellen; elk katern wordt apart
// gevouwen (en genaaid of gelijmd), de katernen op elkaar vormen het boek.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import {
  boekjeVolgorde, aantalBoekjeZijden, geldigKatern, KATERN_KEUZES, maakBoekje,
} from './print-boekje.js';

const A4_VEL = { breedteMm: 210, hoogteMm: 297 };
const nummers = (volgorde) => volgorde.zijden.map(([l, r]) => [l === null ? 0 : l + 1, r === null ? 0 : r + 1]);

test('geldigKatern: 0 = één boekje, anders een heel aantal vellen per katern', () => {
  assert.equal(geldigKatern(0), 0);
  assert.equal(geldigKatern('4'), 4);
  assert.equal(geldigKatern(-3), 0);
  assert.equal(geldigKatern('x'), 0);
  assert.equal(geldigKatern(2.6), 3);
  assert.equal(geldigKatern(999), 32);
  assert.deepEqual(KATERN_KEUZES, [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16]);
});

test('zonder katernen: precies het boekje van vroeger', () => {
  for (const n of [0, 1, 6, 8, 13, 20]) {
    const oud = boekjeVolgorde(n);
    const nul = boekjeVolgorde(n, 0);
    assert.deepEqual(nul.zijden, oud.zijden, `${n}`);
    assert.deepEqual(nul.vellen, oud.vellen, `${n}`);
    assert.equal(nul.katernen.length, n ? 1 : 0);
  }
});

test('20 pagina\'s in katernen van 2 vellen: 8 + 8 + 4 pagina\'s', () => {
  const v = boekjeVolgorde(20, 2);
  assert.equal(v.totaal, 20);
  assert.equal(v.blanco, 0);
  assert.deepEqual(v.katernen, [
    { start: 0, paginas: 8, vellen: 2 },
    { start: 8, paginas: 8, vellen: 2 },
    { start: 16, paginas: 4, vellen: 1 },
  ]);
  assert.deepEqual(nummers(v), [
    [8, 1], [2, 7], [6, 3], [4, 5],
    [16, 9], [10, 15], [14, 11], [12, 13],
    [20, 17], [18, 19],
  ]);
  assert.deepEqual(v.katernVanVel, [1, 1, 2, 2, 3]);
  assert.equal(aantalBoekjeZijden(20, 2), 10);
});

test('alleen het laatste katern wordt aangevuld met blanco pagina\'s', () => {
  const v = boekjeVolgorde(10, 2);
  assert.equal(v.totaal, 12);
  assert.equal(v.blanco, 2);
  assert.deepEqual(v.katernen.map((k) => k.paginas), [8, 4]);
  assert.deepEqual(nummers(v).slice(4), [[0, 9], [10, 0]]);
});

test('elk katern gevouwen en de katernen op elkaar: het boek leest van 1 tot het eind', () => {
  for (const [n, katern] of [[32, 4], [40, 4], [36, 8], [9, 1], [17, 3]]) {
    const v = boekjeVolgorde(n, katern);
    const lezing = [];
    let vel = 0;
    for (const k of v.katernen) {
      const vellen = v.vellen.slice(vel, vel + k.vellen);
      vel += k.vellen;
      for (let s = 0; s < vellen.length; s++) lezing.push(vellen[s].voor[1], vellen[s].achter[0]);
      for (let s = vellen.length - 1; s >= 0; s--) lezing.push(vellen[s].achter[1], vellen[s].voor[0]);
    }
    const echt = lezing.filter((i) => i < n);
    assert.deepEqual(echt, Array.from({ length: n }, (_, i) => i), `${n} pagina's, ${katern} vellen per katern`);
    assert.ok(v.katernen.slice(0, -1).every((k) => k.vellen === katern), 'volle katernen');
  }
});

test('maakBoekje met katernen: zoveel zijden als de katernvolgorde', async () => {
  const bron = await PDFDocument.create();
  for (let i = 0; i < 20; i++) bron.addPage([595, 842]);
  const uit = await maakBoekje(bron, { papier: A4_VEL, katern: 2 });
  assert.equal(uit.getPageCount(), 10);
  const een = await maakBoekje(bron, { papier: A4_VEL });
  assert.equal(een.getPageCount(), 10);
  const bron2 = await PDFDocument.create();
  for (let i = 0; i < 10; i++) bron2.addPage([595, 842]);
  assert.equal((await maakBoekje(bron2, { papier: A4_VEL, katern: 2 })).getPageCount(), 6);
  assert.equal((await maakBoekje(bron2, { papier: A4_VEL })).getPageCount(), 6);
  assert.equal((await maakBoekje(bron2, { papier: A4_VEL, katern: 1 })).getPageCount(), 6);
});
