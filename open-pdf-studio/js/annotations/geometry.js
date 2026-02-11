import { state } from '../core/state.js';
import { annotationCtx } from '../ui/dom-elements.js';
import { distanceToLine, isPointNearRect, isPointNearEllipse } from '../utils/math.js';

// Transform a point by inverse rotation around a center point
// This converts screen coordinates to the annotation's local (unrotated) coordinate system
function transformPointByInverseRotation(x, y, centerX, centerY, rotationDegrees) {
  if (!rotationDegrees) return { x, y };

  const radians = -rotationDegrees * Math.PI / 180; // Negative for inverse
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

// Get the center point and dimensions for an annotation
function getAnnotationCenterAndSize(ann) {
  switch (ann.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction':
      return {
        centerX: ann.x + ann.width / 2,
        centerY: ann.y + ann.height / 2,
        width: ann.width,
        height: ann.height
      };
    case 'circle':
      const w = ann.width || ann.radius * 2;
      const h = ann.height || ann.radius * 2;
      const cx = ann.x !== undefined ? ann.x : ann.centerX - ann.radius;
      const cy = ann.y !== undefined ? ann.y : ann.centerY - ann.radius;
      return {
        centerX: cx + w / 2,
        centerY: cy + h / 2,
        width: w,
        height: h
      };
    case 'comment':
      const cw = ann.width || 24;
      const ch = ann.height || 24;
      return {
        centerX: ann.x + cw / 2,
        centerY: ann.y + ch / 2,
        width: cw,
        height: ch
      };
    default:
      return null;
  }
}

// Find annotation at coordinates
export function findAnnotationAt(x, y) {
  // Scale-aware hit tolerance: stay ~10 screen pixels at any zoom level
  const tol = Math.max(10 / state.scale, 2);

  // Search in reverse order (top annotations first)
  for (let i = state.annotations.length - 1; i >= 0; i--) {
    const ann = state.annotations[i];
    if (ann.page !== state.currentPage) continue;

    switch (ann.type) {
      case 'draw':
        // Check if point is near the path
        for (let point of ann.path) {
          const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
          if (dist < tol) return ann;
        }
        break;
      case 'line':
      case 'arrow':
        // Check if point is near the line
        const dist = distanceToLine(x, y, ann.startX, ann.startY, ann.endX, ann.endY);
        if (dist < tol) return ann;
        break;
      case 'polyline':
        // Check if point is near any segment of the polyline
        if (ann.points && ann.points.length >= 2) {
          for (let i = 0; i < ann.points.length - 1; i++) {
            const segDist = distanceToLine(x, y, ann.points[i].x, ann.points[i].y, ann.points[i+1].x, ann.points[i+1].y);
            if (segDist < tol) return ann;
          }
        }
        break;
      case 'circle':
        // Check if point is near ellipse boundary, or inside if has fill color
        const findCircW = ann.width || ann.radius * 2;
        const findCircH = ann.height || ann.radius * 2;
        const findCircX = ann.x !== undefined ? ann.x : ann.centerX - ann.radius;
        const findCircY = ann.y !== undefined ? ann.y : ann.centerY - ann.radius;
        // Transform click point by inverse rotation if annotation is rotated
        const circleCenter = { x: findCircX + findCircW / 2, y: findCircY + findCircH / 2 };
        const circleLocal = transformPointByInverseRotation(x, y, circleCenter.x, circleCenter.y, ann.rotation);
        // If has fill color, check if inside the ellipse
        if (ann.fillColor) {
          const ellCX = findCircX + findCircW / 2;
          const ellCY = findCircY + findCircH / 2;
          const ellRX = Math.abs(findCircW / 2);
          const ellRY = Math.abs(findCircH / 2);
          const normDist = Math.pow((circleLocal.x - ellCX) / ellRX, 2) + Math.pow((circleLocal.y - ellCY) / ellRY, 2);
          if (normDist <= 1) return ann;
        }
        // Also check near the border (stroke)
        if (isPointNearEllipse(circleLocal.x, circleLocal.y, findCircX, findCircY, findCircW, findCircH, tol)) return ann;
        break;
      case 'box':
        // Transform click point by inverse rotation if annotation is rotated
        const boxCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
        const boxLocal = transformPointByInverseRotation(x, y, boxCenter.x, boxCenter.y, ann.rotation);
        // If has fill color, check if inside the rectangle
        if (ann.fillColor) {
          if (boxLocal.x >= ann.x && boxLocal.x <= ann.x + ann.width && boxLocal.y >= ann.y && boxLocal.y <= ann.y + ann.height) return ann;
        }
        // Also check near the border (stroke)
        if (isPointNearRect(boxLocal.x, boxLocal.y, ann.x, ann.y, ann.width, ann.height, tol)) return ann;
        break;
      case 'highlight':
        // Transform click point by inverse rotation if annotation is rotated
        const hlCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
        const hlLocal = transformPointByInverseRotation(x, y, hlCenter.x, hlCenter.y, ann.rotation);
        if (hlLocal.x >= ann.x && hlLocal.x <= ann.x + ann.width && hlLocal.y >= ann.y && hlLocal.y <= ann.y + ann.height) return ann;
        break;
      case 'comment':
        const cw = ann.width || 24;
        const ch = ann.height || 24;
        // Transform click point by inverse rotation if annotation is rotated
        const commentCenter = { x: ann.x + cw / 2, y: ann.y + ch / 2 };
        const commentLocal = transformPointByInverseRotation(x, y, commentCenter.x, commentCenter.y, ann.rotation);
        if (commentLocal.x >= ann.x && commentLocal.x <= ann.x + cw && commentLocal.y >= ann.y && commentLocal.y <= ann.y + ch) return ann;
        break;
      case 'text':
        if (annotationCtx) {
          annotationCtx.font = `${ann.fontSize || 16}px Arial`;
          const textWidth = annotationCtx.measureText(ann.text).width;
          const fontSize = ann.fontSize || 16;
          if (x >= ann.x && x <= ann.x + textWidth && y >= ann.y - fontSize && y <= ann.y) return ann;
        }
        break;
      case 'textbox':
        const tbWidth = ann.width || 150;
        const tbHeight = ann.height || 50;
        // Transform click point by inverse rotation if annotation is rotated
        const tbCenter = { x: ann.x + tbWidth / 2, y: ann.y + tbHeight / 2 };
        const tbLocal = transformPointByInverseRotation(x, y, tbCenter.x, tbCenter.y, ann.rotation);
        if (tbLocal.x >= ann.x && tbLocal.x <= ann.x + tbWidth && tbLocal.y >= ann.y && tbLocal.y <= ann.y + tbHeight) return ann;
        break;
      case 'callout':
        const coWidth = ann.width || 150;
        const coHeight = ann.height || 50;
        // Check if clicking inside the text box
        if (x >= ann.x && x <= ann.x + coWidth && y >= ann.y && y <= ann.y + coHeight) return ann;
        // Also check if clicking near the arrow tip or knee
        const arrowX = ann.arrowX !== undefined ? ann.arrowX : ann.x - 60;
        const arrowY = ann.arrowY !== undefined ? ann.arrowY : ann.y + coHeight;
        const kneeX = ann.kneeX !== undefined ? ann.kneeX : ann.x - 30;
        const kneeY = ann.kneeY !== undefined ? ann.kneeY : ann.y + coHeight / 2;
        if (Math.sqrt(Math.pow(x - arrowX, 2) + Math.pow(y - arrowY, 2)) < tol * 1.5) return ann;
        if (Math.sqrt(Math.pow(x - kneeX, 2) + Math.pow(y - kneeY, 2)) < tol * 1.5) return ann;
        break;
      case 'polygon':
      case 'cloud':
        // Transform click point by inverse rotation if annotation is rotated
        const polyCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
        const polyLocal = transformPointByInverseRotation(x, y, polyCenter.x, polyCenter.y, ann.rotation);
        if (polyLocal.x >= ann.x && polyLocal.x <= ann.x + ann.width && polyLocal.y >= ann.y && polyLocal.y <= ann.y + ann.height) return ann;
        break;
      case 'image':
      case 'stamp':
      case 'signature':
      case 'redaction':
        // Transform click point by inverse rotation if annotation is rotated
        const imgCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
        const imgLocal = transformPointByInverseRotation(x, y, imgCenter.x, imgCenter.y, ann.rotation);
        if (imgLocal.x >= ann.x && imgLocal.x <= ann.x + ann.width && imgLocal.y >= ann.y && imgLocal.y <= ann.y + ann.height) return ann;
        break;
      case 'measureDistance': {
        const d = distanceToLine(x, y, ann.startX, ann.startY, ann.endX, ann.endY);
        if (d < tol) return ann;
        break;
      }
      case 'measureArea':
      case 'measurePerimeter':
        if (ann.points && ann.points.length >= 2) {
          // Check proximity to any edge
          for (let i = 0; i < ann.points.length - 1; i++) {
            const d = distanceToLine(x, y, ann.points[i].x, ann.points[i].y, ann.points[i+1].x, ann.points[i+1].y);
            if (d < tol) return ann;
          }
          // For area, also check closing edge
          if (ann.type === 'measureArea' && ann.points.length >= 3) {
            const last = ann.points.length - 1;
            const d = distanceToLine(x, y, ann.points[last].x, ann.points[last].y, ann.points[0].x, ann.points[0].y);
            if (d < tol) return ann;
          }
        }
        break;
      case 'textHighlight':
      case 'textStrikethrough':
      case 'textUnderline':
        // Check if clicking inside any of the text rects
        if (ann.rects && ann.rects.length > 0) {
          for (const rect of ann.rects) {
            if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
              return ann;
            }
          }
        } else {
          // Fallback to bounding box
          if (x >= ann.x && x <= ann.x + ann.width && y >= ann.y && y <= ann.y + ann.height) return ann;
        }
        break;
    }
  }
  return null;
}

