// Last view per file (#1245): reopening a PDF brings back the page, the zoom,
// the place on the page and the view mode it was closed with. The rules live
// here, free of DOM, storage and renderer imports, so they can be unit-tested
// (last-view.test.mjs); the glue to the app is pdf/last-view-app.js.
//
// This is the automatic counterpart of Reader Mode (reader-mode-tracking.js):
// Reader Mode is switched on per file and keeps its position in a file next to
// the PDF; this remembers every file in one bounded list in the app's own
// storage, like the recent-files list, and can be switched off in the
// preferences. A file that Reader Mode tracks keeps using its own position.
//
// State on the document object:
//   doc._lastViewDone      this document had its one chance: a reload into the
//                          open tab must not jump back to the stored view
//   doc._lastViewRestore   a stored view that still has to be shown; as long
//                          as it is set, closing must not overwrite the stored
//                          view with the page-1 state nobody looked at
//   doc._lastViewStarted   showing it has begun (it may be finished later, when
//                          the document comes to the front again)
//   doc._lastViewRestoring a jump to the stored view is under way
//   doc._lastViewExplicit  the document was opened for a specific target (a
//                          search hit, a sheet of a drawing set, automation):
//                          that target wins, the stored view is never shown
//   doc._lastViewShown     the document is on screen: its first render since it
//                          came to the front is done, so the viewport and the
//                          page area really show this document
//   doc._lastViewSeen      its view when it last left the front. Zoom, fit and
//                          place live in the viewport and the page area, which
//                          show the tab in front only; a document closed from
//                          the background (or before its tab was drawn) is
//                          stored with this. Never on screen: nothing to store

/** Name of the list in the app's storage (core/opslag.js). */
export const LAST_VIEWS_NAME = 'lastViews';
/** The list keeps the most recently closed files only. */
export const MAX_LAST_VIEWS = 200;

const MEMORY_KEY_PREFIX = '__memory__';
const VIEW_MODES = ['single', 'continuous', 'book', 'facing'];
const FIT_MODES = ['page', 'width'];
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
// The centre of the view as a fraction of the page: 0..1 is on the page, a
// little outside is possible (panned past the edge), far outside is not kept.
const MIN_CENTER = -1;
const MAX_CENTER = 2;

/**
 * The key a file is remembered under. Windows paths do not distinguish case
 * or the direction of the slashes; other paths are kept as they are.
 * @param {string} path
 * @returns {string | null}
 */
