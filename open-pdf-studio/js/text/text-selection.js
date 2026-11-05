import { state, getActiveDocument } from '../core/state.js';
import { showTextSelectionContextMenu } from '../ui/chrome/context-menus.js';
import { applyBandRestriction, clearBandRestriction } from './selection-guard.js';
import { weergaveRectNaarPagina, clientNaarPagina } from '../pdf/weergave-ruimte.js';
import { selectionTextDir } from './leesrichting.js';
import {
  MEERKLIK_MS, lijnRaaktRect, aaneengeslotenReeksen, woordGrenzen, dichtsteLetter, labelBereik, quadLangsTekst,
} from './tekst-markeren.js';
import { isSchuin, markeringUitQuads } from '../annotations/markering-quads.js';

/**
 * Text Selection Module
 * Handles text selection state and operations
 */

// Spans die tijdens een actieve sleep tijdelijk op user-select:none staan
// (kolom-begrenzing tegen spurious selecties bij tabellen/meerkoloms).
let _guardRestricted = [];
// De .endOfContent-div van de tekstlaag waarin de huidige sleep begon.
let _activeEndOfContent = null;
// Markeren in tekstmodus (#927): het schermpunt van de laatste mousedown met
// de linkerknop, het begin van de sleeplijn.
let _sleepBegin = null;
// Wachtende dubbelklik (woord), zodat een derde klik (label) hem overneemt.
let _woordTimer = null;

/**
 * Initializes text selection event listeners
 */
export function initTextSelection() {
  // Listen for selection changes
  document.addEventListener('selectionchange', handleSelectionChange);

  // Listen for right-click on text layers
  document.addEventListener('contextmenu', handleTextContextMenu);

  // Clear selection when clicking outside text layer
  document.addEventListener('mousedown', handleMouseDown);

  // Einde van een sleep: hef de kolom-begrenzing en endOfContent weer op.
  // Document-breed zodat het ook vuurt als de muis buiten de tekstlaag loslaat.
  document.addEventListener('mouseup', handleMouseUp);

  // Markeren in tekstmodus (#927): dubbel- en driemaal klikken. In de
  // capture-fase, zodat geen andere handler de klik inslikt.
  document.addEventListener('click', handleMeerklik, true);
}

/**
 * Handles selection change events
 */
function handleSelectionChange() {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed) {
    // No selection or selection collapsed
    state.textSelection.hasSelection = false;
    state.textSelection.selectedText = '';
    state.textSelection.pageNum = null;
    return;
  }

  // Check if selection is within a text layer
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;

  if (!anchorNode || !focusNode) return;

  const textLayer = findParentTextLayer(anchorNode);
  if (!textLayer) {
    state.textSelection.hasSelection = false;
    state.textSelection.selectedText = '';
    state.textSelection.pageNum = null;
    return;
  }

  // Update selection state
  state.textSelection.hasSelection = true;
  state.textSelection.selectedText = selection.toString();
  state.textSelection.pageNum = parseInt(textLayer.dataset.page) || (getActiveDocument()?.currentPage || 1);
}

/**
 * Handles right-click context menu for text selection
 */
function handleTextContextMenu(e) {
  // Check if right-click is on a text layer with selection
  const textLayer = findParentTextLayer(e.target);
  if (!textLayer) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

  // Check if the click is within the selection
  if (isClickInSelection(e, selection)) {
    e.preventDefault();
    e.stopPropagation();
    showTextSelectionContextMenu(e);
  }
}

/**
 * Handles mousedown to track selection context
 */