// Check if point is inside annotation (for moving)
export function isPointInsideAnnotation(x, y, annotation) {
  // For shapes that support rotation, transform the point first
  const sizeInfo = getAnnotationCenterAndSize(annotation);
  let localX = x, localY = y;
  if (sizeInfo && annotation.rotation) {
    const transformed = transformPointByInverseRotation(x, y, sizeInfo.centerX, sizeInfo.centerY, annotation.rotation);
    localX = transformed.x;
    localY = transformed.y;
  }

  switch (annotation.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'callout':
      const w = annotation.width || 150;
      const h = annotation.height || 50;
      return localX >= annotation.x && localX <= annotation.x + w &&
             localY >= annotation.y && localY <= annotation.y + h;

    case 'circle':
      // Check if point is inside ellipse using bounding box model
      const ellW = annotation.width || annotation.radius * 2;
      const ellH = annotation.height || annotation.radius * 2;
      const ellCX = annotation.x + ellW / 2;
      const ellCY = annotation.y + ellH / 2;
      const ellRX = ellW / 2;
      const ellRY = ellH / 2;
      // Normalized distance from center (1 means on the ellipse boundary)
      const normDist = Math.pow((localX - ellCX) / ellRX, 2) + Math.pow((localY - ellCY) / ellRY, 2);
      return normDist <= 1;

    case 'line':
    case 'arrow':
      const lineDist = distanceToLine(x, y, annotation.startX, annotation.startY, annotation.endX, annotation.endY);
      return lineDist < 15;

    case 'comment':
      const commentW = annotation.width || 24;
      const commentH = annotation.height || 24;
      return localX >= annotation.x && localX <= annotation.x + commentW &&
             localY >= annotation.y && localY <= annotation.y + commentH;

    case 'text':
      if (annotationCtx) {
        annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
        const textWidth = annotationCtx.measureText(annotation.text).width;
        const textHeight = annotation.fontSize || 16;
        return x >= annotation.x && x <= annotation.x + textWidth &&
               y >= annotation.y - textHeight && y <= annotation.y;
      }
      return false;

    case 'draw':
      if (annotation.path && annotation.path.length > 0) {
        const minX = Math.min(...annotation.path.map(p => p.x));
        const minY = Math.min(...annotation.path.map(p => p.y));
        const maxX = Math.max(...annotation.path.map(p => p.x));
        const maxY = Math.max(...annotation.path.map(p => p.y));
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
      }
      return false;

    case 'polyline':
      if (annotation.points && annotation.points.length > 0) {
        const plMinX = Math.min(...annotation.points.map(p => p.x));
        const plMinY = Math.min(...annotation.points.map(p => p.y));
        const plMaxX = Math.max(...annotation.points.map(p => p.x));
        const plMaxY = Math.max(...annotation.points.map(p => p.y));
        return x >= plMinX && x <= plMaxX && y >= plMinY && y <= plMaxY;
      }
      return false;

    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction':
      return localX >= annotation.x && localX <= annotation.x + annotation.width &&
             localY >= annotation.y && localY <= annotation.y + annotation.height;

    case 'measureDistance': {
      const md = distanceToLine(x, y, annotation.startX, annotation.startY, annotation.endX, annotation.endY);
      return md < 8;
    }

    case 'measureArea':
    case 'measurePerimeter':
      if (annotation.points && annotation.points.length >= 2) {
        for (let i = 0; i < annotation.points.length - 1; i++) {
          if (distanceToLine(x, y, annotation.points[i].x, annotation.points[i].y, annotation.points[i+1].x, annotation.points[i+1].y) < 8) return true;
        }
        if (annotation.type === 'measureArea' && annotation.points.length >= 3) {
          const last = annotation.points.length - 1;
          if (distanceToLine(x, y, annotation.points[last].x, annotation.points[last].y, annotation.points[0].x, annotation.points[0].y) < 8) return true;
        }
      }
      return false;

    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      // Check if inside any of the text rects
      if (annotation.rects && annotation.rects.length > 0) {
        for (const rect of annotation.rects) {
          if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
            return true;
          }
        }
      }
      // Fallback to bounding box
      return x >= annotation.x && x <= annotation.x + annotation.width &&
             y >= annotation.y && y <= annotation.y + annotation.height;

    default:
      return false;
  }
}
