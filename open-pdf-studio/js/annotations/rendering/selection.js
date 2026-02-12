import { HANDLE_SIZE, HANDLE_TYPES } from '../../core/constants.js';
import { state, getSelectionBounds, getAnnotationBounds } from '../../core/state.js';
import { annotationCtx } from '../../ui/dom-elements.js';
import { getAnnotationHandles } from '../handles.js';

// Draw selection highlight and handles
export function drawSelectionHandles(ctx, annotation) {
  // Selection outline style - thin, subtle dashed line (scale-independent)
  const sc = state.scale || 1;
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1 / sc;
  ctx.setLineDash([3 / sc, 3 / sc]);

  switch (annotation.type) {
    case 'draw':
      if (annotation.path && annotation.path.length > 0) {
        const minX = Math.min(...annotation.path.map(p => p.x)) - 2;
        const minY = Math.min(...annotation.path.map(p => p.y)) - 2;
        const maxX = Math.max(...annotation.path.map(p => p.x)) + 2;
        const maxY = Math.max(...annotation.path.map(p => p.y)) + 2;
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      }
      break;
    case 'line':
    case 'arrow':
      ctx.beginPath();
      ctx.moveTo(annotation.startX, annotation.startY);
      ctx.lineTo(annotation.endX, annotation.endY);
      ctx.stroke();
      break;
    case 'circle':
      const selCircW = annotation.width || annotation.radius * 2;
      const selCircH = annotation.height || annotation.radius * 2;
      const selCircX = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const selCircY = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      ctx.save();
      // Apply rotation if set
      if (annotation.rotation) {
        const circCenterX = selCircX + selCircW / 2;
        const circCenterY = selCircY + selCircH / 2;
        ctx.translate(circCenterX, circCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-circCenterX, -circCenterY);
      }
      ctx.strokeRect(selCircX - 2, selCircY - 2, selCircW + 4, selCircH + 4);
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(selCircX + selCircW/2, selCircY - 2);
      ctx.lineTo(selCircX + selCircW/2, selCircY - 25);
      ctx.stroke();
      ctx.restore();
      break;
    case 'box':
    case 'polygon':
    case 'cloud':
    case 'highlight':
    case 'redaction':
      ctx.save();
      // Apply rotation if set
      if (annotation.rotation) {
        const boxSelCenterX = annotation.x + annotation.width / 2;
        const boxSelCenterY = annotation.y + annotation.height / 2;
        ctx.translate(boxSelCenterX, boxSelCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-boxSelCenterX, -boxSelCenterY);
      }
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, annotation.width + 4, annotation.height + 4);
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / sc;
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width/2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width/2, annotation.y - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
    case 'comment':
      const selCW = annotation.width || 24;
      const selCH = annotation.height || 24;
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, selCW + 4, selCH + 4);
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / sc;
      ctx.beginPath();
      ctx.moveTo(annotation.x + selCW/2, annotation.y - 2);
      ctx.lineTo(annotation.x + selCW/2, annotation.y - 25 / sc);
      ctx.stroke();
      break;
    case 'text':
      if (annotationCtx) {
        annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
        const textWidth = annotationCtx.measureText(annotation.text).width;
        const fontSize = annotation.fontSize || 16;
        ctx.strokeRect(annotation.x - 2, annotation.y - fontSize - 2, textWidth + 4, fontSize + 4);
      }
      break;
    case 'textbox':
      const selTbWidth = annotation.width || 150;
      const selTbHeight = annotation.height || 50;
      ctx.save();
      // Apply rotation if set
      if (annotation.rotation) {
        const tbSelCenterX = annotation.x + selTbWidth / 2;
        const tbSelCenterY = annotation.y + selTbHeight / 2;
        ctx.translate(tbSelCenterX, tbSelCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-tbSelCenterX, -tbSelCenterY);
      }
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, selTbWidth + 4, selTbHeight + 4);
      // Draw line from right center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / sc;
      ctx.beginPath();
      ctx.moveTo(annotation.x + selTbWidth + 2, annotation.y + selTbHeight/2);
      ctx.lineTo(annotation.x + selTbWidth + 25 / sc, annotation.y + selTbHeight/2);
      ctx.stroke();
      ctx.restore();
      break;
    case 'callout':
      const selCoWidth = annotation.width || 150;
      const selCoHeight = annotation.height || 50;
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, selCoWidth + 4, selCoHeight + 4);
      // Draw selection indicators on arrow and knee points
      const selArrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
      const selArrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + selCoHeight;
      const selKneeX = annotation.kneeX !== undefined ? annotation.kneeX : annotation.x - 30;
      const selKneeY = annotation.kneeY !== undefined ? annotation.kneeY : annotation.y + selCoHeight / 2;
      ctx.beginPath();
      ctx.arc(selArrowX, selArrowY, 4, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(selKneeX, selKneeY, 4, 0, 2 * Math.PI);
      ctx.stroke();
      break;
    case 'polyline':
      if (annotation.points && annotation.points.length > 0) {
        const plMinX = Math.min(...annotation.points.map(p => p.x));
        const plMinY = Math.min(...annotation.points.map(p => p.y));
        const plMaxX = Math.max(...annotation.points.map(p => p.x));
        const plMaxY = Math.max(...annotation.points.map(p => p.y));
        ctx.strokeRect(plMinX - 2, plMinY - 2, plMaxX - plMinX + 4, plMaxY - plMinY + 4);
      }
      break;
    case 'image':
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, annotation.width + 4, annotation.height + 4);
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / sc;
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width/2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width/2, annotation.y - 25 / sc);
      ctx.stroke();
      break;
    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      // Draw selection around the bounding box of all text rects
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, annotation.width + 4, annotation.height + 4);
      break;
  }

  ctx.setLineDash([]);

  // Draw resize/move handles (scale-independent size)
  const scale = state.scale || 1;
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

    // Draw circular handles for all types (cleaner look)
    ctx.beginPath();
    ctx.arc(cx, cy, hs / 2, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = lw;
    ctx.stroke();

    // For corner handles, add a small inner dot
    if ([HANDLE_TYPES.TOP_LEFT, HANDLE_TYPES.TOP_RIGHT, HANDLE_TYPES.BOTTOM_LEFT, HANDLE_TYPES.BOTTOM_RIGHT].includes(handle.type)) {
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5 / scale, 0, 2 * Math.PI);
      ctx.fillStyle = '#0066cc';
      ctx.fill();
    }

    // For line endpoints, make them filled
    if (handle.type === HANDLE_TYPES.LINE_START || handle.type === HANDLE_TYPES.LINE_END) {
      ctx.beginPath();
      ctx.arc(cx, cy, hs / 2, 0, 2 * Math.PI);
      ctx.fillStyle = '#0066cc';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = lw;
      ctx.stroke();
    }

    // Callout handles - diamond shape
    if (handle.type === HANDLE_TYPES.CALLOUT_ARROW || handle.type === HANDLE_TYPES.CALLOUT_KNEE) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - hs / 2);
      ctx.lineTo(cx + hs / 2, cy);
      ctx.lineTo(cx, cy + hs / 2);
      ctx.lineTo(cx - hs / 2, cy);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
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

  const sc = state.scale || 1;
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
    const cx = corner.x + hs / 2;
    const cy = corner.y + hs / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, hs / 2, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = 1 / sc;
    ctx.stroke();
  });
}