function handleMouseDown(e) {
  // Don't clear selection if clicking on context menu
  if (e.target.closest('.context-menu')) return;

  // Markeren in tekstmodus houdt alleen de tekst die de sleeplijn raakt;
  // onthoud waar hij begint (het canvas kan deze mousedown vóór de
  // tekstlaag krijgen).
  if (e.button === 0) _sleepBegin = { x: e.clientX, y: e.clientY };

  // Don't clear selection if clicking within text layer
  const textLayer = findParentTextLayer(e.target);
  if (textLayer) {
    // Alleen de linkermuisknop start een tekstselectie-sleep.
    if (e.button === 0) beginSelectionDrag(textLayer, e);
    return;
  }

  // Check if we're clicking on an annotation canvas in select tool mode
  if (state.currentTool === 'select') {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      // Clear selection when clicking outside text layer
      selection.removeAllRanges();
    }
  }
}

/**
 * Handles mouseup: end a selection drag and lift the temporary column guard.
 */
function handleMouseUp(e) {
  const lijn = _sleepBegin && e ? { x1: _sleepBegin.x, y1: _sleepBegin.y, x2: e.clientX, y2: e.clientY } : null;
  _sleepBegin = null;
  endSelectionDrag();
  // Markeren in tekstmodus (#927): de paginatekst die deze sleep selecteerde,
  // wordt bij het loslaten een markering; de modus blijft aan voor de
  // volgende. Een gewone klik markeert niets; de mouseup van een dubbelklik
  // is voor handleMeerklik.
  if (!tekstMarkerenAan() || !lijn || (e && e.detail >= 2)) return;
  if (Math.hypot(lijn.x2 - lijn.x1, lijn.y2 - lijn.y1) < 3) return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) return;
    if (!findParentTextLayer(sel.anchorNode)) return;
    // Op tekeningen staat de tekstlaag in bestandsvolgorde, niet in
    // leesvolgorde: een selectie van de browser pakt dan labels van elders op
    // het blad mee. Alleen de stukken die de sleeplijn echt raakt.
    const bereik = sel.getRangeAt(0);
    const delen = gekruisteDelen(bereik, lijn);
    markeerBereiken(delen || [bereik]);
  }, 0);
}

/** Staat Markeren in tekstmodus aan (highlight-mode.js)? */
function tekstMarkerenAan() {
  return !!state.textHighlightMode && state.currentTool === 'select';
}

const wit = (c) => /\s/.test(c);

/** De tekstlaag-spans zonder kind-spans, met tekst (of met echte letters). */
function woordSpans(laag, alleenLetters = false) {
  return [...laag.querySelectorAll('span')].filter((s) => !s.querySelector('span')
    && (alleenLetters ? s.textContent.trim() : s.textContent));
}

/**
 * De delen van `range` die de sleeplijn (schermpixels) raakt, als ranges:
 * één per reeks opeenvolgende tekstlaag-spans. Null als de range één span
 * beslaat of als er niets af hoeft: dan blijft de selectie zoals ze is; []
 * als de lijn geen span raakt.
 */
function gekruisteDelen(range, lijn) {
  const laag = findParentTextLayer(range.commonAncestorContainer) || findParentTextLayer(range.startContainer);
  if (!laag) return null;
  const spans = woordSpans(laag).filter((s) => range.intersectsNode(s));
  if (spans.length <= 1) return null;
  const geraakt = spans.map((s) => {
    const r = s.getBoundingClientRect();
    return lijnRaaktRect(lijn, r, Math.max(4, Math.min(r.width, r.height) * 0.5));
  });
  if (geraakt.every(Boolean)) return null;
  const delen = [];
  for (const [i, j] of aaneengeslotenReeksen(geraakt)) {
    const deel = document.createRange();
    const eerste = spans[i], laatste = spans[j];
    if (eerste.contains(range.startContainer)) deel.setStart(range.startContainer, range.startOffset);
    else deel.setStartBefore(eerste);
    if (laatste.contains(range.endContainer)) deel.setEnd(range.endContainer, range.endOffset);
    else deel.setEndAfter(laatste);
    if (!deel.collapsed && deel.toString().trim()) delen.push(deel);
  }
  return delen;
}

