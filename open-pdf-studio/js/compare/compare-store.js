// Compare/Overlay session store.
// Tracks which two PDFs are being compared, the mode, current page-pair and offset.
// Reactive via solid-js signals so UI re-renders when fields change.

import { createSignal, batch } from 'solid-js';
import { state } from '../core/state.js';
import { normalizeCompareMode } from './split-line.js';
import { IDENTITY_ALIGNMENT, normalizeAlignment } from './alignment.js';
import { DEFAULT_PRESET, normalizePreset } from './detect-plan.js';
import { assignPair } from './page-pairing.js';
import { clearCompareSources } from './compare-sources.js';

const [active, setActive] = createSignal(false);
const [oldPath, setOldPath] = createSignal(null);
const [newPath, setNewPath] = createSignal(null);
const [mode, setMode] = createSignal('overlay'); // 'overlay' | 'side' | 'split'
const [oldPage, setOldPage] = createSignal(1);
const [newPage, setNewPage] = createSignal(1);
// Aantal pagina's per document, zodat pagina-navigatie binnen de grenzen
// blijft. Zonder deze grens liep nextPagePair ongelimiteerd door: de render
// klemt intern naar de laatste pagina, dus je bleef "vooruit" klikken terwijl
// dezelfde laatste pagina zichtbaar bleef en de teller doorliep. Documenten
// mogen verschillende paginaaantallen hebben — elk kent zijn eigen maximum.
const [oldPageCount, setOldPageCount] = createSignal(1);
const [newPageCount, setNewPageCount] = createSignal(1);
// Alignment of the current pair (alignment.js): dx/dy in mm on paper,
// rotation in degrees and a scale factor, about the page centres.
const [offset, setOffset] = createSignal({ ...IDENTITY_ALIGNMENT });
// How the current alignment came about: { source: 'none'|'auto'|'manual',
// confidence: 0..1|null, method?: string }. `pending` is true while the
// automatic alignment for this pair has still to run.
const [alignInfo, setAlignInfoSignal] = createSignal({ source: 'none', confidence: null });
const [alignPending, setAlignPendingSignal] = createSignal(false);
// Align each new pair automatically on its first visit.
const [autoAlign, setAutoAlignSignal] = createSignal(true);
// Sensitivity preset (detect-plan.js): 'line' | 'scan' | 'text'.
const [preset, setPresetSignal] = createSignal(DEFAULT_PRESET);
// Page pairing list (page-pairing.js); empty = index-based pairs.
const [pairs, setPairsSignal] = createSignal([]);
const [pairing, setPairingSignal] = createSignal(false);
// The detection had to stop early (too many differences on this pair).
const [truncated, setTruncatedSignal] = createSignal(false);
// Comparison method: 'pixel', or 'vector' where both pages are vector
// drawings (pixel stays the fallback). methodUsed: what the last detection
// of the current pair actually used.
const [method, setMethodSignal] = createSignal('pixel');
const [methodUsed, setMethodUsedSignal] = createSignal('pixel');
const [zoom, setZoom] = createSignal(1);
const [changes, setChangesSignal] = createSignal([]);
const [focusedChange, setFocusedChangeSignal] = createSignal(null);
// Waar terwijl de verschildetectie voor het huidige paar nog loopt. De UI kan
// dan "…" tonen i.p.v. een verouderde of misleidende teller.
const [detecting, setDetectingSignal] = createSignal(false);
const [showAdded, setShowAdded] = createSignal(true);
const [showRemoved, setShowRemoved] = createSignal(true);
const [showModified, setShowModified] = createSignal(true);
// Highlight style toggles: filled box and/or contour outline. Both on by default.
const [showBox, setShowBox] = createSignal(true);
const [showContour, setShowContour] = createSignal(true);
// True when the compare TAB is the currently-shown view (vs. a normal PDF tab).
// The compare session stays "active" while a PDF tab is focused; this flag just
// controls whether the compare view is on screen.
const [focused, setFocused] = createSignal(false);
// Bumped as a counter to request a "fit page to viewport" recalculation. The
// view watches this signal and, on change, re-fits the zoom to the current
// container size. Carries the desired kind: 'fit' (fill the pane) or 'reset'
// (jump to exactly 100%). We use {kind,seq} so two consecutive identical
// requests still trigger the effect.
const [fitRequest, setFitRequest] = createSignal({ kind: null, seq: 0 });
// Rechterpaneel-tab: 'changes' (visuele wijzigingen) of 'text' (tekst-diff).
const [panelTab, setPanelTabSignal] = createSignal('changes');
// Tekstvergelijkings-resultaat: null = nog niet uitgevoerd voor dit paar.
const [textChanges, setTextChangesSignal] = createSignal(null);
const [textComparing, setTextComparingSignal] = createSignal(false);

