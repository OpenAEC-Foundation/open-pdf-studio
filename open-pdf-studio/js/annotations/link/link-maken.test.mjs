// Een link maken en bewerken (#953) met de echte state-store en undo-manager:
// pas OK zet hem in het document, als één stap; ongedaan maken en opnieuw
// uitvoeren; een bewerking in het paneel of het venster is ook één stap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const { bewaarLinkKeuze, wijzigLink, vraagNieuweLink, bewerkLink } = await import('./link-maken.js');
const { vakUitRegels } = await import('./link-model.js');

function openen(annotations = []) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 3 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const regels = () => vakUitRegels([
  { x: 30, y: 100, width: 200, height: 14, page: 1 },
  { x: 30, y: 120, width: 90, height: 14, page: 1 },
]);

test('the dialog only opens; OK adds the link from the text lines as one undo step', async () => {
  const doc = openen();
  globalThis.__stubCalls = {};
  vraagNieuweLink(1, regels());
  assert.equal(globalThis.__stubCalls.openDialog, 1, 'the link dialog opens');
  assert.equal(doc.annotations.length, 0, 'nothing in the document before OK');

  const ann = bewaarLinkKeuze({ nieuw: { page: 1, vak: regels() } },
    { doel: { kind: 'uri', uri: 'openaec.org' }, rand: 'underline', kleur: '#00aa00', dikte: '2' });
  assert.ok(ann);
  assert.equal(doc.annotations.length, 1);
  const [link] = doc.annotations;
  assert.equal(link.type, 'link');
  assert.deepEqual(link.linkTarget, { kind: 'uri', uri: 'https://openaec.org' });
  assert.equal(link.linkBorder, 'underline');
  assert.equal(link.color, '#00aa00');
  assert.equal(link.lineWidth, 2);
  assert.equal(link.rects.length, 2, 'the selected lines');
  assert.equal(doc.selectedAnnotation?.id, link.id, 'the new link is selected');
  assert.equal(doc.undoStack.length, 1);

  await undo.undo();
  assert.equal(doc.annotations.length, 0);
  await undo.redo();
  assert.equal(doc.annotations.length, 1);
  assert.deepEqual(doc.annotations[0].linkTarget, { kind: 'uri', uri: 'https://openaec.org' });
});

test('an invalid target adds nothing', () => {
  const doc = openen();
  assert.equal(bewaarLinkKeuze({ nieuw: { page: 1, vak: regels() } }, { doel: { kind: 'page', page: 9 } }), null);
  assert.equal(bewaarLinkKeuze({ nieuw: { page: 1, vak: regels() } }, { doel: { kind: 'uri', uri: 'javascript:x' } }), null);
  assert.equal(doc.annotations.length, 0);
  assert.equal(doc.undoStack.length, 0);
});

test('editing in the panel or the dialog is one undo step each', async () => {
  const doc = openen();
  bewaarLinkKeuze({ nieuw: { page: 1, vak: { x: 10, y: 10, width: 40, height: 20 } } },
    { doel: { kind: 'uri', uri: 'https://a.nl' }, rand: 'none' });
  const link = doc.annotations[0];

  assert.equal(wijzigLink(link, { doel: { kind: 'page', page: 2, fit: 'fit' } }), true);
  assert.deepEqual(doc.annotations[0].linkTarget, { kind: 'page', page: 2, fit: 'fit' });
  assert.equal(wijzigLink(link, { rand: 'solid' }), true);
  assert.equal(doc.annotations[0].linkBorder, 'solid');
  assert.equal(wijzigLink(link, { rand: 'solid' }), false, 'no change, no step');
  assert.equal(wijzigLink(link, { doel: { kind: 'page', page: 7 } }), false, 'invalid page');

  await undo.undo();
  assert.equal(doc.annotations[0].linkBorder, 'none');
  await undo.undo();
  assert.deepEqual(doc.annotations[0].linkTarget, { kind: 'uri', uri: 'https://a.nl' });

  // Het venster op een bestaande link: één wijzigingsstap.
  globalThis.__stubCalls = {};
  bewerkLink(doc.annotations[0]);
  assert.equal(globalThis.__stubCalls.openDialog, 1);
  const voor = doc.undoStack.length;
  bewaarLinkKeuze({ annotationId: doc.annotations[0].id },
    { doel: { kind: 'file', file: 'tekening.pdf' }, rand: 'solid', kleur: '#ff0000', dikte: 1 });
  assert.equal(doc.undoStack.length, voor + 1);
  assert.deepEqual(doc.annotations[0].linkTarget, { kind: 'file', file: 'tekening.pdf' });
  await undo.undo();
  assert.deepEqual(doc.annotations[0].linkTarget, { kind: 'uri', uri: 'https://a.nl' });
});

test('a locked link is not edited', () => {
  const doc = openen();
  bewaarLinkKeuze({ nieuw: { page: 1, vak: { x: 10, y: 10, width: 40, height: 20 } } },
    { doel: { kind: 'uri', uri: 'https://a.nl' } });
  doc.annotations[0].locked = true;
  assert.equal(wijzigLink(doc.annotations[0], { rand: 'solid' }), false);
  assert.equal(bewaarLinkKeuze({ annotationId: doc.annotations[0].id }, { doel: { kind: 'uri', uri: 'b.nl' } }), null);
  globalThis.__stubCalls = {};
  bewerkLink(doc.annotations[0]);
  assert.equal(globalThis.__stubCalls.openDialog, undefined);
});