/**
 * Markeren in tekstmodus (#927): dubbelklik markeert het woord onder de
 * wijzer ("150X6.0SHS"), driemaal klikken het hele label ("150X6.0SHS x 5730
 * LENGTH"). De dubbelklik wacht even, zodat een derde klik hem overneemt.
 * De tekst wordt op positie gezocht, niet via hit-testing: de klik landt
 * vaak op het markeringscanvas.
 */
function handleMeerklik(e) {
  if (e.detail < 2 || e.button !== 0 || !tekstMarkerenAan()) return;
  const x = e.clientX, y = e.clientY;
  const span = spanOpPunt(x, y);
  if (!span) return;
  e.preventDefault();
  clearTimeout(_woordTimer);
  _woordTimer = null;
  if (e.detail === 2) {
    _woordTimer = setTimeout(() => {
      _woordTimer = null;
      const bereik = woordBereik(span, x, y);
      if (bereik) markeerBereiken([bereik]);
    }, MEERKLIK_MS);
    return;
  }
  if (e.detail !== 3) return;
  // Tekeningen bewaren een label vaak als één span per woord ("ISSUED",
  // "FOR", "APPROVAL"): neem de buurspans op dezelfde regel mee.
  const regel = labelVan(span);
  const bereik = document.createRange();
  bereik.setStartBefore(regel[0]);
  bereik.setEndAfter(regel[regel.length - 1]);
  markeerBereiken([bereik]);
}

/** Het eerste tekstknooppunt van een span. */
function tekstKnoop(span) {
  return [...span.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.length) || null;
}

/** Midden van letter i op het scherm, of null als die niet te meten is. */
function letterMidden(tn, i) {
  const r = document.createRange();
  r.setStart(tn, i);
  r.setEnd(tn, i + 1);
  const b = r.getBoundingClientRect();
  if (!b.width && !b.height) return null;
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
}

/**
 * Het woord van `span` op schermpunt (x, y), gevonden door de letters te
 * meten: werkt ook op gedraaide tekst en als de tekstlaag niet het doel van
 * de klik is.
 */
function woordBereik(span, x, y) {
  const tn = tekstKnoop(span);
  if (!tn) return null;
  const tekst = tn.data;
  const middens = Array.from({ length: tekst.length }, (_, i) => (wit(tekst[i]) ? null : letterMidden(tn, i)));
  const grenzen = woordGrenzen(tekst, dichtsteLetter(middens, x, y));
  if (!grenzen) return null;
  const bereik = document.createRange();
  bereik.setStart(tn, grenzen[0]);
  bereik.setEnd(tn, grenzen[1]);
  return bereik;
}

/**
 * Maat van een span in de eigen ruimte van de tekstlaag (vóór de
 * weergaverotatie van de pagina): oorsprong, leesrichting, lengte en
 * letterhoogte, uit zijn CSS-transform (draaiing en schaal).
 */
function spanMaat(s) {
  const m = getComputedStyle(s).transform;
  const v = m && m !== 'none' ? (m.match(/-?[\d.]+(?:e[-+]?\d+)?/g) || []).map(Number) : [];
  const [a = 1, b = 0, c = 0, d = 1] = v;
  return {
    x: s.offsetLeft, y: s.offsetTop, t: Math.atan2(b, a),
    len: s.offsetWidth * Math.hypot(a, b), h: s.offsetHeight * Math.hypot(c, d),
  };
}

/** De woord-spans die met `span` één label vormen (tekst-markeren.js). */
function labelVan(span) {
  const laag = span.closest('.textLayer');
  if (!laag) return [span];
  // Alleen woorden; de lege spans ertussen komen in de range mee.
  const woorden = woordSpans(laag, true);
  const i = woorden.indexOf(span);
  if (i < 0) return [span];
  const [a, b] = labelBereik(woorden.map(spanMaat), i);
  return woorden.slice(a, b + 1);
}

