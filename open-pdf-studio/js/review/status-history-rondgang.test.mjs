// De reviewgeschiedenis overleeft opslaan -> heropenen (#629): elke stap is
// een eigen verborgen statusantwoord (/Text, /IRT, /State, /StateModel
// Review, /T, /M). Met de echte saver (saver-test-hooks.mjs) en de echte
// lader, zoals pdf/eigenschappen-rondgang.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

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

// ── Eigen statussen (#1076): een statusmodel met de naam van de set ─────────

const BOUW = {
  markupStatusSets: [{ name: 'Bouwteam', statuses: [
    { name: 'Approved With Comments', color: '#00aa00', closed: true },
    { name: 'Geëvalueerd', color: '#aa00aa' },
  ] }],
  activeMarkupStatusSet: 'Bouwteam',
};

function metVoorkeuren(prefs) {
  const oud = state.preferences;
  state.preferences = { ...(oud || {}), markupStatuses: [], markupStatusSets: [], activeMarkupStatusSet: '', ...prefs };
  return () => { state.preferences = oud; };
}

test('eigen statussen gaan heen en terug onder het model van hun set, ook met accenten', async () => {
  const herstel = metVoorkeuren(BOUW);
  try {
    const bx = rechthoek();
    setStatusWithHistory(bx, 'approved with comments', { door: 'Ann', nu: '2026-10-01T10:00:00.000Z' });
    setStatusWithHistory(bx, 'Geëvalueerd', { door: 'Bob', nu: '2026-10-02T10:00:00.000Z' });
    const bytes = await opslaan(await leegBlad(), [bx]);
    assert.deepEqual((await statusAntwoorden(bytes)).map((s) => [s.state, s.model, s.door]), [
      ['Approved With Comments', 'Bouwteam', 'Ann'],
      ['Geëvalueerd', 'Bouwteam', 'Bob'],
    ]);
    const [m] = await laad(bytes);
    assert.equal(m.status, 'geëvalueerd');
    assert.equal(m.statusBy, 'Bob');
    assert.equal(m.statusModel, 'Bouwteam');
    assert.equal(m.statusLabel, 'Geëvalueerd');
    assert.deepEqual(m.statusHistory, [
      { status: 'approved with comments', by: 'Ann', at: '2026-10-01T10:00:00.000Z', model: 'Bouwteam', label: 'Approved With Comments' },
      { status: 'geëvalueerd', by: 'Bob', at: '2026-10-02T10:00:00.000Z', model: 'Bouwteam', label: 'Geëvalueerd' },
    ]);
    assert.equal(m.type, 'box', 'statusantwoorden worden geen losse notities');
    // Ongewijzigd nog eens opslaan: dezelfde antwoorden, niet dubbel.
    const bytes2 = await opslaan(bytes, [m]);
    assert.deepEqual((await statusAntwoorden(bytes2)).map((s) => [s.state, s.model]), [
      ['Approved With Comments', 'Bouwteam'], ['Geëvalueerd', 'Bouwteam'],
    ]);
  } finally { herstel(); }
});

test('een set met een naam met accenten: het model komt heel terug', async () => {
  const herstel = metVoorkeuren({
    markupStatusSets: [{ name: 'Beoordeling één', statuses: [{ name: 'Akkoord' }] }], activeMarkupStatusSet: 'Beoordeling één',
  });
  try {
    const bx = { ...rechthoek(), status: 'akkoord', statusBy: 'Ann', statusAt: '2026-10-01T10:00:00.000Z' };
    const bytes = await opslaan(await leegBlad(), [bx]);
    assert.deepEqual((await statusAntwoorden(bytes)).map((s) => [s.state, s.model]), [['Akkoord', 'Beoordeling één']]);
    const [m] = await laad(bytes);
    assert.equal(m.status, 'akkoord');
    assert.equal(m.statusModel, 'Beoordeling één');
  } finally { herstel(); }
});

test('vaste statussen houden het model Review; bij een modelwissel wist een None het oude model', async () => {
  const herstel = metVoorkeuren(BOUW);
  try {
    const bx = rechthoek();
    setStatusWithHistory(bx, 'accepted', { door: 'Ann', nu: '2026-10-01T10:00:00.000Z' });
    setStatusWithHistory(bx, 'approved with comments', { door: 'Bob', nu: '2026-10-02T10:00:00.000Z' });
    setStatusWithHistory(bx, 'completed', { door: 'Cas', nu: '2026-10-03T10:00:00.000Z' });
    const bytes = await opslaan(await leegBlad(), [bx]);
    assert.deepEqual((await statusAntwoorden(bytes)).map((s) => [s.state, s.model, s.door]), [
      ['Accepted', 'Review', 'Ann'],
      ['None', 'Review', 'Bob'],
      ['Approved With Comments', 'Bouwteam', 'Bob'],
      ['None', 'Bouwteam', 'Cas'],
      ['Completed', 'Review', 'Cas'],
    ]);
    // De tussenstappen zijn geen eigen stap in de geschiedenis.
    const [m] = await laad(bytes);
    assert.equal(m.status, 'completed');
    assert.equal('statusModel' in m, false);
    assert.deepEqual(m.statusHistory.map((s) => [s.status, s.by]), [
      ['accepted', 'Ann'], ['approved with comments', 'Bob'], ['completed', 'Cas'],
    ]);
    // Een echte 'geen status' blijft wel een stap, in het model van de stap ervoor.
    setStatusWithHistory(m, 'geëvalueerd', { door: 'Ann', nu: '2026-10-04T10:00:00.000Z' });
    setStatusWithHistory(m, 'none', { door: 'Ann', nu: '2026-10-05T10:00:00.000Z' });
    const bytes2 = await opslaan(bytes, [m]);
    assert.deepEqual((await statusAntwoorden(bytes2)).slice(-3).map((s) => [s.state, s.model]), [
      ['None', 'Review'], ['Geëvalueerd', 'Bouwteam'], ['None', 'Bouwteam'],
    ]);
    const [m2] = await laad(bytes2);
    assert.equal(m2.status, undefined);
    assert.deepEqual(m2.statusHistory.map((s) => s.status), ['accepted', 'approved with comments', 'completed', 'geëvalueerd', 'none']);
  } finally { herstel(); }
});

