// Last view per file (#1245): which file a view belongs to, what is stored,
// how the list stays bounded, what a changed file still gets back, and when a
// stored view must not be shown.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_LAST_VIEWS,
  lastViewKey,
  lastViewPath,
  viewModeOf,
  detectFit,
  snapshotView,
  centerOffsets,
  centerScroll,
  sanitizeView,
  clampView,
  normalizeStore,
  rememberView,
  findView,
  forgetView,
  markExplicitTarget,
  queueLastView,
  hasPendingLastView,
  shouldRememberView,
  markShown,
  leaveFront,
  viewToRemember,
  applyLastView,
} from './last-view.js';

const doc = (extra = {}) => ({
  filePath: 'C:/docs/plan.pdf', currentPage: 1, scale: 1.5, viewMode: 'single',
  pdfDoc: { numPages: 10 }, readerModeActive: false, ...extra,
});

// A renderer stand-in that records the calls and moves the document along.
function fakeIo(d, extra = {}) {
  const calls = [];
  let active = true;
  return {
    calls,
    setActive(on) { active = on; },
    isActive: () => active,
    setViewMode: async (mode) => {
      calls.push(['mode', mode]);
      d.viewMode = mode === 'single' ? 'single' : 'continuous';
      d.bookSpread = mode === 'book';
      d.facingSpread = mode === 'facing';
    },
    goToPage: async (n, options) => { calls.push(['page', n, options]); d.currentPage = n; },
    setZoom: async (zoom) => { calls.push(['zoom', zoom]); d.scale = zoom; },
    fit: async (mode) => { calls.push(['fit', mode]); },
    setCenter: async (cx, cy, page) => { calls.push(['center', cx, cy, page]); },
    ...extra,
  };
}

// ── which file ──────────────────────────────────────────────────────────────

test('a Windows path is one file whatever its case and slashes', () => {
  assert.equal(lastViewKey('C:/Docs/Plan.PDF'), lastViewKey('c:\\docs\\plan.pdf'));
  assert.equal(lastViewKey('\\\\Server\\Share\\A.pdf'), '\\\\server\\share\\a.pdf');
});

test('other paths keep their case, and a path that is no file has no key', () => {
  assert.equal(lastViewKey('/home/me/Plan.pdf'), '/home/me/Plan.pdf');
  assert.notEqual(lastViewKey('/home/me/Plan.pdf'), lastViewKey('/home/me/plan.pdf'));
  assert.equal(lastViewKey('plan.pdf'), 'plan.pdf');
  assert.equal(lastViewKey('__memory__abc'), null);
  assert.equal(lastViewKey(''), null);
  assert.equal(lastViewKey(null), null);
});

test('a view belongs to the file the user opened, not to a working copy', () => {
  assert.equal(lastViewPath(doc()), 'C:/docs/plan.pdf');
  assert.equal(lastViewPath(doc({ filePath: 'C:/Temp/opds-edit-1.pdf', saveTargetPath: 'C:/docs/plan.pdf' })), 'C:/docs/plan.pdf');
  assert.equal(lastViewPath(doc({ filePath: 'C:/Temp/decrypted.pdf', originalFilePath: 'C:/docs/secret.pdf' })), 'C:/docs/secret.pdf');
});

test('untitled, in-memory and missing documents have no view to remember', () => {
  assert.equal(lastViewPath(doc({ isUntitled: true })), null);
  assert.equal(lastViewPath(doc({ filePath: '__memory__abc' })), null);
  assert.equal(lastViewPath(doc({ filePath: null })), null);
  assert.equal(lastViewPath(null), null);
});

// ── what is stored ──────────────────────────────────────────────────────────

test('book and facing are told apart from plain continuous', () => {
  assert.equal(viewModeOf(doc()), 'single');
  assert.equal(viewModeOf(doc({ viewMode: 'continuous' })), 'continuous');
  assert.equal(viewModeOf(doc({ viewMode: 'continuous', bookSpread: true })), 'book');
  assert.equal(viewModeOf(doc({ viewMode: 'continuous', facingSpread: true })), 'facing');
});