export {
  active as compareActive,
  oldPath as compareOldPath,
  newPath as compareNewPath,
  mode as compareMode,
  oldPage as compareOldPage,
  newPage as compareNewPage,
  oldPageCount as compareOldPageCount,
  newPageCount as compareNewPageCount,
  offset as compareOffset,
  zoom as compareZoom,
  changes as compareChanges,
  focusedChange as compareFocusedChange,
  showAdded as compareShowAdded,
  showRemoved as compareShowRemoved,
  showModified as compareShowModified,
  setShowAdded as setCompareShowAdded,
  setShowRemoved as setCompareShowRemoved,
  setShowModified as setCompareShowModified,
  showBox as compareShowBox,
  showContour as compareShowContour,
  setShowBox as setCompareShowBox,
  setShowContour as setCompareShowContour,
  focused as compareFocused,
  fitRequest as compareFitRequest,
  detecting as compareDetecting,
  panelTab as comparePanelTab,
  textChanges as compareTextChanges,
  textComparing as compareTextComparing,
  alignInfo as compareAlignInfo,
  alignPending as compareAlignPending,
  autoAlign as compareAutoAlign,
  preset as comparePreset,
  pairs as comparePairs,
  pairing as comparePairing,
  truncated as compareTruncated,
  method as compareMethod,
  methodUsed as compareMethodUsed,
};

export function setCompareMethod(m) {
  setMethodSignal(m === 'vector' ? 'vector' : 'pixel');
}
export function setCompareMethodUsed(m) {
  setMethodUsedSignal(m === 'vector' ? 'vector' : 'pixel');
}

// Alignments per page pair, so returning to a pair keeps what was found or
// typed there. Key: `${oldPage}|${newPage}`.
const _pairAlign = new Map();
const _pairKey = (o, n) => `${o}|${n}`;

export function compareCurrentPairKey() {
  return _pairKey(oldPage(), newPage());
}

function _loadPairAlignment() {
  const stored = _pairAlign.get(_pairKey(oldPage(), newPage()));
  batch(() => {
    if (stored) {
      setOffset({ ...stored.alignment });
      setAlignInfoSignal({ source: stored.source, confidence: stored.confidence ?? null, method: stored.method });
      setAlignPendingSignal(false);
    } else {
      setOffset({ ...IDENTITY_ALIGNMENT });
      setAlignInfoSignal({ source: 'none', confidence: null });
      setAlignPendingSignal(!!autoAlign());
    }
  });
}

/** Stored alignment of a pair, or null. */
export function getPairAlignment(o, n) {
  const s = _pairAlign.get(_pairKey(o, n));
  return s ? { ...s, alignment: { ...s.alignment } } : null;
}

/**
 * Result of an automatic alignment (compare-viewport.js). Stored for its pair;
 * applied when that pair is still the current one.
 */