export function lastViewKey(path) {
  if (typeof path !== 'string' || !path || path.startsWith(MEMORY_KEY_PREFIX)) return null;
  const windows = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\');
  return windows ? path.replace(/\//g, '\\').toLowerCase() : path;
}

/**
 * The file a view belongs to, or null when this document has none (never
 * saved, in-memory only). A document that renders from a working copy (after
 * an edit reload, or opened with a password) belongs to the file the user
 * opened, not to the copy.
 * @param {any} doc
 * @returns {string | null}
 */
export function lastViewPath(doc) {
  if (!doc || doc.isUntitled) return null;
  const path = doc.originalFilePath || doc.saveTargetPath || doc.filePath;
  return lastViewKey(path) ? path : null;
}

/**
 * The view mode as setViewMode() takes it. Book and facing are variants of
 * the continuous mode, told apart by a flag on the document.
 * @param {any} doc
 * @returns {'single' | 'continuous' | 'book' | 'facing'}
 */
export function viewModeOf(doc) {
  if (doc?.viewMode !== 'continuous') return 'single';
  if (doc.facingSpread) return 'facing';
  if (doc.bookSpread) return 'book';
  return 'continuous';
}

/**
 * Is the page lying exactly as Fit Page or Fit Width leaves it? The app does
 * not keep a fit mode, so it is read from the zoom and the offsets. A fitted
 * view is stored as such: reopened in a window of another size it is fitted
 * again instead of shown at the old number.
 * @param {{zoom: number, offsetX: number, offsetY: number, cssW: number, cssH: number, pageW: number, pageH: number}} v
 * @returns {'page' | 'width' | null}
 */
export function detectFit(v) {
  if (!v || !(v.zoom > 0 && v.cssW > 0 && v.cssH > 0 && v.pageW > 0 && v.pageH > 0)) return null;
  const same = (a, b) => Math.abs(a - b) <= Math.abs(b) * 0.001;
  const near = (a, b) => Math.abs(a - b) <= 1;
  const centredX = (v.cssW - v.pageW * v.zoom) / 2;
  const centredY = (v.cssH - v.pageH * v.zoom) / 2;
  if (same(v.zoom, Math.min(v.cssW / v.pageW, v.cssH / v.pageH))
    && near(v.offsetX, centredX) && near(v.offsetY, centredY)) return 'page';
  if (same(v.zoom, v.cssW / v.pageW)
    && near(v.offsetX, centredX) && near(v.offsetY, Math.max(0, centredY))) return 'width';
  return null;
}

/**
 * The view to store. `visible` carries what only the tab in front knows; leave
 * it out for a document in the background (page, mode and zoom are then all
 * there is). Two shapes:
 *  - {kind: 'viewport', zoom, offsetX, offsetY, cssW, cssH, pageW, pageH,
 *     viewRotation}: the single-page viewport, sizes in CSS pixels and the
 *     page as it lies on screen;
 *  - {kind: 'scroll', zoom, box: {left, top, width, height}, viewW, viewH}:
 *     a page element in the scrolling container, `box` relative to the
 *     visible area of that container.
 * @param {any} doc
 * @param {any} [visible]
 */
export function snapshotView(doc, visible) {
  const v = visible || null;
  const view = {
    page: doc.currentPage,
    mode: viewModeOf(doc),
    zoom: v && v.zoom > 0 ? v.zoom : doc.scale,
  };
  if (!v) return view;
  if (v.kind === 'viewport') {
    const fit = detectFit(v);
    if (fit) view.fit = fit;
    // A turned view (screen only, not kept) has its centre in a space that is
    // gone at the next open: page and zoom are enough then.
    else if (!v.viewRotation && v.zoom > 0 && v.pageW > 0 && v.pageH > 0) {
      view.cx = (v.cssW / 2 - v.offsetX) / (v.zoom * v.pageW);
      view.cy = (v.cssH / 2 - v.offsetY) / (v.zoom * v.pageH);
    }
  } else if (v.kind === 'scroll' && v.box && v.box.width > 0 && v.box.height > 0) {
    view.cx = (v.viewW / 2 - v.box.left) / v.box.width;
    view.cy = (v.viewH / 2 - v.box.top) / v.box.height;
  }
  return view;
}

/** Offsets that put the page point (cx, cy) in the middle of the viewport. */
export function centerOffsets({ cx, cy, cssW, cssH, pageW, pageH, zoom }) {
  return { offsetX: cssW / 2 - cx * pageW * zoom, offsetY: cssH / 2 - cy * pageH * zoom };
}

/** How far to scroll to put the page point (cx, cy) in the middle of the view. */
export function centerScroll({ cx, cy, box, viewW, viewH }) {
  return { dx: box.left + cx * box.width - viewW / 2, dy: box.top + cy * box.height - viewH / 2 };
}

/**
 * A stored view reduced to what is usable, or null when nothing is. Storage
 * can hold anything (an older version, a hand-edited value), so every field
 * is checked on the way in and on the way out.
 * @param {any} view
 */
export function sanitizeView(view) {
  if (!view || typeof view !== 'object') return null;
  const page = Math.floor(Number(view.page));
  if (!(page >= 1)) return null;
  const out = { page };
  if (VIEW_MODES.includes(view.mode)) out.mode = view.mode;
  const zoom = Number(view.zoom);
  if (Number.isFinite(zoom) && zoom > 0) out.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  if (FIT_MODES.includes(view.fit)) out.fit = view.fit;
  const inRange = (n) => typeof n === 'number' && Number.isFinite(n) && n >= MIN_CENTER && n <= MAX_CENTER;
  if (!out.fit && inRange(view.cx) && inRange(view.cy)) {
    out.cx = view.cx;
    out.cy = view.cy;
  }
  return out;
}

/**
 * The view to show in a document of `numPages` pages. The file may have
 * changed since: a page that no longer exists becomes the last page, and the
 * place on the page is then dropped (it belonged to another page). Zoom and
 * view mode stay.
 * @param {any} view
 * @param {number} numPages
 */
export function clampView(view, numPages) {
  const clean = sanitizeView(view);
  if (!clean) return null;
  if (numPages >= 1 && clean.page > numPages) {
    clean.page = numPages;
    delete clean.cx;
    delete clean.cy;
  }
  return clean;
}

/**
 * The list as stored, reduced to valid entries: most recently closed first,
 * one entry per file, never more than `max`.
 * @param {any} raw
 * @param {number} [max]
 * @returns {{p: string, v: object, t: number}[]}
 */
export function normalizeStore(raw, max = MAX_LAST_VIEWS) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (out.length >= max) break;
    const key = lastViewKey(entry?.p);
    const view = sanitizeView(entry?.v);
    if (!key || !view || seen.has(key)) continue;
    seen.add(key);
    out.push({ p: key, v: view, t: Number(entry.t) || 0 });
  }
  return out;
}

