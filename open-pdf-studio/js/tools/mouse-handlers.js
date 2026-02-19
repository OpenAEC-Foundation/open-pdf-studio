import { state, addToSelection, removeFromSelection, isSelected, clearSelection, getAnnotationBounds, getSelectionBounds } from '../core/state.js';
import { annotationCanvas, annotationCtx, pdfContainer } from '../ui/dom-elements.js';
import { getColorPickerValue, getLineWidthValue } from '../solid/stores/ribbonStore.js';
import { createAnnotation, cloneAnnotation } from '../annotations/factory.js';
import { findAnnotationAt } from '../annotations/geometry.js';
import { findHandleAt, getCursorForHandle } from '../annotations/handles.js';
import { applyResize, applyMove, applyRotation } from '../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous, renderAnnotationsForPage, snapToGrid } from '../annotations/rendering.js';
import { showProperties, hideProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';
import { startTextEditing, addTextAnnotation, addComment } from './text-editing.js';
import { findTextEditAtPosition, startTextEditEditing } from './text-edit-tool.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { recordAdd, recordModify, recordBulkModify } from '../core/undo-manager.js';
import { showStampPicker } from '../annotations/stamps.js';
import { showSignatureDialog } from '../annotations/signature.js';
import { startPan, startContinuousPan, handlePanMove, handleMiddleButtonPanEnd } from './pan-handler.js';
import { drawShapePreview } from './shape-preview.js';
import { createAnnotationFromTool, createContinuousAnnotation } from './annotation-creators.js';
import { isPdfAReadOnly } from '../pdf/loader.js';

// Check if any modal dialog/overlay is blocking interaction
function isModalDialogOpen() {
  // State flag is set synchronously during blur (before mousedown fires)
  if (state.modalDialogOpen) return true;
  // DOM check as fallback for all overlays
  return !!document.querySelector(
    '.form-validation-overlay, ' +
    '.about-overlay.visible, ' +
    '.doc-props-overlay.visible, ' +
    '.preferences-overlay.visible, ' +
    '.text-annot-overlay.visible, ' +
    '.loading-overlay.visible, ' +
    '.backstage-overlay.visible, ' +
    '.sig-overlay.visible'
  );
}

// Mouse down handler for single page mode
export function handleMouseDown(e) {
  if (!state.pdfDoc) return;
  if (isModalDialogOpen()) return;

  const rect = annotationCanvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  const x = (e.clientX - rect.left) / state.scale;
  const y = (e.clientY - rect.top) / state.scale;

  state.startX = snapToGrid(x);
  state.startY = snapToGrid(y);
  state.dragStartX = x;
  state.dragStartY = y;

  // Handle middle mouse button panning (works regardless of current tool)
  if (e.button === 1) {
    startPan(e, true);
    return;
  }

  // Handle hand tool (panning)
  if (state.currentTool === 'hand') {
    startPan(e, false);
    return;
  }

  // Block annotation tools when PDF/A read-only is active
  if (isPdfAReadOnly() && state.currentTool !== 'select' && state.currentTool !== 'selectComments') {
    return;
  }

  // Edit text tool: first check for textEdit records at click position
  if (state.currentTool === 'editText') {
    const canvas = annotationCanvas;
    const hitEdit = findTextEditAtPosition(x, y, state.currentPage, canvas);
    if (hitEdit) {
      startTextEditEditing(hitEdit, state.currentPage, canvas);
    }
    return;
  }

  // Handle select tool
  if (state.currentTool === 'select' || state.currentTool === 'selectComments') {
    const pdfaLocked = isPdfAReadOnly();

    // First check if clicking on a handle of the selected annotation (only for single selection)
    if (!pdfaLocked && state.selectedAnnotation && state.selectedAnnotations.length === 1) {
      const handleType = findHandleAt(x, y, state.selectedAnnotation, state.scale);
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.originalAnnotation = cloneAnnotation(state.selectedAnnotation);
        annotationCanvas.style.cursor = getCursorForHandle(handleType, state.selectedAnnotation.rotation);
        return;
      }
    }

    // Check if clicking on an annotation
    const clickedAnnotation = findAnnotationAt(x, y);
    if (clickedAnnotation) {
      // Double-click to edit text for textbox/callout
      if (!pdfaLocked && e.detail === 2 && ['textbox', 'callout'].includes(clickedAnnotation.type)) {
        startTextEditing(clickedAnnotation);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (!pdfaLocked && isSelected(clickedAnnotation)) {
          // Ctrl+drag on selected annotation: start copy-drag
          state.isDragging = true;
          state._ctrlDragCopy = true;
          state._ctrlCopiesCreated = false;
          if (state.selectedAnnotations.length > 1) {
            state.originalAnnotations = state.selectedAnnotations.map(a => cloneAnnotation(a));
          } else {
            state.originalAnnotation = cloneAnnotation(clickedAnnotation);
            state.originalAnnotations = [cloneAnnotation(clickedAnnotation)];
          }
        } else {
          // Ctrl+click on unselected: add to multi-selection
          addToSelection(clickedAnnotation);
          if (state.selectedAnnotations.length === 1) {
            showProperties(state.selectedAnnotations[0]);
          } else if (state.selectedAnnotations.length > 1) {
            showMultiSelectionProperties();
          }
          redrawAnnotations();
        }
      } else {
        // Normal click - select and show properties, but don't allow drag in PDF/A mode
        if (isSelected(clickedAnnotation) && state.selectedAnnotations.length > 1) {
          if (!pdfaLocked) {
            state.isDragging = true;
            state.originalAnnotations = state.selectedAnnotations.map(a => cloneAnnotation(a));
            annotationCanvas.style.cursor = 'move';
          }
        } else {
          // Single select
          state.selectedAnnotations = [clickedAnnotation];
          showProperties(clickedAnnotation);
          if (!pdfaLocked) {
            state.isDragging = true;
            state.originalAnnotation = cloneAnnotation(clickedAnnotation);
            state.originalAnnotations = [cloneAnnotation(clickedAnnotation)];
            annotationCanvas.style.cursor = 'move';
          }
        }
      }
    } else {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click on empty space: keep selection, do nothing
      } else {
        // Start rubber band selection
        state.isRubberBanding = true;
        state.rubberBandStartX = x;
        state.rubberBandStartY = y;
        clearSelection();
        hideProperties();
        redrawAnnotations();
      }
    }
    return;
  }

  // Handle polyline tool specially (click to add points, double-click to finish)
  if (state.currentTool === 'polyline') {
    const polyPrefs = state.preferences;
    if (e.detail === 2) {
      // Double-click to finish polyline
      if (state.polylinePoints.length >= 2) {
        const ann = createAnnotation({
          type: 'polyline',
          page: state.currentPage,
          points: [...state.polylinePoints],
          color: polyPrefs.polylineStrokeColor,
          strokeColor: polyPrefs.polylineStrokeColor,
          lineWidth: polyPrefs.polylineLineWidth,
          opacity: (polyPrefs.polylineOpacity || 100) / 100
        });
        state.annotations.push(ann);
        recordAdd(ann);
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

    // Draw in-progress polyline so it remains visible after click
    if (state.polylinePoints.length > 0) {
      const ctx = annotationCtx || annotationCanvas.getContext('2d');
      ctx.save();
      ctx.scale(state.scale, state.scale);
      ctx.strokeStyle = polyPrefs.polylineStrokeColor;
      ctx.lineWidth = polyPrefs.polylineLineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      state.polylinePoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      state.polylinePoints.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = polyPrefs.polylineStrokeColor;
        ctx.fill();
      });
      ctx.restore();
    }
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
  } else if (state.currentTool === 'stamp') {
    showStampPicker(x, y);
    state.isDrawing = false;
  } else if (state.currentTool === 'signature') {
    showSignatureDialog(x, y);
    state.isDrawing = false;
  } else if (state.currentTool === 'measureArea' || state.currentTool === 'measurePerimeter') {
    // Multi-click to add points; use polyline-like behavior
    if (!state.measurePoints) state.measurePoints = [];
    state.measurePoints.push({ x, y });
    state.isDrawing = false;
    redrawAnnotations();
  }
}

