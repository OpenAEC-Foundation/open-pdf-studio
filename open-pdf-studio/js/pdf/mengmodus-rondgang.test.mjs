// Mengmodus (#614): opslaan en heropenen met de echte saver en de echte
// lader. Elke soort krijgt haar modus terug, normaal blijft zonder /BM, en een
// tweede opslag stapelt geen graphics-states op.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { BLEND_MODES, blendPdfNaam, effectiveBlendMode } = await import('../annotations/blend-modes.js');
const { annotProps, storeShowProperties, storeShowMultiSelection, updateAnnotProp } = await import('../solid/stores/propertiesStore.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');

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
    id: 'meng', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [], currentPage: 1,
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
  const modellen = [];
  for (const annot of await pagina.getAnnotations()) {
    modellen.push(await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart));
  }
  await doc.loadingTask.destroy();
  return modellen.filter(Boolean);
}

/** Per annotatie in het bestand: subtype, de /BM-waarden van alle ExtGStates
 *  in de appearance (ook in een groep) en hoe vaak `/GSo gs` erin staat. */
async function inBestand(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const tekst = (s) => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString('latin1');
  const bmsVan = (stream, uit) => {
    const res = ctx.lookup(stream.dict.get(PDFName.of('Resources')));
    const egs = res && ctx.lookup(res.get(PDFName.of('ExtGState')));
    for (const [, v] of egs ? egs.entries() : []) {
      const bm = ctx.lookup(v).get(PDFName.of('BM'));
      if (bm) uit.push(String(bm));
    }
    const xo = res && ctx.lookup(res.get(PDFName.of('XObject')));
    for (const [, v] of xo ? xo.entries() : []) bmsVan(ctx.lookup(v), uit);
    return uit;
  };
  return doc.getPage(0).node.Annots().asArray().map((ref) => {
    const d = ctx.lookup(ref);
    const ap = d.get(PDFName.of('AP')) && ctx.lookup(d.get(PDFName.of('AP')));
    const n = ap && ctx.lookup(ap.get(PDFName.of('N')));
    return {
      subtype: String(d.get(PDFName.of('Subtype'))),
      dictBm: d.get(PDFName.of('BM')) ? String(d.get(PDFName.of('BM'))) : null,
      bms: n ? bmsVan(n, []) : [],
      gso: n ? (tekst(n).match(/\/GSo gs/g) || []).length : 0,
    };
  });
}

const basis = {
  page: 1, rotation: 0, color: '#cc0000', strokeColor: '#cc0000', fillColor: null,
  lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'Tester',
  createdAt: '2026-10-19T10:00:00.000Z', modifiedAt: '2026-10-19T10:00:00.000Z',
};

const MODELLEN = [
  { ...basis, id: 'kader', type: 'box', x: 60, y: 60, width: 120, height: 80, fillColor: '#ffd24d', blendMode: 'screen' },
  { ...basis, id: 'gewoon', type: 'box', x: 300, y: 60, width: 90, height: 70, fillColor: '#00aa00' },
  { ...basis, id: 'ovaal', type: 'circle', x: 60, y: 200, width: 120, height: 80, fillColor: '#3366ff', opacity: 0.5, blendMode: 'darken' },
  { ...basis, id: 'lijn', type: 'line', startX: 60, startY: 330, endX: 260, endY: 360, blendMode: 'colorDodge' },
  { ...basis, id: 'pijl', type: 'arrow', startX: 60, startY: 400, endX: 260, endY: 430, startHead: 'none', endHead: 'open', blendMode: 'hardLight' },
  { ...basis, id: 'pen', type: 'draw', path: [{ x: 300, y: 300 }, { x: 340, y: 330 }, { x: 380, y: 310 }], blendMode: 'difference' },
  { ...basis, id: 'vak', type: 'textbox', x: 300, y: 420, width: 180, height: 50, text: 'gemengd', fontSize: 12,
    fontFamily: 'Arial', textColor: '#000000', fillColor: '#ffeeaa', textPadding: 3, blendMode: 'luminosity' },
];
const VERWACHT = {
  Square: ['/Screen', null], Circle: ['/Darken'], Line: ['/ColorDodge', '/HardLight'],
  Ink: ['/Difference'], FreeText: ['/Luminosity'],
};

function modusPerSoort(modellen) {
  const uit = {};
  for (const m of modellen) (uit[m.type] ||= []).push(m.blendMode ?? null);
  for (const k of Object.keys(uit)) uit[k].sort();
  return uit;
}

