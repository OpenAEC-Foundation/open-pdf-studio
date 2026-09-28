import { onCleanup, onMount, createMemo } from 'solid-js';
import { state } from '../../core/state.js';
import { viewport, schermPaginaMaat } from '../../pdf/pdf-viewport.js';

// Optional X/Y scrollbars overlaid on the PDF canvas viewport.
// - Hidden by default (preference `showScrollbars`).
// - Each scrollbar only shown when its axis overflows the canvas.
// - Dragging the thumb pans the viewport (mirrors viewport.offsetX/Y).
// - Does NOT replace existing pan/zoom; this is an additional input.
//
// Paginamaat op het scherm = na paginarotatie én weergaverotatie (#200):
// schermPaginaMaat(), niet de ongedraaide viewport.pageW/pageH.
//
// Implementation note: viewport state is a plain object (not reactive),
// so we drive the bars from a RAF loop that reads viewport every frame
// and updates DOM only when values change.

const SB_SIZE = 14; // Windows-standard scrollbar width

export default function CanvasScrollbars() {
  // Reactive on/off via the SolidJS preferences mutable
  const enabled = createMemo(() => !!state.preferences.showScrollbars);

  let hRef, vRef, hThumbRef, vThumbRef;
  let raf = 0;
  let mounted = false;

  // Drag state
  let dragging = null; // 'h' | 'v' | null
  let dragStartClient = 0;
  let dragStartOffset = 0;
  let dragOverflow = 0;
  let dragTrackPx = 0;
  let dragThumbPx = 0;

  function getCanvasCssSize() {
    const c = document.getElementById('pdf-canvas');
    if (!c) return null;
    const dpr = window.devicePixelRatio || 1;
    return { w: c.width / dpr, h: c.height / dpr };
  }

  function update() {
    if (!mounted) return;
    raf = requestAnimationFrame(update);
    if (!enabled()) return;
    if (!viewport || !viewport.active) {
      if (hRef) hRef.style.display = 'none';
      if (vRef) vRef.style.display = 'none';
      return;
    }
    const css = getCanvasCssSize();
    if (!css) return;
    const pageW = schermPaginaMaat().w * viewport.zoom;
    const pageH = schermPaginaMaat().h * viewport.zoom;

    // Horizontal
    if (pageW > css.w + 0.5) {
      const overflow = pageW - css.w; // total scrollable px
      // offsetX ranges from (css.w - pageW)..0 — we map to 0..overflow
      const scrolled = -viewport.offsetX; // 0 at left edge, overflow at right
      const trackPx = css.w - SB_SIZE; // reserve corner if vertical also shown
      const vVisible = pageH > css.h + 0.5;
      const usableTrack = vVisible ? trackPx : css.w;
      const ratio = css.w / pageW;
      const thumbPx = Math.max(20, usableTrack * ratio);
      const maxThumbStart = usableTrack - thumbPx;
      const thumbStart = overflow > 0 ? (scrolled / overflow) * maxThumbStart : 0;
      hRef.style.display = '';
      hRef.style.right = (vVisible ? SB_SIZE : 0) + 'px';
      hThumbRef.style.width = thumbPx + 'px';
      hThumbRef.style.transform = `translateX(${Math.max(0, Math.min(maxThumbStart, thumbStart))}px)`;
    } else {
      hRef.style.display = 'none';
    }

    // Vertical
    if (pageH > css.h + 0.5) {
      const overflow = pageH - css.h;
      const scrolled = -viewport.offsetY;
      const hVisible = pageW > css.w + 0.5;
      const trackPx = css.h - (hVisible ? SB_SIZE : 0);
      const ratio = css.h / pageH;
      const thumbPx = Math.max(20, trackPx * ratio);
      const maxThumbStart = trackPx - thumbPx;
      const thumbStart = overflow > 0 ? (scrolled / overflow) * maxThumbStart : 0;
      vRef.style.display = '';
      vRef.style.bottom = (hVisible ? SB_SIZE : 0) + 'px';
      vThumbRef.style.height = thumbPx + 'px';
      vThumbRef.style.transform = `translateY(${Math.max(0, Math.min(maxThumbStart, thumbStart))}px)`;
    } else {
      vRef.style.display = 'none';
    }
  }

  function onPointerDown(axis, e) {
    if (!viewport || !viewport.active) return;
    const css = getCanvasCssSize();
    if (!css) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = axis;
    if (axis === 'h') {
      const pageW = schermPaginaMaat().w * viewport.zoom;
      dragOverflow = pageW - css.w;
      const vVisible = (schermPaginaMaat().h * viewport.zoom) > css.h + 0.5;
      dragTrackPx = css.w - (vVisible ? SB_SIZE : 0);
      dragThumbPx = parseFloat(hThumbRef.style.width) || 20;
      dragStartClient = e.clientX;
      dragStartOffset = viewport.offsetX;
    } else {
      const pageH = schermPaginaMaat().h * viewport.zoom;
      dragOverflow = pageH - css.h;
      const hVisible = (schermPaginaMaat().w * viewport.zoom) > css.w + 0.5;
      dragTrackPx = css.h - (hVisible ? SB_SIZE : 0);
      dragThumbPx = parseFloat(vThumbRef.style.height) || 20;
      dragStartClient = e.clientY;
      dragStartOffset = viewport.offsetY;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const usable = Math.max(1, dragTrackPx - dragThumbPx);
    if (dragging === 'h') {
      const dx = e.clientX - dragStartClient;
      const offsetDelta = -(dx / usable) * dragOverflow;
      viewport.offsetX = dragStartOffset + offsetDelta;
      viewport.dirty = true;
    } else {
      const dy = e.clientY - dragStartClient;
      const offsetDelta = -(dy / usable) * dragOverflow;
      viewport.offsetY = dragStartOffset + offsetDelta;
      viewport.dirty = true;
    }
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // Click on track (outside thumb) → page-step toward click
  function onTrackClick(axis, e) {
    if (e.target !== e.currentTarget) return; // only direct track clicks
    if (!viewport || !viewport.active) return;
    const css = getCanvasCssSize();
    if (!css) return;
    if (axis === 'h') {
      const rect = hRef.getBoundingClientRect();
      const click = e.clientX - rect.left;
      const thumbPx = parseFloat(hThumbRef.style.width) || 0;
      const tm = new DOMMatrixReadOnly(getComputedStyle(hThumbRef).transform);
      const thumbStart = tm.m41 || 0;
      const direction = click < thumbStart ? -1 : 1;
      viewport.offsetX += -direction * css.w * 0.9;
      viewport.dirty = true;
    } else {
      const rect = vRef.getBoundingClientRect();
      const click = e.clientY - rect.top;
      const tm = new DOMMatrixReadOnly(getComputedStyle(vThumbRef).transform);
      const thumbStart = tm.m42 || 0;
      const direction = click < thumbStart ? -1 : 1;
      viewport.offsetY += -direction * css.h * 0.9;
      viewport.dirty = true;
    }
  }

  onMount(() => {
    mounted = true;
    raf = requestAnimationFrame(update);
  });

  onCleanup(() => {
    mounted = false;
    if (raf) cancelAnimationFrame(raf);
  });

  return (
    <>
      <div
        ref={hRef}
        class="canvas-scrollbar canvas-scrollbar-h"
        style={{ display: 'none' }}
        onPointerDown={(e) => onTrackClick('h', e)}
      >
        <div
          ref={hThumbRef}
          class="canvas-scrollbar-thumb"
          onPointerDown={(e) => onPointerDown('h', e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      <div
        ref={vRef}
        class="canvas-scrollbar canvas-scrollbar-v"
        style={{ display: 'none' }}
        onPointerDown={(e) => onTrackClick('v', e)}
      >
        <div
          ref={vThumbRef}
          class="canvas-scrollbar-thumb"
          onPointerDown={(e) => onPointerDown('v', e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </>
  );
}
