// Count groups (#1235): the size of the markers of a group, and deleting a
// group with its markers. In the real app modules, like countStore.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state, getAnnotationBounds } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const store = await import('./countStore.js');
const { telSchaal, tellingKader, telGroepen, telGroepVelden, TELSCHAAL_KEUZES } = await import('../../annotations/telling.js');
const { bouwTellingDict, tellingUitExtra } = await import('../../pdf/saver/telling.js');

const tel = (id, extra = {}) => ({
  id, type: 'count', page: 1, x: 100, y: 100, color: '#e11d48', strokeColor: '#e11d48', opacity: 1, ...extra,
});

function openen(annotations) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('the marker size is a factor, 1 without a value, and stays within limits', () => {
  assert.equal(telSchaal({}), 1);
  assert.equal(telSchaal(null), 1);
  assert.equal(telSchaal({ markerScale: 1.5 }), 1.5);
  assert.equal(telSchaal({ markerScale: 'x' }), 1);
  assert.equal(telSchaal({ markerScale: -2 }), 1);
  assert.equal(telSchaal({ markerScale: 50 }), 4);
  assert.equal(telSchaal({ markerScale: 0.01 }), 0.25);
  assert.ok(TELSCHAAL_KEUZES.includes(100) && TELSCHAAL_KEUZES.includes(50) && TELSCHAAL_KEUZES.includes(200));
});

test('the selection bounds grow with the marker', () => {
  assert.deepEqual(tellingKader({ x: 40, y: 60 }), { x: 29, y: 49, width: 22, height: 22 });
  assert.deepEqual(tellingKader({ x: 40, y: 60, markerScale: 2 }), { x: 18, y: 38, width: 44, height: 44 });
  assert.deepEqual(getAnnotationBounds(tel('a', { x: 40, y: 60, markerScale: 2 })), { x: 18, y: 38, width: 44, height: 44 });
});

test('a marker that joins a group takes the size of the group; the usual size is not stored', () => {
  assert.equal(telGroepVelden({ id: 'g', name: 'G', color: '#000000', markerScale: 1.5 }).markerScale, 1.5);
  assert.equal(telGroepVelden({ id: 'g', name: 'G', color: '#000000' }).markerScale, undefined);
  assert.equal(telGroepVelden({ id: 'g', name: 'G', color: '#000000', markerScale: 1 }).markerScale, undefined);
});

test('a reopened file gives the group its size back from its markers', () => {
  const rijen = telGroepen([], [tel('a', { categoryId: 'kleppen', categoryName: 'Kleppen', markerScale: 2 }), tel('b', { categoryId: 'los' })]);
  assert.equal(rijen.find(r => r.id === 'kleppen').markerScale, 2);
  assert.equal('markerScale' in rijen.find(r => r.id === 'los'), false);
});

test('changing the size of a group resizes every marker in one undo step', () => {
  const doc = openen([
    tel('a', { categoryId: 'deuren', number: 1 }), tel('b', { categoryId: 'deuren', number: 2 }),
    tel('c', { categoryId: 'ramen', number: 1 }),
  ]);
  store.updateCountGroup('deuren', { markerScale: 1.5 });
  assert.deepEqual(doc.annotations.map(a => a.markerScale), [1.5, 1.5, undefined]);
  assert.equal(store.countGroups().find(g => g.id === 'deuren').markerScale, 1.5);
  undo.undo();
  assert.deepEqual(state.documents[0].annotations.map(a => a.markerScale), [undefined, undefined, undefined]);
  // Back to the usual size: the field goes away again.
  store.updateCountGroup('deuren', { markerScale: 1.5 });
  store.updateCountGroup('deuren', { markerScale: 1 });
  assert.equal('markerScale' in state.documents[0].annotations[0], false);
  store.updateCountCategory('deuren', { markerScale: 1 });
});