export function applyAutoAlignment(o, n, result) {
  if (!result || !result.alignment) return;
  const entry = {
    alignment: normalizeAlignment(result.alignment),
    source: 'auto',
    confidence: Number.isFinite(result.confidence) ? result.confidence : null,
    method: result.method,
  };
  _pairAlign.set(_pairKey(o, n), entry);
  if (o !== oldPage() || n !== newPage()) return;
  batch(() => {
    setOffset({ ...entry.alignment });
    setAlignInfoSignal({ source: 'auto', confidence: entry.confidence, method: entry.method });
    setAlignPendingSignal(false);
  });
}

/** The automatic alignment could not run (no ink, worker failure). */
export function cancelAutoAlignment(o, n) {
  if (o !== oldPage() || n !== newPage()) return;
  setAlignPendingSignal(false);
}

/** "Align automatically" for the current pair. */
export function requestAutoAlign() {
  _pairAlign.delete(_pairKey(oldPage(), newPage()));
  batch(() => {
    setAlignInfoSignal({ source: 'none', confidence: null });
    setAlignPendingSignal(true);
  });
}

/** Back to no alignment (identity) for the current pair. */
export function resetCompareAlignment() {
  const entry = { alignment: { ...IDENTITY_ALIGNMENT }, source: 'manual', confidence: null };
  _pairAlign.set(_pairKey(oldPage(), newPage()), entry);
  batch(() => {
    setOffset({ ...IDENTITY_ALIGNMENT });
    setAlignInfoSignal({ source: 'manual', confidence: null });
    setAlignPendingSignal(false);
  });
}

export function setCompareAutoAlign(v) {
  setAutoAlignSignal(!!v);
  if (v && alignInfo().source === 'none') setAlignPendingSignal(true);
}

export function setComparePreset(name) {
  setPresetSignal(normalizePreset(name));
}

export function setCompareTruncated(v) {
  setTruncatedSignal(!!v);
}

export function setComparePairing(v) {
  setPairingSignal(!!v);
}

// ── Pairing list ──────────────────────────────────────────────────────────
// With a pairing list, previous/next walk its matched pairs; without one the
// historic index-based stepping below applies.
let _cursor = -1;

function _matched() {
  return pairs().filter((p) => p.old != null && p.new != null);
}

function _gotoCursor(i) {
  const list = _matched();
  if (!list.length) return false;
  _cursor = Math.max(0, Math.min(list.length - 1, i));
  batch(() => {
    setOldPage(_clampOld(list[_cursor].old));
    setNewPage(_clampNew(list[_cursor].new));
    _resetPairDiff();
    _loadPairAlignment();
  });
  return true;
}

/** Index of the current pair in the matched pairs, or -1. */
export function compareMatchedIndex() {
  pairs();
  oldPage();
  newPage();
  const list = _matched();
  return list.findIndex((p) => p.old === oldPage() && p.new === newPage());
}

export function compareMatchedCount() {
  return _matched().length;
}

/**
 * Install a pairing list. The view stays on the current pair when it is in
 * the list, else moves to the pair of the current new (or old) page.
 */
export function setComparePairs(rows) {
  setPairsSignal(Array.isArray(rows) ? rows.slice() : []);
  const list = _matched();
  if (!list.length) { _cursor = -1; return; }
  let i = list.findIndex((p) => p.old === oldPage() && p.new === newPage());
  if (i < 0) i = list.findIndex((p) => p.new === newPage());
  if (i < 0) i = list.findIndex((p) => p.old === oldPage());
  if (i < 0) i = 0;
  const cur = list[i];
  if (cur.old === oldPage() && cur.new === newPage()) { _cursor = i; return; }
  _gotoCursor(i);
}

/** Correct the pairing: pair old page `o` with new page `n` (null unpairs). */
export function assignComparePair(o, n) {
  setPairsSignal(assignPair(pairs(), o, n));
  if (o != null && n != null) {
    const i = _matched().findIndex((p) => p.old === o && p.new === n);
    if (i >= 0) _gotoCursor(i);
  }
}

/** Show a row of the pairing list (a matched pair). */
export function gotoComparePair(o, n) {
  const i = _matched().findIndex((p) => p.old === o && p.new === n);
  if (i >= 0) _gotoCursor(i);
}

