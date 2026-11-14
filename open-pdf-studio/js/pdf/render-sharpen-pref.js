import { state } from '../core/state.js';
import { sharpenRgba, sharpenAmount } from './render-sharpen.js';
import { maakSharpenRoute } from './render-sharpen-route.js';
import { isTauri, isMobile, invoke } from '../core/platform.js';

export function pageSharpenLevel() {
  const n = Number(state.preferences && state.preferences.pageSharpen);
  return Number.isInteger(n) ? n : 0;
}

// Sharpening in Rust on the desktop (render-sharpen-route.js): the render
// funnels ask it for the strength and mark what comes back sharpened.
let route = null;
export function sharpenRoute() {
  if (route) return route;
  // Desktop only: mobile has no PDFium route. Outside a window (tests, the
  // web unit before it is mounted) the question cannot be asked: JS sharpens.
  let desktop = false;
  try { desktop = isTauri() && !isMobile(); } catch { desktop = false; }
  return (route = maakSharpenRoute({
    invoke: desktop ? invoke : null,
    sterkte: () => sharpenAmount(pageSharpenLevel()),
  }));
}

/**
 * Applies the user's page-sharpen level to freshly rendered RGBA, in place.
 * A bitmap the backend sharpened already (rendered with `sharpen: true`) is
 * returned as it is.
 */
export function sharpenPageRgba(rgba, w, h) {
  if (sharpenRoute().isVerscherpt(rgba)) return rgba;
  return sharpenRgba(rgba, w, h, sharpenAmount(pageSharpenLevel()));
}
