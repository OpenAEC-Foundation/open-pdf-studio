// Proofreading mode (#508, part 2): keyboard-driven Insert, Delete and
// Replace text corrections.
//
// F2 (or the ribbon button on the Annotation tab) switches the 'proofread'
// tool on and off. A text cursor moves over the text model of the page
// (pdf.js getTextContent, see annotations/corrections/text-model.js):
// arrow keys, Home/End, Ctrl+arrow by word, Shift to select, a click places
// the cursor, a drag or double click selects.
// - Typing opens an inline input: at a cursor it becomes an insert, over a
//   selection a replace (Enter or Tab commits, Esc closes it).
// - Delete/Backspace strike through at once; pressing again extends it.
// - Tab / Shift+Tab go to the next / previous correction.
// - Esc steps back one level: close the input, clear the selection, leave.
// While the mode is on, every key it uses is caught on window in the capture
// phase, so no tool shortcut fires; Ctrl/Alt shortcuts such as undo and save
// still reach the app. The rules themselves are pure and tested
// (corrections/proofreading.js, proofreading-apply.js).

import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import i18next from '../i18n/config.js';
import { setTool } from './manager.js';
import { isModalOpen } from './tool-context.js';
import { isTextEntryTarget } from '../ui/chrome/tab-sneltoets.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { paginaNaarClient } from '../pdf/weergave-ruimte.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import {
  buildTextModel, moveCursor, caretSegment, caretAt, rangeRects, rangeText, hitTest, totalLength, charAt,
} from '../annotations/corrections/text-model.js';
import {
  keyCommand, escapeStep, hasSelection, normalizeRange, correctionPosition, isTabStop,
  sortCorrections, nextCorrection,
} from '../annotations/corrections/proofreading.js';
import { applyInsert, applyReplace, applyStrike } from '../annotations/corrections/proofreading-apply.js';
import { correctionKind } from '../annotations/corrections/model.js';
import { setProofreadingOverlay, clearProofreadingOverlay } from '../annotations/corrections/proofreading-overlay.js';
import { sneltoetsActief, isSneltoetsOpname } from '../core/keybindings/app-shortcuts.js';

export const PROOFREAD_TOOL = 'proofread';

const t = (key, def) => i18next.t(`proofread.${key}`, { ns: 'ribbon', defaultValue: def });

// Mode state. `anchor` null = no selection; otherwise the selection runs from
// anchor to cursor. `last`: the strike that Delete/Backspace would extend.
const S = {
  docId: null, page: 1, model: null, key: null,
  cursor: 0, anchor: null, goal: null, last: null, currentId: null,
  input: null, inputRange: null, inputPos: 0, dragging: false,
};

// Text models per document, page and rotation: promise and, once loaded, the model.
const beloften = new Map();
const klaar = new Map();

export function isProofreadingActive() {
  return state.currentTool === PROOFREAD_TOOL;
}

/** F2 and the ribbon button. */
export function toggleProofreading() {
  if (isProofreadingActive()) setTool('select');
  else if (getActiveDocument()?.pdfDoc) setTool(PROOFREAD_TOOL);
}

function sleutel(doc, page) {
  return `${doc.id}|${page}|${getPageRotation(page) || 0}`;
}

let _meetCtx = null;
function meter(styles) {
  if (typeof document === 'undefined') return undefined;
  if (!_meetCtx) _meetCtx = document.createElement('canvas').getContext('2d');
  if (!_meetCtx) return undefined;
  return (str, item) => {
    const familie = styles?.[item?.fontName]?.fontFamily || 'sans-serif';
    _meetCtx.font = `100px ${familie}`;
    return _meetCtx.measureText(str).width;
  };
}

/** The text model of a page (cached per rotation). */
function laadModel(doc, page) {
  const k = sleutel(doc, page);
  if (!beloften.has(k)) {
    const belofte = (async () => {
      const p = await doc.pdfDoc.getPage(page);
      const rotation = (((p.rotate || 0) + (getPageRotation(page) || 0)) % 360 + 360) % 360;
      const transform = p.getViewport({ scale: 1, rotation }).transform;
      const inhoud = await p.getTextContent();
      const model = buildTextModel(inhoud.items, { transform, measure: meter(inhoud.styles) });
      klaar.set(k, model);
      return model;
    })();
    belofte.catch(() => beloften.delete(k));
    beloften.set(k, belofte);
  }
  return beloften.get(k);
}