test('a page lying as Fit Page or Fit Width leaves it is recognised', () => {
  // A4 portrait (595 x 842) in a 1000 x 800 viewport: the height decides.
  const zoom = 800 / 842;
  const fitted = { zoom, offsetX: (1000 - 595 * zoom) / 2, offsetY: 0, cssW: 1000, cssH: 800, pageW: 595, pageH: 842 };
  assert.equal(detectFit(fitted), 'page');
  // Fit Width: the full width, the top of the page at the top.
  const wide = 1000 / 595;
  assert.equal(detectFit({ ...fitted, zoom: wide, offsetX: 0, offsetY: 0 }), 'width');
  // The same zoom after a pan is no longer a fit.
  assert.equal(detectFit({ ...fitted, offsetX: fitted.offsetX + 40 }), null);
  assert.equal(detectFit({ ...fitted, zoom: 2 }), null);
  assert.equal(detectFit({ ...fitted, cssW: 0 }), null);
  assert.equal(detectFit(null), null);
});

test('a background document stores page, mode and zoom', () => {
  assert.deepEqual(snapshotView(doc({ currentPage: 4, scale: 2 })), { page: 4, mode: 'single', zoom: 2 });
});

test('the viewport of the tab in front stores a fit as a fit', () => {
  const zoom = 800 / 842;
  const view = snapshotView(doc({ currentPage: 3 }), {
    kind: 'viewport', zoom, offsetX: (1000 - 595 * zoom) / 2, offsetY: 0, cssW: 1000, cssH: 800, pageW: 595, pageH: 842, viewRotation: 0,
  });
  assert.equal(view.fit, 'page');
  assert.equal(view.cx, undefined);
});

test('a zoomed viewport stores the page point in the middle, and gets it back', () => {
  const visible = { kind: 'viewport', zoom: 3, offsetX: -700, offsetY: -1200, cssW: 1000, cssH: 800, pageW: 595, pageH: 842, viewRotation: 0 };
  const view = snapshotView(doc({ currentPage: 2 }), visible);
  assert.equal(view.zoom, 3);
  assert.equal(view.fit, undefined);
  // Same window: exactly the old offsets.
  const same = centerOffsets({ cx: view.cx, cy: view.cy, cssW: 1000, cssH: 800, pageW: 595, pageH: 842, zoom: 3 });
  assert.ok(Math.abs(same.offsetX - -700) < 1e-9);
  assert.ok(Math.abs(same.offsetY - -1200) < 1e-9);
  // A window of another size: the same page point is in the middle again.
  const other = centerOffsets({ cx: view.cx, cy: view.cy, cssW: 1400, cssH: 600, pageW: 595, pageH: 842, zoom: 3 });
  assert.ok(Math.abs((1400 / 2 - other.offsetX) / (3 * 595) - view.cx) < 1e-9);
  assert.ok(Math.abs((600 / 2 - other.offsetY) / (3 * 842) - view.cy) < 1e-9);
});

test('a turned view keeps page and zoom but no place on the page', () => {
  const view = snapshotView(doc(), { kind: 'viewport', zoom: 3, offsetX: -700, offsetY: -1200, cssW: 1000, cssH: 800, pageW: 842, pageH: 595, viewRotation: 90 });
  assert.equal(view.zoom, 3);
  assert.equal(view.cx, undefined);
  assert.equal(view.cy, undefined);
});

test('a scrolled page stores the page point in the middle, and gets it back', () => {
  // The page element starts 900 px above and 50 px left of the visible area.
  const box = { left: -50, top: -900, width: 1200, height: 1700 };
  const view = snapshotView(doc({ viewMode: 'continuous', currentPage: 6, scale: 2 }), { kind: 'scroll', zoom: 2, box, viewW: 1000, viewH: 800 });
  assert.equal(view.mode, 'continuous');
  assert.ok(Math.abs(view.cx - 550 / 1200) < 1e-9);
  assert.ok(Math.abs(view.cy - 1300 / 1700) < 1e-9);
  // Already there: nothing to scroll.
  assert.deepEqual(centerScroll({ cx: view.cx, cy: view.cy, box, viewW: 1000, viewH: 800 }), { dx: 0, dy: 0 });
  // Reopened at the top of that page: scroll down by the old distance.
  const delta = centerScroll({ cx: view.cx, cy: view.cy, box: { ...box, left: 0, top: 0 }, viewW: 1000, viewH: 800 });
  assert.ok(Math.abs(delta.dx - 50) < 1e-9);
  assert.ok(Math.abs(delta.dy - 900) < 1e-9);
});

test('a page element without a size stores no place', () => {
  const view = snapshotView(doc(), { kind: 'scroll', zoom: 1, box: { left: 0, top: 0, width: 0, height: 0 }, viewW: 1000, viewH: 800 });
  assert.equal(view.cx, undefined);
});