export function setComparePanelTab(tab) {
  setPanelTabSignal(tab === 'text' ? 'text' : 'changes');
}
export function setCompareTextChanges(list) {
  setTextChangesSignal(Array.isArray(list) ? list : null);
}
export function setCompareTextComparing(v) {
  setTextComparingSignal(!!v);
}

// Detectie-status (gezet door compare-viewport rond scheduleChangeDetection).
export function setCompareDetecting(v) {
  setDetectingSignal(!!v);
}

// Bring the compare tab to the front (show the compare view).
export function focusCompareTab() { if (active()) setFocused(true); }
// Send the compare tab to the back (a normal PDF tab is shown instead). The
// compare session stays alive so switching back is instant.
export function blurCompareTab() { setFocused(false); }

// Request the view to fit the page(s) to the available space.
export function requestCompareFit() {
  setFitRequest((r) => ({ kind: 'fit', seq: r.seq + 1 }));
}

// Request the view to reset zoom to exactly 100%.
export function requestCompareReset() {
  setFitRequest((r) => ({ kind: 'reset', seq: r.seq + 1 }));
}

export function setChanges(list) {
  setChangesSignal(Array.isArray(list) ? list : []);
}

export function setFocusedChange(change) {
  setFocusedChangeSignal(change || null);
}

// Zoek het paginaaantal van een geopend document op via het pdf.js-doc dat de
// hoofd-viewer al geladen heeft. Valt terug op 1 als het onbekend is.
function _pageCountFor(filePath) {
  const doc = (state.documents || []).find(d => d && d.filePath === filePath);
  return doc?.pdfDoc?.numPages || doc?.pageCount || 1;
}

// Basis-pagina's (het paar waarmee de vergelijking startte) plus een gedeelde
// paar-index. De pagina's worden afgeleid als basis+index en per document
// geklemd op zijn eigen bereik. Hierdoor is vorige/volgende SYMMETRISCH bij
// ongelijke paginaaantallen: voorheen klemde elk document onafhankelijk per
// stap, waardoor terugbladeren andere paren opleverde dan heenbladeren
// (heen: (5,27)→(5,28); terug vanaf (5,28): (4,27) i.p.v. (5,27)).
let _pairBase = { old: 1, new: 1 };
let _pairIndex = 0;

function _clampOld(p) { return Math.max(1, Math.min(oldPageCount(), p)); }
function _clampNew(p) { return Math.max(1, Math.min(newPageCount(), p)); }

function _applyPairIndex() {
  setOldPage(_clampOld(_pairBase.old + _pairIndex));
  setNewPage(_clampNew(_pairBase.new + _pairIndex));
}

// Bij een paginawissel is de verschillen-lijst van het vorige paar
// betekenisloos: direct legen (en de selectie loslaten) zodat lijst en
// Vlak/Contour-markering niet van het vorige paar op de nieuwe pagina blijven
// staan totdat de nieuwe detectie klaar is.
function _resetPairDiff() {
  setChangesSignal([]);
  setFocusedChangeSignal(null);
  setTruncatedSignal(false);
}

export function startCompare({ oldFilePath, newFilePath, mode: m, oldPage: op = 1, newPage: np = 1, oldPageCount: ocIn, newPageCount: ncIn }) {
  setOldPath(oldFilePath);
  setNewPath(newFilePath);
  setMode(normalizeCompareMode(m));
  // A side picked from disk has no tab: the dialog passes its page count.
  const oc = Math.max(1, ocIn || _pageCountFor(oldFilePath));
  const nc = Math.max(1, ncIn || _pageCountFor(newFilePath));
  _pairAlign.clear();
  _cursor = -1;
  setPairsSignal([]);
  setPairingSignal(false);
  setTruncatedSignal(false);
  setOldPageCount(oc);
  setNewPageCount(nc);
  // Klem de start-pagina's binnen hun document zodat we nooit op een
  // niet-bestaande pagina beginnen. Dit paar is de basis voor de paar-index.
  _pairBase = { old: Math.max(1, Math.min(oc, op)), new: Math.max(1, Math.min(nc, np)) };
  _pairIndex = 0;
  _applyPairIndex();
  _loadPairAlignment();
  setZoom(1);
  _resetPairDiff(); // clean slate — geen selectie en geen lijst van een vorige sessie
  setTextChangesSignal(null); // tekst-diff hoort bij een documentpaar — opnieuw bij nieuwe sessie
  setPanelTabSignal('changes');
  setActive(true);
  setFocused(true); // open the compare tab in front
}

