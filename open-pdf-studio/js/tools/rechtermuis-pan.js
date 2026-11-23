// Panning with the right mouse button (#1241): the decisions of
// rechtermuis-pan-beleid.js connected to the app. Installed once; it does
// nothing while the preference `rightButtonDrag` is at its default.

import { state, getActiveDocument } from '../core/state.js';
import { startPan, startContinuousPan } from './pan-handler.js';
import { startViewportMiddelmuisPan } from '../pdf/pdf-viewport.js';
import { hideMenu } from '../solid/stores/contextMenuStore.js';
import { maakRechtermuisHandlers } from './rechtermuis-pan-beleid.js';

let _geinstalleerd = false;

export function installeerRechtermuisPan() {
  if (_geinstalleerd) return;
  _geinstalleerd = true;
  let slik = false;
  const h = maakRechtermuisHandlers({
    keuze: () => state.preferences?.rightButtonDrag,
    heeftDocument: () => !!getActiveDocument()?.pdfDoc,
    isPanning: () => state.isPanning,
    sluitMenu: () => hideMenu(),
    // Het snelmenu dat op het loslaten volgt, één keer: op vensterniveau,
    // want welk element onder de muis ligt bij het loslaten is toeval.
    slikMenu: () => { slik = true; },
    startPan: (e) => {
      // The same pan as the middle button; the flag keeps the safety net from
      // ending it because "no pan button is down" (pan-vangnet.js).
      state.isRightButtonPanning = true;
      if (getActiveDocument()?.viewMode === 'continuous') startContinuousPan(e, true);
      else if (!startViewportMiddelmuisPan(e)) startPan(e, true);
    },
  });
  const klaar = () => { state.isRightButtonPanning = false; };
  // Een nieuwe druk begint schoon: een menu dat niet kwam, wordt niet later ingeslikt.
  window.addEventListener('pointerdown', (e) => { slik = false; h.onPointerDown(e); }, { capture: true });
  window.addEventListener('contextmenu', (e) => {
    if (!slik) return;
    slik = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
  window.addEventListener('pointermove', h.onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerup', (e) => { h.onPointerUp(e); if (e.button === 2) klaar(); }, { capture: true });
  window.addEventListener('pointercancel', () => { h.onCancel(); klaar(); }, { capture: true });
  window.addEventListener('blur', () => { h.onCancel(); klaar(); });
}
