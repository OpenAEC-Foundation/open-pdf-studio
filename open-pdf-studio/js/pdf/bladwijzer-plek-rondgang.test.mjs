// Bladwijzers naar een plek op de pagina (#1157): meerdere bladwijzers op één
// pagina houden elk hun eigen bestemming bij laden, opslaan en heropenen, in
// elke vorm die een ander programma schrijft (/XYZ, /FitH, /FitR, benoemd,
// GoTo-actie). Met de echte saver en de echte lader; de outline wordt daarna
// rauw nagelezen via pdf-lib.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { PDFString } from 'pdf-lib';
import { opslaan } from './rondgang.testhulp.mjs';
import { voegBladwijzerToe } from '../ui/panels/bladwijzer-bewerken.js';
import { N, pdfMetOutline, leesBladwijzers, rauweDoelen } from './bladwijzer-outline.testhulp.mjs';

const geenApp = { legToevoegenVast() {}, legWijzigingVast() {}, markeerGewijzigd() {}, ververs() {} };
const doelVan = (b) => ({
  titel: b.title, pagina: b.page, left: b.left, top: b.top, zoom: b.zoom,
  vorm: b.destType ?? 'XYZ', args: b.destArgs ?? null,
});

test('drie nieuwe bladwijzers op dezelfde pagina: opslaan en heropenen geeft er drie', async () => {
  const bron = await pdfMetOutline([{ titel: 'Voorblad', dest: (p, ctx) => ctx.obj([p[0], N('Fit')]) }]);
  const doc = { bookmarks: await leesBladwijzers(bron) };
  for (const titel of ['Hoofdstuk 1', 'Paragraaf 1.1', 'Paragraaf 1.2']) {
    await voegBladwijzerToe(doc, { title: titel, page: 2 }, geenApp);
  }
  assert.equal(new Set(doc.bookmarks.map((b) => b.id)).size, 4, 'elk een eigen id');

  const uit = await opslaan(bron, [], { document: { bookmarks: doc.bookmarks } });
  const terug = await leesBladwijzers(uit);
  assert.deepEqual(terug.map((b) => [b.title, b.page]), [
    ['Voorblad', 1], ['Hoofdstuk 1', 2], ['Paragraaf 1.1', 2], ['Paragraaf 1.2', 2],
  ]);
  assert.equal((await rauweDoelen(uit))[0].vorm, 'Fit', 'de bestaande bladwijzer houdt zijn vorm');
});

test('meerdere bladwijzers op één pagina houden elk hun eigen plek, in elke vorm', async () => {
  const bron = await pdfMetOutline([
    { titel: 'Kop', dest: (p, ctx) => ctx.obj([p[1], N('XYZ'), 72, 770, null]) },
    { titel: 'Tussenkop', dest: (p, ctx) => ctx.obj([p[1], N('XYZ'), 72, 430.5, 2]) },
    { titel: 'Zin', dest: (p, ctx) => ctx.obj([p[1], N('XYZ'), null, 120, 0]) },
    { titel: 'Breedte', dest: (p, ctx) => ctx.obj([p[1], N('FitH'), 600]) },
    { titel: 'Kader', dest: (p, ctx) => ctx.obj([p[1], N('FitR'), 50, 100, 300, 400]) },
    { titel: 'Hele pagina', dest: (p, ctx) => ctx.obj([p[1], N('Fit')]) },
    { titel: 'Benoemd', dest: () => PDFString.of('kop2') },
    { titel: 'Actie', actie: (p, ctx) => ctx.obj({ S: 'GoTo', D: [p[1], N('XYZ'), 10, 333, null] }) },
  ], { benoemd: { kop2: (p, ctx) => ctx.obj([p[1], N('XYZ'), 0, 555, null]) } });

  const geladen = await leesBladwijzers(bron);
  const verwacht = [
    { titel: 'Kop', pagina: 2, left: 72, top: 770, zoom: null, vorm: 'XYZ', args: null },
    { titel: 'Tussenkop', pagina: 2, left: 72, top: 430.5, zoom: 2, vorm: 'XYZ', args: null },
    // Zoom 0 betekent "laten staan", net als een ontbrekende zoom.
    { titel: 'Zin', pagina: 2, left: null, top: 120, zoom: null, vorm: 'XYZ', args: null },
    // De hoogte van /FitH is geen left: hij blijft een hoogte.
    { titel: 'Breedte', pagina: 2, left: null, top: null, zoom: null, vorm: 'FitH', args: [600] },
    { titel: 'Kader', pagina: 2, left: null, top: null, zoom: null, vorm: 'FitR', args: [50, 100, 300, 400] },
    { titel: 'Hele pagina', pagina: 2, left: null, top: null, zoom: null, vorm: 'Fit', args: [] },
    { titel: 'Benoemd', pagina: 2, left: 0, top: 555, zoom: null, vorm: 'XYZ', args: null },
    { titel: 'Actie', pagina: 2, left: 10, top: 333, zoom: null, vorm: 'XYZ', args: null },
  ];
  assert.deepEqual(geladen.map(doelVan), verwacht);

  // Opslaan zonder iets te wijzigen: dezelfde bestemmingen in het bestand.
  const uit = await opslaan(bron, [], { document: { bookmarks: geladen } });
  assert.deepEqual(await rauweDoelen(uit), [
    { titel: 'Kop', pagina: 2, vorm: 'XYZ', args: [72, 770, null] },
    { titel: 'Tussenkop', pagina: 2, vorm: 'XYZ', args: [72, 430.5, 2] },
    { titel: 'Zin', pagina: 2, vorm: 'XYZ', args: [null, 120, null] },
    { titel: 'Breedte', pagina: 2, vorm: 'FitH', args: [600] },
    { titel: 'Kader', pagina: 2, vorm: 'FitR', args: [50, 100, 300, 400] },
    { titel: 'Hele pagina', pagina: 2, vorm: 'Fit', args: [] },
    { titel: 'Benoemd', pagina: 2, vorm: 'XYZ', args: [0, 555, null] },
    { titel: 'Actie', pagina: 2, vorm: 'XYZ', args: [10, 333, null] },
  ]);
  assert.deepEqual((await leesBladwijzers(uit)).map(doelVan), verwacht, 'en na heropenen hetzelfde');
});

test('het contextmenu roept alleen functies aan die het bladwijzerpaneel heeft', () => {
  const menu = fs.readFileSync(new URL('../solid/components/ContextMenu.jsx', import.meta.url), 'utf8');
  const paneel = fs.readFileSync(new URL('../ui/panels/bookmarks.js', import.meta.url), 'utf8');
  const aanroepen = new Set();
  for (const blok of menu.split("import('../../ui/panels/bookmarks.js')").slice(1)) {
    for (const m of blok.slice(0, 200).matchAll(/\bm\.(\w+)/g)) aanroepen.add(m[1]);
  }
  assert.ok(aanroepen.has('addBookmarkAtCurrentPage'), 'het paginamenu voegt een bladwijzer toe');
  for (const naam of aanroepen) {
    assert.match(paneel, new RegExp('export (async )?function ' + naam + '\\b'), naam + ' bestaat in bookmarks.js');
  }
});
