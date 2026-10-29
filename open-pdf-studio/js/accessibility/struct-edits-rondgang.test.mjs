// Alt text and reading order (#384) survive a save with the real saver and a
// reread of the saved bytes, and read aloud follows the new order.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { opslaan, state } from '../pdf/rondgang.testhulp.mjs';
import { readStructTree, findByKey, walkElements } from './struct-tree.js';
import {
  withAlt, withOrder, movedOrder, applyEditsToTree, applyEditsToPdf, isPermutation, editsOf, hasEdits,
} from './struct-edits.js';
import { structureSegments, segmentText, mcidTextMap } from './reading-order.js';
import { onStructEditsSaved } from './struct-tree-events.js';
import { taggedPdf, pdfjsPages } from './tagged-pdf.testhulp.mjs';

async function model(bytes) {
  return readStructTree(await PDFDocument.load(bytes));
}

async function readingTexts(bytes) {
  const m = await model(bytes);
  const maps = (await pdfjsPages(bytes)).map((items) => mcidTextMap(items).byMcid);
  // A segment without text (a figure without alt text) is skipped by the player.
  return structureSegments(m.root).map((s) => segmentText(s, (p) => maps[p])).filter(Boolean);
}

test('edits are immutable and validated', () => {
  const e0 = editsOf({});
  const e1 = withAlt(e0, '0.2', 'Figure', 'x');
  assert.equal(hasEdits(e0), false);
  assert.equal(hasEdits(e1), true);
  assert.deepEqual(e0.alt, {}, 'the original is not changed');
  assert.equal(isPermutation([1, 0, 2], 3), true);
  assert.equal(isPermutation([1, 1, 2], 3), false);
  assert.equal(isPermutation([0, 1], 3), false);
  const node = { kidCount: 3, children: [{ index: 0 }, { index: 2 }] };
  assert.deepEqual(movedOrder(node, 1, -1), [2, 0, 1], 'a skipped /K entry keeps a place at the end');
  assert.equal(movedOrder(node, 0, -1), null);
});

test('alt text and reading order round-trip through the real saver', async () => {
  const source = await taggedPdf();
  const before = await model(source);
  assert.equal(findByKey(before.root, '0.2').alt, null);
  const docEl = findByKey(before.root, '0');

  // Move the figure (position 2) to the top of Document.
  let order = movedOrder(docEl, 2, -2);
  assert.deepEqual(order, [2, 0, 1, 3]);
  let edits = withAlt(editsOf({}), '0.2', 'Figure', 'Blue square, 100 × 100 pt');
  edits = withOrder(edits, '0', 'Document', order);

  // What the panel and read aloud see before saving.
  const shown = applyEditsToTree(before.root, edits);
  assert.deepEqual(shown.children[0].children.map((c) => c.role), ['Figure', 'Heading', 'Sect', 'Para']);
  assert.equal(findByKey(shown, '0.2').alt, 'Blue square, 100 × 100 pt');

  let notified = null;
  const off = onStructEditsSaved((doc) => { notified = doc; });
  const saved = await opslaan(source, [], { document: { structEdits: edits } });
  off();
  assert.equal(state.documents[0].structEdits, null, 'the edits are cleared after a successful save');
  assert.equal(notified, state.documents[0], 'the tags panel is told to reread the tree');

  const after = await model(saved);
  // The figure is now the first kid of Document, so its key is 0.0.
  assert.deepEqual([...walkElements(after.root)].map((e) => e.role),
    ['Document', 'Figure', 'Heading', 'Sect', 'P', 'Span', 'Para']);
  const fig = findByKey(after.root, '0.0');
  assert.equal(fig.role, 'Figure');
  assert.equal(fig.alt, 'Blue square, 100 × 100 pt', 'non-ASCII alt text survives');

  // Read aloud follows the saved structure order.
  assert.deepEqual(await readingTexts(saved),
    ['Blue square, 100 × 100 pt', 'First heading', 'Second paragraph', 'Third paragraph']);

  // A second round on the saved file: clear the alt text, reorder again.
  const docEl2 = findByKey(after.root, '0');
  order = movedOrder(docEl2, 3, -3);
  let edits2 = withAlt(editsOf({}), '0.0', 'Figure', '   ');
  edits2 = withOrder(edits2, '0', 'Document', order);
  const saved2 = await opslaan(saved, [], { document: { structEdits: edits2 } });
  const after2 = await model(saved2);
  assert.deepEqual(findByKey(after2.root, '0').children.map((c) => c.role), ['Para', 'Figure', 'Heading', 'Sect']);
  assert.equal(findByKey(after2.root, '0.1').alt, null, 'empty alt text removes /Alt');
  assert.deepEqual(await readingTexts(saved2), ['Third paragraph', 'First heading', 'Second paragraph']);
});

test('an edit whose element is gone or has another role is skipped, not misapplied', async () => {
  const doc = await PDFDocument.load(await taggedPdf());
  let edits = withAlt(editsOf({}), '0.1', 'Figure', 'wrong element');
  edits = withAlt(edits, '0.9', 'Figure', 'missing');
  edits = withOrder(edits, '0', 'Document', [0, 1]);
  const r = applyEditsToPdf(doc, edits);
  assert.deepEqual(r, { applied: 0, skipped: 3 });
  const m = readStructTree(doc);
  assert.equal(findByKey(m.root, '0.1').alt, null);
  assert.deepEqual(findByKey(m.root, '0').children.map((c) => c.role), ['Heading', 'Sect', 'Figure', 'Para']);
});

test('a save without structure edits leaves the tree as it was', async () => {
  const source = await taggedPdf({ figureAlt: 'kept' });
  const saved = await opslaan(source, [], {});
  const m = await model(saved);
  assert.equal(findByKey(m.root, '0.2').alt, 'kept');
  assert.deepEqual(await readingTexts(saved), ['First heading', 'Second paragraph', 'kept', 'Third paragraph']);
});
