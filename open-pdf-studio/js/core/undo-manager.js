import { batch } from 'solid-js';
import { state, getActiveDocument, getPageRotation, setPageRotation, imageCache } from './state.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { stampRasterStale } from '../annotations/stamp-appearance-sync.js';
import { applyOcrShift } from '../pdf/shift-page-geometry.js';
import { toonOrigineelInTekstlaag, toonBewerkingInTekstlaag } from '../text/tekstlaag-bewerking.js';
const MAX_UNDO_STACK = 100;
let undoTransactionDepth = 0;
let undoTransactionCommands = null;
let undoTransactionDocumentId = null;
let undoTransactionBeforeSelectionIds = null;

function clonePlainValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function verhoogInhoudRevisie(doc) {
  doc.inhoudRevisie = (Number.isInteger(doc.inhoudRevisie) ? doc.inhoudRevisie : 0) + 1;
}

// Sync the modified flag based on whether the undo stack matches the saved clean point
function syncModifiedState() {
  const doc = getActiveDocument();
  if (!doc) return;
  // Elke stap in de undo-geschiedenis (ook ongedaan maken en opnieuw) geeft
  // het document een nieuwe inhoudsrevisie (#575, documentRevisie).
  verhoogInhoudRevisie(doc);
  const isClean = doc.savedUndoStackLength >= 0 &&
                  (doc.undoStack || []).length === doc.savedUndoStackLength;
  doc.modified = !isClean;
}

/**
 * De inhoudsrevisie van een document ('d<n>'): verandert bij elke wijziging
 * die in de undo-geschiedenis komt, en bij ongedaan maken en opnieuw. Een
 * vergelijking met een eerder gelezen revisie zegt dus of het document sinds
 * dat moment is gewijzigd (#575: revisionContext van extensieopdrachten).
 */
export function documentRevisie(doc) {
  if (!doc) return null;
  return `d${Number.isInteger(doc.inhoudRevisie) ? doc.inhoudRevisie : 0}`;
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
    'ocrWord', 'ocrPage', 'ocrPages',
    'addWatermark', 'removeWatermark', 'modifyWatermark',
    'addBookmark', 'removeBookmark', 'modifyBookmark', 'setBookmarks',
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
      cmd.type === 'reorderAnnotations' || cmd.type === 'modifyMeasureScale' ||
      cmd.type === 'modifyScaleChecks') {
    return true;
  }
  if (cmd.type !== 'compound') return false;
  if (Array.isArray(cmd.beforeSelectionIds) && Array.isArray(cmd.afterSelectionIds)) return true;
  return cmd.commands.length > 0 && cmd.commands.every(commandPreservesSelection);
}

// Een paginarotatie verandert het paginabeeld zelf; refresh() tekent alleen de
// annotaties opnieuw, dus na ongedaan maken bleef de pagina gedraaid staan.
function raaktPaginaRotatie(cmd) {
  if (!cmd) return false;
  if (cmd.type === 'rotatePage') return true;
  return cmd.type === 'compound' && cmd.commands.some(raaktPaginaRotatie);
}

