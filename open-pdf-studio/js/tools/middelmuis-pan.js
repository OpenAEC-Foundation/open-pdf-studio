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
// Het gedrag staat in maakMiddelmuisHandlers (middelmuis-pan-beleid.js).
//
// Dezelfde listeners herkennen ook de dubbelklik met de middelknop (issue
// #767, middelmuis-dubbelklik.js): die maakt de huidige pagina passend.

import { state, getActiveDocument } from '../core/state.js';
import { startPan, startContinuousPan } from './pan-handler.js';
import { startViewportMiddelmuisPan } from '../pdf/pdf-viewport.js';
import { finishTextEditing } from './text-editing.js';
import { rondActievePdfTekstBewerkingAf } from './text-edit-tool.js';
import { hideMenu } from '../bridge.js';
import { maakMiddelmuisHandlers } from './middelmuis-pan-beleid.js';
import { maakMiddelmuisDubbelklik } from './middelmuis-dubbelklik.js';

let _geinstalleerd = false;

export function installeerMiddelmuisPan() {
  if (_geinstalleerd) return;
  _geinstalleerd = true;
  const h = maakMiddelmuisHandlers({
    heeftDocument: () => !!getActiveDocument()?.pdfDoc,
    weergaveModus: () => getActiveDocument()?.viewMode,
    isPanning: () => state.isPanning,
    rondBewerkingenAf: () => {
      if (state.isEditingText) finishTextEditing();
      rondActievePdfTekstBewerkingAf();
    },
    sluitMenu: () => hideMenu(),
    startScrollPan: (e) => {
      if (getActiveDocument()?.viewMode === 'continuous') startContinuousPan(e, true);
      else startPan(e, true);
    },
    startViewportPan: (e) => startViewportMiddelmuisPan(e),
    dubbelklik: maakMiddelmuisDubbelklik(),
    dubbelklikAan: () => state.preferences?.middleDoubleClickFit !== false,
    // Dynamisch: renderer.js trekt de hele render-keten mee.
    zoomAlles: () => {
      import('../pdf/renderer.js')
        .then((m) => m.zoomAlles())
        .catch((err) => console.warn('[middelmuis] zoom alles mislukt:', err));
    },
  });
  window.addEventListener('pointerdown', h.onPointerDown, { capture: true });
  window.addEventListener('mousedown', h.onMouseDown, { capture: true });
  window.addEventListener('auxclick', h.onAuxClick, { capture: true });
  window.addEventListener('pointermove', h.onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerup', h.onPointerUp, { capture: true });
  window.addEventListener('pointercancel', h.onPointerCancel, { capture: true });
  window.addEventListener('blur', h.onPointerCancel);
}
