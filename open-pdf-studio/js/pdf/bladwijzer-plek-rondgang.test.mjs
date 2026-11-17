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
import { voegBladwijzerToe, wijzigBladwijzer } from '../ui/panels/bladwijzer-bewerken.js';
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

// ── Een bladwijzer naar een plek laten wijzen (#1157) ────────────────────────

const bronMetDrie = () => pdfMetOutline([
  { titel: 'Kop', dest: (p, ctx) => ctx.obj([p[1], N('XYZ'), 72, 770, null]) },
  { titel: 'Breedte', dest: (p, ctx) => ctx.obj([p[1], N('FitH'), 600]) },
  { titel: 'Vast beeld', dest: (p, ctx) => ctx.obj([p[2], N('XYZ'), 0, 842, 1.5]) },
]);

test('een nieuwe bladwijzer met een plek komt als /XYZ met die plek in het bestand; de zoom blijft vrij', async () => {
  const bron = await bronMetDrie();
  const doc = { bookmarks: await leesBladwijzers(bron) };
  // Zoals het paneel ze aanmaakt: de bovenkant van de selectie of van het beeld.
  await voegBladwijzerToe(doc, { title: '2.1 Uitgangspunten', page: 2, left: 70.866, top: 512.345 }, geenApp);
  await voegBladwijzerToe(doc, { title: '2.2 Belastingen', page: 2, left: 70.866, top: 301 }, geenApp);
  await voegBladwijzerToe(doc, { title: 'Alleen de pagina', page: 2 }, geenApp);

  const uit = await opslaan(bron, [], { document: { bookmarks: doc.bookmarks } });
  assert.deepEqual(await rauweDoelen(uit), [
    // Wat niet bewerkt is, staat er zoals het stond.
    { titel: 'Kop', pagina: 2, vorm: 'XYZ', args: [72, 770, null] },
    { titel: 'Breedte', pagina: 2, vorm: 'FitH', args: [600] },
    { titel: 'Vast beeld', pagina: 3, vorm: 'XYZ', args: [0, 842, 1.5] },
    { titel: '2.1 Uitgangspunten', pagina: 2, vorm: 'XYZ', args: [70.87, 512.35, null] },
    { titel: '2.2 Belastingen', pagina: 2, vorm: 'XYZ', args: [70.87, 301, null] },
    { titel: 'Alleen de pagina', pagina: 2, vorm: 'XYZ', args: [null, null, null] },
  ]);
  const terug = await leesBladwijzers(uit);
  assert.deepEqual(terug.slice(3).map((b) => [b.title, b.page, b.left, b.top, b.zoom]), [
    ['2.1 Uitgangspunten', 2, 70.87, 512.35, null],
    ['2.2 Belastingen', 2, 70.87, 301, null],
    ['Alleen de pagina', 2, null, null, null],
  ]);
});