// Een markering met een statusantwoord zoals een ander programma het schrijft.
async function metVreemdeStatus(state_, model, { datum = 'D:20261001100000Z' } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const vak = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [80, 472, 200, 542], C: [0, 0, 0], F: 4,
    T: PDFString.of('Ontwerper'), NM: PDFString.of('vak-1'),
  }));
  const antwoord = doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [80, 472, 200, 542], F: 30,
    T: PDFString.of('Dee'), M: PDFString.of(datum), Contents: PDFString.of(state_),
    State: PDFString.of(state_), StateModel: PDFString.of(model),
  });
  antwoord.set(PDFName.of('IRT'), vak);
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([vak, doc.context.register(antwoord)]));
  return doc.save();
}

test('een onbekende status uit een ander programma blijft staan: getoond, bewaard en met zijn eigen model teruggeschreven', async () => {
  const herstel = metVoorkeuren({});
  try {
    const bron = await metVreemdeStatus('Needs Info', 'VendorReview');
    const [m] = await laad(bron);
    assert.equal(m.status, 'needs info');
    assert.equal(m.statusBy, 'Dee');
    assert.equal(m.statusModel, 'VendorReview');
    assert.equal(m.statusLabel, 'Needs Info');
    // Ongewijzigd opslaan: het antwoord van het andere programma blijft staan.
    const bytes1 = await opslaan(bron, [m]);
    assert.deepEqual((await statusAntwoorden(bytes1)).map((s) => [s.state, s.model, s.door]), [['Needs Info', 'VendorReview', 'Dee']]);
    // Een nieuwe status erbij: de oude stap houdt zijn model en schrijfwijze.
    const [m1] = await laad(bytes1);
    setStatusWithHistory(m1, 'accepted', { door: 'Ann', nu: '2026-10-02T10:00:00.000Z' });
    assert.equal('statusModel' in m1, false);
    const bytes2 = await opslaan(bytes1, [m1]);
    assert.deepEqual((await statusAntwoorden(bytes2)).map((s) => [s.state, s.model, s.door]), [
      ['Needs Info', 'VendorReview', 'Dee'],
      ['None', 'VendorReview', 'Ann'],
      ['Accepted', 'Review', 'Ann'],
    ]);
    const [m2] = await laad(bytes2);
    assert.equal(m2.status, 'accepted');
    assert.deepEqual(m2.statusHistory.map((s) => [s.status, s.model, s.label]), [
      ['needs info', 'VendorReview', 'Needs Info'], ['accepted', undefined, undefined],
    ]);
  } finally { herstel(); }
});

test('een status die uit de set is verwijderd blijft op de markering en houdt zijn model bij het opslaan', async () => {
  let herstel = metVoorkeuren(BOUW);
  let bytes;
  try {
    const bx = { ...rechthoek(), status: 'approved with comments', statusBy: 'Ann', statusAt: '2026-10-01T10:00:00.000Z' };
    bytes = await opslaan(await leegBlad(), [bx]);
  } finally { herstel(); }
  herstel = metVoorkeuren({}); // de set bestaat niet meer
  try {
    const [m] = await laad(bytes);
    assert.equal(m.status, 'approved with comments');
    m.subject = 'iets anders gewijzigd';
    m.statusBy = 'Bob'; // de status zelf wordt herschreven
    const bytes2 = await opslaan(bytes, [m]);
    assert.deepEqual((await statusAntwoorden(bytes2)).map((s) => [s.state, s.model, s.door]), [['Approved With Comments', 'Bouwteam', 'Bob']]);
  } finally { herstel(); }
});

test('een bestand met eigen statussen onder Review (oude vorm) blijft werken en houdt dat model', async () => {
  const herstel = metVoorkeuren({ markupStatuses: [{ name: 'Approved', color: '#00aa00' }] });
  try {
    const bron = await metVreemdeStatus('Approved', 'Review');
    const [m] = await laad(bron);
    assert.equal(m.status, 'approved');
    assert.equal(m.statusModel, 'Review');
    setStatusWithHistory(m, 'rejected', { door: 'Ann', nu: '2026-10-02T10:00:00.000Z' });
    const bytes = await opslaan(bron, [m]);
    assert.deepEqual((await statusAntwoorden(bytes)).map((s) => [s.state, s.model]), [['Approved', 'Review'], ['Rejected', 'Review']]);
    // Nieuw gezet komt dezelfde status onder de (oude, platte) set.
    const bx = { ...rechthoek(), status: 'approved', statusBy: 'Ann', statusAt: '2026-10-01T10:00:00.000Z' };
    const nieuw = await opslaan(await leegBlad(), [bx]);
    assert.deepEqual((await statusAntwoorden(nieuw)).map((s) => [s.state, s.model]), [['Approved', 'Custom']]);
  } finally { herstel(); }
});
