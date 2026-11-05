// Profieltype van een geplaatst staalprofiel wisselen (#697): UNP 200 wordt
// een HEB, HEA, IPE, koker of hoeklijn met de maat die qua profielhoogte het
// dichtst bij ligt, op dezelfde plek en in dezelfde stijl. Eén ongedaan-stap,
// ook bij meervoudige selectie, en het overleeft opslaan en heropenen.
//
// De echte app-modules onder node (core/app-test-hooks.mjs), de echte saver
// en lader zoals in pdf/koker-rondgang.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const undo = await import('../core/undo-manager.js');
const pt = await import('./profieltype.js');
const { getTemplate, registerTemplate, unregisterTemplate } = await import('./registry.js');
const { steelCatalogTemplates, parseSteelSectionCatalog } = await import('./steel-catalog.js');
const { pxPerMmAt } = await import('./real-size.js');
const {
  storeShowProperties, storeShowMultiSelection, annotProps, updateAnnotProp,
} = await import('../solid/stores/propertiesStore.js');
const { savePDF } = await import('../pdf/saver.js');
const { zetPaginaAnnotatiesOm } = await import('../pdf/loader/annotaties-omzetten.js');
const { extractAnnotationColors } = await import('../pdf/loader/color-extraction.js');

const NL = ['staal-hea', 'staal-heb', 'staal-ipe', 'staal-unp', 'staal-koker', 'staal-hoeklijn', 'staal-chs'];

function openen(annotations) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: 'C:/rondgang/bron.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
    _annotationPagesReady: new Set([1]),
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const unp = (id = 'p1', extra = {}) => ({
  id, type: 'parametricSymbol', page: 1, symbolId: 'staal-unp',
  x: 100, y: 200, width: 75, height: 200, rotation: 30, flipX: true,
  color: '#0000ff', strokeColor: '#0000ff', lineWidth: 0.7, opacity: 0.8, layer: 'laag-staal',
  ifcCategory: 'IfcMember', author: 'Tester',
  params: { maat: 'UNP 200', aanzicht: 'doorsnede', schaal: 1, hartlijn: false, toonLabel: true },
  createdAt: '2026-10-22T10:00:00.000Z', modifiedAt: '2026-10-22T10:00:00.000Z',
  ...extra,
});

