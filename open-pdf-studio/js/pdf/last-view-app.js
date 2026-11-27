// Last view per file (#1245): glue between the rules (core/last-view.js), the
// app's storage and what is on screen. Used by the loader, switchToTab(),
// closeTab(), File > Exit and the preferences. Loaded on first use, so it adds
// nothing to the start-up bundle.
import { state } from '../core/state.js';
import { isMobile } from '../core/platform.js';
import { leesOpslagJson, schrijfOpslagJson, verwijderOpslag } from '../core/opslag.js';
import {
  LAST_VIEWS_NAME,
  lastViewPath,
  snapshotView,
  centerOffsets,
  centerScroll,
  rememberView,
  findView,
  queueLastView,
  markShown,
  leaveFront,
  viewToRemember,
  applyLastView,
} from '../core/last-view.js';
import { goToPage, setZoom, setViewMode, fitPage, fitWidth } from './renderer.js';
import { viewportCanvasMaat, schermPaginaMaat, zetViewportStand } from './pdf-viewport.js';

/**
 * The preference "Reopen documents at the last view" (on unless switched
 * off). Not on a phone or tablet: there a document opens fitted to the
 * screen, by design of the mobile view.
 */
export function lastViewEnabled() {
  return state.preferences?.reopenAtLastView !== false && !isMobile();
}

function isFrontDocument(doc) {
  return !!doc && state.documents[state.activeDocumentIndex] === doc;
}

function readStore() {
  return leesOpslagJson(LAST_VIEWS_NAME, []);
}

function writeStore(list) {
  try {
    schrijfOpslagJson(LAST_VIEWS_NAME, list);
    return true;
  } catch (e) {
    // Storage full: losing a remembered view is a minor inconvenience.
    console.warn('[last-view] not stored:', e);
    return false;
  }
}

const pageContainer = () => document.getElementById('pdf-container');

// The single-page viewport owns zoom and pan of the document in front when it
// is active; otherwise the page is an element in the scrolling container.
function viewportShows(doc) {
  const vp = window.__pdfViewport;
  return doc.viewMode === 'single' && !!vp && !!vp.active;
}

// The page element the scroll position is measured against: the page canvas
// in single-page view, the wrapper of the current page otherwise.
function pageElement(doc, page = doc.currentPage) {
  if (doc.viewMode === 'single') return document.getElementById('pdf-canvas');
  return document.querySelector(`.page-wrapper[data-page="${page}"]`);
}

// Where `el` lies relative to the visible area of the scrolling container.
function boxIn(container, el) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height };
}

// The DOM and the viewport singleton always show the ACTIVE tab, not
// necessarily `doc` (the [x] of a background tab closes it without switching
// to it first): only read them for the document in front.
function visibleView(doc) {
  if (!isFrontDocument(doc)) return null;
  if (viewportShows(doc)) {
    const vp = window.__pdfViewport;
    const { cssW, cssH } = viewportCanvasMaat();
    const { w, h } = schermPaginaMaat();
    return {
      kind: 'viewport',
      zoom: vp.zoom,
      offsetX: vp.offsetX,
      offsetY: vp.offsetY,
      cssW,
      cssH,
      pageW: w,
      pageH: h,
      viewRotation: vp.viewRotation || 0,
    };
  }
  const container = pageContainer();
  const el = pageElement(doc);
  if (!container || !el) return null;
  return {
    kind: 'scroll',
    zoom: doc.scale,
    box: boxIn(container, el),
    viewW: container.clientWidth,
    viewH: container.clientHeight,
  };
}

// The view of a document, measured now when it is the one on screen and taken
// from its last time in front otherwise (see viewToRemember).
function viewOf(doc) {
  return viewToRemember(doc, isFrontDocument(doc), () => snapshotView(doc, visibleView(doc)));
}

/**
 * Store the view of a document under its file. Does nothing (false) when the
 * preference is off, the document has no file, it was never on screen, or a
 * stored view has not been shown yet.
 * @param {any} doc
 * @returns {boolean}
 */
