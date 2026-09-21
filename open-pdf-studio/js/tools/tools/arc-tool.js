/**
 * Arc tool — 3-point arc drawing
 * Click three points: start, mid-point on arc, end.
 * The arc is computed as the circular arc passing through all three points.
 */
import { state, getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { MIN_VORM_MAAT_PT } from '../../annotations/minimummaat.js';

const _arcState = { clicks: [] };

function calculateArcFrom3Points(p1, p2, p3) {
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-10) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const radius = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy));
  // Alleen een technische wacht: de collineariteitstest hierboven vangt de
  // ontaarde gevallen al. Een vaste ondergrens van 1 pt verbood bogen met een
  // werkelijke straal onder 35 mm op een tekening 1:100.
  if (!Number.isFinite(radius) || radius < MIN_VORM_MAAT_PT) return null;

  const startAngle = Math.atan2(p1.y - uy, p1.x - ux);
  const midAngle = Math.atan2(p2.y - uy, p2.x - ux);
  const endAngle = Math.atan2(p3.y - uy, p3.x - ux);

  function normalizeAngle(a) { return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }
  const ns = normalizeAngle(startAngle);
  const nm = normalizeAngle(midAngle);
  const ne = normalizeAngle(endAngle);
  const ccwSpan = normalizeAngle(ne - ns);
  const midInCcw = normalizeAngle(nm - ns) <= ccwSpan;

  if (midInCcw) {
    return { centerX: ux, centerY: uy, radius, startAngle, endAngle };
  } else {
    return { centerX: ux, centerY: uy, radius, startAngle: endAngle, endAngle: startAngle };
  }
}

export const arcTool = {
  name: 'arc',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) {
      // Right-click cancels (shared routine, also used by Escape)
      _cancelArcDrawing(ctx);
      return;
    }

    const rawX = ctx.x, rawY = ctx.y;
    const snap = ctx.snap(rawX, rawY);
    const sx = snap.snapped ? snap.x : ctx.snapToGrid(rawX);
    const sy = snap.snapped ? snap.y : ctx.snapToGrid(rawY);
    _arcState.clicks.push({ x: sx, y: sy });
    state.isDrawing = true;

    if (_arcState.clicks.length === 3) {
      const [p1, p2, p3] = _arcState.clicks;
      const arc = calculateArcFrom3Points(p1, p2, p3);
      _arcState.clicks = [];
      state.isDrawing = false;
      state.lastSnapResult = null;

      if (arc) {
        const doc = getActiveDocument();
        const prefs = state.preferences || {};
        const ann = ctx.createAnnotation({
          type: 'arc',
          page: doc?.currentPage || 1,
          centerX: arc.centerX,
          centerY: arc.centerY,
          radius: arc.radius,
          startAngle: arc.startAngle,
          endAngle: arc.endAngle,
          color: prefs.lineStrokeColor || '#000000',
          lineWidth: prefs.lineLineWidth || 1,
          opacity: (prefs.lineOpacity ?? 100) / 100,
        });
        if (doc) {
          doc.annotations.push(ann);
          doc.selectedAnnotations = [ann];
          doc.selectedAnnotation = ann;
        }
        ctx.recordAdd(ann);
        ctx.redraw();
        import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
      } else {
        ctx.redraw();
      }
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, canvasCtx } = ctx;

    if (_arcState.clicks.length === 0) {
      const snap = ctx.snap(x, y);
      if (snap.snapped) {
        state.lastSnapResult = snap;
        ctx.redraw();
        ctx.drawSnapIndicator(snap);
      } else if (state.lastSnapResult) {
        state.lastSnapResult = null;
        ctx.redraw();
      }
      return;
    }

    if (!canvasCtx) return;

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.setLineDash([4, 4]);
    canvasCtx.strokeStyle = '#FF0000';
    canvasCtx.lineWidth = 1;

    if (_arcState.clicks.length === 1) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(_arcState.clicks[0].x, _arcState.clicks[0].y);
      canvasCtx.lineTo(x, y);
      canvasCtx.stroke();
    } else if (_arcState.clicks.length === 2) {
      const arc = calculateArcFrom3Points(_arcState.clicks[0], _arcState.clicks[1], { x, y });
      if (arc) {
        canvasCtx.beginPath();
        canvasCtx.arc(arc.centerX, arc.centerY, arc.radius, arc.startAngle, arc.endAngle);
        canvasCtx.stroke();
      }
    }
    canvasCtx.restore();

    const snap = ctx.snap(x, y);
    if (snap.snapped) {
      state.lastSnapResult = snap;
      ctx.drawSnapIndicator(snap);
    }
  },

  onPointerUp(ctx, e) {
    if (_arcState.clicks.length > 0) return true;
    return false;
  },

  // Escape (GitHub #273): zelfde annulering als rechtermuisklik. De
  // keyboard-handler schakelt daarna naar de selectietool.
  onEscape(ctx) {
    return _cancelArcDrawing(ctx);
  },

  onDeactivate(ctx) {
    _arcState.clicks = [];
    state.isDrawing = false;
  },
};

// Gedeelde annuleerroutine: rechtermuisklik én Escape gooien de tot-nu-toe
// geklikte boogpunten weg. Retourneert true als er punten stonden.
function _cancelArcDrawing(ctx) {
  const hadClicks = _arcState.clicks.length > 0;
  _arcState.clicks = [];
  state.isDrawing = false;
  ctx.redraw();
  return hadClicks;
}
