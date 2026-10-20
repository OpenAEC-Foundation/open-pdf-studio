// Single source of truth for dispatching whole-page PDF renders to the
// chosen engine. Consults state.renderEngineOverride:
//
//   null         → 'render_pdf_page'      (PDFium, the default)
//   'pdfium'     → 'render_pdf_page'      (PDFium, forced)
//   'rust-skia'  → 'render_pdf_page_skia' (open-pdf-render kernel, alpha)
//
// Used by every caller that does whole-page raster rendering — bitmap-
// orchestrator's ensureBitmap, loader.js cold-open preview, renderer.js
// single-page render. Centralised so the bottom-right engine selector
// affects ALL render paths consistently.
//
// Tile-region rendering (render_pdf_page_region) stays PDFium-only because
// open-pdf-render doesn't have a region renderer yet. The override is
// silently ignored on the tile path; the user-visible engine label still
// reflects the chosen engine for the whole-page bitmap underneath.

import { state } from '../core/state.js';
import { invoke } from '../core/platform.js';
import { thinLinesOn } from './thin-lines.js';
import { renderEngineOn, withPageEngine } from './render-engine.js';

/**
 * Render one whole page via the user-selected engine.
 * `thinLines` (Thin Lines view mode, #595) defaults to the preference; a
 * caller that caches the result passes the flag it keyed the cache on.
 * `engine` (#625) defaults to the page-engine preference, like `thinLines`.
 * @param {{path:string, pageIndex:number, scale:number, rotation?:number, thinLines?:boolean, engine?:'pdfium'|'hayro'}} args
 * @returns {Promise<Uint8Array>} `[w:u32 LE][h:u32 LE][rgba…]` wire format
 */
export async function renderPdfPage({ path, pageIndex, scale, rotation = 0, thinLines = thinLinesOn(), engine = renderEngineOn() }) {
  if (state?.renderEngineOverride === 'rust-skia') {
    return invoke('render_pdf_page_skia', { path, pageIndex, scale, rotation, thinLines: !!thinLines });
  }
  return withPageEngine(engine, path, pageIndex, (eng) =>
    invoke('render_pdf_page', { path, pageIndex, scale, rotation, thinLines: !!thinLines, engine: eng }));
}

/**
 * Diagnostic: which engine WOULD a whole-page render use right now?
 * Useful for status-bar labels and PERF logging without dispatching a
 * render.
 */
export function currentRenderEngine() {
  return (state?.renderEngineOverride === 'rust-skia') ? 'rust-skia' : 'pdfium';
}
