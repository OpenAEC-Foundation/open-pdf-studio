import { state } from '../core/state.js';
import { annotationCanvas, annotationCtx, colorPicker, lineWidth, pdfContainer } from '../ui/dom-elements.js';
import { createAnnotation, cloneAnnotation } from '../annotations/factory.js';
import { findAnnotationAt } from '../annotations/geometry.js';
import { findHandleAt, getCursorForHandle } from '../annotations/handles.js';
import { applyResize, applyMove, applyRotation } from '../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous, renderAnnotationsForPage, drawPolygonShape, drawCloudShape } from '../annotations/rendering.js';
import { showProperties, hideProperties } from '../ui/properties-panel.js';
import { startTextEditing, addTextAnnotation, addComment } from '../tools/text-editing.js';
import { snapAngle } from '../utils/helpers.js';
import { markDocumentModified } from '../ui/tabs.js';

// Mouse down handler for single page mode
export function handleMouseDown(e) {
  if (!state.pdfDoc) return;

  const rect = annotationCanvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  const x = (e.clientX - rect.left) / state.scale;
  const y = (e.clientY - rect.top) / state.scale;

  state.startX = x;
  state.startY = y;
  state.dragStartX = x;
  state.dragStartY = y;

  // Handle middle mouse button panning (works regardless of current tool)
  if (e.button === 1) {
    const scrollContainer = getScrollContainer();
    state.isPanning = true;
    state.isMiddleButtonPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panScrollStartX = scrollContainer ? scrollContainer.scrollLeft : 0;
    state.panScrollStartY = scrollContainer ? scrollContainer.scrollTop : 0;
    // Set grabbing cursor on all relevant elements
    document.body.style.cursor = 'grabbing';
    pdfContainer.style.cursor = 'grabbing';
    if (annotationCanvas) annotationCanvas.style.cursor = 'grabbing';
    document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = 'grabbing');
    // Add document-level listeners for smooth panning
    document.addEventListener('mousemove', handlePanMove);
    document.addEventListener('mouseup', handleMiddleButtonPanEnd);
    e.preventDefault();
    return;
  }

  // Handle hand tool (panning)
  if (state.currentTool === 'hand') {
    const scrollContainer = getScrollContainer();
    state.isPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panScrollStartX = scrollContainer ? scrollContainer.scrollLeft : 0;
    state.panScrollStartY = scrollContainer ? scrollContainer.scrollTop : 0;
    // Set grabbing cursor on all relevant elements
    document.body.style.cursor = 'grabbing';
    pdfContainer.style.cursor = 'grabbing';
    if (annotationCanvas) annotationCanvas.style.cursor = 'grabbing';
    document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = 'grabbing');
    // Add document-level listeners for smooth panning
    document.addEventListener('mousemove', handlePanMove);
    document.addEventListener('mouseup', handlePanEnd);
    e.preventDefault();
    return;
  }

  // Handle select tool
  if (state.currentTool === 'select') {
    // First check if clicking on a handle of the selected annotation
    if (state.selectedAnnotation) {
      const handleType = findHandleAt(x, y, state.selectedAnnotation);
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.originalAnnotation = cloneAnnotation(state.selectedAnnotation);
        annotationCanvas.style.cursor = getCursorForHandle(handleType);
        return;
      }
    }

    // Check if clicking on an annotation
    const clickedAnnotation = findAnnotationAt(x, y);
    if (clickedAnnotation) {
      // Double-click to edit text for textbox/callout
      if (e.detail === 2 && ['textbox', 'callout'].includes(clickedAnnotation.type)) {
        startTextEditing(clickedAnnotation);
        return;
      }

      state.selectedAnnotation = clickedAnnotation;
      showProperties(clickedAnnotation);
      state.isDragging = true;
      state.originalAnnotation = cloneAnnotation(clickedAnnotation);
      annotationCanvas.style.cursor = 'move';
    } else {
      // Clicked on empty space - deselect
      hideProperties();
    }
    return;
  }

  // Handle polyline tool specially (click to add points, double-click to finish)
  if (state.currentTool === 'polyline') {
    if (e.detail === 2) {
      // Double-click to finish polyline
      if (state.polylinePoints.length >= 2) {
        state.annotations.push(createAnnotation({
          type: 'polyline',
          page: state.currentPage,
          points: [...state.polylinePoints],
          color: colorPicker.value,
          strokeColor: colorPicker.value,
          lineWidth: parseInt(lineWidth.value)
        }));
      }
      state.polylinePoints = [];
      state.isDrawingPolyline = false;
      redrawAnnotations();
      return;
    }

    // Single click - add point
    state.polylinePoints.push({ x, y });
    state.isDrawingPolyline = true;
    redrawAnnotations();
    return;
  }

  // Start drawing for other tools
  state.isDrawing = true;

  if (state.currentTool === 'draw') {
    state.currentPath = [{ x, y }];
  } else if (state.currentTool === 'comment') {
    addComment(x, y);
    state.isDrawing = false;
  } else if (state.currentTool === 'text') {
    addTextAnnotation(x, y);
    state.isDrawing = false;
  }
}