function zetViewports(doc, pageNum, lijst) {
  if (lijst === undefined) {
    if (doc.pdfViewports) delete doc.pdfViewports[pageNum];
    return;
  }
  doc.pdfViewports ||= {};
  doc.pdfViewports[pageNum] = lijst;
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
    await restorePageState(cmd.oldBytes, cmd.oldAnnotations, cmd.oldRotations, cmd.oldPage, { bookmarks: cmd.bookmarks?.old });
    applyOcrShift(getActiveDocument()?.ocrResults, cmd.ocrShift, -1);
    syncModifiedState();
    updateButtons();
    return;
  }

  // One reactive update for the whole command: restoring an annotation sets
  // its properties one by one, and a bulk command touches many annotations.
  // Without the batch every single write reran every view that watches the
  // annotations (#491).
  batch(() => applyUndo(cmd));
  if (raaktPaginaRotatie(cmd)) {
    const { tekenNaPaginaRotatie } = await import('../pdf/renderer.js');
    await tekenNaPaginaRotatie();
  }
  await rerasterizeStaleStamps();
  await persistMeasureScaleIfNeeded(cmd);
  syncModifiedState();

  // For modify operations, keep selection intact and refresh properties.
  // No redraw from the panel: refresh() below draws once for the whole step.
  if (commandPreservesSelection(cmd)) {
    const { showProperties, showMultiSelectionProperties } = await import('../ui/panels/properties-panel.js');
    const _uDoc = getActiveDocument();
    const _uSel = _uDoc ? _uDoc.selectedAnnotations : [];
    if (_uSel.length > 1) {
      showMultiSelectionProperties();
    } else if (_uDoc?.selectedAnnotation) {
      showProperties(_uDoc.selectedAnnotation, { redraw: false });
    }
  } else {
    // Clear selection of annotations that no longer exist
    const doc = getActiveDocument();
    if (doc) dropRemovedFromSelection(doc);
    const { hideProperties } = await import('../ui/panels/properties-panel.js');
    hideProperties({ redraw: false });
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
    await restorePageState(cmd.newBytes, cmd.newAnnotations, cmd.newRotations, cmd.newPage, { bookmarks: cmd.bookmarks?.new });
    applyOcrShift(getActiveDocument()?.ocrResults, cmd.ocrShift, 1);
    syncModifiedState();
    updateButtons();
    return;
  }

  batch(() => applyRedo(cmd));
  if (raaktPaginaRotatie(cmd)) {
    const { tekenNaPaginaRotatie } = await import('../pdf/renderer.js');
    await tekenNaPaginaRotatie();
  }
  await rerasterizeStaleStamps();
  await persistMeasureScaleIfNeeded(cmd);
  syncModifiedState();

  // For modify operations, keep selection intact and refresh properties.
  // No redraw from the panel: refresh() below draws once for the whole step.
  if (commandPreservesSelection(cmd)) {
    const { showProperties, showMultiSelectionProperties } = await import('../ui/panels/properties-panel.js');
    const _uDoc = getActiveDocument();
    const _uSel = _uDoc ? _uDoc.selectedAnnotations : [];
    if (_uSel.length > 1) {
      showMultiSelectionProperties();
    } else if (_uDoc?.selectedAnnotation) {
      showProperties(_uDoc.selectedAnnotation, { redraw: false });
    }
  } else {
    // Clear selection of annotations that no longer exist
    const doc = getActiveDocument();
    if (doc) dropRemovedFromSelection(doc);
    const { hideProperties } = await import('../ui/panels/properties-panel.js');
    hideProperties({ redraw: false });
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

// Symbolen waarvan het beeld na het terugzetten niet meer bij de SVG past.
// Gevuld door restoreAnnotationState, afgehandeld na applyUndo/applyRedo.
let staleStamps = [];

function restoreAnnotationState(annotation, snapshot) {
  const stale = stampRasterStale(annotation, snapshot);
  for (const key of Object.keys(annotation)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete annotation[key];
  }
  Object.assign(annotation, cloneAnnotation(snapshot));
  if (stale) {
    // Direct het oude raster uit de cache halen, zodat er tussendoor niet
    // nog de vorige kleur of dikte getekend wordt.
    if (annotation.imageId) imageCache.delete(annotation.imageId);
    annotation._cachedImg = null;
    staleStamps.push(annotation);
  }
}

// Nieuw beeld maken voor symbolen die restoreAnnotationState markeerde — via
// hetzelfde pad als kleur/lijndikte in de eigenschappen (stamp-line-width.js).
// Dynamische import: die module trekt de render-keten mee.
async function rerasterizeStaleStamps() {
  if (staleStamps.length === 0) return;
  const stamps = staleStamps;
  staleStamps = [];
  const { rerasterizeStamp } = await import('../annotations/stamp-line-width.js');
  for (const annotation of stamps) rerasterizeStamp(annotation);
}

// Keep only the selected annotations that are still in the document. One pass
// over the list instead of one includes() per selected annotation.
function dropRemovedFromSelection(doc) {
  const selected = doc.selectedAnnotations;
  if (!selected || selected.length === 0) return;
  const present = new Set(doc.annotations);
  const remaining = selected.filter(a => present.has(a));
  if (remaining.length !== selected.length) {
    doc.selectedAnnotations = remaining;
    doc.selectedAnnotation = remaining.length > 0 ? remaining[0] : null;
  }
}

// Annotations by id for one undo/redo, built on first use with one pass over
// the list instead of a findIndex per item (#491). The first annotation with
// an id wins, as with findIndex. A change to the list itself (or to an id)
// makes the next lookup rebuild it.
function annotationsById(doc) {
  let byId = null;
  return {
    get(id) {
      if (!byId) {
        byId = new Map();
        for (const annotation of doc.annotations) {
          if (!byId.has(annotation.id)) byId.set(annotation.id, annotation);
        }
      }
      return byId.get(id);
    },
    reset() { byId = null; },
  };
}

// Restore the annotation with this id (if it is still there) to a snapshot.
function restoreById(lookup, id, snapshot) {
  const annotation = lookup.get(id);
  if (!annotation) return;
  restoreAnnotationState(annotation, snapshot);
  if (annotation.id !== id) lookup.reset();
}

// Remove, for every id in `ids`, the first annotation with that id: the same
// result as a findIndex + splice per id, in one pass and one splice.
function removeFirstById(doc, ids) {
  const toRemove = new Map();
  for (const id of ids) toRemove.set(id, (toRemove.get(id) || 0) + 1);
  const kept = [];
  let removed = 0;
  for (const annotation of doc.annotations) {
    const left = toRemove.get(annotation.id);
    if (left) {
      toRemove.set(annotation.id, left - 1);
      removed++;
    } else {
      kept.push(annotation);
    }
  }
  if (removed > 0) doc.annotations.splice(0, doc.annotations.length, ...kept);
}

function restoreSelectionByIds(doc, ids) {
  const byId = new Map(doc.annotations.map(annotation => [annotation.id, annotation]));
  doc.selectedAnnotations = (ids || []).map(id => byId.get(id)).filter(Boolean);
  doc.selectedAnnotation = doc.selectedAnnotations[0] || null;
}

// Apply undo for a command
// OCR results per page. An empty list is kept (not deleted): the saver then
// removes the OCR layer an earlier save of this session wrote on that page.
function setOcrPage(doc, page, words) {
  if (!doc.ocrResults) doc.ocrResults = {};
  doc.ocrResults[page] = clonePlainValue(words) || [];
}

function setOcrWord(doc, page, index, word) {
  const words = doc.ocrResults?.[page];
  if (Array.isArray(words) && index >= 0 && index < words.length) words[index] = clonePlainValue(word);
}

function applyUndo(cmd, lookup) {
  const doc = getActiveDocument();
  if (!doc) return;
  if (!lookup) lookup = annotationsById(doc);

  switch (cmd.type) {
    case 'ocrWord': setOcrWord(doc, cmd.page, cmd.index, cmd.oldWord); break;
    case 'ocrPage': setOcrPage(doc, cmd.page, cmd.oldWords); break;
    case 'ocrPages': cmd.pages.forEach((p) => setOcrPage(doc, p.page, p.oldWords)); break;
    case 'addAnnotation': {
      const idx = doc.annotations.findIndex(a => a.id === cmd.annotation.id);
      if (idx !== -1) doc.annotations.splice(idx, 1);
      lookup.reset();
      break;
    }
    case 'deleteAnnotation': {
      const insertIdx = Math.min(cmd.index, doc.annotations.length);
      doc.annotations.splice(insertIdx, 0, cmd.annotation);
      lookup.reset();
      break;
    }
    case 'clearPage': {
      doc.annotations.push(...cmd.annotations);
      lookup.reset();
      break;
    }
    case 'clearAll': {
      doc.annotations.push(...cmd.annotations);
      lookup.reset();
      break;
    }
    case 'modifyAnnotation': {
      restoreById(lookup, cmd.id, cmd.oldState);
      break;
    }
    case 'rotatePage': {
      setPageRotation(cmd.pageNum, cmd.oldRotation);
      if (cmd.viewports) zetViewports(doc, cmd.pageNum, cmd.viewports.oud);
      break;
    }
    case 'modifyMeasureScale': {
      doc.measureScale = clonePlainValue(cmd.oldState);
      break;
    }
    case 'modifyScaleChecks': {
      doc.scaleChecks = clonePlainValue(cmd.oldState);
      break;
    }
    case 'bulkModify': {
      for (const item of cmd.items) restoreById(lookup, item.id, item.oldState);
      break;
    }
    case 'reorderAnnotations': {
      restoreAnnotationOrder(doc, cmd.oldOrder);
      lookup.reset();
      break;
    }
    case 'compound': {
      for (let index = cmd.commands.length - 1; index >= 0; index--) {
        applyUndo(cmd.commands[index], lookup);
      }
      if (Array.isArray(cmd.beforeSelectionIds)) {
        restoreSelectionByIds(doc, cmd.beforeSelectionIds);
      }
      break;
    }
    case 'bulkDelete': {
      // Put every item back at its original index, lowest index first: the
      // same order as one splice per item, worked out on a plain copy and
      // written back with a single splice.
      const itemsByOriginalIndex = [...cmd.items].sort((a, b) => a.index - b.index);
      const list = [...doc.annotations];
      for (const item of itemsByOriginalIndex) {
        const insertIdx = Math.min(item.index, list.length);
        list.splice(insertIdx, 0, item.annotation);
      }
      doc.annotations.splice(0, doc.annotations.length, ...list);
      lookup.reset();
      break;
    }
    case 'bulkAdd': {
      removeFirstById(doc, cmd.items.map(item => item.annotation.id));
      lookup.reset();
      break;
    }
    case 'addTextEdit': {
      if (!doc.textEdits) doc.textEdits = [];
      const idx = doc.textEdits.findIndex(e => e.id === cmd.textEdit.id);
      if (idx !== -1) doc.textEdits.splice(idx, 1);
      // De originele tekst terug in de tekstlaag.
      const laag = tekstlaagVan(cmd.textEdit.page);
      if (laag) toonOrigineelInTekstlaag(laag, cmd.textEdit, cmd.tekstlaagNa || null);
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
      const laag = tekstlaagVan(cmd.oldTextEdit.page);
      if (laag) toonBewerkingInTekstlaag(laag, cmd.oldTextEdit, { vorige: cmd.newTextEdit });
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
      if (idx !== -1) zetWatermerkStaat(doc.watermarks[idx], cmd.oldState);
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
    case 'setBookmarks': {
      // Hele bladwijzerlijst terug (stijl, verplaatsen, nesten, meervoudig
      // verwijderen: één stap). Eén toewijzing: het document kopieert.
      doc.bookmarks = cmd.oldBookmarks.map(b => ({ ...b }));
      break;
    }
  }
}

// De tekstlaag van een pagina (enkele pagina: de enige laag).
function tekstlaagVan(pageNum) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
  return document.querySelector(`.textLayer[data-page="${pageNum}"]`)
    || document.querySelector('.textLayer');
}

// Apply redo for a command
function applyRedo(cmd, lookup) {
  const doc = getActiveDocument();
  if (!doc) return;
  if (!lookup) lookup = annotationsById(doc);

  switch (cmd.type) {
    case 'ocrWord': setOcrWord(doc, cmd.page, cmd.index, cmd.newWord); break;
    case 'ocrPage': setOcrPage(doc, cmd.page, cmd.newWords); break;
    case 'ocrPages': cmd.pages.forEach((p) => setOcrPage(doc, p.page, p.newWords)); break;
    case 'addAnnotation': {
      doc.annotations.push(cloneAnnotation(cmd.annotation));
      lookup.reset();
      break;
    }
    case 'deleteAnnotation': {
      const idx = doc.annotations.findIndex(a => a.id === cmd.annotation.id);
      if (idx !== -1) doc.annotations.splice(idx, 1);
      lookup.reset();
      break;
    }
    case 'clearPage': {
      doc.annotations = doc.annotations.filter(a => a.page !== cmd.pageNum);
      lookup.reset();
      break;
    }
    case 'clearAll': {
      doc.annotations = [];
      lookup.reset();
      break;
    }
    case 'modifyAnnotation': {
      restoreById(lookup, cmd.id, cmd.newState);
      break;
    }
    case 'rotatePage': {
      setPageRotation(cmd.pageNum, cmd.newRotation);
      if (cmd.viewports) zetViewports(doc, cmd.pageNum, cmd.viewports.nieuw);
      break;
    }
    case 'modifyMeasureScale': {
      doc.measureScale = clonePlainValue(cmd.newState);
      break;
    }
    case 'modifyScaleChecks': {
      doc.scaleChecks = clonePlainValue(cmd.newState);
      break;
    }
    case 'bulkModify': {
      for (const item of cmd.items) restoreById(lookup, item.id, item.newState);
      break;
    }
    case 'reorderAnnotations': {
      restoreAnnotationOrder(doc, cmd.newOrder);
      lookup.reset();
      break;
    }
    case 'compound': {
      for (const command of cmd.commands) applyRedo(command, lookup);
      if (Array.isArray(cmd.afterSelectionIds)) {
        restoreSelectionByIds(doc, cmd.afterSelectionIds);
      }
      break;
    }
    case 'bulkDelete': {
      removeFirstById(doc, cmd.items.map(item => item.annotation.id));
      lookup.reset();
      break;
    }
    case 'bulkAdd': {
      for (const item of cmd.items) {
        doc.annotations.push(cloneAnnotation(item.annotation));
      }
      lookup.reset();
      break;
    }
    case 'addTextEdit': {
      if (!doc.textEdits) doc.textEdits = [];
      doc.textEdits.push({ ...cmd.textEdit });
      // De bewerkte tekst weer in de tekstlaag, zoals finishPdfTextEditing
      // hem zette (#719); anders vonden zoeken en selecteren de oude tekst.
      const laag = tekstlaagVan(cmd.textEdit.page);
      if (laag) toonBewerkingInTekstlaag(laag, cmd.textEdit, { teksten: cmd.tekstlaagNa || null });
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
      const laag = tekstlaagVan(cmd.newTextEdit.page);
      if (laag) toonBewerkingInTekstlaag(laag, cmd.newTextEdit, { vorige: cmd.oldTextEdit });
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
      if (idx !== -1) zetWatermerkStaat(doc.watermarks[idx], cmd.newState);
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
    case 'setBookmarks': {
      doc.bookmarks = cmd.newBookmarks.map(b => ({ ...b }));
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

// Called with every annotation the user adds, before it is recorded: the
// Tool Sets feature (#311) puts the properties of its active item on it here, so
// the undo record and redo hold the finished annotation.
let _addAnnotationHook = null;
export function setAddAnnotationHook(fn) {
  _addAnnotationHook = typeof fn === 'function' ? fn : null;
}

/**
 * Record an added annotation. `options.copy`: the annotation is an exact copy
 * (paste, duplicate) or fully described by its caller (automation); the add
 * hook leaves it as it is, so pasting while a tool set item is the active
 * tool does not restyle the pasted annotation as if it were drawn with it.
 */
export function recordAdd(annotation, options) {
  if (_addAnnotationHook && annotation && !options?.copy) {
    try { _addAnnotationHook(annotation); } catch (e) { console.warn('Add-annotation hook failed:', e); }
  }
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

// `viewports` ({oud, nieuw}): de meetschalen uit de PDF (/VP) van de pagina
// vóór en na het draaien; rotatePage() draait ze mee (zie pagina-draaien.js).
export function recordPageRotation(pageNum, oldRotation, newRotation, viewports) {
  execute({
    type: 'rotatePage',
    pageNum,
    oldRotation,
    newRotation,
    ...(viewports ? { viewports } : {}),
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

// A correction that keeps growing in the proofreading mode (#508: pressing
// Delete again extends the strike-through) stays one undo step: the add at
// the top of the stack takes the new shape, so one undo removes the whole
// correction. Only while that add is the last step, nothing can be redone,
// no transaction is open and the document was not saved after it; otherwise
// false, and the caller records an ordinary modify step.
export function amendLastAdd(annotation) {
  if (!annotation || undoTransactionDepth > 0) return false;
  const doc = getActiveDocument();
  if (!doc) return false;
  const stack = getUndoStack();
  const top = stack[stack.length - 1];
  if (!top || top.type !== 'addAnnotation' || top.annotation?.id !== annotation.id) return false;
  if ((doc.redoStack || []).length > 0) return false;
  if (doc.savedUndoStackLength === stack.length) return false;
  if (pendingPropertyChange) flushPropertyChange();
  top.annotation = cloneAnnotation(annotation);
  syncModifiedState();
  scheduleThumbnailRefresh(top);
  return true;
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

// De schaalcontroles per blad (#629): een controle maakt het document
// gewijzigd (ze gaat het bestand in) en is ongedaan te maken.
export function recordScaleChecks(oldState, newState) {
  if (JSON.stringify(oldState) === JSON.stringify(newState)) return;
  execute({
    type: 'modifyScaleChecks',
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
    // Ook een wijziging uit het eigenschappenpaneel is een nieuwe stap in de
    // undo-geschiedenis: nieuwe inhoudsrevisie, anders blijft een verouderde
    // revisionContext van een extensieopdracht geldig (#575).
    verhoogInhoudRevisie(targetDoc);
    // Sync modified state
    const isClean = targetDoc.savedUndoStackLength >= 0 &&
                    targetDoc.undoStack.length === targetDoc.savedUndoStackLength;
    targetDoc.modified = !isClean;
    // Kleur, lijndikte enz. uit het eigenschappenpaneel komen hier binnen,
    // niet via execute(): ook dan de miniatuur van die pagina verversen (#579).
    if (targetDoc.id === getActiveDocument()?.id) scheduleThumbnailRefresh(cmd);
  }

  pendingPropertyChange = null;
  clearTimeout(propertyChangeTimer);
  updateButtons();
}

// Een watermerk krijgt precies de bewaarde stand terug: ook instellingen die
// de wijziging toevoegde (zoals autoFit, #849) verdwijnen weer.
function zetWatermerkStaat(wm, staat) {
  for (const sleutel of Object.keys(wm)) if (!(sleutel in staat)) delete wm[sleutel];
  Object.assign(wm, staat);
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

// Eén undo-stap voor een wijziging aan meerdere bladwijzers tegelijk: de hele
// lijst ervoor en erna (#689 stijl op een selectie, #690 verplaatsen/nesten).
export function recordBookmarksChange(oldBookmarks, newBookmarks) {
  execute({
    type: 'setBookmarks',
    oldBookmarks: (oldBookmarks || []).map(b => ({ ...b })),
    newBookmarks: (newBookmarks || []).map(b => ({ ...b })),
  });
}

// Record a page structure change (insert, delete, reorder) for undo/redo.
// `extra.ocrShift` ({pages, dx, dy}) is set by Shift Page: the pending OCR word
// boxes of those pages moved with the content and move back on undo.
export function recordPageStructure(oldBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, newPage, extra = {}) {
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
    ...(extra.ocrShift ? { ocrShift: { ...extra.ocrShift, pages: [...extra.ocrShift.pages] } } : {}),
    // Bladwijzers vóór en na (samenvoegen): de bewerking verandert ze.
    ...(extra.bookmarks ? { bookmarks: {
      old: extra.bookmarks.old.map((b) => ({ ...b })),
      new: extra.bookmarks.new.map((b) => ({ ...b })),
    } } : {}),
  });
}


// OCR can finish in a background tab. Never push its command onto the active tab.
export function recordOcrPage(doc, page, oldWords, newWords) {
  recordOcrPages(doc, [{ page, oldWords, newWords }]);
}

// Several pages of one OCR run: a single undo step.
export function recordOcrPages(doc, pages) {
  if (!pages.length) return;
  const changes = pages.map((p) => ({
    page: p.page, oldWords: clonePlainValue(p.oldWords), newWords: clonePlainValue(p.newWords),
  }));
  const cmd = changes.length === 1 ? { type: 'ocrPage', ...changes[0] } : { type: 'ocrPages', pages: changes };
  if (getActiveDocument() === doc) {
    execute(cmd);
    return;
  }
  doc.undoStack.push(cmd);
  if (doc.undoStack.length > MAX_UNDO_STACK) doc.undoStack.shift();
  doc.redoStack = [];
  doc.savedUndoStackLength = -1;
  verhoogInhoudRevisie(doc);
}
