/**
 * Scale-measure tool — temporary 2-click distance pick used to derive a
 * scale for a scale region ("Meet op tekening").
 *
 * Unlike the measurement tools this NEVER creates an annotation: the two
 * clicked points only yield a pixel distance (app-space = PDF points) that is
 * handed to the caller through startScaleMeasureFlow(). A dashed rubber-band
 * line with a live distance readout is drawn while picking. Esc or
 * right-click cancels the flow.
 *
 * Interaction pattern mirrors calibration-pick-tool.js (snap support,
 * dashed preview, endpoint dots).
 */
import { setTool } from '../manager.js';
import { applyToolTransform } from '../tool-context.js';
import { zetRechtopRond } from '../../pdf/weergave-ruimte.js';

// Module-level flow + picking state (survives across pointer events).
let _flow = null; // { onDone(pixelDistance), onCancel() }
const _pick = { point: null, pageNum: null };

function _resetPick() {
  _pick.point = null;
  _pick.pageNum = null;
}

/**
 * Start a temporary measure flow. Switches to the scaleMeasure tool; after
 * the user clicks two points, onDone(pixelDistance) is called with the
 * distance in app-space units (PDF points). Cancelling (Esc / right-click /
 * tool switch) calls onCancel() instead.
 */
export function startScaleMeasureFlow(handlers) {
  _flow = handlers || null;
  _resetPick();
  setTool('scaleMeasure');
}

function _finish(pixelDistance) {
  const flow = _flow;
  _flow = null; // clear BEFORE setTool so onDeactivate doesn't fire onCancel
  _resetPick();
  setTool('select');
  if (flow?.onDone) flow.onDone(pixelDistance);
}

function _cancel() {
  const flow = _flow;
  _flow = null;
  _resetPick();
  if (flow?.onCancel) flow.onCancel();
}

export const scaleMeasureTool = {
  name: 'scaleMeasure',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, scale } = ctx;

    // Right-click cancels the whole flow.
    if (e.button === 2) {
      _cancel();
      setTool('select');
      ctx.redraw();
      e.preventDefault?.();
      return;
    }
    if (e.button !== 0) return;

    const snap = ctx.snap(x, y);
    const ptX = snap.snapped ? snap.x : x;
    const ptY = snap.snapped ? snap.y : y;

    // In continuous mode each page has its own canvas/coordinate space; a
    // click on a different page restarts the pick there.
    if (_pick.point === null || _pick.pageNum !== ctx.pageNum) {
      _pick.point = { x: ptX, y: ptY };
      _pick.pageNum = ctx.pageNum;
      state.lastSnapResult = null;
      ctx.redraw();
      return;
    }

    const dx = ptX - _pick.point.x;
    const dy = ptY - _pick.point.y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    if (pixelDist < 3 / scale) return; // Too close — ignore

    state.lastSnapResult = null;
    ctx.redraw();
    _finish(pixelDist);
  },

  onPointerMove(ctx) {
    const { x, y, state, canvasCtx, scale } = ctx;
    if (!canvasCtx) return;

    if (_pick.point === null || _pick.pageNum !== ctx.pageNum) {
      // Show hover snap indicator only.
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

    const snap = ctx.snap(x, y);
    const curX = snap.snapped ? snap.x : x;
    const curY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);

    const p1 = _pick.point;

    // Dashed rubber-band line.
    canvasCtx.strokeStyle = '#00AAFF';
    canvasCtx.lineWidth = 1.5 / scale;
    canvasCtx.setLineDash([6 / scale, 3 / scale]);
    canvasCtx.beginPath();
    canvasCtx.moveTo(p1.x, p1.y);
    canvasCtx.lineTo(curX, curY);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);

    // Endpoint dots.
    const r = 4 / scale;
    canvasCtx.fillStyle = '#00AAFF';
    canvasCtx.beginPath();
    canvasCtx.arc(p1.x, p1.y, r, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.beginPath();
    canvasCtx.arc(curX, curY, r, 0, Math.PI * 2);
    canvasCtx.fill();

    // Live paper-distance readout (points → mm on paper).
    const dx = curX - p1.x;
    const dy = curY - p1.y;
    const distPts = Math.sqrt(dx * dx + dy * dy);
    const distMm = distPts * 25.4 / 72;
    const midX = (p1.x + curX) / 2;
    const midY = (p1.y + curY) / 2;
    // Rechtop op het scherm, ook in een gedraaide weergave (#200).
    zetRechtopRond(canvasCtx, midX, midY);
    canvasCtx.font = `${11 / scale}px Arial`;
    canvasCtx.fillStyle = '#00AAFF';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(`${distMm.toFixed(1)} mm`, midX, midY - 6 / scale);

    canvasCtx.restore();

    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  onKeyDown(ctx, e) {
    if (e.key === 'Escape') {
      _cancel();
      setTool('select');
      ctx.redraw();
      e.preventDefault?.();
    }
  },

  onDeactivate(ctx) {
    // Switching to any other tool while a flow is pending = cancel.
    _cancel();
    ctx.redraw();
  },
};
