import { HANDLE_SIZE, HANDLE_TYPES } from '../core/constants.js';
import { annotationCtx } from '../ui/dom-elements.js';

// Rotate a point around a center point
function rotatePoint(x, y, centerX, centerY, rotationDegrees) {
  if (!rotationDegrees) return { x, y };

  const radians = rotationDegrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Translate to origin, rotate, translate back
  const dx = x - centerX;
  const dy = y - centerY;

  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos
  };
}

// Get the center point for an annotation
function getAnnotationCenter(annotation) {
  switch (annotation.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'image':
      return {
        x: annotation.x + annotation.width / 2,
        y: annotation.y + annotation.height / 2
      };
    case 'circle':
      const w = annotation.width || annotation.radius * 2;
      const h = annotation.height || annotation.radius * 2;
      const cx = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const cy = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      return {
        x: cx + w / 2,
        y: cy + h / 2
      };
    case 'comment':
      const cw = annotation.width || 24;
      const ch = annotation.height || 24;
      return {
        x: annotation.x + cw / 2,
        y: annotation.y + ch / 2
      };
    default:
      return null;
  }
}

// Get handles for an annotation based on its type
export function getAnnotationHandles(annotation) {
  const handles = [];
  const hs = HANDLE_SIZE;

  switch (annotation.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      // Corner handles
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      // Rotation handle (above the shape)
      handles.push({ type: HANDLE_TYPES.ROTATE, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - 25 - hs/2 });
      break;

    case 'callout':
      // Corner handles for the text box
      const coW = annotation.width || 150;
      const coH = annotation.height || 50;
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + coW - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + coH - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + coW - hs/2, y: annotation.y + coH - hs/2 });
      // Callout arrow handle
      const arrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
      const arrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + coH;
      handles.push({ type: HANDLE_TYPES.CALLOUT_ARROW, x: arrowX - hs/2, y: arrowY - hs/2 });
      // Knee point handle
      const kneeX = annotation.kneeX !== undefined ? annotation.kneeX : annotation.x - 30;
      const kneeY = annotation.kneeY !== undefined ? annotation.kneeY : annotation.y + coH / 2;
      handles.push({ type: HANDLE_TYPES.CALLOUT_KNEE, x: kneeX - hs/2, y: kneeY - hs/2 });
      break;

    case 'circle':
      // Ellipse uses same handles as box (corner and edge handles)
      const circW = annotation.width || annotation.radius * 2;
      const circH = annotation.height || annotation.radius * 2;
      const circX = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const circY = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      // Corner handles
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: circX - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: circX + circW - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: circX - hs/2, y: circY + circH - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: circX + circW - hs/2, y: circY + circH - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: circX + circW/2 - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: circX + circW/2 - hs/2, y: circY + circH - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: circX - hs/2, y: circY + circH/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: circX + circW - hs/2, y: circY + circH/2 - hs/2 });
      // Rotation handle (above the shape)
      handles.push({ type: HANDLE_TYPES.ROTATE, x: circX + circW/2 - hs/2, y: circY - 25 - hs/2 });
      break;

    case 'line':
      // Endpoint handles
      handles.push({ type: HANDLE_TYPES.LINE_START, x: annotation.startX - hs/2, y: annotation.startY - hs/2 });
      handles.push({ type: HANDLE_TYPES.LINE_END, x: annotation.endX - hs/2, y: annotation.endY - hs/2 });
      break;

    case 'arrow':
      // Arrow uses same endpoint handles as line
      handles.push({ type: HANDLE_TYPES.LINE_START, x: annotation.startX - hs/2, y: annotation.startY - hs/2 });
      handles.push({ type: HANDLE_TYPES.LINE_END, x: annotation.endX - hs/2, y: annotation.endY - hs/2 });
      break;

    case 'comment':
      // Comment box handles with resize and rotation support
      const cw = annotation.width || 24;
      const ch = annotation.height || 24;
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + cw - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + ch - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + cw - hs/2, y: annotation.y + ch - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + cw/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + cw/2 - hs/2, y: annotation.y + ch - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + ch/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + cw - hs/2, y: annotation.y + ch/2 - hs/2 });
      // Rotation handle
      handles.push({ type: HANDLE_TYPES.ROTATE, x: annotation.x + cw/2 - hs/2, y: annotation.y - 25 - hs/2 });
      break;

    case 'text':
      // Calculate text bounds
      if (annotationCtx) {
        annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
        const textWidth = annotationCtx.measureText(annotation.text).width;
        const textHeight = annotation.fontSize || 16;
        handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - textHeight - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + textWidth - hs/2, y: annotation.y - textHeight - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + textWidth - hs/2, y: annotation.y - hs/2 });
      }
      break;

    case 'draw':
      // For freehand, show bounding box handles
      if (annotation.path && annotation.path.length > 0) {
        const minX = Math.min(...annotation.path.map(p => p.x));
        const minY = Math.min(...annotation.path.map(p => p.y));
        const maxX = Math.max(...annotation.path.map(p => p.x));
        const maxY = Math.max(...annotation.path.map(p => p.y));
        handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: minX - hs/2, y: minY - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: maxX - hs/2, y: minY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: minX - hs/2, y: maxY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: maxX - hs/2, y: maxY - hs/2 });
      }
      break;

    case 'polyline':
      // For polyline, show bounding box handles
      if (annotation.points && annotation.points.length > 0) {
        const plMinX = Math.min(...annotation.points.map(p => p.x));
        const plMinY = Math.min(...annotation.points.map(p => p.y));
        const plMaxX = Math.max(...annotation.points.map(p => p.x));
        const plMaxY = Math.max(...annotation.points.map(p => p.y));
        handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: plMinX - hs/2, y: plMinY - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: plMaxX - hs/2, y: plMinY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: plMinX - hs/2, y: plMaxY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: plMaxX - hs/2, y: plMaxY - hs/2 });
      }
      break;

    case 'image':
      // Corner handles for resize
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      // Rotation handle (above the image)
      handles.push({ type: HANDLE_TYPES.ROTATE, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - 25 - hs/2 });
      break;
  }

  // If the annotation is rotated, rotate all handle positions around the annotation center
  if (annotation.rotation) {
    const center = getAnnotationCenter(annotation);
    if (center) {
      for (const handle of handles) {
        // Calculate handle center (add hs/2 because handle.x/y is top-left corner)
        const handleCenterX = handle.x + hs / 2;
        const handleCenterY = handle.y + hs / 2;
        // Rotate the handle center around the annotation center
        const rotated = rotatePoint(handleCenterX, handleCenterY, center.x, center.y, annotation.rotation);
        // Update handle position (convert back to top-left corner)
        handle.x = rotated.x - hs / 2;
        handle.y = rotated.y - hs / 2;
      }
    }
  }

  return handles;
}

