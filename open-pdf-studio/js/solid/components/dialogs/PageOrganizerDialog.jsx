import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { thumbnailData, placeholderSize } from '../../stores/panels/thumbnailStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { labelVan } from '../../../pdf/pagina-labels.js';
import { isNoOpGap, rangeInOrder, stepRow } from '../../../pdf/page-order.js';
import {
  createPlan, keysOf, isPlanUnchanged, isStructureUnchanged, moveEntriesToGap, moveEntriesBy,
  moveEntriesToEdge, rotateEntries, deleteEntries, insertBlank, insertSource, toggleSplit, hasSplitAt,
  splitAroundSelection, splitRanges, createHistory, pushHistory, undoHistory, redoHistory, adjacentEntry,
} from '../../../pdf/page-edit-plan.js';
import {
  BLANK_PRESETS, normalizeBlankSetup, blankSizeFromSetup, setupOrientation, withOrientation, withUnit, withMode,
  shownEntrySize, thumbBox, fromPoints,
} from '../../../pdf/blank-page-setup.js';
import {
  ZOOM_LEVELS, DEFAULT_ZOOM_INDEX, GUTTER, LABEL_HEIGHT, clampZoomIndex, zoomStep, gridLayout,
  cellPosition, tilePosition, visibleRange, gapAtPoint, scrollTopFor,
} from '../../../pdf/organizer-grid.js';
import { createOrganizerPointerDrag } from '../../../pdf/organizer-pointer-drag.js';
import { setPageDropTarget } from '../../../ui/page-drop-target.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const ICON = {
  rotateLeft: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 6.5A5 5 0 1 1 3 9"/><path d="M3 3v3.5h3.5"/></svg>',
  rotateRight: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12.5 6.5A5 5 0 1 0 13 9"/><path d="M13 3v3.5H9.5"/></svg>',
  delete: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9M7 7v4M9 7v4"/></svg>',
  insert: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v10M3 8h10"/></svg>',
  split: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4.5" cy="4.5" r="2"/><circle cx="4.5" cy="11.5" r="2"/><path d="M6.2 5.6L13.5 12M6.2 10.4L13.5 4"/></svg>',
};

let bronTeller = 0;

