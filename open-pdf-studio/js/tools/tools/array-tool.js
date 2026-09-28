import { state, getActiveDocument } from '../../core/state.js';
import { recordBulkAdd } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';
// Edit-ops contract: duplication via cloneForInsert, translation via the
// generic applyMove field-walker — NO per-type offset code in tools.
import { cloneForInsert } from '../edit-ops.js';
import { applyMoveGeneric } from '../../annotations/transforms.js';
import { schermPxNaarPt } from '../../annotations/minimummaat.js';
import { applyToolTransform } from '../tool-transform.js';
import { getEffectiveScale } from '../effective-scale.js';

const _arrayState = { basePoint: null, count: 3, mode: 'linear' };

export const arrayTool = {
  name: 'array',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const doc = getActiveDocument();
    if (!doc) return;
    const selected = doc.selectedAnnotations;
    if (!selected || selected.length === 0) return;

    if (!_arrayState.basePoint) {
      _arrayState.basePoint = { x, y };
      return;
    }

    const base = _arrayState.basePoint;
    const dx = x - base.x;
    const dy = y - base.y;
    const count = _arrayState.count;
    // "Geen verplaatsing" is een schermbegrip: 2 schermpixels (px / zoom) in
    // plaats van 0,5 pt (17,6 mm op 1:100), zodat een fijne steek ingezoomd kan.
    if (count < 2 || Math.hypot(dx, dy) < schermPxNaarPt(2, ctx.scale)) {
      _arrayState.basePoint = null;
      return;
    }

    const created = [];
    for (const srcAnn of selected) {
      for (let i = 1; i < count; i++) {
        const frac = i / (count - 1 || 1);
        const copy = cloneForInsert(srcAnn);
        applyMoveGeneric(copy, dx * frac, dy * frac);
        created.push(copy);
      }
    }
    doc.annotations.push(...created);
    recordBulkAdd(created);

    redrawAnnotations();
    _arrayState.basePoint = null;
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onPointerMove(ctx, e) {
    if (_arrayState.basePoint) {
      redrawAnnotations();
      const { x, y, canvas } = ctx;
      const c = canvas.getContext('2d');
      const base = _arrayState.basePoint;
      // In paginacoördinaten tekenen met dezelfde transform als de
      // annotatieweergave (viewport, doorlopend, gedraaide weergave #200);
      // lijndikte, streepjes en stippen in schermpixels.
      const px1 = 1 / (getEffectiveScale() || 1);

      c.save();
      applyToolTransform(c);
      c.setLineDash([4 * px1, 4 * px1]);
      c.strokeStyle = '#0066FF';
      c.lineWidth = px1;
      c.beginPath();
      c.moveTo(base.x, base.y);
      c.lineTo(x, y);
      c.stroke();

      const count = _arrayState.count;
      const ddx = x - base.x;
      const ddy = y - base.y;
      for (let i = 1; i < count; i++) {
        const frac = i / (count - 1 || 1);
        const px = base.x + ddx * frac;
        const py = base.y + ddy * frac;
        c.beginPath();
        c.arc(px, py, 3 * px1, 0, Math.PI * 2);
        c.fillStyle = '#0066FF';
        c.fill();
      }
      c.restore();
    }
  },

  onDeactivate() { _arrayState.basePoint = null; },
};

export function setArrayCount(n) { _arrayState.count = Math.max(2, Math.min(50, n)); }
export function setArrayMode(m) { _arrayState.mode = m; }
export function getArrayState() { return { count: _arrayState.count, mode: _arrayState.mode }; }
