import { state, getActiveDocument, getPageRotation, setPageRotation } from './state.js';
import { cloneAnnotation } from '../annotations/factory.js';
const MAX_UNDO_STACK = 100;
let undoTransactionDepth = 0;
let undoTransactionCommands = null;
let undoTransactionDocumentId = null;
let undoTransactionBeforeSelectionIds = null;

function clonePlainValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

// Sync the modified flag based on whether the undo stack matches the saved clean point
function syncModifiedState() {
  const doc = getActiveDocument();
  if (!doc) return;
  const isClean = doc.savedUndoStackLength >= 0 &&
                  (doc.undoStack || []).length === doc.savedUndoStackLength;
  doc.modified = !isClean;
}

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
  if (stack.length > MAX_UNDO_STACK) {
    stack.shift();
    const doc = getActiveDocument();
    if (doc && doc.savedUndoStackLength >= 0) {
      doc.savedUndoStackLength--;
      if (doc.savedUndoStackLength < 0) doc.savedUndoStackLength = -1;
    }
  }
}

function clearRedo() {
  const doc = getActiveDocument();
  if (doc) doc.redoStack = [];
}

// No-op: TitleBar.jsx now derives undo/redo enabled from reactive state
function updateButtons() {}

// ---- Thumbnail refresh on annotation change ----
// Every committed annotation mutation (add/delete/modify/clear/bulk) flows
// through execute()/undo()/redo(). Page thumbnails composite the live
// annotations on top of the page bitmap (see overlayAnnotationsOnDataURL in
// left-panel.js), so a mutation must re-render the affected page's thumbnail.
// We debounce to coalesce rapid edits (drag-resize, property sliders, repeated
// deletes) into a single refresh, and we only invalidate the pages the command
// actually touched — never a full sweep.

// Extract the page number(s) a command affects. Tolerant: pulls .page from any
// annotation-shaped field and pageNum from rotate/clear commands. Unknown
// shapes fall back to the current page so the visible thumbnail still updates.
function pagesForCommand(cmd) {
  const pages = new Set();
  if (!cmd) return pages;
  const addPage = (p) => { if (Number.isInteger(p) && p >= 1) pages.add(p); };
  const addFrom = (obj) => { if (obj && typeof obj === 'object') addPage(obj.page); };

  if (Number.isInteger(cmd.pageNum)) addPage(cmd.pageNum);
  addFrom(cmd.annotation);
  addFrom(cmd.oldState);
  addFrom(cmd.newState);
  addFrom(cmd.textEdit);
  addFrom(cmd.oldTextEdit);
  addFrom(cmd.newTextEdit);
  if (Array.isArray(cmd.annotations)) cmd.annotations.forEach(addFrom);
  if (Array.isArray(cmd.items)) {
    cmd.items.forEach(it => {
      addFrom(it);
      addFrom(it.annotation);
      addFrom(it.oldState);
      addFrom(it.newState);
    });
  }
  if (Array.isArray(cmd.commands)) {
    for (const command of cmd.commands) {
      for (const page of pagesForCommand(command)) pages.add(page);
    }
  }

  // Watermark/bookmark commands don't carry a page and don't affect the page
  // thumbnail composite — skip them entirely (empty set = no refresh).
  const skipTypes = new Set([
    'addWatermark', 'removeWatermark', 'modifyWatermark',
    'addBookmark', 'removeBookmark', 'modifyBookmark',
    // pageStructure (insert/delete/reorder pages) shifts page numbers and is
    // handled by restorePageState → clearThumbnailCache + generateThumbnails,
    // which regenerates every thumbnail. A per-page hook here would be wrong.
    'pageStructure',
  ]);
  if (pages.size === 0 && !skipTypes.has(cmd.type)) {
    const doc = getActiveDocument();
    if (doc && Number.isInteger(doc.currentPage)) addPage(doc.currentPage);
  }
  return pages;
}

const _pendingThumbPages = new Set();
let _thumbRefreshTimer = null;

function scheduleThumbnailRefresh(cmd) {
  const pages = pagesForCommand(cmd);
  if (pages.size === 0) return;
  for (const p of pages) _pendingThumbPages.add(p);
  if (_thumbRefreshTimer) clearTimeout(_thumbRefreshTimer);
  _thumbRefreshTimer = setTimeout(async () => {
    _thumbRefreshTimer = null;
    const batch = Array.from(_pendingThumbPages);
    _pendingThumbPages.clear();
    if (batch.length === 0) return;
    try {
      const { invalidateThumbnails } = await import('../ui/panels/left-panel.js');
      invalidateThumbnails(batch);
    } catch (e) {
      console.warn('[undo] thumbnail refresh failed:', e);
    }
  }, 250);
}

