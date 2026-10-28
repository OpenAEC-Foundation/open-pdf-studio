// Het plan van de organizer toepassen (#764): de nieuwe bytes, de draaiingen,
// de paginatoewijzing en de ene ongedaan-maakstap. Met echte pdf-lib-bestanden
// en een nagebootste app-omgeving, zodat de bedrading (reloadFromBytes +
// recordPageStructure) zonder browser te controleren is.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, degrees } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const {
  A4, bouwNieuweBytes, bouwRotaties, remapAnnotaties, pasPlanToe, bytesVanSelectie, leesInvoegBestand,
} = await import('./organizer-apply.js');
const { maakPlan, draai, verplaats, verwijder, voegBlancoIn, voegBestandToe, wisselSplitsing, bouwToewijzing } =
  await import('./organizer-model.js');

// Vier pagina's die aan hun MAAT te herkennen zijn: 301x501, 302x502, ...
async function bronBytes(aantal = 4) {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= aantal; i++) {
    const p = doc.addPage([300 + i, 500 + i]);
    p.setRotation(degrees(i === 2 ? 90 : 0)); // pagina 2 heeft al een eigen /Rotate
  }
  return new Uint8Array(await doc.save());
}

const maten = (doc) => doc.getPages().map((p) => {
  const { width, height } = p.getSize();
  return [Math.round(width * 100) / 100, Math.round(height * 100) / 100];
});

test('de nieuwe bytes staan in de volgorde van het plan', async () => {
  const bytes = await bronBytes();
  let plan = maakPlan(4);
  const [p1, p2, p3, p4] = plan.items;

  // 4 naar voren, 2 eruit, een blanco pagina achteraan.
  plan = verplaats(plan, [p4.id], 0);
  plan = verwijder(plan, [p2.id]).plan;
  plan = voegBlancoIn(plan, 3, {});

  const { bytes: nieuw, paginas } = await bouwNieuweBytes(plan, bytes);
  const doc = await PDFDocument.load(nieuw);
  assert.equal(doc.getPageCount(), 4);
  assert.deepEqual(maten(doc).slice(0, 3), [[304, 504], [301, 501], [303, 503]], 'oude 4, 1, 3');
  assert.deepEqual(paginas.length, 4);
  // De blanco pagina is A4 en heeft geen inhoud (getPages is 0-based).
  const blanco = doc.getPages()[3];
  assert.equal(Math.round(blanco.getSize().width), Math.round(A4.breedte));
  assert.equal(Math.round(blanco.getSize().height), Math.round(A4.hoogte));
  // De volgorde in de bytes laat /Rotate staan: de draaiing van de app reist
  // in pageRotations mee (zie bouwRotaties), niet in het bestand.
  assert.equal(doc.getPages()[0].getRotation().angle, 0, 'oude pagina 4 had geen draaiing');
});

test('de draaiing van een pagina reist mee naar haar nieuwe plek', async () => {
  let plan = maakPlan(4);              // 1 2 3 4
  const [p1, , p3] = plan.items;
  plan = draai(plan, [p3.id], 180);    // pagina 3 een halve slag
  plan = verplaats(plan, [p3.id], 0);  // 3 1 2 4

  const toe = bouwToewijzing(plan, 4, 1);
  assert.deepEqual(toe.pageMapping, { 1: 2, 2: 3, 3: 1, 4: 4 });

  const rotaties = bouwRotaties(plan, { 2: 90 }, toe.pageMapping);
  // Oude 2 (die 90° stond) staat nu op 3; oude 3 staat nu op 1 met 180°; de
  // pagina's zonder draaiing komen er niet in.
  assert.deepEqual(rotaties, { 1: 180, 3: 90 });
  assert.equal(bouwRotaties(maakPlan(2), { 1: 0 }, { 1: 1, 2: 2 })[1], undefined);

  // Draaiing op een blanco pagina: die begint bij nul.
  const metBlanco = voegBlancoIn(plan, 0, {});
  const gedraaid = draai(metBlanco, [metBlanco.items[0].id], 270);
  assert.deepEqual(bouwRotaties(gedraaid, { 2: 90 }, { 1: 2, 2: 3, 3: 4, 4: 5 })[1], 270);
  void p1;
});

test('annotaties van verwijderde pagina\'s verdwijnen, de rest schuift mee', () => {
  const annotaties = [
    { id: 'a', page: 1, type: 'note' },
    { id: 'b', page: 3, type: 'note' },
    { id: 'c', page: 4, type: 'note' },
  ];
  assert.deepEqual(remapAnnotaties(annotaties, { 1: 2, 2: null, 3: 1, 4: 3 }), [
    { id: 'a', page: 2, type: 'note' },
    { id: 'b', page: 1, type: 'note' },
    { id: 'c', page: 3, type: 'note' },
  ]);
  assert.deepEqual(remapAnnotaties(annotaties, {}), []);
});

