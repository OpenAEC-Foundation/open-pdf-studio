// Thin Lines view mode (#595): draw every vector stroke of the PAGE as a
// hairline of one device pixel, whatever width the PDF asks for. A pure
// display mode, like a CAD program's line weight display: the PDF itself and
// the annotations' lineWidth values never change.
//
// The page is rendered in Rust (PDFium workers, the in-process fallback and
// the tile scene), so the flag travels with every render command
// (`thinLines`). A page rendered with and without Thin Lines is a different
// picture, so every bitmap cache keys on the flag (thinLinesKey); switching
// back is then a plain cache hit. The annotation overlay reads the same
// preference itself (annotations/rendering.js).

import { state, getActiveDocument } from '../core/state.js';
import { renderEngineOn } from './render-engine.js';

/** Whether Thin Lines is switched on. */
export function thinLinesOn(prefs = state.preferences) {
  return !!(prefs && prefs.thinLines);
}

/** Render-command arguments with the Thin Lines flag added (a copy). */
export function withThinLines(args, thin = thinLinesOn()) {
  return { ...args, thinLines: !!thin };
}

/**
 * Cache-key part for the look a bitmap was rendered in: the line mode and
 * the page engine (#625). PDFium keys are unchanged ('thin' / 'true').
 */
export function thinLinesKey(thin = thinLinesOn(), engine = renderEngineOn()) {
  const lines = thin ? 'thin' : 'true';
  return engine === 'pdfium' ? lines : `${lines}+${engine}`;
}

/**
 * Stroke the current canvas path, as a one-device-pixel hairline when `thin`.
 * Canvas paths are stored in device space when they are built, so dropping
 * the transform just for the stroke keeps the geometry and makes lineWidth 1
 * mean one device pixel.
 */
export function strokeCurrentPath(ctx, thin) {
  if (!thin) {
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function savePreferences() {
  return import('../core/preferences.js')
    .then((m) => m.savePreferences && m.savePreferences())
    .catch(() => {});
}

/**
 * Re-render what is on screen in the current line mode: the annotation
 * overlay, and the page bitmaps of the single-page viewport or the visible
 * pages of the continuous / facing / book view. Pages scrolled into view later
 * pick the mode up by themselves (their cache key changed).
 */
export async function refreshAfterThinLinesChange() {
  const doc = getActiveDocument();
  try {
    const rendering = await import('../annotations/rendering.js');
    if (doc && doc.viewMode === 'continuous') rendering.redrawContinuous && rendering.redrawContinuous();
    else rendering.redrawAnnotations && rendering.redrawAnnotations();
  } catch { /* overlay redraw is best-effort */ }

  if (!doc || !doc.pdfDoc) return;
  const renderer = await import('./renderer.js');
  if (doc.viewMode === 'continuous') {
    await renderer.reRenderVisibleContinuousPages();
    return;
  }
  const { viewport } = await import('./pdf-viewport.js');
  if (viewport.active && viewport.filePath === doc.filePath) {
    if (viewport.pageType === 'raster') {
      const orch = await import('./bitmap-orchestrator.js');
      const canvas = typeof document !== 'undefined' ? document.getElementById('pdf-canvas') : null;
      await Promise.all([
        orch.ensureBitmapForCurrentView(),
        canvas ? orch.ensureTileForCurrentView(canvas) : null,
      ]);
    }
    // The vector replay path reads the preference on every frame.
    viewport.dirty = true;
    return;
  }
  await renderer.renderPage(doc.currentPage || 1);
}

/**
 * Switch Thin Lines on or off: preference, saved preferences and a re-render
 * of the view. Returns false when it was already in that mode (nothing done).
 * `deps` is for tests.
 */
export function setThinLines(on, deps = {}) {
  const prefs = deps.prefs || state.preferences;
  const save = deps.save || savePreferences;
  const refresh = deps.refresh || refreshAfterThinLinesChange;
  const next = !!on;
  if (!prefs || thinLinesOn(prefs) === next) return false;
  prefs.thinLines = next;
  // '[render]' prefix lands in the MCP console ring: observable in tests.
  console.log('[render] thinLines =', next);
  try { save(); } catch { /* saving is best-effort */ }
  const warn = (e) => console.warn('[render] Thin Lines re-render failed:', e);
  try {
    const pending = refresh();
    if (pending && typeof pending.catch === 'function') pending.catch(warn);
  } catch (e) { warn(e); }
  return true;
}

/** Flip Thin Lines (ribbon button, the 'tl' command, Ctrl+5). Returns the new state. */
export function toggleThinLines(deps = {}) {
  const prefs = deps.prefs || state.preferences;
  const next = !thinLinesOn(prefs);
  setThinLines(next, deps);
  return next;
}