test('deleting a group removes its markers in one undo step and leaves the other groups alone', () => {
  const doc = openen([
    tel('a', { categoryId: 'deuren', number: 1 }), tel('b', { categoryId: 'ramen', number: 1 }),
    tel('c', { categoryId: 'deuren', number: 2 }),
  ]);
  const id = store.addCountCategory('Tijdelijk', '#123456');
  doc.annotations.push(tel('t1', { categoryId: id, number: 1 }), tel('t2', { categoryId: id, number: 2 }));
  doc.selectedAnnotations = [doc.annotations[3]];
  store.setActiveCountCategory(id);

  const uit = store.deleteCountGroup(id);
  assert.deepEqual(uit, { ok: true, verwijderd: 2, vergrendeld: 0 });
  assert.deepEqual(state.documents[0].annotations.map(a => a.id), ['a', 'b', 'c']);
  assert.equal(store.countGroups().some(g => g.id === id), false, 'the group is gone from the list');
  assert.notEqual(store.activeCountCategoryId(), id, 'another group is active');
  assert.equal(state.documents[0].selectedAnnotations.length, 0);

  undo.undo();
  assert.deepEqual(state.documents[0].annotations.map(a => a.id).sort(), ['a', 'b', 'c', 't1', 't2']);
  // The markers carry their group, so the group is back with them.
  assert.equal(store.countGroups().find(g => g.id === id)?.count, 2);
});

test('a group with a locked marker is not deleted', () => {
  openen([tel('a', { categoryId: 'ramen', number: 1, locked: true }), tel('b', { categoryId: 'ramen', number: 2 })]);
  assert.deepEqual(store.deleteCountGroup('ramen'), { ok: false, verwijderd: 0, vergrendeld: 1 });
  assert.equal(state.documents[0].annotations.length, 2);
  assert.deepEqual(store.deleteCountGroup('(geen)'), { ok: false, verwijderd: 0, vergrendeld: 0 });
});

test('an empty group is deleted without touching the document', () => {
  openen([tel('a', { categoryId: 'deuren', number: 1 })]);
  const id = store.addCountCategory('Leeg', '#abcdef');
  assert.deepEqual(store.deleteCountGroup(id), { ok: true, verwijderd: 0, vergrendeld: 0 });
  assert.equal(state.documents[0].undoStack.length, 0);
});

test('the size is saved with the marker and read back', async () => {
  const pdf = await PDFDocument.create();
  const groot = bouwTellingDict(pdf.context, { type: 'count', x: 100, y: 100, number: 7, markerScale: 2 }, (x) => x, (y) => y);
  const gewoon = bouwTellingDict(pdf.context, { type: 'count', x: 100, y: 100, number: 7 }, (x) => x, (y) => y);
  const breedte = (d) => { const r = d.get(PDFName.of('Rect')).asArray().map(n => n.asNumber()); return r[2] - r[0]; };
  assert.equal(breedte(gewoon), 20);
  assert.equal(breedte(groot), 38, 'radius 18 plus the edge');
  assert.equal(groot.get(PDFName.of('OPS_MarkerScale')).asNumber(), 2);
  assert.equal(gewoon.get(PDFName.of('OPS_MarkerScale')), undefined);
  const rect = { x: 0, y: 0, width: 38, height: 38 };
  assert.equal(tellingUitExtra({ opsSubtype: 'count', opsMarkerScale: 2 }, rect).markerScale, 2);
  assert.equal('markerScale' in tellingUitExtra({ opsSubtype: 'count' }, rect), false);
  assert.match(readFileSync(new URL('../../pdf/loader/color-extraction.js', import.meta.url), 'utf8'), /OPS_MarkerScale/);
});

test('drawing, hit testing and the controls use the size', () => {
  const lees = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(lees('../../annotations/rendering.js'), /const telMaat = telSchaal\(annotation\);/);
  assert.match(lees('../../annotations/geometry.js'), /11 \* telSchaal\(ann\) \+ tol \/ 2/);
  const lint = lees('../components/ribbon/CountGroupRibbonControls.jsx');
  assert.match(lint, /id="count-group-size"/);
  assert.match(lint, /id="count-group-delete"/);
  assert.match(lees('../components/properties-panel/CountGroupSection.jsx'), /id="prop-count-group-size"/);
});