// Mouse move handler for single page mode
export function handleMouseMove(e) {
  if (!state.pdfDoc || !annotationCanvas) return;
  if (isModalDialogOpen()) return;

  // Skip if panning (handled by document-level listener)
  if (state.isPanning) return;

  const rect = annotationCanvas.getBoundingClientRect();
  const currentX = (e.clientX - rect.left) / state.scale;
  const currentY = (e.clientY - rect.top) / state.scale;

  // Rubber band selection drawing
  if (state.isRubberBanding && (state.currentTool === 'select' || state.currentTool === 'selectComments')) {
    redrawAnnotations();
    // Draw rubber band rectangle
    annotationCtx.save();
    annotationCtx.scale(state.scale, state.scale);
    annotationCtx.strokeStyle = '#0066cc';
    annotationCtx.lineWidth = 1 / state.scale;
    annotationCtx.setLineDash([4 / state.scale, 4 / state.scale]);
    annotationCtx.fillStyle = 'rgba(0, 102, 204, 0.1)';
    const rbX = Math.min(state.rubberBandStartX, currentX);
    const rbY = Math.min(state.rubberBandStartY, currentY);
    const rbW = Math.abs(currentX - state.rubberBandStartX);
    const rbH = Math.abs(currentY - state.rubberBandStartY);
    annotationCtx.fillRect(rbX, rbY, rbW, rbH);
    annotationCtx.strokeRect(rbX, rbY, rbW, rbH);
    annotationCtx.setLineDash([]);
    annotationCtx.restore();
    return;
  }

  // Update cursor when hovering over handles
  if ((state.currentTool === 'select' || state.currentTool === 'selectComments') && state.selectedAnnotation && !state.isDragging && !state.isResizing) {
    // Only show resize handles cursor for single selection
    if (state.selectedAnnotations.length === 1) {
      const handleType = findHandleAt(currentX, currentY, state.selectedAnnotation, state.scale);
      if (handleType) {
        annotationCanvas.style.cursor = getCursorForHandle(handleType, state.selectedAnnotation.rotation);
        return;
      }
    }
    annotationCanvas.style.cursor = 'default';
    return;
  }

  // Handle resizing or rotation
  if (state.isResizing && state.selectedAnnotation && state.activeHandle) {
    // Handle rotation separately
    if (state.activeHandle === 'rotate') {
      Object.assign(state.selectedAnnotation, cloneAnnotation(state.originalAnnotation));
      state.shiftKeyPressed = e.shiftKey;
      applyRotation(state.selectedAnnotation, currentX, currentY, state.originalAnnotation);
      redrawAnnotations(true);
      return;
    }

    const deltaX = currentX - state.dragStartX;
    const deltaY = currentY - state.dragStartY;

    // Restore original and apply resize
    Object.assign(state.selectedAnnotation, cloneAnnotation(state.originalAnnotation));
    applyResize(state.selectedAnnotation, state.activeHandle, deltaX, deltaY, state.originalAnnotation, e.shiftKey);

    redrawAnnotations(true);
    return;
  }

  // Handle dragging (moving) - supports multi-selection and Ctrl+drag copy
  if (state.isDragging && state.selectedAnnotations.length > 0) {
    const deltaX = currentX - state.dragStartX;
    const deltaY = currentY - state.dragStartY;

    // Ctrl+drag copy: create clones on first meaningful move
    if (state._ctrlDragCopy && !state._ctrlCopiesCreated && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
      state._ctrlCopiesCreated = true;
      const newId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
      if (state.selectedAnnotations.length > 1) {
        // Restore originals to their positions
        for (let i = 0; i < state.selectedAnnotations.length; i++) {
          if (state.originalAnnotations[i]) {
            Object.assign(state.selectedAnnotations[i], cloneAnnotation(state.originalAnnotations[i]));
          }
        }
        // Create copies and switch selection to them
        const copies = state.originalAnnotations.map(orig => {
          const copy = cloneAnnotation(orig);
          copy.id = newId();
          state.annotations.push(copy);
          return copy;
        });
        state.selectedAnnotations = copies;
        state.originalAnnotations = copies.map(c => cloneAnnotation(c));
      } else {
        // Restore original
        Object.assign(state.selectedAnnotation, cloneAnnotation(state.originalAnnotation));
        // Create copy and switch selection to it
        const copy = cloneAnnotation(state.originalAnnotation);
        copy.id = newId();
        state.annotations.push(copy);
        state.selectedAnnotations = [copy];
        state.selectedAnnotation = copy;
        state.originalAnnotation = cloneAnnotation(copy);
        state.originalAnnotations = [cloneAnnotation(copy)];
        showProperties(copy);
      }
    }

    if (state.selectedAnnotations.length > 1 && state.originalAnnotations.length > 0) {
      // Multi-selection drag
      for (let i = 0; i < state.selectedAnnotations.length; i++) {
        if (state.originalAnnotations[i]) {
          Object.assign(state.selectedAnnotations[i], cloneAnnotation(state.originalAnnotations[i]));
          applyMove(state.selectedAnnotations[i], deltaX, deltaY);
        }
      }
    } else if (state.selectedAnnotation && state.originalAnnotation) {
      // Single selection drag
      Object.assign(state.selectedAnnotation, cloneAnnotation(state.originalAnnotation));
      applyMove(state.selectedAnnotation, deltaX, deltaY);
    }

    redrawAnnotations(true);
    return;
  }

  // Handle polyline preview
  if (state.currentTool === 'polyline' && state.isDrawingPolyline && state.polylinePoints.length > 0) {
    const polyPrefs = state.preferences;
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(state.scale, state.scale);
    annotationCtx.strokeStyle = polyPrefs.polylineStrokeColor;
    annotationCtx.lineWidth = polyPrefs.polylineLineWidth;
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
      annotationCtx.fillStyle = polyPrefs.polylineStrokeColor;
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
    annotationCtx.strokeStyle = getColorPickerValue();
    annotationCtx.lineWidth = getLineWidthValue();
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

// Mouse up handler for single page mode
export function handleMouseUp(e) {
  if (isModalDialogOpen()) return;
  // Hand tool panning is handled by document-level listener (handlePanEnd)
  if (state.isPanning) return;

  // Handle rubber band selection end
  if (state.isRubberBanding) {
    state.isRubberBanding = false;
    const rect = annotationCanvas.getBoundingClientRect();
    const endX = (e.clientX - rect.left) / state.scale;
    const endY = (e.clientY - rect.top) / state.scale;

    const rbX = Math.min(state.rubberBandStartX, endX);
    const rbY = Math.min(state.rubberBandStartY, endY);
    const rbW = Math.abs(endX - state.rubberBandStartX);
    const rbH = Math.abs(endY - state.rubberBandStartY);

    // Only select if rubber band has meaningful size
    if (rbW > 3 || rbH > 3) {
      const selected = [];
      for (const ann of state.annotations) {
        if (ann.page !== state.currentPage) continue;
        const bounds = getAnnotationBounds(ann);
        if (!bounds) continue;
        // Check if annotation intersects with rubber band
        if (bounds.x < rbX + rbW && bounds.x + bounds.width > rbX &&
            bounds.y < rbY + rbH && bounds.y + bounds.height > rbY) {
          selected.push(ann);
        }
      }
      if (selected.length > 0) {
        state.selectedAnnotations = selected;
        if (selected.length === 1) {
          showProperties(selected[0]);
        } else {
          showMultiSelectionProperties();
        }
      }
    }
    redrawAnnotations();
    return;
  }

  // Handle end of dragging/resizing
  if (state.isDragging || state.isResizing) {
    if (state._ctrlDragCopy && state._ctrlCopiesCreated) {
      // Ctrl+drag copy: record copies as additions
      for (const ann of state.selectedAnnotations) {
        recordAdd(ann);
      }
      markDocumentModified();
    } else {
      // Record undo for the modification
      if (state.selectedAnnotations.length > 1 && state.originalAnnotations.length > 0) {
        recordBulkModify(state.selectedAnnotations, state.originalAnnotations);
      } else if (state.originalAnnotation && state.selectedAnnotation) {
        recordModify(state.selectedAnnotation.id, state.originalAnnotation, state.selectedAnnotation);
      }
    }

    state.isDragging = false;
    state.isResizing = false;
    state.activeHandle = null;
    state.originalAnnotation = null;
    state.originalAnnotations = [];
    state._ctrlDragCopy = false;
    state._ctrlCopiesCreated = false;
    annotationCanvas.style.cursor = 'default';

    // Update properties panel with new values
    if (state.selectedAnnotations.length === 1 && state.selectedAnnotation) {
      showProperties(state.selectedAnnotation);
    } else if (state.selectedAnnotations.length > 1) {
      showMultiSelectionProperties();
    }
    return;
  }

  if (!state.isDrawing) return;

  const rect = annotationCanvas.getBoundingClientRect();
  const endX = snapToGrid((e.clientX - rect.left) / state.scale);
  const endY = snapToGrid((e.clientY - rect.top) / state.scale);

  const annotationCountBefore = state.annotations.length;

  // Create annotation based on tool
  const ann = createAnnotationFromTool(state.currentTool, state.startX, state.startY, endX, endY, e);
  if (ann) {
    state.annotations.push(ann);
  }

  state.isDrawing = false;

  // Record add for undo and mark document as modified
  if (state.annotations.length > annotationCountBefore) {
    recordAdd(state.annotations[state.annotations.length - 1]);
  }

  redrawAnnotations();
}

// Mouse event handlers for continuous mode
export function handleContinuousMouseDown(e, pageNum) {
  if (isModalDialogOpen()) return;
  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  state.startX = (e.clientX - rect.left) / state.scale;
  state.startY = (e.clientY - rect.top) / state.scale;

  state.activeContinuousCanvas = canvas;
  state.activeContinuousPage = pageNum;
  state.currentPage = pageNum;

  // Handle middle mouse button panning (works regardless of current tool)
  if (e.button === 1) {
    startContinuousPan(e, true);
    return;
  }

  // Handle hand tool (panning) - use same document-level handlers as single page mode
  if (state.currentTool === 'hand') {
    startContinuousPan(e, false);
    return;
  }

  if (state.currentTool === 'select' || state.currentTool === 'selectComments') {
    const clickedAnnotation = findAnnotationAt(state.startX, state.startY);
    if (clickedAnnotation) {
      showProperties(clickedAnnotation);
    } else {
      hideProperties();
    }
    return;
  }

  // Edit text tool: first check for textEdit records at click position
  if (state.currentTool === 'editText') {
    const hitEdit = findTextEditAtPosition(state.startX, state.startY, pageNum, canvas);
    if (hitEdit) {
      startTextEditEditing(hitEdit, pageNum, canvas);
    }
    return;
  }

  // Block annotation tools when PDF/A read-only is active
  if (isPdfAReadOnly()) return;

  state.isDrawing = true;

  if (state.currentTool === 'draw') {
    state.currentPath = [{ x: state.startX, y: state.startY }];
  } else if (state.currentTool === 'comment') {
    addComment(state.startX, state.startY);
    state.isDrawing = false;
  } else if (state.currentTool === 'text') {
    addTextAnnotation(state.startX, state.startY, pageNum, canvas);
    state.isDrawing = false;
  }
}

export function handleContinuousMouseMove(e, pageNum) {
  if (isModalDialogOpen()) return;
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
    ctx.strokeStyle = getColorPickerValue();
    ctx.lineWidth = getLineWidthValue();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(state.currentPath[state.currentPath.length - 2].x, state.currentPath[state.currentPath.length - 2].y);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();
  } else if (['highlight', 'line', 'circle', 'box'].includes(state.currentTool)) {
    renderAnnotationsForPage(ctx, pageNum, canvas.width, canvas.height);

    if (state.currentTool === 'highlight') {
      ctx.fillStyle = getColorPickerValue();
      ctx.globalAlpha = 0.3;
      ctx.fillRect(state.startX, state.startY, currentX - state.startX, currentY - state.startY);
      ctx.globalAlpha = 1;
    } else if (state.currentTool === 'line') {
      ctx.strokeStyle = getColorPickerValue();
      ctx.lineWidth = getLineWidthValue();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(state.startX, state.startY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();
    } else if (state.currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(currentX - state.startX, 2) + Math.pow(currentY - state.startY, 2));
      ctx.strokeStyle = getColorPickerValue();
      ctx.lineWidth = getLineWidthValue();
      ctx.beginPath();
      ctx.arc(state.startX, state.startY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (state.currentTool === 'box') {
      ctx.strokeStyle = getColorPickerValue();
      ctx.lineWidth = getLineWidthValue();
      ctx.strokeRect(state.startX, state.startY, currentX - state.startX, currentY - state.startY);
    }
  }
}

export function handleContinuousMouseUp(e, pageNum) {
  if (isModalDialogOpen()) return;
  // Hand tool panning is handled by document-level listener
  if (state.isPanning) return;

  if (!state.isDrawing || state.activeContinuousPage !== pageNum) return;

  const rect = state.activeContinuousCanvas.getBoundingClientRect();
  const endX = (e.clientX - rect.left) / state.scale;
  const endY = (e.clientY - rect.top) / state.scale;

  const annotationCountBefore = state.annotations.length;

  const ann = createContinuousAnnotation(state.currentTool, pageNum, state.startX, state.startY, endX, endY);
  if (ann) {
    state.annotations.push(ann);
  }

  state.isDrawing = false;
  state.activeContinuousCanvas = null;
  state.activeContinuousPage = null;

  // Record add for undo and mark document as modified
  if (state.annotations.length > annotationCountBefore) {
    recordAdd(state.annotations[state.annotations.length - 1]);
  }

  redrawContinuous();
}