function wisCache() {
  beloften.clear();
  klaar.clear();
}

function selectie() {
  return S.anchor !== null && S.anchor !== S.cursor ? { anchor: S.anchor, focus: S.cursor } : null;
}

function herteken(licht = true) {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous(licht);
  else redrawAnnotations(licht);
}

function lijstBijwerken() {
  import('../ui/panels/annotations-list.js').then((m) => m.updateAnnotationsList()).catch(() => {});
}

/** Overlay, scroll into view and redraw after every change of cursor or selection. */
function toon({ zichtbaar = true } = {}) {
  const doc = getActiveDocument();
  if (!doc || !S.model || !isProofreadingActive()) {
    clearProofreadingOverlay();
    herteken();
    return;
  }
  const sel = selectie();
  setProofreadingOverlay({
    docId: doc.id,
    page: S.page,
    caret: S.input ? null : caretSegment(S.model, S.cursor),
    rects: sel ? rangeRects(S.model, sel.anchor, sel.focus).rects : [],
  });
  herteken();
  if (zichtbaar) zorgZichtbaar();
}

function zorgZichtbaar() {
  const c = S.model ? caretAt(S.model, S.cursor) : null;
  const container = typeof document !== 'undefined' ? document.getElementById('pdf-container') : null;
  if (!c || !container) return;
  const doc = getActiveDocument();
  const p = paginaNaarClient(S.page, c.P.x, c.P.y, doc);
  const vak = container.getBoundingClientRect();
  const marge = 24;
  if (p && p.x > vak.left + marge && p.x < vak.right - marge && p.y > vak.top + marge && p.y < vak.bottom - marge) return;
  import('../ui/panels/annotations-list.js').then((m) => m.scrollToAnnotation({
    type: 'box', page: S.page, x: c.P.x - 1, y: c.P.y - c.h, width: 2, height: c.h,
  })).catch(() => {});
}

/** Shows page `page` with its model; false if the page does not exist. */
async function zetPagina(page) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || page < 1 || page > (doc.pdfDoc.numPages || 0)) return false;
  const model = await laadModel(doc, page);
  S.docId = doc.id;
  S.page = page;
  S.model = model;
  S.key = sleutel(doc, page);
  if (doc.viewMode !== 'continuous' && doc.currentPage !== page) {
    const { goToPage } = await import('../pdf/renderer.js');
    await goToPage(page);
  }
  return true;
}

/** The next page in direction `dir` that has text; false if there is none. */
async function naarPaginaMetTekst(dir, plek) {
  const doc = getActiveDocument();
  const n = doc?.pdfDoc?.numPages || 0;
  for (let p = S.page + dir; p >= 1 && p <= n; p += dir) {
    const model = await laadModel(doc, p);
    if (totalLength(model) === 0 && model.lines.length === 0) continue;
    await zetPagina(p);
    S.cursor = plek === 'end' ? totalLength(model) : 0;
    return true;
  }
  return false;
}

function vergeetPlek() {
  S.last = null;
  S.goal = null;
  if (S.currentId) {
    S.currentId = null;
    const doc = getActiveDocument();
    if (doc) { doc.selectedAnnotations = []; doc.selectedAnnotation = null; }
  }
}

async function beweeg(how, extend) {
  const m = S.model;
  if (!m) return;
  const sel = selectie();
  const goal = how === 'up' || how === 'down' ? S.goal : null;
  vergeetPlek();
  if (!extend && sel && (how === 'left' || how === 'right')) {
    S.cursor = how === 'left' ? Math.min(sel.anchor, sel.focus) : Math.max(sel.anchor, sel.focus);
    S.anchor = null;
    toon();
    return;
  }
  if (extend && S.anchor === null) S.anchor = S.cursor;
  if (!extend) S.anchor = null;
  const r = moveCursor(m, S.cursor, how, { goal });
  if (r.edge) {
    // Over the page edge, only without a selection.
    if (!extend && (how === 'left' || how === 'right' || how === 'up' || how === 'down' || how === 'wordLeft' || how === 'wordRight')) {
      await naarPaginaMetTekst(r.edge === 'end' ? 1 : -1, r.edge === 'end' ? 'start' : 'end');
    }
    toon();
    return;
  }
  S.cursor = r.pos;
  S.goal = r.goal;
  toon();
}

