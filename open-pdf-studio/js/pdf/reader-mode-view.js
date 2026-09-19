// Reader Mode — glue between the tracking rules (core/reader-mode-tracking.js),
// the storage (core/reader-mode.js) and what is on screen. Used by the loader,
// switchToTab(), the ribbon toggle, closeTab() and File > Exit.
import { state } from '../core/state.js';
import { getReaderPosition, saveReaderPosition, clearReaderPosition } from '../core/reader-mode.js';
import {
  readerTrackingPath,
  setTracking,
  snapshotReaderPosition,
  positionsToSave,
  resumeTracking,
  applyPendingRestore,
} from '../core/reader-mode-tracking.js';
import { goToPage, setZoom } from './renderer.js';

function isFrontDocument(doc) {
  return !!doc && state.documents[state.activeDocumentIndex] === doc;
}

// The DOM (#pdf-container scroll) and the window.__pdfViewport singleton
// always reflect the ACTIVE tab, not necessarily `doc` (closing a background
// tab's [x] doesn't switch to it first) — only read them when this really is
// the document in front, otherwise a different tab's zoom/scroll would be
// stored under this file's path. In single-page mode the real zoom lives in
// the viewport singleton, not doc.scale (which setZoom() leaves stale there —
// see setZoom's early return for vp.active).
function visibleView(doc) {
  if (!isFrontDocument(doc)) return null;
  const vp = window.__pdfViewport;
  const container = document.getElementById('pdf-container');
  return {
    zoom: vp && vp.active ? vp.zoom : 0,
    scrollTop: container ? container.scrollTop : 0,
    scrollHeight: container ? container.scrollHeight : 0,
  };
}

// Toggle writes and removals run one after the other: a quick on/off would
// otherwise let the removal look for the sidecar before the write has landed,
// leaving a sidecar behind for a document whose tracking is off.
let ioQueue = Promise.resolve();
function queued(task) {
  const run = ioQueue.then(task, task);
  ioQueue = run.catch(() => {});
  return run;
}

/**
 * Write the current position of a tracked document. Does nothing (false) for
 * a document that is not tracked, cannot be tracked, or whose stored position
 * has not been shown yet. The position is taken now, the write is queued.
 * @param {any} doc
 * @returns {Promise<boolean>}
 */
export function persistReaderPosition(doc) {
  const [entry] = positionsToSave([doc], visibleView);
  if (!entry) return Promise.resolve(false);
  return queued(() => saveReaderPosition(entry.path, entry.position));
}

/**
 * Write the positions of all tracked documents — for an exit that does not
 * close the tabs one by one (File > Exit destroys the window). The wait is
 * bounded: a folder that does not answer must not keep the app from closing.
 * @param {number} [maxWaitMs]
 * @returns {Promise<void>}
 */
export async function persistAllReaderPositions(maxWaitMs = 2000) {
  const writes = positionsToSave(state.documents, visibleView)
    .map((entry) => queued(() => saveReaderPosition(entry.path, entry.position)));
  if (writes.length === 0) return;
  await Promise.race([
    Promise.all(writes),
    new Promise((resolve) => setTimeout(resolve, maxWaitMs)),
  ]);
}

/**
 * The ribbon toggle. The sidecar is the per-document setting, so it follows
 * the toggle at once: on writes the current position (the opt-in survives a
 * crash, an update or File > Exit, and a read-only folder shows up now
 * instead of silently at close), off removes it (the next open starts
 * untracked instead of jumping to a stale position).
 * @param {any} doc
 * @param {boolean} on
 * @returns {Promise<boolean>} false when the setting could not be stored; for
 *   `on` tracking is then switched back off.
 */
export async function setReaderTracking(doc, on) {
  const path = readerTrackingPath(doc);
  if (!path) return false;
  setTracking(doc, on);
  if (!on) return queued(() => clearReaderPosition(path));
  const position = snapshotReaderPosition(doc, visibleView(doc));
  const ok = await queued(() => saveReaderPosition(path, position));
  if (!ok && doc.readerModeActive) setTracking(doc, false);
  return ok;
}

/**
 * Jump to the stored position of a document, if one is still waiting and the
 * document is in front. Safe to call at any time; see applyPendingRestore.
 * @param {any} doc
 * @returns {Promise<boolean>}
 */
export function restoreReaderPosition(doc) {
  const container = () => document.getElementById('pdf-container');
  return applyPendingRestore(doc, {
    isActive: () => isFrontDocument(doc),
    goToPage,
    setZoom,
    scrollHeight: () => container()?.scrollHeight || 0,
    setScrollTop: (top) => { const c = container(); if (c) c.scrollTop = top; },
  });
}

/**
 * Called by the loader for every document, in front or not: a file that
 * already has a stored position resumes being tracked, and the position is
 * shown now (document in front) or on its first activation (switchToTab).
 * A document without one keeps whatever the toggle says.
 * @param {any} doc
 * @returns {Promise<boolean>} whether tracking was resumed
 */
export async function resumeReaderTracking(doc) {
  const path = readerTrackingPath(doc);
  if (!path) return false;
  const saved = await getReaderPosition(path);
  if (!state.documents.includes(doc)) return false; // closed in the meantime
  if (!resumeTracking(doc, saved)) return false;
  await restoreReaderPosition(doc);
  return true;
}