function commandPreservesSelection(cmd) {
  if (!cmd) return false;
  if (cmd.type === 'modifyAnnotation' || cmd.type === 'bulkModify' ||
      cmd.type === 'reorderAnnotations' || cmd.type === 'modifyMeasureScale') {
    return true;
  }
  if (cmd.type !== 'compound') return false;
  if (Array.isArray(cmd.beforeSelectionIds) && Array.isArray(cmd.afterSelectionIds)) return true;
  return cmd.commands.length > 0 && cmd.commands.every(commandPreservesSelection);
}

function commandChangesMeasureScale(cmd) {
  if (!cmd) return false;
  if (cmd.type === 'modifyMeasureScale') return true;
  return cmd.type === 'compound' && cmd.commands.some(commandChangesMeasureScale);
}

async function persistMeasureScaleIfNeeded(cmd) {
  if (!commandChangesMeasureScale(cmd)) return;
  const { saveDocumentScale } = await import('../annotations/measurement.js');
  saveDocumentScale();
}

// Execute a command: push to undo, clear redo, sync modified state
export function execute(cmd) {
  if (pendingPropertyChange) flushPropertyChange();
  if (undoTransactionDepth > 0) {
    undoTransactionCommands.push(cmd);
    return;
  }
  const doc = getActiveDocument();
  // If clean point was beyond current position, it's now unreachable (divergent edit)
  if (doc && doc.savedUndoStackLength > (doc.undoStack || []).length) {
    doc.savedUndoStackLength = -1;
  }
  pushUndo(cmd);
  clearRedo();
  syncModifiedState();
  updateButtons();
  scheduleThumbnailRefresh(cmd);
}

// Undo
export async function undo() {
  flushPropertyChange();
  const undoStack = getUndoStack();
  if (undoStack.length === 0) return;

  const cmd = undoStack.pop();
  const redoStack = getRedoStack();
  redoStack.push(cmd);
  scheduleThumbnailRefresh(cmd);

  if (cmd.type === 'pageStructure') {
    const { restorePageState } = await import('../pdf/page-manager.js');
    await restorePageState(cmd.oldBytes, cmd.oldAnnotations, cmd.oldRotations, cmd.oldPage);
    syncModifiedState();
    updateButtons();
    return;
  }

  applyUndo(cmd);
  await persistMeasureScaleIfNeeded(cmd);
  syncModifiedState();

  // For modify operations, keep selection intact and refresh properties
  if (commandPreservesSelection(cmd)) {
    const { showProperties, showMultiSelectionProperties } = await import('../ui/panels/properties-panel.js');
    const _uDoc = getActiveDocument();
    const _uSel = _uDoc ? _uDoc.selectedAnnotations : [];
    if (_uSel.length > 1) {
      showMultiSelectionProperties();
    } else if (_uDoc?.selectedAnnotation) {
      showProperties(_uDoc.selectedAnnotation);
    }
  } else {
    // Clear selection of annotations that no longer exist
    const doc = getActiveDocument();
    if (doc) {
      const remaining = doc.selectedAnnotations.filter(a => doc.annotations.includes(a));
      if (remaining.length !== doc.selectedAnnotations.length) {
        doc.selectedAnnotations = remaining;
        doc.selectedAnnotation = remaining.length > 0 ? remaining[0] : null;
      }
    }
    const { hideProperties } = await import('../ui/panels/properties-panel.js');
    hideProperties();
  }
  await refresh();
}

