// Reader Mode per document: which file a position belongs to, when it may be
// written, and what is written.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readerTrackingPath,
  setTracking,
  shouldSaveReaderPosition,
  snapshotReaderPosition,
} from './reader-mode-tracking.js';

const doc = (extra = {}) => ({ filePath: 'C:/docs/book.pdf', currentPage: 1, scale: 1.5, viewMode: 'single', readerModeActive: false, ...extra });

test('a saved document is tracked under its own path', () => {
  assert.equal(readerTrackingPath(doc()), 'C:/docs/book.pdf');
});

test('after an edit reload the position belongs to the real file, not the working copy', () => {
  const d = doc({ filePath: 'C:/Temp/opds-edit-1.pdf', _renderTemp: true, saveTargetPath: 'C:/docs/book.pdf' });
  assert.equal(readerTrackingPath(d), 'C:/docs/book.pdf');
});

test('untitled, in-memory and missing documents cannot be tracked', () => {
  assert.equal(readerTrackingPath(doc({ isUntitled: true })), null);
  assert.equal(readerTrackingPath(doc({ isUntitled: true, saveTargetPath: null, filePath: 'C:/Temp/blank-1.pdf' })), null);
  assert.equal(readerTrackingPath(doc({ filePath: '__memory__abc' })), null);
  assert.equal(readerTrackingPath(doc({ filePath: null })), null);
  assert.equal(readerTrackingPath(null), null);
  assert.equal(readerTrackingPath(undefined), null);
});

test('a new document starts untracked and is not saved at close', () => {
  assert.equal(shouldSaveReaderPosition(doc()), false);
  assert.equal(shouldSaveReaderPosition(null), false);
});

test('tracking on: the position is saved at close', () => {
  const d = doc();
  setTracking(d, true);
  assert.equal(d.readerModeActive, true);
  assert.equal(shouldSaveReaderPosition(d), true);
});

test('tracking on for a document that cannot be tracked saves nothing', () => {
  const d = doc({ isUntitled: true });
  setTracking(d, true);
  assert.equal(shouldSaveReaderPosition(d), false);
});

test('a stored position that was never shown is not overwritten at close', () => {
  const d = doc({ readerModeActive: true, _readerRestore: { page: 40, scale: 2 } });
  assert.equal(shouldSaveReaderPosition(d), false);
  d._readerRestore = null;
  assert.equal(shouldSaveReaderPosition(d), true);
});

test('switching tracking off also drops a position that was still waiting', () => {
  const d = doc({ readerModeActive: true, _readerRestore: { page: 40 } });
  setTracking(d, false);
  assert.equal(d.readerModeActive, false);
  assert.equal(d._readerRestore, null);
  assert.equal(shouldSaveReaderPosition(d), false);
});

test('snapshot of the visible tab uses the viewport zoom and the container scroll', () => {
  const d = doc({ currentPage: 7, scale: 1.5, viewMode: 'continuous' });
  assert.deepEqual(
    snapshotReaderPosition(d, { zoom: 2.25, scrollTop: 900, scrollHeight: 12000 }),
    { page: 7, scale: 2.25, scrollTop: 900, scrollHeight: 12000, viewMode: 'continuous' },
  );
});

test('snapshot of a background tab falls back to the document scale and no scroll', () => {
  const d = doc({ currentPage: 3, scale: 1.25 });
  assert.deepEqual(
    snapshotReaderPosition(d, null),
    { page: 3, scale: 1.25, scrollTop: 0, scrollHeight: 0, viewMode: 'single' },
  );
  assert.deepEqual(
    snapshotReaderPosition(d, { zoom: 0, scrollTop: undefined, scrollHeight: NaN }),
    { page: 3, scale: 1.25, scrollTop: 0, scrollHeight: 0, viewMode: 'single' },
  );
});
