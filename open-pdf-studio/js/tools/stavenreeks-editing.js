// Inline bewerken van AANTAL en DIAMETER op een stavenreeks.
//
// Aangeroepen vanuit de dubbelklik-afhandeling in tool-dispatcher.js. Het
// venstertje zelf is een SolidJS-component (StavenreeksInlineEditor.jsx); dit
// bestand rekent de schermpositie uit, levert de bevestig-/annuleer-callbacks
// en bewaakt het opruimen.
//
// UNDO: bevestigen loopt via updateAnnotProp() — exact hetzelfde pad als het
// eigenschappen-paneel. Dat roept recordPropertyChange() aan, dat wijzigingen
// aan DEZELFDE annotatie coalesceert tot één undo-stap; twee opeenvolgende
// aanroepen (aantal + diameter) leveren dus samen één Ctrl+Z. Er is bewust
// GEEN tweede undo-mechanisme voor deze invoer.
import { getActiveDocument } from '../core/state.js';
import { annotationCanvas } from '../ui/dom-elements.js';
import { viewport as vpState } from '../pdf/pdf-viewport.js';
import {
  buildStavenreeks, resolveParams,
  sanitizeCountInput, sanitizeDiameterInput, sanitizeFontSizeInput,
} from '../annotations/stavenreeks.js';
import { stavenreeksPxPerMm } from '../annotations/stavenreeks-scale.js';
import {
  showStavenreeksInput, hideStavenreeksInput, stavenreeksInputActive,
  updateAnnotProp, storeShowProperties,
} from '../bridge.js';

// De annotatie waarvoor de invoer nu openstaat (null = geen invoer open).
let editingAnnotation = null;

/**
 * Schermpositie (CSS-pixels, position: fixed) van het label van een
 * stavenreeks. Zelfde rekenwijze als tools/text-editing.js:
 *   viewport-modus: canvasRect + offset + pos × zoom
 *   klassieke modus: canvasRect + pos × schaal
 * @returns {{left:number, top:number}|null}
 */
function labelScreenPos(ann) {
  // Doorlopende weergave: reken tegen het canvas van de PAGINA van de
  // annotatie (scherm = paginacanvas-rect + pos × doc.scale). Het enkelpagina-
  // canvas is daar 0×0 op de vensteroorsprong, en het viewport-singleton
  // (vpState) blijft na een moduswissel 'active' met stale zoom/offsets.
  const doc = getActiveDocument();
  const isContinuous = doc?.viewMode === 'continuous';
  let canvas = null;
  if (isContinuous) {
    canvas = document.querySelector(
      `.page-wrapper[data-page="${ann.page}"] .annotation-canvas`);
  }
  if (!canvas) canvas = annotationCanvas || document.getElementById('annotation-canvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const useViewport = !isContinuous && vpState && vpState.active;
  const scale = useViewport ? vpState.zoom : (doc?.scale || 1.5);
  const offX = useViewport ? vpState.offsetX : 0;
  const offY = useViewport ? vpState.offsetY : 0;
  const geom = buildStavenreeks(ann, { pxPerMm: stavenreeksPxPerMm(ann) });
  // Net onder het label, zodat het venstertje de reeks zelf niet afdekt.
  return {
    left: rect.left + offX + geom.label.x * scale,
    top: rect.top + offY + geom.label.y * scale + 10,
  };
}

/** Staat de annotatie nog in het actieve document? */
function stillAlive(ann) {
  const doc = getActiveDocument();
  if (!doc || !Array.isArray(doc.annotations)) return false;
  return doc.annotations.includes(ann);
}

/**
 * Open de inline invoer op een stavenreeks.
 * Vereist dat het eigenschappen-paneel deze annotatie al toont (de dispatcher
 * roept showProperties() vlak ervoor aan) — updateAnnotProp schrijft immers
 * naar de annotatie die de paneelstore als 'huidige' kent.
 */
export function startStavenreeksInput(annotation) {
  if (!annotation || annotation.type !== 'stavenreeks') return;
  if (annotation.locked) return;
  // Al open voor dezelfde annotatie? Niets doen (dubbel afvurende handlers).
  if (editingAnnotation === annotation && stavenreeksInputActive()) return;
  if (editingAnnotation) cancelStavenreeksInput();

  const pos = labelScreenPos(annotation);
  if (!pos) return;

  editingAnnotation = annotation;
  const params = resolveParams(annotation);

  showStavenreeksInput({
    anchor: pos,
    count: params.count,
    diameter: params.diameter,
    fontSize: params.fontSize,
    // Elke frame opgevraagd door de component: meebewegen met zoom/pan, en
    // null zodra de annotatie is verdwenen (verwijderd of ander document).
    locate: () => {
      if (!editingAnnotation || !stillAlive(editingAnnotation)) return null;
      return labelScreenPos(editingAnnotation);
    },
    commit: (rawCount, rawDiameter, rawFontSize) => {
      const ann = editingAnnotation;
      editingAnnotation = null;
      if (!ann || !stillAlive(ann) || ann.locked) return;
      const cur = resolveParams(ann);
      const count = sanitizeCountInput(rawCount, cur.count);
      const diameter = sanitizeDiameterInput(rawDiameter, cur.diameter);
      const fontSize = sanitizeFontSizeInput(rawFontSize, cur.fontSize);
      // Zelfde pad als het paneel → één gecoalesceerde undo-stap, en de
      // paneelvelden lopen automatisch mee.
      if (count !== cur.count) updateAnnotProp('srCount', count);
      if (diameter !== cur.diameter) updateAnnotProp('srDiameter', diameter);
      if (fontSize !== cur.fontSize) updateAnnotProp('srFontSize', fontSize);
      storeShowProperties(ann);
    },
    cancel: () => { editingAnnotation = null; },
  });
}

/** Sluit de invoer zonder de waarden toe te passen. */
export function cancelStavenreeksInput() {
  if (!editingAnnotation && !stavenreeksInputActive()) return;
  editingAnnotation = null;
  hideStavenreeksInput();
}

/** Staat er op dit moment een inline invoer open? */
export function isStavenreeksInputOpen() {
  return !!editingAnnotation && stavenreeksInputActive();
}