// ── what comes back ─────────────────────────────────────────────────────────

test('anything unusable in storage is dropped field by field', () => {
  assert.equal(sanitizeView(null), null);
  assert.equal(sanitizeView('page 3'), null);
  assert.equal(sanitizeView({ page: 0 }), null);
  assert.equal(sanitizeView({ page: 'abc' }), null);
  assert.deepEqual(sanitizeView({ page: '7', mode: 'sideways', zoom: 'big', fit: 'height', cx: 'left', cy: 0.5 }), { page: 7 });
  assert.deepEqual(sanitizeView({ page: 2.9, zoom: NaN, cx: Infinity, cy: 0 }), { page: 2 });
  assert.deepEqual(sanitizeView({ page: 2, mode: 'book', zoom: 1.25, cx: 0.5, cy: 0.25, extra: 'x' }),
    { page: 2, mode: 'book', zoom: 1.25, cx: 0.5, cy: 0.25 });
});

test('the zoom stays within what the app can show', () => {
  assert.equal(sanitizeView({ page: 1, zoom: 5000 }).zoom, 64);
  assert.equal(sanitizeView({ page: 1, zoom: 0.0001 }).zoom, 0.05);
  assert.equal(sanitizeView({ page: 1, zoom: -2 }).zoom, undefined);
});

test('a centre far off the page is not kept, and a fit has no centre', () => {
  assert.equal(sanitizeView({ page: 1, cx: 5, cy: 0.5 }).cx, undefined);
  assert.equal(sanitizeView({ page: 1, cx: 0.5, cy: -3 }).cy, undefined);
  assert.deepEqual(sanitizeView({ page: 1, fit: 'width', cx: 0.5, cy: 0.5 }), { page: 1, fit: 'width' });
});

test('a page beyond the page count becomes the last page', () => {
  const view = { page: 40, mode: 'continuous', zoom: 2, cx: 0.5, cy: 0.8 };
  // The place belonged to a page that is gone; zoom and mode still hold.
  assert.deepEqual(clampView(view, 12), { page: 12, mode: 'continuous', zoom: 2 });
  assert.deepEqual(clampView(view, 40), view);
  assert.deepEqual(clampView({ page: 3, zoom: 2, cx: 0.5, cy: 0.8 }, 12), { page: 3, zoom: 2, cx: 0.5, cy: 0.8 });
  assert.equal(clampView({ page: 0 }, 12), null);
});

// ── the list ────────────────────────────────────────────────────────────────

test('the newest view is in front and a file has one entry', () => {
  let list = rememberView([], 'C:/a.pdf', { page: 2, zoom: 1 }, 100);
  list = rememberView(list, 'C:/b.pdf', { page: 5, zoom: 2 }, 200);
  list = rememberView(list, 'c:\\A.PDF', { page: 9, zoom: 3 }, 300);
  assert.deepEqual(list.map((e) => e.p), ['c:\\a.pdf', 'c:\\b.pdf']);
  assert.deepEqual(findView(list, 'C:/a.pdf'), { page: 9, zoom: 3 });
  assert.deepEqual(findView(list, 'C:/b.pdf'), { page: 5, zoom: 2 });
  assert.equal(findView(list, 'C:/c.pdf'), null);
  assert.equal(list[0].t, 300);
});

test('the list never grows beyond its maximum: the oldest fall off', () => {
  assert.equal(MAX_LAST_VIEWS, 200);
  let list = [];
  for (let i = 1; i <= MAX_LAST_VIEWS + 25; i++) list = rememberView(list, `/docs/${i}.pdf`, { page: i }, i);
  assert.equal(list.length, MAX_LAST_VIEWS);
  assert.equal(list[0].p, `/docs/${MAX_LAST_VIEWS + 25}.pdf`);
  assert.equal(findView(list, '/docs/25.pdf'), null);
  assert.deepEqual(findView(list, '/docs/26.pdf'), { page: 26 });
  // Reopening an old file moves it to the front instead of dropping it.
  list = rememberView(list, '/docs/26.pdf', { page: 1 }, 999);
  assert.equal(list.length, MAX_LAST_VIEWS);
  assert.equal(list[0].p, '/docs/26.pdf');
  assert.deepEqual(findView(list, '/docs/27.pdf'), { page: 27 });
});