test('een ingevoegd bestand levert zijn eigen pagina\'s aan het plan', async () => {
  const bytes = await bronBytes();
  const bijlage = await bronBytes(2);          // 301x501 en 302x502
  const gelezen = await leesInvoegBestand('bijlage.pdf', { leesBestand: async () => bijlage });
  assert.equal(gelezen.aantalPaginas, 2);

  let plan = maakPlan(3);
  plan = voegBestandToe(plan, 1, { bestandId: 'b1', naam: 'bijlage.pdf', ...gelezen });
  const { bytes: nieuw } = await bouwNieuweBytes(plan, bytes);
  const doc = await PDFDocument.load(nieuw);
  assert.equal(doc.getPageCount(), 5);
  assert.deepEqual(maten(doc).slice(1, 3), [[301, 501], [302, 502]], 'de pagina\'s van de bijlage');
});

test('een uittreksel van een selectie bakt de draaiing in het bestand', async () => {
  const bytes = await bronBytes();
  let plan = maakPlan(4);
  plan = draai(plan, [plan.items[0].id], 90);
  plan = draai(plan, [plan.items[3].id], 270);

  const uit = await bytesVanSelectie(plan, [plan.items[3].id, plan.items[0].id], bytes);
  const doc = await PDFDocument.load(uit);
  assert.equal(doc.getPageCount(), 2);
  // In planorde, niet in klikorde: de pagina's staan zoals ze in de organizer staan.
  assert.deepEqual(maten(doc), [[301, 501], [304, 504]], 'oude 1 dan oude 4');
  const paginas = doc.getPages();
  assert.equal(paginas[0].getRotation().angle, 90, 'draaiing hoort in een los bestand te staan');
  assert.equal(paginas[1].getRotation().angle, 270);
  assert.equal(await bytesVanSelectie(plan, [], bytes), null);
});

test('toepassen is één stap: de app herlaadt met de toewijzing en legt die vast', async () => {
  const bytes = await bronBytes(3);
  let plan = maakPlan(3);
  plan = verplaats(plan, [plan.items[2].id], 0);   // 3 1 2
  plan = verwijder(plan, [plan.items[2].id]).plan; // 3 1

  const app = {
    document: () => ({
      pdfDoc: { numPages: 3 },
      annotations: [{ id: 'a', page: 1 }, { id: 'b', page: 3 }],
      pageRotations: { 1: 0, 3: 90 },
      currentPage: 3,
      fileName: 'test.pdf',
    }),
    bytes: () => bytes,
    herlaad: (b, ann, rot, pagina, extra) => {
      app.gezien = { b, ann, rot, pagina, extra };
      return ann;
    },
    legVast: (...args) => { app.stap = args; },
    kiesPad: async () => null,
    schrijf: async () => { throw new Error('er valt niets te schrijven zonder splitspunten'); },
    toon: () => { app.toonde = true; },
    verberg: () => { app.verbergde = true; },
    meld: (t) => { app.melding = t; },
  };

  const uit = await pasPlanToe(plan, app);
  assert.equal(uit.toegepast, true);
  assert.deepEqual(uit.delen, [], 'zonder splitspunten geen losse bestanden');
  assert.equal(app.toonde, true);
  assert.equal(app.verbergde, true);

  // Oude 3 wordt 1, oude 1 wordt 2, oude 2 is weg.
  assert.deepEqual(app.gezien.extra.pageMapping, { 1: 2, 2: null, 3: 1 });
  assert.deepEqual(app.gezien.ann.map((a) => [a.id, a.page]), [['a', 2], ['b', 1]]);
  assert.deepEqual(app.gezien.rot, { 1: 90 }, 'de draaiing van oude 3 reist mee naar 1');
  assert.equal(app.gezien.pagina, 1, 'de bekeken pagina stond op 3 en is nu 1');
  assert.equal(app.stap.length, 8, 'recordPageStructure: oud → nieuw in één stap');
  assert.equal(app.stap[3], 3, 'de oude pagina');
  assert.equal(app.stap[7], 1, 'de nieuwe pagina');
  assert.equal(app.melding, undefined);
});

test('toepassen meldt waarom het niet kan', async () => {
  const bytes = await bronBytes(2);
  const leeg = { items: [], splits: new Set(), bestanden: new Map() };
  const basis = { bytes: () => bytes, document: () => ({ pdfDoc: { numPages: 2 } }) };
  assert.deepEqual((await pasPlanToe(leeg, basis)).reden, 'leeg');
  assert.deepEqual((await pasPlanToe(maakPlan(2), { document: () => null })).reden, 'geen-document');
  assert.deepEqual((await pasPlanToe(maakPlan(2), { document: () => ({ pdfDoc: {} }), bytes: () => null })).reden, 'geen-bytes');
});

test('een splitspunt levert de reeksen waar de delen uit komen', async () => {
  let plan = maakPlan(4);
  plan = wisselSplitsing(plan, plan.items[2].id).plan;
  const toe = bouwToewijzing(plan, 4, 1);
  assert.deepEqual(toe.delen, [{ start: 1, eind: 2, titel: null }, { start: 3, eind: 4, titel: null }]);
});
