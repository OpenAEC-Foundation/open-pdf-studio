import { HANDLE_TYPES } from '../core/constants.js';
import { state } from '../core/state.js';
import { snapAngle } from '../utils/helpers.js';

// Apply resize based on handle being dragged
export function applyResize(annotation, handleType, deltaX, deltaY, originalAnn, shiftKey = false) {
  if (annotation.locked) return;

  switch (annotation.type) {
    case 'box':
    case 'circle':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 10) annotation.width = 10;
      if (annotation.height < 10) annotation.height = 10;
      break;

    case 'callout':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 150;
      if (!originalAnn.height) originalAnn.height = 50;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_ARROW:
          // Move arrow tip
          annotation.arrowX = (originalAnn.arrowX || originalAnn.x - 60) + deltaX;
          annotation.arrowY = (originalAnn.arrowY || originalAnn.y + originalAnn.height) + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_KNEE:
          // Move knee point
          annotation.kneeX = (originalAnn.kneeX || originalAnn.x - 30) + deltaX;
          annotation.kneeY = (originalAnn.kneeY || originalAnn.y + originalAnn.height / 2) + deltaY;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 50) annotation.width = 50;
      if (annotation.height < 30) annotation.height = 30;
      break;

    case 'line':
    case 'arrow':
      if (handleType === HANDLE_TYPES.LINE_START) {
        let newStartX = originalAnn.startX + deltaX;
        let newStartY = originalAnn.startY + deltaY;

        // Snap to angle increments when Shift is held (and angle snapping is enabled)
        if (shiftKey && state.preferences.enableAngleSnap) {
          const fixedX = originalAnn.endX;
          const fixedY = originalAnn.endY;
          const dx = newStartX - fixedX;
          const dy = newStartY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, state.preferences.angleSnapDegrees) * (Math.PI / 180);
          newStartX = fixedX + length * Math.cos(snappedAngle);
          newStartY = fixedY + length * Math.sin(snappedAngle);
        }

        annotation.startX = newStartX;
        annotation.startY = newStartY;
      } else if (handleType === HANDLE_TYPES.LINE_END) {
        let newEndX = originalAnn.endX + deltaX;
        let newEndY = originalAnn.endY + deltaY;

        // Snap to angle increments when Shift is held (and angle snapping is enabled)
        if (shiftKey && state.preferences.enableAngleSnap) {
          const fixedX = originalAnn.startX;
          const fixedY = originalAnn.startY;
          const dx = newEndX - fixedX;
          const dy = newEndY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, state.preferences.angleSnapDegrees) * (Math.PI / 180);
          newEndX = fixedX + length * Math.cos(snappedAngle);
          newEndY = fixedY + length * Math.sin(snappedAngle);
        }

        annotation.endX = newEndX;
        annotation.endY = newEndY;
      }
      break;

    case 'draw':
      // Scale the path based on bounding box resize
      if (originalAnn.path && originalAnn.path.length > 0) {
        const minX = Math.min(...originalAnn.path.map(p => p.x));
        const minY = Math.min(...originalAnn.path.map(p => p.y));
        const maxX = Math.max(...originalAnn.path.map(p => p.x));
        const maxY = Math.max(...originalAnn.path.map(p => p.y));
        const origWidth = maxX - minX || 1;
        const origHeight = maxY - minY || 1;

        let newMinX = minX, newMinY = minY, newMaxX = maxX, newMaxY = maxY;

        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            newMinX = minX + deltaX;
            newMinY = minY + deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            newMaxX = maxX + deltaX;
            newMinY = minY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            newMinX = minX + deltaX;
            newMaxY = maxY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            newMaxX = maxX + deltaX;
            newMaxY = maxY + deltaY;
            break;
        }

        const newWidth = newMaxX - newMinX || 1;
        const newHeight = newMaxY - newMinY || 1;
        const scaleX = newWidth / origWidth;
        const scaleY = newHeight / origHeight;

        annotation.path = originalAnn.path.map(p => ({
          x: newMinX + (p.x - minX) * scaleX,
          y: newMinY + (p.y - minY) * scaleY
        }));
      }
      break;

    case 'polyline':
      // Scale the points based on bounding box resize
      if (originalAnn.points && originalAnn.points.length > 0) {
        const plMinX = Math.min(...originalAnn.points.map(p => p.x));
        const plMinY = Math.min(...originalAnn.points.map(p => p.y));
        const plMaxX = Math.max(...originalAnn.points.map(p => p.x));
        const plMaxY = Math.max(...originalAnn.points.map(p => p.y));
        const plOrigWidth = plMaxX - plMinX || 1;
        const plOrigHeight = plMaxY - plMinY || 1;

        let plNewMinX = plMinX, plNewMinY = plMinY, plNewMaxX = plMaxX, plNewMaxY = plMaxY;

        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            plNewMinX = plMinX + deltaX;
            plNewMinY = plMinY + deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            plNewMaxX = plMaxX + deltaX;
            plNewMinY = plMinY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            plNewMinX = plMinX + deltaX;
            plNewMaxY = plMaxY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            plNewMaxX = plMaxX + deltaX;
            plNewMaxY = plMaxY + deltaY;
            break;
        }

        const plNewWidth = plNewMaxX - plNewMinX || 1;
        const plNewHeight = plNewMaxY - plNewMinY || 1;
        const plScaleX = plNewWidth / plOrigWidth;
        const plScaleY = plNewHeight / plOrigHeight;

        annotation.points = originalAnn.points.map(p => ({
          x: plNewMinX + (p.x - plMinX) * plScaleX,
          y: plNewMinY + (p.y - plMinY) * plScaleY
        }));
      }
      break;

    case 'image':
      // Maintain aspect ratio when shift is held
      const aspectRatio = originalAnn.originalWidth / originalAnn.originalHeight;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          if (shiftKey) {
            // Maintain aspect ratio
            const newWidth = originalAnn.width - deltaX;
            const newHeight = newWidth / aspectRatio;
            annotation.x = originalAnn.x + originalAnn.width - newWidth;
            annotation.y = originalAnn.y + originalAnn.height - newHeight;
            annotation.width = newWidth;
            annotation.height = newHeight;
          } else {
            annotation.x = originalAnn.x + deltaX;
            annotation.y = originalAnn.y + deltaY;
            annotation.width = originalAnn.width - deltaX;
            annotation.height = originalAnn.height - deltaY;
          }
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          if (shiftKey) {
            const newWidth = originalAnn.width + deltaX;
            const newHeight = newWidth / aspectRatio;
            annotation.y = originalAnn.y + originalAnn.height - newHeight;
            annotation.width = newWidth;
            annotation.height = newHeight;
          } else {
            annotation.y = originalAnn.y + deltaY;
            annotation.width = originalAnn.width + deltaX;
            annotation.height = originalAnn.height - deltaY;
          }
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          if (shiftKey) {
            const newWidth = originalAnn.width - deltaX;
            const newHeight = newWidth / aspectRatio;
            annotation.x = originalAnn.x + originalAnn.width - newWidth;
            annotation.width = newWidth;
            annotation.height = newHeight;
          } else {
            annotation.x = originalAnn.x + deltaX;
            annotation.width = originalAnn.width - deltaX;
            annotation.height = originalAnn.height + deltaY;
          }
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          if (shiftKey) {
            const newWidth = originalAnn.width + deltaX;
            const newHeight = newWidth / aspectRatio;
            annotation.width = newWidth;
            annotation.height = newHeight;
          } else {
            annotation.width = originalAnn.width + deltaX;
            annotation.height = originalAnn.height + deltaY;
          }
          break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 20) annotation.width = 20;
      if (annotation.height < 20) annotation.height = 20;
      break;

    case 'comment':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 24;
      if (!originalAnn.height) originalAnn.height = 24;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 20) annotation.width = 20;
      if (annotation.height < 20) annotation.height = 20;
      break;
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Apply move to annotation
export function applyMove(annotation, deltaX, deltaY) {
  if (annotation.locked) return;

  switch (annotation.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'callout':
      // Move the text box
      annotation.x += deltaX;
      annotation.y += deltaY;
      // Also move the callout arm points
      if (annotation.arrowX !== undefined) annotation.arrowX += deltaX;
      if (annotation.arrowY !== undefined) annotation.arrowY += deltaY;
      if (annotation.kneeX !== undefined) annotation.kneeX += deltaX;
      if (annotation.kneeY !== undefined) annotation.kneeY += deltaY;
      if (annotation.armOriginX !== undefined) annotation.armOriginX += deltaX;
      if (annotation.armOriginY !== undefined) annotation.armOriginY += deltaY;
      break;

    case 'circle':
      // Support both old (centerX/centerY) and new (x/y) model
      if (annotation.x !== undefined) {
        annotation.x += deltaX;
        annotation.y += deltaY;
      } else {
        annotation.centerX += deltaX;
        annotation.centerY += deltaY;
      }
      break;

    case 'line':
    case 'arrow':
      annotation.startX += deltaX;
      annotation.startY += deltaY;
      annotation.endX += deltaX;
      annotation.endY += deltaY;
      break;

    case 'comment':
    case 'text':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'draw':
      if (annotation.path) {
        annotation.path = annotation.path.map(p => ({
          x: p.x + deltaX,
          y: p.y + deltaY
        }));
      }
      break;

    case 'polyline':
      if (annotation.points) {
        annotation.points = annotation.points.map(p => ({
          x: p.x + deltaX,
          y: p.y + deltaY
        }));
      }
      break;

    case 'image':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      // Move bounding box
      annotation.x += deltaX;
      annotation.y += deltaY;
      // Move individual rects
      if (annotation.rects) {
        annotation.rects = annotation.rects.map(r => ({
          x: r.x + deltaX,
          y: r.y + deltaY,
          width: r.width,
          height: r.height
        }));
      }
      // Move quadPoints if present
      if (annotation.quadPoints) {
        annotation.quadPoints = annotation.quadPoints.map(quad => {
          // quadPoints: [x1,y1,x2,y2,x3,y3,x4,y4]
          return [
            quad[0] + deltaX, quad[1] + deltaY,  // top-left
            quad[2] + deltaX, quad[3] + deltaY,  // top-right
            quad[4] + deltaX, quad[5] + deltaY,  // bottom-left
            quad[6] + deltaX, quad[7] + deltaY   // bottom-right
          ];
        });
      }
      break;
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Apply rotation to annotation
export function applyRotation(annotation, mouseX, mouseY, originalAnn) {
  if (annotation.locked) return;

  // Supported types for rotation
  const rotationTypes = ['image', 'comment', 'box', 'circle', 'highlight', 'polygon', 'cloud', 'textbox'];
  if (!rotationTypes.includes(annotation.type)) return;

  // Calculate center of annotation
  let width, height, centerX, centerY;

  if (annotation.type === 'circle' && originalAnn.radius) {
    // Handle old circle format with radius
    width = originalAnn.radius * 2;
    height = originalAnn.radius * 2;
    centerX = originalAnn.centerX || (originalAnn.x + width / 2);
    centerY = originalAnn.centerY || (originalAnn.y + height / 2);
  } else {
    width = originalAnn.width || 24;
    height = originalAnn.height || 24;
    centerX = originalAnn.x + width / 2;
    centerY = originalAnn.y + height / 2;
  }

  // Calculate angle from center to mouse position
  const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);

  // Adjust angle (rotation handle is at top, so add 90 degrees)
  annotation.rotation = angle + 90;

  // Snap to 15 degree increments when shift is held
  if (state.shiftKeyPressed && state.preferences.enableAngleSnap) {
    annotation.rotation = snapAngle(annotation.rotation, state.preferences.angleSnapDegrees);
  }

  annotation.modifiedAt = new Date().toISOString();
}