test('a smaller maximum is honoured (and trims an existing list)', () => {
  let list = [];
  for (let i = 1; i <= 5; i++) list = rememberView(list, `/d/${i}.pdf`, { page: i }, i);
  list = rememberView(list, '/d/6.pdf', { page: 6 }, 6, 3);
  assert.deepEqual(list.map((e) => e.p), ['/d/6.pdf', '/d/5.pdf', '/d/4.pdf']);
});

test('a broken list in storage is read as far as it is valid', () => {
  assert.deepEqual(normalizeStore(null), []);
  assert.deepEqual(normalizeStore({ p: 'x' }), []);
  const list = normalizeStore([
    null, 'text', { p: '', v: { page: 1 } }, { p: '/a.pdf' }, { p: '/a.pdf', v: { page: 0 } },
    { p: '/b.pdf', v: { page: 3, zoom: 'x' }, t: 'soon' }, { p: '/b.pdf', v: { page: 8 }, t: 5 },
  ]);
  assert.deepEqual(list, [{ p: '/b.pdf', v: { page: 3 }, t: 0 }]);
});

test('an unusable view or path leaves the list as it was', () => {
  const list = rememberView([], '/a.pdf', { page: 2 }, 1);
  assert.deepEqual(rememberView(list, '/b.pdf', { page: 0 }, 2), list);
  assert.deepEqual(rememberView(list, '__memory__x', { page: 4 }, 2), list);
  assert.deepEqual(rememberView(list, null, { page: 4 }, 2), list);
});

test('a file can be forgotten', () => {
  let list = rememberView([], '/a.pdf', { page: 2 }, 1);
  list = rememberView(list, '/b.pdf', { page: 3 }, 2);
  assert.deepEqual(forgetView(list, '/a.pdf').map((e) => e.p), ['/b.pdf']);
  assert.deepEqual(forgetView(list, '/zzz.pdf').map((e) => e.p), ['/b.pdf', '/a.pdf']);
});

// ── when a stored view is shown ─────────────────────────────────────────────

test('a stored view waits for the document, once per document', () => {
  const d = doc();
  assert.equal(queueLastView(d, { page: 4, zoom: 2 }), true);
  assert.equal(hasPendingLastView(d), true);
  assert.deepEqual(d._lastViewRestore, { page: 4, zoom: 2 });
  // A reload into the open tab keeps the user's place.
  d._lastViewRestore = null;
  assert.equal(queueLastView(d, { page: 4, zoom: 2 }), false);
  assert.equal(hasPendingLastView(d), false);
});

test('nothing waits without a stored view, and the chance is used up', () => {
  const d = doc();
  assert.equal(queueLastView(d, null), false);
  assert.equal(queueLastView(d, { page: 4 }), false);
});

test('switched off: nothing is shown', () => {
  const d = doc();
  assert.equal(queueLastView(d, { page: 4 }, { enabled: false }), false);
  assert.equal(hasPendingLastView(d), false);
});

test('an explicit target wins: marked before the load, nothing waits', () => {
  const d = doc();
  markExplicitTarget(d);
  assert.equal(queueLastView(d, { page: 4, zoom: 2 }), false);
  assert.equal(hasPendingLastView(d), false);
});

test('an explicit target wins: marked while the view waits, it is dropped', async () => {
  const d = doc();
  queueLastView(d, { page: 4, zoom: 2 });
  markExplicitTarget(d);
  const io = fakeIo(d);
  assert.equal(await applyLastView(d, io), false);
  assert.deepEqual(io.calls, []);
  assert.equal(d.currentPage, 1);
});

test('an explicit target wins: given while the jump is under way, the rest is left out', async () => {
  const d = doc();
  queueLastView(d, { page: 4, zoom: 2, cx: 0.5, cy: 0.5 });
  const io = fakeIo(d);
  const goToPage = io.goToPage;
  io.goToPage = async (n, options) => { await goToPage(n, options); markExplicitTarget(d); d.currentPage = 9; };
  assert.equal(await applyLastView(d, io), false);
  assert.deepEqual(io.calls.map((c) => c[0]), ['page']);
  assert.equal(d.currentPage, 9);
  assert.equal(d._lastViewRestoring, false);
});

test('a file that Reader Mode tracks keeps its own position', () => {
  assert.equal(queueLastView(doc({ readerModeActive: true }), { page: 4 }), false);
  assert.equal(queueLastView(doc({ _readerRestore: { page: 2 } }), { page: 4 }), false);
});

