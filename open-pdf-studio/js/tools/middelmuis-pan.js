// Centrale middelmuis-pan (issue #397).
//
// Middelmuis-slepen pant altijd: bij elk gereedschap, en ook als de klik op de
// tekstlaag, een link, de marge of de ruimte tussen pagina's begint. Eerder
// zat de middelknop-afhandeling alleen in de pointerdown van de pagina-
// container (doorlopende weergave) en achter een filter dat de tekstlaag van
// het Selectie-gereedschap en alles buiten de pagina uitsloot. Daar kreeg de
// middelklik geen preventDefault, waardoor de native autoscroll startte.
//
// Eén listener in de capture-fase op window ziet het event vóór elke
// laag-specifieke handler. De pan zelf hergebruikt de bestaande logica:
// pan-handler.js (scrollende weergaven) en pdf-viewport.js (enkele pagina).

import { state, getActiveDocument } from '../core/state.js';
import { startPan, startContinuousPan } from './pan-handler.js';
import { startViewportMiddelmuisPan } from '../pdf/pdf-viewport.js';
import { middelmuisActie } from './middelmuis-pan-beleid.js';

function actieVoor(e) {
  const doel = e.target instanceof Element ? e.target : null;
  return middelmuisActie({
    button: e.button,
    buttons: e.buttons,
    binnenWeergave: !!(doel && doel.closest('#pdf-container') && getActiveDocument()?.pdfDoc),
    inVergelijking: !!(doel && doel.closest('.compare-view')),
    alPannen: !!state.isPanning,
  });
}

function onPointerDown(e) {
  const actie = actieVoor(e);
  if (actie === 'negeer') return;
  // Onderdrukt de autoscroll (en de afgeleide mousedown).
  e.preventDefault();
  if (actie !== 'pan') return;
  // Laag-specifieke handlers (gereedschap, tekstlaag, viewport) mogen dit
  // event niet ook als klik verwerken.
  e.stopPropagation();
  if (getActiveDocument()?.viewMode === 'continuous') {
    startContinuousPan(e, true);
  } else if (!startViewportMiddelmuisPan(e)) {
    startPan(e, true);
  }
}

// Vangnet: als een mousedown tóch wordt afgeleverd (bijv. een akkoord met een
// andere knop, waarbij geen nieuwe pointerdown komt), krijgt ook die een
// preventDefault zodat de autoscroll niet start.
function onMouseDown(e) {
  if (actieVoor({ target: e.target, button: e.button, buttons: e.buttons }) !== 'negeer') {
    e.preventDefault();
  }
}

// Een middelklik in de weergave opent of navigeert nooit iets.
function onAuxClick(e) {
  if (e.button !== 1) return;
  const doel = e.target instanceof Element ? e.target : null;
  if (doel && doel.closest('#pdf-container') && !doel.closest('.compare-view')) {
    e.preventDefault();
  }
}

let _geinstalleerd = false;

export function installeerMiddelmuisPan() {
  if (_geinstalleerd) return;
  _geinstalleerd = true;
  window.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('mousedown', onMouseDown, { capture: true });
  window.addEventListener('auxclick', onAuxClick, { capture: true });
}