/**
 * De woord-span op een schermpunt: de span waarvan het vak het punt bevat;
 * bij overlappende vakken (gedraaide labels) wint het dichtste midden.
 */
function spanOpPunt(x, y) {
  let beste = null, bd = Infinity;
  for (const s of document.querySelectorAll('.textLayer span')) {
    if (s.querySelector('span') || !s.textContent.trim()) continue;
    const r = s.getBoundingClientRect();
    if (x < r.left - 2 || x > r.right + 2 || y < r.top - 2 || y > r.bottom + 2) continue;
    const d = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2);
    if (d < bd) { bd = d; beste = s; }
  }
  return beste;
}

/**
 * Schuine tekst (geen veelvoud van 90 graden): de rechthoeken van de
 * selectie zijn rechte vakken, dus de markering zou een groot vak rond het
 * label bedekken. Hier één gedraaide quad per tekstlaag-span die de range
 * raakt, langs de tekst, in paginaruimte. Null voor liggende of staande
 * tekst: die houdt de gewone rechthoeken.
 */
function schuineMarkering(bereik) {
  const laag = findParentTextLayer(bereik.commonAncestorContainer) || findParentTextLayer(bereik.startContainer);
  if (!laag) return null;
  const pagina = parseInt(laag.dataset.page, 10) || getActiveDocument()?.currentPage || 1;
  const spans = woordSpans(laag, true).filter((s) => bereik.intersectsNode(s));
  if (!spans.length) return null;
  const quads = [];
  for (const span of spans) {
    const tn = tekstKnoop(span);
    if (!tn) continue;
    const tekst = tn.data;
    let a = bereik.startContainer === tn ? bereik.startOffset : 0;
    let b = bereik.endContainer === tn ? bereik.endOffset : tekst.length;
    while (a < b && wit(tekst[a])) a++;
    while (b > a && wit(tekst[b - 1])) b--;
    if (b <= a) continue;
    // Leesrichting op het scherm uit de eerste en laatste letter van de span.
    let eerste = 0, laatste = tekst.length - 1;
    while (eerste < laatste && wit(tekst[eerste])) eerste++;
    while (laatste > eerste && wit(tekst[laatste])) laatste--;
    if (laatste <= eerste) return null; // één letter: geen richting te lezen
    const p0 = letterMidden(tn, eerste), p1 = letterMidden(tn, laatste);
    const q0 = letterMidden(tn, a), q1 = letterMidden(tn, b - 1);
    if (!p0 || !p1 || !q0 || !q1) return null;
    const { len: lLok, h: hLok } = spanMaat(span);
    const opScherm = quadLangsTekst({ p0, p1, stappen: laatste - eerste, letters: tekst.length, lLok, hLok, q0, q1 });
    if (!opScherm) return null;
    const hoeken = opScherm.map((p) => clientNaarPagina(pagina, p.x, p.y));
    if (hoeken.some((p) => !p)) return null;
    quads.push(hoeken.map((p) => ({ x: p.x, y: p.y })));
  }
  if (!quads.length || !quads.some(isSchuin)) return null;
  return { page: pagina, ...markeringUitQuads(quads) };
}

/**
 * Maak van elke range een tekstmarkering (hetzelfde pad als "Markering op
 * selectie") en laat daarna niets geselecteerd: de modus blijft klaar voor
 * de volgende, en een geselecteerde markering liet de ribbon na elke regel
 * naar Opmaak springen. Eén ongedaan-maakstap voor alles.
 */