// Redo
export async function redo() {
  flushPropertyChange();
  const redoStack = getRedoStack();
  if (redoStack.length === 0) return;

  const cmd = redoStack.pop();
  const undoStack = getUndoStack();
  undoStack.push(cmd);
  scheduleThumbnailRefresh(cmd);

  if (cmd.type === 'pageStructure') {
    const { restorePageState } = await import('../pdf/page-manager.js');
    await restorePageState(cmd.newBytes, cmd.newAnnotations, cmd.newRotations, cmd.newPage);
    syncModifiedState();
    updateButtons();
    return;
  }

  applyRedo(cmd);
  await persistMeasureScaleIfNeeded(cmd);
  syncModifiedState();

  // For modify operations, keep selection intact and refresh properties
  if (commandPreservesSelection(cmd)) {
    const { showProperties, showMultiSelectionProperties } = await import('../ui/panels/properties-panel.js');
    const _uDoc = getActiveDocument();
    const _uSel = _uDoc ? _uDoc.selectedAnnotations : [];
    if (_uSel.length > 1) {
      showMultiSelectionProperties();
    } else if (_uDoc?.selectedAnnotation) {
      showProperties(_uDoc.selectedAnnotation);
    }
  } else {
    // Clear selection of annotations that no longer exist
    const doc = getActiveDocument();
    if (doc) {
      const remaining = doc.selectedAnnotations.filter(a => doc.annotations.includes(a));
      if (remaining.length !== doc.selectedAnnotations.length) {
        doc.selectedAnnotations = remaining;
        doc.selectedAnnotation = remaining.length > 0 ? remaining[0] : null;
      }
    }
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

function restoreAnnotationOrder(doc, orderedIds) {
  const byId = new Map(doc.annotations.map(annotation => [annotation.id, annotation]));
  const restored = [];
  const restoredIds = new Set();
  for (const id of orderedIds) {
    const annotation = byId.get(id);
    if (!annotation) continue;
    restored.push(annotation);
    restoredIds.add(id);
  }
  for (const annotation of doc.annotations) {
    if (!restoredIds.has(annotation.id)) restored.push(annotation);
  }
  doc.annotations.splice(0, doc.annotations.length, ...restored);
}

function restoreAnnotationState(annotation, snapshot) {
  for (const key of Object.keys(annotation)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete annotation[key];
  }
  Object.assign(annotation, cloneAnnotation(snapshot));
}

function restoreSelectionByIds(doc, ids) {
  const byId = new Map(doc.annotations.map(annotation => [annotation.id, annotation]));
  doc.selectedAnnotations = (ids || []).map(id => byId.get(id)).filter(Boolean);
  doc.selectedAnnotation = doc.selectedAnnotations[0] || null;
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
        restoreAnnotationState(doc.annotations[idx], cmd.oldState);
      }
      break;
    }
    case 'rotatePage': {
      setPageRotation(cmd.pageNum, cmd.oldRotation);
      break;
    }
    case 'modifyMeasureScale': {
      doc.measureScale = clonePlainValue(cmd.oldState);
      break;
    }
    case 'bulkModify': {
      for (const item of cmd.items) {
        const idx = doc.annotations.findIndex(a => a.id === item.id);
        if (idx !== -1) restoreAnnotationState(doc.annotations[idx], item.oldState);
      }
      break;
    }
    case 'reorderAnnotations': {
      restoreAnnotationOrder(doc, cmd.oldOrder);
      break;
    }
    case 'compound': {
      for (let index = cmd.commands.length - 1; index >= 0; index--) {
        applyUndo(cmd.commands[index]);
      }
      if (Array.isArray(cmd.beforeSelectionIds)) {
        restoreSelectionByIds(doc, cmd.beforeSelectionIds);
      }
      break;
    }
    case 'bulkDelete': {
      const itemsByOriginalIndex = [...cmd.items].sort((a, b) => a.index - b.index);
      for (const item of itemsByOriginalIndex) {
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
    case 'modifyTextEdit': {
      if (!doc.textEdits) doc.textEdits = [];
      const idx = doc.textEdits.findIndex(e => e.id === cmd.newTextEdit.id);
      if (idx !== -1) doc.textEdits[idx] = { ...cmd.oldTextEdit };
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
        restoreAnnotationState(doc.annotations[idx], cmd.newState);
      }
      break;
    }
    case 'rotatePage': {
      setPageRotation(cmd.pageNum, cmd.newRotation);
      break;
    }
    case 'modifyMeasureScale': {
      doc.measureScale = clonePlainValue(cmd.newState);
      break;
    }
    case 'bulkModify': {
      for (const item of cmd.items) {
        const idx = doc.annotations.findIndex(a => a.id === item.id);
        if (idx !== -1) restoreAnnotationState(doc.annotations[idx], item.newState);
      }
      break;
    }
    case 'reorderAnnotations': {
      restoreAnnotationOrder(doc, cmd.newOrder);
      break;
    }
    case 'compound': {
      for (const command of cmd.commands) applyRedo(command);
      if (Array.isArray(cmd.afterSelectionIds)) {
        restoreSelectionByIds(doc, cmd.afterSelectionIds);
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
    case 'modifyTextEdit': {
      if (!doc.textEdits) doc.textEdits = [];
      const idx = doc.textEdits.findIndex(e => e.id === cmd.oldTextEdit.id);
      if (idx !== -1) doc.textEdits[idx] = { ...cmd.newTextEdit };
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
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
  updateQuickAccessButtons();

  // Refresh bookmarks panel if active
  const { activeTab } = await import('../solid/stores/leftPanelStore.js');
  if (activeTab() === 'bookmarks') {
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

export function recordAnnotationOrder(oldOrder, newOrder) {
  if (!Array.isArray(oldOrder) || !Array.isArray(newOrder)) return;
  if (oldOrder.length !== newOrder.length) return;
  if (oldOrder.every((id, index) => id === newOrder[index])) return;
  execute({
    type: 'reorderAnnotations',
    oldOrder: [...oldOrder],
    newOrder: [...newOrder],
  });
}

export function recordMeasureScale(oldState, newState) {
  if (JSON.stringify(oldState) === JSON.stringify(newState)) return;
  execute({
    type: 'modifyMeasureScale',
    oldState: clonePlainValue(oldState),
    newState: clonePlainValue(newState),
  });
}

export function beginUndoTransaction() {
  if (undoTransactionDepth === 0) {
    const doc = getActiveDocument();
    undoTransactionCommands = [];
    undoTransactionDocumentId = doc?.id || null;
    undoTransactionBeforeSelectionIds = (doc?.selectedAnnotations || []).map(annotation => annotation.id);
  }
  undoTransactionDepth++;
}

export function endUndoTransaction() {
  if (undoTransactionDepth === 0) return;
  undoTransactionDepth--;
  if (undoTransactionDepth > 0) return;
  const commands = undoTransactionCommands || [];
  const targetDoc = state.documents.find(doc => doc.id === undoTransactionDocumentId);
  const beforeSelectionIds = undoTransactionBeforeSelectionIds || [];
  const afterSelectionIds = (targetDoc?.selectedAnnotations || []).map(annotation => annotation.id);
  undoTransactionCommands = null;
  undoTransactionDocumentId = null;
  undoTransactionBeforeSelectionIds = null;
  if (commands.length === 0) return;
  const selectionChanged = beforeSelectionIds.length !== afterSelectionIds.length ||
    beforeSelectionIds.some((id, index) => id !== afterSelectionIds[index]);
  if (commands.length === 1 && !selectionChanged) execute(commands[0]);
  else execute({ type: 'compound', commands, beforeSelectionIds, afterSelectionIds });
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
  const pendingId = annotation.id;
  const pendingDocId = doc.id;
  queueMicrotask(() => {
    if (!pendingPropertyChange ||
        pendingPropertyChange.id !== pendingId ||
        pendingPropertyChange.docId !== pendingDocId) return;
    const targetDoc = state.documents.find(candidate => candidate.id === pendingDocId);
    const current = targetDoc?.annotations.find(candidate => candidate.id === pendingId);
    if (current) pendingPropertyChange.newState = cloneAnnotation(current);
  });
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
      newState: pendingPropertyChange.newState || cloneAnnotation(current)
    };
    if (!targetDoc.undoStack) targetDoc.undoStack = [];
    // If clean point was beyond current position, it's now unreachable
    if (targetDoc.savedUndoStackLength > targetDoc.undoStack.length) {
      targetDoc.savedUndoStackLength = -1;
    }
    targetDoc.undoStack.push(cmd);
    if (targetDoc.undoStack.length > MAX_UNDO_STACK) {
      targetDoc.undoStack.shift();
      if (targetDoc.savedUndoStackLength >= 0) {
        targetDoc.savedUndoStackLength--;
        if (targetDoc.savedUndoStackLength < 0) targetDoc.savedUndoStackLength = -1;
      }
    }
    targetDoc.redoStack = [];
    // Sync modified state
    const isClean = targetDoc.savedUndoStackLength >= 0 &&
                    targetDoc.undoStack.length === targetDoc.savedUndoStackLength;
    targetDoc.modified = !isClean;
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
