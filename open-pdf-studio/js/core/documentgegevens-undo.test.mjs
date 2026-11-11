// Documentgegevens bewerken in het eigenschappen-paneel (#1017): het veld
// komt in de overlay van het document, maakt het gewijzigd en is met één
// Ctrl+Z per veld ongedaan te maken. Met de echte state-store, undo-manager
// en eigenschappen-store (zie ./app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('./state.ts');
const undo = await import('./undo-manager.js');
const { docInfo, populateDocInfo, zetDocumentgegeven } = await import('../solid/stores/propertiesStore.js');

function openen(info) {
  const pdfDoc = {
    numPages: 1,
    getPage: async () => ({ getViewport: () => ({ width: 595, height: 842 }) }),
    getMetadata: async () => ({ info }),
  };
  state.documents = [{
    id: 'doc-info', filePath: null, pdfDoc, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: [], selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('een veld invullen zet de overlay, maakt het document gewijzigd en is ongedaan te maken', async () => {
  openen({ Title: 'Uit het bestand', Author: 'Bestandsauteur', Producer: 'Iets' });
  await populateDocInfo();
  assert.equal(docInfo.title, 'Uit het bestand');
  assert.equal(docInfo.keywords, '');
  assert.equal(docInfo.editable, true);

  assert.equal(zetDocumentgegeven('title', 'Nieuwe titel'), true);
  assert.equal(zetDocumentgegeven('author', ''), true);
  const doc = state.documents[0];
  assert.deepEqual({ ...doc.documentgegevens }, { title: 'Nieuwe titel', author: '' });
  assert.equal(doc.modified, true);
  assert.equal(doc.undoStack.length, 2, 'één stap per veld');
  assert.equal(docInfo.title, 'Nieuwe titel');

  // Dezelfde waarde nog eens: geen stap.
  assert.equal(zetDocumentgegeven('title', 'Nieuwe titel'), false);
  assert.equal(doc.undoStack.length, 2);

  await undo.undo();
  assert.deepEqual({ ...state.documents[0].documentgegevens }, { title: 'Nieuwe titel' });
  await undo.undo();
  assert.equal(state.documents[0].documentgegevens, null);
  assert.equal(state.documents[0].modified, false, 'terug op het opgeslagen punt');
  await populateDocInfo();
  assert.equal(docInfo.title, 'Uit het bestand');
  assert.equal(docInfo.author, 'Bestandsauteur');

  await undo.redo();
  assert.deepEqual({ ...state.documents[0].documentgegevens }, { title: 'Nieuwe titel' });
  await populateDocInfo();
  assert.equal(docInfo.title, 'Nieuwe titel');
});

test('alleen de bewerkbare velden; zonder geladen document niets', async () => {
  openen({});
  await populateDocInfo();
  assert.equal(zetDocumentgegeven('producer', 'x'), false);
  state.documents[0].pdfDoc = null;
  assert.equal(zetDocumentgegeven('title', 'x'), false);
  assert.equal(state.documents[0].undoStack.length, 0);
});