async function markeerBereiken(bereiken) {
  const sel = window.getSelection();
  if (!sel) return;
  if (!bereiken.length) { clearTextSelection(); return; }
  const [{ createTextMarkupAnnotation }, undo, keuze, weergave] = await Promise.all([
    import('./text-markup.js'),
    import('../core/undo-manager.js'),
    import('../core/stores/selection-helpers.js'),
    import('../annotations/rendering.js'),
  ]);
  undo.beginUndoTransaction();
  try {
    for (const bereik of bereiken) {
      let schuin = null;
      try { schuin = schuineMarkering(bereik); } catch { schuin = null; }
      sel.removeAllRanges();
      sel.addRange(bereik);
      createTextMarkupAnnotation('textHighlight', '#FFFF00', 0.3, schuin, { select: false, redraw: false });
    }
  } finally {
    undo.endUndoTransaction();
  }
  clearTextSelection();
  keuze.clearSelection();
  if (getActiveDocument()?.viewMode === 'continuous') weergave.redrawContinuous(); else weergave.redrawAnnotations();
}

/**
 * Start van een tekstselectie-sleep binnen een tekstlaag.
 * 1) Begrenst — indien de startregel een tabelrij is — de selectie tot de
 *    kolom van het startpunt (voorkomt spurious selecties in andere kolommen).
 * 2) Activeert de endOfContent-div op de start-Y zodat een omgekeerde sleep
 *    (onder -> boven) de selectie niet naar verre tekst laat uitschieten.
 * @param {HTMLElement} textLayer
 * @param {MouseEvent} e
 */
function beginSelectionDrag(textLayer, e) {
  // Ruim een eventuele vorige (niet netjes afgesloten) sleep op.
  endSelectionDrag();

  try {
    _guardRestricted = applyBandRestriction(textLayer, e.clientX, e.clientY);
  } catch {
    _guardRestricted = [];
  }

  // endOfContent-truc (zoals PDF.js viewer): plaats het niet-selecteerbare
  // "einde" op de start-Y en activeer het, zodat de selectie-ankering bij een
  // omgekeerde sleep niet buiten de begonnen tekst springt.
  const end = textLayer.querySelector('.endOfContent');
  if (end) {
    const r = hoogteFractieInLaag(textLayer, e.clientX, e.clientY);
    end.style.top = `${(r * 100).toFixed(2)}%`;
    end.classList.add('active');
    _activeEndOfContent = end;
  }
}

/**
 * Hoe ver (0..1) ligt een schermpunt van de bovenkant van de tekstlaag, in de
 * EIGEN stand van de laag? De laag ligt in het ongedraaide paginakader en
 * wordt met een CSS-transform gedraaid en geschaald (paginarotatie en de
 * weergaverotatie, #200); op het scherm is "boven" dan niet altijd boven.
 * Terugrekenen via de inverse van die transform; zonder transform is dit
 * gewoon (clientY − top) / hoogte.
 */
function hoogteFractieInLaag(textLayer, clientX, clientY) {
  const klem = (v) => Math.max(0, Math.min(1, v));
  const hoogte = textLayer.offsetHeight;
  const ouder = textLayer.offsetParent || textLayer.parentElement;
  const transform = getComputedStyle(textLayer).transform;
  if (hoogte > 0 && ouder && transform && transform !== 'none' && typeof DOMMatrixReadOnly === 'function') {
    try {
      const pr = ouder.getBoundingClientRect();
      const lokaal = new DOMMatrixReadOnly(transform).inverse().transformPoint(
        new DOMPoint(clientX - pr.left - textLayer.offsetLeft, clientY - pr.top - textLayer.offsetTop));
      if (Number.isFinite(lokaal.y)) return klem(lokaal.y / hoogte);
    } catch { /* terugval hieronder */ }
  }
  const rect = textLayer.getBoundingClientRect();
  return rect.height > 0 ? klem((clientY - rect.top) / rect.height) : 0;
}

/**
 * Einde van een tekstselectie-sleep: herstel user-select en endOfContent.
 */
function endSelectionDrag() {
  if (_guardRestricted.length) {
    clearBandRestriction(_guardRestricted);
    _guardRestricted = [];
  }
  if (_activeEndOfContent) {
    _activeEndOfContent.classList.remove('active');
    _activeEndOfContent.style.top = '';
    _activeEndOfContent = null;
  }
}

