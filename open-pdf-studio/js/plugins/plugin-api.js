/**
 * Plugin API
 *
 * Creates the `api` object that is passed to plugin activate() functions.
 * This is the contract between the host app and plugins.
 */

import { registerAnnotationType, unregisterAnnotationType } from './annotation-type-registry.js';
import { registerToolPalette, unregisterToolPalette } from './palette-registry.js';
import { registerPropertyPanel as _registerPropertyPanel, unregisterPropertyPanel as _unregisterPropertyPanel } from './property-panel-registry.js';
import {
  registerSelectionListener as _registerSelectionListener,
  unregisterSelectionListener as _unregisterSelectionListener,
} from './selection-listener-registry.js';
import { clearAllToolGroups } from './tool-group-state.js';
import { setNativePanelHidden } from '../solid/stores/propertiesStore.js';
import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import { setTool } from '../tools/manager.js';
import { createAnnotation } from '../annotations/factory.js';
import { redrawAnnotations } from '../annotations/rendering.js';
import { beginUndoTransaction, endUndoTransaction, recordAdd, recordModify, recordDelete } from '../core/undo-manager.js';
import { applyAnnotationBatch } from './annotation-batch.js';
import { getPageInfoForDocument, readPageContentForDocument, renderPageTileForDocument } from './page-access.js';
import { extractPageGeometry } from '../tools/pdf-snap-extractor.js';
import { schaalOpPunt } from '../annotations/schaal-op-punt.js';
import { getScaleFromRegion } from '../annotations/scale-region.js';
import { createRoot, createEffect } from 'solid-js';