async function bladeren(dir) {
  if (S.input) return;
  vergeetPlek();
  S.anchor = null;
  await naarPaginaMetTekst(dir, 'start');
  toon();
}

function openInvoer(begin) {
  const m = S.model;
  const doc = getActiveDocument();
  if (!m || !doc || S.input) return;
  const sel = selectie();
  const range = sel ? normalizeRange(m, sel.anchor, sel.focus) : null;
  const pos = range ? range.end : S.cursor;
  const seg = caretSegment(m, pos);
  if (!seg) return;
  const a = paginaNaarClient(S.page, seg.from.x, seg.from.y, doc);
  const b = paginaNaarClient(S.page, seg.to.x, seg.to.y, doc);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = `proofread-input ${range ? 'replace' : 'insert'}`;
  input.value = begin;
  input.placeholder = range ? t('replacePlaceholder', 'Replacement text') : t('insertPlaceholder', 'Insert text');
  input.setAttribute('aria-label', input.placeholder);
  input.spellcheck = true;
  const links = a && b ? Math.min(a.x, b.x) : 100;
  const boven = a && b ? Math.max(a.y, b.y) + 3 : 100;
  input.style.left = `${Math.max(0, Math.min(links, window.innerWidth - 120))}px`;
  input.style.top = `${Math.max(0, Math.min(boven, window.innerHeight - 30))}px`;
  const pasBreedte = () => { input.style.width = `${Math.max(80, Math.min(480, 16 + input.value.length * 8))}px`; };
  pasBreedte();
  input.addEventListener('input', pasBreedte);
  input.addEventListener('blur', () => { if (S.input === input) sluitInvoer(true); });
  S.input = input;
  S.inputRange = range;
  S.inputPos = pos;
  document.body.appendChild(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  toon({ zichtbaar: false });
}

/** Closes the inline input; with `vastleggen` its text becomes an insert or a replace. */
function sluitInvoer(vastleggen) {
  const input = S.input;
  if (!input) return;
  S.input = null;
  const tekst = input.value;
  input.remove();
  const doc = getActiveDocument();
  if (vastleggen && tekst && doc && S.model) {
    if (S.inputRange) {
      const r = applyReplace(doc, S.model, S.page, S.inputRange, tekst);
      if (r) { S.cursor = S.inputRange.end; S.anchor = null; }
    } else {
      applyInsert(doc, S.model, S.page, S.inputPos, tekst);
    }
    vergeetPlek();
    lijstBijwerken();
    herteken(false);
  }
  S.inputRange = null;
  toon({ zichtbaar: false });
}

function schrap(dir, unit) {
  const doc = getActiveDocument();
  if (!doc || !S.model) return;
  const last = S.last;
  const huidigeId = S.currentId;
  S.currentId = null;
  if (huidigeId) { doc.selectedAnnotations = []; doc.selectedAnnotation = null; }
  const r = applyStrike(doc, S.model, S.page, { cursor: S.cursor, selection: selectie(), last, dir, unit });
  S.anchor = null;
  S.goal = null;
  if (r.annotation) {
    S.cursor = r.cursor;
    S.last = r.last;
    lijstBijwerken();
    herteken(false);
  }
  toon();
}

async function springNaarCorrectie(dir) {
  const doc = getActiveDocument();
  if (!doc) return;
  const byId = new Map(doc.annotations.map((a) => [a.id, a]));
  const posities = [];
  for (const ann of doc.annotations) {
    if (!isTabStop(ann, byId) || !(ann.page >= 1)) continue;
    const model = await laadModel(doc, ann.page);
    const p = correctionPosition(model, ann);
    posities.push({ id: ann.id, page: ann.page, pos: p.pos, range: p.range || null, ann });
  }
  const doel = nextCorrection(sortCorrections(posities), { page: S.page, pos: S.cursor, currentId: S.currentId }, dir);
  if (!doel) {
    updateStatusMessage(t('noCorrections', 'There are no corrections yet.'));
    return;
  }
  await zetPagina(doel.page);
  S.anchor = null;
  S.goal = null;
  S.currentId = doel.id;
  if (doel.range && correctionKind(doel.ann, byId) === 'delete') {
    // Delete or Backspace now extends this strike.
    S.cursor = doel.range.end;
    S.last = { id: doel.id, page: doel.page, start: doel.range.start, end: doel.range.end };
  } else {
    S.cursor = doel.pos;
    S.last = null;
  }
  // Select it as the comments panel does (also both halves of a replace).
  const lijst = await import('../ui/panels/annotations-list.js');
  await lijst.selectAnnotationItem(doel.id, doel.page);
  toon({ zichtbaar: false });
}

function kiesAlles() {
  if (!S.model) return;
  vergeetPlek();
  S.anchor = 0;
  S.cursor = totalLength(S.model);
  toon({ zichtbaar: false });
}

function kopieer() {
  const sel = selectie();
  if (!sel || !S.model) return;
  const tekst = rangeText(S.model, sel.anchor, sel.focus);
  try { navigator.clipboard?.writeText(tekst)?.catch?.(() => {}); } catch { /* no clipboard */ }
}

function verlaat() {
  if (S.input) sluitInvoer(true);
  setTool('select');
}

function voerUit(cmd) {
  switch (cmd.type) {
    case 'toggle': verlaat(); return;
    case 'escape': {
      const stap = escapeStep({ inputOpen: !!S.input, selection: selectie() });
      if (stap === 'closeInput') sluitInvoer(false);
      else if (stap === 'clearSelection') { S.anchor = null; vergeetPlek(); toon({ zichtbaar: false }); }
      else verlaat();
      return;
    }
    case 'commit': sluitInvoer(true); return;
    case 'commitAndTab': sluitInvoer(true); springNaarCorrectie(cmd.dir); return;
    case 'input': return;
    case 'move': if (!S.input) beweeg(cmd.how, cmd.extend); return;
    case 'page': bladeren(cmd.dir); return;
    case 'type': openInvoer(cmd.text); return;
    case 'paste': openInvoer(''); return;
    case 'strike': schrap(cmd.dir, cmd.unit); return;
    case 'tab': springNaarCorrectie(cmd.dir); return;
    case 'selectAll': kiesAlles(); return;
    case 'copy': kopieer(); return;
    default: return;
  }
}

/** The model may be stale after a document switch or a page rotation. */
function modelKlopt() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;
  if (S.docId === doc.id && S.model && S.key === sleutel(doc, S.page)) return true;
  if (S.input) sluitInvoer(false);
  if (S.docId !== doc.id) { S.page = doc.currentPage || 1; S.cursor = 0; }
  S.anchor = null;
  vergeetPlek();
  begin(doc, S.page);
  return false;
}

