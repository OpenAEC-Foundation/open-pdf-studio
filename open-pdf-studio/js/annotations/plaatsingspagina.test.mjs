// Plaatsen na een klik en een venster (#1006): de handtekening, de stempels
// uit de stempelkeuze en de afbeelding komen op de aangeklikte pagina, ook in
// de weergave met twee pagina's naast elkaar (daar is de huidige pagina de
// linker). Zonder klik blijft de huidige pagina gelden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { plaatsingsPagina } from './plaatsingspagina.js';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { signatureTool, stampTool, textTool } = await import('../tools/tools/text-tool.js');
const { placeDynamicStamp } = await import('./dynamic-stamp-place.js');

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

// Twee pagina's naast elkaar: pagina 2 links (de huidige), pagina 3 rechts.
function openen() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 4 },
    currentPage: 2, scale: 1, viewMode: 'continuous', facingSpread: true, annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('the clicked page wins over the current page', () => {
  const doc = { currentPage: 2, pdfDoc: { numPages: 4 } };
  assert.equal(plaatsingsPagina(3, doc), 3);
  assert.equal(plaatsingsPagina('4', doc), 4);
  assert.equal(plaatsingsPagina(1, doc), 1);
});

test('without a (valid) clicked page the current page is used', () => {
  const doc = { currentPage: 2, pdfDoc: { numPages: 4 } };
  for (const p of [undefined, null, 0, -1, 2.5, 5, NaN, 'x']) {
    assert.equal(plaatsingsPagina(p, doc), 2, String(p));
  }
  assert.equal(plaatsingsPagina(undefined, null), 1);
  assert.equal(plaatsingsPagina(undefined, { currentPage: 0 }), 1);
  assert.equal(plaatsingsPagina(7, { currentPage: 1 }), 7, 'no page count known: the click counts');
});

test('the Signature tool hands the clicked page to the dialog', () => {
  const aanroepen = [];
  signatureTool.onPointerDown({ x: 10, y: 20, pageNum: 3, showSignatureDialog: (...a) => aanroepen.push(a) });
  assert.deepEqual(aanroepen, [[10, 20, 3]]);
});

test('the Stamp tool hands the clicked page to the picker and to a preset stamp', () => {
  const kiezer = [];
  const vast = [];
  const ctx = {
    x: 5, y: 6, pageNum: 3, state: { toolOverrides: null },
    showStampPicker: (...a) => kiezer.push(a), placeOverrideStamp: (...a) => vast.push(a),
  };
  stampTool.onPointerDown(ctx, { button: 0 });
  assert.deepEqual(kiezer, [[5, 6, 3]]);
  stampTool.onPointerDown({ ...ctx, state: { toolOverrides: { stampImage: 'data:x' } } }, { button: 0 });
  assert.deepEqual(vast, [[5, 6, 3]]);
});

test('the Add Text tool passes the clicked page in every view', () => {
  const aanroepen = [];
  textTool.onPointerDown({ x: 1, y: 2, pageNum: 3, viewMode: 'single', state, addTextAnnotation: (...a) => aanroepen.push(a) });
  assert.deepEqual(aanroepen, [[1, 2, 3]]);
});

test('a template stamp lands on the clicked (right-hand) page, not on the current one', async () => {
  const doc = openen();
  const template = { id: 't', name: 'Checked', lines: [{ text: 'CHECKED' }] };
  await placeDynamicStamp(template, 100, 100, 3);
  assert.equal(doc.annotations.length, 1);
  assert.equal(doc.annotations[0].page, 3);
  await placeDynamicStamp(template, 100, 100);
  assert.equal(doc.annotations[1].page, 2, 'without a click: the current page');
});

test('the dialogs place on the page that came with them (source wiring)', () => {
  const dialoog = bron('../solid/components/dialogs/SignatureDialog.jsx');
  assert.match(dialoog, /page: plaatsingsPagina\(page, getActiveDocument\(\)\)/);
  assert.match(dialoog, /const placePage = props\.data\?\.page;/);
  // Tekenen, opslaan en plaatsen, en een opgeslagen handtekening: alle drie.
  assert.equal(dialoog.match(/placeSignatureFromDataUrl\(.*, placePage\);/g)?.length, 3);
  assert.doesNotMatch(dialoog, /currentPage/);

  assert.match(bron('./signature.js'), /openDialog\('signature', \{ x, y, page \}\)/);

  const stempels = bron('./stamps.js');
  assert.doesNotMatch(stempels, /currentPage/, 'every stamp path uses the clicked page');
  assert.match(stempels, /onSelect: \(stamp\) => placeStamp\(stamp, x, y, page\)/);
  assert.match(stempels, /onCustom: \(\) => loadCustomStamp\(x, y, page\)/);
  assert.match(stempels, /placeDynamicStamp\(template, x, y, page\)/);

  const afbeelding = bron('./image-drop.js');
  assert.match(afbeelding, /await addImageFromFile\(pad, \{ page \}\)/);
});
