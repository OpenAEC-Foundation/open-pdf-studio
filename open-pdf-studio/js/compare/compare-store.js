// Compare/Overlay session store.
// Tracks which two PDFs are being compared, the mode, current page-pair and offset.
// Reactive via solid-js signals so UI re-renders when fields change.

import { createSignal } from 'solid-js';
import { state } from '../core/state.js';

const [active, setActive] = createSignal(false);
const [oldPath, setOldPath] = createSignal(null);
const [newPath, setNewPath] = createSignal(null);
const [mode, setMode] = createSignal('overlay'); // 'overlay' | 'side'
const [oldPage, setOldPage] = createSignal(1);
const [newPage, setNewPage] = createSignal(1);
// Aantal pagina's per document, zodat pagina-navigatie binnen de grenzen
// blijft. Zonder deze grens liep nextPagePair ongelimiteerd door: de render
// klemt intern naar de laatste pagina, dus je bleef "vooruit" klikken terwijl
// dezelfde laatste pagina zichtbaar bleef en de teller doorliep. Documenten
// mogen verschillende paginaaantallen hebben — elk kent zijn eigen maximum.
const [oldPageCount, setOldPageCount] = createSignal(1);
const [newPageCount, setNewPageCount] = createSignal(1);
const [offset, setOffset] = createSignal({ dx: 0, dy: 0, rotation: 0 });
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
};

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
}

export function startCompare({ oldFilePath, newFilePath, mode: m, oldPage: op = 1, newPage: np = 1 }) {
  setOldPath(oldFilePath);
  setNewPath(newFilePath);
  setMode(m || 'overlay');
  const oc = Math.max(1, _pageCountFor(oldFilePath));
  const nc = Math.max(1, _pageCountFor(newFilePath));
  setOldPageCount(oc);
  setNewPageCount(nc);
  // Klem de start-pagina's binnen hun document zodat we nooit op een
  // niet-bestaande pagina beginnen. Dit paar is de basis voor de paar-index.
  _pairBase = { old: Math.max(1, Math.min(oc, op)), new: Math.max(1, Math.min(nc, np)) };
  _pairIndex = 0;
  _applyPairIndex();
  setOffset({ dx: 0, dy: 0, rotation: 0 });
  setZoom(1);
  _resetPairDiff(); // clean slate — geen selectie en geen lijst van een vorige sessie
  setTextChangesSignal(null); // tekst-diff hoort bij een documentpaar — opnieuw bij nieuwe sessie
  setPanelTabSignal('changes');
  setActive(true);
  setFocused(true); // open the compare tab in front
}

export function exitCompare() {
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
  setMode(m);
}

// Kan het pagina-paar nog vooruit/achteruit? Waar als ten minste één document
// nog een volgende/vorige pagina heeft. Gebruikt om de knoppen te dimmen.
export function canNextPagePair() {
  return oldPage() < oldPageCount() || newPage() < newPageCount();
}
export function canPrevPagePair() {
  return oldPage() > 1 || newPage() > 1;
}

export function nextPagePair() {
  // Elk document stapt op tot zijn eigen laatste pagina. Zo blijf je bij
  // ongelijke paginaaantallen vloeiend doorlopen: het kortere document blijft
  // op zijn laatste pagina staan terwijl het langere verder gaat. De gedeelde
  // paar-index houdt heen- en terugbladeren symmetrisch.
  if (!canNextPagePair()) return;
  _pairIndex++;
  _applyPairIndex();
  _resetPairDiff();
}

export function prevPagePair() {
  if (!canPrevPagePair()) return;
  _pairIndex--;
  _applyPairIndex();
  _resetPairDiff();
}

export function setPagePair(op, np) {
  // Expliciet gezet paar wordt de nieuwe basis voor de paar-index.
  _pairBase = {
    old: op != null ? _clampOld(op) : oldPage(),
    new: np != null ? _clampNew(np) : newPage(),
  };
  _pairIndex = 0;
  _applyPairIndex();
  _resetPairDiff();
}

export function setCompareZoom(z) {
  setZoom(Math.max(0.1, Math.min(8, z)));
}

export function setCompareOffset(o) {
  setOffset({ ...offset(), ...o });
}