function opToets(e) {
  // De voorkeuren nemen net een nieuwe sneltoets op (#714).
  if (isSneltoetsOpname()) return;
  if (!isProofreadingActive()) {
    // F2 tenzij de gebruiker die toets weghaalde of aan iets anders gaf (#714).
    if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
        && sneltoetsActief('review.proofreading', 'F2')
        && !isTextEntryTarget(e.target) && !isModalOpen() && getActiveDocument()?.pdfDoc) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleProofreading();
    }
    return;
  }
  const inEigenInvoer = !!S.input && e.target === S.input;
  // Other inputs (find bar, properties panel) and dialogs keep their keys.
  if (!inEigenInvoer && (isTextEntryTarget(e.target) || isModalOpen())) return;
  const cmd = keyCommand(e, { inputOpen: inEigenInvoer });
  if (!cmd) return;
  e.stopImmediatePropagation();
  // The input types and pastes by itself.
  if (cmd.type !== 'input' && cmd.type !== 'paste') e.preventDefault();
  if (!inEigenInvoer && cmd.type !== 'toggle' && cmd.type !== 'escape' && !modelKlopt()) return;
  voerUit(cmd);
}

let _geinstalleerd = false;
/** Window capture listener: before every other keydown handler (see initKeyboardHandlers). */
export function installProofreadingKeys() {
  if (_geinstalleerd || typeof window === 'undefined') return;
  _geinstalleerd = true;
  window.addEventListener('keydown', opToets, true);
}

