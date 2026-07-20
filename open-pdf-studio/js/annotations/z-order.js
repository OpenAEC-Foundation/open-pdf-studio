import { getActiveDocument } from '../core/state.js';
import {
  recordAnnotationOrder,
  recordBulkModify,
  beginUndoTransaction,
  endUndoTransaction,
} from '../core/undo-manager.js';
import { cloneAnnotation } from './factory.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { showProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';

function normalizeTargets(annotationOrAnnotations, doc) {
  const requested = Array.isArray(annotationOrAnnotations)
    ? annotationOrAnnotations
    : [annotationOrAnnotations];
  const requestedSet = new Set(requested.filter(Boolean));
  return doc.annotations.filter(annotation => requestedSet.has(annotation));
}

function commitOrderChange(doc, oldOrder, targets, originals) {
  const newOrder = doc.annotations.map(annotation => annotation.id);
  if (oldOrder.every((id, index) => id === newOrder[index])) return false;
  const modifiedAt = new Date().toISOString();
  for (const annotation of targets) annotation.modifiedAt = modifiedAt;
  beginUndoTransaction();
  recordAnnotationOrder(oldOrder, newOrder);
  recordBulkModify(targets, originals);
  endUndoTransaction();
  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
  return true;
}

// Bring annotation to front (top of z-order)
export function bringToFront(annotationOrAnnotations) {
  const doc = getActiveDocument();
  if (!doc) return;
  const targets = normalizeTargets(annotationOrAnnotations, doc);
  if (targets.length === 0) return;
  const originals = targets.map(annotation => cloneAnnotation(annotation));
  const targetSet = new Set(targets);
  const oldOrder = doc.annotations.map(annotation => annotation.id);
  doc.annotations.splice(
    0,
    doc.annotations.length,
    ...doc.annotations.filter(annotation => !targetSet.has(annotation)),
    ...targets,
  );
  commitOrderChange(doc, oldOrder, targets, originals);
}

// Send annotation to back (bottom of z-order)
export function sendToBack(annotationOrAnnotations) {
  const doc = getActiveDocument();
  if (!doc) return;
  const targets = normalizeTargets(annotationOrAnnotations, doc);
  if (targets.length === 0) return;
  const originals = targets.map(annotation => cloneAnnotation(annotation));
  const targetSet = new Set(targets);
  const oldOrder = doc.annotations.map(annotation => annotation.id);
  doc.annotations.splice(
    0,
    doc.annotations.length,
    ...targets,
    ...doc.annotations.filter(annotation => !targetSet.has(annotation)),
  );
  commitOrderChange(doc, oldOrder, targets, originals);
}

// Move annotation forward (one step up in z-order)
export function bringForward(annotationOrAnnotations) {
  const doc = getActiveDocument();
  if (!doc) return;
  const targets = normalizeTargets(annotationOrAnnotations, doc);
  if (targets.length === 0) return;
  const originals = targets.map(annotation => cloneAnnotation(annotation));
  const targetSet = new Set(targets);
  const oldOrder = doc.annotations.map(annotation => annotation.id);
  for (let index = doc.annotations.length - 2; index >= 0; index--) {
    if (targetSet.has(doc.annotations[index]) && !targetSet.has(doc.annotations[index + 1])) {
      [doc.annotations[index], doc.annotations[index + 1]] =
        [doc.annotations[index + 1], doc.annotations[index]];
    }
  }
  commitOrderChange(doc, oldOrder, targets, originals);
}

// Move annotation backward (one step down in z-order)
export function sendBackward(annotationOrAnnotations) {
  const doc = getActiveDocument();
  if (!doc) return;
  const targets = normalizeTargets(annotationOrAnnotations, doc);
  if (targets.length === 0) return;
  const originals = targets.map(annotation => cloneAnnotation(annotation));
  const targetSet = new Set(targets);
  const oldOrder = doc.annotations.map(annotation => annotation.id);
  for (let index = 1; index < doc.annotations.length; index++) {
    if (targetSet.has(doc.annotations[index]) && !targetSet.has(doc.annotations[index - 1])) {
      [doc.annotations[index], doc.annotations[index - 1]] =
        [doc.annotations[index - 1], doc.annotations[index]];
    }
  }
  commitOrderChange(doc, oldOrder, targets, originals);
}

