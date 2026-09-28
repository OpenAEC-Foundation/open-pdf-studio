/**
 * Calibration pick tool — 2-click tool to select reference points for scale calibration.
 * After 2 clicks: calculates pixel distance, stores it, and switches back to the Meten tab.
 */
import { setCalibrationPixelDistance, setActiveTab } from '../../solid/stores/ribbonStore.js';
import { setTool } from '../manager.js';
import { applyToolTransform } from '../tool-context.js';
import { zetRechtopRond } from '../../pdf/weergave-ruimte.js';

export const calibrationPickTool = {
  name: 'calibrationPick',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, scale } = ctx;

    // Right-click cancels
    if (e.button === 2) {
      state.calibrationPoints = [];
      setActiveTab('drawing');
      setTool('hand');
      ctx.redraw();
      return;
    }

    const snap = ctx.snap(x, y);
    const ptX = snap.snapped ? snap.x : x;
    const ptY = snap.snapped ? snap.y : y;

    if (state.calibrationPoints.length === 0) {
      // First point
      state.calibrationPoints = [{ x: ptX, y: ptY }];
      ctx.redraw();
    } else {
      // Second point — calculate distance and return to measure tab
      const p1 = state.calibrationPoints[0];
      const dx = ptX - p1.x;
      const dy = ptY - p1.y;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);

      if (pixelDist < 3 / scale) return; // Too close, ignore

      setCalibrationPixelDistance(pixelDist);
      state.calibrationPoints = [];
      setActiveTab('drawing');
      setTool('hand');
      ctx.redraw();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;

    if (state.calibrationPoints.length === 0) {
      // Show hover snap
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

    // Draw preview line from first point to cursor
    const snap = ctx.snap(x, y);
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);

    const p1 = state.calibrationPoints[0];

    // Draw dashed reference line
    canvasCtx.strokeStyle = '#00AAFF';
    canvasCtx.lineWidth = 1.5;
    canvasCtx.setLineDash([6, 3]);
    canvasCtx.beginPath();
    canvasCtx.moveTo(p1.x, p1.y);
    canvasCtx.lineTo(snapX, snapY);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);

    // Draw endpoints
    const r = 4 / scale;
    canvasCtx.fillStyle = '#00AAFF';
    canvasCtx.beginPath();
    canvasCtx.arc(p1.x, p1.y, r, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.beginPath();
    canvasCtx.arc(snapX, snapY, r, 0, Math.PI * 2);
    canvasCtx.fill();

    // Show live pixel distance
    const dx = snapX - p1.x;
    const dy = snapY - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const midX = (p1.x + snapX) / 2;
    const midY = (p1.y + snapY) / 2;
    // Rechtop op het scherm, ook in een gedraaide weergave (#200).
    zetRechtopRond(canvasCtx, midX, midY);
    canvasCtx.font = `${11}px Arial`;
    canvasCtx.fillStyle = '#00AAFF';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(`${dist.toFixed(1)} px`, midX, midY - 6);

    canvasCtx.restore();

    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  // Escape (GitHub #273): zelfde annulering als rechtermuisklik — punten
  // weggooien en terug naar de Meten-context. De keyboard-handler schakelt
  // daarna naar de selectietool (rechtsklik ging naar 'hand'; Escape volgt
  // de issue-eis en gaat naar 'select').
  onEscape(ctx) {
    const { state } = ctx;
    const hadPoints = state.calibrationPoints && state.calibrationPoints.length > 0;
    state.calibrationPoints = [];
    setActiveTab('drawing');
    ctx.redraw();
    return !!hadPoints;
  },

  onDeactivate(ctx) {
    ctx.state.calibrationPoints = [];
    ctx.redraw();
  },
};
