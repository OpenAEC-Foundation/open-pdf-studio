// Straighten (deskew) tool: let the user drag a guide line directly on the
// current page along a feature that should be perfectly horizontal or
// vertical, then rotate the page(s) by the small correction angle needed to
// level it. Mirrors crop-select.js's drag/confirm/cancel flow, but the core
// operation (pdf/deskew.js's straightenPages) needs a follow-up Apply-to
// choice, so confirming the line opens a dialog instead of applying directly.
import { getActiveDocument } from '../core/state.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { render } from 'solid-js/web';
import StraightenOverlay from '../solid/components/StraightenOverlay.jsx';
import { startScreenshot, endScreenshot, openDialog } from '../bridge.js';
import { getCurrentCanvases, selectionToAppRect } from './screenshot.js';

let disposeOverlay = null;

function mountOverlay(container) {
  const mountId = 'straighten-select-overlay-root';
  let mountEl = container.querySelector('#' + mountId);
  if (!mountEl) {
    if (disposeOverlay) {
      disposeOverlay();
      disposeOverlay = null;
    }
    mountEl = document.createElement('div');
    mountEl.id = mountId;
    mountEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:500;';
    container.appendChild(mountEl);
  }
  return mountEl;
}

function unmountOverlay() {
  if (disposeOverlay) {
    disposeOverlay();
    disposeOverlay = null;
  }
  const mountEl = document.getElementById('straighten-select-overlay-root');
  if (mountEl) mountEl.remove();
}

// Converts a point in overlay-local CSS px (top-left origin, same frame as
// CropSelectOverlay's rect) into APP annotation space (page points), reusing
// screenshot.js's existing rect->app-space conversion with a zero-size rect.
function pointToAppSpace(x, y, container) {
  const rect = selectionToAppRect({ left: x, top: y, width: 0, height: 0 }, container);
  return rect ? { x: rect.x, y: rect.y } : null;
}

/**
 * Start the straighten (deskew) flow on the current page: drag a guide line,
 * Enter to confirm and open the Apply-to dialog, Escape to cancel.
 */
export function startStraightenPage() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    updateStatusMessage('Open a PDF first to straighten it');
    return;
  }

  const canvases = getCurrentCanvases();
  if (!canvases) {
    updateStatusMessage('No PDF page to straighten');
    return;
  }

  const container = canvases.container;
  container.style.position = container.style.position || 'relative';

  unmountOverlay();
  endScreenshot();

  const mountEl = mountOverlay(container);
  mountEl.style.pointerEvents = 'auto';

  disposeOverlay = render(
    () =>
      StraightenOverlay({
        onConfirm: (line, applyTo) => {
          const p1 = pointToAppSpace(line.x1, line.y1, container);
          const p2 = pointToAppSpace(line.x2, line.y2, container);
          unmountOverlay();
          if (!p1 || !p2) {
            updateStatusMessage('Straighten cancelled');
            return;
          }
          openDialog('straighten-page', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, applyTo });
        },
        onCancel: () => {
          updateStatusMessage('Straighten cancelled');
          unmountOverlay();
        },
      }),
    mountEl
  );
}