export function createPluginApi(pluginId) {
  const registeredTypes = [];
  const registeredPalettes = [];
  const registeredPanels = [];
  const registeredSelectionListeners = []; // [{typeName, fn}]
  const documentListeners = new Map();
  let disposeDocumentEvents = null;

  function ensureDocumentEvents() {
    if (disposeDocumentEvents) return;
    let previous = null;
    createRoot(dispose => {
      disposeDocumentEvents = dispose;
      createEffect(() => {
        const doc = getActiveDocument();
        const documentId = doc?.id ?? null;
        const page = doc?.currentPage ?? null;
        const scale = doc ? JSON.stringify({
          documentScale: doc.measureScale,
          calibratedAnnotations: (doc.annotations || [])
            .filter(a => ['scaleRegion', 'scaleBar', 'viewport'].includes(a.type))
            .map(a => [a.id, a.page, a.x, a.y, a.width, a.height, a.scaleString, a.pixelsPerUnit, a.unit]),
        }) : null;
        const current = { documentId, page, scale };
        if (previous) {
          if (previous.documentId !== documentId) emit('documentChanged', { documentId });
          if (previous.documentId !== documentId || previous.page !== page) emit('pageChanged', { documentId, page });
          if (previous.documentId !== documentId || previous.scale !== scale) emit('scaleChanged', { documentId });
        }
        previous = current;
      });
    });
  }

  function emit(type, event) {
    for (const listener of documentListeners.get(type) || []) {
      try { listener(event); } catch (error) { console.warn(`[plugin] ${type} listener failed`, error); }
    }
  }

  return {
    pluginId,

    // --- Feature flags ---
    // Plugins can feature-detect optional fork capabilities, e.g.:
    //   if (api.features?.toolGroups === true) { ... }
    // Adding a flag here is the contract for opting plugins into a feature
    // without breaking older OPPS builds that lack it.
    features: {
      toolGroups: true,
      annotationBatch: true,
      pageAnalysis: true,
      pluginDocumentEvents: true,
    },

    // --- Annotation type registration ---
    registerAnnotationType(typeName, handler) {
      const prefixedName = typeName;
      registerAnnotationType(prefixedName, handler);
      registeredTypes.push(prefixedName);
    },

    unregisterAnnotationType(typeName) {
      unregisterAnnotationType(typeName);
      const idx = registeredTypes.indexOf(typeName);
      if (idx >= 0) registeredTypes.splice(idx, 1);
    },

    // --- Tool palette registration ---
    registerToolPalette(descriptor) {
      registerToolPalette(descriptor);
      registeredPalettes.push(descriptor.id);
    },

    unregisterToolPalette(id) {
      unregisterToolPalette(id);
      const idx = registeredPalettes.indexOf(id);
      if (idx >= 0) registeredPalettes.splice(idx, 1);
    },

    // --- Property panel registration (custom edit-form for plugin annotations) ---
    registerPropertyPanel(typeName, renderFn) {
      _registerPropertyPanel(typeName, renderFn);
      registeredPanels.push(typeName);
    },

    unregisterPropertyPanel(typeName) {
      _unregisterPropertyPanel(typeName);
      const idx = registeredPanels.indexOf(typeName);
      if (idx >= 0) registeredPanels.splice(idx, 1);
    },

    // --- Selection listener (direct selection-event channel for plugin annotations) ---
    // Listener fires with `annotation` on select and `null` on deselect. Plugins
    // should compare by stable id (not ref) since OPPS may reload annotation refs.
    registerSelectionListener(typeName, fn) {
      _registerSelectionListener(typeName, fn);
      registeredSelectionListeners.push({ typeName, fn });
    },

    unregisterSelectionListener(typeName, fn) {
      _unregisterSelectionListener(typeName, fn);
      const idx = registeredSelectionListeners.findIndex(e => e.typeName === typeName && e.fn === fn);
      if (idx >= 0) registeredSelectionListeners.splice(idx, 1);
    },

    // --- Native property-panel visibility ---
    // Plugin can hide OPPS' native eigenschappen-paneel during plugin-annotation
    // editing so all controls live in the plugin's own palette/UI.
    // Pass false to hide, true to restore. Caller is responsible for restoring on deselect.
    setNativePanelVisible(visible) {
      setNativePanelHidden(!visible);
    },

    // --- Tool management ---
    setTool(toolName) {
      setTool(toolName);
    },

    setToolOverrides(overrides) {
      state.toolOverrides = overrides;
    },

    // --- State access (read-only helpers) ---
    getPreferences() {
      return state.preferences;
    },

    getCurrentTool() {
      return state.currentTool;
    },

    getCurrentPage() {
      const doc = getActiveDocument();
      return doc ? doc.currentPage : 1;
    },

    /**
     * Returns the active document's annotation array (read-only snapshot).
     * Plugins use this for analytics-style widgets (counts, dashboards) that
     * need to inspect existing annotations without subscribing to every
     * mutation. Polling is expected — the returned array is the live store
     * reference, so plugins must not mutate it.
     *
     * Each annotation has a `page` field (1-indexed). When no document is
     * open, returns []. The activeDocument's `numPages` (page-count) can be
     * derived via `getPageCount()`.
     */
    getAnnotations() {
      const doc = getActiveDocument();
      return doc && Array.isArray(doc.annotations) ? doc.annotations : [];
    },

    /**
     * Returns the active document's total page-count (>= 1) or 0 if no
     * document is open. Combined with `getAnnotations()` and `getCurrentPage()`
     * this gives plugins everything they need for per-page analytics.
     */
    getPageCount() {
      const doc = getActiveDocument();
      if (!doc) return 0;
      // Prefer numPages (canonical), fallback to pdfDoc.numPages, otherwise 0.
      if (typeof doc.numPages === 'number' && doc.numPages > 0) return doc.numPages;
      const pdfDoc = doc.pdfDoc;
      if (pdfDoc && typeof pdfDoc.numPages === 'number' && pdfDoc.numPages > 0) {
        return pdfDoc.numPages;
      }
      return 0;
    },

    // --- Annotation helpers ---
    createAnnotation(props) {
      return createAnnotation(props);
    },

    getDocumentInfo() {
      const doc = getActiveDocument();
      return doc ? { id: doc.id, pageCount: doc.numPages || doc.pdfDoc?.numPages || 0, currentPage: doc.currentPage,
        name: doc.fileName || null } : null;
    },

    getPageInfo(pageNum, options = {}) {
      const doc = getActiveDocument();
      return getPageInfoForDocument(doc, pageNum, {
        ...options, rotation: getPageRotation(pageNum), isCurrent: candidate => getActiveDocument() === candidate,
      });
    },

    getScaleAt(pageNum, x, y) {
      const doc = getActiveDocument();
      if (!doc || !Number.isInteger(pageNum) || pageNum < 1 || pageNum > (doc.numPages || doc.pdfDoc?.numPages || 0) ||
          !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const scale = getScaleFromRegion(pageNum, x, y) || schaalOpPunt(doc, pageNum, x, y);
      return scale && Number.isFinite(scale.pixelsPerUnit) && scale.pixelsPerUnit > 0 ? { ...scale } : null;
    },

    readPageContent(pageNum, options = {}) {
      const doc = getActiveDocument();
      return readPageContentForDocument(doc, pageNum, {
        ...options, rotation: getPageRotation(pageNum), isCurrent: candidate => getActiveDocument() === candidate,
        extractVectors: (page, request) => extractPageGeometry(page, request),
      });
    },

    renderPageTile(pageNum, rect, options = {}) {
      const doc = getActiveDocument();
      return renderPageTileForDocument(doc, pageNum, rect, {
        ...options, rotation: getPageRotation(pageNum), isCurrent: candidate => getActiveDocument() === candidate,
      });
    },

    onDocumentEvent(type, listener) {
      if (!['documentChanged', 'pageChanged', 'scaleChanged'].includes(type) || typeof listener !== 'function') {
        throw new TypeError('Unsupported document event or listener');
      }
      let listeners = documentListeners.get(type);
      if (!listeners) { listeners = new Set(); documentListeners.set(type, listeners); }
      listeners.add(listener);
      ensureDocumentEvents();
      return () => listeners.delete(listener);
    },

    async waitForPageAnnotations(pageNum, options = {}) {
      const doc = getActiveDocument();
      const pageCount = doc?.numPages || doc?.pdfDoc?.numPages || 0;
      if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pageCount) throw new RangeError('Invalid document page');
      const checkActive = () => {
        if (options.signal?.aborted || getActiveDocument() !== doc) {
          throw new DOMException('Page annotation load aborted', 'AbortError');
        }
      };
      checkActive();
      const { ensureAnnotationsForPage } = await import('../pdf/loader.js');
      checkActive();
      await ensureAnnotationsForPage(pageNum, doc);
      const started = Date.now();
      while (!doc._annotationPagesReady?.has(pageNum)) {
        checkActive();
        if (Date.now() - started > 30_000) throw new Error('Timed out waiting for page annotations');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      checkActive();
      return doc.annotations.filter(annotation => annotation.page === pageNum)
        .map(annotation => JSON.parse(JSON.stringify(annotation)));
    },

    /** Apply create/update/delete operations atomically with one undo step. */
    applyAnnotationBatch(operations) {
      return applyAnnotationBatch(getActiveDocument(), operations, {
        createAnnotation, beginUndoTransaction, endUndoTransaction,
        recordAdd, recordModify, recordDelete, redraw: redrawAnnotations,
      });
    },

    redrawAnnotations() {
      redrawAnnotations();
    },

    // --- Cleanup (called by plugin-manager on deactivate) ---
    _cleanup() {
      registeredTypes.forEach(t => unregisterAnnotationType(t));
      registeredPalettes.forEach(id => unregisterToolPalette(id));
      registeredPanels.forEach(t => _unregisterPropertyPanel(t));
      registeredSelectionListeners.forEach(({ typeName, fn }) => _unregisterSelectionListener(typeName, fn));
      // Restore native panel visibility on plugin-deactivate so the host UI returns to default.
      setNativePanelHidden(false);
      // Reset tool-group sub-tool selections so a fresh activate starts clean.
      clearAllToolGroups();
      registeredTypes.length = 0;
      registeredPalettes.length = 0;
      registeredPanels.length = 0;
      registeredSelectionListeners.length = 0;
      disposeDocumentEvents?.();
      disposeDocumentEvents = null;
      documentListeners.clear();
    }
  };
}
