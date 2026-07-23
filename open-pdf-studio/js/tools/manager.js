import { state, getActiveDocument } from '../core/state.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { updateStatusTool } from '../ui/chrome/status-bar.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { getTool } from './tool-registry.js';
import { buildToolContext, resolvePointerCoords } from './tool-context.js';
import { findAnnotationAt } from '../annotations/geometry.js';
import { findHandleAt } from '../annotations/handles.js';
import { cancelParametricSymbolInput } from './parametric-symbol-editing.js';

// Tools that are always allowed (view-only, non-modifying)
const READONLY_ALLOWED_TOOLS = new Set(['select', 'hand']);
let toolDefaultsRequestToken = 0;

// Get cursor for a given tool
export function getCursorForTool(tool = state.currentTool) {
  switch (tool) {
    case 'select':
      return 'default';  // Arrow cursor for unified selection
    case 'hand':
      return 'grab';
    case 'text':
    case 'editText':
      return 'text';
    default: {
      const typeHandler = getAnnotationType(tool);
      return (typeHandler && typeHandler.cursor) || 'crosshair';
    }
  }
}

// NOTE: cursor management is now centralized in js/ui/cursor.js (reactive
// memo derived from app state). Tools and the dispatcher write state — they
// never set element.style.cursor. The setAllCanvasCursors helper that used
// to live here has been removed; setTool() below clears hover state instead.

// Enable or disable text selection based on current tool.
// Stacking: textLayer (z:5) < annotation-canvas (z:6) < formLayer (z:7) < linkLayer (z:10)
function setTextSelectionEnabled(enabled) {
  const textLayers = document.querySelectorAll('.textLayer');
  textLayers.forEach(layer => {
    // When enabled, the layer needs pointer-events: auto so native drag-to-select
    // works across span boundaries.  When disabled, pointer-events: none lets clicks
    // fall through to the annotation canvas.
    layer.style.pointerEvents = enabled ? 'auto' : 'none';
    const spans = layer.querySelectorAll('span');
    spans.forEach(span => {
      span.style.pointerEvents = enabled ? 'auto' : 'none';
      span.style.cursor = enabled ? 'text' : 'default';
    });
  });
}

// Dynamic fall-through for the unified select tool: when hovering body text (no
// annotation under the cursor), drop annotation-canvas pointer-events so the
// textLayer beneath it receives the events and native text selection works.
// When over an annotation, restore pointer-events: auto so clicks select it.
let _selectFallthroughInstalled = false;
let _selectFallthroughHandler = null;

