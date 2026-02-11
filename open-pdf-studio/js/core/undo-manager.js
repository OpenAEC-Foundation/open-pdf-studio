import { state, getActiveDocument, getPageRotation, setPageRotation } from './state.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';

const MAX_UNDO_STACK = 100;

// Per-document undo stack stored on the document object
function getUndoStack() {
  const doc = getActiveDocument();
  if (!doc) return [];
  if (!doc.undoStack) doc.undoStack = [];
  return doc.undoStack;
}

function getRedoStack() {
  const doc = getActiveDocument();
  if (!doc) return [];
  if (!doc.redoStack) doc.redoStack = [];
  return doc.redoStack;
}

function pushUndo(cmd) {
  const stack = getUndoStack();
  stack.push(cmd);
  if (stack.length > MAX_UNDO_STACK) stack.shift();
}

function clearRedo() {
  const doc = getActiveDocument();
  if (doc) doc.redoStack = [];
}

function updateButtons() {
  const doc = getActiveDocument();
  const qaUndo = document.getElementById('qa-undo');
  const qaRedo = document.getElementById('qa-redo');
  if (qaUndo) qaUndo.disabled = !doc || !doc.undoStack || doc.undoStack.length === 0;
  if (qaRedo) qaRedo.disabled = !doc || !doc.redoStack || doc.redoStack.length === 0;
}

// Execute a command: push to undo, clear redo, mark modified
export function execute(cmd) {
  pushUndo(cmd);
  clearRedo();
  markDocumentModified();
  updateButtons();
}

// Undo
export async function undo() {
  const undoStack = getUndoStack();
  if (undoStack.length === 0) return;

  const cmd = undoStack.pop();
  const redoStack = getRedoStack();
  redoStack.push(cmd);

  applyUndo(cmd);
  markDocumentModified();

  // For modify operations, keep selection intact and refresh properties
  if (cmd.type === 'modifyAnnotation' || cmd.type === 'bulkModify') {
    const { showProperties, showMultiSelectionProperties } = await import('../ui/panels/properties-panel.js');
    if (state.selectedAnnotations.length > 1) {
      showMultiSelectionProperties();
    } else if (state.selectedAnnotation) {
      showProperties(state.selectedAnnotation);
    }
  } else {
    const { hideProperties } = await import('../ui/panels/properties-panel.js');
    hideProperties();
  }
  await refresh();
}

// Redo
export async function redo() {
  const redoStack = getRedoStack();
  if (redoStack.length === 0) return;

  const cmd = redoStack.pop();
  const undoStack = getUndoStack();
  undoStack.push(cmd);

  applyRedo(cmd);
  markDocumentModified();

  // For modify operations, keep selection intact and refresh properties
  if (cmd.type === 'modifyAnnotation' || cmd.type === 'bulkModify') {
    const { showProperties, showMultiSelectionProperties } = await import('../ui/panels/properties-panel.js');
    if (state.selectedAnnotations.length > 1) {
      showMultiSelectionProperties();
    } else if (state.selectedAnnotation) {
      showProperties(state.selectedAnnotation);
    }
  } else {
    const { hideProperties } = await import('../ui/panels/properties-panel.js');
    hideProperties();
  }
  await refresh();
}

export function canUndo() {
  return getUndoStack().length > 0;
}

export function canRedo() {
  return getRedoStack().length > 0;
}

// Apply undo for a command
function applyUndo(cmd) {
  const doc = getActiveDocument();
  if (!doc) return;

  switch (cmd.type) {
    case 'addAnnotation': {
      const idx = doc.annotations.findIndex(a => a.id === cmd.annotation.id);
      if (idx !== -1) doc.annotations.splice(idx, 1);
      break;
    }
    case 'deleteAnnotation': {
      const insertIdx = Math.min(cmd.index, doc.annotations.length);
      doc.annotations.splice(insertIdx, 0, cmd.annotation);
      break;
    }
    case 'clearPage': {
      doc.annotations.push(...cmd.annotations);
      break;
    }
    case 'clearAll': {
      doc.annotations.push(...cmd.annotations);
      break;
    }
    case 'modifyAnnotation': {
      const idx = doc.annotations.findIndex(a => a.id === cmd.id);
      if (idx !== -1) {
        Object.assign(doc.annotations[idx], cmd.oldState);
      }
      break;
    }
    case 'rotatePage': {
      setPageRotation(cmd.pageNum, cmd.oldRotation);
      break;
    }
    case 'bulkModify': {
      for (const item of cmd.items) {
        const idx = doc.annotations.findIndex(a => a.id === item.id);
        if (idx !== -1) Object.assign(doc.annotations[idx], item.oldState);
      }
      break;
    }
    case 'bulkDelete': {
      for (const item of cmd.items) {
        const insertIdx = Math.min(item.index, doc.annotations.length);
        doc.annotations.splice(insertIdx, 0, item.annotation);
      }
      break;
    }
    case 'bulkAdd': {
      for (const item of cmd.items) {
        const idx = doc.annotations.findIndex(a => a.id === item.annotation.id);
        if (idx !== -1) doc.annotations.splice(idx, 1);
      }
      break;
    }
  }
}

