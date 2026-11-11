// Docking of the floating palettes (Tool Palette and extension palettes).
//
// Press and hold on the grip or the title to drag; the palette docks the
// moment it reaches an edge of the page view (left, right, top or bottom),
// while it is still being dragged, and floats again once the pointer is
// dragged away. Letting go leaves it where it is. While it is snapped, the
// docked palette itself is highlighted with the dock icon over it; the other
// edges show their dock icons.

import { For, Show } from 'solid-js';
import { klemPaletPositie } from './palette-grenzen.js';
import { registerPaletteDock, unregisterPaletteDock } from '../stores/paletteOrder.js';

// Docks when an edge comes within DOCK_SNAP; comes off at DOCK_RELEASE, so it
// does not flicker at the edge.
export const DOCK_SNAP = 60;
export const DOCK_RELEASE = 100;
export const DOCK_SIDES = ['left', 'right', 'top', 'bottom'];

export const DOCK_ICONEN = {
  left: '<rect x="1" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>',
  right: '<rect x="13" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>',
  top: '<rect x="1" y="1" width="18" height="6" rx="1" fill="currentColor" opacity="0.4"/>',
  bottom: '<rect x="1" y="13" width="18" height="6" rx="1" fill="currentColor" opacity="0.4"/>',
};

const dockIconSvg = (kant) =>
  `<rect x="1" y="1" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>${DOCK_ICONEN[kant] || ''}`;

// Size of each palette while floating, kept for the snap test while docked.
const zweefMaat = new Map();

/**
 * Start dragging a palette.
 * @param {MouseEvent} e  the mousedown on the grip or title
 * @param {object} o
 * @param {string} o.id                 palette id in the dock order ('tool', extension id)
 * @param {boolean} o.fromDocked        dragged out of a dock
 * @param {() => {x, y}} o.floatPos
 * @param {(p) => void} o.setFloatPos
 * @param {(mode: string) => void} o.setMode   'float' | 'docked-<side>'
 * @param {(b: boolean) => void} o.setDragging
 * @param {(side: string|null) => void} o.setPreview
 * @param {string} o.floatSelector      selector of this palette's floating element
 * @param {() => void} o.onEnd          save state after a drag that moved
 */
export function startPaletteDrag(e, o) {
  if (e.button !== 0) return;
  e.preventDefault();
  const mainViewEl = document.querySelector('.main-view');
  if (!mainViewEl) return;
  let hasMoved = false;
  const startCX = e.clientX;
  const startCY = e.clientY;
  const offsetX = o.fromDocked ? 17 : (e.clientX - o.floatPos().x);
  const offsetY = o.fromDocked ? 12 : (e.clientY - o.floatPos().y);
  o.setDragging(true);

  // The side it is docked to during this drag (null = floating).
  let gedokt = null;
  // The page view with nothing docked: docking shrinks it, and measuring the
  // shrunk view would undock the palette straight away.
  let kader = null;

  function snapSide(px, pw, cx, cy) {
    const r = kader || mainViewEl.getBoundingClientRect();
    // Snapping: the pointer near an edge, or for the side docks the palette's
    // own side edge too. Top and bottom go by the pointer: a floating palette
    // is tall, so its bottom edge is near the bottom wherever it is.
    const afstand = {
      left: Math.min(px - r.left, cx - r.left),
      right: Math.min(r.right - (px + pw), r.right - cx),
      top: cy - r.top,
      bottom: r.bottom - cy,
    };
    // Coming off goes by the pointer alone.
    const wijzer = { left: cx - r.left, right: r.right - cx, top: cy - r.top, bottom: r.bottom - cy };
    if (gedokt && wijzer[gedokt] < DOCK_RELEASE) return gedokt;
    let beste = null;
    for (const [kant, d] of Object.entries(afstand)) {
      if (d < DOCK_SNAP && (beste === null || d < afstand[beste])) beste = kant;
    }
    return beste;
  }

  function dock(kant) {
    if (kant === gedokt) return;
    gedokt = kant;
    if (kant) {
      o.setMode(`docked-${kant}`);
      registerPaletteDock(o.id, kant);
    } else {
      o.setMode('float');
      unregisterPaletteDock(o.id);
    }
  }

  function onMove(ev) {
    // Button already up: the release was missed (the grabbed element is
    // replaced when the palette docks or undocks). End the drag here.
    if ((ev.buttons & 1) === 0) { onUp(); return; }
    if (!hasMoved) {
      if (Math.abs(ev.clientX - startCX) < 4 && Math.abs(ev.clientY - startCY) < 4) return;
      hasMoved = true;
      if (o.fromDocked) {
        o.setMode('float');
        unregisterPaletteDock(o.id);
      }
      kader = null;
      requestAnimationFrame(() => { kader = mainViewEl.getBoundingClientRect(); });
    }
    const el = gedokt ? null : document.querySelector(o.floatSelector);
    if (el && el.offsetWidth > 0) zweefMaat.set(o.id, { w: el.offsetWidth, h: el.offsetHeight });
    const { w: pw, h: ph } = zweefMaat.get(o.id) || { w: 80, h: 420 };
    const { x: nx, y: ny } = klemPaletPositie({ x: ev.clientX - offsetX, y: ev.clientY - offsetY }, pw, ph);
    o.setFloatPos({ x: nx, y: ny });
    const kant = snapSide(nx, pw, ev.clientX, ev.clientY);
    dock(kant);
    o.setPreview(kant);
  }

  let klaar = false;
  function onUp() {
    if (klaar) return;
    klaar = true;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('blur', onUp);
    o.setDragging(false);
    o.setPreview(null);
    if (hasMoved) o.onEnd();
  }

  // Capture phase on the window: the release still arrives when the grabbed
  // element has just been swapped for the docked (or floating) palette.
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('blur', onUp);
}

/** Dock icon over a docked palette that has just snapped there. */
export function DockLiveIcon(props) {
  return (
    <Show when={props.dragging()}>
      <div class="tp-dock-live-icon">
        <svg width="20" height="20" viewBox="0 0 20 20" innerHTML={dockIconSvg(props.side)} />
      </div>
    </Show>
  );
}

/** Dock icons on the edges of the page view while dragging (not the snapped side). */
export function DockTargetIcons(props) {
  return (
    <For each={DOCK_SIDES}>
      {(kant) => (
        <div class={`tp-dock-target tp-dock-target-${kant} ${props.dragging() && props.preview() !== kant ? 'visible' : ''}`}>
          <div class="tp-dock-target-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" innerHTML={dockIconSvg(kant)} />
          </div>
        </div>
      )}
    </For>
  );
}