// Get the scrollable container (main-view, not pdf-container)
function getScrollContainer() {
  return document.querySelector('.main-view');
}

// Document-level pan move handler (for smooth panning outside canvas)
function handlePanMove(e) {
  if (!state.isPanning) return;
  const scrollContainer = getScrollContainer();
  if (!scrollContainer) return;
  const deltaX = e.clientX - state.panStartX;
  const deltaY = e.clientY - state.panStartY;
  scrollContainer.scrollLeft = state.panScrollStartX - deltaX;
  scrollContainer.scrollTop = state.panScrollStartY - deltaY;
}

// Document-level pan end handler
function handlePanEnd(e) {
  if (!state.isPanning) return;
  state.isPanning = false;
  // Reset cursors back to grab
  document.body.style.cursor = '';
  pdfContainer.style.cursor = '';
  if (annotationCanvas) annotationCanvas.style.cursor = 'grab';
  document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = 'grab');
  document.removeEventListener('mousemove', handlePanMove);
  document.removeEventListener('mouseup', handlePanEnd);
}

// Document-level middle button pan end handler
function handleMiddleButtonPanEnd(e) {
  if (!state.isPanning || !state.isMiddleButtonPanning) return;
  state.isPanning = false;
  state.isMiddleButtonPanning = false;
  // Reset cursors back to default (not grab, since we're not using hand tool)
  document.body.style.cursor = '';
  pdfContainer.style.cursor = '';
  if (annotationCanvas) annotationCanvas.style.cursor = '';
  document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = '');
  document.removeEventListener('mousemove', handlePanMove);
  document.removeEventListener('mouseup', handleMiddleButtonPanEnd);
}

// Mouse move handler for single page mode
export function handleMouseMove(e) {
  if (!state.pdfDoc || !annotationCanvas) return;

  // Skip if panning (handled by document-level listener)
  if (state.isPanning) return;

  const rect = annotationCanvas.getBoundingClientRect();
  const currentX = (e.clientX - rect.left) / state.scale;
  const currentY = (e.clientY - rect.top) / state.scale;

  // Update cursor when hovering over handles
  if (state.currentTool === 'select' && state.selectedAnnotation && !state.isDragging && !state.isResizing) {
    const handleType = findHandleAt(currentX, currentY, state.selectedAnnotation);
    if (handleType) {
      annotationCanvas.style.cursor = getCursorForHandle(handleType);
    } else {
      const ann = findAnnotationAt(currentX, currentY);
      annotationCanvas.style.cursor = ann ? 'move' : 'default';
    }
    return;
  }

  // Handle resizing or rotation
  if (state.isResizing && state.selectedAnnotation && state.activeHandle) {
    // Handle rotation separately
    if (state.activeHandle === 'rotate') {
      Object.assign(state.selectedAnnotation, cloneAnnotation(state.originalAnnotation));
      state.shiftKeyPressed = e.shiftKey;
      applyRotation(state.selectedAnnotation, currentX, currentY, state.originalAnnotation);
      redrawAnnotations();
      return;
    }

    const deltaX = currentX - state.dragStartX;
    const deltaY = currentY - state.dragStartY;

    // Restore original and apply resize
    Object.assign(state.selectedAnnotation, cloneAnnotation(state.originalAnnotation));
    applyResize(state.selectedAnnotation, state.activeHandle, deltaX, deltaY, state.originalAnnotation, e.shiftKey);

    redrawAnnotations();
    return;
  }

  // Handle dragging (moving)
  if (state.isDragging && state.selectedAnnotation) {
    const deltaX = currentX - state.dragStartX;
    const deltaY = currentY - state.dragStartY;

    // Restore original position and apply move
    Object.assign(state.selectedAnnotation, cloneAnnotation(state.originalAnnotation));
    applyMove(state.selectedAnnotation, deltaX, deltaY);

    redrawAnnotations();
    return;
  }

  // Handle polyline preview
  if (state.currentTool === 'polyline' && state.isDrawingPolyline && state.polylinePoints.length > 0) {
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(state.scale, state.scale);
    annotationCtx.strokeStyle = colorPicker.value;
    annotationCtx.lineWidth = parseInt(lineWidth.value);
    annotationCtx.lineCap = 'round';
    annotationCtx.lineJoin = 'round';
    annotationCtx.beginPath();
    // Draw existing points
    state.polylinePoints.forEach((point, index) => {
      if (index === 0) {
        annotationCtx.moveTo(point.x, point.y);
      } else {
        annotationCtx.lineTo(point.x, point.y);
      }
    });
    // Draw line to current mouse position
    annotationCtx.lineTo(currentX, currentY);
    annotationCtx.stroke();
    // Draw small circles at each point
    state.polylinePoints.forEach(point => {
      annotationCtx.beginPath();
      annotationCtx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      annotationCtx.fillStyle = colorPicker.value;
      annotationCtx.fill();
    });
    annotationCtx.restore();
    return;
  }

  if (!state.isDrawing) return;

  // Drawing preview for various tools
  if (state.currentTool === 'draw') {
    state.currentPath.push({ x: currentX, y: currentY });
    // Draw temporary line with scale
    annotationCtx.save();
    annotationCtx.scale(state.scale, state.scale);
    annotationCtx.strokeStyle = colorPicker.value;
    annotationCtx.lineWidth = parseInt(lineWidth.value);
    annotationCtx.lineCap = 'round';
    annotationCtx.lineJoin = 'round';
    annotationCtx.beginPath();
    annotationCtx.moveTo(state.currentPath[state.currentPath.length - 2].x, state.currentPath[state.currentPath.length - 2].y);
    annotationCtx.lineTo(currentX, currentY);
    annotationCtx.stroke();
    annotationCtx.restore();
  } else {
    // Show preview for shape tools
    drawShapePreview(currentX, currentY, e);
  }
}

