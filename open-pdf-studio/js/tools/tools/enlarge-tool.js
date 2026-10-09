/**
 * Vergroten (AutoCAD SCALE) — de selectie uniform schalen rond een basispunt.
 *
 * Werking:
 *   1. Selecteer de objecten en druk op Vergroten (of de ribbon-knop start
 *      het gereedschap direct met het selectiemiddelpunt als basispunt).
 *   2. Typ de schaalfactor + Enter (1.5 = 50% groter, 0.5 = half zo groot).
 *      Een klik op de tekening kiest eerst een ander basispunt; daarna kun
 *      je opnieuw typen.
 *
 * Terwijl je tydt loopt een live voorbeeld: bij Escape of een leeg veld
 * springt alles terug naar de originele situatie.
 *
 * De geometrie zit in annotations/scale-geometry.js (puur, getest).
 */
import { state, getActiveDocument } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordBulkModify } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';
import { scaleAnnotation } from '../../annotations/scale-geometry.js';
import { verticesOf } from '../../annotations/stretch-geometry.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  typeLengthActive,
  typeLengthBuffer,
  clearTypeLengthBuffer,
} from '../type-length-input.js';
import { parseCoordBuffer } from '../coord-invoer.js';

const _s = {
  anns: null,      // annotaties in de huidige sessie
  origs: null,     // clones voor preview/herstel
  basis: null,     // basispunt
  ownsCommit: false,
};

function _bericht(def, key, opts) {
  updateStatusMessage(key ? i18next.t(key, { ns: 'ribbon', defaultValue: def, ...opts }) : def, 5000);
}

/** Herstel de annotaties naar de originele situatie (preview annuleren). */
function _herstel() {
  if (!_s.anns || !_s.origs) return;
  for (let i = 0; i < _s.anns.length; i++) {
    Object.assign(_s.anns[i], _s.origs[i]);
  }
}

function _stopInvoer() {
  if (_s.ownsCommit) {
    if (typeLengthActive()) exitTypeLengthMode();
    if (state._typeLengthCommit) state._typeLengthCommit = null;
  }
  _s.ownsCommit = false;
}

function _reset() {
  _stopInvoer();
  _s.anns = null;
  _s.origs = null;
  _s.basis = null;
}

/** Midden van de selectie — het standaardbasispunt. */
function _midden(anns) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of anns) {
    for (const p of verticesOf(a)) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Factor uit het invoerbuffer, of null als het geen getal is. */
function _factor() {
  const buf = typeLengthBuffer();
  if (!buf) return null;
  const r = parseCoordBuffer(buf);
  if (!r || r.kind !== 'length') return null;
  return r.a > 0 ? r.a : null;
}

/** Start de invoer voor een basispunt + factor. */
function _startInvoer() {
  enterTypeLengthMode(_s.basis.x, _s.basis.y);
  state._typeLengthCommit = _commitFactor;
  _s.ownsCommit = true;
  _bericht('Enlarge: type the scale factor (e.g. 1.5) and press Enter', 'drawing.enlargeFactor');
}

function _commitFactor(factor) {
  if (!factor || factor <= 0) {
    clearTypeLengthBuffer();
    _bericht('Enlarge: enter a positive factor, e.g. 1.5 or 0.5', 'drawing.enlargeFactorInvalid');
    return;
  }
  if (!_s.anns || !_s.origs) { _reset(); return; }
  for (let i = 0; i < _s.anns.length; i++) {
    Object.assign(_s.anns[i], _s.origs[i]);
    scaleAnnotation(_s.anns[i], _s.basis.x, _s.basis.y, factor);
  }
  recordBulkModify(_s.anns, _s.origs);
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
  _bericht(
    `Enlarge: scaled by ${factor}`,
    'drawing.enlargeDone',
    { factor },
  );
  _reset();
}

/** Start het gereedschap met de huidige selectie (ribbon-knop). */
export async function startEnlargeTool() {
  const m = await import('../manager.js');
  m.setTool('enlarge');
  _startMetSelectie();
}

function _startMetSelectie() {
  const sel = getActiveDocument()?.selectedAnnotations || [];
  if (sel.length === 0) {
    _bericht('Enlarge: select the objects to enlarge first', 'drawing.enlargeNoSelection');
    return false;
  }
  _s.anns = sel.slice();
  _s.origs = _s.anns.map((a) => cloneAnnotation(a));
  const mid = _midden(_s.anns);
  if (!mid) { _reset(); return false; }
  _s.basis = mid;
  _startInvoer();
  return true;
}

export const enlargeTool = {
  name: 'enlarge',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) { _herstel(); ctx.redraw(); _reset(); return; }

    // Eerste klik: basispunt kiezen (selectie vastleggen).
    const sel = getActiveDocument()?.selectedAnnotations || [];
    if (!_s.anns) {
      if (sel.length === 0) {
        _bericht('Enlarge: select the objects to enlarge first', 'drawing.enlargeNoSelection');
        return;
      }
      _s.anns = sel.slice();
      _s.origs = _s.anns.map((a) => cloneAnnotation(a));
    }
    _s.basis = { x: ctx.x, y: ctx.y };
    _startInvoer();
  },

  onPointerMove(ctx, e) {
    if (!_s.anns || !_s.basis) return;
    const factor = _factor();
    if (factor == null) {
      // Geen (geldige) invoer: toon de originele situatie.
      _herstel();
      ctx.redraw();
      return;
    }
    for (let i = 0; i < _s.anns.length; i++) {
      Object.assign(_s.anns[i], _s.origs[i]);
      scaleAnnotation(_s.anns[i], _s.basis.x, _s.basis.y, factor);
    }
    ctx.redraw();
  },

  onEscape() {
    _herstel();
    _reset();
  },

  onDeactivate() {
    _herstel();
    _reset();
  },
};
