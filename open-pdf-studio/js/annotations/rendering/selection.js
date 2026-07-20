import { HANDLE_SIZE, HANDLE_TYPES } from '../../core/constants.js';
import { state, getActiveDocument, getSelectionBounds, getAnnotationBounds } from '../../core/state.js';
import { annotationCtx } from '../../ui/dom-elements.js';
import { getAnnotationHandles } from '../handles.js';

// Draw selection highlight and handles
export function drawSelectionHandles(ctx, annotation) {
  const doc = getActiveDocument();
  const sc = doc?.scale || 1;
  const isEditingContour = annotation && annotation.type === 'filledArea' &&
    state.editingContour === annotation.id;

  // Draw rotation indicator lines (no dashed outlines)
  ctx.strokeStyle = '#22c55e';
  ctx.setLineDash([]);
  ctx.lineWidth = 1 / sc;

  switch (annotation.type) {
    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline': {
      // Draw per-rect outlines instead of bounding-box indicator
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = 1 / sc;
      ctx.setLineDash([3 / sc, 3 / sc]);
      if (annotation.rects && annotation.rects.length > 0) {
        for (const rect of annotation.rects) {
          ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        }
      } else {
        ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
      }
      ctx.setLineDash([]);
      return; // Skip handle drawing — text markups have no handles
    }
    case 'circle': {
      const selCircW = annotation.width || annotation.radius * 2;
      const selCircH = annotation.height || annotation.radius * 2;
      const selCircX = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const selCircY = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      ctx.save();
      if (annotation.rotation) {
        const circCenterX = selCircX + selCircW / 2;
        const circCenterY = selCircY + selCircH / 2;
        ctx.translate(circCenterX, circCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-circCenterX, -circCenterY);
      }
      ctx.beginPath();
      ctx.moveTo(selCircX + selCircW/2, selCircY - 2);
      ctx.lineTo(selCircX + selCircW/2, selCircY - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'box':
    case 'mask':
    case 'polygon':
    case 'cloud':
    case 'highlight':
    case 'redaction':
      ctx.save();
      if (annotation.rotation) {
        const boxSelCenterX = annotation.x + annotation.width / 2;
        const boxSelCenterY = annotation.y + annotation.height / 2;
        ctx.translate(boxSelCenterX, boxSelCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-boxSelCenterX, -boxSelCenterY);
      }
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width / 2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width / 2, annotation.y - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
    case 'comment':
      // No selection indicators — fixed-size icon, move only
      break;
    case 'textbox': {
      const selTbWidth = annotation.width || 150;
      const selTbHeight = annotation.height || 50;
      ctx.save();
      if (annotation.rotation) {
        const tbSelCenterX = annotation.x + selTbWidth / 2;
        const tbSelCenterY = annotation.y + selTbHeight / 2;
        ctx.translate(tbSelCenterX, tbSelCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-tbSelCenterX, -tbSelCenterY);
      }
      ctx.beginPath();
      ctx.moveTo(annotation.x + selTbWidth / 2, annotation.y - 2);
      ctx.lineTo(annotation.x + selTbWidth / 2, annotation.y - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'image':
    case 'stamp':
    case 'signature':
    case 'scaleBar':
    case 'scheduleTable':
    case 'parametricSymbol':
      ctx.save();
      if (annotation.rotation) {
        const imgCenterX = annotation.x + annotation.width / 2;
        const imgCenterY = annotation.y + annotation.height / 2;
        ctx.translate(imgCenterX, imgCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-imgCenterX, -imgCenterY);
      }
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width/2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width/2, annotation.y - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
  }

  // Draw selection border (dashed outline around the annotation)
  // For measureAngle, draw the two rays and arc
  const isMeasureAngle = annotation.type === 'measureAngle' && annotation.point1 && annotation.vertex && annotation.point2;
  // For measureDistance, draw the dimension line shape instead of bounding rect
  const isMeasureDist = annotation.type === 'measureDistance';
  // For point-based annotations, draw the polygon/polyline outline instead of bounding rect
  const isPointBased = ((annotation.type === 'measureArea' || annotation.type === 'measurePerimeter' ||
    annotation.type === 'polyline' || annotation.type === 'cloudPolyline' || annotation.type === 'splineArrow') ||
    (annotation.type === 'filledArea' && isEditingContour)) && annotation.points && annotation.points.length >= 2;
  const usesGripOnlySelection = annotation.type === 'line' || annotation.type === 'arrow' || annotation.type === 'wall';
  if (isMeasureAngle) {
    ctx.save();
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = 1 / sc;
    ctx.setLineDash([3 / sc, 3 / sc]);
    ctx.beginPath();
    ctx.moveTo(annotation.point1.x, annotation.point1.y);
    ctx.lineTo(annotation.vertex.x, annotation.vertex.y);
    ctx.lineTo(annotation.point2.x, annotation.point2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else if (isMeasureDist) {
    ctx.save();
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = 1 / sc;
    ctx.setLineDash([3 / sc, 3 / sc]);
    ctx.beginPath();
    // Leader lines (base points to dimension line)
    const hasLeaders = annotation.leaderStartX !== undefined;
    if (hasLeaders) {
      ctx.moveTo(annotation.leaderStartX, annotation.leaderStartY);
      ctx.lineTo(annotation.startX, annotation.startY);
      ctx.moveTo(annotation.leaderEndX, annotation.leaderEndY);
      ctx.lineTo(annotation.endX, annotation.endY);
    }
    // Dimension line
    ctx.moveTo(annotation.startX, annotation.startY);
    ctx.lineTo(annotation.endX, annotation.endY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else if (isPointBased) {
    ctx.save();
    ctx.strokeStyle = isEditingContour ? '#06b6d4' : '#0066cc';
    ctx.lineWidth = (isEditingContour ? 1.5 : 1) / sc;
    ctx.setLineDash([3 / sc, 3 / sc]);
    ctx.beginPath();
    ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
    for (let i = 1; i < annotation.points.length; i++) {
      ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
    }
    if (annotation.type === 'measureArea' || annotation.type === 'filledArea') ctx.closePath();
    ctx.stroke();
    // Draw hole outlines
    if ((annotation.type === 'measureArea' || annotation.type === 'filledArea') && annotation.holes) {
      for (const hole of annotation.holes) {
        if (hole && hole.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(hole[0].x, hole[0].y);
          for (let i = 1; i < hole.length; i++) {
            ctx.lineTo(hole[i].x, hole[i].y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  } else if (!usesGripOnlySelection) {
    const bounds = getAnnotationBounds(annotation);
    if (bounds) {
      ctx.save();
      if (annotation.rotation) {
        const bcx = bounds.x + bounds.width / 2;
        const bcy = bounds.y + bounds.height / 2;
        ctx.translate(bcx, bcy);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-bcx, -bcy);
      }
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = 1 / sc;
      ctx.setLineDash([3 / sc, 3 / sc]);
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Draw resize/move handles (scale-independent size)
  const scale = doc?.scale || 1;
  const handles = getAnnotationHandles(annotation, scale);
  const hs = HANDLE_SIZE / scale;
  const lw = 1 / scale;

  handles.forEach(handle => {
    const cx = handle.x + hs / 2;
    const cy = handle.y + hs / 2;

    // Draw rotation handle as a circle with rotation icon (green color)
    if (handle.type === HANDLE_TYPES.ROTATE) {
      // Outer circle
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(cx, cy, hs / 2 + lw, 0, 2 * Math.PI);
      ctx.fill();
      // Inner rotation arrow icon
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, 3 / scale, -Math.PI * 0.7, Math.PI * 0.5);
      ctx.stroke();
      // Small arrow head
      const as = 2 / scale;
      ctx.beginPath();
      ctx.moveTo(cx - as, cy + as);
      ctx.lineTo(cx - as, cy + as * 2);
      ctx.lineTo(cx - as * 2, cy + as * 1.5);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }

    // Callout move handle - four-arrow cross shape
    if (handle.type === HANDLE_TYPES.CALLOUT_MOVE) {
      const r = hs * 0.8;
      const a = hs * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = lw;
      ctx.stroke();
      // Draw cross arrows
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = lw * 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - a, cy); ctx.lineTo(cx + a, cy);
      ctx.moveTo(cx, cy - a); ctx.lineTo(cx, cy + a);
      ctx.stroke();
      return;
    }

    // Label move handle — four-arrow cross shape (orange)
    if (handle.type === HANDLE_TYPES.LABEL_MOVE) {
      const r = hs * 0.8;
      const a = hs * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = lw;
      ctx.stroke();
      // Draw cross arrows
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = lw * 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - a, cy); ctx.lineTo(cx + a, cy);
      ctx.moveTo(cx, cy - a); ctx.lineTo(cx, cy + a);
      ctx.stroke();
      return;
    }

    // Edge-midpoint handles (only emitted in edit-contour mode) — open circle
    if (handle.isEdgeMid) {
      const r = (handle.w || hs) / 2;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = handle.isHole ? '#f59e0b' : '#06b6d4';
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.restore();
      return;
    }

    // In edit-contour mode, draw vertex handles as filled circles to differentiate
    if (isEditingContour && typeof handle.type === 'string' &&
        (handle.type === HANDLE_TYPES.POLYLINE_NODE ||
         handle.type.startsWith(HANDLE_TYPES.POLYLINE_NODE + '_hole_'))) {
      const r = hs / 2;
      ctx.save();
      ctx.fillStyle = handle.isHole ? '#f59e0b' : '#06b6d4';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Hole vertex handles — diamond shape with orange border
    if (handle.isHole) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-hs / 2, -hs / 2, hs, hs);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = lw;
      ctx.strokeRect(-hs / 2, -hs / 2, hs, hs);
      ctx.restore();
      return;
    }

    // Textbox leader UI: + add button (top-right) and × delete button per leader
    if (handle.isLeaderUI) {
      const w = handle.w || hs;
      const h = handle.h || hs;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(handle.x, handle.y, w, h);
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = lw;
      ctx.strokeRect(handle.x, handle.y, w, h);
      // Glyph: + for add, × for delete
      const glyphCx = handle.x + w / 2;
      const glyphCy = handle.y + h / 2;
      const r = Math.min(w, h) * 0.3;
      ctx.strokeStyle = handle.type === HANDLE_TYPES.LEADER_ADD ? '#0066cc' : '#c81123';
      ctx.lineWidth = lw * 1.4;
      ctx.beginPath();
      if (handle.type === HANDLE_TYPES.LEADER_ADD) {
        // plus
        ctx.moveTo(glyphCx - r, glyphCy);
        ctx.lineTo(glyphCx + r, glyphCy);
        ctx.moveTo(glyphCx, glyphCy - r);
        ctx.lineTo(glyphCx, glyphCy + r);
      } else {
        // ×
        ctx.moveTo(glyphCx - r, glyphCy - r);
        ctx.lineTo(glyphCx + r, glyphCy + r);
        ctx.moveTo(glyphCx + r, glyphCy - r);
        ctx.lineTo(glyphCx - r, glyphCy + r);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Textbox leader tip/knee: draw as small square (knee slightly smaller)
    if (handle.isLeaderHandle) {
      const sz = handle.isLeaderKnee ? hs * 0.85 : hs;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
      ctx.strokeStyle = handle.isLeaderKnee ? '#22c55e' : '#0066cc';
      ctx.lineWidth = lw;
      ctx.strokeRect(cx - sz / 2, cy - sz / 2, sz, sz);
      ctx.restore();
      return;
    }

    // Yellow grip squares (CAD-style grippoints).
    // Hover state: blue. Active (during stretch): red. Default: yellow.
    // Rotated to match annotation orientation. Spec: 6×6 px filled square,
    // #ffd400 default, #3399ff on hover, #e81123 while stretching.
    ctx.save();
    if (annotation.type === 'measureDistance') {
      const mdAngle = Math.atan2(annotation.endY - annotation.startY, annotation.endX - annotation.startX);
      ctx.translate(cx, cy);
      ctx.rotate(mdAngle);
      ctx.translate(-cx, -cy);
    } else if (annotation.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate(annotation.rotation * Math.PI / 180);
      ctx.translate(-cx, -cy);
    }

    const isActive = state.isResizing && state.activeHandle === handle.type;
    const isHover = !isActive && state.hoverHandle === handle.type;
    let fill = '#ffd400';
    if (isActive) fill = '#e81123';
    else if (isHover) fill = '#3399ff';
    ctx.fillStyle = fill;
    ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = lw;
    ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
    ctx.restore();
  });
}

// Draw outline for a single annotation in multi-selection
export function drawMultiSelectionOutline(ctx, annotation) {
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  const bounds = getAnnotationBounds(annotation);
  if (bounds) {
    ctx.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
  }
  ctx.setLineDash([]);
}

// Draw overall bounding box for multi-selection
export function drawMultiSelectionBounds(ctx) {
  const bounds = getSelectionBounds();
  if (!bounds) return;

  const msDoc = getActiveDocument();
  const sc = msDoc?.scale || 1;
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1.5 / sc;
  ctx.setLineDash([6 / sc, 3 / sc]);
  const pad = 6 / sc;
  ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2);
  ctx.setLineDash([]);

  // Draw corner handles for the overall bounding box
  const hs = HANDLE_SIZE / sc;
  const corners = [
    { x: bounds.x - pad - hs/2, y: bounds.y - pad - hs/2 },
    { x: bounds.x + bounds.width + pad - hs/2, y: bounds.y - pad - hs/2 },
    { x: bounds.x - pad - hs/2, y: bounds.y + bounds.height + pad - hs/2 },
    { x: bounds.x + bounds.width + pad - hs/2, y: bounds.y + bounds.height + pad - hs/2 }
  ];

  corners.forEach(corner => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(corner.x, corner.y, hs, hs);
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = 1 / sc;
    ctx.strokeRect(corner.x, corner.y, hs, hs);
  });
}