// Draw arrowhead at specified position
function drawArrowhead(ctx, x, y, angle, size, style) {
  const halfAngle = Math.PI / 6; // 30 degrees

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.beginPath();
  if (style === 'open' || style === 'stealth') {
    // Open arrow style - two lines
    ctx.moveTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(0, 0);
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.stroke();
  } else if (style === 'closed') {
    // Closed/filled arrow style - triangle
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'diamond') {
    // Diamond style
    const halfSize = size / 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(-halfSize, -halfSize * 0.6);
    ctx.lineTo(-size, 0);
    ctx.lineTo(-halfSize, halfSize * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'circle') {
    // Circle style
    const radius = size / 3;
    ctx.arc(-radius, 0, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'square') {
    // Square style
    const halfSize = size / 3;
    ctx.rect(-size / 2 - halfSize, -halfSize, halfSize * 2, halfSize * 2);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'slash') {
    // Slash style - perpendicular line
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(0, size / 2);
    ctx.stroke();
  }

  ctx.restore();
}

// Draw shape preview during mouse move
function drawShapePreview(currentX, currentY, e) {
  redrawAnnotations();
  annotationCtx.save();
  annotationCtx.scale(state.scale, state.scale);

  const prefs = state.preferences;

  switch (state.currentTool) {
    case 'highlight':
      annotationCtx.fillStyle = colorPicker.value;
      annotationCtx.globalAlpha = 0.3;
      annotationCtx.fillRect(state.startX, state.startY, currentX - state.startX, currentY - state.startY);
      annotationCtx.globalAlpha = 1;
      break;

    case 'line':
      let lineEndX = currentX;
      let lineEndY = currentY;
      // Snap to angle increments when Shift is held
      if (e.shiftKey && prefs.enableAngleSnap) {
        const dx = currentX - state.startX;
        const dy = currentY - state.startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
        lineEndX = state.startX + length * Math.cos(snappedAngle);
        lineEndY = state.startY + length * Math.sin(snappedAngle);
      }
      annotationCtx.strokeStyle = colorPicker.value;
      annotationCtx.lineWidth = parseInt(lineWidth.value);
      annotationCtx.lineCap = 'round';
      annotationCtx.beginPath();
      annotationCtx.moveTo(state.startX, state.startY);
      annotationCtx.lineTo(lineEndX, lineEndY);
      annotationCtx.stroke();
      break;

    case 'arrow':
      let arrowEndX = currentX;
      let arrowEndY = currentY;
      // Snap to angle increments when Shift is held
      if (e.shiftKey && prefs.enableAngleSnap) {
        const dx = currentX - state.startX;
        const dy = currentY - state.startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
        arrowEndX = state.startX + length * Math.cos(snappedAngle);
        arrowEndY = state.startY + length * Math.sin(snappedAngle);
      }
      // Get arrow preferences
      const arrowStrokeColor = prefs.arrowStrokeColor || colorPicker.value;
      const arrowFillColor = prefs.arrowFillColor || arrowStrokeColor;
      const arrowLineWidth = prefs.arrowLineWidth || parseInt(lineWidth.value);
      const arrowBorderStyle = prefs.arrowBorderStyle || 'solid';
      const arrowHeadSize = prefs.arrowHeadSize || 12;
      const arrowStartHead = prefs.arrowStartHead || 'none';
      const arrowEndHead = prefs.arrowEndHead || 'open';

      annotationCtx.strokeStyle = arrowStrokeColor;
      annotationCtx.fillStyle = arrowFillColor;
      annotationCtx.lineWidth = arrowLineWidth;
      annotationCtx.lineCap = 'round';
      annotationCtx.lineJoin = 'round';

      // Set border style
      if (arrowBorderStyle === 'dashed') {
        annotationCtx.setLineDash([8, 4]);
      } else if (arrowBorderStyle === 'dotted') {
        annotationCtx.setLineDash([2, 2]);
      } else {
        annotationCtx.setLineDash([]);
      }

      // Draw the line
      annotationCtx.beginPath();
      annotationCtx.moveTo(state.startX, state.startY);
      annotationCtx.lineTo(arrowEndX, arrowEndY);
      annotationCtx.stroke();

      // Reset line dash for arrowheads
      annotationCtx.setLineDash([]);

      // Draw arrowhead at end
      if (arrowEndHead !== 'none') {
        const angle = Math.atan2(arrowEndY - state.startY, arrowEndX - state.startX);
        drawArrowhead(annotationCtx, arrowEndX, arrowEndY, angle, arrowHeadSize, arrowEndHead);
      }

      // Draw arrowhead at start (if enabled)
      if (arrowStartHead !== 'none') {
        const startAngle = Math.atan2(state.startY - arrowEndY, state.startX - arrowEndX);
        drawArrowhead(annotationCtx, state.startX, state.startY, startAngle, arrowHeadSize, arrowStartHead);
      }
      break;

    case 'circle':
      const circleX = Math.min(state.startX, currentX);
      const circleY = Math.min(state.startY, currentY);
      const circleW = Math.abs(currentX - state.startX);
      const circleH = Math.abs(currentY - state.startY);
      const circleCX = circleX + circleW / 2;
      const circleCY = circleY + circleH / 2;
      if (circleW > 0 && circleH > 0) {
        annotationCtx.beginPath();
        annotationCtx.ellipse(circleCX, circleCY, circleW / 2, circleH / 2, 0, 0, 2 * Math.PI);
        if (!prefs.circleFillNone) {
          annotationCtx.fillStyle = prefs.circleFillColor;
          annotationCtx.globalAlpha = prefs.circleOpacity / 100;
          annotationCtx.fill();
          annotationCtx.globalAlpha = 1;
        }
        annotationCtx.strokeStyle = prefs.circleStrokeColor;
        annotationCtx.lineWidth = prefs.circleBorderWidth;
        annotationCtx.stroke();
      }
      break;

    case 'box':
      const boxX = Math.min(state.startX, currentX);
      const boxY = Math.min(state.startY, currentY);
      const boxW = Math.abs(currentX - state.startX);
      const boxH = Math.abs(currentY - state.startY);
      if (!prefs.rectFillNone) {
        annotationCtx.fillStyle = prefs.rectFillColor;
        annotationCtx.globalAlpha = prefs.rectOpacity / 100;
        annotationCtx.fillRect(boxX, boxY, boxW, boxH);
        annotationCtx.globalAlpha = 1;
      }
      annotationCtx.strokeStyle = prefs.rectStrokeColor;
      annotationCtx.lineWidth = prefs.rectBorderWidth;
      annotationCtx.strokeRect(boxX, boxY, boxW, boxH);
      break;

    case 'polygon':
      const width = currentX - state.startX;
      const height = currentY - state.startY;
      const cx = state.startX + width / 2;
      const cy = state.startY + height / 2;
      const rx = Math.abs(width) / 2;
      const ry = Math.abs(height) / 2;
      annotationCtx.strokeStyle = colorPicker.value;
      annotationCtx.lineWidth = parseInt(lineWidth.value);
      annotationCtx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const angle = (i * 2 * Math.PI / 6) - Math.PI / 2;
        const px = cx + rx * Math.cos(angle);
        const py = cy + ry * Math.sin(angle);
        if (i === 0) {
          annotationCtx.moveTo(px, py);
        } else {
          annotationCtx.lineTo(px, py);
        }
      }
      annotationCtx.closePath();
      annotationCtx.stroke();
      break;

    case 'cloud':
      const cloudX = Math.min(state.startX, currentX);
      const cloudY = Math.min(state.startY, currentY);
      const cloudW = Math.abs(currentX - state.startX);
      const cloudH = Math.abs(currentY - state.startY);
      if (cloudW > 10 && cloudH > 10) {
        annotationCtx.strokeStyle = colorPicker.value;
        annotationCtx.lineWidth = parseInt(lineWidth.value);
        drawCloudShape(annotationCtx, cloudX, cloudY, cloudW, cloudH);
      }
      break;

    case 'textbox':
      const tbX = Math.min(state.startX, currentX);
      const tbY = Math.min(state.startY, currentY);
      const tbWidth = Math.abs(currentX - state.startX);
      const tbHeight = Math.abs(currentY - state.startY);
      // Set border style
      if (prefs.textboxBorderStyle === 'dashed') {
        annotationCtx.setLineDash([8, 4]);
      } else if (prefs.textboxBorderStyle === 'dotted') {
        annotationCtx.setLineDash([2, 2]);
      } else {
        annotationCtx.setLineDash([]);
      }
      if (!prefs.textboxFillNone) {
        annotationCtx.fillStyle = prefs.textboxFillColor;
        annotationCtx.globalAlpha = (prefs.textboxOpacity || 100) / 100;
        annotationCtx.fillRect(tbX, tbY, tbWidth, tbHeight);
        annotationCtx.globalAlpha = 1;
      }
      annotationCtx.strokeStyle = prefs.textboxStrokeColor;
      annotationCtx.lineWidth = prefs.textboxBorderWidth;
      annotationCtx.strokeRect(tbX, tbY, tbWidth, tbHeight);
      annotationCtx.setLineDash([]);
      break;

    case 'callout':
      // Draw callout preview
      const defaultWidth = 150;
      const defaultHeight = 60;
      const coX = currentX - defaultWidth / 2;
      const coY = currentY - defaultHeight / 2;
      const arrowX = state.startX;
      const arrowY = state.startY;
      const boxCenterX = currentX;
      const isArrowLeft = arrowX < boxCenterX;
      let armOriginX;
      if (isArrowLeft) {
        armOriginX = coX;
      } else {
        armOriginX = coX + defaultWidth;
      }
      const armOriginY = Math.max(coY, Math.min(coY + defaultHeight, currentY));
      const armLength = Math.min(30, Math.abs(arrowX - armOriginX) * 0.4);
      const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
      const kneeY = armOriginY;
      // Set border style
      if (prefs.calloutBorderStyle === 'dashed') {
        annotationCtx.setLineDash([8, 4]);
      } else if (prefs.calloutBorderStyle === 'dotted') {
        annotationCtx.setLineDash([2, 2]);
      } else {
        annotationCtx.setLineDash([]);
      }
      if (!prefs.calloutFillNone) {
        annotationCtx.fillStyle = prefs.calloutFillColor;
        annotationCtx.globalAlpha = (prefs.calloutOpacity || 100) / 100;
        annotationCtx.fillRect(coX, coY, defaultWidth, defaultHeight);
        annotationCtx.globalAlpha = 1;
      }
      annotationCtx.strokeStyle = prefs.calloutStrokeColor;
      annotationCtx.lineWidth = prefs.calloutBorderWidth;
      annotationCtx.strokeRect(coX, coY, defaultWidth, defaultHeight);
      // Draw leader line
      annotationCtx.beginPath();
      annotationCtx.moveTo(armOriginX, armOriginY);
      annotationCtx.lineTo(kneeX, kneeY);
      annotationCtx.lineTo(arrowX, arrowY);
      annotationCtx.stroke();
      // Draw arrowhead
      const angle = Math.atan2(arrowY - kneeY, arrowX - kneeX);
      const arrowSize = 10;
      annotationCtx.beginPath();
      annotationCtx.moveTo(arrowX, arrowY);
      annotationCtx.lineTo(arrowX - arrowSize * Math.cos(angle - Math.PI / 6), arrowY - arrowSize * Math.sin(angle - Math.PI / 6));
      annotationCtx.moveTo(arrowX, arrowY);
      annotationCtx.lineTo(arrowX - arrowSize * Math.cos(angle + Math.PI / 6), arrowY - arrowSize * Math.sin(angle + Math.PI / 6));
      annotationCtx.stroke();
      annotationCtx.setLineDash([]);
      break;
  }

  annotationCtx.restore();
}

// Mouse up handler for single page mode
export function handleMouseUp(e) {
  // Hand tool panning is handled by document-level listener (handlePanEnd)
  if (state.isPanning) return;

  // Handle end of dragging/resizing
  if (state.isDragging || state.isResizing) {
    // Mark document as modified when annotation is moved/resized
    markDocumentModified();

    state.isDragging = false;
    state.isResizing = false;
    state.activeHandle = null;
    state.originalAnnotation = null;
    annotationCanvas.style.cursor = 'default';

    // Update properties panel with new values
    if (state.selectedAnnotation) {
      showProperties(state.selectedAnnotation);
    }
    return;
  }

  if (!state.isDrawing) return;

  const rect = annotationCanvas.getBoundingClientRect();
  const endX = (e.clientX - rect.left) / state.scale;
  const endY = (e.clientY - rect.top) / state.scale;

  const prefs = state.preferences;
  const annotationCountBefore = state.annotations.length;

  // Create annotation based on tool
  if (state.currentTool === 'draw' && state.currentPath.length > 1) {
    state.annotations.push(createAnnotation({
      type: 'draw',
      page: state.currentPage,
      path: state.currentPath,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
    state.currentPath = [];
  } else if (state.currentTool === 'highlight') {
    state.annotations.push(createAnnotation({
      type: 'highlight',
      page: state.currentPage,
      x: Math.min(state.startX, endX),
      y: Math.min(state.startY, endY),
      width: Math.abs(endX - state.startX),
      height: Math.abs(endY - state.startY),
      color: colorPicker.value,
      fillColor: colorPicker.value
    }));
  } else if (state.currentTool === 'line') {
    let finalEndX = endX;
    let finalEndY = endY;
    if (e.shiftKey && prefs.enableAngleSnap) {
      const dx = endX - state.startX;
      const dy = endY - state.startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
      finalEndX = state.startX + length * Math.cos(snappedAngle);
      finalEndY = state.startY + length * Math.sin(snappedAngle);
    }
    state.annotations.push(createAnnotation({
      type: 'line',
      page: state.currentPage,
      startX: state.startX,
      startY: state.startY,
      endX: finalEndX,
      endY: finalEndY,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  } else if (state.currentTool === 'arrow') {
    let finalEndX = endX;
    let finalEndY = endY;
    if (e.shiftKey && prefs.enableAngleSnap) {
      const dx = endX - state.startX;
      const dy = endY - state.startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
      finalEndX = state.startX + length * Math.cos(snappedAngle);
      finalEndY = state.startY + length * Math.sin(snappedAngle);
    }
    state.annotations.push(createAnnotation({
      type: 'arrow',
      page: state.currentPage,
      startX: state.startX,
      startY: state.startY,
      endX: finalEndX,
      endY: finalEndY,
      color: prefs.arrowStrokeColor || colorPicker.value,
      strokeColor: prefs.arrowStrokeColor || colorPicker.value,
      fillColor: prefs.arrowFillColor || prefs.arrowStrokeColor || colorPicker.value,
      lineWidth: prefs.arrowLineWidth || parseInt(lineWidth.value),
      borderStyle: prefs.arrowBorderStyle || 'solid',
      startHead: prefs.arrowStartHead || 'none',
      endHead: prefs.arrowEndHead || 'open',
      headSize: prefs.arrowHeadSize || 12,
      opacity: (prefs.arrowOpacity || 100) / 100
    }));
  } else if (state.currentTool === 'circle') {
    const circleX = Math.min(state.startX, endX);
    const circleY = Math.min(state.startY, endY);
    const circleW = Math.abs(endX - state.startX);
    const circleH = Math.abs(endY - state.startY);
    state.annotations.push(createAnnotation({
      type: 'circle',
      page: state.currentPage,
      x: circleX,
      y: circleY,
      width: circleW,
      height: circleH,
      color: prefs.circleStrokeColor,
      strokeColor: prefs.circleStrokeColor,
      fillColor: prefs.circleFillNone ? null : prefs.circleFillColor,
      lineWidth: prefs.circleBorderWidth,
      borderStyle: prefs.circleBorderStyle,
      opacity: prefs.circleOpacity / 100
    }));
  } else if (state.currentTool === 'box') {
    const boxX = Math.min(state.startX, endX);
    const boxY = Math.min(state.startY, endY);
    const boxW = Math.abs(endX - state.startX);
    const boxH = Math.abs(endY - state.startY);
    state.annotations.push(createAnnotation({
      type: 'box',
      page: state.currentPage,
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      color: prefs.rectStrokeColor,
      strokeColor: prefs.rectStrokeColor,
      fillColor: prefs.rectFillNone ? null : prefs.rectFillColor,
      lineWidth: prefs.rectBorderWidth,
      borderStyle: prefs.rectBorderStyle,
      opacity: prefs.rectOpacity / 100
    }));
  } else if (state.currentTool === 'polygon') {
    state.annotations.push(createAnnotation({
      type: 'polygon',
      page: state.currentPage,
      x: state.startX,
      y: state.startY,
      width: endX - state.startX,
      height: endY - state.startY,
      sides: 6,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  } else if (state.currentTool === 'cloud') {
    const cloudX = Math.min(state.startX, endX);
    const cloudY = Math.min(state.startY, endY);
    const cloudW = Math.abs(endX - state.startX);
    const cloudH = Math.abs(endY - state.startY);
    if (cloudW > 10 && cloudH > 10) {
      state.annotations.push(createAnnotation({
        type: 'cloud',
        page: state.currentPage,
        x: cloudX,
        y: cloudY,
        width: cloudW,
        height: cloudH,
        color: colorPicker.value,
        strokeColor: colorPicker.value,
        lineWidth: parseInt(lineWidth.value)
      }));
    }
  } else if (state.currentTool === 'textbox') {
    const tbX = Math.min(state.startX, endX);
    const tbY = Math.min(state.startY, endY);
    const tbW = Math.abs(endX - state.startX);
    const tbH = Math.abs(endY - state.startY);
    if (tbW > 5 && tbH > 5) {
      state.annotations.push(createAnnotation({
        type: 'textbox',
        page: state.currentPage,
        x: tbX,
        y: tbY,
        width: tbW,
        height: tbH,
        text: '',
        color: prefs.textboxStrokeColor,
        strokeColor: prefs.textboxStrokeColor,
        fillColor: prefs.textboxFillNone ? 'transparent' : prefs.textboxFillColor,
        textColor: '#000000',
        fontSize: prefs.textboxFontSize,
        fontFamily: 'Arial',
        lineWidth: prefs.textboxBorderWidth,
        borderStyle: prefs.textboxBorderStyle,
        opacity: (prefs.textboxOpacity || 100) / 100
      }));
    }
  } else if (state.currentTool === 'callout') {
    const defaultWidth = 150;
    const defaultHeight = 60;
    const coX = endX - defaultWidth / 2;
    const coY = endY - defaultHeight / 2;
    const boxCenterX = endX;
    const isArrowLeft = state.startX < boxCenterX;
    let armOriginX;
    if (isArrowLeft) {
      armOriginX = coX;
    } else {
      armOriginX = coX + defaultWidth;
    }
    const armOriginY = Math.max(coY, Math.min(coY + defaultHeight, endY));
    const armLength = Math.min(30, Math.abs(state.startX - armOriginX) * 0.4);
    const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
    const kneeY = armOriginY;
    state.annotations.push(createAnnotation({
      type: 'callout',
      page: state.currentPage,
      x: coX,
      y: coY,
      width: defaultWidth,
      height: defaultHeight,
      arrowX: state.startX,
      arrowY: state.startY,
      kneeX: kneeX,
      kneeY: kneeY,
      armOriginX: armOriginX,
      armOriginY: armOriginY,
      text: '',
      color: prefs.calloutStrokeColor,
      strokeColor: prefs.calloutStrokeColor,
      fillColor: prefs.calloutFillNone ? 'transparent' : prefs.calloutFillColor,
      textColor: '#000000',
      fontSize: prefs.calloutFontSize,
      fontFamily: 'Arial',
      lineWidth: prefs.calloutBorderWidth,
      borderStyle: prefs.calloutBorderStyle,
      opacity: (prefs.calloutOpacity || 100) / 100
    }));
  }

  state.isDrawing = false;

  // Mark document as modified if annotations were added
  if (state.annotations.length > annotationCountBefore) {
    markDocumentModified();
  }

  redrawAnnotations();
}

// Mouse event handlers for continuous mode
export function handleContinuousMouseDown(e, pageNum) {
  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  state.startX = (e.clientX - rect.left) / state.scale;
  state.startY = (e.clientY - rect.top) / state.scale;

  state.activeContinuousCanvas = canvas;
  state.activeContinuousPage = pageNum;
  state.currentPage = pageNum;

  // Handle middle mouse button panning (works regardless of current tool)
  if (e.button === 1) {
    const scrollContainer = getScrollContainer();
    state.isPanning = true;
    state.isMiddleButtonPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panScrollStartX = scrollContainer ? scrollContainer.scrollLeft : 0;
    state.panScrollStartY = scrollContainer ? scrollContainer.scrollTop : 0;
    // Set grabbing cursor on all relevant elements
    document.body.style.cursor = 'grabbing';
    pdfContainer.style.cursor = 'grabbing';
    document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = 'grabbing');
    document.addEventListener('mousemove', handlePanMove);
    document.addEventListener('mouseup', handleMiddleButtonPanEnd);
    e.preventDefault();
    return;
  }

  // Handle hand tool (panning) - use same document-level handlers as single page mode
  if (state.currentTool === 'hand') {
    const scrollContainer = getScrollContainer();
    state.isPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panScrollStartX = scrollContainer ? scrollContainer.scrollLeft : 0;
    state.panScrollStartY = scrollContainer ? scrollContainer.scrollTop : 0;
    // Set grabbing cursor on all relevant elements
    document.body.style.cursor = 'grabbing';
    pdfContainer.style.cursor = 'grabbing';
    document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = 'grabbing');
    document.addEventListener('mousemove', handlePanMove);
    document.addEventListener('mouseup', handlePanEnd);
    e.preventDefault();
    return;
  }

  if (state.currentTool === 'select') {
    const clickedAnnotation = findAnnotationAt(state.startX, state.startY);
    if (clickedAnnotation) {
      showProperties(clickedAnnotation);
    } else {
      hideProperties();
    }
    return;
  }

  state.isDrawing = true;

  if (state.currentTool === 'draw') {
    state.currentPath = [{ x: state.startX, y: state.startY }];
  } else if (state.currentTool === 'comment') {
    addComment(state.startX, state.startY);
    state.isDrawing = false;
  } else if (state.currentTool === 'text') {
    addTextAnnotation(state.startX, state.startY);
    state.isDrawing = false;
  }
}

export function handleContinuousMouseMove(e, pageNum) {
  // Hand tool panning is handled by document-level listener
  if (state.isPanning) return;

  if (!state.isDrawing) return;
  if (state.activeContinuousPage !== pageNum) return;
  if (!state.activeContinuousCanvas) return;

  const canvas = state.activeContinuousCanvas;
  const rect = canvas.getBoundingClientRect();
  const currentX = (e.clientX - rect.left) / state.scale;
  const currentY = (e.clientY - rect.top) / state.scale;
  const ctx = canvas.getContext('2d');

  if (state.currentTool === 'draw') {
    state.currentPath.push({ x: currentX, y: currentY });
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = parseInt(lineWidth.value);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(state.currentPath[state.currentPath.length - 2].x, state.currentPath[state.currentPath.length - 2].y);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();
  } else if (['highlight', 'line', 'circle', 'box'].includes(state.currentTool)) {
    renderAnnotationsForPage(ctx, pageNum, canvas.width, canvas.height);

    if (state.currentTool === 'highlight') {
      ctx.fillStyle = colorPicker.value;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(state.startX, state.startY, currentX - state.startX, currentY - state.startY);
      ctx.globalAlpha = 1;
    } else if (state.currentTool === 'line') {
      ctx.strokeStyle = colorPicker.value;
      ctx.lineWidth = parseInt(lineWidth.value);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(state.startX, state.startY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();
    } else if (state.currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(currentX - state.startX, 2) + Math.pow(currentY - state.startY, 2));
      ctx.strokeStyle = colorPicker.value;
      ctx.lineWidth = parseInt(lineWidth.value);
      ctx.beginPath();
      ctx.arc(state.startX, state.startY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (state.currentTool === 'box') {
      ctx.strokeStyle = colorPicker.value;
      ctx.lineWidth = parseInt(lineWidth.value);
      ctx.strokeRect(state.startX, state.startY, currentX - state.startX, currentY - state.startY);
    }
  }
}

export function handleContinuousMouseUp(e, pageNum) {
  // Hand tool panning is handled by document-level listener
  if (state.isPanning) return;

  if (!state.isDrawing || state.activeContinuousPage !== pageNum) return;

  const rect = state.activeContinuousCanvas.getBoundingClientRect();
  const endX = (e.clientX - rect.left) / state.scale;
  const endY = (e.clientY - rect.top) / state.scale;

  const annotationCountBefore = state.annotations.length;

  if (state.currentTool === 'draw' && state.currentPath.length > 1) {
    state.annotations.push(createAnnotation({
      type: 'draw',
      page: pageNum,
      path: state.currentPath,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
    state.currentPath = [];
  } else if (state.currentTool === 'highlight') {
    state.annotations.push(createAnnotation({
      type: 'highlight',
      page: pageNum,
      x: Math.min(state.startX, endX),
      y: Math.min(state.startY, endY),
      width: Math.abs(endX - state.startX),
      height: Math.abs(endY - state.startY),
      color: colorPicker.value,
      fillColor: colorPicker.value
    }));
  } else if (state.currentTool === 'line') {
    state.annotations.push(createAnnotation({
      type: 'line',
      page: pageNum,
      startX: state.startX,
      startY: state.startY,
      endX: endX,
      endY: endY,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  } else if (state.currentTool === 'circle') {
    const circleX = Math.min(state.startX, endX);
    const circleY = Math.min(state.startY, endY);
    const circleW = Math.abs(endX - state.startX);
    const circleH = Math.abs(endY - state.startY);
    state.annotations.push(createAnnotation({
      type: 'circle',
      page: pageNum,
      x: circleX,
      y: circleY,
      width: circleW,
      height: circleH,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      fillColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  } else if (state.currentTool === 'box') {
    const boxX = Math.min(state.startX, endX);
    const boxY = Math.min(state.startY, endY);
    const boxW = Math.abs(endX - state.startX);
    const boxH = Math.abs(endY - state.startY);
    state.annotations.push(createAnnotation({
      type: 'box',
      page: pageNum,
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      color: colorPicker.value,
      fillColor: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  }

  state.isDrawing = false;
  state.activeContinuousCanvas = null;
  state.activeContinuousPage = null;

  // Mark document as modified if annotations were added
  if (state.annotations.length > annotationCountBefore) {
    markDocumentModified();
  }

  redrawContinuous();
}
