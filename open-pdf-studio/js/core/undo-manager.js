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

  if (cmd.type === 'pageStructure') {
    const { restorePageState } = await import('../pdf/page-manager.js');
    await restorePageState(cmd.oldBytes, cmd.oldAnnotations, cmd.oldRotations, cmd.oldPage);
    updateButtons();
    return;
  }

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

  if (cmd.type === 'pageStructure') {
    const { restorePageState } = await import('../pdf/page-manager.js');
    await restorePageState(cmd.newBytes, cmd.newAnnotations, cmd.newRotations, cmd.newPage);
    updateButtons();
    return;
  }

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
    case 'addTextEdit': {
      if (!doc.textEdits) doc.textEdits = [];
      const idx = doc.textEdits.findIndex(e => e.id === cmd.textEdit.id);
      if (idx !== -1) doc.textEdits.splice(idx, 1);
      // Restore original span text in the text layer
      if (cmd.textEdit.originalSpanTexts) {
        const pageNum = cmd.textEdit.page;
        const textLayer = document.querySelector(`.textLayer[data-page="${pageNum}"]`)
          || document.querySelector('.textLayer');
        if (textLayer) {
          const spans = Array.from(textLayer.querySelectorAll('span[data-pdf-transform]'));
          // Find spans matching the edit's PDF position
          const editPdfY = cmd.textEdit.pdfY;
          const editPdfX = cmd.textEdit.pdfX;
          const fontSize = cmd.textEdit.fontSize;
          const tolerance = fontSize * 0.3;
          // Group spans into lines by pdfY
          const lineMap = new Map();
          for (const span of spans) {
            const transform = JSON.parse(span.dataset.pdfTransform);
            const pdfY = transform[5];
            let foundKey = null;
            for (const key of lineMap.keys()) {
              if (Math.abs(pdfY - key) <= tolerance) { foundKey = key; break; }
            }
            if (foundKey !== null) {
              lineMap.get(foundKey).push({ span, pdfX: transform[4], pdfY });
            } else {
              lineMap.set(pdfY, [{ span, pdfX: transform[4], pdfY }]);
            }
          }
          // Match lines from originalSpanTexts to text layer lines
          const origTexts = cmd.textEdit.originalSpanTexts;
          const ls = cmd.textEdit.lineSpacing || fontSize * 1.2;
          for (let li = 0; li < origTexts.length; li++) {
            const expectedY = editPdfY - li * ls;
            let bestLine = null;
            let bestDist = Infinity;
            for (const [key, lineSpans] of lineMap) {
              const dist = Math.abs(key - expectedY);
              if (dist < bestDist) { bestDist = dist; bestLine = lineSpans; }
            }
            if (bestLine && bestDist <= tolerance * 3) {
              bestLine.sort((a, b) => a.pdfX - b.pdfX);
              // Find starting span that matches the edit's pdfX position
              let startIdx = 0;
              let bestXDist = Infinity;
              for (let si = 0; si < bestLine.length; si++) {
                const dist = Math.abs(bestLine[si].pdfX - editPdfX);
                if (dist < bestXDist) { bestXDist = dist; startIdx = si; }
              }
              for (let si = 0; si < origTexts[li].length && (startIdx + si) < bestLine.length; si++) {
                bestLine[startIdx + si].span.textContent = origTexts[li][si];
              }
            }
          }
        }
      }
      break;
    }
    case 'removeTextEdit': {
      if (!doc.textEdits) doc.textEdits = [];
      const insertIdx = Math.min(cmd.index, doc.textEdits.length);
      doc.textEdits.splice(insertIdx, 0, { ...cmd.textEdit });
      break;
    }
    case 'addWatermark': {
      const idx = doc.watermarks.findIndex(w => w.id === cmd.watermark.id);
      if (idx !== -1) doc.watermarks.splice(idx, 1);
      break;
    }
    case 'removeWatermark': {
      const insertIdx = Math.min(cmd.index, doc.watermarks.length);
      doc.watermarks.splice(insertIdx, 0, { ...cmd.watermark });
      break;
    }
    case 'modifyWatermark': {
      const idx = doc.watermarks.findIndex(w => w.id === cmd.id);
      if (idx !== -1) Object.assign(doc.watermarks[idx], cmd.oldState);
      break;
    }
    case 'addBookmark': {
      if (!doc.bookmarks) doc.bookmarks = [];
      const idx = doc.bookmarks.findIndex(b => b.id === cmd.bookmark.id);
      if (idx !== -1) doc.bookmarks.splice(idx, 1);
      break;
    }
    case 'removeBookmark': {
      if (!doc.bookmarks) doc.bookmarks = [];
      for (const bm of cmd.bookmarks) {
        doc.bookmarks.push({ ...bm });
      }
      break;
    }
    case 'modifyBookmark': {
      if (!doc.bookmarks) doc.bookmarks = [];
      const idx = doc.bookmarks.findIndex(b => b.id === cmd.id);
      if (idx !== -1) Object.assign(doc.bookmarks[idx], cmd.oldState);
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
    case 'addTextEdit': {
      if (!doc.textEdits) doc.textEdits = [];
      doc.textEdits.push({ ...cmd.textEdit });
      break;
    }
    case 'removeTextEdit': {
      if (!doc.textEdits) doc.textEdits = [];
      const idx = doc.textEdits.findIndex(e => e.id === cmd.textEdit.id);
      if (idx !== -1) doc.textEdits.splice(idx, 1);
      break;
    }
    case 'addWatermark': {
      doc.watermarks.push({ ...cmd.watermark });
      break;
    }
    case 'removeWatermark': {
      const idx = doc.watermarks.findIndex(w => w.id === cmd.watermark.id);
      if (idx !== -1) doc.watermarks.splice(idx, 1);
      break;
    }
    case 'modifyWatermark': {
      const idx = doc.watermarks.findIndex(w => w.id === cmd.id);
      if (idx !== -1) Object.assign(doc.watermarks[idx], cmd.newState);
      break;
    }
    case 'addBookmark': {
      if (!doc.bookmarks) doc.bookmarks = [];
      doc.bookmarks.push({ ...cmd.bookmark });
      break;
    }
    case 'removeBookmark': {
      if (!doc.bookmarks) doc.bookmarks = [];
      const idsToRemove = new Set(cmd.bookmarks.map(b => b.id));
      doc.bookmarks = doc.bookmarks.filter(b => !idsToRemove.has(b.id));
      break;
    }
    case 'modifyBookmark': {
      if (!doc.bookmarks) doc.bookmarks = [];
      const idx = doc.bookmarks.findIndex(b => b.id === cmd.id);
      if (idx !== -1) Object.assign(doc.bookmarks[idx], cmd.newState);
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

  // Refresh bookmarks panel if active
  const activeTab = document.querySelector('.left-panel-tab.active');
  if (activeTab && activeTab.dataset.panel === 'bookmarks') {
    const { updateBookmarksList } = await import('../ui/panels/bookmarks.js');
    updateBookmarksList();
  }
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

// Watermark undo/redo helpers
export function recordAddWatermark(watermark) {
  execute({ type: 'addWatermark', watermark: { ...watermark } });
}

export function recordRemoveWatermark(watermark, index) {
  execute({ type: 'removeWatermark', watermark: { ...watermark }, index });
}

export function recordModifyWatermark(id, oldState, newState) {
  execute({ type: 'modifyWatermark', id, oldState: { ...oldState }, newState: { ...newState } });
}

// Bookmark undo/redo helpers
export function recordAddBookmark(bookmark) {
  execute({ type: 'addBookmark', bookmark: { ...bookmark } });
}

export function recordRemoveBookmark(bookmarks) {
  execute({ type: 'removeBookmark', bookmarks: bookmarks.map(b => ({ ...b })) });
}

export function recordModifyBookmark(id, oldState, newState) {
  execute({ type: 'modifyBookmark', id, oldState: { ...oldState }, newState: { ...newState } });
}

// Record a page structure change (insert, delete, reorder) for undo/redo
export function recordPageStructure(oldBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, newPage) {
  execute({
    type: 'pageStructure',
    oldBytes: oldBytes,
    oldAnnotations: oldAnnotations.map(a => ({ ...a })),
    oldRotations: { ...oldRotations },
    oldPage: oldPage,
    newBytes: newBytes,
    newAnnotations: newAnnotations.map(a => ({ ...a })),
    newRotations: { ...newRotations },
    newPage: newPage,
  });
}
