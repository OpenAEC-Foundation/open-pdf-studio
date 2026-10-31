// Bladwijzers: kleur, vet/cursief (#689) en volgorde/nesting (#690) overleven
// opslaan en heropenen met de echte saver en de echte lader. Extern gecontroleerd
// op de rauwe outline-items (/C, /F, /First, /Next) via pdf-lib.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFArray, PDFNumber } from 'pdf-lib';
import { opslaan } from './rondgang.testhulp.mjs';
import { loadBookmarksFromPdf, pdfjsKleurNaarHex } from './bladwijzers-lezen.js';
import { verplaatsBladwijzers, nestOnderNieuw, selectieBereik, nieuweTitel } from '../ui/panels/bladwijzer-boom.js';

const N = (s) => PDFName.of(s);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function driePaginas() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([595, 842]);
  return doc.save();
}

async function leesBladwijzers(bytes) {
  const pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const bms = await loadBookmarksFromPdf(pd);
  await pd.loadingTask.destroy();
  return bms;
}

/** De outline als boom van { titel, C, F, kinderen } uit de rauwe dictionaries. */
async function rauweOutline(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const outlines = ctx.lookup(doc.catalog.get(N('Outlines')));
  if (!outlines) return null;
  const loop = (eersteRef) => {
    const uit = [];
    let ref = eersteRef;
    while (ref) {
      const d = ctx.lookup(ref);
      const c = d.get(N('C'));
      const f = d.get(N('F'));
      uit.push({
        titel: d.get(N('Title')).decodeText(),
        C: c instanceof PDFArray ? c.asArray().map((n) => Math.round(n.asNumber() * 255)) : null,
        F: f instanceof PDFNumber ? f.asNumber() : null,
        kinderen: d.get(N('First')) ? loop(d.get(N('First'))) : [],
      });
      ref = d.get(N('Next'));
    }
    return uit;
  };
  return loop(outlines.get(N('First')));
}

const bm = (id, title, page, parentId, sortOrder, extra = {}) => ({
  id, title, page, top: null, left: null, zoom: null, parentId, expanded: true,
  bold: false, italic: false, color: null, sortOrder, fromPdf: false, ...extra,
});

test('pdf.js-kleuren (0-255) worden hex; zwart en ontbrekend worden geen kleur', () => {
  assert.equal(pdfjsKleurNaarHex(new Uint8ClampedArray([255, 0, 0])), '#ff0000');
  assert.equal(pdfjsKleurNaarHex(new Uint8ClampedArray([0, 128, 255])), '#0080ff');
  assert.equal(pdfjsKleurNaarHex(new Uint8ClampedArray([0, 0, 0])), null, 'zwart is de standaard van pdf.js');
  assert.equal(pdfjsKleurNaarHex(null), null);
  assert.equal(pdfjsKleurNaarHex([1, 2]), null);
});

test('opslaan en heropenen: kleur, vet, cursief, volgorde en nesting blijven', async () => {
  const bron = await driePaginas();
  const bookmarks = [
    // Bewust door elkaar in de array: de volgorde komt uit sortOrder.
    bm('b', 'CIVIL', 2, null, 1, { color: '#0078d7', bold: true }),
    bm('a', 'Cover', 1, null, 0),
    bm('c2', 'C-102', 3, 'b', 1, { italic: true }),
    bm('c1', 'C-101', 2, 'b', 0, { color: '#e81123', bold: true, italic: true }),
    bm('c1a', 'Detail', 2, 'c1', 0, { color: '#808080' }),
  ];
  const uit = await opslaan(bron, [], { document: { bookmarks } });

  const rauw = await rauweOutline(uit);
  assert.deepEqual(rauw, [
    { titel: 'Cover', C: null, F: null, kinderen: [] },
    { titel: 'CIVIL', C: [0, 120, 215], F: 2, kinderen: [
      { titel: 'C-101', C: [232, 17, 35], F: 3, kinderen: [
        { titel: 'Detail', C: [128, 128, 128], F: null, kinderen: [] },
      ] },
      { titel: 'C-102', C: null, F: 1, kinderen: [] },
    ] },
  ]);

  const terug = await leesBladwijzers(uit);
  const opTitel = Object.fromEntries(terug.map((b) => [b.title, b]));
  assert.deepEqual(terug.map((b) => b.title), ['Cover', 'CIVIL', 'C-101', 'Detail', 'C-102']);
  assert.equal(opTitel['CIVIL'].color, '#0078d7');
  assert.equal(opTitel['CIVIL'].bold, true);
  assert.equal(opTitel['CIVIL'].italic, false);
  assert.equal(opTitel['C-101'].color, '#e81123');
  assert.equal(opTitel['C-101'].bold, true);
  assert.equal(opTitel['C-101'].italic, true);
  assert.equal(opTitel['C-102'].color, null);
  assert.equal(opTitel['C-102'].italic, true);
  assert.equal(opTitel['Cover'].color, null, 'geen kleur blijft geen kleur');
  assert.equal(opTitel['Detail'].parentId, opTitel['C-101'].id);
  assert.equal(opTitel['C-101'].parentId, opTitel['CIVIL'].id);
  assert.equal(opTitel['Cover'].parentId, null);
  assert.equal(opTitel['C-102'].page, 3);

  // Nog een keer opslaan wat er gelezen is: niets verandert (geen /C [0 0 0]
  // op elke bladwijzer, geen kapotte kleur).
  const opnieuw = await opslaan(uit, [], { document: { bookmarks: terug } });
  assert.deepEqual(await rauweOutline(opnieuw), rauw);
});