function begin(doc, page) {
  const k = sleutel(doc, page);
  S.docId = doc.id;
  S.page = page;
  S.model = klaar.get(k) || null;
  S.key = S.model ? k : null;
  if (S.model) { S.cursor = Math.min(S.cursor, totalLength(S.model)); toon({ zichtbaar: false }); return; }
  laadModel(doc, page).then((model) => {
    if (!isProofreadingActive() || getActiveDocument()?.id !== doc.id || S.page !== page) return;
    S.model = model;
    S.key = k;
    S.cursor = Math.min(S.cursor, totalLength(model));
    if (model.lines.length === 0) updateStatusMessage(t('noText', 'This page has no text to proofread.'), 5000);
    toon({ zichtbaar: false });
  }).catch((err) => console.warn('[proofread] text of the page could not be read:', err));
}

function start() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const page = doc.currentPage || 1;
  if (S.docId !== doc.id || S.page !== page) { S.cursor = 0; }
  S.anchor = null;
  S.last = null;
  S.goal = null;
  S.currentId = null;
  // A focused ribbon button would take Space and Enter.
  const actief = typeof document !== 'undefined' ? document.activeElement : null;
  if (actief && actief !== document.body && !isTextEntryTarget(actief) && typeof actief.blur === 'function') actief.blur();
  updateStatusMessage(t('hint', 'Proofreading: arrow keys move the cursor, type to insert, Delete strikes out, Tab goes to the next correction, Esc steps back.'), 8000);
  begin(doc, page);
}

function stop() {
  if (S.input) sluitInvoer(true);
  S.dragging = false;
  S.anchor = null;
  S.model = null;
  S.key = null;
  S.last = null;
  S.currentId = null;
  clearProofreadingOverlay();
  wisCache();
  herteken();
}

/** Word around position g: from its start to its end (without trailing space). */
function woordRond(m, g) {
  const start = moveCursor(m, Math.min(totalLength(m), g + 1), 'wordLeft').pos;
  let eind = moveCursor(m, start, 'wordRight').pos;
  while (eind > start && /\s/u.test(charAt(m, eind - 1))) eind--;
  return { start, eind };
}

export const proofreadTool = {
  name: PROOFREAD_TOOL,
  cursor: 'text',

  onActivate() { start(); },
  onDeactivate() { stop(); },

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    const doc = getActiveDocument();
    if (!doc?.pdfDoc || !(ctx.pageNum >= 1)) return;
    if (S.input) sluitInvoer(true);
    const plaats = (model) => {
      const g = hitTest(model, ctx.x, ctx.y);
      const zelfdePagina = S.page === ctx.pageNum && S.model === model;
      S.docId = doc.id;
      S.page = ctx.pageNum;
      S.model = model;
      S.key = sleutel(doc, ctx.pageNum);
      vergeetPlek();
      if (e.detail === 2) {
        const w = woordRond(model, g);
        S.anchor = w.start;
        S.cursor = w.eind;
        S.dragging = false;
      } else if (e.shiftKey && zelfdePagina) {
        if (S.anchor === null) S.anchor = S.cursor;
        S.cursor = g;
        S.dragging = true;
      } else {
        S.anchor = g;
        S.cursor = g;
        S.dragging = true;
      }
      toon({ zichtbaar: false });
    };
    const k = sleutel(doc, ctx.pageNum);
    if (klaar.has(k)) plaats(klaar.get(k));
    else laadModel(doc, ctx.pageNum).then(plaats).catch(() => {});
  },

  onPointerMove(ctx, e) {
    if (!S.dragging || !S.model || ctx.pageNum !== S.page || !(e.buttons & 1)) return;
    const g = hitTest(S.model, ctx.x, ctx.y);
    if (g === S.cursor) return;
    S.cursor = g;
    toon({ zichtbaar: false });
  },

  onPointerUp() {
    S.dragging = false;
    if (S.anchor === S.cursor) S.anchor = null;
    return true;
  },
};
