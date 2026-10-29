// Structure edits made during a save (#384): the saver clears only the edits
// it wrote. An alt text or reading order changed while a long save runs is
// kept, rebased on the saved structure, so the next save writes it to the
// right element instead of losing it.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { readStructTree, walkElements } from './struct-tree.js';
import { withAlt, withOrder, editsOf, applyEditsToPdf, editsAfterSave } from './struct-edits.js';
import { taggedPdf } from './tagged-pdf.testhulp.mjs';

async function writeEdits(bytes, edits) {
  const doc = await PDFDocument.load(bytes);
  const r = applyEditsToPdf(doc, edits);
  return { bytes: await doc.save({ useObjectStreams: false }), ...r };
}

async function signature(bytes) {
  const { root } = readStructTree(await PDFDocument.load(bytes));
  return [...walkElements(root)].map((e) => `${e.key} ${e.role} ${e.alt ?? '-'}`);
}

test('the edits the save wrote are cleared; nothing written keeps the edits as they are', () => {
  const edits = withAlt(editsOf({}), '0.2', 'Figure', 'x');
  assert.equal(editsAfterSave(edits, edits), null, 'the same object: all written');
  assert.equal(editsAfterSave(null, edits), null);
  assert.equal(editsAfterSave(editsOf({}), null), null, 'empty edits are not kept');
  assert.equal(editsAfterSave(edits, null), edits, 'edits made after the write point stay unchanged');
  const copy = withAlt(edits, '0.2', 'Figure', 'x');
  assert.equal(editsAfterSave(copy, edits), null, 'an identical copy has nothing new');
});

test('an alt text changed during the save survives and lands on the right element', async () => {
  const source = await taggedPdf();
  // The save writes: figure alt text, figure moved to the top of Document.
  let written = withAlt(editsOf({}), '0.2', 'Figure', 'first');
  written = withOrder(written, '0', 'Document', [2, 0, 1, 3]);
  // While it runs the user changes the figure's alt text again, gives the P
  // inside Sect an alt text and moves Para to the top. The panel builds a
  // new object per edit, from the edits it already had.
  let during = withAlt(written, '0.2', 'Figure', 'second');
  during = withAlt(during, '0.1.0', 'P', 'paragraph');
  during = withOrder(during, '0', 'Document', [3, 2, 0, 1]);

  const saved = await writeEdits(source, written);
  assert.equal(saved.skipped, 0);
  const rest = editsAfterSave(during, written);
  assert.ok(rest, 'the edits made during the save are kept');
  // Keys and orders follow the saved file, where the figure is now 0.0 and
  // Sect is 0.2.
  assert.deepEqual(rest.alt, {
    '0.0': { role: 'Figure', value: 'second' },
    '0.2.0': { role: 'P', value: 'paragraph' },
  });
  assert.deepEqual(rest.order, { 0: { role: 'Document', order: [3, 0, 1, 2] } });

  // The next save on the saved file gives the same result as writing all of
  // it at once on the original.
  const next = await writeEdits(saved.bytes, rest);
  assert.equal(next.skipped, 0);
  const allAtOnce = await writeEdits(source, during);
  assert.deepEqual(await signature(next.bytes), await signature(allAtOnce.bytes));
  assert.deepEqual(await signature(next.bytes), [
    '0 Document -', '0.0 Para -', '0.1 Figure second', '0.2 Heading -', '0.3 Sect -', '0.3.0 P paragraph', '0.3.0.0 Span -',
  ]);
});

test('an unchanged order is not written twice', () => {
  const written = withOrder(editsOf({}), '0', 'Document', [2, 0, 1, 3]);
  const during = withAlt(written, '0.3', 'Para', 'p2');
  const rest = editsAfterSave(during, written);
  assert.deepEqual(rest, { alt: { '0.3': { role: 'Para', value: 'p2' } }, order: {} },
    'Para kept its place (index 3 stays 3); the written reorder is not applied again');
});
