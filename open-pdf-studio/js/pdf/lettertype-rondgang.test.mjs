// Het gekozen lettertype van een tekstvak: op het scherm, in het bestand en
// na heropenen (GitHub #765).
//
// Met de echte saver (saver-test-hooks.mjs) en de echte lader (pdf.js ->
// extractAnnotationColors -> zetPaginaAnnotatiesOm, zoals js/pdf/loader.js).
//
// - Times en Courier gaan als standaardfont in /DA en de appearance, een
//   ander lettertype op naam (niet ingebed, met FontDescriptor); na
//   heropenen staat hetzelfde lettertype in het model, ook na twee rondes.
// - Een tekstvak van een ander programma met het lettertype alleen in /RC
//   (rich text) kwam terug in de letter van /DA, meestal Helvetica.
// - De melding onder de lettertypekeuze noemt dezelfde standaardletter die de
//   saver in de appearance zet (vervangendeStandaardFont) of waarin
//   bewerkte PDF-tekst geschreven wordt (toStandardFontName).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { zetPaginaAnnotatiesOm } = await import('./loader/annotaties-omzetten.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { rcLettertype } = await import('./loader/pdf-helpers.js');
const { drawTextboxContent } = await import('../annotations/rendering/shapes.js');
const { vervangendeStandaardFont, mapFontToPdfName } = await import('./saver/utils.js');
const { toStandardFontName } = await import('../text/text-edit-appearance.js');
const { lettertypeMelding, standaardLetterVoor } = await import('../text/lettertype-inbedding.js');

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'lettertype', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = await zetPaginaAnnotatiesOm(await pagina.getAnnotations(), 1, viewport, new Map(), kaart);
  await doc.loadingTask.destroy();
  return modellen;
}

/** /DA en de fonts (naam -> BaseFont, met of zonder descriptor) van de appearance. */
async function fontsInBestand(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const annot = ctx.lookup(doc.getPage(0).node.Annots().get(0));
  const ap = ctx.lookup(ctx.lookup(annot.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const res = ctx.lookup(ap.dict.get(PDFName.of('Resources')));
  const fontDict = ctx.lookup(res.get(PDFName.of('Font')));
  const fonts = {};
  for (const [sleutel, waarde] of fontDict.entries()) {
    const f = ctx.lookup(waarde);
    fonts[sleutel.decodeText()] = {
      baseFont: f.get(PDFName.of('BaseFont')).decodeText(),
      descriptor: !!f.get(PDFName.of('FontDescriptor')),
    };
  }
  return { da: annot.get(PDFName.of('DA')).decodeText(), fonts, inhoud: new TextDecoder().decode(ap.getContents()) };
}

const tekstvak = (extra = {}) => ({
  page: 1, rotation: 0, color: '#000000', strokeColor: '#000000', fillColor: null, textColor: '#000000',
  lineWidth: 1, borderStyle: 'solid', opacity: 1, author: 'User',
  id: 'tb', type: 'textbox', x: 60, y: 60, width: 220, height: 60, text: 'hallo wereld',
  fontSize: 12, fontFamily: 'Arial', ...extra,
});

test('het gekozen lettertype staat op het scherm in ctx.font', () => {
  for (const [familie, verwacht] of [['Georgia', 'Georgia'], ['Times New Roman', '"Times New Roman"'], ['Courier New', '"Courier New"']]) {
    const fonts = [];
    const ctx = {
      set font(v) { fonts.push(v); }, get font() { return fonts.at(-1); },
      measureText: (t) => ({ width: t.length * 6, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }),
      fillText() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
      moveTo() {}, lineTo() {}, stroke() {}, translate() {}, rotate() {}, scale() {},
      set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {}, set textBaseline(_v) {}, set textAlign(_v) {},
    };
    drawTextboxContent(ctx, tekstvak({ fontFamily: familie }));
    assert.ok(fonts.length > 0, familie);
    assert.ok(fonts.every((f) => f.includes(`12px ${verwacht}`)), `${familie}: ${fonts.join(' | ')}`);
  }
});

test('Times, Courier en een systeemlettertype gaan mee naar het bestand en komen terug', async () => {
  const gevallen = [
    { fontFamily: 'Times New Roman', da: 'Times-Roman', base: 'Times-Roman', descriptor: false },
    { fontFamily: 'Times New Roman', fontBold: true, fontItalic: true, da: 'Times-BoldItalic', base: 'Times-BoldItalic', descriptor: false },
    { fontFamily: 'Courier New', da: 'Courier', base: 'Courier', descriptor: false },
    { fontFamily: 'Courier New', fontBold: true, da: 'Courier-Bold', base: 'Courier-Bold', descriptor: false },
    { fontFamily: 'Arial', da: 'Helvetica', base: 'Helvetica', descriptor: false },
    { fontFamily: 'Georgia', da: 'Georgia', base: 'Georgia', descriptor: true },
    { fontFamily: 'Segoe UI', fontItalic: true, da: 'SegoeUI-Italic', base: 'SegoeUI-Italic', descriptor: true },
    // Een schreefletter zonder 'Times' in de naam: Times in het bestand, de
    // eigen naam terug in de app (/DS).
    { fontFamily: 'Noto Serif', da: 'Times-Roman', base: 'Times-Roman', descriptor: false },
  ];
  for (const g of gevallen) {
    const model = tekstvak({ fontFamily: g.fontFamily, fontBold: !!g.fontBold, fontItalic: !!g.fontItalic });
    const bytes = await opslaan(await leegBlad(), [model]);
    const { da, fonts, inhoud } = await fontsInBestand(bytes);
    assert.match(da, new RegExp(`/${g.da} 12 Tf`), `${g.fontFamily}: /DA ${da}`);
    assert.deepEqual(fonts[g.da], { baseFont: g.base, descriptor: g.descriptor }, `${g.fontFamily}: appearance-font`);
    assert.match(inhoud, new RegExp(`/${g.da} 12 Tf`), `${g.fontFamily}: de appearance tekent met dat font`);
    let terug = await laad(bytes);
    for (let ronde = 1; ronde <= 2; ronde++) {
      const vak = terug.find((m) => m.type === 'textbox');
      assert.equal(vak.fontFamily, g.fontFamily, `${g.fontFamily}: lettertype na ronde ${ronde}`);
      assert.equal(!!vak.fontBold, !!g.fontBold, `${g.fontFamily}: vet na ronde ${ronde}`);
      assert.equal(!!vak.fontItalic, !!g.fontItalic, `${g.fontFamily}: cursief na ronde ${ronde}`);
      if (ronde === 1) terug = await laad(await opslaan(await leegBlad(), terug));
    }
  }
});

test('het lettertype uit /RC van een ander programma komt terug', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const ctx = doc.context;
  const annot = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: [100, 600, 300, 650], F: 4,
    Contents: PDFString.of('hallo'),
    DA: PDFString.of('0 0 0 rg /Helv 12 Tf'),
    RC: PDFString.of('<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" style="font:12pt \'Georgia\', serif;color:#000000"><p>hallo</p></body>'),
  }));
  pagina.node.set(PDFName.of('Annots'), ctx.obj([annot]));
  const [vak] = await laad(await doc.save());
  assert.equal(vak.fontFamily, 'Georgia');

  assert.equal(rcLettertype('<p style="font-family:&quot;Segoe UI&quot;, sans-serif">x</p>'), 'Segoe UI');
  assert.equal(rcLettertype('<body style="font:bold italic 10pt/12pt Calibri">'), 'Calibri');
  assert.equal(rcLettertype('<body style="font-family:sans-serif">'), null);
  assert.equal(rcLettertype(''), null);
});

