// Kenmerken terugzetten in de echte app-modules (#629): de staten-store past
// de wijzigingen toe als één stap die ongedaan te maken is.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const undo = await import('../core/undo-manager.js');
const { applyScheduleTagUpdates } = await import('../solid/stores/schedulesStore.js');

function openen(annotations) {
  state.documents = [{
    id: 'doc-tags', filePath: null, pdfDoc: { numPages: 1 }, currentPage: 1, scale: 1, viewMode: 'single',
    annotations, annotationLayers: [
      { id: 'default', name: '', color: null, visible: true, printable: true, locked: false },
      { id: 'dicht', name: 'Dicht', color: null, visible: true, printable: true, locked: true },
    ],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('terugzetten wijzigt de annotaties, slaat een vergrendelde laag over en is in één stap ongedaan te maken', async () => {
  openen([
    { id: 'v1', type: 'box', page: 1, x: 0, y: 0, width: 10, height: 10, subject: 'Oud' },
    { id: 'v2', type: 'box', page: 1, x: 20, y: 0, width: 10, height: 10, subject: 'Laag', layer: 'dicht' },
  ]);
  const uit = applyScheduleTagUpdates([
    { id: 'v1', fields: { label: 'Nieuw', ifcCategory: 'IfcWall' } },
    { id: 'v2', fields: { label: 'Mag niet' } },
    { id: 'weg', fields: { label: 'x' } },
  ]);
  assert.deepEqual(uit, { changed: 1, notFound: 1, locked: 1, unknownCountCategories: [] });
  const [v1, v2] = state.documents[0].annotations;
  assert.equal(v1.subject, 'Nieuw');
  assert.equal(v1.ifcCategory, 'IfcWall');
  assert.equal(v2.subject, 'Laag');
  assert.equal(state.documents[0].undoStack.length, 1);

  await undo.undo();
  assert.equal(state.documents[0].annotations[0].subject, 'Oud');
  assert.equal('ifcCategory' in state.documents[0].annotations[0], false);
  await undo.redo();
  assert.equal(state.documents[0].annotations[0].subject, 'Nieuw');
});
