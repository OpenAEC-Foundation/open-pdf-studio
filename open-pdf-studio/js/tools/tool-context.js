import { state, getActiveDocument, clearSelection, addToSelection, removeFromSelection, isSelected, getAnnotationBounds, getSelectionBounds } from '../core/state.js';
import { annotationCanvas, annotationCtx } from '../ui/dom-elements.js';
import { createAnnotation, cloneAnnotation } from '../annotations/factory.js';
import { findAnnotationAt } from '../annotations/geometry.js';
import { findHandleAt, getCursorForHandle } from '../annotations/handles.js';
import { applyResize, applyMove, applyRotation } from '../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous, renderAnnotationsForPage, snapToGrid } from '../annotations/rendering.js';
import { showProperties, hideProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';
import { startTextEditing, finishTextEditing, addTextAnnotation, addComment } from './text-editing.js';
import { openStickyPopup } from '../bridge.js';
import { findTextEditAtPosition, startTextEditEditing } from './text-edit-tool.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { recordAdd, recordModify, recordBulkModify } from '../core/undo-manager.js';
import { showStampPicker, placeOverrideStamp } from '../annotations/stamps.js';
import { showSignatureDialog } from '../annotations/signature.js';
import { startPan, startContinuousPan } from './pan-handler.js';
import { snapAngle } from '../utils/helpers.js';
import { drawShapePreview } from './shape-preview.js';
import { createAnnotationFromTool, createContinuousAnnotation, buildAnnotationProps, createMeasureAreaAnnotation, createMeasurePerimeterAnnotation } from './annotation-creators.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement, snapDistanceTo10 } from '../annotations/measurement.js';
import { performSnap, drawSnapIndicator, setPolarAnchor, clearPolarAnchor } from './snap-engine.js';
import { buildCloudPolylinePath } from '../annotations/rendering/shapes.js';
import { drawDimension, drawMeasureAreaShape, drawCentroidLabel, drawMeasurePerimeterShape } from '../annotations/rendering/measurements.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { getColorPickerValue, getLineWidthValue } from '../bridge.js';

/**
 * Check if any modal dialog/overlay is blocking interaction
 */
export function isModalOpen() {
  if (state.modalDialogOpen) return true;
  return !!document.querySelector(
    '.form-validation-overlay, ' +
    '.about-overlay.visible, ' +
    '.doc-props-overlay.visible, ' +
    '.preferences-overlay.visible, ' +
    '.text-annot-overlay.visible, ' +
    '.loading-overlay.visible, ' +
    '.app-menu-overlay.visible, ' +
    '.sig-overlay.visible'
  );
}

/**
 * Resolve pointer coordinates from a PointerEvent into unified canvas-space coords.
 * Works for both single-page and continuous modes.
 */
export function resolvePointerCoords(e) {
  const doc = getActiveDocument();
  const docCurrentPage = doc ? doc.currentPage : 1;
  const scale = doc?.scale || 1.5;
  if (doc?.viewMode === 'continuous') {
    // Events komen via de paginacontainer binnen (zie
    // setupContinuousPageEvents) en kunnen dus ook op het pdf-canvas of de
    // container zelf landen; het annotatiecanvas van de pagina blijft de
    // tekencontext van het gereedschap.
    const ccEl = e.target.closest ? e.target.closest('.canvas-container-cont') : null;
    const canvas = (ccEl && ccEl.querySelector('.annotation-canvas'))
      || (e.target.closest ? e.target.closest('.annotation-canvas') : null)
      || e.target;
    if (!canvas || !canvas.getBoundingClientRect) {
      return { x: 0, y: 0, pageNum: docCurrentPage, canvas: null, canvasCtx: null };
    }
    const pageNum = parseInt(canvas?.dataset?.page ?? ccEl?.dataset?.page, 10);
    // Het annotatiecanvas is een viewport-uitsnede van de pagina; de
    // PAGINA-oorsprong is de canvas-container eromheen.
    const paginaEl = ccEl || (canvas.closest && canvas.closest('.canvas-container-cont')) || canvas;
    const rect = paginaEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
      pageNum: isNaN(pageNum) ? docCurrentPage : pageNum,
      canvas,
      canvasCtx: canvas.getContext ? canvas.getContext('2d') : null
    };
  } else {
    const canvas = annotationCanvas;
    if (!canvas) {
      return { x: 0, y: 0, pageNum: docCurrentPage, canvas: null, canvasCtx: null };
    }
    const ctx = annotationCtx || canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    // Vector viewport mode: use viewport transform for coordinate conversion.
    // Same guard as renderer.js zoomIn/Out: only honour the viewport if THIS
    // doc actually uses it. Blank in-memory docs (filePath===null) are drawn
    // via the PDF.js fallback path in renderer.js — they read coords from
    // doc.scale + the annotation-canvas rect. If we'd let the viewport's
    // stale zoom/offset (from a previously-open real PDF) drive the coord
    // math here, every click on a blank-doc tab would land far off the page
    // → user sees "tool draws nothing" while the annotation actually exists
    // somewhere outside the canvas area.
    const vp = window.__pdfViewport;
    if (vp && vp.active && doc?.filePath) {
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      // Annotations use app-space: (0,0) = page top-left, Y-down, scale=1
      // Page top-left on screen = (offsetX, offsetY)
      // So app coords = (screen - offset) / zoom — NO Y-flip needed
      const appX = (screenX - vp.offsetX) / vp.zoom;
      const appY = (screenY - vp.offsetY) / vp.zoom;
      return {
        x: appX,
        y: appY,
        pageNum: docCurrentPage,
        canvas,
        canvasCtx: ctx
      };
    }

    // Legacy PDF.js mode
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
      pageNum: docCurrentPage,
      canvas,
      canvasCtx: ctx
    };
  }
}