// Edit Pages (#764): a zoomable, virtualised grid of page thumbnails in which
// pages are reordered (drag and drop, keyboard), rotated, deleted, extracted,
// inserted (blank pages, pages of another PDF — also by dropping a PDF file
// on the grid) and marked for splitting. Everything stays pending (with its
// own undo inside the organizer) until Apply, which carries it out as one
// undo step of the document (applyPageEdits) and then writes the parts of
// the split marks. Cancel discards everything.
export default function PageOrganizerDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const doc = getActiveDocument();
  const total = doc?.pdfDoc?.numPages || 0;
  const startKey = `p${doc?.currentPage || 1}`;

  const [history, setHistory] = createSignal(createHistory(createPlan(total)));
  const plan = () => history().present;
  const entries = () => plan().entries;
  const commit = (next) => setHistory(pushHistory(history(), next));

  const [selected, setSelected] = createSignal(new Set(total ? [startKey] : []));
  const [anchor, setAnchor] = createSignal(startKey);
  const [focusKey, setFocusKey] = createSignal(startKey);
  const [zoom, setZoom] = createSignal(DEFAULT_ZOOM_INDEX);
  const [dropGap, setDropGap] = createSignal(null);
  const [dragKind, setDragKind] = createSignal(null); // 'move' | 'files' | null
  const [insertMenu, setInsertMenu] = createSignal(null); // { gap, left, top }
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewW, setViewW] = createSignal(800);
  const [viewH, setViewH] = createSignal(500);
  const [busy, setBusy] = createSignal(false);
  // Page setup of new blank pages (#846); kept in the preferences.
  const [blankSetup, setBlankSetup] = createSignal(normalizeBlankSetup(state.preferences?.pageOrganizerBlankSetup));
  const [setupOpen, setSetupOpen] = createSignal(false);
  let setupChanged = false;

  // Added PDFs: id -> { bytes, name, pageCount, pdf } (pdf: pdf.js document
  // for the thumbnails). Names for the labels in a signal.
  const sources = {};
  const [sourceNames, setSourceNames] = createSignal({});
  const [fileThumbs, setFileThumbs] = createStore({});
  let gridRef;
  let setupRef;
  let setupToggleRef;
  let pointerDrag;
  let dragFrame = null;
  let dragPoint = null;
  let closed = false;

  const tile = () => ZOOM_LEVELS[zoom()];
  const layout = createMemo(() => gridLayout({ width: viewW(), tile: tile(), count: entries().length }));
  const range = createMemo(() => visibleRange(layout(), scrollTop(), viewH()));
  const visible = createMemo(() => entries().slice(range().start, range().end));
  const indexOfKey = createMemo(() => new Map(entries().map((e, i) => [e.key, i])));
  const indexOf = (key) => indexOfKey().get(key) ?? -1;
  const selectedKeys = () => keysOf(plan()).filter((k) => selected().has(k));
  const hasSelection = () => selectedKeys().length > 0;
  const changed = createMemo(() => !isPlanUnchanged(plan(), total));
  const parts = createMemo(() => splitRanges(plan()).length);
  const aspect = () => { const s = placeholderSize(); return s.height > 0 ? s.width / s.height : 0.707; };

  const sourceInfo = () => Object.fromEntries(Object.entries(sources).map(([id, s]) => [id, s]));

  // ── Closing ────────────────────────────────────────────────────────────────

  const release = () => {
    closed = true;
    for (const s of Object.values(sources)) { try { s.pdf?.destroy?.(); } catch { /* already gone */ } }
  };
  const close = () => { release(); closeDialog('page-organizer'); };

  const apply = async () => {
    if (busy()) return;
    const p = plan();
    const active = getActiveDocument();
    // The organizer was opened on this document with this many pages.
    if (!active || active !== doc || active.pdfDoc?.numPages !== total || isPlanUnchanged(p, total)) { close(); return; }
    const ranges = splitRanges(p);
    let folder = '';
    const platform = await import('../../../core/platform.js');
    if (ranges.length && platform.isTauri()) {
      folder = await platform.openFolderDialog(t('pageOrganizer.chooseFolder'));
      if (!folder) return; // stay open: nothing has happened yet
    }
    setBusy(true);
    const bronnen = sourceInfo();
    closeDialog('page-organizer');
    try {
      if (!isStructureUnchanged(p, total)) {
        const { applyPageEdits } = await import('../../../pdf/page-manager.js');
        const ok = await applyPageEdits(p, { sources: bronnen });
        if (!ok) return;
      }
      if (ranges.length) {
        const [{ splitsDocument }, { standaardPatroon }] = await Promise.all([
          import('../../../pdf/splits-app.js'), import('../../../pdf/splits-logica.js'),
        ]);
        await splitsDocument({ modus: 'ranges', delen: ranges, map: folder, patroon: standaardPatroon('pages') });
      }
    } finally {
      release();
    }
  };

  // ── Selection ──────────────────────────────────────────────────────────────

  const selectOnly = (key) => {
    setSelected(new Set([key]));
    setAnchor(key);
    setFocusKey(key);
  };
  const selectKeys = (keys) => {
    if (!keys.length) return;
    setSelected(new Set(keys));
    setAnchor(keys[0]);
    setFocusKey(keys[0]);
  };
  const toggleKey = (key) => {
    const next = new Set(selected());
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
    setAnchor(key);
    setFocusKey(key);
  };

  const handleTileClick = (e, key) => {
    setInsertMenu(null);
    gridRef?.focus();
    if (e.shiftKey) {
      const r = rangeInOrder(keysOf(plan()), anchor(), key);
      setSelected(e.ctrlKey || e.metaKey ? new Set([...selected(), ...r]) : new Set(r));
      setFocusKey(key);
    } else if (e.ctrlKey || e.metaKey) {
      toggleKey(key);
    } else {
      selectOnly(key);
    }
  };

  // ── Scrolling and zoom ─────────────────────────────────────────────────────

  const scrollToKey = (key) => {
    queueMicrotask(() => {
      const i = indexOf(key);
      if (!gridRef || i < 0) return;
      const top = scrollTopFor(layout(), i, gridRef.scrollTop, gridRef.clientHeight);
      if (top != null) gridRef.scrollTop = top;
    });
  };

  const setZoomKeepingFocus = (index) => {
    setZoom(clampZoomIndex(index));
    scrollToKey(focusKey());
  };

  const handleWheel = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    setZoomKeepingFocus(zoomStep(zoom(), e.deltaY < 0 ? 1 : -1));
  };

  // ── Pending operations ─────────────────────────────────────────────────────

  const afterEdit = () => { gridRef?.focus(); scrollToKey(focusKey()); };

  const rotate = (keys, delta) => {
    if (!keys.length) return;
    commit(rotateEntries(plan(), keys, delta));
    afterEdit();
  };

  const remove = (keys) => {
    if (!keys.length) return;
    const { plan: next, refused } = deleteEntries(plan(), keys);
    if (refused) {
      // A document keeps at least one page.
      showMessage(tCommon('cannotDeleteAllPages'));
      return;
    }
    const i = Math.min(...keys.map(indexOf).filter((n) => n >= 0));
    commit(next);
    const stay = next.entries[Math.min(i, next.entries.length - 1)];
    if (stay) selectOnly(stay.key);
    afterEdit();
  };

  const moveBy = (delta) => {
    if (!hasSelection()) return;
    commit(moveEntriesBy(plan(), selectedKeys(), delta));
    afterEdit();
  };
  const moveToEdge = (edge) => {
    if (!hasSelection()) return;
    commit(moveEntriesToEdge(plan(), selectedKeys(), edge));
    afterEdit();
  };

  const toggleSplitAt = (gap) => { commit(toggleSplit(plan(), gap)); gridRef?.focus(); };
  const splitSelection = () => { if (hasSelection()) { commit(splitAroundSelection(plan(), selectedKeys())); gridRef?.focus(); } };

  const extract = async () => {
    const keys = selectedKeys();
    if (!keys.length) return;
    const { extractPlannedPages } = await import('../../../pdf/page-manager.js');
    await extractPlannedPages(plan(), keys, { sources: sourceInfo() });
    gridRef?.focus();
  };

  // The gap after the focused (or last selected) entry, else the end.
  const insertionGap = () => {
    const idx = selectedKeys().map(indexOf).filter((n) => n >= 0);
    return idx.length ? Math.max(...idx) + 1 : entries().length;
  };

  // The size an entry shows now: its effective page box (pdf.js view: the
  // CropBox within the MediaBox), turned by /Rotate, the app rotation and
  // its pending turn. Null when it cannot be measured.
  const measureEntry = async (e) => {
    try {
      if (!e) return null;
      if (e.kind === 'blank') return shownEntrySize(e);
      if (e.kind === 'page') {
        const page = await doc.pdfDoc.getPage(e.page);
        return shownEntrySize(e, { view: page.view, rotate: page.rotate, appRotation: doc.pageRotations?.[e.page] || 0 });
      }
      const src = sources[e.source];
      if (!src?.pdf) return null;
      const page = await src.pdf.getPage(e.index + 1);
      return shownEntrySize(e, { view: page.view, rotate: page.rotate });
    } catch (err) {
      console.warn('[edit-pages] could not measure the adjacent page', err);
      return null;
    }
  };

  // A new blank page gets its size now, from the page setup: the thumbnail
  // and the page Apply writes are exactly that size.
  const addBlank = async (gap) => {
    setInsertMenu(null);
    const setup = blankSetup();
    const adjacent = setup.mode === 'adjacent' ? await measureEntry(adjacentEntry(entries(), gap)) : null;
    if (closed) return;
    const { plan: next, keys } = insertBlank(plan(), gap, 1, blankSizeFromSetup(setup, adjacent));
    commit(next);
    selectKeys(keys);
    afterEdit();
  };

  const changeSetup = (next) => {
    if (next === blankSetup()) return;
    setBlankSetup(next);
    setupChanged = true;
  };
  const persistSetup = () => {
    if (!setupChanged || !state.preferences) return;
    setupChanged = false;
    try {
      state.preferences.pageOrganizerBlankSetup = { ...blankSetup() };
      savePreferences();
    } catch (err) {
      console.warn('[edit-pages] could not save the blank page setup', err);
    }
  };
  const closeSetup = (focusToggle = false) => {
    if (!setupOpen()) return;
    setSetupOpen(false);
    persistSetup();
    if (focusToggle) setupToggleRef?.focus();
  };
  const setupChoice = () => { const s = blankSetup(); return s.mode === 'preset' ? s.preset : s.mode; };
  const chooseSetup = (value) => {
    const s = blankSetup();
    if (value === 'adjacent' || value === 'custom') { changeSetup(withMode(s, value)); return; }
    changeSetup({ ...s, mode: 'preset', preset: value, orientation: setupOrientation(s) || s.orientation });
  };
  const setCustomSide = (side, text) => {
    const v = parseFloat(text);
    if (!(v > 0)) return;
    changeSetup({ ...blankSetup(), [side]: v });
  };
  // The resulting size, shown under the controls.
  const setupSummary = () => {
    const s = blankSetup();
    if (s.mode === 'adjacent') return '';
    const { width, height } = blankSizeFromSetup(s);
    const unit = s.mode === 'custom' ? s.unit : (BLANK_PRESETS[s.preset]?.unit || 'mm');
    return `${fromPoints(width, unit)} × ${fromPoints(height, unit)} ${unit}`;
  };
  const handleSetupKeyDown = (e) => {
    // Keys typed here are not for the document behind the organizer.
    if (e.key !== 'Tab') e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeSetup(true); }
  };
  createEffect(() => {
    if (!setupOpen()) return;
    const outside = (e) => {
      if (setupRef?.contains(e.target) || setupToggleRef?.contains(e.target)) return;
      closeSetup();
    };
    document.addEventListener('pointerdown', outside, true);
    onCleanup(() => document.removeEventListener('pointerdown', outside, true));
  });

  // Reads an added PDF (pdf.js: page count and thumbnails) and inserts all
  // its pages in `gap`. Returns the gap after them.
  const addSource = async (name, bytes, gap) => {
    try {
      const [pdfjs, { pdfjsBronnen }] = await Promise.all([import('pdfjs-dist'), import('../../../core/basis-url.js')]);
      const pdf = await pdfjs.getDocument({ data: bytes.slice(), ...pdfjsBronnen(), isEvalSupported: false, verbosity: 0 }).promise;
      if (closed) { pdf.destroy(); return gap; }
      if (!pdf.numPages) { pdf.destroy(); return gap; }
      const id = `s${++bronTeller}`;
      sources[id] = { bytes, name, pageCount: pdf.numPages, pdf };
      setSourceNames({ ...sourceNames(), [id]: String(name).split(/[\\/]/).pop() });
      const { plan: next, keys } = insertSource(plan(), gap, id, pdf.numPages);
      commit(next);
      selectKeys(keys);
      scrollToKey(keys[0]);
      return gap + keys.length;
    } catch (e) {
      console.warn('[edit-pages] could not read', name, e);
      showMessage(t('pageOrganizer.fileFailed', { name: String(name).split(/[\\/]/).pop(), error: e?.message ?? String(e) }));
      return gap;
    }
  };

  const isPdfName = (name) => /\.pdf$/i.test(String(name || ''));

  const addFromPaths = async (paths, gap) => {
    const platform = await import('../../../core/platform.js');
    let g = gap;
    for (const path of paths.filter(isPdfName)) {
      try {
        if (platform.isTauri()) {
          try { await window.__TAURI__?.core?.invoke?.('allow_fs_scope', { path }); } catch { /* scope already open */ }
        }
        const data = await platform.readBinaryFile(path);
        if (data) g = await addSource(path, new Uint8Array(data), g);
      } catch (e) {
        showMessage(t('pageOrganizer.fileFailed', { name: String(path).split(/[\\/]/).pop(), error: e?.message ?? String(e) }));
      }
    }
    gridRef?.focus();
  };

  const addFromFile = async (gap) => {
    setInsertMenu(null);
    const { openFileDialog } = await import('../../../core/platform.js');
    const picked = await openFileDialog(['pdf'], { multiple: true });
    if (!picked) return;
    await addFromPaths(Array.isArray(picked) ? picked : [picked], gap);
  };

  const undo = () => { setHistory(undoHistory(history())); gridRef?.focus(); };
  const redo = () => { setHistory(redoHistory(history())); gridRef?.focus(); };

  // ── Keyboard ───────────────────────────────────────────────────────────────

  // Arrows move the focus (Shift extends the selection), Ctrl+arrow moves the
  // selected pages, Ctrl+Home/End to the start/end; Delete deletes, [ and ]
  // rotate, Ctrl+Z / Ctrl+Y undo and redo the pending edits, Ctrl+plus/minus
  // zoom. While the grid has the focus its keys stay here: the document-wide
  // shortcuts must not act on the document behind the organizer. Escape and
  // Tab still reach the dialog.
  const handleKeyDown = (e) => {
    if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
    if (e.key === 'Escape' && pointerDrag?.isDragging()) { e.preventDefault(); e.stopPropagation(); pointerDrag.cancel(); return; }
    if (e.key === 'Escape' && insertMenu()) { e.stopPropagation(); setInsertMenu(null); return; }
    const list = keysOf(plan());
    if (!list.length) return;
    const key = e.key;
    const lower = (key || '').toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && lower === 'a') { e.preventDefault(); setSelected(new Set(list)); return; }
    if (ctrl && lower === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (ctrl && (lower === 'y' || (lower === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (ctrl && (key === '+' || key === '=')) { e.preventDefault(); setZoomKeepingFocus(zoom() + 1); return; }
    if (ctrl && key === '-') { e.preventDefault(); setZoomKeepingFocus(zoom() - 1); return; }
    if (ctrl && (key === 'ArrowLeft' || key === 'ArrowUp')) { e.preventDefault(); moveBy(-1); return; }
    if (ctrl && (key === 'ArrowRight' || key === 'ArrowDown')) { e.preventDefault(); moveBy(1); return; }
    if (ctrl && key === 'Home') { e.preventDefault(); moveToEdge('start'); return; }
    if (ctrl && key === 'End') { e.preventDefault(); moveToEdge('end'); return; }
    if (key === 'Delete') { e.preventDefault(); remove(selectedKeys()); return; }
    if (key === '[') { e.preventDefault(); rotate(selectedKeys(), -90); return; }
    if (key === ']') { e.preventDefault(); rotate(selectedKeys(), 90); return; }
    const at = Math.max(0, list.indexOf(focusKey()));
    let to = null;
    if (key === 'ArrowLeft') to = Math.max(0, at - 1);
    else if (key === 'ArrowRight') to = Math.min(list.length - 1, at + 1);
    else if (key === 'ArrowUp') to = stepRow(at, list.length, layout().columns, -1);
    else if (key === 'ArrowDown') to = stepRow(at, list.length, layout().columns, 1);
    else if (key === 'Home') to = 0;
    else if (key === 'End') to = list.length - 1;
    else if (key === ' ') { e.preventDefault(); toggleKey(focusKey()); return; }
    if (to == null) return;
    e.preventDefault();
    const k = list[to];
    if (e.shiftKey) {
      setSelected(new Set(rangeInOrder(list, anchor(), k)));
      setFocusKey(k);
    } else {
      selectOnly(k);
    }
    scrollToKey(k);
  };

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const contentPoint = (clientX, clientY) => {
    const r = gridRef.getBoundingClientRect();
    return { x: clientX - r.left + gridRef.scrollLeft, y: clientY - r.top + gridRef.scrollTop, inside: clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom };
  };

  // Near the top or bottom edge a drag scrolls the grid.
  const autoScroll = (clientY) => {
    const r = gridRef.getBoundingClientRect();
    if (clientY < r.top + 30) gridRef.scrollTop -= 20;
    else if (clientY > r.bottom - 30) gridRef.scrollTop += 20;
  };

  const updatePointerGap = (point) => {
    const { x, y, inside } = contentPoint(point.clientX, point.clientY);
    const gap = gapAtPoint(layout(), x, y);
    setDropGap(!inside || isNoOpGap(keysOf(plan()), selectedKeys(), gap) ? null : gap);
  };
  const scrollDrag = () => {
    if (!dragPoint) return;
    if (contentPoint(dragPoint.clientX, dragPoint.clientY).inside) autoScroll(dragPoint.clientY);
    updatePointerGap(dragPoint);
    dragFrame = requestAnimationFrame(scrollDrag);
  };
  const stopPointerScroll = () => {
    if (dragFrame != null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
    dragPoint = null;
  };

  const draggingFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  const handleDragOver = (e) => {
    if (pointerDrag?.isDragging() || !draggingFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragKind('files');
    autoScroll(e.clientY);
    const { x, y } = contentPoint(e.clientX, e.clientY);
    const g = gapAtPoint(layout(), x, y);
    setDropGap(g);
    try { e.dataTransfer.dropEffect = 'copy'; } catch { /* read-only in some engines */ }
  };

  const endDrag = () => {
    setDragKind(null);
    setDropGap(null);
  };

  const handleDrop = async (e) => {
    if (pointerDrag?.isDragging() || !draggingFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = contentPoint(e.clientX, e.clientY);
    const g = gapAtPoint(layout(), x, y);
    endDrag();
    // An external PDF (browser): its pages go in at the drop position.
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => isPdfName(f.name));
    let at = g;
    for (const f of files) at = await addSource(f.name, new Uint8Array(await f.arrayBuffer()), at);
    gridRef?.focus();
  };

  const handleDragLeave = (e) => {
    // Only when the pointer leaves the grid itself, not when it crosses tiles.
    if (!gridRef || gridRef.contains(e.relatedTarget)) return;
    setDropGap(null);
    if (dragKind() === 'files') setDragKind(null);
  };

  // ── Thumbnails ─────────────────────────────────────────────────────────────

  // The document's own pages come from the thumbnails panel; the pages in
  // view go first.
  let prioTimer = null;
  createEffect(() => {
    const pages = visible().filter((e) => e.kind === 'page' && !thumbnailData[String(e.page)]).map((e) => e.page);
    if (!pages.length) return;
    clearTimeout(prioTimer);
    prioTimer = setTimeout(async () => {
      try {
        const { prioritizeThumbnails } = await import('../../../ui/panels/left-panel.js');
        prioritizeThumbnails(pages);
      } catch { /* no thumbnails panel */ }
    }, 120);
  });

  // Pages of added PDFs: drawn here, one at a time, only when in view.
  const rendering = new Set();
  let renderQueue = Promise.resolve();
  createEffect(() => {
    for (const e of visible()) {
      if (e.kind !== 'file' || untrack(() => fileThumbs[e.key]) || rendering.has(e.key)) continue;
      const src = sources[e.source];
      if (!src?.pdf) continue;
      rendering.add(e.key);
      renderQueue = renderQueue.then(async () => {
        if (closed) return;
        try {
          const page = await src.pdf.getPage(e.index + 1);
          const base = page.getViewport({ scale: 1 });
          const scale = 240 / Math.max(base.width, base.height);
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(vp.width));
          canvas.height = Math.max(1, Math.round(vp.height));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          if (!closed) setFileThumbs(e.key, canvas.toDataURL('image/jpeg', 0.75));
        } catch (err) {
          console.warn('[edit-pages] thumbnail of an added page failed', err);
        }
      });
    }
  });

  const thumbFor = (e) => {
    if (e.kind === 'page') return thumbnailData[String(e.page)]?.dataURL || null;
    if (e.kind === 'file') return fileThumbs[e.key] || null;
    return null;
  };

  const labelFor = (e) => {
    if (e.kind === 'page') return labelVan(doc?.pageLabels, e.page);
    if (e.kind === 'blank') return t('pageOrganizer.blankPage');
    return `${sourceNames()[e.source] || ''} · ${e.index + 1}`;
  };
  // Tooltip: a blank page also tells its size.
  const titleFor = (e) => {
    if (e.kind !== 'blank' || !(e.width > 0 && e.height > 0)) return labelFor(e);
    const unit = blankSetup().unit;
    return `${labelFor(e)} (${fromPoints(e.width, unit)} × ${fromPoints(e.height, unit)} ${unit})`;
  };
  // A thumbnail without an image: a blank page in its own proportions, a
  // page that is not drawn yet in those of the thumbnails panel.
  const emptyThumbStyle = (e) => {
    const box = e.kind === 'blank' ? thumbBox(e, tile()) : null;
    return {
      width: `${box ? box.width : Math.round(tile() * 0.92 * aspect())}px`,
      height: `${box ? box.height : Math.round(tile() * 0.92)}px`,
      transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
    };
  };

  // ── Desktop file drops (setup.js routes them here while open) ───────────────

  onMount(() => {
    const measure = () => {
      if (!gridRef) return;
      setViewW(gridRef.clientWidth);
      setViewH(gridRef.clientHeight);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(gridRef);
    }
    pointerDrag = createOrganizerPointerDrag(gridRef, {
      keyAt(target) {
        if (busy() || target.closest?.('button, input, select, a')) return null;
        const tile = target.closest?.('.page-organizer-tile');
        return tile && gridRef.contains(tile) ? tile.dataset.key : null;
      },
      start(key) {
        if (!selected().has(key)) selectOnly(key);
        setInsertMenu(null);
        setDragKind('move');
        gridRef.focus();
      },
      move(event) {
        dragPoint = { clientX: event.clientX, clientY: event.clientY };
        updatePointerGap(dragPoint);
        if (dragFrame == null) dragFrame = requestAnimationFrame(scrollDrag);
      },
      finish(event) {
        stopPointerScroll();
        if (!event.cancelled) updatePointerGap(event);
        const gap = event.cancelled ? null : dropGap();
        endDrag();
        if (gap != null) {
          commit(moveEntriesToGap(plan(), selectedKeys(), gap));
          scrollToKey(focusKey());
        }
      },
    });
    const unregister = setPageDropTarget({
      over(x, y) {
        if (!gridRef || pointerDrag.isDragging()) return;
        const p = contentPoint(x, y);
        setDragKind('files');
        setDropGap(p.inside ? gapAtPoint(layout(), p.x, p.y) : entries().length);
      },
      leave() { if (!pointerDrag.isDragging()) endDrag(); },
      async drop(paths, x, y) {
        if (pointerDrag.isDragging()) return;
        const p = gridRef ? contentPoint(x, y) : { inside: false };
        const g = p.inside ? gapAtPoint(layout(), p.x, p.y) : entries().length;
        endDrag();
        await addFromPaths(paths, g);
      },
    });
    onCleanup(() => {
      persistSetup();
      pointerDrag.destroy();
      stopPointerScroll();
      unregister();
      ro?.disconnect();
      clearTimeout(prioTimer);
      if (!closed) release();
    });
    gridRef?.focus();
    scrollToKey(focusKey());
  });

  // ── View ───────────────────────────────────────────────────────────────────

  const gapsInView = createMemo(() => {
    const { start, end } = range();
    const out = [];
    for (let g = start; g <= end; g++) out.push(g);
    return out;
  });

  const openInsertMenu = (e, gap) => {
    e.stopPropagation();
    const c = cellPosition(layout(), gap);
    setInsertMenu(insertMenu()?.gap === gap ? null : { gap, left: c.left + GUTTER - 2, top: c.top + 20 });
  };

  const footer = (
    <>
      <div class="page-organizer-status">
        {t('pageOrganizer.selection', { selected: selectedKeys().length, total: entries().length })}
        <Show when={parts() > 0}>{' · '}{t('pageOrganizer.parts', { count: parts() })}</Show>
      </div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" id="page-organizer-apply" disabled={!changed() || busy()} onClick={apply}>{tCommon('apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  const ToolButton = (p) => (
    <button class="page-organizer-btn" id={p.id} disabled={p.disabled} title={p.title || p.label} onClick={p.onClick}>
      <Show when={p.icon}><span class="page-organizer-btn-icon" innerHTML={p.icon} /></Show>
      {p.label}
    </button>
  );

  return (
    <Dialog
      title={t('pageOrganizer.title')}
      overlayClass="page-organizer-overlay"
      dialogClass="page-organizer-dialog"
      bodyClass="page-organizer-body"
      onClose={close}
      footer={footer}
    >
      <div class="page-organizer-toolbar">
        <ToolButton id="page-organizer-undo" label={tCommon('undo')} title={`${tCommon('undo')} (Ctrl+Z)`} disabled={!history().past.length} onClick={undo} />
        <ToolButton id="page-organizer-redo" label={tCommon('redo')} title={`${tCommon('redo')} (Ctrl+Y)`} disabled={!history().future.length} onClick={redo} />
        <span class="page-organizer-sep" />
        <ToolButton id="page-organizer-rotate-left" icon={ICON.rotateLeft} label={t('pageOrganizer.rotateLeft')} title={`${t('pageOrganizer.rotateLeft')} ([)`} disabled={!hasSelection()} onClick={() => rotate(selectedKeys(), -90)} />
        <ToolButton id="page-organizer-rotate-right" icon={ICON.rotateRight} label={t('pageOrganizer.rotateRight')} title={`${t('pageOrganizer.rotateRight')} (])`} disabled={!hasSelection()} onClick={() => rotate(selectedKeys(), 90)} />
        <ToolButton id="page-organizer-delete" icon={ICON.delete} label={tCommon('delete')} title={`${tCommon('delete')} (Del)`} disabled={!hasSelection()} onClick={() => remove(selectedKeys())} />
        <ToolButton id="page-organizer-extract" label={tCommon('extract')} title={t('pageOrganizer.extractTitle')} disabled={!hasSelection()} onClick={extract} />
        <ToolButton id="page-organizer-split" icon={ICON.split} label={t('pageOrganizer.split')} title={t('pageOrganizer.splitTitle')} disabled={!hasSelection()} onClick={splitSelection} />
        <span class="page-organizer-sep" />
        <span class="page-organizer-blank-group">
          <ToolButton id="page-organizer-insert-blank" icon={ICON.insert} label={t('pageOrganizer.blankPage')} onClick={() => addBlank(insertionGap())} />
          <button class="page-organizer-btn page-organizer-setup-toggle" id="page-organizer-blank-setup" ref={setupToggleRef}
            title={t('pageOrganizer.blankSetup')} aria-label={t('pageOrganizer.blankSetup')} aria-haspopup="dialog" aria-expanded={setupOpen()}
            onClick={() => (setupOpen() ? closeSetup() : setSetupOpen(true))}>
            <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
          </button>
          <Show when={setupOpen()}>
            <div class="page-organizer-setup" ref={setupRef} role="dialog" aria-label={t('pageOrganizer.blankSetup')} on:keydown={handleSetupKeyDown}>
              <label class="page-organizer-setup-row">
                <span class="page-organizer-setup-label">{t('insertPage.paperSize')}</span>
                <select class="page-organizer-setup-select" id="page-organizer-blank-size" value={setupChoice()} onChange={(e) => chooseSetup(e.currentTarget.value)}>
                  <option value="adjacent">{t('pageOrganizer.sameAsAdjacent')}</option>
                  <For each={Object.entries(BLANK_PRESETS)}>
                    {([key, p]) => <option value={key}>{`${p.label} (${p.width} × ${p.height} ${p.unit})`}</option>}
                  </For>
                  <option value="custom">{t('newDoc.customSize')}</option>
                </select>
              </label>
              <label class="page-organizer-setup-row">
                <span class="page-organizer-setup-label">{t('insertPage.orientation')}</span>
                <select class="page-organizer-setup-select" id="page-organizer-blank-orientation" disabled={blankSetup().mode === 'adjacent'}
                  value={setupOrientation(blankSetup()) || 'portrait'} onChange={(e) => changeSetup(withOrientation(blankSetup(), e.currentTarget.value))}>
                  <option value="portrait">{t('insertPage.portrait')}</option>
                  <option value="landscape">{t('insertPage.landscape')}</option>
                </select>
              </label>
              <Show when={blankSetup().mode === 'custom'}>
                <label class="page-organizer-setup-row">
                  <span class="page-organizer-setup-label">{t('pageOrganizer.width')}</span>
                  <input type="text" inputmode="decimal" data-getal class="page-organizer-setup-input" id="page-organizer-blank-width"
                    value={blankSetup().width} onInput={(e) => setCustomSide('width', e.currentTarget.value)} />
                </label>
                <label class="page-organizer-setup-row">
                  <span class="page-organizer-setup-label">{t('pageOrganizer.height')}</span>
                  <input type="text" inputmode="decimal" data-getal class="page-organizer-setup-input" id="page-organizer-blank-height"
                    value={blankSetup().height} onInput={(e) => setCustomSide('height', e.currentTarget.value)} />
                </label>
                <label class="page-organizer-setup-row">
                  <span class="page-organizer-setup-label">{t('pageOrganizer.unit')}</span>
                  <select class="page-organizer-setup-select" id="page-organizer-blank-unit" value={blankSetup().unit}
                    onChange={(e) => changeSetup(withUnit(blankSetup(), e.currentTarget.value))}>
                    <option value="mm">mm</option>
                    <option value="in">in</option>
                  </select>
                </label>
              </Show>
              <div class="page-organizer-setup-summary">{setupSummary()}</div>
            </div>
          </Show>
        </span>
        <ToolButton id="page-organizer-insert-file" label={t('pageOrganizer.pagesFromFile')} onClick={() => addFromFile(insertionGap())} />
        <span class="page-organizer-sep" />
        <ToolButton label={t('pageOrganizer.moveToStart')} title={`${t('pageOrganizer.moveToStart')} (Ctrl+Home)`} disabled={!hasSelection()} onClick={() => moveToEdge('start')} />
        <ToolButton label={t('pageOrganizer.moveLeft')} title={`${t('pageOrganizer.moveLeft')} (Ctrl+←)`} disabled={!hasSelection()} onClick={() => moveBy(-1)} />
        <ToolButton label={t('pageOrganizer.moveRight')} title={`${t('pageOrganizer.moveRight')} (Ctrl+→)`} disabled={!hasSelection()} onClick={() => moveBy(1)} />
        <ToolButton label={t('pageOrganizer.moveToEnd')} title={`${t('pageOrganizer.moveToEnd')} (Ctrl+End)`} disabled={!hasSelection()} onClick={() => moveToEdge('end')} />
        <span class="page-organizer-sep" />
        <ToolButton label={tCommon('reset')} disabled={!changed()} onClick={() => { commit(createPlan(total)); selectOnly(startKey); gridRef?.focus(); }} />
        <span class="page-organizer-zoom">
          <button class="page-organizer-btn" title={`${t('pageOrganizer.zoom')} − (Ctrl+−)`} disabled={zoom() === 0} onClick={() => setZoomKeepingFocus(zoom() - 1)}>−</button>
          <input type="range" class="page-organizer-zoom-slider" id="page-organizer-zoom" min="0" max={ZOOM_LEVELS.length - 1} step="1"
            value={zoom()} aria-label={t('pageOrganizer.zoom')} title={`${t('pageOrganizer.zoom')} (Ctrl+wheel)`}
            onInput={(e) => setZoomKeepingFocus(Number(e.currentTarget.value))} />
          <button class="page-organizer-btn" title={`${t('pageOrganizer.zoom')} + (Ctrl++)`} disabled={zoom() === ZOOM_LEVELS.length - 1} onClick={() => setZoomKeepingFocus(zoom() + 1)}>+</button>
        </span>
      </div>
      <div class="page-organizer-hint">{t('pageOrganizer.hint')}</div>
      <div
        class="page-organizer-grid"
        classList={{ 'files-over': dragKind() === 'files' }}
        ref={gridRef}
        tabIndex={0}
        role="listbox"
        aria-multiselectable="true"
        aria-label={t('pageOrganizer.title')}
        on:keydown={handleKeyDown}
        on:wheel={handleWheel}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onClick={(e) => { if (e.target === gridRef || e.target.classList?.contains('page-organizer-canvas')) setInsertMenu(null); }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div class="page-organizer-canvas" style={{ height: `${layout().totalHeight}px`, 'min-width': `${layout().totalWidth}px` }}>
          {/* Gaps: insert (+) on top, split (scissors) below it, the split mark and the drop indicator. */}
          <For each={gapsInView()}>
            {(g) => {
              const pos = () => cellPosition(layout(), g);
              const inner = () => g > 0 && g < entries().length;
              return (
                <div class="page-organizer-gutter" style={{ left: `${pos().left}px`, top: `${pos().top}px`, width: `${GUTTER}px`, height: `${tile()}px` }}>
                  <Show when={hasSplitAt(plan(), g)}><div class="page-organizer-split-mark" /></Show>
                  <Show when={dropGap() === g}><div class="page-organizer-drop-mark" /></Show>
                  <button class="page-organizer-gap-btn" tabIndex={-1} title={t('pageOrganizer.insertHere')}
                    aria-label={t('pageOrganizer.insertHere')} innerHTML={ICON.insert} onClick={(e) => openInsertMenu(e, g)} />
                  <Show when={inner()}>
                    <button class="page-organizer-gap-btn page-organizer-split-btn" classList={{ on: hasSplitAt(plan(), g) }} tabIndex={-1}
                      title={t('pageOrganizer.splitHere')} aria-label={t('pageOrganizer.splitHere')} aria-pressed={hasSplitAt(plan(), g)}
                      innerHTML={ICON.split} onClick={(e) => { e.stopPropagation(); toggleSplitAt(g); }} />
                  </Show>
                </div>
              );
            }}
          </For>
          <For each={visible()}>
            {(e) => {
              const i = () => indexOf(e.key);
              const pos = () => tilePosition(layout(), i());
              const sel = () => selected().has(e.key);
              const src = () => thumbFor(e);
              return (
                <div
                  class="page-organizer-tile"
                  classList={{
                    selected: sel(),
                    focused: focusKey() === e.key,
                    dragging: dragKind() === 'move' && sel(),
                  }}
                  style={{ left: `${pos().left}px`, top: `${pos().top}px`, width: `${tile()}px` }}
                  data-key={e.key}
                  data-page={e.kind === 'page' ? e.page : undefined}
                  role="option"
                  aria-selected={sel()}
                  draggable={false}
                  title={titleFor(e)}
                  onClick={(ev) => handleTileClick(ev, e.key)}
                  onDragStart={(ev) => ev.preventDefault()}
                >
                  <div class="page-organizer-frame" style={{ width: `${tile()}px`, height: `${tile()}px` }}>
                    <Show when={src()} fallback={
                      <div class="page-organizer-thumb page-organizer-thumb-empty" classList={{ blank: e.kind === 'blank' }}
                        style={emptyThumbStyle(e)} />
                    }>
                      <img class="page-organizer-thumb" src={src()} draggable={false} alt=""
                        style={{ transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined }} />
                    </Show>
                    <input type="checkbox" class="page-organizer-check" tabIndex={-1} checked={sel()}
                      aria-label={t('pageOrganizer.select')} title={t('pageOrganizer.select')}
                      onClick={(ev) => { ev.stopPropagation(); toggleKey(e.key); gridRef?.focus(); }} />
                    <div class="page-organizer-actions">
                      <button class="page-organizer-action" tabIndex={-1} title={t('pageOrganizer.rotateLeft')} aria-label={t('pageOrganizer.rotateLeft')}
                        innerHTML={ICON.rotateLeft} onClick={(ev) => { ev.stopPropagation(); rotate([e.key], -90); }} />
                      <button class="page-organizer-action" tabIndex={-1} title={t('pageOrganizer.rotateRight')} aria-label={t('pageOrganizer.rotateRight')}
                        innerHTML={ICON.rotateRight} onClick={(ev) => { ev.stopPropagation(); rotate([e.key], 90); }} />
                      <button class="page-organizer-action page-organizer-action-delete" tabIndex={-1} title={tCommon('delete')} aria-label={tCommon('delete')}
                        innerHTML={ICON.delete} onClick={(ev) => { ev.stopPropagation(); remove([e.key]); }} />
                    </div>
                  </div>
                  <div class="page-organizer-label" style={{ height: `${LABEL_HEIGHT - 4}px` }}>
                    <span class="page-organizer-pos">{i() + 1}</span> {labelFor(e)}
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={insertMenu()}>
            {(m) => (
              <div class="page-organizer-menu" style={{ left: `${m().left}px`, top: `${m().top}px` }} onClick={(e) => e.stopPropagation()}>
                <button class="page-organizer-menu-item" onClick={() => addBlank(m().gap)}>{t('pageOrganizer.blankPage')}</button>
                <button class="page-organizer-menu-item" onClick={() => addFromFile(m().gap)}>{t('pageOrganizer.pagesFromFile')}</button>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