test('elke soort krijgt haar mengmodus terug; normaal blijft zonder /BM; geen stapeling bij nogmaals opslaan', async () => {
  const eerste = await opslaan(await leegBlad(), MODELLEN.map((m) => ({ ...m })));

  // In het bestand: /BM in de appearance (zodat andere lezers het tonen), één
  // keer, en niets voor de gewone rechthoek; nooit op de annotatie-dict.
  const bestand = await inBestand(eerste);
  const perSubtype = {};
  for (const a of bestand) (perSubtype[a.subtype] ||= []).push(a.bms.length ? a.bms.join(',') : null);
  for (const [sub, verwacht] of Object.entries(VERWACHT)) {
    assert.deepEqual((perSubtype[`/${sub}`] || []).slice().sort(), verwacht.slice().sort(), sub);
  }
  for (const a of bestand) {
    assert.equal(a.dictBm, null, `${a.subtype}: /BM niet op de dict`);
    assert.ok(a.gso <= 1, `${a.subtype}: /GSo gs ${a.gso}x`);
  }

  const terug = await laad(eerste);
  const verwachtModel = modusPerSoort(MODELLEN);
  assert.deepEqual(modusPerSoort(terug), verwachtModel, 'na heropenen');

  // Nogmaals opslaan met de geladen modellen: dezelfde modi, één graphics-state.
  const tweede = await opslaan(eerste, terug);
  const bestand2 = await inBestand(tweede);
  assert.equal(bestand2.length, bestand.length, 'geen dubbele annotaties');
  for (const a of bestand2) {
    assert.ok(a.gso <= 1, `${a.subtype}: /GSo gs ${a.gso}x na tweede opslag`);
    assert.ok(a.bms.length <= 1, `${a.subtype}: ${a.bms.join(',')}`);
  }
  assert.deepEqual(modusPerSoort(await laad(tweede)), verwachtModel, 'na tweede rondgang');
});

test('een modus terug op normaal haalt /BM weer weg', async () => {
  const eerste = await opslaan(await leegBlad(), [{ ...MODELLEN[0] }]);
  const [kader] = await laad(eerste);
  assert.equal(kader.blendMode, 'screen');
  kader.blendMode = 'normal';
  const tweede = await opslaan(eerste, [kader]);
  const [a] = await inBestand(tweede);
  assert.deepEqual(a.bms, []);
  const [weer] = await laad(tweede);
  assert.equal(weer.blendMode, undefined);
});

test('via Eigenschappen alle zestien modi instellen en heropenen', async () => {
  const modellen = BLEND_MODES.flatMap((_, i) => [
    { ...MODELLEN[0], id: `kader-${i}`, x: i * 10, blendMode: undefined },
    { ...MODELLEN.at(-1), id: `tekst-${i}`, x: i * 10, blendMode: undefined },
    { ...basis, type: 'textHighlight', id: `markering-${i}`, x: i * 10, y: 240, width: 20, height: 10 },
  ]);
  state.documents = [{
    id: 'paneel', annotations: modellen, currentPage: 1, selectedAnnotations: [],
    undoStack: [], redoStack: [], pageRotations: {}, textEdits: [], bookmarks: [],
  }];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];
  for (const [i, a] of doc.annotations.entries()) {
    storeShowProperties(a);
    assert.equal(annotProps.blendMode, a.type === 'textHighlight' ? 'multiply' : 'normal');
    const mode = BLEND_MODES[Math.floor(i / 3)];
    updateAnnotProp('blendMode', mode);
    assert.equal(a.blendMode, mode);
    assert.equal(annotProps.blendMode, mode);
  }
  const bytes = await opslaan(await leegBlad(), modellen);
  const terug = await laad(bytes);
  for (const type of ['box', 'textbox', 'textHighlight']) {
    assert.deepEqual(terug.filter(a => a.type === type).map(effectiveBlendMode), BLEND_MODES, type);
  }
  const bestand = await inBestand(bytes);
  for (const [i, a] of bestand.entries()) {
    const mode = BLEND_MODES[Math.floor(i / 3)];
    const naam = blendPdfNaam(mode) || (a.subtype === '/Highlight' ? 'Normal' : null);
    assert.deepEqual(a.bms, naam ? ['/' + naam] : [], a.subtype);
  }
});

test('de mengmodus bij meervoudige selectie en vergrendelde objecten', () => {
  const modellen = [MODELLEN[0], MODELLEN.at(-1)].map(a => ({ ...a }));
  state.documents = [{
    id: 'multi', annotations: modellen, currentPage: 1, selectedAnnotations: modellen,
    undoStack: [], redoStack: [], pageRotations: {}, textEdits: [], bookmarks: [],
  }];
  state.activeDocumentIndex = 0;
  const selected = state.documents[0].selectedAnnotations;
  storeShowMultiSelection(selected);
  assert.equal(annotProps.blendMode, 'mixed');
  updateAnnotProp('blendMode', 'hue');
  assert.ok(selected.every(a => a.blendMode === 'hue'));
  selected[0].locked = true;
  storeShowMultiSelection(selected);
  updateAnnotProp('blendMode', 'color');
  assert.ok(selected.every(a => a.blendMode === 'hue'));
});