// Apply redo for a command
function applyRedo(cmd) {
  const doc = getActiveDocument();
  if (!doc) return;

  switch (cmd.type) {
    case 'addAnnotation': {
      doc.annotations.push(cloneAnnotation(cmd.annotation));
      break;
    }
    case 'deleteAnnotation': {
      const idx = doc.annotations.findIndex(a => a.id === cmd.annotation.id);
      if (idx !== -1) doc.annotations.splice(idx, 1);
      break;
    }
    case 'clearPage': {
      doc.annotations = doc.annotations.filter(a => a.page !== cmd.pageNum);
      break;
    }
    case 'clearAll': {
      doc.annotations = [];
      break;
    }
    case 'modifyAnnotation': {
      const idx = doc.annotations.findIndex(a => a.id === cmd.id);
      if (idx !== -1) {
        Object.assign(doc.annotations[idx], cmd.newState);
      }
      break;
    }
    case 'rotatePage': {
      setPageRotation(cmd.pageNum, cmd.newRotation);
      break;
    }
    case 'bulkModify': {
      for (const item of cmd.items) {
        const idx = doc.annotations.findIndex(a => a.id === item.id);
        if (idx !== -1) Object.assign(doc.annotations[idx], item.newState);
      }
      break;
    }
    case 'bulkDelete': {
      for (const item of cmd.items) {
        const idx = doc.annotations.findIndex(a => a.id === item.annotation.id);
        if (idx !== -1) doc.annotations.splice(idx, 1);
      }
      break;
    }
    case 'bulkAdd': {
      for (const item of cmd.items) {
        doc.annotations.push(cloneAnnotation(item.annotation));
      }
      break;
    }
  }
}

async function refresh() {
  const { redrawAnnotations, redrawContinuous, updateQuickAccessButtons } = await import('../annotations/rendering.js');
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
  updateQuickAccessButtons();
}

// ---- Helper recorders ----

export function recordAdd(annotation) {
  execute({
    type: 'addAnnotation',
    annotation: cloneAnnotation(annotation)
  });
}

export function recordDelete(annotation, index) {
  execute({
    type: 'deleteAnnotation',
    annotation: cloneAnnotation(annotation),
    index: index
  });
}

export function recordClearPage(pageNum, annotations) {
  const pageAnnotations = annotations.filter(a => a.page === pageNum).map(a => cloneAnnotation(a));
  if (pageAnnotations.length === 0) return;
  execute({
    type: 'clearPage',
    pageNum,
    annotations: pageAnnotations
  });
}

export function recordClearAll(annotations) {
  if (annotations.length === 0) return;
  execute({
    type: 'clearAll',
    annotations: annotations.map(a => cloneAnnotation(a))
  });
}

export function recordModify(annotationId, oldState, newState) {
  execute({
    type: 'modifyAnnotation',
    id: annotationId,
    oldState: cloneAnnotation(oldState),
    newState: cloneAnnotation(newState)
  });
}

export function recordPageRotation(pageNum, oldRotation, newRotation) {
  execute({
    type: 'rotatePage',
    pageNum,
    oldRotation,
    newRotation
  });
}

// Record bulk modification (multi-selection drag/resize)
export function recordBulkModify(currentAnnotations, originalAnnotations) {
  if (!currentAnnotations || currentAnnotations.length === 0) return;
  const items = [];
  for (let i = 0; i < currentAnnotations.length; i++) {
    if (originalAnnotations[i]) {
      items.push({
        id: currentAnnotations[i].id,
        oldState: cloneAnnotation(originalAnnotations[i]),
        newState: cloneAnnotation(currentAnnotations[i])
      });
    }
  }
  if (items.length === 0) return;
  execute({ type: 'bulkModify', items });
}

// Record bulk deletion (multi-selection delete)
export function recordBulkDelete(annotations) {
  if (!annotations || annotations.length === 0) return;
  const doc = getActiveDocument();
  if (!doc) return;
  const items = annotations.map(ann => ({
    annotation: cloneAnnotation(ann),
    index: doc.annotations.indexOf(ann)
  }));
  execute({ type: 'bulkDelete', items });
}

// Record bulk addition (multi-paste)
export function recordBulkAdd(annotations) {
  if (!annotations || annotations.length === 0) return;
  const items = annotations.map(ann => ({
    annotation: cloneAnnotation(ann)
  }));
  execute({ type: 'bulkAdd', items });
}

// Debounced property change recording (for rapid slider/input changes)
let propertyChangeTimer = null;
let pendingPropertyChange = null;

export function recordPropertyChange(annotation) {
  if (!annotation || !annotation.id) return;

  const doc = getActiveDocument();
  if (!doc) return;

  if (pendingPropertyChange &&
      (pendingPropertyChange.docId !== doc.id || pendingPropertyChange.id !== annotation.id)) {
    flushPropertyChange();
  }

  if (!pendingPropertyChange) {
    pendingPropertyChange = {
      id: annotation.id,
      docId: doc.id,
      oldState: cloneAnnotation(annotation)
    };
  }

  clearTimeout(propertyChangeTimer);
  propertyChangeTimer = setTimeout(() => {
    flushPropertyChange();
  }, 400);
}

export function flushPropertyChange() {
  if (!pendingPropertyChange) return;

  const targetDoc = state.documents.find(d => d.id === pendingPropertyChange.docId);
  if (!targetDoc) { pendingPropertyChange = null; return; }

  const current = targetDoc.annotations.find(a => a.id === pendingPropertyChange.id);
  if (current) {
    const cmd = {
      type: 'modifyAnnotation',
      id: pendingPropertyChange.id,
      oldState: pendingPropertyChange.oldState,
      newState: cloneAnnotation(current)
    };
    if (!targetDoc.undoStack) targetDoc.undoStack = [];
    targetDoc.undoStack.push(cmd);
    if (targetDoc.undoStack.length > MAX_UNDO_STACK) targetDoc.undoStack.shift();
    targetDoc.redoStack = [];
  }

  pendingPropertyChange = null;
  clearTimeout(propertyChangeTimer);
  updateButtons();
}
