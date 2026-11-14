// De reviewgeschiedenis overleeft opslaan -> heropenen (#629): elke stap is
// een eigen verborgen statusantwoord (/Text, /IRT, /State, /StateModel
// Review, /T, /M). Met de echte saver (saver-test-hooks.mjs) en de echte
// lader, zoals pdf/eigenschappen-rondgang.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('../pdf/saver.js');
const { zetPaginaAnnotatiesOm } = await import('../pdf/loader/annotaties-omzetten.js');
const { extractAnnotationColors } = await import('../pdf/loader/color-extraction.js');
const { decodePdfTextObject } = await import('../pdf/saver/pdf-text.js');
const { setStatusWithHistory } = await import('./status-history.js');

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
    id: 'reviewgeschiedenis', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
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

async function statusAntwoorden(bytes) {
  const doc = await PDFDocument.load(bytes);
  const refs = doc.getPage(0).node.Annots()?.asArray() || [];
  return refs.map((r) => doc.context.lookup(r))
    .filter((d) => d.get(PDFName.of('Subtype'))?.toString() === '/Text' && d.get(PDFName.of('State')))
    .map((d) => ({
      state: decodePdfTextObject(d.get(PDFName.of('State'))),
      model: decodePdfTextObject(d.get(PDFName.of('StateModel'))),
      door: decodePdfTextObject(d.get(PDFName.of('T'))),
      heeftIrt: d.get(PDFName.of('IRT')) !== undefined,
    }));
}

const rechthoek = () => ({
  id: 'bx', type: 'box', page: 1, x: 80, y: 300, width: 120, height: 70, rotation: 0,
  color: '#000000', strokeColor: '#000000', fillColor: null, lineWidth: 1, borderStyle: 'solid', opacity: 1, author: 'Ontwerper',
});

test('elke statusstap wordt een statusantwoord en komt na twee keer opslaan in dezelfde volgorde terug', async () => {
  const bx = rechthoek();
  setStatusWithHistory(bx, 'accepted', { door: 'Ann', nu: '2026-10-01T10:00:00.000Z' });
  setStatusWithHistory(bx, 'rejected', { door: 'Bob', nu: '2026-10-02T10:00:00.000Z' });
  setStatusWithHistory(bx, 'completed', { door: 'Cas', nu: '2026-10-03T10:00:00.000Z' });

  const bytes1 = await opslaan(await leegBlad(), [bx]);
  assert.deepEqual(await statusAntwoorden(bytes1), [
    { state: 'Accepted', model: 'Review', door: 'Ann', heeftIrt: true },
    { state: 'Rejected', model: 'Review', door: 'Bob', heeftIrt: true },
    { state: 'Completed', model: 'Review', door: 'Cas', heeftIrt: true },
  ]);
  const [m1] = await laad(bytes1);
  assert.equal(m1.status, 'completed');
  assert.equal(m1.statusBy, 'Cas');
  assert.deepEqual(m1.statusHistory.map((s) => [s.status, s.by, s.at]), [
    ['accepted', 'Ann', '2026-10-01T10:00:00.000Z'],
    ['rejected', 'Bob', '2026-10-02T10:00:00.000Z'],
    ['completed', 'Cas', '2026-10-03T10:00:00.000Z'],
  ]);

  // Heropend, nog een stap, en weer opslaan: niets van het verloop gaat verloren.
  setStatusWithHistory(m1, 'none', { door: 'Ann', nu: '2026-10-04T10:00:00.000Z' });
  const bytes2 = await opslaan(bytes1, [m1]);
  assert.deepEqual((await statusAntwoorden(bytes2)).map((s) => s.state), ['Accepted', 'Rejected', 'Completed', 'None']);
  const [m2] = await laad(bytes2);
  assert.equal(m2.status, undefined);
  assert.deepEqual(m2.statusHistory.map((s) => s.status), ['accepted', 'rejected', 'completed', 'none']);
  assert.equal(m2.type, 'box', 'statusantwoorden worden geen losse notities');
});

test('een enkele status blijft één statusantwoord, zonder geschiedenisveld', async () => {
  const bx = { ...rechthoek(), status: 'accepted', statusBy: 'Ann', statusAt: '2026-10-01T10:00:00.000Z' };
  const bytes = await opslaan(await leegBlad(), [bx]);
  assert.equal((await statusAntwoorden(bytes)).length, 1);
  const modellen = await laad(bytes);
  assert.equal(modellen.length, 1);
  assert.equal(modellen[0].status, 'accepted');
  assert.equal('statusHistory' in modellen[0], false);
});

test('een ongewijzigde markering houdt haar statusantwoorden: niet dubbel, niet ingekort', async () => {
  const bx = rechthoek();
  setStatusWithHistory(bx, 'accepted', { door: 'Ann', nu: '2026-10-01T10:00:00.000Z' });
  setStatusWithHistory(bx, 'rejected', { door: 'Bob', nu: '2026-10-02T10:00:00.000Z' });
  const bytes1 = await opslaan(await leegBlad(), [bx]);
  const bytes2 = await opslaan(bytes1, await laad(bytes1));
  assert.deepEqual((await statusAntwoorden(bytes2)).map((s) => [s.state, s.door]), [['Accepted', 'Ann'], ['Rejected', 'Bob']]);
});

test('eigen statussen (#1076) gaan als statusantwoord met hun eigen naam heen en terug, ook met accenten', async () => {
  state.preferences = { ...(state.preferences || {}), markupStatuses: [
    { name: 'Approved With Comments', color: '#00aa00', closed: true },
    { name: 'Geëvalueerd', color: '#aa00aa' },
  ] };
  const bx = rechthoek();
  setStatusWithHistory(bx, 'approved with comments', { door: 'Ann', nu: '2026-10-01T10:00:00.000Z' });
  setStatusWithHistory(bx, 'Geëvalueerd', { door: 'Bob', nu: '2026-10-02T10:00:00.000Z' });
  const bytes = await opslaan(await leegBlad(), [bx]);
  assert.deepEqual((await statusAntwoorden(bytes)).map((s) => [s.state, s.model]), [
    ['Approved With Comments', 'Review'],
    ['Geëvalueerd', 'Review'],
  ]);
  const [m] = await laad(bytes);
  assert.equal(m.status, 'geëvalueerd');
  assert.deepEqual(m.statusHistory.map((s) => s.status), ['approved with comments', 'geëvalueerd']);
  delete state.preferences.markupStatuses;
});