/**
 * The list with the view of `path` in front. The oldest entries fall off the
 * end once the list is full.
 * @returns {{p: string, v: object, t: number}[]}
 */
export function rememberView(store, path, view, now = Date.now(), max = MAX_LAST_VIEWS) {
  const list = normalizeStore(store, max);
  const key = lastViewKey(path);
  const clean = sanitizeView(view);
  if (!key || !clean) return list;
  return [{ p: key, v: clean, t: now }, ...list.filter((e) => e.p !== key)].slice(0, max);
}

/** The stored view of `path`, or null. */
export function findView(store, path) {
  const key = lastViewKey(path);
  if (!key) return null;
  const entry = normalizeStore(store).find((e) => e.p === key);
  return entry ? entry.v : null;
}

/** The list without `path`. */
export function forgetView(store, path) {
  const key = lastViewKey(path);
  return normalizeStore(store).filter((e) => e.p !== key);
}

/**
 * This document is opened for a specific target (a search hit, a sheet of a
 * drawing set, an automation that expects the default view): that target
 * wins. Call it before the load, or at any time after: a stored view that was
 * still waiting is dropped.
 * @param {any} doc
 */
export function markExplicitTarget(doc) {
  if (!doc) return;
  doc._lastViewExplicit = true;
  doc._lastViewRestore = null;
}

/**
 * The loader found (or did not find) a stored view for this document. Sets it
 * to wait until the document is on screen, unless it must not be shown:
 * switched off, an explicit target, a file that Reader Mode tracks, or a
 * document that was loaded before (a reload into its open tab keeps the
 * user's place).
 * @param {any} doc
 * @param {any} saved  the stored view, null when there is none
 * @param {{enabled?: boolean}} [options]
 * @returns {boolean} whether a view is waiting to be shown
 */
export function queueLastView(doc, saved, { enabled = true } = {}) {
  if (!doc || doc._lastViewDone) return false;
  doc._lastViewDone = true;
  if (!enabled || doc._lastViewExplicit) return false;
  if (doc.readerModeActive || doc._readerRestore) return false;
  const view = sanitizeView(saved);
  if (!view) return false;
  doc._lastViewRestore = view;
  doc._lastViewStarted = false;
  return true;
}

/** @param {any} doc */
export function hasPendingLastView(doc) {
  return !!doc && !!doc._lastViewRestore;
}

/**
 * Whether closing (or exiting) should store this document's view. Not while a
 * stored view (of this feature or of Reader Mode) still has to be shown: the
 * document's own page and zoom then say nothing about where the user was.
 * @param {any} doc
 * @returns {boolean}
 */
