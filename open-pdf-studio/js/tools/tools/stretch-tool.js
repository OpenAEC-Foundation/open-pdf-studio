/**
 * Stretch-gereedschap (AutoCAD STRETCH) — hoekpunten verplaatsen, rest blijft.
 *
 * Fasen:
 *   1. Ruit: sleep een selectieruit over de hoekpunten die mee moeten bewegen
 *      (of klik op één object — dan gaan alle hoeken van dat object mee).
 *   2. Verplaatsing: klik een basispunt, sleep en laat los. De hoeken in de
 *      ruit volgen de muis; de rest van de vorm blijft staan.
 *
 * Werkt op de selectie als die er is, anders op alle objecten van de pagina.
 * De geometrie zit in annotations/stretch-geometry.js (puur, getest).
 */
import { state, getActiveDocument } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordBulkModify } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import { annotationCtx } from '../../ui/dom-elements.js';
import { applyToolTransform } from '../tool-transform.js';
import i18next from '../../i18n/config.js';
import { verticesOf, stretchAnnotation, canStretch } from '../../annotations/stretch-geometry.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  typeLengthActive,
  typeLengthBuffer,
  clearTypeLengthBuffer,
} from '../type-length-input.js';
import { parseCoordBuffer } from '../coord-invoer.js';
import { getMeasureScale } from '../../annotations/measurement.js';

const _s = {
  fase: 'ruit',        // 'ruit' | 'verplaats'
  start: null,         // linkerbovenhoek van de ruit (tijdens slepen)
  ruit: null,          // {x1,y1,x2,y2} na loslaten
  basis: null,         // basispunt van de verplaatsing
  doelen: null,        // [{ ann, orig }]
  ownsCommit: false,   // deze sessie heeft de CAD-invoer (commit-hook) in handen
};

function _t(key, def) {
  return i18next.t(key, { ns: 'ribbon', defaultValue: def });
}

function _bericht(def, key) {
  updateStatusMessage(key ? _t(key, def) : def, 5000);
}

function _reset() {
  _s.fase = 'ruit';
  _s.start = null;
  _s.ruit = null;
  _s.basis = null;
  _s.doelen = null;
  state.isDrawing = false;
  // Laat geen CAD-invoer of commit-hook achter (anders vangt de volgende
  // tool de toetsaanslagen van stretch nog op).
  if (_s.ownsCommit) {
    if (typeLengthActive()) exitTypeLengthMode();
    if (state._typeLengthCommit) state._typeLengthCommit = null;
    _s.ownsCommit = false;
  }
}