// Rotate a point around a center by degrees
function rotatePoint(px, py, cx, cy, deg) {
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

// Get center of polyline points
function polylineCenter(points) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// Update polyline bounding box from points
function updatePolylineBounds(annotation) {
  const xs = annotation.points.map(p => p.x);
  const ys = annotation.points.map(p => p.y);
  annotation.x = Math.min(...xs);
  annotation.y = Math.min(...ys);
  annotation.width = Math.max(...xs) - annotation.x;
  annotation.height = Math.max(...ys) - annotation.y;
}

// Rotate annotation by degrees
export function rotateAnnotation(annotation, degrees) {
  if (!annotation) return;
  if (annotation.locked) return;

  if (annotation.type === 'line' || annotation.type === 'arrow') {
    const cx = (annotation.startX + annotation.endX) / 2;
    const cy = (annotation.startY + annotation.endY) / 2;
    const s = rotatePoint(annotation.startX, annotation.startY, cx, cy, degrees);
    const e = rotatePoint(annotation.endX, annotation.endY, cx, cy, degrees);
    annotation.startX = s.x;
    annotation.startY = s.y;
    annotation.endX = e.x;
    annotation.endY = e.y;
  } else if (annotation.type === 'polyline' && annotation.points && annotation.points.length >= 2) {
    const { cx, cy } = polylineCenter(annotation.points);
    annotation.points = annotation.points.map(p => rotatePoint(p.x, p.y, cx, cy, degrees));
    updatePolylineBounds(annotation);
  } else {
    annotation.rotation = ((annotation.rotation || 0) + degrees) % 360;
  }
  annotation.modifiedAt = new Date().toISOString();
  redrawAndRefresh();
}

// Flip annotation horizontally
export function flipHorizontal(annotation) {
  if (!annotation) return;
  if (annotation.locked) return;

  if (annotation.type === 'line' || annotation.type === 'arrow') {
    const cx = (annotation.startX + annotation.endX) / 2;
    annotation.startX = 2 * cx - annotation.startX;
    annotation.endX = 2 * cx - annotation.endX;
  } else if (annotation.type === 'polyline' && annotation.points && annotation.points.length >= 2) {
    const { cx } = polylineCenter(annotation.points);
    annotation.points = annotation.points.map(p => ({ x: 2 * cx - p.x, y: p.y }));
    updatePolylineBounds(annotation);
  } else {
    annotation.flipX = !annotation.flipX;
  }
  annotation.modifiedAt = new Date().toISOString();
  redrawAndRefresh();
}

// Flip annotation vertically
export function flipVertical(annotation) {
  if (!annotation) return;
  if (annotation.locked) return;

  if (annotation.type === 'line' || annotation.type === 'arrow') {
    const cy = (annotation.startY + annotation.endY) / 2;
    annotation.startY = 2 * cy - annotation.startY;
    annotation.endY = 2 * cy - annotation.endY;
  } else if (annotation.type === 'polyline' && annotation.points && annotation.points.length >= 2) {
    const { cy } = polylineCenter(annotation.points);
    annotation.points = annotation.points.map(p => ({ x: p.x, y: 2 * cy - p.y }));
    updatePolylineBounds(annotation);
  } else {
    annotation.flipY = !annotation.flipY;
  }
  annotation.modifiedAt = new Date().toISOString();
  redrawAndRefresh();
}

// Redraw canvas and refresh properties panel
function redrawAndRefresh() {
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
  const _zDoc = getActiveDocument();
  const _zSel = _zDoc ? _zDoc.selectedAnnotations : [];
  if (_zSel.length === 1) {
    showProperties(_zSel[0]);
  } else if (_zSel.length > 1) {
    showMultiSelectionProperties();
  }
}