test('de melding noemt de standaardletter die het bestand echt krijgt', () => {
  for (const familie of ['Arial', 'Helvetica', 'Times New Roman', 'Times', 'Courier New', 'Courier', 'sans-serif', 'mixed', '']) {
    assert.equal(lettertypeMelding(familie), null, `geen melding bij ${familie || '(leeg)'}`);
    assert.equal(lettertypeMelding(familie, 'paginatekst'), null, `geen melding bij ${familie || '(leeg)'}`);
  }
  const familieVan = (pdfNaam) => (/^Courier/.test(pdfNaam) ? 'Courier' : /^Times/.test(pdfNaam) ? 'Times' : 'Helvetica');
  for (const familie of ['Georgia', 'Calibri', 'Verdana', 'Consolas', 'Comic Sans MS', 'Noto Serif', 'Cascadia Mono', 'Arial Black']) {
    const tekstvakMelding = lettertypeMelding(familie);
    assert.equal(tekstvakMelding.sleutel, 'textFormat.fontNotEmbedded');
    assert.equal(tekstvakMelding.font, familie);
    assert.equal(tekstvakMelding.fallback, familieVan(vervangendeStandaardFont(mapFontToPdfName(familie, false, false))), familie);
    const paginaMelding = lettertypeMelding(familie, 'paginatekst');
    assert.equal(paginaMelding.sleutel, 'textFormat.fontReplaced');
    assert.equal(paginaMelding.fallback, familieVan(toStandardFontName(familie, false, false)), familie);
  }
  assert.equal(standaardLetterVoor('Georgia'), 'Times');
  assert.equal(standaardLetterVoor('Consolas'), 'Courier');
  assert.equal(standaardLetterVoor('Calibri'), 'Helvetica');
  assert.equal(standaardLetterVoor('Georgia', 'paginatekst'), 'Times');
  assert.equal(standaardLetterVoor('Calibri', 'paginatekst'), 'Helvetica');
});
