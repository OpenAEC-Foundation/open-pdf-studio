import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import {
  rasterVan, isMeerPerBlad, celVoorVolgnummer, plaatsInCel, kiesBlad, maakMeerPerBlad,
  BLAD_MARGE_PT, MAX_PER_AS,
} from './print-meerperblad.js';

const A4 = { breedteMm: 210, hoogteMm: 297 };
const A4_PT = [595.276, 841.89];

test('rasterVan: vaste keuzes, eigen raster en onbekende waarden', () => {
  assert.deepEqual(rasterVan({ perBlad: 1 }), { kolommen: 1, rijen: 1 });
  assert.deepEqual(rasterVan({ perBlad: 2 }), { kolommen: 2, rijen: 1 });
  assert.deepEqual(rasterVan({ perBlad: '4' }), { kolommen: 2, rijen: 2 });
  assert.deepEqual(rasterVan({ perBlad: 6 }), { kolommen: 3, rijen: 2 });
  assert.deepEqual(rasterVan({ perBlad: 'custom', kolommen: 3, rijen: 5 }), { kolommen: 3, rijen: 5 });
  assert.deepEqual(rasterVan({ perBlad: 'custom', kolommen: 99, rijen: 0 }), { kolommen: MAX_PER_AS, rijen: 1 });
  assert.deepEqual(rasterVan({ perBlad: 'x' }), { kolommen: 1, rijen: 1 });
  assert.deepEqual(rasterVan(), { kolommen: 1, rijen: 1 });
  assert.equal(isMeerPerBlad({ kolommen: 1, rijen: 1 }), false);
  assert.equal(isMeerPerBlad({ kolommen: 2, rijen: 1 }), true);
});

test('celVoorVolgnummer: vier leesvolgordes in een 3 x 2 raster', () => {
  const rij = (volgorde) => Array.from({ length: 6 }, (_, k) => celVoorVolgnummer(k, 3, 2, volgorde))
    .map((c) => `${c.kol}${c.rij}`);
  assert.deepEqual(rij('horizontal'), ['00', '10', '20', '01', '11', '21']);
  assert.deepEqual(rij('horizontal-reversed'), ['20', '10', '00', '21', '11', '01']);
  assert.deepEqual(rij('vertical'), ['00', '01', '10', '11', '20', '21']);
  assert.deepEqual(rij('vertical-reversed'), ['20', '21', '10', '11', '00', '01']);
});

test('plaatsInCel: passend en gecentreerd binnen de cel', () => {
  const [bladB, bladH] = A4_PT;
  const p = plaatsInCel({ bladB, bladH, kolommen: 2, rijen: 1, kol: 0, rij: 0, paginaB: bladB, paginaH: bladH });
  assert.ok(p.schaal < 0.5 && p.schaal > 0.4);
  assert.ok(p.x >= BLAD_MARGE_PT - 1e-6);
  assert.ok(p.x + p.breedte <= bladB / 2 + 1e-6);
  assert.ok(p.y >= BLAD_MARGE_PT - 1e-6 && p.y + p.hoogte <= bladH - BLAD_MARGE_PT + 1e-6);
  const rechts = plaatsInCel({ bladB, bladH, kolommen: 2, rijen: 1, kol: 1, rij: 0, paginaB: bladB, paginaH: bladH });
  assert.ok(rechts.x > p.x + p.breedte);
});

test('kiesBlad: auto kiest de stand waarin de pagina het grootst komt', () => {
  const staandePagina = { breedte: 595, hoogte: 842 };
  const naast = kiesBlad({ papier: A4, eerstePagina: staandePagina, kolommen: 2, rijen: 1 });
  assert.ok(naast.bladB > naast.bladH, 'twee staande pagina\'s naast elkaar: liggend vel');
  const onder = kiesBlad({ papier: A4, eerstePagina: staandePagina, kolommen: 1, rijen: 2 });
  assert.ok(onder.bladB < onder.bladH, 'twee onder elkaar: staand vel');
  assert.ok(kiesBlad({ papier: A4, orientatie: 'portrait', eerstePagina: staandePagina, kolommen: 2, rijen: 1 }).bladB < 600);
  const onbekend = kiesBlad({ papier: null, orientatie: 'portrait', eerstePagina: { breedte: 800, hoogte: 600 }, kolommen: 2, rijen: 2 });
  assert.deepEqual([onbekend.bladB, onbekend.bladH], [600, 800]);
});

async function bron(aantal, maat = A4_PT) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < aantal; i++) doc.addPage(maat).drawText(`p${i + 1}`, { x: 50, y: 50 });
  return doc;
}

test('maakMeerPerBlad: 5 pagina\'s, 2 per vel -> 3 vellen, liggend A4', async () => {
  const uit = await maakMeerPerBlad(await bron(5), { kolommen: 2, rijen: 1, papier: A4 });
  assert.equal(uit.getPageCount(), 3);
  const [b, h] = [uit.getPage(0).getWidth(), uit.getPage(0).getHeight()];
  assert.ok(b > h);
  assert.ok(Math.abs(b - 841.89) < 0.1 && Math.abs(h - 595.276) < 0.1);
  const bytes = await uit.save();
  const heropend = await PDFDocument.load(bytes);
  assert.equal(heropend.getPageCount(), 3);
});

test('maakMeerPerBlad: 1 per vel geeft hetzelfde document terug', async () => {
  const doc = await bron(2);
  assert.equal(await maakMeerPerBlad(doc, { kolommen: 1, rijen: 1 }), doc);
});

test('maakMeerPerBlad: 9 per vel, onbekend vel volgt de eerste pagina, met rand', async () => {
  const uit = await maakMeerPerBlad(await bron(10), { kolommen: 3, rijen: 3, rand: true, orientatie: 'portrait' });
  assert.equal(uit.getPageCount(), 2);
  assert.ok(Math.abs(uit.getPage(0).getWidth() - 595.276) < 0.1);
});