export function exitCompare() {
  clearCompareSources();
  _pairAlign.clear();
  _cursor = -1;
  setPairsSignal([]);
  setPairingSignal(false);
  setActive(false);
  setFocused(false);
  setOldPath(null);
  setNewPath(null);
  _resetPairDiff();
  setTextChangesSignal(null);
  setTextComparingSignal(false);
  setPanelTabSignal('changes');
}

export function setCompareMode(m) {
  setMode(normalizeCompareMode(m));
}

// Kan het pagina-paar nog vooruit/achteruit? Waar als ten minste één document
// nog een volgende/vorige pagina heeft. Gebruikt om de knoppen te dimmen.
export function canNextPagePair() {
  if (_matched().length) return compareMatchedIndex() < _matched().length - 1;
  return oldPage() < oldPageCount() || newPage() < newPageCount();
}
export function canPrevPagePair() {
  if (_matched().length) return compareMatchedIndex() !== 0;
  return oldPage() > 1 || newPage() > 1;
}

export function nextPagePair() {
  // Elk document stapt op tot zijn eigen laatste pagina. Zo blijf je bij
  // ongelijke paginaaantallen vloeiend doorlopen: het kortere document blijft
  // op zijn laatste pagina staan terwijl het langere verder gaat. De gedeelde
  // paar-index houdt heen- en terugbladeren symmetrisch.
  if (!canNextPagePair()) return;
  if (_matched().length) { _gotoCursor(compareMatchedIndex() + 1); return; }
  _pairIndex++;
  _applyPairIndex();
  _resetPairDiff();
  _loadPairAlignment();
}

export function prevPagePair() {
  if (!canPrevPagePair()) return;
  if (_matched().length) {
    const i = compareMatchedIndex();
    _gotoCursor(i < 0 ? 0 : i - 1);
    return;
  }
  _pairIndex--;
  _applyPairIndex();
  _resetPairDiff();
  _loadPairAlignment();
}

export function setPagePair(op, np) {
  // Met een koppellijst: naar het paar van die pagina's.
  const list = _matched();
  if (list.length) {
    let i = list.findIndex((p) => p.old === op && p.new === np);
    if (i < 0 && np != null) i = list.findIndex((p) => p.new === np);
    if (i < 0 && op != null) i = list.findIndex((p) => p.old === op);
    if (i >= 0) { _gotoCursor(i); return; }
  }
  // Expliciet gezet paar wordt de nieuwe basis voor de paar-index.
  _pairBase = {
    old: op != null ? _clampOld(op) : oldPage(),
    new: np != null ? _clampNew(np) : newPage(),
  };
  _pairIndex = 0;
  _applyPairIndex();
  _resetPairDiff();
  _loadPairAlignment();
}

export function setCompareZoom(z) {
  setZoom(Math.max(0.1, Math.min(8, z)));
}

// Manual alignment input: overrides the automatic result for this pair.
export function setCompareOffset(o) {
  const alignment = normalizeAlignment({ ...offset(), ...o });
  _pairAlign.set(_pairKey(oldPage(), newPage()), { alignment, source: 'manual', confidence: null });
  batch(() => {
    setOffset(alignment);
    setAlignInfoSignal({ source: 'manual', confidence: null });
    setAlignPendingSignal(false);
  });
}