function _inRuit(r) {
  const minX = Math.min(r.x1, r.x2), maxX = Math.max(r.x1, r.x2);
  const minY = Math.min(r.y1, r.y2), maxY = Math.max(r.y1, r.y2);
  return (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

/** Kandidaten: de selectie, anders alles op deze pagina. */
function _kandidaten(pageNum) {
  const doc = getActiveDocument();
  if (!doc) return [];
  const sel = (doc.selectedAnnotations || []).filter((a) => a.page === pageNum);
  if (sel.length > 0) return sel;
  return (doc.annotations || []).filter((a) => a.page === pageNum);
}

/** Tijdelijke tekening van de crossing window (dashed rechthoek). */
function _tekenRuit(x1, y1, x2, y2) {
  const c = annotationCtx;
  if (!c) return;
  redrawAnnotations();
  try {
    c.save();
    applyToolTransform(c);
    c.strokeStyle = '#2563eb';
    c.lineWidth = 1;
    c.setLineDash([6, 4]);
    c.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    c.setLineDash([]);
    c.restore();
  } catch (_) { /* canvas niet beschikbaar */ }
}

/** Verzamel objecten met ten minste één hoekpunt in de ruit. */
function _doelenIn(ruit, pageNum) {
  const test = _inRuit(ruit);
  const doelen = [];
  for (const a of _kandidaten(pageNum)) {
    if (!canStretch(a)) continue;
    if (verticesOf(a).some(test)) doelen.push({ ann: a, orig: cloneAnnotation(a) });
  }
  return doelen;
}

export const stretchTool = {
  name: 'stretch',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) { _reset(); ctx.redraw(); return; }

    if (_s.fase === 'ruit') {
      _s.start = { x: ctx.x, y: ctx.y };
      state.isDrawing = true;
      return;
    }

    // Fase verplaatsing: basispunt vastleggen en het slepen starten.
    _s.basis = { x: ctx.x, y: ctx.y };
    state.isDrawing = true;
    _bericht('Stretch: drag — the corners in the window follow the cursor', 'drawing.stretchDragging');
  },

  onPointerMove(ctx, e) {
    if (!state.isDrawing) return;

    if (_s.fase === 'ruit' && _s.start) {
      _tekenRuit(_s.start.x, _s.start.y, ctx.x, ctx.y);
      return;
    }

    if (_s.fase === 'verplaats' && _s.basis && _s.doelen) {
      const dx = ctx.x - _s.basis.x;
      const dy = ctx.y - _s.basis.y;
      const test = _inRuit(_s.ruit);
      for (const t of _s.doelen) stretchAnnotation(t.orig, t.ann, dx, dy, test);
      ctx.redraw();
    }
  },

  onPointerUp(ctx, e) {
    if (!state.isDrawing) return true;
    state.isDrawing = false;

    if (_s.fase === 'ruit' && _s.start) {
      const ruit = { x1: _s.start.x, y1: _s.start.y, x2: ctx.x, y2: ctx.y };
      _s.start = null;
      let doelen = _doelenIn(ruit, ctx.pageNum);

      // Klik (geen sleep) op één object → alle hoeken van dat object mee.
      if (doelen.length === 0) {
        const hit = ctx.findAnnotationAt(ctx.x, ctx.y);
        if (hit && canStretch(hit) && hit.page === ctx.pageNum) {
          doelen = [{ ann: hit, orig: cloneAnnotation(hit) }];
        }
      }
      if (doelen.length === 0) {
        ctx.redraw();
        _bericht(
          'Stretch: no corners in the window — drag across the edges you want to stretch',
          'drawing.stretchEmpty',
        );
        return true;
      }
      _s.ruit = ruit;
      _s.doelen = doelen;
      _s.fase = 'verplaats';
      // CAD-invoer openen: de verplaatsing mag ook getypt worden (dx,dy of
      // polair) in plaats van te slepen — muis EN toetsbord werken allebei.
      enterTypeLengthMode((ruit.x1 + ruit.x2) / 2, (ruit.y1 + ruit.y2) / 2);
      state._typeLengthCommit = _commitVerschuiving;
      _s.ownsCommit = true;
      _bericht(
        'Stretch: drag from a base point — or type a displacement like 50,0 and press Enter',
        'drawing.stretchTyped',
      );
      return true;
    }

    if (_s.fase === 'verplaats' && _s.doelen) {
      const dx = ctx.x - _s.basis.x;
      const dy = ctx.y - _s.basis.y;
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
        // Klik zonder verplaatsing: opnieuw basispunt kiezen.
        _s.basis = { x: ctx.x, y: ctx.y };
        return true;
      }
      const test = _inRuit(_s.ruit);
      for (const t of _s.doelen) stretchAnnotation(t.orig, t.ann, dx, dy, test);
      recordBulkModify(_s.doelen.map((t) => t.ann), _s.doelen.map((t) => t.orig));
      ctx.redraw();
      _bericht('Stretched — drag another window, or press Escape', 'drawing.stretchDone');
      _reset();
      return true;
    }

    return true;
  },

  onEscape() { _reset(); },
  onDeactivate() { _reset(); },
};

/**
 * Getypte verplaatsing: `50,0` (dx,dy), `100<45` (polair) of negatieve
 * waarden — in de schaaleenheden van het document, zoals de rest van de
 * CAD-invoer. Alleen een los getal ("50") heeft geen richting en wordt
 * geweigerd met een hint.
 */
function _commitVerschuiving() {
  const r = parseCoordBuffer(typeLengthBuffer());
  let dx = null, dy = null;
  if (r.kind === 'cartesian' && r.a != null && r.b != null) {
    dx = r.a; dy = r.b;
  } else if (r.kind === 'polar' && r.a != null && r.b != null) {
    // Zelfde hoekconventie als beperkEindpunt: app-Y wijkt omlaag,
    // getypte hoek is mathematisch (CCW vanaf +X).
    const theta = -r.b * Math.PI / 180;
    dx = r.a * Math.cos(theta);
    dy = r.a * Math.sin(theta);
  }
  if (dx == null || dy == null || (dx === 0 && dy === 0)) {
    clearTypeLengthBuffer();
    _bericht(
      'Stretch: type a displacement like 50,0 or 100<45 and press Enter',
      'drawing.stretchDisplacementInvalid',
    );
    return;
  }
  if (!_s.doelen || !_s.ruit) { _reset(); return; }
  const page = _s.doelen[0].ann.page ?? getActiveDocument()?.currentPage ?? 1;
  const ax = (_s.ruit.x1 + _s.ruit.x2) / 2;
  const ay = (_s.ruit.y1 + _s.ruit.y2) / 2;
  const ppu = getMeasureScale(page, ax, ay).pixelsPerUnit || 1;
  const test = _inRuit(_s.ruit);
  for (const t of _s.doelen) stretchAnnotation(t.orig, t.ann, dx * ppu, dy * ppu, test);
  recordBulkModify(_s.doelen.map((t) => t.ann), _s.doelen.map((t) => t.orig));
  redrawAnnotations();
  _bericht('Stretched — drag another window, or press Escape', 'drawing.stretchDone');
  _reset();
}

/** Start het gereedschap met een korte instructie (ribbon-knop). */
export async function startStretchTool() {
  const m = await import('../manager.js');
  m.setTool('stretch');
  _reset();
  _bericht('Stretch: drag a crossing window over the corners to stretch', 'drawing.stretchHint');
}
