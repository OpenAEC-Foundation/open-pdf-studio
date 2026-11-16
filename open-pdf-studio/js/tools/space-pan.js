import { state, getActiveDocument } from '../core/state.js';
import { interactionState } from '../core/stores/interaction-store.js';
import { getDialogs, hideMenu } from '../bridge.js';
import { isModalOpen } from './tool-context.js';
import { isGMoveModeActive } from './g-move-mode.js';
import { isGRotateModeActive } from './g-rotate-mode.js';
import { startPan, breekPanAf } from './pan-handler.js';
import { startViewportMiddelmuisPan, breekViewportPanAf } from '../pdf/pdf-viewport.js';
import { createSpacePanHandlers } from './space-pan-policy.js';

let installed = false;
export function installSpacePan() {
  if (installed) return;
  installed = true;
  const h = createSpacePanHandlers({
    getDocument: () => getActiveDocument()?.pdfDoc ? getActiveDocument() : null,
    blocked: () => isModalOpen() || getDialogs().length > 0
      || state.isEditingText || state.pdfTextEditState || state.imageCropMode
      || state.isDrawing || state.isDragging || state.isResizing || state.isRubberBanding
      || interactionState.busy || interactionState.snapPick
      || isGMoveModeActive() || isGRotateModeActive(),
    isPanning: () => state.isPanning,
    setHeld: value => { interactionState.spacePanHeld = value; },
    startPan: e => {
      hideMenu();
      const container = document.getElementById('pdf-container');
      const viewportPan = getActiveDocument()?.viewMode !== 'continuous'
        && startViewportMiddelmuisPan(e, false);
      if (!viewportPan) {
        startPan(e, false);
        try { container?.setPointerCapture(e.pointerId); } catch (_) {}
      }
      const capture = viewportPan ? document.querySelector('.main-view') : container;
      return () => {
        if (viewportPan) breekViewportPanAf(); else breekPanAf();
        try { capture?.releasePointerCapture(e.pointerId); } catch (_) {}
      };
    },
  });
  for (const [name, fn] of Object.entries({ keydown: h.onKeyDown, keyup: h.onKeyUp,
    pointerdown: h.onPointerDown, pointermove: h.onPointerMove, pointerup: h.onPointerUp,
    pointercancel: h.onPointerCancel, lostpointercapture: h.onLostPointerCapture, click: h.onClick })) {
    window.addEventListener(name, fn, { capture: true });
  }
  window.addEventListener('blur', h.reset);
  // Moving focus to a field/control must return Space to that control.
  window.addEventListener('focusin', h.reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) h.reset(); });
}
