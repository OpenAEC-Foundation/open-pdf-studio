import i18next from '../../i18n/config.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import { state, getActiveDocument } from '../../core/state.js';
import { lineLineIntersection } from '../../annotations/geometry.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordModify } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _extState = { boundary: null };

function _t(key, def) {
  return i18next.t(key, { ns: 'ribbon', defaultValue: def });
}

function _bericht(def, key) {
  updateStatusMessage(_t(key, def), 5000);
}

// Lijn-achtige objecten: alleen die hebben start-/eindpunt en kunnen
// worden verlengd of als begrenzing dienen.
function _isLijn(ann) {
  return !!ann && ann.startX !== undefined && ann.endX !== undefined;
}

export const extendTool = {
  name: 'extend',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const clicked = ctx.findAnnotationAt(x, y);

    if (!_extState.boundary) {
      if (!clicked) {
        _bericht('Extend: click the boundary edge (a line) the extension should reach',
          'drawing.extendPickBoundary');
        return;
      }
      if (!_isLijn(clicked)) {
        _bericht('Extend: the boundary must be a line, arrow or wall — click a line',
          'drawing.extendBoundaryNotLine');
        return;
      }
      _extState.boundary = clicked;
      const doc = getActiveDocument();
      if (doc) { doc.selectedAnnotations = [clicked]; doc.selectedAnnotation = clicked; }
      redrawAnnotations();
      _bericht('Extend: boundary set — now click the line to extend',
        'drawing.extendTargetHint');
      return;
    }

    const target = clicked;
    if (target === _extState.boundary) { _extState.boundary = null; return; }
    if (!_isLijn(target)) {
      _bericht('Extend: only lines, arrows and walls can be extended — click a line',
        'drawing.extendTargetNotLine');
      _extState.boundary = null;
      return;
    }

    const tp1 = { x: target.startX, y: target.startY };
    const tp2 = { x: target.endX, y: target.endY };
    const bp1 = { x: _extState.boundary.startX, y: _extState.boundary.startY };
    const bp2 = { x: _extState.boundary.endX, y: _extState.boundary.endY };

    const ix = lineLineIntersection(tp1, tp2, bp1, bp2);
    if (!ix || (ix.u < -0.01 || ix.u > 1.01)) {
      // De oneindige verlenging van de lijn snijdt het begrenzingssegment
      // niet: meld het, anders lijkt het alsof het gereedschap niets doet.
      _bericht('Extend: those lines do not intersect — pick another boundary',
        'drawing.extendNoIntersection');
      _extState.boundary = null;
      redrawAnnotations();
      return;
    }

    const oldState = cloneAnnotation(target);

    const d1 = Math.hypot(ix.x - target.startX, ix.y - target.startY);
    const d2 = Math.hypot(ix.x - target.endX, ix.y - target.endY);
    if (d1 < d2) {
      target.startX = ix.x; target.startY = ix.y;
    } else {
      target.endX = ix.x; target.endY = ix.y;
    }

    target.modifiedAt = new Date().toISOString();
    recordModify(target.id, oldState, target);
    redrawAnnotations();
    _extState.boundary = null;
    _bericht('Extended to the boundary', 'drawing.extendDone');
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onDeactivate() { _extState.boundary = null; },
};

/** Start het gereedschap met een korte instructie (ribbon-knop). */
export async function startExtendTool() {
  const m = await import('../manager.js');
  m.setTool('extend');
  _extState.boundary = null;
  _bericht('Extend: click the boundary edge, then the line to extend',
    'drawing.extendHint');
}
