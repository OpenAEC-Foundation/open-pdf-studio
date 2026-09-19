// A queued file load resolves its tab when it runs, not when it was queued,
// and never reloads a document that is already loaded.

import assert from 'node:assert/strict';
import test from 'node:test';

import { queuedLoadTarget } from './queued-load.js';

const placeholder = (filePath) => ({ filePath, pdfDoc: null, _isLoading: false });

test('a fresh placeholder tab loads into its own index', () => {
  const docs = [placeholder('C:/s/R1.pdf'), placeholder('C:/s/R2.pdf')];
  assert.equal(queuedLoadTarget(docs, docs[0]), 0);
  assert.equal(queuedLoadTarget(docs, docs[1]), 1);
});

test('a document that is already loaded is not loaded again', () => {
  const docs = [placeholder('C:/s/R1.pdf'), { ...placeholder('C:/s/R2.pdf'), pdfDoc: { numPages: 12 } }];
  assert.equal(queuedLoadTarget(docs, docs[1]), -1);
});

test('a document that is loading through another route is left alone', () => {
  const docs = [{ ...placeholder('C:/s/R1.pdf'), _isLoading: true }];
  assert.equal(queuedLoadTarget(docs, docs[0]), -1);
});

test('a failed earlier load (no pdfDoc, not loading) is retried', () => {
  const docs = [{ ...placeholder('C:/s/R1.pdf'), pdfDoc: null, _isLoading: false }];
  assert.equal(queuedLoadTarget(docs, docs[0]), 0);
});

test('a tab closed while waiting in the queue is skipped', () => {
  const docs = [placeholder('C:/s/R1.pdf'), placeholder('C:/s/R2.pdf')];
  const closed = docs[0];
  docs.splice(0, 1);
  assert.equal(queuedLoadTarget(docs, closed), -1);
});

test('closing an earlier tab shifts the index of the queued ones', () => {
  const docs = [placeholder('C:/u/U.pdf'), placeholder('C:/s/R1.pdf'), placeholder('C:/s/R2.pdf')];
  const [, r1, r2] = docs;
  docs.splice(0, 1);
  assert.equal(queuedLoadTarget(docs, r1), 0);
  assert.equal(queuedLoadTarget(docs, r2), 1);
});

test('dragging a tab to another position is followed', () => {
  const docs = [placeholder('C:/s/R1.pdf'), placeholder('C:/s/R2.pdf'), placeholder('C:/s/R3.pdf')];
  const r3 = docs[2];
  const [moved] = docs.splice(2, 1);
  docs.splice(0, 0, moved);
  assert.equal(queuedLoadTarget(docs, r3), 0);
});

test('missing arguments never produce an index', () => {
  assert.equal(queuedLoadTarget(null, placeholder('C:/s/R1.pdf')), -1);
  assert.equal(queuedLoadTarget([], null), -1);
  assert.equal(queuedLoadTarget([], undefined), -1);
});

// The scenario end to end, with the queue shape openFiles() uses: tabs are
// created first, loads run one by one, the user acts in between.
test('queue run: every file ends up in its own tab, loaded exactly once', async () => {
  const docs = [];
  const loads = [];
  const open = (filePath) => {
    let doc = docs.find((d) => d.filePath === filePath);
    if (!doc) { doc = placeholder(filePath); docs.push(doc); }
    return doc;
  };
  const load = async (filePath, index) => {
    const doc = docs[index];
    doc._isLoading = true;
    await new Promise((r) => setTimeout(r, 0));
    doc.pdfDoc = { src: filePath };
    doc._isLoading = false;
    loads.push(filePath);
  };

  // The user opened R2 and U before the session restore got to its tabs.
  const r2 = open('C:/s/R2.pdf');
  await load('C:/s/R2.pdf', docs.indexOf(r2));
  r2.currentPage = 7;
  const u = open('C:/u/U.pdf');
  await load('C:/u/U.pdf', docs.indexOf(u));

  // Session restore queues R1, R2 (already open) and R3.
  const queued = ['C:/s/R1.pdf', 'C:/s/R2.pdf', 'C:/s/R3.pdf'].map((filePath) => ({ filePath, doc: open(filePath) }));
  let queue = Promise.resolve();
  for (const { filePath, doc } of queued) {
    queue = queue.then(async () => {
      const index = queuedLoadTarget(docs, doc);
      if (index === -1) return;
      await load(filePath, index);
    });
  }
  // While R1 loads the user closes U (index 1): R1 and R3 shift down.
  docs.splice(docs.indexOf(u), 1);
  await queue;

  assert.deepEqual(docs.map((d) => `${d.filePath}=${d.pdfDoc?.src}`), [
    'C:/s/R2.pdf=C:/s/R2.pdf',
    'C:/s/R1.pdf=C:/s/R1.pdf',
    'C:/s/R3.pdf=C:/s/R3.pdf',
  ]);
  assert.equal(loads.filter((f) => f === 'C:/s/R2.pdf').length, 1);
  assert.equal(r2.currentPage, 7);
});
