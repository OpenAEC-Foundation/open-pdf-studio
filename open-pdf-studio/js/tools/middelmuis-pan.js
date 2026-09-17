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

import { state, getActiveDocument } from '../core/state.js';
import { startPan, startContinuousPan } from './pan-handler.js';
import { startViewportMiddelmuisPan } from '../pdf/pdf-viewport.js';
import { finishTextEditing } from './text-editing.js';
import { rondActievePdfTekstBewerkingAf } from './text-edit-tool.js';
import { hideMenu } from '../bridge.js';
import { maakMiddelmuisHandlers } from './middelmuis-pan-beleid.js';

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
  });
  window.addEventListener('pointerdown', h.onPointerDown, { capture: true });
  window.addEventListener('mousedown', h.onMouseDown, { capture: true });
  window.addEventListener('auxclick', h.onAuxClick, { capture: true });
}