test('a document taken elsewhere before its view could be shown keeps that place', async () => {
  // Loaded in a background tab; something went to page 6 before the tab came
  // to the front.
  const d = doc();
  queueLastView(d, { page: 4, zoom: 2 });
  d.currentPage = 6;
  const io = fakeIo(d);
  assert.equal(await applyLastView(d, io), false);
  assert.deepEqual(io.calls, []);
  assert.equal(d.currentPage, 6);
  assert.equal(hasPendingLastView(d), false);
});

test('the view is shown in order: mode, page, zoom, place', async () => {
  const d = doc();
  queueLastView(d, { page: 4, mode: 'continuous', zoom: 2, cx: 0.4, cy: 0.7 });
  const io = fakeIo(d);
  assert.equal(await applyLastView(d, io), true);
  assert.deepEqual(io.calls, [
    ['mode', 'continuous'],
    ['page', 4, { skipScroll: true }],
    ['zoom', 2],
    ['center', 0.4, 0.7, 4],
  ]);
  assert.equal(hasPendingLastView(d), false);
  // Shown once.
  assert.equal(await applyLastView(d, io), false);
});

test('what is already right is left alone', async () => {
  const d = doc();
  queueLastView(d, { page: 1, mode: 'single', zoom: 3 });
  const io = fakeIo(d);
  assert.equal(await applyLastView(d, io), true);
  assert.deepEqual(io.calls, [['zoom', 3]]);
});

test('a fitted view is fitted again instead of set to the old number', async () => {
  const d = doc();
  queueLastView(d, { page: 3, mode: 'single', zoom: 0.83, fit: 'width' });
  const io = fakeIo(d);
  assert.equal(await applyLastView(d, io), true);
  assert.deepEqual(io.calls, [['page', 3, {}], ['fit', 'width']]);
});

test('a file that lost pages opens on its last page, without the old place', async () => {
  const d = doc({ pdfDoc: { numPages: 3 } });
  queueLastView(d, { page: 12, zoom: 2, cx: 0.4, cy: 0.7 });
  const io = fakeIo(d);
  assert.equal(await applyLastView(d, io), true);
  assert.deepEqual(io.calls, [['page', 3, {}], ['zoom', 2]]);
});

test('a document in the background waits; nothing is shown in another tab', async () => {
  const d = doc();
  queueLastView(d, { page: 4, zoom: 2 });
  const io = fakeIo(d);
  io.setActive(false);
  assert.equal(await applyLastView(d, io), false);
  assert.deepEqual(io.calls, []);
  assert.equal(hasPendingLastView(d), true);
  // First activation: now it is shown.
  io.setActive(true);
  assert.equal(await applyLastView(d, io), true);
  assert.deepEqual(io.calls, [['page', 4, {}], ['zoom', 2]]);
});

test('a tab switch during the jump: the rest follows when the tab is back', async () => {
  const d = doc();
  queueLastView(d, { page: 4, zoom: 2, cx: 0.5, cy: 0.5 });
  const io = fakeIo(d);
  const goToPage = io.goToPage;
  io.goToPage = async (n, options) => { await goToPage(n, options); io.setActive(false); };
  assert.equal(await applyLastView(d, io), false);
  assert.equal(hasPendingLastView(d), true);
  // Back in front: the page is already right (and no longer page 1, which
  // must not be read as "taken elsewhere"), zoom and place still follow.
  io.goToPage = goToPage;
  io.setActive(true);
  assert.equal(await applyLastView(d, io), true);
  assert.deepEqual(io.calls.map((c) => c[0]), ['page', 'zoom', 'center']);
});

test('a second call while the jump is under way does nothing', async () => {
  const d = doc();
  queueLastView(d, { page: 4, zoom: 2 });
  const io = fakeIo(d);
  const [first, second] = await Promise.all([applyLastView(d, io), applyLastView(d, io)]);
  assert.deepEqual([first, second], [true, false]);
  assert.equal(io.calls.filter((c) => c[0] === 'page').length, 1);
});

test('a document that is not loaded yet is left waiting', async () => {
  const d = doc({ pdfDoc: null });
  queueLastView(d, { page: 4 });
  assert.equal(await applyLastView(d, fakeIo(d)), false);
  assert.equal(hasPendingLastView(d), true);
});

// ── when a view is stored ───────────────────────────────────────────────────

