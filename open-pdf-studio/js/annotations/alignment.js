import { state, getAnnotationBounds } from '../core/state.js';
import { recordBulkModify } from '../core/undo-manager.js';
import { cloneAnnotation } from './factory.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';

function redraw() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Get selected annotations (multi-selection or single)
function getSelected() {
  if (state.selectedAnnotations.length >= 2) return state.selectedAnnotations;
  return [];
}

// Snapshot annotations before modification (for single undo step)
function snapshotAll(annotations) {
  return annotations.map(a => cloneAnnotation(a));
}

// Move an annotation by delta, handling different position models
function moveAnnotation(ann, dx, dy) {
  if (dx === 0 && dy === 0) return;
  ann.modifiedAt = new Date().toISOString();

  switch (ann.type) {
    case 'line':
    case 'arrow':
    case 'measureDistance':
      ann.startX += dx;
      ann.startY += dy;
      ann.endX += dx;
      ann.endY += dy;
      break;
    case 'draw':
      if (ann.path) ann.path.forEach(p => { p.x += dx; p.y += dy; });
      break;
    case 'polyline':
    case 'measureArea':
    case 'measurePerimeter':
      if (ann.points) ann.points.forEach(p => { p.x += dx; p.y += dy; });
      break;
    case 'callout':
      ann.x += dx;
      ann.y += dy;
      if (ann.arrowX !== undefined) { ann.arrowX += dx; ann.arrowY += dy; }
      if (ann.kneeX !== undefined) { ann.kneeX += dx; ann.kneeY += dy; }
      break;
    default:
      if (ann.x !== undefined) { ann.x += dx; ann.y += dy; }
      break;
  }
}

// Wrapper: snapshot, apply operation, record single undo
function withUndo(selected, applyFn) {
  const originals = snapshotAll(selected);
  applyFn();
  recordBulkModify(selected, originals);
  redraw();
}

// --- Alignment ---

export function alignLeft() {
  const selected = getSelected();
  if (selected.length < 2) return;
  withUndo(selected, () => {
    const bounds = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    const minX = Math.min(...bounds.map(e => e.b.x));
    for (const { ann, b } of bounds) moveAnnotation(ann, minX - b.x, 0);
  });
}

export function alignCenter() {
  const selected = getSelected();
  if (selected.length < 2) return;
  withUndo(selected, () => {
    const bounds = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    const allMinX = Math.min(...bounds.map(e => e.b.x));
    const allMaxX = Math.max(...bounds.map(e => e.b.x + e.b.width));
    const centerX = (allMinX + allMaxX) / 2;
    for (const { ann, b } of bounds) {
      moveAnnotation(ann, centerX - (b.x + b.width / 2), 0);
    }
  });
}

export function alignRight() {
  const selected = getSelected();
  if (selected.length < 2) return;
  withUndo(selected, () => {
    const bounds = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    const maxX = Math.max(...bounds.map(e => e.b.x + e.b.width));
    for (const { ann, b } of bounds) moveAnnotation(ann, maxX - (b.x + b.width), 0);
  });
}

export function alignTop() {
  const selected = getSelected();
  if (selected.length < 2) return;
  withUndo(selected, () => {
    const bounds = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    const minY = Math.min(...bounds.map(e => e.b.y));
    for (const { ann, b } of bounds) moveAnnotation(ann, 0, minY - b.y);
  });
}

export function alignMiddle() {
  const selected = getSelected();
  if (selected.length < 2) return;
  withUndo(selected, () => {
    const bounds = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    const allMinY = Math.min(...bounds.map(e => e.b.y));
    const allMaxY = Math.max(...bounds.map(e => e.b.y + e.b.height));
    const centerY = (allMinY + allMaxY) / 2;
    for (const { ann, b } of bounds) {
      moveAnnotation(ann, 0, centerY - (b.y + b.height / 2));
    }
  });
}

export function alignBottom() {
  const selected = getSelected();
  if (selected.length < 2) return;
  withUndo(selected, () => {
    const bounds = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    const maxY = Math.max(...bounds.map(e => e.b.y + e.b.height));
    for (const { ann, b } of bounds) moveAnnotation(ann, 0, maxY - (b.y + b.height));
  });
}

// --- Distribution ---

export function distributeSpaceH() {
  const selected = getSelected();
  if (selected.length < 3) return;
  withUndo(selected, () => {
    const items = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    items.sort((a, b) => a.b.x - b.b.x);
    const totalWidth = items.reduce((s, e) => s + e.b.width, 0);
    const totalSpan = items[items.length - 1].b.x + items[items.length - 1].b.width - items[0].b.x;
    const gap = (totalSpan - totalWidth) / (items.length - 1);
    let x = items[0].b.x;
    for (const { ann, b } of items) {
      moveAnnotation(ann, x - b.x, 0);
      x += b.width + gap;
    }
  });
}

