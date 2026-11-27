import { state, getActiveDocument } from '../core/state.js';
import { drawAnnotation } from '../annotations/rendering.js';
import { drawSnapIndicator } from './snap-engine.js';
import { buildAnnotationProps } from './annotation-creators.js';
import { withSymbolInsertFormat } from '../symbols/symbol-insert-format-store.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { applyToolTransform } from './tool-transform.js';
import { previewCtx, redrawForViewMode } from './preview-target.js';

/**
 * Draw a live preview of the shape being created.
 *
 * Uses the same buildAnnotationProps() + drawAnnotation() pipeline as
 * final annotation creation and rendering. This guarantees the preview
 * looks identical to the final result (line widths, arrowhead styles,
 * hatch patterns, border styles, etc.).
 *
 * `doelCtx` is het canvas dat de gebruiker ziet: in de doorlopende weergave
 * het paginacanvas onder de cursor (tool-context geeft het mee), in de enkele
 * pagina de overlay. Zonder doel kiest previewCtx() het (#616).
 */
export function drawShapePreview(currentX, currentY, e, doelCtx = null, tool = state.currentTool) {
  // Het voorbeeld VOOR de basisredraw bouwen: voor de betonbalk doet het
  // voorbeeld als sibling mee (state._previewJoinAnn), zodat bestaande
  // balken hun verstek/open-T al tonen tijdens het tekenen — zie de
  // betonbalk-case in annotations/rendering.js.
  state._isPreview = true;
  let tempAnn;
  try {
    tempAnn = buildAnnotationProps(tool, state.startX, state.startY, currentX, currentY, e);
    // Zelfde opmaak als de plaatsing (invoegsessie voor symbolen, #587).
    tempAnn = withSymbolInsertFormat(tool, tempAnn);
  } finally {
    state._isPreview = false;
  }
  if (tempAnn && tempAnn.type === 'betonbalk') state._previewJoinAnn = tempAnn;
  try {
  // Basis volgens de weergave: in doorlopend wist alleen redrawContinuous()
  // het vorige voorbeeld van het paginacanvas.
  redrawForViewMode();
  const tekenCtx = previewCtx(doelCtx);
  if (!tekenCtx) return;
  const doc = getActiveDocument();
  const vp = window.__pdfViewport;
  // Blank docs (no filePath) bypass the viewport singleton — see
  // tool-context.js for the full rationale.
  const useViewport = vp && vp.active && doc?.filePath;
  tekenCtx.save();
  // Zelfde transform als de annotatieweergave: viewport (zoom + verschuiving)
  // of de oude modus (schaal × dpr), met een gedraaide weergave (#200) erin.
  applyToolTransform(tekenCtx);


  if (tempAnn) {
    drawAnnotation(tekenCtx, tempAnn);
  } else {
    // Fallback: plugin types with custom preview
    const typeHandler = getAnnotationType(tool);
    if (typeHandler && typeHandler.preview) {
      typeHandler.preview(tekenCtx, state.startX, state.startY, currentX, currentY, state, e);
    }
  }

  // Draw snap indicator overlay
  if (state.lastSnapResult && state.lastSnapResult.snapped) {
    const snapScale = useViewport ? vp.zoom : (doc?.scale || 1.5);
    drawSnapIndicator(tekenCtx, state.lastSnapResult, snapScale);
  }

  tekenCtx.restore();
  } finally {
    state._previewJoinAnn = null;
  }
}