test('closing stores the view of a loaded file', () => {
  assert.equal(shouldRememberView(doc()), true);
  assert.equal(shouldRememberView(doc({ pdfDoc: null })), false);
  assert.equal(shouldRememberView(doc({ isUntitled: true })), false);
  assert.equal(shouldRememberView(null), false);
});

test('a stored view that was never shown is not overwritten at close', () => {
  const d = doc();
  queueLastView(d, { page: 4, zoom: 2 });
  assert.equal(shouldRememberView(d), false);
  assert.equal(shouldRememberView(doc({ _readerRestore: { page: 2 } })), false);
});

test('a document opened for an explicit target still stores where it was closed', () => {
  const d = doc();
  markExplicitTarget(d);
  queueLastView(d, { page: 4 });
  d.currentPage = 7;
  assert.equal(shouldRememberView(d), true);
  assert.deepEqual(snapshotView(d), { page: 7, mode: 'single', zoom: 1.5 });
});

// ── which view is stored ────────────────────────────────────────────────────
// Zoom, fit and place live in the viewport and the page area, which show the
// tab in front only.

const live = (view) => { let taken = 0; const fn = () => { taken++; return view; }; fn.taken = () => taken; return fn; };

test('the document on screen is measured when it closes', () => {
  const d = doc({ currentPage: 3 });
  markShown(d);
  const snapshot = live({ page: 3, mode: 'single', zoom: 2, cx: 0.5, cy: 0.5 });
  assert.deepEqual(viewToRemember(d, true, snapshot), { page: 3, mode: 'single', zoom: 2, cx: 0.5, cy: 0.5 });
  assert.equal(snapshot.taken(), 1);
});

test('a document that was never on screen stores nothing', () => {
  // Restored with the session and never looked at: its zoom is the initial
  // value nobody chose.
  const d = doc();
  const snapshot = live({ page: 1, mode: 'single', zoom: 1.5 });
  assert.equal(viewToRemember(d, false, snapshot), null);
  // In front but not drawn yet (the window closes its tabs one after the
  // other): the page area still shows something else.
  assert.equal(viewToRemember(d, true, snapshot), null);
  assert.equal(snapshot.taken(), 0);
});

test('a document closed from the background is stored as it last left the front', () => {
  const d = doc({ currentPage: 5 });
  markShown(d);
  const leaving = live({ page: 5, mode: 'single', zoom: 3, cx: 0.2, cy: 0.8 });
  leaveFront(d, leaving);
  assert.equal(leaving.taken(), 1);
  assert.equal(d._lastViewShown, false);
  const later = live({ page: 1, mode: 'single', zoom: 1 });
  assert.deepEqual(viewToRemember(d, false, later), { page: 5, mode: 'single', zoom: 3, cx: 0.2, cy: 0.8 });
  // Back in front but closed before it was drawn: still that view.
  assert.deepEqual(viewToRemember(d, true, later), { page: 5, mode: 'single', zoom: 3, cx: 0.2, cy: 0.8 });
  assert.equal(later.taken(), 0);
  // Drawn again: measured again.
  markShown(d);
  assert.deepEqual(viewToRemember(d, true, later), { page: 1, mode: 'single', zoom: 1 });
});

test('leaving the front before the tab was drawn keeps the earlier view', () => {
  const d = doc();
  markShown(d);
  leaveFront(d, live({ page: 2, zoom: 2 }));
  // Came to the front and left again at once (Ctrl+Tab through the tabs).
  const garbage = live({ page: 1, zoom: 1.5 });
  leaveFront(d, garbage);
  assert.equal(garbage.taken(), 0);
  assert.deepEqual(d._lastViewSeen, { page: 2, zoom: 2 });
});

test('a stored view that still has to be shown is not replaced by a tab switch or a close', () => {
  const d = doc();
  queueLastView(d, { page: 4, zoom: 2 });
  markShown(d);
  const snapshot = live({ page: 1, zoom: 1.5 });
  leaveFront(d, snapshot);
  assert.equal(d._lastViewSeen, undefined);
  markShown(d);
  assert.equal(viewToRemember(d, true, snapshot), null);
  assert.equal(snapshot.taken(), 0);
});

test('a document without a file has no view to store, on screen or not', () => {
  const d = doc({ isUntitled: true });
  markShown(d);
  assert.equal(viewToRemember(d, true, live({ page: 2 })), null);
  leaveFront(d, live({ page: 2 }));
  assert.equal(d._lastViewSeen, undefined);
  leaveFront(null, live({ page: 2 }));
  markShown(null);
});