test('verplaatsen en nesten (#690) overleven opslaan en heropenen', async () => {
  const bron = await driePaginas();
  // Een platte set zoals plannen binnenkomen: één bladwijzer per blad.
  const plat = ['Cover', 'C-101', 'C-102', 'S-201', 'S-202', 'CIVIL'].map((t, i) => bm(`b${i}`, t, (i % 3) + 1, null, i));
  const eerste = await opslaan(bron, [], { document: { bookmarks: plat } });
  let lijst = await leesBladwijzers(eerste);
  const id = (titel) => lijst.find((b) => b.title === titel).id;

  // Ctrl+klik C-101 en C-102, slepen op CIVIL; daarna S-201..S-202 onder een nieuwe STRUCTURAL.
  lijst = verplaatsBladwijzers(lijst, [id('C-101'), id('C-102')], id('CIVIL'), 'inside');
  lijst = nestOnderNieuw(lijst, selectieBereik(lijst, id('S-201'), id('S-202')),
    bm('nieuw', 'STRUCTURAL', 2, null, 0, { color: '#107c10', bold: true }));
  // En Cover naar achteren (streep onder CIVIL, dat dicht staat).
  lijst = lijst.map((b) => (b.id === id('CIVIL') ? { ...b, expanded: false } : b));
  lijst = verplaatsBladwijzers(lijst, [id('Cover')], id('CIVIL'), 'after');

  const uit = await opslaan(eerste, [], { document: { bookmarks: lijst } });
  assert.deepEqual(await rauweOutline(uit), [
    { titel: 'STRUCTURAL', C: [16, 124, 16], F: 2, kinderen: [
      { titel: 'S-201', C: null, F: null, kinderen: [] },
      { titel: 'S-202', C: null, F: null, kinderen: [] },
    ] },
    { titel: 'CIVIL', C: null, F: null, kinderen: [
      { titel: 'C-101', C: null, F: null, kinderen: [] },
      { titel: 'C-102', C: null, F: null, kinderen: [] },
    ] },
    { titel: 'Cover', C: null, F: null, kinderen: [] },
  ]);
  const terug = await leesBladwijzers(uit);
  assert.deepEqual(terug.map((b) => b.title), ['STRUCTURAL', 'S-201', 'S-202', 'CIVIL', 'C-101', 'C-102', 'Cover']);
  assert.equal(terug.find((b) => b.title === 'STRUCTURAL').page, 2);
});

test('hernoemen in de lijst (#891): unicode-titel in /Outlines, rest van de boom blijft', async () => {
  const bron = await driePaginas();
  const eerste = await opslaan(bron, [], { document: { bookmarks: [
    bm('a', 'CIVIL', 1, null, 0, { color: '#0078d7', bold: true }),
    bm('b', 'C-101', 2, 'a', 0, { italic: true }),
    bm('c', 'Cover (oud)', 3, null, 1),
  ] } });
  const lijst = await leesBladwijzers(eerste);
  const kind = lijst.find((b) => b.title === 'C-101');
  const titel = nieuweTitel(lijst, kind.id, '  Gevel – Ü 東 😀 (a\\b)  ', 'C-101');
  assert.equal(titel, 'Gevel – Ü 東 😀 (a\\b)');
  const hernoemd = lijst.map((b) => (b.id === kind.id ? { ...b, title: titel } : b));
  const uit = await opslaan(eerste, [], { document: { bookmarks: hernoemd } });
  assert.deepEqual(await rauweOutline(uit), [
    { titel: 'CIVIL', C: [0, 120, 215], F: 2, kinderen: [
      { titel: 'Gevel – Ü 東 😀 (a\\b)', C: null, F: 1, kinderen: [] },
    ] },
    { titel: 'Cover (oud)', C: null, F: null, kinderen: [] },
  ]);
  const terug = await leesBladwijzers(uit);
  const nieuw = terug.find((b) => b.title === titel);
  assert.ok(nieuw, 'titel na heropenen');
  assert.equal(nieuw.page, 2);
  assert.equal(nieuw.parentId, terug.find((b) => b.title === 'CIVIL').id);
});