export function shouldRememberView(doc) {
  return !!doc && !!doc.pdfDoc && !doc._lastViewRestore && !doc._readerRestore && !!lastViewPath(doc);
}

/** The first render of the document since it came to the front is done. */
export function markShown(doc) {
  if (doc) doc._lastViewShown = true;
}

/**
 * The document leaves the front (a tab switch): keep the view that only the
 * front knows, for a close from the background.
 * @param {any} doc
 * @param {() => object} snapshot  takes the view of the document on screen
 */
export function leaveFront(doc, snapshot) {
  if (!doc) return;
  if (doc._lastViewShown && shouldRememberView(doc)) doc._lastViewSeen = snapshot();
  doc._lastViewShown = false;
}

/**
 * The view to store when a document closes, or null when there is none. The
 * document on screen is measured now; any other document (in the background,
 * or in front but not drawn yet: closing the window closes the tabs one after
 * the other, faster than they render) gets the view it last left the front
 * with. A document that was never on screen has no view: storing its initial
 * state would give it a zoom nobody chose at the next open.
 * @param {any} doc
 * @param {boolean} isFront
 * @param {() => object} snapshot  takes the view of the document on screen
 * @returns {object | null}
 */
export function viewToRemember(doc, isFront, snapshot) {
  if (!shouldRememberView(doc)) return null;
  if (isFront && doc._lastViewShown) return snapshot();
  return doc._lastViewSeen || null;
}

/**
 * Show the stored view of a document: once, and only while it is the document
 * in front (the renderer calls act on the ACTIVE document, so the front
 * document is checked again after every await). When the user switched tabs
 * in between, the rest stays waiting until the document is in front again.
 *
 * Order: view mode, page, zoom (or fit), place on the page. A document that
 * was already taken somewhere else before its view could be shown (it loaded
 * in a background tab and something went to another page) keeps that place.
 * @param {any} doc
 * @param {{isActive: () => boolean, setViewMode: (mode: string) => any,
 *          goToPage: (n: number, options?: object) => any, setZoom: (zoom: number) => any,
 *          fit: (mode: string) => any, setCenter: (cx: number, cy: number, page: number) => any}} io
 * @returns {Promise<boolean>} true when the view was shown
 */
export async function applyLastView(doc, io) {
  const pending = doc?._lastViewRestore;
  if (!pending || doc._lastViewRestoring) return false;
  if (!doc.pdfDoc || !io.isActive()) return false;
  if (doc._lastViewExplicit || (!doc._lastViewStarted && doc.currentPage !== 1)) {
    doc._lastViewRestore = null;
    return false;
  }
  const view = clampView(pending, doc.pdfDoc.numPages);
  if (!view) {
    doc._lastViewRestore = null;
    return false;
  }
  // Dropped (explicit target) or the tab left the front while a step ran.
  const stopped = () => doc._lastViewRestore !== pending || !io.isActive();
  doc._lastViewRestoring = true;
  doc._lastViewStarted = true;
  try {
    if (view.mode && view.mode !== viewModeOf(doc)) {
      await io.setViewMode(view.mode);
      if (stopped()) return false;
    }
    const hasCenter = view.cx !== undefined;
    if (view.page !== doc.currentPage) {
      // With a place on the page to go to, the page jump leaves the scrolling
      // alone: its own (possibly animated) scroll to the top of the page would
      // run on after the place is set.
      await io.goToPage(view.page, hasCenter ? { skipScroll: true } : {});
      if (stopped()) return false;
    }
    if (view.fit) await io.fit(view.fit);
    else if (view.zoom) await io.setZoom(view.zoom);
    if (stopped()) return false;
    // The page is named: in the continuous view the current page follows the
    // scroll position, which the steps above may have moved.
    if (hasCenter) await io.setCenter(view.cx, view.cy, view.page);
    doc._lastViewRestore = null;
    return true;
  } finally {
    doc._lastViewRestoring = false;
  }
}
