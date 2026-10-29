// Tool Sets store (#311): persistence across sessions, "Save to Tool
// Set" from a placed measurement, the add-annotation hook that applies the
// active item, and the import flow with its name-conflict question.
//
// The real state, undo manager, storage module and stores run under node
// (../../core/app-test-hooks.mjs); the browser storage is the in-memory stub,
// the desktop file storage is not available (no Tauri) so the store uses it.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const { recordAdd } = await import('../../core/undo-manager.js');
const { leesOpslag, schrijfOpslag } = await import('../../core/opslag.js');
const { getDialogs, closeDialog } = await import('./dialogStore.js');
const { activeTab } = await import('./leftPanelStore.js');
const { armToolSetItem, endToolSetSession } = await import('../../tools/tool-set-session.js');
const { serializeToolSet, findItem } = await import('../../annotations/tool-sets.js');

// Stored by an earlier session of the app, before the store is loaded.
schrijfOpslag('toolSets', JSON.stringify({
  version: 1,
  sets: [{ id: 's-old', name: 'From last time', items: [
    { id: 'i-old', name: 'Old wall', type: 'measureDistance', props: { strokeColor: '#00ff00', measureDepth: 3000 } },
  ] }],
}));

const store = await import('./toolSetsStore.js');

function openDocument() {
  state.documents = [{
    id: 'doc-1', filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    annotationLayers: [{ id: 'default', name: '' }, { id: 'l1', name: 'Walls', color: '#aa0000' }],
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const stored = () => JSON.parse(leesOpslag('toolSets'));

// Writes are chained; wait until the last one landed (no fixed timeout).
async function settled(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail('storage did not settle');
}

test('the catalog of the previous session is loaded', async () => {
  await store.ensureToolSetsLoaded();
  assert.equal(store.loaded(), true);
  assert.deepEqual(store.catalog().sets.map((s) => s.name), ['From last time']);
  assert.equal(findItem(store.catalog(), 'i-old').item.props.measureDepth, 3000);
});

test('Save to Tool Set stores the measurement without its geometry, and persists it', async () => {
  const doc = openDocument();
  store.selectSet('s-old');
  const ann = {
    id: 'a1', type: 'measureArea', page: 1, layer: 'l1', measureName: 'Screed',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    measureValue: 12.5, measureText: '12.5 m²', measureUnit: 'm²', measureDepth: 70, fillColor: '#eeeeee',
  };
  doc.annotations.push(ann);
  const id = await store.saveAnnotationToToolSet(ann);
  assert.ok(id);
  assert.equal(activeTab(), 'tool-sets', 'the panel opens on the new item');
  assert.equal(store.selectedItemId(), id);
  const { set, item } = findItem(store.catalog(), id);
  assert.equal(set.id, 's-old');
  assert.equal(item.name, 'Screed');
  assert.deepEqual(item.layer, { name: 'Walls', color: '#aa0000' });
  assert.equal(item.props.measureDepth, 70);
  assert.ok(!('points' in item.props) && !('measureValue' in item.props) && !('measureText' in item.props));
  await settled(() => stored().sets[0].items.some((i) => i.id === id));
  assert.deepEqual(stored().sets[0].items.find((i) => i.id === id), item);
  assert.equal(store.canSaveToToolSet({ type: 'textbox' }), false);
  assert.equal(await store.saveAnnotationToToolSet({ type: 'textbox' }), null);
});

test('without a tool set, saving creates one', async () => {
  openDocument();
  const before = store.catalog().sets.length;
  store.selectSet(null);
  // the first set is the target when none is selected
  assert.equal(store.targetSet().id, 's-old');
  const created = await store.createToolSet();
  assert.equal(store.catalog().sets.length, before + 1);
  assert.equal(store.selectedSetId(), created);
  assert.equal(store.renameToolSet(created, 'From last time'), 'name-taken');
  assert.equal(store.renameToolSet(created, 'Floors'), null);
  await settled(() => stored().sets.some((s) => s.name === 'Floors'));
});

test('items can be renamed, moved and deleted; the stored catalog follows', async () => {
  const id = findItem(store.catalog(), 'i-old').item.id;
  const floors = store.catalog().sets.find((s) => s.name === 'Floors').id;
  assert.equal(store.renameToolSetItem(id, ''), 'name-empty');
  assert.equal(store.renameToolSetItem(id, 'Wall 300'), null);
  store.moveToolSetItem(id, floors);
  assert.equal(findItem(store.catalog(), id).set.id, floors);
  await settled(() => stored().sets.find((s) => s.name === 'Floors')?.items.some((i) => i.name === 'Wall 300'));
  store.deleteToolSetItem(id);
  assert.equal(findItem(store.catalog(), id), null);
  await settled(() => !stored().sets.some((s) => s.items.some((i) => i.id === id)));
});

test('every added annotation passes the hook: the active item applies to the next measurement', () => {
  const doc = openDocument();
  const item = {
    id: 'i-x', name: 'Wall', type: 'measureDistance', layer: { name: 'Walls', color: '#aa0000' },
    props: { subject: 'Wall 100', measureDepth: 2600, strokeColor: '#1565C0' },
  };
  state.currentTool = 'measureDistance';
  armToolSetItem(item, state.preferences);
  assert.equal(store.activeItemId(), 'i-x');
  const ann = { id: 'n1', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 50, endY: 0, measureValue: 500, measurePixels: 50, measureUnit: 'mm' };
  doc.annotations.push(ann);
  recordAdd(ann);
  assert.equal(ann.subject, 'Wall 100');
  assert.equal(ann.measureDepth, 2600);
  assert.equal(ann.layer, 'l1');
  assert.equal(ann.endX, 50);
  // the undo record holds the finished annotation
  const last = doc.undoStack[doc.undoStack.length - 1];
  assert.equal(last.annotation.subject, 'Wall 100');
  endToolSetSession();
  assert.equal(store.activeItemId(), null);
  const plain = { id: 'n2', type: 'measureDistance', page: 1 };
  recordAdd(plain);
  assert.ok(!('subject' in plain));
  state.currentTool = 'select';
});

// Review fix: the hook is for annotations DRAWN with the item. A paste or
// duplicate while the item's tool is active is an exact copy of another
// annotation and keeps its own properties.
test('pasting while an item is the active tool keeps the pasted annotation as it was', async () => {
  const doc = openDocument();
  const { pasteAnnotation } = await import('../../annotations/clipboard.js');
  const item = {
    id: 'i-p', name: 'Wall', type: 'measureDistance', layer: { name: 'Walls', color: '#aa0000' },
    props: { subject: 'Wall 100', measureDepth: 2600, strokeColor: '#1565C0' },
  };
  state.currentTool = 'measureDistance';
  armToolSetItem(item, state.preferences);
  try {
    state.clipboardAnnotation = {
      id: 'c1', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 40, endY: 0,
      subject: 'Copied', strokeColor: '#000000', measureValue: 400, measureUnit: 'mm',
    };
    pasteAnnotation();
    const pasted = doc.annotations[doc.annotations.length - 1];
    assert.ok(pasted && pasted.id !== 'c1', 'a copy was pasted');
    assert.equal(pasted.subject, 'Copied');
    assert.equal(pasted.strokeColor, '#000000');
    assert.ok(!('measureDepth' in pasted));
    assert.ok(!('layer' in pasted));

    // Drawing with the item still applies it.
    const drawn = { id: 'd1', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 50, endY: 0 };
    doc.annotations.push(drawn);
    recordAdd(drawn);
    assert.equal(drawn.subject, 'Wall 100');
    // An explicit copy (also automation) is left alone.
    const copy = { id: 'd2', type: 'measureDistance', page: 1, subject: 'Mine' };
    recordAdd(copy, { copy: true });
    assert.equal(copy.subject, 'Mine');
  } finally {
    endToolSetSession();
    state.clipboardAnnotation = null;
    state.currentTool = 'select';
  }
});

test('importing: a malformed file is refused, a name clash asks first', async () => {
  openDocument();
  assert.equal(await store.importToolSetText('{"format":"nope"}'), null);
  const msg = getDialogs().find((d) => d.name === 'message');
  assert.ok(msg, 'the user is told');
  closeDialog('message');

  const text = serializeToolSet({
    name: 'Floors',
    items: [{ id: 'q', name: 'Tiles', type: 'measureArea', props: { hatchPattern: 'grid', measureDepth: 10 } }],
  });
  const pending = store.importToolSetText(text);
  let dialog = null;
  await settled(() => (dialog = getDialogs().find((d) => d.name === 'tool-sets-import')));
  assert.equal(dialog.data.name, 'Floors');
  assert.equal(dialog.data.suggestedName, 'Floors (2)');
  closeDialog('tool-sets-import');
  dialog.data.resolve({ mode: 'keepBoth' });
  const setId = await pending;
  const set = store.catalog().sets.find((s) => s.id === setId);
  assert.equal(set.name, 'Floors (2)');
  assert.equal(set.items[0].name, 'Tiles');
  assert.equal(set.items[0].props.measureDepth, 10);
  await settled(() => stored().sets.some((s) => s.name === 'Floors (2)'));

  // cancel leaves everything as it was
  const count = store.catalog().sets.length;
  const cancelled = store.importToolSetText(text);
  await settled(() => (dialog = getDialogs().find((d) => d.name === 'tool-sets-import')));
  closeDialog('tool-sets-import');
  dialog.data.resolve(null);
  assert.equal(await cancelled, null);
  assert.equal(store.catalog().sets.length, count);
});