// Find which handle is at the given coordinates
export function findHandleAt(x, y, annotation) {
  if (!annotation) return null;
  const handles = getAnnotationHandles(annotation);
  const hs = HANDLE_SIZE;

  for (const handle of handles) {
    if (x >= handle.x && x <= handle.x + hs &&
        y >= handle.y && y <= handle.y + hs) {
      return handle.type;
    }
  }
  return null;
}

// Get cursor style for handle type
export function getCursorForHandle(handleType) {
  switch (handleType) {
    case HANDLE_TYPES.TOP_LEFT:
    case HANDLE_TYPES.BOTTOM_RIGHT:
      return 'nwse-resize';
    case HANDLE_TYPES.TOP_RIGHT:
    case HANDLE_TYPES.BOTTOM_LEFT:
      return 'nesw-resize';
    case HANDLE_TYPES.TOP:
    case HANDLE_TYPES.BOTTOM:
      return 'ns-resize';
    case HANDLE_TYPES.LEFT:
    case HANDLE_TYPES.RIGHT:
      return 'ew-resize';
    case HANDLE_TYPES.LINE_START:
    case HANDLE_TYPES.LINE_END:
      return 'crosshair';
    case HANDLE_TYPES.MOVE:
      return 'move';
    case HANDLE_TYPES.ROTATE:
      return 'grab';
    case HANDLE_TYPES.CALLOUT_ARROW:
      return 'crosshair';
    case HANDLE_TYPES.CALLOUT_KNEE:
      return 'move';
    default:
      return 'default';
  }
}
