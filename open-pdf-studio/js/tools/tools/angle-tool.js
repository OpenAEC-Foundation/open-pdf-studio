import { getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { zetRechtopRond } from '../../pdf/weergave-ruimte.js';

/**
 * Angle measurement tool — 3-click: point1, vertex, point2
 * Click 1: First point on first ray
 * Click 2: Vertex (corner point)
 * Click 3: Point on second ray → calculate angle, create annotation
 */
export const measureAngleTool = {
  name: 'measureAngle',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, scale } = ctx;

    // Right-click cancels (shared routine, also used by Escape)
    if (e.button === 2) {
      _cancelAngleDrawing(ctx);
      return;
    }

    const snap = ctx.snap(x, y, null, state.dimPoints);
    const ptX = snap.snapped ? snap.x : x;
    const ptY = snap.snapped ? snap.y : y;

    if (state.dimPoints.length === 0) {
      // Click 1: first point on first ray
      state.dimPoints.push({ x: ptX, y: ptY });
      state.isDrawingDimension = true;
    } else if (state.dimPoints.length === 1) {
      // Click 2: vertex
      const dx = ptX - state.dimPoints[0].x;
      const dy = ptY - state.dimPoints[0].y;
      if (Math.sqrt(dx * dx + dy * dy) < 3 / scale) return;
      state.dimPoints.push({ x: ptX, y: ptY });
    } else if (state.dimPoints.length === 2) {
      // Click 3: second ray point → calculate angle and create annotation
      const dx = ptX - state.dimPoints[1].x;
      const dy = ptY - state.dimPoints[1].y;
      if (Math.sqrt(dx * dx + dy * dy) < 3 / scale) return;

      const p1 = state.dimPoints[0];
      const vertex = state.dimPoints[1];
      const p3 = { x: ptX, y: ptY };

      // Calculate angle
      const angle1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
      const angle2 = Math.atan2(p3.y - vertex.y, p3.x - vertex.x);
      let angleDeg = (angle2 - angle1) * (180 / Math.PI);
      if (angleDeg < 0) angleDeg += 360;
      // Use the interior (smaller) angle
      if (angleDeg > 180) angleDeg = 360 - angleDeg;

      const prefs = state.preferences;
      const ann = ctx.createAnnotation({
        type: 'measureAngle',
        page: getActiveDocument()?.currentPage || 1,
        point1: { x: p1.x, y: p1.y },
        vertex: { x: vertex.x, y: vertex.y },
        point2: { x: p3.x, y: p3.y },
        arcRadius: 30,
        measureValue: angleDeg,
        measureText: angleDeg.toFixed(1) + '\u00B0',
        color: prefs.measureDistStrokeColor || '#ff0000',
        strokeColor: prefs.measureDistStrokeColor || '#ff0000',
        lineWidth: prefs.measureDistLineWidth || 1,
        opacity: (prefs.measureDistOpacity || 100) / 100,
      });
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
      state.dimPoints = [];
      state.isDrawingDimension = false;
      ctx.redraw();

      // Auto-reset to select tool
      import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    if (!state.isDrawingDimension || state.dimPoints.length === 0) {
      // Hover snap indicator
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

    const prefs = state.preferences;
    const color = prefs.measureDistStrokeColor || '#FF0000';
    const lw = prefs.measureDistLineWidth || 1;
    const snap = ctx.snap(x, y, null, state.dimPoints);
    const snapX = snap.snapped ? snap.x : x;
    const snapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = color;
    canvasCtx.lineWidth = lw;
    canvasCtx.globalAlpha = (prefs.measureDistOpacity || 100) / 100;
    canvasCtx.setLineDash([]);

    if (state.dimPoints.length === 1) {
      // Preview: line from p1 to cursor
      const p1 = state.dimPoints[0];
      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x, p1.y);
      canvasCtx.lineTo(snapX, snapY);
      canvasCtx.stroke();
    } else if (state.dimPoints.length === 2) {
      // Preview: two rays from vertex, arc, and angle label
      const p1 = state.dimPoints[0];
      const vertex = state.dimPoints[1];
      const p3x = snapX;
      const p3y = snapY;

      // Draw rays
      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x, p1.y);
      canvasCtx.lineTo(vertex.x, vertex.y);
      canvasCtx.lineTo(p3x, p3y);
      canvasCtx.stroke();

      // Calculate and draw arc
      const a1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
      const a2 = Math.atan2(p3y - vertex.y, p3x - vertex.x);
      let diff = a2 - a1;
      if (diff < 0) diff += 2 * Math.PI;
      const counterclockwise = diff > Math.PI;

      const arcR = 30;
      canvasCtx.beginPath();
      canvasCtx.arc(vertex.x, vertex.y, arcR, a1, a2, counterclockwise);
      canvasCtx.stroke();

      // Calculate angle for label
      let angleDeg = (a2 - a1) * (180 / Math.PI);
      if (angleDeg < 0) angleDeg += 360;
      if (angleDeg > 180) angleDeg = 360 - angleDeg;

      // Label at midpoint of arc
      const midAngle = counterclockwise
        ? a1 - (2 * Math.PI - diff) / 2
        : a1 + diff / 2;
      const labelR = arcR + 14;
      const lx = vertex.x + labelR * Math.cos(midAngle);
      const ly = vertex.y + labelR * Math.sin(midAngle);
      canvasCtx.save();
      // Rechtop op het scherm, ook in een gedraaide weergave (#200).
      zetRechtopRond(canvasCtx, lx, ly);
      canvasCtx.font = '11px Arial';
      canvasCtx.fillStyle = color;
      canvasCtx.textAlign = 'center';
      canvasCtx.textBaseline = 'middle';
      canvasCtx.fillText(angleDeg.toFixed(1) + '\u00B0', lx, ly);
      canvasCtx.restore();
    }

    canvasCtx.globalAlpha = 1;
    canvasCtx.restore();
    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  // Escape (GitHub #273): zelfde annulering als rechtermuisklik. De
  // keyboard-handler schakelt daarna naar de selectietool.
  onEscape(ctx) {
    return _cancelAngleDrawing(ctx);
  },

  onDeactivate(ctx) {
    const { state } = ctx;
    if (state.isDrawingDimension) {
      state.dimPoints = [];
      state.isDrawingDimension = false;
      ctx.redraw();
    }
  },
};

// Gedeelde annuleerroutine: rechtermuisklik én Escape gooien de tot-nu-toe
// geklikte hoekpunten weg. Retourneert true als er een hoekmeting bezig was.
function _cancelAngleDrawing(ctx) {
  const { state } = ctx;
  const hadDrawing = state.isDrawingDimension || (state.dimPoints && state.dimPoints.length > 0);
  state.dimPoints = [];
  state.isDrawingDimension = false;
  ctx.redraw();
  return !!hadDrawing;
}
