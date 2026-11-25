// #1262: de echte properties-store, selectie en undo voor mengmodi.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.ts');
const p = await import('./propertiesStore.js');
const undo = await import('../../core/undo-manager.js');
const { BLEND_MODES } = await import('../../annotations/blend-modes.js');

function selecteer(...annotations) {
  undo.flushPropertyChange();
  state.documents = [{ id: 'doc', filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: annotations[0], selectedAnnotations: annotations,
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null }];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];
  if (annotations.length > 1) p.storeShowMultiSelection(doc.annotations);
  else p.storeShowProperties(doc.annotations[0]);
  return doc;
}
const vak = (id, extra = {}) => ({ id, type: 'box', page: 1, x: 10, y: 10,
  width: 100, height: 50, color: '#ff0000', lineWidth: 1, opacity: 1, ...extra });

test('selectie toont de opgeslagen modus en de werkelijke standaard van tekstmarkeringen', () => {
  for (const mode of BLEND_MODES) {
    selecteer(vak('a', { blendMode: mode }));
    assert.equal(p.annotProps.blendMode, mode);
    assert.equal(p.sectionVis.blendModeGroup, true);
  }
  selecteer(vak('a'));
  assert.equal(p.annotProps.blendMode, 'normal');
  selecteer(vak('a', { type: 'textHighlight', rects: [] }));
  assert.equal(p.annotProps.blendMode, 'multiply');
});

test('alle zestien keuzes wijzigen een tekstvak en kunnen ongedaan en opnieuw', async () => {
  for (const mode of BLEND_MODES) {
    const doc = selecteer(vak('a', { type: 'textbox', text: 'tekst', blendMode: 'screen' }));
    p.updateAnnotProp('blendMode', mode);
    undo.flushPropertyChange();
    assert.equal(doc.annotations[0].blendMode, mode);
    assert.equal(p.annotProps.blendMode, mode);
    assert.equal(doc.undoStack.length, 1);
    await undo.undo();
    assert.equal(doc.annotations[0].blendMode, 'screen');
    await undo.redo();
    assert.equal(doc.annotations[0].blendMode, mode);
  }
});

test('gemengde selectie wordt één bulkactie; opnieuw selecteren leest de waarde', async () => {
  const doc = selecteer(vak('a'), vak('b', { blendMode: 'screen' }));
  assert.equal(p.annotProps.blendMode, 'mixed');
  p.updateAnnotProp('blendMode', 'overlay');
  assert.deepEqual(doc.annotations.map(a => a.blendMode), ['overlay', 'overlay']);
  assert.equal(doc.undoStack.length, 1);
  p.storeShowMultiSelection(doc.annotations);
  assert.equal(p.annotProps.blendMode, 'overlay');
  await undo.undo();
  assert.deepEqual(doc.annotations.map(a => a.blendMode), [undefined, 'screen']);
  p.storeShowMultiSelection(doc.annotations);
  assert.equal(p.annotProps.blendMode, 'mixed');
  selecteer(vak('a'), vak('b', { blendMode: 'normal' }));
  assert.equal(p.annotProps.blendMode, 'normal');
});

test('vergrendeling blokkeert zowel enkele als gemengde selectie', () => {
  for (const annotations of [[vak('a', { locked: true })], [vak('a'), vak('b', { locked: true })]]) {
    const doc = selecteer(...annotations);
    p.updateAnnotProp('blendMode', 'multiply');
    undo.flushPropertyChange();
    assert.ok(doc.annotations.every(a => a.blendMode === undefined));
    assert.equal(doc.undoStack.length, 0);
  }
});

test('geen bediening voor links, schaalbalken of niet-opgeslagen gereedschapsstandaarden', () => {
  for (const a of [vak('a', { type: 'link' }), vak('a', { type: 'scaleBar' }), vak('__tool-defaults__')]) {
    selecteer(a);
    assert.equal(p.sectionVis.blendModeGroup, false);
  }
  selecteer(vak('a'), vak('b', { type: 'link' }));
  assert.equal(p.sectionVis.blendModeGroup, false);
});
