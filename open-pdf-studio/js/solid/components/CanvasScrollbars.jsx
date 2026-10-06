import { onCleanup, onMount, createMemo, createEffect, on, untrack } from 'solid-js';
import { state } from '../../core/state.js';
import { viewport, schermPaginaMaat, volgViewport } from '../../pdf/pdf-viewport.js';
import { SB_SIZE, scrollbalkGeometrie } from '../../pdf/scrollbalk-geometrie.js';

// Optional X/Y scrollbars overlaid on the PDF canvas viewport.
// - Hidden by default (preference `showScrollbars`).
// - Each scrollbar only shown when its axis overflows the canvas.
// - Dragging the thumb pans the viewport (mirrors viewport.offsetX/Y).
// - Does NOT replace existing pan/zoom; this is an additional input.
//
// Paginamaat op het scherm = na paginarotatie én weergaverotatie (#200):
// schermPaginaMaat(), niet de ongedraaide viewport.pageW/pageH.
//
// Bijwerken zonder te pollen: de viewport is een gewoon object (niet
// reactief). Vroeger las een eigen animatieframe-lus hem elk frame uit, ook
// met de balken uit en zonder document open. Nu werken de balken alleen bij
// als er iets veranderd kan zijn: na elke render van de viewport en bij een
// wissel van viewport.active (volgViewport), en als de voorkeur omgaat. De
// maatvoering staat in scrollbalk-geometrie.js.

export default function CanvasScrollbars() {
  // Reactive on/off via the SolidJS preferences mutable
  const enabled = createMemo(() => !!state.preferences.showScrollbars);

  let hRef, vRef, hThumbRef, vThumbRef;
  let mounted = false;
  let stopVolgen = null;

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

  // Alleen schrijven als er iets verandert: met de balken uit (standaard)
  // draait dit na elke render.
  function hideBars() {
    if (hRef && hRef.style.display !== 'none') hRef.style.display = 'none';
    if (vRef && vRef.style.display !== 'none') vRef.style.display = 'none';
  }

  function update() {
    if (!mounted) return;
    // Voorkeur uit: balken weg (ook als ze net nog zichtbaar waren).
    if (!enabled()) {
      hideBars();
      return;
    }
    if (!viewport || !viewport.active) {
      hideBars();
      return;
    }
    const css = getCanvasCssSize();
    if (!css) return;
    const scherm = schermPaginaMaat();
    const g = scrollbalkGeometrie({
      canvasW: css.w,
      canvasH: css.h,
      paginaW: scherm.w * viewport.zoom,
      paginaH: scherm.h * viewport.zoom,
      offsetX: viewport.offsetX,
      offsetY: viewport.offsetY,
    });

    // Horizontal
    if (g.h) {
      hRef.style.display = '';
      hRef.style.right = g.h.right + 'px';
      hThumbRef.style.width = g.h.thumbPx + 'px';
      hThumbRef.style.transform = `translateX(${g.h.thumbStart}px)`;
    } else {
      hRef.style.display = 'none';
    }

    // Vertical
    if (g.v) {
      vRef.style.display = '';
      vRef.style.bottom = g.v.bottom + 'px';
      vThumbRef.style.height = g.v.thumbPx + 'px';
      vThumbRef.style.transform = `translateY(${g.v.thumbStart}px)`;
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
    // Na elke render en bij een wissel van viewport.active. Untrack: de
    // schrijver van active kan zelf in een effect zitten; die mag niet van
    // de voorkeur gaan afhangen doordat update() enabled() leest.
    stopVolgen = volgViewport(() => untrack(update));
    update();
  });

  // Voorkeur omgezet: meteen tonen of verbergen, ook zonder render.
  createEffect(on(enabled, () => update(), { defer: true }));

  onCleanup(() => {
    mounted = false;
    if (stopVolgen) stopVolgen();
    stopVolgen = null;
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
