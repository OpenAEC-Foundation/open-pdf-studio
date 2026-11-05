/**
 * Shape tool — handles box, circle, highlight, cloud, redaction, textbox, callout
 * (the polygon has its own corner-by-corner tool, polygon-tool.js)
 * All use the same drag-to-create pattern via buildAnnotationProps + drawShapePreview
 */
import { isKlikSleep } from '../../annotations/minimummaat.js';
import { weergaveVectorNaarPagina } from '../../pdf/weergave-ruimte.js';
import { state as appState, getActiveDocument } from '../../core/state.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';
import { getMeasureScale } from '../../annotations/measurement.js';
import { parseCoordBuffer, maatVormEindpunt } from '../coord-invoer.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  typeLengthActive,
  typeLengthBuffer,
} from '../type-length-input.js';
import { maakCalloutPlaatsing } from '../callout-plaatsing.js';

// ── Callout in twee klikken (#613): klik 1 = de punt, klik 2 = het tekstvak.
// Tussen de klikken een voorbeeld van aanhaallijn en tekstvak onder de
// cursor; Esc of een andere tool breekt af. Een sleep plaatst in één gebaar.
const _callout = maakCalloutPlaatsing();
// De pagina onder de cursor (doorlopende weergave), anders de huidige.
const _calloutPagina = (ctx) => ctx?.pageNum || getActiveDocument()?.currentPage || 1;
const _calloutOpDezePagina = (ctx) => _callout.actief && _callout.punt.pagina === _calloutPagina(ctx);

function _calloutStop(ctx) {
  if (!_callout.actief) return;
  _callout.stop();
  if (ctx && typeof ctx.redraw === 'function') ctx.redraw();
}

// ── Maatinvoer (CAD-stijl): klik = anker, typen + Enter = vorm met opgegeven
// maten. `500,300` = breedte × hoogte, één getal = vierkant / diameter.
// De geometrie volgt de cursorrichting (net als de lijn-tool), zodat je met
// de muis nog kantelt WAT je typt.
const MAAT_TOOLS = new Set(['box', 'circle', 'ellipse', 'lshape']);
const _dim = { actief: false, startX: 0, startY: 0, cursor: null, end: null, ctx: null };

function _dimStop() {
  if (_dim.actief && typeLengthActive()) exitTypeLengthMode();
  if (appState._typeLengthCommit) appState._typeLengthCommit = null;
  _dim.actief = false;
  _dim.cursor = null;
  _dim.end = null;
  _dim.ctx = null;
}

/** Eindpunt uit het getypte buffer, of null als er nog niets staat. */
function _dimEindpunt(ctx) {
  if (!_dim.actief) return null;
  const buf = typeLengthBuffer();
  if (!buf) return null;
  const ax = _dim.startX;
  const ay = _dim.startY;
  const page = getActiveDocument()?.currentPage || 1;
  const ppu = getMeasureScale(page, ax, ay).pixelsPerUnit || 1;
  // Eén getal = vierkant / diameter in het kwadrant van de cursor; de rest
  // volgt de regel van de lijn-tool (coord-invoer.js, maatVormEindpunt).
  const c = (ctx && Number.isFinite(ctx.x) && Number.isFinite(ctx.y)) ? ctx : (_dim.cursor || { x: ax, y: ay });
  return maatVormEindpunt(parseCoordBuffer(buf), ax, ay, c.x, c.y, ppu);
}

/** Start de maatinvoer na een klik-zonder-sleep. */
function _dimStart(ctx) {
  _dim.actief = true;
  _dim.startX = appState.startX;
  _dim.startY = appState.startY;
  _dim.cursor = { x: ctx.x, y: ctx.y };
  _dim.end = null;
  _dim.ctx = ctx;
  enterTypeLengthMode(_dim.startX, _dim.startY);
  appState._typeLengthCommit = _dimCommit;
  updateStatusMessage(
    i18next.t('drawing.dimInputHint', {
      ns: 'ribbon',
      defaultValue: 'Type dimensions (e.g. 500,300 or a single size) and press Enter — or drag to draw',
    }),
    6000,
  );
}

