import { state } from '../core/state.js';
import { geenPanKnopMeer, installeerPanVangnet } from './pan-vangnet.js';

// Pan handler — manages legacy (non-viewport) scroll-based panning.
// Cursor is reactive: it follows state.isPanning + state.isMiddleButtonPanning
// via js/ui/cursor.js. This file ONLY manipulates state and scroll position.

export function getScrollContainer() {
  return document.getElementById('pdf-container');
}

export function handlePanMove(e) {
  if (!state.isPanning) return;
  // Beweging zonder ingedrukte knop: het loslaten is gemist (#1013).
  if (geenPanKnopMeer(e)) { breekPanAf(); return; }
  const scrollContainer = getScrollContainer();
  if (!scrollContainer) return;
  const deltaX = e.clientX - state.panStartX;
  const deltaY = e.clientY - state.panStartY;
  scrollContainer.scrollLeft = state.panScrollStartX - deltaX;
  scrollContainer.scrollTop = state.panScrollStartY - deltaY;
}

export function handlePanEnd(e) {
  if (!state.isPanning) return;
  state.isPanning = false;
  document.removeEventListener('pointermove', handlePanMove);
  document.removeEventListener('pointerup', handlePanEnd);
  document.removeEventListener('mousemove', handlePanMove);
  document.removeEventListener('mouseup', handlePanEnd);
}

export function handleMiddleButtonPanEnd(e) {
  if (!state.isPanning || !state.isMiddleButtonPanning) return;
  state.isPanning = false;
  state.isMiddleButtonPanning = false;
  document.removeEventListener('pointermove', handlePanMove);
  document.removeEventListener('pointerup', handleMiddleButtonPanEnd);
  document.removeEventListener('mousemove', handlePanMove);
  document.removeEventListener('mouseup', handleMiddleButtonPanEnd);
}

export function startPan(e, isMiddleButton) {
  const scrollContainer = getScrollContainer();
  // Schone start: resten van een pan waarvan het loslaten gemist is (#1013).
  breekPanAf();
  state.isPanning = true;
  state.isMiddleButtonPanning = !!isMiddleButton;
  state.panStartX = e.clientX;
  state.panStartY = e.clientY;
  state.panScrollStartX = scrollContainer ? scrollContainer.scrollLeft : 0;
  state.panScrollStartY = scrollContainer ? scrollContainer.scrollTop : 0;
  document.addEventListener('pointermove', handlePanMove);
  document.addEventListener('pointerup', isMiddleButton ? handleMiddleButtonPanEnd : handlePanEnd);
  e.preventDefault();
}

export function startContinuousPan(e, isMiddleButton) {
  const scrollContainer = getScrollContainer();
  // Schone start: resten van een pan waarvan het loslaten gemist is (#1013).
  breekPanAf();
  state.isPanning = true;
  state.isMiddleButtonPanning = !!isMiddleButton;
  state.panStartX = e.clientX;
  state.panStartY = e.clientY;
  state.panScrollStartX = scrollContainer ? scrollContainer.scrollLeft : 0;
  state.panScrollStartY = scrollContainer ? scrollContainer.scrollTop : 0;
  document.addEventListener('pointermove', handlePanMove);
  document.addEventListener('pointerup', isMiddleButton ? handleMiddleButtonPanEnd : handlePanEnd);
  e.preventDefault();
}

// Breekt een lopende scroll-pan af (pointerup gemist, venster kwijt): de
// pan-status en alle document-luisteraars weg, ook die van de middelknop.
// Idempotent; het gekozen gereedschap blijft staan (#1013).
export function breekPanAf() {
  state.isPanning = false;
  state.isMiddleButtonPanning = false;
  document.removeEventListener('pointermove', handlePanMove);
  document.removeEventListener('pointerup', handlePanEnd);
  document.removeEventListener('pointerup', handleMiddleButtonPanEnd);
  document.removeEventListener('mousemove', handlePanMove);
  document.removeEventListener('mouseup', handlePanEnd);
  document.removeEventListener('mouseup', handleMiddleButtonPanEnd);
}

let _vangnetWeg = null;

/** Eén keer bij het opstarten: focusverlies of verborgen pagina breekt de pan af. */
export function installeerScrollPanVangnet() {
  if (_vangnetWeg) return;
  _vangnetWeg = installeerPanVangnet({
    win: window,
    doc: document,
    breekAf: () => { if (state.isPanning) breekPanAf(); },
  });
}
