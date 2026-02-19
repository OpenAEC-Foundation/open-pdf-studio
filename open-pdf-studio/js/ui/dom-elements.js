// DOM element references
// All element references are exported for use by other modules
// Deferred initialization: call initDomElements() after Solid render()

// Main containers (live bindings — consumers see updated values after init)
export let placeholder = null;
export let pdfContainer = null;
export let pdfCanvas = null;
export let annotationCanvas = null;
export let continuousContainer = null;
export let canvasContainer = null;

// Properties panel elements — now managed by Solid.js PropertiesPanel component
export const propertiesPanel = null;

// Canvas contexts - initialized after DOM is ready
export let pdfCtx = null;
export let annotationCtx = null;

// Initialize all DOM element references and canvas contexts
export function initDomElements() {
  placeholder = document.getElementById('placeholder');
  pdfContainer = document.getElementById('pdf-container');
  pdfCanvas = document.getElementById('pdf-canvas');
  annotationCanvas = document.getElementById('annotation-canvas');
  continuousContainer = document.getElementById('continuous-container');
  canvasContainer = document.getElementById('canvas-container');

  if (pdfCanvas) {
    pdfCtx = pdfCanvas.getContext('2d');
  }
  if (annotationCanvas) {
    annotationCtx = annotationCanvas.getContext('2d');
  }
}

// Backward compat alias
export const initCanvasContexts = initDomElements;
