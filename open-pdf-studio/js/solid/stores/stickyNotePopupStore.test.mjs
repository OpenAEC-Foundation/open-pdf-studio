import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.ts');
const { openStickyPopup, getOpenPopups, pruneStickyPopups, updatePopupText } = await import('./stickyNotePopupStore.js');
const { deleteAnnotationsWithUndo } = await import('../../annotations/mutations.js');
const { undo, redo } = await import('../../core/undo-manager.js');
function setup() {
  pruneStickyPopups([]);
  state.documents = [{ id: 'doc', annotations: ['a', 'b'].map(id => ({ id, type: 'comment', page: 1, text: 'original' })),
    pdfDoc: { numPages: 1 }, currentPage: 1, selectedAnnotations: [], selectedAnnotation: null,
    undoStack: [], redoStack: [], savedUndoStackLength: 0, textEdits: [], watermarks: [], bookmarks: [], pageRotations: {} }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}
test('deleting an edited comment discards its popup without adding a dangling edit to undo', async () => {
  const doc = setup(); const [a, b] = doc.annotations;
  openStickyPopup(a); openStickyPopup(b); updatePopupText(a.id, 'edited');
  deleteAnnotationsWithUndo(doc, [a]); pruneStickyPopups(doc.annotations);
  assert.deepEqual(getOpenPopups().map(p => p.annotationId), ['b']);
  assert.equal(a.popupOpen, false); assert.equal(b.popupOpen, true);
  assert.equal(doc.undoStack.length, 1);
  await undo();
  assert.equal(doc.annotations.find(a => a.id === 'a').text, 'edited');
  openStickyPopup(doc.annotations.find(a => a.id === 'a'));
  await redo(); pruneStickyPopups(doc.annotations);
  assert.deepEqual(getOpenPopups().map(p => p.annotationId), ['b']);
  assert.equal(doc.undoStack.length, 1);
});
test('bulk deletion discards all deleted editors, while a no-op retains them', () => {
  const doc = setup(); doc.annotations.forEach(openStickyPopup);
  deleteAnnotationsWithUndo(doc, []); pruneStickyPopups(doc.annotations);
  assert.equal(getOpenPopups().length, 2);
  deleteAnnotationsWithUndo(doc, [...doc.annotations]); pruneStickyPopups(doc.annotations);
  assert.equal(getOpenPopups().length, 0); assert.equal(doc.undoStack.length, 1);
});
test('a replacement object with the same id does not keep an editor bound to the old annotation', () => {
  const doc = setup(); openStickyPopup(doc.annotations[0]);
  doc.annotations = doc.annotations.map(a => ({ ...a }));
  pruneStickyPopups(doc.annotations);
  assert.equal(getOpenPopups().length, 0); assert.equal(doc.undoStack.length, 0);
});