const midden = (a) => ({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

test('de NL-profielen vormen één groep; een ander symbool hoort er niet bij', () => {
  assert.deepEqual(pt.profielTypen('staal-unp').map((t) => t.id), NL);
  assert.deepEqual(pt.profielTypen('staal-koker').map((t) => t.id), NL);
  assert.equal(pt.profielTypen('hout-balk').length, 0);
  assert.equal(pt.profielTypen('door').length, 0);
  assert.equal(pt.isWisselbaarProfiel(unp()), true);
  assert.equal(pt.isWisselbaarProfiel({ type: 'parametricSymbol', symbolId: 'door' }), false);
  assert.equal(pt.isWisselbaarProfiel({ type: 'stamp', symbolId: 'staal-unp' }), false);
});

test('de maat met de dichtstbijzijnde profielhoogte', () => {
  const h = (id, maat) => pt.profielHoogteMm(getTemplate(id), maat);
  assert.equal(h('staal-unp', 'UNP 200'), 200);
  assert.equal(h('staal-hea', 'HEA 200'), 190);
  assert.equal(h('staal-koker', 'Koker 100x50x5'), 50, 'koker: de hoogte, niet de breedte');
  const maat = (id, hoogte) => pt.dichtsteMaat(getTemplate(id), hoogte);
  assert.equal(maat('staal-heb', 200), 'HEB 200');
  assert.equal(maat('staal-ipe', 200), 'IPE 200');
  assert.equal(maat('staal-hea', 200), 'HEA 200', 'gelijke afstand (190/210): de eerste');
  assert.equal(maat('staal-hea', 205), 'HEA 220');
  assert.equal(maat('staal-koker', 200), 'K200/10');
  assert.equal(maat('staal-hoeklijn', 200), 'L 200x200x20');
  assert.equal(maat('staal-hoeklijn', 80), 'L 80x80x8');
  assert.equal(maat('staal-hoeklijn', 500), 'L 200x200x20', 'groter dan de tabel: de grootste');
  assert.equal(maat('staal-ipe', 79), 'IPE 80');
  // Geen bruikbare hoogte: de standaardmaat van de familie.
  assert.equal(maat('staal-heb', null), 'HEB 200');
  assert.equal(maat('staal-koker', NaN), 'K100/5');
});

test('UNP 200 naar HEB, HEA, IPE, koker en hoeklijn: plek, stijl en overige parameters blijven', () => {
  openen([]);
  const verwacht = {
    'staal-heb': ['HEB 200', 200, 200], 'staal-hea': ['HEA 200', 200, 190], 'staal-ipe': ['IPE 200', 100, 200],
    'staal-koker': ['K200/10', 200, 200], 'staal-hoeklijn': ['L 200x200x20', 200, 200],
    'staal-chs': ['CHS 193.7x6.3', 193.7, 193.7],
  };
  for (const [id, [maat, bMm, hMm]] of Object.entries(verwacht)) {
    const a = unp();
    const m0 = midden(a);
    assert.equal(pt.wisselProfielType(a, id), true, id);
    assert.equal(a.symbolId, id);
    assert.deepEqual(a.params, { maat, aanzicht: 'doorsnede', schaal: 1, hartlijn: false, toonLabel: true }, id);
    // Ware grootte via de schaal op het punt (real-size.js), rond hetzelfde midden.
    const k = pxPerMmAt(1, m0.x, m0.y);
    bijna(a.width, bMm * k, `${id} breedte`);
    bijna(a.height, hMm * k, `${id} hoogte`);
    bijna(midden(a).x, m0.x, `${id} midden x`);
    bijna(midden(a).y, m0.y, `${id} midden y`);
    for (const [veld, waarde] of Object.entries({ rotation: 30, flipX: true, color: '#0000ff', strokeColor: '#0000ff',
      lineWidth: 0.7, opacity: 0.8, layer: 'laag-staal', ifcCategory: 'IfcMember', page: 1, id: 'p1' })) {
      assert.equal(a[veld], waarde, `${id}.${veld}`);
    }
  }
  // Hetzelfde type of een onbekend/ander symbool: niets.
  const a = unp();
  const voor = JSON.stringify(a);
  assert.equal(pt.wisselProfielType(a, 'staal-unp'), false);
  assert.equal(pt.wisselProfielType(a, 'hout-balk'), false);
  assert.equal(pt.wisselProfielType(a, 'bestaat-niet'), false);
  assert.equal(JSON.stringify(a), voor);
  // Een boven-/zijaanzicht houdt zijn lengte, alleen de bandhoogte verandert.
  const zij = unp('z', { width: 900, params: { maat: 'UNP 200', aanzicht: 'zij', schaal: 1 } });
  pt.wisselProfielType(zij, 'staal-ipe');
  assert.equal(zij.params.aanzicht, 'zij');
  assert.equal(zij.width, 900);
});

test('eigenschappenpaneel: het veld, één ongedaan-stap, en het paneel volgt het nieuwe type', async () => {
  const a = unp();
  const doc = openen([a]);
  doc.selectedAnnotation = a;
  doc.selectedAnnotations = [a];
  storeShowProperties(a);
  assert.equal(annotProps.profielType, 'staal-unp');
  assert.deepEqual(annotProps.profielTypen.map((t) => t.id), NL);

  updateAnnotProp('profielType', 'staal-heb');
  assert.equal(a.symbolId, 'staal-heb');
  assert.equal(annotProps.symbolId, 'staal-heb', 'het paneel toont het nieuwe sjabloon');
  assert.equal(annotProps.params.maat, 'HEB 200');
  await new Promise((r) => setTimeout(r, 0));
  undo.flushPropertyChange();
  assert.equal(doc.undoStack.length, 1, 'één ongedaan-stap');

  await undo.undo();
  const terug = doc.annotations.find((x) => x.id === 'p1');
  assert.equal(terug.symbolId, 'staal-unp');
  assert.equal(terug.params.maat, 'UNP 200');
  assert.equal(terug.width, 75);
  assert.equal(terug.height, 200);
});

test('meervoudige selectie: alle profielen wisselen, in één ongedaan-stap', async () => {
  const a = unp('p1');
  const b = unp('p2', { symbolId: 'staal-ipe', x: 400, params: { maat: 'IPE 300', aanzicht: 'doorsnede', schaal: 1 } });
  const doc = openen([a, b]);
  doc.selectedAnnotations = [a, b];
  storeShowMultiSelection([a, b]);
  assert.equal(annotProps.profielType, 'mixed');
  assert.equal(annotProps.profielTypen.length, NL.length);

  updateAnnotProp('profielType', 'staal-hea');
  assert.deepEqual([a.symbolId, a.params.maat, b.symbolId, b.params.maat],
    ['staal-hea', 'HEA 200', 'staal-hea', 'HEA 300']);
  assert.equal(annotProps.profielType, 'staal-hea', 'het paneel toont het gedeelde type');
  assert.equal(doc.undoStack.length, 1);
  await undo.undo();
  const [ta, tb] = ['p1', 'p2'].map((id) => doc.annotations.find((x) => x.id === id));
  assert.deepEqual([ta.symbolId, ta.params.maat, tb.symbolId, tb.params.maat],
    ['staal-unp', 'UNP 200', 'staal-ipe', 'IPE 300']);

  // Een selectie met iets anders erbij: geen profieltype-veld.
  const deur = { id: 'd', type: 'parametricSymbol', page: 1, symbolId: 'door', x: 0, y: 0, width: 50, height: 50, params: {} };
  storeShowMultiSelection([ta, deur]);
  assert.equal(annotProps.profielTypen.length, 0);
});

test('profielen uit een gedownloade staalcatalogus wisselen onderling', () => {
  const catalogus = parseSteelSectionCatalog({
    format: 'steel-sections', formatVersion: 1, units: 'mm', label: { en: 'Test' },
    families: [
      { id: 'w', name: { en: 'W' }, shape: 'i', defaultSize: 'W 10', sizes: [['W 8', 203, 133, 6, 10, 8], ['W 10', 254, 146, 6, 11, 8]] },
      { id: 'c', name: { en: 'C' }, shape: 'u', defaultSize: 'C 8', sizes: [['C 6', 152, 48, 5, 9, 6], ['C 8', 203, 57, 6, 10, 6]] },
    ],
  });
  const sjablonen = steelCatalogTemplates('proef', catalogus, 'en');
  for (const t of sjablonen) registerTemplate(t);
  try {
    assert.deepEqual(pt.profielTypen('steel-proef-w').map((t) => t.id), ['steel-proef-w', 'steel-proef-c']);
    openen([]);
    const a = { ...unp(), symbolId: 'steel-proef-c', params: { maat: 'C 8', aanzicht: 'doorsnede', schaal: 1 } };
    assert.equal(pt.wisselProfielType(a, 'steel-proef-w'), true);
    assert.equal(a.params.maat, 'W 8');
    assert.equal(pt.wisselProfielType(a, 'staal-heb'), false, 'een andere groep');
  } finally {
    for (const t of sjablonen) unregisterTemplate(t.id);
  }
});

async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  openen(modellen);
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
  return modellen.filter((m) => m.type === 'parametricSymbol');
}

test('opslaan en heropenen: een oud bestand met UNP, gewisseld naar HEB, blijft HEB', async () => {
  const leeg = await PDFDocument.create();
  leeg.addPage([595, 842]);
  // Zoals een oudere versie het schreef: alleen het oude symbool-id.
  const oud = await opslaan(await leeg.save(), [unp('p1', { rotation: 0, flipX: false })]);
  const [geladen] = await laad(oud);
  assert.equal(geladen.symbolId, 'staal-unp');
  assert.equal(pt.wisselProfielType(geladen, 'staal-heb'), true);
  const nieuw = await opslaan(oud, [geladen]);
  const [terug] = await laad(nieuw);
  assert.equal(terug.symbolId, 'staal-heb');
  assert.equal(terug.params.maat, 'HEB 200');
  assert.equal(terug.params.toonLabel, true);
  assert.equal(terug.params.hartlijn, false);
  bijna(terug.width, geladen.width, 'breedte');
  bijna(terug.height, geladen.height, 'hoogte');
});

test('new NL round sections, pile marker and span harpoon retain editable parameters after saving', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const examples = [
    ['staal-chs', { maat: 'CHS 168.3x6.3', aanzicht: 'zij', schaal: 1, hartlijn: false }],
    ['hout-rond', { diameter: 250, schaal: 2, houtsoort: 'eiken', toonLabel: true }],
    ['beton-rond', { diameter: 600, schaal: 1, toonLabel: false }],
    ['paal-plattegrond', { nummer: 'P-12', toonLabel: true }],
    ['overspanningsharpoen-vloer', { lengte: 4500, tekst: 'Vloer A' }],
  ];
  const annotations = examples.map(([symbolId, params], i) => unp(`new-${i}`, {
    symbolId, params, x: 40, y: 60 + i * 130, width: 100, height: 100,
    rotation: 0, flipX: false,
  }));
  const bytes = await opslaan(await source.save(), annotations);
  // app-test-hooks stubs the renderer; actual PNG appearances are checked
  // separately in the browser smoke test, with the real canvas renderer.
  const restored = await laad(bytes);
  assert.equal(restored.length, examples.length);
  for (const [symbolId, params] of examples) {
    const ann = restored.find(a => a.symbolId === symbolId);
    assert.ok(ann, symbolId);
    assert.deepEqual(ann.params, params, symbolId);
    assert.ok(getTemplate(symbolId).render(ann.params, ann).length > 0);
  }
});
