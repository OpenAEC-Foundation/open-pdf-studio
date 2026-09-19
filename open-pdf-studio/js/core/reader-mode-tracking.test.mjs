// Reader Mode per document: which file a position belongs to, when it may be
// written, what is written, and how a stored position is resumed on open.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readerTrackingPath,
  setTracking,
  shouldSaveReaderPosition,
  snapshotReaderPosition,
  positionsToSave,
  resumeTracking,
  hasPendingRestore,
  restoredPage,
  restoredScrollTop,
  applyPendingRestore,
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

test('exit without closing the tabs: one write per tracked document, and only those', () => {
  const front = doc({ filePath: 'C:/docs/front.pdf', readerModeActive: true, currentPage: 4 });
  const background = doc({ filePath: 'C:/docs/back.pdf', readerModeActive: true, currentPage: 8, scale: 1.25 });
  const edited = doc({ filePath: 'C:/Temp/opds-edit-2.pdf', saveTargetPath: 'C:/docs/edited.pdf', readerModeActive: true, currentPage: 2 });
  const untracked = doc({ filePath: 'C:/docs/plain.pdf' });
  const neverShown = doc({ filePath: 'C:/docs/unseen.pdf', readerModeActive: true, _readerRestore: { page: 30 } });
  const untitled = doc({ filePath: 'C:/Temp/blank.pdf', isUntitled: true, readerModeActive: true });
  const viewOf = (d) => (d === front ? { zoom: 2, scrollTop: 50, scrollHeight: 500 } : null);

  const writes = positionsToSave([front, background, edited, untracked, neverShown, untitled], viewOf);
  assert.deepEqual(writes, [
    { path: 'C:/docs/front.pdf', position: { page: 4, scale: 2, scrollTop: 50, scrollHeight: 500, viewMode: 'single' } },
    { path: 'C:/docs/back.pdf', position: { page: 8, scale: 1.25, scrollTop: 0, scrollHeight: 0, viewMode: 'single' } },
    { path: 'C:/docs/edited.pdf', position: { page: 2, scale: 1.5, scrollTop: 0, scrollHeight: 0, viewMode: 'single' } },
  ]);
  assert.deepEqual(positionsToSave([], viewOf), []);
  assert.deepEqual(positionsToSave(undefined), []);
});

// ── Resuming on open ────────────────────────────────────────────────────────

const STORED = { page: 9, scale: 2, scrollTop: 300, scrollHeight: 1200, viewMode: 'single' };

/** Stand-in for the view: records what the restore does; `front` says whether the document is in front. */
function view(d, { front = true, scrollHeight = 2400 } = {}) {
  const v = {
    front,
    calls: [],
    isActive: () => v.front,
    goToPage: async (n) => { v.calls.push(['page', n]); d.currentPage = n; },
    setZoom: async (s) => { v.calls.push(['zoom', s]); d.scale = s; },
    scrollHeight: () => scrollHeight,
    setScrollTop: (top) => { v.calls.push(['scroll', top]); },
  };
  return v;
}

test('a file without a stored position stays untracked', () => {
  const d = doc();
  assert.equal(resumeTracking(d, null), false);
  assert.equal(d.readerModeActive, false);
  assert.equal(hasPendingRestore(d), false);
});

test('a file with a stored position resumes tracking, also when it loads in a background tab', () => {
  const d = doc();
  assert.equal(resumeTracking(d, STORED), true);
  assert.equal(d.readerModeActive, true);
  assert.equal(hasPendingRestore(d), true);
  // Never shown yet: closing now must leave the stored page 9 alone.
  assert.equal(shouldSaveReaderPosition(d), false);
});

test('loading the same file again does not undo a fresh opt-in', () => {
  const d = doc();
  setTracking(d, true);
  resumeTracking(d, null); // second load of the open tab, nothing stored yet
  assert.equal(d.readerModeActive, true);
});

test('the document in front jumps to page, zoom and scroll, and is saved from then on', async () => {
  const d = doc({ pdfDoc: { numPages: 12 } });
  resumeTracking(d, STORED);
  const v = view(d);
  assert.equal(await applyPendingRestore(d, v), true);
  assert.deepEqual(v.calls, [['page', 9], ['zoom', 2], ['scroll', 600]]);
  assert.equal(hasPendingRestore(d), false);
  assert.equal(shouldSaveReaderPosition(d), true);
  // Once only.
  assert.equal(await applyPendingRestore(d, v), false);
});