function _setSelectFallthroughEnabled(enabled) {
  if (enabled && !_selectFallthroughInstalled) {
    _selectFallthroughHandler = (e) => {
      // Bail out if select tool isn't active anymore
      if (state.currentTool !== 'select') return;
      // Image-crop mode owns the annotation-canvas pointer events (its own
      // overlay handlers drive the crop handles) — keep it interactive.
      if (state.imageCropMode) {
        const cropCanvas = document.getElementById('annotation-canvas') ||
                           document.querySelector('.annotation-canvas');
        if (cropCanvas && cropCanvas.style.pointerEvents !== 'auto') cropCanvas.style.pointerEvents = 'auto';
        return;
      }
      // Don't toggle while interacting — keep canvas interactive during drag/resize/rubber band
      if (state.isDragging || state.isResizing || state.isRubberBanding ||
          state.isPanning || state.isDrawing || state.isEditingText) return;

      // While the marquee is "armed" (user just clicked the Select ribbon
      // button), force the annotation-canvas to receive pointer events so the
      // next pointerdown reaches select-tool no matter where it lands.
      if (state.armedMarquee) {
        const canvas2 = document.getElementById('annotation-canvas') ||
                        document.querySelector('.annotation-canvas');
        if (canvas2 && canvas2.style.pointerEvents !== 'auto') canvas2.style.pointerEvents = 'auto';
        return;
      }

      const canvas = document.getElementById('annotation-canvas') ||
                     document.querySelector('.annotation-canvas');
      if (!canvas || !canvas.getBoundingClientRect) return;

      // Resolve app-space coords using the same logic as resolvePointerCoords
      const doc = getActiveDocument();
      if (!doc?.pdfDoc) return;
      const scale = doc.scale || 1.5;
      const rect = canvas.getBoundingClientRect();

      // Only act when cursor is over the page area (or text layer / canvas)
      const insidePageArea = e.clientX >= rect.left && e.clientX <= rect.right &&
                             e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!insidePageArea) return;

      let appX, appY;
      const vp = window.__pdfViewport;
      // Blank docs bypass the viewport — same guard as resolvePointerCoords.
      const _useVp = vp && vp.active && doc?.filePath;
      if (_useVp) {
        appX = (e.clientX - rect.left - vp.offsetX) / vp.zoom;
        appY = (e.clientY - rect.top - vp.offsetY) / vp.zoom;
      } else {
        appX = (e.clientX - rect.left) / scale;
        appY = (e.clientY - rect.top) / scale;
      }

      const ann = findAnnotationAt(appX, appY);
      let overAnnotation = !!ann;

      // Also treat resize/rotate handles of the (single) selected annotation
      // as "over annotation" — handles can sit OUTSIDE the annotation rect
      // (corner, rotate, edge handles), and without this check the
      // annotation-canvas pointerEvents flips to 'none' as the cursor
      // approaches the handle, blocking resize/rotate clicks entirely.
      if (!overAnnotation) {
        const selAnns = doc.selectedAnnotations || [];
        if (selAnns.length === 1) {
          const effScale = _useVp ? vp.zoom : scale;
          const handleHit = findHandleAt(appX, appY, selAnns[0], effScale);
          if (handleHit) overAnnotation = true;
        }
      }

      // Toggle annotation-canvas pointer-events so events fall through to text layer
      // when no annotation is under the cursor.
      const desired = overAnnotation ? 'auto' : 'none';
      if (canvas.style.pointerEvents !== desired) {
        canvas.style.pointerEvents = desired;
      }

      // Keep the text layer interactive whenever we're falling through.
      const textLayers = document.querySelectorAll('.textLayer');
      textLayers.forEach(layer => {
        const layerPE = overAnnotation ? 'none' : 'auto';
        if (layer.style.pointerEvents !== layerPE) {
          layer.style.pointerEvents = layerPE;
        }
        layer.querySelectorAll('span').forEach(span => {
          if (span.style.pointerEvents !== layerPE) span.style.pointerEvents = layerPE;
          const cur = overAnnotation ? '' : 'text';
          if (span.style.cursor !== cur) span.style.cursor = cur;
        });
      });
    };
    document.addEventListener('mousemove', _selectFallthroughHandler, true);
    _selectFallthroughInstalled = true;
  } else if (!enabled && _selectFallthroughInstalled) {
    if (_selectFallthroughHandler) {
      document.removeEventListener('mousemove', _selectFallthroughHandler, true);
    }
    _selectFallthroughHandler = null;
    _selectFallthroughInstalled = false;
    // NOTE: Do NOT touch annotation-canvas pointer-events here. The caller
    // (setTool) has already configured the correct stacking for the new tool
    // via setAnnotationCanvasForTextAccess(). For editText we need pe:none on
    // the canvas — re-enabling it here would clobber that and (combined with
    // stale pe:none on the textLayer left over from the last fallthrough
    // mousemove) prevent text-edit clicks from reaching the span listeners.
    //
    // Also reset any per-element pointer-events the fallthrough handler may
    // have written on the textLayer/spans during select mode, so the next
    // tool starts from a clean slate. enableTextLayerHover() (for editText)
    // and setTextSelectionEnabled() (for other tools) will re-apply the
    // values they need.
    document.querySelectorAll('.textLayer').forEach(layer => {
      layer.style.pointerEvents = '';
      layer.querySelectorAll('span').forEach(span => {
        span.style.pointerEvents = '';
        span.style.cursor = '';
      });
    });
  }
}