test('een bestaande bladwijzer opnieuw laten wijzen: nieuwe plek, één stap terug te zetten, en zo opgeslagen', async () => {
  const bron = await bronMetDrie();
  const doc = { bookmarks: await leesBladwijzers(bron) };
  const stappen = [];
  const app = { ...geenApp, legWijzigingVast: (id, oud, nieuw) => stappen.push({ id, oud, nieuw }) };
  const [kop, breedte, vast] = doc.bookmarks;
  const voor = JSON.parse(JSON.stringify(doc.bookmarks));

  // 'Bestemming instellen op huidige weergave / selectie': pagina en plek.
  await wijzigBladwijzer(doc, kop.id, { page: 3, left: 50, top: 400.004 }, app);
  // Een andere vorm uit het bestand wordt de gewone vorm met de nieuwe plek.
  await wijzigBladwijzer(doc, breedte.id, { page: 2, left: 0, top: 250 }, app);
  // Een vaste zoom gaat weg: de nieuwe plek houdt de zoom zoals hij is.
  await wijzigBladwijzer(doc, vast.id, { page: 3, left: 10, top: 20 }, app);
  assert.equal(stappen.length, 3, 'elke wijziging één stap');
  assert.deepEqual(doc.bookmarks.map((b) => [b.page, b.left, b.top, b.zoom, b.destType ?? null]), [
    [3, 50, 400, null, null], [2, 0, 250, null, null], [3, 10, 20, null, null],
  ]);

  const uit = await opslaan(bron, [], { document: { bookmarks: doc.bookmarks } });
  assert.deepEqual(await rauweDoelen(uit), [
    { titel: 'Kop', pagina: 3, vorm: 'XYZ', args: [50, 400, null] },
    { titel: 'Breedte', pagina: 2, vorm: 'XYZ', args: [0, 250, null] },
    { titel: 'Vast beeld', pagina: 3, vorm: 'XYZ', args: [10, 20, null] },
  ]);

  // Ongedaan maken zoals de undo-manager het doet: de oude toestand terug.
  for (const stap of stappen.reverse()) Object.assign(doc.bookmarks.find((b) => b.id === stap.id), stap.oud);
  const terug = await opslaan(bron, [], { document: { bookmarks: doc.bookmarks } });
  assert.deepEqual(await rauweDoelen(terug), [
    { titel: 'Kop', pagina: 2, vorm: 'XYZ', args: [72, 770, null] },
    { titel: 'Breedte', pagina: 2, vorm: 'FitH', args: [600] },
    { titel: 'Vast beeld', pagina: 3, vorm: 'XYZ', args: [0, 842, 1.5] },
  ], 'ook de vorm en de zoom zijn terug');
  assert.deepEqual(doc.bookmarks.map((b) => [b.page, b.left, b.top, b.zoom]), voor.map((b) => [b.page, b.left, b.top, b.zoom]));
});

test('een andere pagina zonder nieuwe plek wijst naar de bovenkant van die pagina; titel en stijl laten de plek met rust', async () => {
  const bron = await bronMetDrie();
  const doc = { bookmarks: await leesBladwijzers(bron) };
  const [kop, breedte] = doc.bookmarks;

  await wijzigBladwijzer(doc, kop.id, { title: 'Kop (nieuw)', page: 2, bold: true }, geenApp);
  assert.deepEqual([kop.page, kop.left, kop.top], [2, 72, 770], 'zelfde pagina: de plek blijft');
  await wijzigBladwijzer(doc, breedte.id, { color: '#e81123' }, geenApp);
  assert.deepEqual([breedte.destType, breedte.destArgs], ['FitH', [600]]);

  await wijzigBladwijzer(doc, kop.id, { page: 1 }, geenApp);
  assert.deepEqual([kop.page, kop.left, kop.top, kop.zoom], [1, null, null, null], 'de oude hoogte hoort niet bij een ander blad');
  await wijzigBladwijzer(doc, breedte.id, { page: 3 }, geenApp);

  const uit = await opslaan(bron, [], { document: { bookmarks: doc.bookmarks } });
  assert.deepEqual((await rauweDoelen(uit)).slice(0, 2), [
    { titel: 'Kop (nieuw)', pagina: 1, vorm: 'XYZ', args: [null, null, null] },
    { titel: 'Breedte', pagina: 3, vorm: 'XYZ', args: [null, null, null] },
  ]);
});

test('pagina\'s herschikken neemt de bladwijzer met zijn plek mee', async () => {
  const { remapBookmarkPages, pageMappingForOrder } = await import('./page-order.js');
  const bron = await bronMetDrie();
  const geladen = await leesBladwijzers(bron);
  // Pagina 2 wordt de eerste.
  const na = remapBookmarkPages(geladen, pageMappingForOrder([2, 1, 3]));
  assert.deepEqual(na.map((b) => [b.title, b.page, b.left, b.top, b.destType ?? null, b.destArgs ?? null]), [
    ['Kop', 1, 72, 770, null, null],
    ['Breedte', 1, null, null, 'FitH', [600]],
    ['Vast beeld', 3, 0, 842, null, null],
  ]);
});