export function distributeSpaceV() {
  const selected = getSelected();
  if (selected.length < 3) return;
  withUndo(selected, () => {
    const items = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    items.sort((a, b) => a.b.y - b.b.y);
    const totalHeight = items.reduce((s, e) => s + e.b.height, 0);
    const totalSpan = items[items.length - 1].b.y + items[items.length - 1].b.height - items[0].b.y;
    const gap = (totalSpan - totalHeight) / (items.length - 1);
    let y = items[0].b.y;
    for (const { ann, b } of items) {
      moveAnnotation(ann, 0, y - b.y);
      y += b.height + gap;
    }
  });
}

export function distributeLeft() {
  const selected = getSelected();
  if (selected.length < 3) return;
  withUndo(selected, () => {
    const items = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    items.sort((a, b) => a.b.x - b.b.x);
    const first = items[0].b.x;
    const last = items[items.length - 1].b.x;
    const step = (last - first) / (items.length - 1);
    for (let i = 0; i < items.length; i++) {
      moveAnnotation(items[i].ann, first + step * i - items[i].b.x, 0);
    }
  });
}

export function distributeCenter() {
  const selected = getSelected();
  if (selected.length < 3) return;
  withUndo(selected, () => {
    const items = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    items.sort((a, b) => (a.b.x + a.b.width / 2) - (b.b.x + b.b.width / 2));
    const firstC = items[0].b.x + items[0].b.width / 2;
    const lastC = items[items.length - 1].b.x + items[items.length - 1].b.width / 2;
    const step = (lastC - firstC) / (items.length - 1);
    for (let i = 0; i < items.length; i++) {
      const cx = items[i].b.x + items[i].b.width / 2;
      moveAnnotation(items[i].ann, firstC + step * i - cx, 0);
    }
  });
}

export function distributeRight() {
  const selected = getSelected();
  if (selected.length < 3) return;
  withUndo(selected, () => {
    const items = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    items.sort((a, b) => (a.b.x + a.b.width) - (b.b.x + b.b.width));
    const first = items[0].b.x + items[0].b.width;
    const last = items[items.length - 1].b.x + items[items.length - 1].b.width;
    const step = (last - first) / (items.length - 1);
    for (let i = 0; i < items.length; i++) {
      const right = items[i].b.x + items[i].b.width;
      moveAnnotation(items[i].ann, first + step * i - right, 0);
    }
  });
}

export function distributeTop() {
  const selected = getSelected();
  if (selected.length < 3) return;
  withUndo(selected, () => {
    const items = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    items.sort((a, b) => a.b.y - b.b.y);
    const first = items[0].b.y;
    const last = items[items.length - 1].b.y;
    const step = (last - first) / (items.length - 1);
    for (let i = 0; i < items.length; i++) {
      moveAnnotation(items[i].ann, 0, first + step * i - items[i].b.y);
    }
  });
}

export function distributeMiddle() {
  const selected = getSelected();
  if (selected.length < 3) return;
  withUndo(selected, () => {
    const items = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    items.sort((a, b) => (a.b.y + a.b.height / 2) - (b.b.y + b.b.height / 2));
    const firstC = items[0].b.y + items[0].b.height / 2;
    const lastC = items[items.length - 1].b.y + items[items.length - 1].b.height / 2;
    const step = (lastC - firstC) / (items.length - 1);
    for (let i = 0; i < items.length; i++) {
      const cy = items[i].b.y + items[i].b.height / 2;
      moveAnnotation(items[i].ann, 0, firstC + step * i - cy);
    }
  });
}

export function distributeBottom() {
  const selected = getSelected();
  if (selected.length < 3) return;
  withUndo(selected, () => {
    const items = selected.map(a => ({ ann: a, b: getAnnotationBounds(a) })).filter(e => e.b);
    items.sort((a, b) => (a.b.y + a.b.height) - (b.b.y + b.b.height));
    const first = items[0].b.y + items[0].b.height;
    const last = items[items.length - 1].b.y + items[items.length - 1].b.height;
    const step = (last - first) / (items.length - 1);
    for (let i = 0; i < items.length; i++) {
      const bottom = items[i].b.y + items[i].b.height;
      moveAnnotation(items[i].ann, 0, first + step * i - bottom);
    }
  });
}
