// Reader Mode — glue between the tracking rules (core/reader-mode-tracking.js),
// the storage (core/reader-mode.js) and what is on screen. Used by the ribbon
// toggle, closeTab() and File > Exit.
import { state } from '../core/state.js';
import { saveReaderPosition, clearReaderPosition } from '../core/reader-mode.js';
import {
  readerTrackingPath,
  setTracking,
  shouldSaveReaderPosition,
  snapshotReaderPosition,
} from '../core/reader-mode-tracking.js';

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
 * has not been shown yet.
 * @param {any} doc
 * @returns {Promise<boolean>}
 */
export function persistReaderPosition(doc) {
  if (!shouldSaveReaderPosition(doc)) return Promise.resolve(false);
  const path = readerTrackingPath(doc);
  const position = snapshotReaderPosition(doc, visibleView(doc));
  return queued(() => saveReaderPosition(path, position));
}

/**
 * Write the positions of all tracked documents — for exit paths that do not
 * close the tabs one by one.
 * @returns {Promise<boolean[]>}
 */
export function persistAllReaderPositions() {
  return Promise.all(state.documents.map((doc) => persistReaderPosition(doc)));
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
