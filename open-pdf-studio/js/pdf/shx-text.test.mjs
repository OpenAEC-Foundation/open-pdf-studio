import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFHexString, rgb } from 'pdf-lib';
import { laad, opslaan, woordenboeken, state } from './rondgang.testhulp.mjs';

const { extractPageText, zoekPaginaAlleBronnen, buildPattern, replaceCurrentMatch, replaceAllMatches } = await import('../search/find-controller.js');
const SHX = 'AutoCAD SHX Text';
const TEXT = 'EL. +104.50m';

async function fixture(dicts) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.setCropBox(20, 30, 550, 740);
  // Real plotted content is independent of the SHX annotation metadata.
  page.drawLine({ start: { x: 100, y: 110 }, end: { x: 130, y: 140 }, color: rgb(0, 0, 0) });
  const refs = dicts.map(d => doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 220, 120],
    T: PDFString.of(SHX), Contents: PDFString.of(TEXT), C: [1, 1, 0], F: 28,
    ...d,
  })));
  page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  return doc.save();
}

for (const [name, border] of Object.entries({ border: { Border: [0, 0, 0] }, bs: { BS: { W: 0 } }, missing: {}, malformedDash: { BS: { W: 1, D: [0] } } })) {
  test(`SHX ${name}: no editable rectangles, original metadata survives two saves`, async () => {
    const bytes = await fixture([border]);
    assert.equal((await laad(bytes)).length, 0);
    let saved = bytes;
    for (let i = 0; i < 2; i++) {
      saved = await opslaan(saved, await laad(saved));
      const dicts = await woordenboeken(saved);
      assert.equal(dicts.length, 1);
      const dict = dicts[0].dict;
      assert.equal(dict.lookup(PDFName.of('T')).decodeText(), SHX);
      assert.equal(dict.lookup(PDFName.of('Contents')).decodeText(), TEXT);
      assert.equal(dict.has(PDFName.of('AP')), false);
      assert.equal(dict.lookup(PDFName.of('F')).asNumber(), 28);
      assert.equal((await laad(saved)).length, 0);
    }
  });
}

test('explicit zero-width squares have no outline, preserve fill and ordinary strokes', async () => {
  const bytes = await fixture([
    { T: PDFString.of('Ordinary'), BS: { W: 0 } },
    { T: PDFString.of('Filled'), Border: [0, 0, 0], IC: [1, 0, 0], Rect: [100, 200, 220, 220] },
    { T: PDFString.of('Ordinary stroke'), BS: { W: 2 }, Rect: [100, 300, 220, 320] },
  ]);
  const models = await laad(bytes);
  assert.equal(models.length, 3);
  assert.equal(models[0].strokeColor, 'none');
  assert.equal(models[1].strokeColor, 'none');
  assert.equal(models[1].fillColor, '#ff0000');
  assert.equal(models[2].lineWidth, 2);
  assert.notEqual(models[2].strokeColor, 'none');
  const saved = await opslaan(bytes, models);
  const reopened = await laad(saved);
  assert.equal(reopened.length, 3);
  assert.equal(reopened[0].strokeColor, 'none');
  assert.equal(reopened[1].fillColor, '#ff0000');
});

test('SHX text is searchable once with crop-aware geometry and cannot replace plotted content', async () => {
  const bytes = await fixture([{ BS: { W: 0 }, T: PDFHexString.fromText(SHX) }]);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const data = await extractPageText(pdf, 1);
    const results = zoekPaginaAlleBronnen(data, buildPattern('104.50', false, false), '104.50', { annotations: [] }, { tekst: true, annotaties: true });
    assert.equal(results.length, 1);
    assert.equal(results[0].readOnly, true);
    assert.deepEqual(results[0].annotationBox, { x: 80, y: 650, width: 120, height: 20 });
    assert.equal(data.items.length, 0, 'metadata is not a fake text-layer span');
    state.documents = [{ id: 'shx-search', pdfDoc: pdf, annotations: [], textEdits: [] }];
    state.activeDocumentIndex = 0;
    state.search.results = results;
    state.search.currentIndex = 0;
    assert.equal(await replaceCurrentMatch('999'), null);
    assert.equal(await replaceAllMatches('999'), 0);
    assert.equal(state.documents[0].textEdits.length, 0);
  } finally { await pdf.loadingTask.destroy(); }
});

test('saving a new ordinary annotation preserves SHX metadata and plotted vectors', async () => {
  const bytes = await fixture([{ Border: [0, 0, 0] }]);
  const saved = await opslaan(bytes, [{ id: 'ordinary', type: 'box', page: 1,
    x: 300, y: 300, width: 80, height: 40, strokeColor: '#0000ff', color: '#0000ff', lineWidth: 2 }]);
  const dicts = await woordenboeken(saved);
  assert.equal(dicts.length, 2);
  const shx = dicts.find(({ dict }) => dict.lookup(PDFName.of('T'))?.decodeText() === SHX).dict;
  assert.equal(shx.has(PDFName.of('AP')), false);
  assert.equal(shx.lookup(PDFName.of('Contents')).decodeText(), TEXT);
  assert.equal((await laad(saved)).length, 1);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  async function drawing(data) {
    const pdf = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, verbosity: 0 }).promise;
    try { return await (await pdf.getPage(1)).getOperatorList({ annotationMode: 0 }); }
    finally { await pdf.loadingTask.destroy(); }
  }
  assert.deepEqual(await drawing(saved), await drawing(bytes));
});

test('thousands of SHX records stay out of the editable model but remain searchable', async () => {
  const bytes = await fixture(Array.from({ length: 1500 }, (_, i) => ({ BS: { W: 0 }, Contents: PDFString.of(`SHX-${i}`) })));
  assert.equal((await laad(bytes)).length, 0);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const data = await extractPageText(pdf, 1);
    const result = zoekPaginaAlleBronnen(data, buildPattern('SHX-1499', false, true), 'SHX-1499', { annotations: [] }, { tekst: true, annotaties: true });
    assert.equal(result.length, 1);
    assert.equal(data.shxAnnotations.length, 1500);
    assert.equal(zoekPaginaAlleBronnen(data, buildPattern('SHX', false, false), 'SHX', {}, { tekst: true, annotaties: false }).length, 0);
  } finally { await pdf.loadingTask.destroy(); }
});