/** Enter: de vorm met de getypte maten tekenen. */
function _dimCommit() {
  const ctx = _dim.ctx;
  let end = _dim.end || _dimEindpunt(null);
  if (!ctx || !end) { _dimStop(); return; }
  const tool = appState.currentTool;
  if (tool === 'circle') end = _squareEnd(_dim.startX, _dim.startY, end.x, end.y);
  _dimStop();

  const ann = ctx.createAnnotationFromTool(tool, _dim.startX, _dim.startY, end.x, end.y, {
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
  });
  const doc = getActiveDocument();
  if (ann && doc) {
    doc.annotations.push(ann);
    ctx.recordAdd(ann);
  }
  ctx.redraw();
  import('../manager.js').then((m) => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

export const shapeTool = {
  name: 'shape',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    // Een nieuwe klik breekt een openstaande maatinvoer af (opnieuw ankeren).
    if (_dim.actief) _dimStop();
    const { state } = ctx;
    // Klik 2 van een callout: het voorbeeld blijft aan de punt vastzitten
    // terwijl de knop ingedrukt is.
    if (state.currentTool === 'callout' && _calloutOpDezePagina(ctx)) {
      state.startX = _callout.punt.x;
      state.startY = _callout.punt.y;
    }
    state.isDrawing = true;
    // Start the marching-ants animation as soon as a redaction drag begins so
    // the live preview border animates while dragging (and keeps animating for
    // the resulting pending mark). The loop self-terminates when no redaction
    // remains pending.
    if (state.currentTool === 'redaction') {
      import('../../pdf/pdf-viewport.js').then(m => m.kickRedactAnts && m.kickRedactAnts());
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state } = ctx;

    // Maatinvoer actief: voorbeeld van de vorm met de getypte maten.
    if (_dim.actief) {
      _dim.cursor = { x, y };
      const end = _dimEindpunt(ctx);
      if (!end) return;
      _dim.end = state.currentTool === 'circle'
        ? _squareEnd(_dim.startX, _dim.startY, end.x, end.y)
        : end;
      ctx.drawShapePreview(_dim.end.x, _dim.end.y, e);
      return;
    }

    // Callout tussen klik 1 en klik 2: aanhaallijn van de punt naar de cursor
    // en het tekstvak eronder, zoals het straks geplaatst wordt.
    if (!state.isDrawing && state.currentTool === 'callout' && _calloutOpDezePagina(ctx)) {
      const snap = ctx.snap(x, y);
      state.lastSnapResult = snap.snapped ? snap : null;
      state.startX = _callout.punt.x;
      state.startY = _callout.punt.y;
      ctx.drawShapePreview(snap.snapped ? snap.x : x, snap.snapped ? snap.y : y, e);
      return;
    }

    if (!state.isDrawing) {
      // Hover snap indicator
      _drawHoverSnap(ctx, x, y);
      return;
    }

    // Snap cursor position for shape preview
    const snap = ctx.snap(x, y);
    let previewX = snap.snapped ? snap.x : x;
    let previewY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;
    // Circle tool: constrain the drag to a 1:1 square so it previews a true circle.
    if (state.currentTool === 'circle') {
      const sq = _squareEnd(state.startX, state.startY, previewX, previewY);
      previewX = sq.x; previewY = sq.y;
      state.lastSnapResult = null;
    }
    ctx.drawShapePreview(previewX, previewY, e);
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;

    const rawX = ctx.x, rawY = ctx.y;
    const endSnap = ctx.snap(rawX, rawY);
    let endX = endSnap.snapped ? endSnap.x : ctx.snapToGrid(rawX);
    let endY = endSnap.snapped ? endSnap.y : ctx.snapToGrid(rawY);
    state.lastSnapResult = null;
    state.isDrawing = false;

    const tool = state.currentTool;

    // Single-click detection: if barely dragged, use default size.
    // Klik of sleep is een SCHERMbegrip: de drempel staat in schermpixels
    // (px / zoom). Een vaste drempel in paginapunten (5 pt = 176 mm op 1:100)
    // slokte ingezoomd een bewuste sleep van honderden pixels op.
    const dx = Math.abs(endX - state.startX);
    const dy = Math.abs(endY - state.startY);
    const isClick = isKlikSleep(dx, dy, ctx.scale);

    if (tool === 'callout') {
      // Klik 1 onthoudt de punt (de tool blijft actief), klik 2 plaatst het
      // tekstvak; een sleep plaatst in één gebaar (callout-plaatsing.js).
      const stap = _callout.loslaten({
        start: { x: state.startX, y: state.startY },
        eind: { x: endX, y: endY },
        klik: isClick,
        pagina: _calloutPagina(ctx),
      });
      if (stap.soort !== 'plaats') {
        if (stap.soort === 'punt') {
          updateStatusMessage(
            i18next.t('drawing.calloutStep2', {
              ns: 'ribbon',
              defaultValue: 'Click where the note should go — Esc to cancel',
            }),
            6000,
          );
        }
        ctx.redraw();
        return true;
      }
      state.startX = stap.punt.x;
      state.startY = stap.punt.y;
      endX = stap.notitie.x;
      endY = stap.notitie.y;
      // Tekstvak op de punt (dubbelklik): op het scherm rechtsboven de punt,
      // ook in een gedraaide weergave.
      if (isKlikSleep(Math.abs(endX - state.startX), Math.abs(endY - state.startY), ctx.scale)) {
        const naar = weergaveVectorNaarPagina(80, -40);
        endX = state.startX + naar.x;
        endY = state.startY + naar.y;
      }
    } else if (isClick && tool === 'textbox') {
      // Compact standaardvak, passend bij de 8pt-standaardtekst: op het
      // scherm naar rechts en omlaag, ook in een gedraaide weergave (#200).
      const naar = weergaveVectorNaarPagina(100, 20);
      endX = state.startX + naar.x;
      endY = state.startY + naar.y;
    } else if (isClick && tool === 'mask') {
      // Maskeer: a single click PLACES a default-size cover (the user thinks
      // "plaatsen", not "drag a rectangle"); dragging still sets a custom size.
      // Op het scherm rechts onder de klik, ook in een gedraaide weergave.
      const naar = weergaveVectorNaarPagina(200, 140);
      endX = state.startX + naar.x;
      endY = state.startY + naar.y;
    } else if (isClick && (tool === 'comment' || tool === 'stamp' || tool === 'signature' || tool === 'count')) {
      // These already handle single click (count = place one marker at the click)
    } else if (isClick && tool === 'parametricSymbol') {
      // Single click: use template default size
      // (handled inside buildAnnotationProps via b.width/height fallback)
    } else if (isClick && tool === 'stavenreeks') {
      // Single click: place a default-length series (the creator falls back to
      // 120 px horizontally when start and end coincide).
    } else if (isClick && MAAT_TOOLS.has(tool)) {
      // Klik zonder sleep in plaats van "weggooien": de gebruiker kan nu
      // de maten intypen (500,300 of één getal) + Enter. Zonder invoer
      // blijft de tool gewoon actief voor de volgende poging.
      _dimStart(ctx);
      ctx.redraw();
      return true;
    } else if (isClick) {
      // Other shapes: too small to be useful, skip creation
      ctx.redraw();
      return false;
    }

    // Circle tool: square the bbox so the committed shape is a true circle.
    if (tool === 'circle') {
      const sq = _squareEnd(state.startX, state.startY, endX, endY);
      endX = sq.x; endY = sq.y;
    }

    const ann = ctx.createAnnotationFromTool(tool, state.startX, state.startY, endX, endY, e);
    if (ann) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
    ctx.redraw();

    // Auto-start text editing for textbox/callout
    if (ann && ['textbox', 'callout'].includes(ann.type)) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) { doc.selectedAnnotations = [ann]; doc.selectedAnnotation = ann; }
      ctx.showProperties(ann);
      ctx.startTextEditing(ann, { nieuw: true });
    }

    // Auto-reset to select tool
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());

    return true;
  },

  // Maatinvoer netjes afbreken (Escape wisselt daarna naar de selectietool;
  // wisselen van gereedschap ruimt via onDeactivate dezelfde state op).
  onEscape(ctx) {
    if (_dim.actief) _dimStop();
    _calloutStop(ctx);
  },

  onDeactivate(ctx) {
    if (_dim.actief) _dimStop();
    _calloutStop(ctx);
  },
};

/** Constrain (ex,ey) so |dx| == |dy| relative to (sx,sy) — yields a square
 *  bounding box (a true circle) while preserving the drag direction. */
function _squareEnd(sx, sy, ex, ey) {
  const dx = ex - sx, dy = ey - sy;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: sx + (dx < 0 ? -s : s), y: sy + (dy < 0 ? -s : s) };
}

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  const { state } = ctx;
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}
