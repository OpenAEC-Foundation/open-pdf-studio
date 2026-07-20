import { state, getActiveDocument } from '../../core/state.js';
import { recordBulkAdd } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';
// Edit-ops contract: duplication via cloneForInsert, translation via the
// generic applyMove field-walker — NO per-type offset code in tools.
import { cloneForInsert } from '../edit-ops.js';
import { applyMoveGeneric } from '../../annotations/transforms.js';

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
    if (count < 2 || Math.hypot(dx, dy) < 0.5) {
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
      const doc = getActiveDocument();
      const scale = doc?.scale || 1.5;
      const c = canvas.getContext('2d');
      const base = _arrayState.basePoint;

      c.save();
      c.setLineDash([4, 4]);
      c.strokeStyle = '#0066FF';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(base.x * scale, base.y * scale);
      c.lineTo(x * scale, y * scale);
      c.stroke();

      const count = _arrayState.count;
      const ddx = x - base.x;
      const ddy = y - base.y;
      for (let i = 1; i < count; i++) {
        const frac = i / (count - 1 || 1);
        const px = (base.x + ddx * frac) * scale;
        const py = (base.y + ddy * frac) * scale;
        c.beginPath();
        c.arc(px, py, 3, 0, Math.PI * 2);
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