test('a background document is left alone until it comes to the front', async () => {
  const d = doc({ pdfDoc: { numPages: 12 } });
  resumeTracking(d, STORED);
  const v = view(d, { front: false });
  assert.equal(await applyPendingRestore(d, v), false);
  assert.deepEqual(v.calls, []);
  assert.equal(d.currentPage, 1);
  assert.equal(shouldSaveReaderPosition(d), false);
  // First activation.
  v.front = true;
  assert.equal(await applyPendingRestore(d, v), true);
  assert.equal(d.currentPage, 9);
  assert.equal(shouldSaveReaderPosition(d), true);
});

test('a tab switch during the jump never moves the other document', async () => {
  const d = doc({ pdfDoc: { numPages: 12 } });
  resumeTracking(d, STORED);
  const v = view(d);
  v.goToPage = async (n) => { v.calls.push(['page', n]); d.currentPage = n; v.front = false; };
  assert.equal(await applyPendingRestore(d, v), false);
  // No zoom and no scroll on whatever is in front now; the stored position survives a close.
  assert.deepEqual(v.calls, [['page', 9]]);
  assert.equal(hasPendingRestore(d), true);
  assert.equal(shouldSaveReaderPosition(d), false);
  // Back in front: the rest follows, without a second page jump.
  v.front = true;
  v.goToPage = async () => { throw new Error('already on page 9'); };
  assert.equal(await applyPendingRestore(d, v), true);
  assert.deepEqual(v.calls, [['page', 9], ['zoom', 2], ['scroll', 600]]);
});

test('a document that is not loaded yet, or a jump already under way, does nothing', async () => {
  const d = doc();
  resumeTracking(d, STORED);
  assert.equal(await applyPendingRestore(d, view(d)), false); // no pdfDoc
  d.pdfDoc = { numPages: 12 };
  d._readerRestoring = true;
  assert.equal(await applyPendingRestore(d, view(d)), false);
  d._readerRestoring = false;
  assert.equal(await applyPendingRestore(d, view(d)), true);
});

test('switching tracking off during the jump stops it', async () => {
  const d = doc({ pdfDoc: { numPages: 12 } });
  resumeTracking(d, STORED);
  const v = view(d);
  v.setZoom = async (s) => { v.calls.push(['zoom', s]); setTracking(d, false); };
  assert.equal(await applyPendingRestore(d, v), false);
  assert.deepEqual(v.calls, [['page', 9], ['zoom', 2]]);
  assert.equal(d.readerModeActive, false);
});

test('a failing jump keeps the stored position safe and can be retried', async () => {
  const d = doc({ pdfDoc: { numPages: 12 } });
  resumeTracking(d, STORED);
  const v = view(d);
  v.goToPage = async () => { throw new Error('render failed'); };
  await assert.rejects(() => applyPendingRestore(d, v), /render failed/);
  assert.equal(d._readerRestoring, false);
  assert.equal(shouldSaveReaderPosition(d), false);
});

test('the stored page is clamped to the document', () => {
  assert.equal(restoredPage({ page: 9 }, 12), 9);
  assert.equal(restoredPage({ page: 40 }, 12), 12);
  assert.equal(restoredPage({ page: 0 }, 12), null);
  assert.equal(restoredPage({ page: 'x' }, 12), null);
  assert.equal(restoredPage({}, 12), null);
  assert.equal(restoredPage(null, 12), null);
});

test('the scroll ratio is only used within the same view mode', () => {
  const continuous = { scrollTop: 9198, scrollHeight: 15684, viewMode: 'continuous' };
  assert.equal(restoredScrollTop(continuous, 'continuous', 31368), 18396);
  // A whole-document ratio on a one-page container would land half a page off.
  assert.equal(restoredScrollTop(continuous, 'single', 1263), null);
  // Positions written without a view mode still restore.
  assert.equal(restoredScrollTop({ scrollTop: 100, scrollHeight: 1000 }, 'single', 2000), 200);
  // Nothing to go on.
  assert.equal(restoredScrollTop({ scrollTop: 0, scrollHeight: 0, viewMode: 'single' }, 'single', 2000), null);
  assert.equal(restoredScrollTop(STORED, 'single', 0), null);
  assert.equal(restoredScrollTop(null, 'single', 2000), null);
});
