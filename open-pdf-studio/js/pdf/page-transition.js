// Instant page-transition placeholder.
//
// Problem: navigating to a not-yet-visited page runs a cold render
// (analyze_page_type + extract_draw_commands + prepareImages via Rust IPC)
// BEFORE the new page's pixels appear. During that window the OLD page stays
// frozen on screen, so a sidebar-thumbnail click feels laggy.
//
// Fix: the moment we navigate, paint the target page's ALREADY-rendered
// sidebar thumbnail (a cached data-URL) scaled up as an overlay on top of the
// PDF canvas. The user sees the new page instantly (blurry); the crisp render
// swaps in underneath and we hide the overlay one frame after renderPage()
// resolves. This is engine-agnostic — it never touches the pdf-viewport RAF
// loop that owns #pdf-canvas, so vector/raster/blank paths all benefit.

import { thumbnailData } from '../solid/stores/panels/thumbnailStore.js';
import { weergaveRotatie } from './weergave-ruimte.js';

const OVERLAY_ID = 'page-transition-placeholder';

// Generation counter: each showPagePlaceholder() bumps it and returns the new
// value. hidePagePlaceholder(gen) only hides when gen is still current, so a
// slow renderPage() that resolves AFTER the user already navigated again can't
// rip away the newer page's placeholder.
let _gen = 0;
let _el = null;

function _ensureOverlay(parent) {
  if (_el && _el.parentElement === parent) return _el;
  // Re-create if missing or re-parented (tab switch can rebuild the DOM).
  _el = document.getElementById(OVERLAY_ID);
  if (!_el) {
    _el = document.createElement('img');
    _el.id = OVERLAY_ID;
    _el.alt = '';
    _el.draggable = false;
    // object-fit: contain → the page-aspect thumbnail letterboxes exactly the
    // way the real page is centred inside the viewport canvas, so the
    // placeholder lands roughly where the crisp page will be.
    _el.style.cssText =
      'position:absolute;display:none;pointer-events:none;z-index:5;' +
      'object-fit:contain;background:#ffffff;image-rendering:auto;';
  }
  if (_el.parentElement !== parent) parent.appendChild(_el);
  return _el;
}

// Show the cached thumbnail for `pageNum` as an instant placeholder over the
// PDF canvas. Returns a generation token to pass to hidePagePlaceholder().
// If no thumbnail is cached yet (e.g. a far-page jump the sidebar hasn't
// reached), shows nothing — the caller's render proceeds as before.
export function showPagePlaceholder(pageNum) {
  const myGen = ++_gen;
  try {
    const src = thumbnailData[String(pageNum)];
    const canvas = document.getElementById('pdf-canvas');
    if (!src || !canvas || !canvas.parentElement) return myGen;

    const el = _ensureOverlay(canvas.parentElement);
    el.src = src;
    // Cover the canvas exactly. annotation-canvas / textLayer are positioned
    // siblings of pdf-canvas in the same offset parent, so matching the
    // canvas's offset box aligns the overlay over the whole page area.
    // De miniatuur staat zoals het document; bij een gedraaide weergave (#200)
    // het beeld meedraaien: bij een kwartslag een vak met verwisselde maten,
    // rond zijn midden gedraaid, zodat het weer precies het canvas dekt.
    const r = weergaveRotatie();
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const kwart = r === 90 || r === 270;
    const vakW = kwart ? h : w;
    const vakH = kwart ? w : h;
    el.style.left = (canvas.offsetLeft + (w - vakW) / 2) + 'px';
    el.style.top = (canvas.offsetTop + (h - vakH) / 2) + 'px';
    el.style.width = vakW + 'px';
    el.style.height = vakH + 'px';
    el.style.transform = r ? `rotate(${r}deg)` : '';
    el.style.display = 'block';
  } catch (e) {
    console.warn('[page-transition] show failed:', e);
  }
  return myGen;
}

// Hide the placeholder — but only if `gen` is still the latest navigation.
export function hidePagePlaceholder(gen) {
  if (gen !== _gen) return; // a newer navigation owns the overlay now
  if (_el) _el.style.display = 'none';
}

// Hide once the REAL page content has actually painted — not merely when
// renderPage() resolved. Raster pages fill their bitmap asynchronously (AFTER
// renderPage returns), so hiding on resolve would flash a blank canvas between
// the placeholder and the bitmap; we wait for viewport.currentBitmap. Vector
// pages paint from draw-commands during renderPage, so they're ready at once.
// Safety-capped so a slow/failed bitmap can never leave the placeholder stuck.
export function hidePagePlaceholderWhenReady(gen) {
  if (gen !== _gen) return;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const start = now();
  const CAP_MS = 3000;
  const step = () => {
    if (gen !== _gen) return; // a newer navigation took over
    const vp = (typeof window !== 'undefined') ? window.__pdfViewport : null;
    const contentReady = !vp || vp.pageType !== 'raster' || !!vp.currentBitmap;
    if (contentReady || (now() - start) > CAP_MS) {
      if (_el && gen === _gen) _el.style.display = 'none';
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Drop the overlay entirely (document close / tab teardown).
export function clearPagePlaceholder() {
  _gen++;
  if (_el) {
    _el.removeAttribute('src');
    _el.style.display = 'none';
  }
}
