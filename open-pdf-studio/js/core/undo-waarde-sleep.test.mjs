// Een getal slepen is één ongedaan-stap (#1168): alle wijzigingen tussen
// beginWaardeSleep en eindeWaardeSleep worden samengevoegd, en annuleren
// (Escape) zet alles terug zonder spoor in de geschiedenis.
//
// Echte state-store en undo-manager (zie ./app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('./state.ts');
const undo = await import('./undo-manager.js');
const { voegWijzigingenSamen } = await import('./undo-samenvoegen.js');

function vak(id, extra = {}) {
  return { id, type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5, lineWidth: 1, ...extra };
}

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

const pauze = () => new Promise((r) => setTimeout(r, 0));

test('samenvoegen: eerste oude en laatste nieuwe toestand per annotatie', () => {
  const stap = (id, van, naar) => ({ type: 'modifyAnnotation', id, oldState: { id, w: van }, newState: { id, w: naar } });
  assert.deepEqual(voegWijzigingenSamen([stap('a', 1, 2), stap('a', 2, 3), stap('a', 3, 7)]),
    [{ type: 'modifyAnnotation', id: 'a', oldState: { id: 'a', w: 1 }, newState: { id: 'a', w: 7 } }]);
  const bulk = (van, naar) => ({ type: 'bulkModify', items: ['a', 'b'].map((id) => ({ id, oldState: { id, w: van }, newState: { id, w: naar } })) });
  assert.deepEqual(voegWijzigingenSamen([bulk(1, 2), bulk(2, 3), stap('a', 3, 9)]), [{
    type: 'bulkModify',
    items: [
      { id: 'a', oldState: { id: 'a', w: 1 }, newState: { id: 'a', w: 9 } },
      { id: 'b', oldState: { id: 'b', w: 1 }, newState: { id: 'b', w: 3 } },
    ],
  }]);
  const een = [stap('a', 1, 2)];
  assert.equal(voegWijzigingenSamen(een), een, 'één stap blijft zoals hij is');
  const gemengd = [stap('a', 1, 2), { type: 'modifyMeasureScale', oldState: 1, newState: 2 }];
  assert.equal(voegWijzigingenSamen(gemengd), gemengd, 'andere opdrachten blijven een samengestelde stap');
});

test('een sleep op één annotatie is één stap, ook met pauzes', async () => {
  const doc = openen([vak('a')]);
  const a = doc.annotations[0];
  undo.beginWaardeSleep();
  for (const w of [2, 3, 4]) {
    undo.recordPropertyChange(a);
    a.lineWidth = w;
    await pauze();
    undo.flushPropertyChange(); // zoals de wachttijd van 400 ms tijdens een trage sleep
    assert.equal(doc.undoStack.length, 0, 'tijdens de sleep komt er geen stap bij');
  }
  undo.recordPropertyChange(a);
  a.lineWidth = 5;
  await undo.eindeWaardeSleep();
  assert.equal(doc.undoStack.length, 1);
  assert.equal(doc.undoStack[0].type, 'modifyAnnotation');
  assert.equal(doc.undoStack[0].oldState.lineWidth, 1);
  assert.equal(doc.undoStack[0].newState.lineWidth, 5);
  assert.equal(doc.modified, true);
  await undo.undo();
  assert.equal(doc.annotations[0].lineWidth, 1, 'één keer ongedaan maken zet de beginwaarde terug');
  await undo.redo();
  assert.equal(doc.annotations[0].lineWidth, 5);
});

test('een sleep op een meervoudige selectie is één stap', async () => {
  const doc = openen([vak('a'), vak('b', { lineWidth: 3 })]);
  undo.beginWaardeSleep();
  for (const w of [4, 5, 6, 7]) {
    const origineel = doc.annotations.map((x) => ({ ...x }));
    for (const x of doc.annotations) x.lineWidth = w;
    undo.recordBulkModify(doc.annotations, origineel);
  }
  await undo.eindeWaardeSleep();
  assert.equal(doc.undoStack.length, 1);
  assert.equal(doc.undoStack[0].type, 'bulkModify');
  await undo.undo();
  assert.deepEqual(doc.annotations.map((x) => x.lineWidth), [1, 3]);
});

test('een sleep zonder wijziging laat de geschiedenis met rust', async () => {
  const doc = openen([vak('a')]);
  undo.beginWaardeSleep();
  await undo.eindeWaardeSleep();
  assert.equal(doc.undoStack.length, 0);
  assert.equal(doc.modified, false);
  // De transactie is dicht: een volgende stap komt gewoon op de stapel.
  const a = doc.annotations[0];
  const oud = { ...a };
  a.x = 9;
  undo.recordModify(a.id, oud, a);
  assert.equal(doc.undoStack.length, 1);
});

test('een wijziging van vóór de sleep blijft een eigen stap', async () => {
  const doc = openen([vak('a')]);
  const a = doc.annotations[0];
  undo.recordPropertyChange(a);
  a.color = '#ff0000';
  undo.beginWaardeSleep();
  undo.recordPropertyChange(a);
  a.lineWidth = 8;
  await undo.eindeWaardeSleep();
  assert.equal(doc.undoStack.length, 2);
  await undo.undo();
  assert.equal(doc.annotations[0].lineWidth, 1);
  assert.equal(doc.annotations[0].color, '#ff0000');
});

test('annuleren zet alles terug en laat geen spoor achter', async () => {
  const doc = openen([vak('a')]);
  const a = doc.annotations[0];
  // Eerst een gewone stap, ongedaan gemaakt: er valt iets opnieuw te doen.
  const oud = { ...a };
  a.x = 9;
  undo.recordModify(a.id, oud, a);
  await undo.undo();
  assert.equal(doc.redoStack.length, 1);
  const redo = doc.redoStack[0];
  doc.savedUndoStackLength = 0;
  doc.modified = false;

  undo.beginWaardeSleep();
  undo.recordPropertyChange(doc.annotations[0]);
  doc.annotations[0].lineWidth = 6;
  doc.annotations[0].height = 40; // een neveneffect dat de beginwaarde terugtypen niet herstelt
  await pauze();
  undo.flushPropertyChange();
  undo.recordPropertyChange(doc.annotations[0]);
  doc.annotations[0].lineWidth = 1; // het veld schrijft de beginwaarde terug
  await undo.eindeWaardeSleep({ annuleer: true });

  assert.equal(doc.annotations[0].lineWidth, 1);
  assert.equal(doc.annotations[0].height, 5, 'ook het neveneffect is terug');
  assert.equal(doc.undoStack.length, 0, 'geen stap van de afgebroken sleep');
  assert.equal(doc.redoStack.length, 1, 'Opnieuw is wat het was');
  assert.equal(doc.redoStack[0].newState.x, redo.newState.x);
  assert.equal(doc.modified, false, 'het document is niet gewijzigd');
});