export function rememberLastView(doc) {
  if (!lastViewEnabled()) return false;
  const view = viewOf(doc);
  if (!view) return false;
  return writeStore(rememberView(readStore(), lastViewPath(doc), view));
}

/**
 * Store the views of all open documents: for an exit that does not close the
 * tabs one by one (File > Exit destroys the window).
 */
export function rememberAllLastViews() {
  if (!lastViewEnabled()) return;
  let list = null;
  for (const doc of state.documents) {
    const view = viewOf(doc);
    if (view) list = rememberView(list || readStore(), lastViewPath(doc), view);
  }
  if (list) writeStore(list);
}

// A tab switch tells here that a document leaves the front (ui/chrome/tabs.js
// calls this through the window, so the start-up bundle does not import this
// module): its view is taken while the page area still shows it.
if (typeof window !== 'undefined') {
  window.__OPDS_LAST_VIEW_LEAVE__ = (doc) => {
    try {
      leaveFront(doc, () => snapshotView(doc, visibleView(doc)));
    } catch (e) {
      console.warn('[last-view] view not kept:', e);
    }
  };
}

/** Forget every stored view (the preference was switched off). */
export function forgetAllLastViews() {
  verwijderOpslag(LAST_VIEWS_NAME);
}

function setCenter(doc, cx, cy, page) {
  if (viewportShows(doc)) {
    const vp = window.__pdfViewport;
    const { cssW, cssH } = viewportCanvasMaat();
    const { w, h } = schermPaginaMaat();
    if (!(cssW > 0 && cssH > 0 && w > 0 && h > 0 && vp.zoom > 0)) return;
    const { offsetX, offsetY } = centerOffsets({ cx, cy, cssW, cssH, pageW: w, pageH: h, zoom: vp.zoom });
    zetViewportStand({ zoom: vp.zoom, offsetX, offsetY, verankerd: true, strikt: false });
    return;
  }
  const container = pageContainer();
  const el = pageElement(doc, page);
  if (!container || !el) return;
  const box = boxIn(container, el);
  if (!(box.width > 0 && box.height > 0)) return;
  const { dx, dy } = centerScroll({ cx, cy, box, viewW: container.clientWidth, viewH: container.clientHeight });
  container.scrollLeft += dx;
  container.scrollTop += dy;
}

/**
 * Show the stored view of a document, if one is still waiting and the
 * document is in front. Safe to call at any time; see applyLastView.
 * @param {any} doc
 * @returns {Promise<boolean>}
 */
export function restoreLastView(doc) {
  return applyLastView(doc, {
    isActive: () => isFrontDocument(doc),
    setViewMode,
    goToPage,
    setZoom,
    fit: (mode) => (mode === 'width' ? fitWidth() : fitPage()),
    setCenter: (cx, cy, page) => setCenter(doc, cx, cy, page),
  });
}

/**
 * The first render of a document since it came to the front is done (the
 * loader for a document that loads in front, switchToTab for a tab switch):
 * a stored view that was still waiting is shown, and from here on the page
 * area shows this document, so its view can be measured when it closes.
 * @param {any} doc
 * @returns {Promise<boolean>} false when the document is not (or no longer) in front
 */
export async function shownInFront(doc) {
  if (!doc?.pdfDoc || !isFrontDocument(doc)) return false;
  await restoreLastView(doc);
  if (!isFrontDocument(doc)) return false;
  markShown(doc);
  return true;
}

/**
 * Called by the loader for every document, in front or not, after Reader Mode
 * had its turn: a file with a stored view is shown there now (document in
 * front) or on its first activation (switchToTab).
 * @param {any} doc
 * @returns {Promise<boolean>} whether the document is on screen now
 */
export async function resumeLastView(doc) {
  const enabled = lastViewEnabled();
  const path = lastViewPath(doc);
  const saved = enabled && path ? findView(readStore(), path) : null;
  queueLastView(doc, saved, { enabled });
  return shownInFront(doc);
}