/**
 * Finds the parent text layer element
 * @param {Node} node - DOM node to search from
 * @returns {HTMLElement|null} The text layer element or null
 */
function findParentTextLayer(node) {
  if (!node) return null;

  // Handle text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }

  // Traverse up to find text layer
  while (node && node !== document.body) {
    if (node.classList && node.classList.contains('textLayer')) {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}

/**
 * Checks if a click event is within the current selection
 * @param {MouseEvent} e - The mouse event
 * @param {Selection} selection - The current selection
 * @returns {boolean} True if click is in selection
 */
function isClickInSelection(e, selection) {
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();

  for (const rect of rects) {
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Gets the currently selected text
 * @returns {string} The selected text
 */
export function getSelectedText() {
  return state.textSelection.selectedText || '';
}

/**
 * Gets the DOM rectangles for the current selection
 * @returns {DOMRect[]} Array of DOMRect objects
 */
export function getSelectionRects() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  return Array.from(range.getClientRects());
}

/**
 * Gets selection rectangles converted to PDF coordinates
 * @returns {Array<{x: number, y: number, width: number, height: number, page: number}>}
 */
export function getSelectionRectsForAnnotation() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const result = [];

  // Find the text layer to get page info and coordinate conversion
  const textLayer = findParentTextLayer(selection.anchorNode);
  if (!textLayer) return [];

  const pageNum = parseInt(textLayer.dataset.page) || (getActiveDocument()?.currentPage || 1);
  const textLayerRect = textLayer.getBoundingClientRect();

  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  for (const rect of rects) {
    // Convert DOM coordinates to PDF coordinates (relative to text layer, unscaled).
    // De tekstlaag omsluit de pagina zoals hij op het scherm staat; is de
    // weergave gedraaid (#200), dan de rechthoek terugdraaien naar de pagina.
    const inWeergave = {
      x: (rect.left - textLayerRect.left) / scale,
      y: (rect.top - textLayerRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    };
    const { x, y, width, height } = weergaveRectNaarPagina(pageNum, inWeergave, doc);

    result.push({ x, y, width, height, page: pageNum });
  }

  return result;
}

/**
 * Leesrichting (0/90/180/270) van de geselecteerde tekst in de paginaruimte,
 * of null als die onbekend is (#527). De rotatie is de eigen /Rotate plus de
 * paginarotatie in de app, zoals paginaMaat (weergave-ruimte.js) die telt; de
 * weergaverotatie (#200) hoort er niet bij, want annotaties staan in de
 * paginaruimte.
 * @returns {number|null}
 */
export function getSelectionTextDir() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const textLayer = findParentTextLayer(selection.anchorNode);
  if (!textLayer) return null;
  const doc = getActiveDocument();
  const pageNum = parseInt(textLayer.dataset.page) || (doc?.currentPage || 1);
  const pageRot = (Number(doc?.pageDims?.[pageNum]?.rotation) || 0) + (Number(doc?.pageRotations?.[pageNum]) || 0);
  return selectionTextDir(selection, pageRot);
}

/**
 * Clears the current text selection
 */
export function clearTextSelection() {
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }

  state.textSelection.hasSelection = false;
  state.textSelection.selectedText = '';
  state.textSelection.pageNum = null;
}

/**
 * Converts selection rects to quadPoints format for text markup annotations
 * quadPoints is an array of [x1,y1,x2,y2,x3,y3,x4,y4] representing quad corners
 * @returns {Array<number[]>} Array of quad point arrays
 */
export function getSelectionQuadPoints() {
  const rects = getSelectionRectsForAnnotation();
  return rects.map(rect => {
    // QuadPoints: top-left, top-right, bottom-left, bottom-right
    return [
      rect.x, rect.y,                           // top-left
      rect.x + rect.width, rect.y,              // top-right
      rect.x, rect.y + rect.height,             // bottom-left
      rect.x + rect.width, rect.y + rect.height // bottom-right
    ];
  });
}