// Configure layer stacking for tools that need text layer access (select, editText).
// Drops annotation canvas below text layer, disables its pointer-events, and disables
// form/link pointer events (they sit above the text layer and would intercept events).
// Centralised here to avoid race conditions with async tool deactivation.
function setAnnotationCanvasForTextAccess(enabled) {
  document.querySelectorAll('#annotation-canvas, .annotation-canvas').forEach(el => {
    el.style.zIndex = enabled ? '2' : '6';
    el.style.pointerEvents = enabled ? 'none' : 'auto';
  });
  document.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
    el.style.pointerEvents = enabled ? 'none' : '';
  });
}

// Some tools call setTool('select') after committing one annotation. With
// `keepToolActive=true` (default) the tool stays active so the user can place
// multiple shapes in a row without re-clicking the toolbar. AutoCAD-style.
// Esc returns to select-tool. Tools should call this helper instead of setTool('select') directly.
export function maybeRevertToSelect() {
  if (state.preferences?.keepToolActive !== false) return;
  setTool('select');
}

// Set current tool
export function setTool(tool) {
  // Block annotation tools when PDF/A read-only is active
  if (isPdfAReadOnly() && !READONLY_ALLOWED_TOOLS.has(tool)) {
    return;
  }

  // Deactivate the current tool via lifecycle
  if (state.currentTool !== tool) {
    const currentToolObj = getTool(state.currentTool);
    if (currentToolObj && currentToolObj.onDeactivate) {
      // Build a minimal context for deactivation
      const redraw = () => { if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous(); else redrawAnnotations(); };
      const ctx = { state, redraw, redrawAnnotations, redrawContinuous };
      currentToolObj.onDeactivate(ctx);
    }
  }

  // Openstaande inline invoer hoort niet te blijven zweven wanneer de
  // gebruiker van gereedschap wisselt. Parametrische invoer moet synchroon
  // sluiten: de window-click van de editor volgt pas na deze toolhandler.
  import('./stavenreeks-editing.js').then(m => m.cancelStavenreeksInput()).catch(() => {});
  cancelParametricSymbolInput();

  // Deactivate PDF text editing when switching away
  if (state.currentTool === 'editText' && tool !== 'editText') {
    import('./text-edit-tool.js').then(m => m.deactivateEditTextTool());
  }

  state.currentTool = tool;
  const defaultsRequest = ++toolDefaultsRequestToken;
  const isCurrentDefaultsRequest = () =>
    defaultsRequest === toolDefaultsRequestToken && state.currentTool === tool;
  // Don't clear toolOverrides when switching TO stamp or wall — the
  // SymbolPalette sets them (stamp SVG / wall material+dikte) before setTool.
  if (tool !== 'stamp' && tool !== 'wall') {
    state.toolOverrides = null;
  }

  // Reset hover state so a stale hover from the previous tool doesn't keep
  // showing its cursor under the new tool. The reactive cursor module
  // (js/ui/cursor.js) will pick up state.currentTool and recompute.
  state.hoverAnnotation = null;
  state.hoverHandle = null;
  // Also reset interaction state — without this, isPanning left over from
  // the Hand tool (or any pointerup that missed the canvas) keeps the
  // cursor stuck on 'grabbing' (= the "handje") even after switching to
  // a drawing tool.
  state.isPanning = false;
  state.isMiddleButtonPanning = false;
  state.isDragging = false;
  state.isResizing = false;
  state.activeHandle = null;
  state.dragCursor = null;

  // CRITICAL: clear any INLINE cursor that previous tools (especially
  // hand-tool) wrote directly to canvas elements. The reactive cursor
  // module sets cursor on .main-view, but child canvases with inline
  // style.cursor override the parent — so without this clear, the
  // 'grab' cursor from hand-tool stays visible on top of the new
  // tool's crosshair. Resetting to '' makes them inherit from .main-view.
  //
  // Also: when a DRAWING tool is active, suppress link-layer + form-layer
  // events. linkLayer sits at z-index 10 (above annotation-canvas z:6)
  // and applies `cursor: pointer` (= the "handje" the user sees) when
  // hovering over a hyperlink. That cursor wins over the tool's crosshair
  // because the link element is on top. Same for form fields. Disabling
  // pointer-events on those layers makes hovers fall through to
  // annotation-canvas where the tool cursor applies.
  try {
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (pdfCanvas) pdfCanvas.style.cursor = '';
    document.querySelectorAll('.annotation-canvas, #annotation-canvas')
      .forEach(c => { c.style.cursor = ''; });

    const isDrawTool = tool !== 'select' && tool !== 'hand'
                    && tool !== 'editText' && tool !== 'selectComments';
    const linkPe = isDrawTool ? 'none' : '';
    document.querySelectorAll('.linkLayer .pdf-link').forEach(el => {
      el.style.pointerEvents = linkPe;
      el.style.cursor = isDrawTool ? 'inherit' : '';
    });
    document.querySelectorAll('.formLayer section').forEach(el => {
      el.style.pointerEvents = linkPe;
    });
  } catch (_) { /* DOM not ready yet */ }

  // When switching to a drawing tool that has style preferences,
  // populate the properties panel with the tool's current defaults
  // (synthetic annotation) so the user can see them BEFORE drawing.
  // Otherwise hide the panel (e.g. hand, editText). Select keeps its
  // own state (selected annotation or none).
  if (tool === 'select') {
    import('../solid/stores/propertiesStore.js')
      .then((propStore) => {
        if (isCurrentDefaultsRequest()) propStore.hideToolDefaults?.();
      })
      .catch(() => {});
  } else {
    (async () => {
      try {
        if (tool === 'parametricSymbol') {
          const symbolStore = await import('../solid/stores/parametricSymbolStore.js');
          const propStore = await import('../solid/stores/propertiesStore.js');
          if (!isCurrentDefaultsRequest()) return;
          await propStore.showToolDefaults(tool, {
            symbolId: symbolStore.pendingSymbolId(),
            params: symbolStore.pendingParams(),
          }, isCurrentDefaultsRequest);
          return;
        }
        const prefMod = await import('../core/preferences.js');
        if (!isCurrentDefaultsRequest()) return;
        const hasStyle = prefMod && typeof prefMod.getStyleMapping === 'function'
          && prefMod.getStyleMapping(tool) != null;
        if (hasStyle) {
          const propMod = await import('../solid/stores/propertiesStore.js');
          if (!isCurrentDefaultsRequest()) return;
          if (propMod && typeof propMod.showToolDefaults === 'function') {
            await propMod.showToolDefaults(tool, {}, isCurrentDefaultsRequest);
            return;
          }
        }
      } catch (_) { /* fall through to hide */ }
      if (isCurrentDefaultsRequest()) hideProperties();
    })();
  }

  // Text selection: enabled for unified select tool (text layer activates dynamically)
  if (tool !== 'editText') {
    setTextSelectionEnabled(tool === 'select');
  }

  // Activate edit text tool layer management
  if (tool === 'editText') {
    import('./text-edit-tool.js').then(m => m.activateEditTextTool());
  }

  // Drop annotation canvas below text layer ONLY for editText tool
  // select = unified tool (annotation canvas stays above, text layer activates dynamically)
  setAnnotationCanvasForTextAccess(tool === 'editText');

  // Unified select tool: install dynamic pointer-events fall-through so
  // dragging across body text triggers native text selection while clicks
  // on annotations still hit the annotation-canvas.
  _setSelectFallthroughEnabled(tool === 'select');

  // Update status bar
  updateStatusTool();
}

// Enable or disable annotation tool buttons based on PDF/A read-only state
export function updatePdfAToolState() {
  // If locked and current tool is an annotation tool, switch back to select
  if (isPdfAReadOnly() && !READONLY_ALLOWED_TOOLS.has(state.currentTool)) {
    setTool('select');
  }
}

// Reset to hand tool whenever a PDF is loaded (avoids circular dependency with loader.js)
document.addEventListener('pdf-loaded', () => {
  setTool('select');
});