/**
 * Apply the correct canvas transform for drawing tool previews/interactions.
 * In vector viewport mode: uses viewport zoom + offset (no DPR).
 * In legacy mode: uses doc.scale (with DPR handled elsewhere).
 * Call ctx.save() before and ctx.restore() after.
 */
export function applyToolTransform(ctx) {
  const doc = getActiveDocument();
  const vp = window.__pdfViewport;
  // Same blank-doc guard as resolvePointerCoords — blank in-memory docs
  // bypass the viewport singleton and use doc.scale via the PDF.js path.
  if (vp && vp.active && doc?.filePath) {
    ctx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.offsetX, vp.offsetY);
  } else {
    const scale = doc?.scale || 1.5;
    const canvas = ctx.canvas;
    const backing = canvas?.dataset ? parseFloat(canvas.dataset.backingScale) : NaN;
    const dpr = Number.isFinite(backing) ? backing : (window.devicePixelRatio || 1);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    // Doorlopende weergave: het annotatiecanvas is een viewport-uitsnede van
    // de pagina; (clipX,clipY) is de positie van die uitsnede in CSS-px.
    const clipX = canvas?.dataset ? parseFloat(canvas.dataset.clipX) || 0 : 0;
    const clipY = canvas?.dataset ? parseFloat(canvas.dataset.clipY) || 0 : 0;
    if (clipX || clipY) ctx.translate(-clipX / scale, -clipY / scale);
  }
}

/**
 * Get the effective scale for the current rendering mode.
 * Vector mode: viewport zoom. Legacy mode: doc.scale.
 */
export function getEffectiveScale() {
  const doc = getActiveDocument();
  const vp = window.__pdfViewport;
  // Same blank-doc guard as resolvePointerCoords.
  if (vp && vp.active && doc?.filePath) return vp.zoom;
  return doc?.scale || 1.5;
}

/**
 * Build a tool context object from event + resolved coordinates.
 * This gives each tool a clean API to work with.
 */
export function buildToolContext(e, coords) {
  const ctxDoc = getActiveDocument();
  const vp = window.__pdfViewport;
  const ctxScale = (vp && vp.active) ? vp.zoom : (ctxDoc?.scale || 1.5);
  return {
    // Coordinates
    x: coords.x,
    y: coords.y,
    pageNum: coords.pageNum,
    canvas: coords.canvas,
    canvasCtx: coords.canvasCtx,
    event: e,

    // State access
    state,
    prefs: state.preferences,
    scale: ctxScale,
    viewMode: ctxDoc?.viewMode || 'single',

    // Snapping
    snap: (x, y, excludeId, extraPoints) => performSnap(x, y, ctxDoc?.annotations || [], coords.pageNum, ctxScale, excludeId, extraPoints),
    snapToGrid,
    snapAngle,
    setPolarAnchor,
    clearPolarAnchor,
    snapDistanceTo10,
    drawSnapIndicator: (snapResult) => {
      if (!coords.canvasCtx) return;
      coords.canvasCtx.save();
      applyToolTransform(coords.canvasCtx);
      drawSnapIndicator(coords.canvasCtx, snapResult, ctxScale);
      coords.canvasCtx.restore();
    },

    // Annotation operations
    findAnnotationAt,
    findHandleAt: (x, y, ann) => findHandleAt(x, y, ann, ctxScale),
    getCursorForHandle: (handle, rotation, ann) => getCursorForHandle(handle, rotation, ann),
    createAnnotation,
    cloneAnnotation,
    applyResize,
    applyMove,
    applyRotation,
    getAnnotationBounds,
    getSelectionBounds,
    buildAnnotationProps,
    createAnnotationFromTool,
    createContinuousAnnotation,
    createMeasureAreaAnnotation,
    createMeasurePerimeterAnnotation,
    buildCloudPolylinePath,
    drawDimension,
    drawMeasureAreaShape,
    drawMeasurePerimeterShape,
    drawCentroidLabel,
    calculateDistance,
    calculateArea,
    calculatePerimeter,
    formatMeasurement,

    // Selection
    clearSelection,
    addToSelection,
    removeFromSelection,
    isSelected,

    // Properties panel
    showProperties,
    hideProperties,
    showMultiSelectionProperties,

    // Text editing
    startTextEditing,
    finishTextEditing,
    addTextAnnotation,
    addComment,
    openStickyPopup,
    findTextEditAtPosition,
    startTextEditEditing,

    // Stamps and signatures
    showStampPicker,
    placeOverrideStamp,
    showSignatureDialog,

    // Pan
    startPan,
    startContinuousPan,

    // Drawing
    drawShapePreview,
    getAnnotationType,
    getColorPickerValue,
    getLineWidthValue,

    // Undo
    recordAdd,
    recordModify,
    recordBulkModify,
    markDocumentModified,

    // Rendering
    redraw: () => {
      if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
      else redrawAnnotations();
    },
    redrawAnnotations,
    redrawContinuous,
    renderAnnotationsForPage,

    // PDF/A
    isPdfAReadOnly,
  };
}
