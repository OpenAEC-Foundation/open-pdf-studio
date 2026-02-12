import { state } from '../core/state.js';
import { annotationCanvas, pdfContainer } from '../ui/dom-elements.js';

export function getScrollContainer() {
  return document.getElementById('pdf-container');
}

export function handlePanMove(e) {
  if (!state.isPanning) return;
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
  // Reset cursors back to grab
  document.body.style.cursor = '';
  pdfContainer.style.cursor = '';
  if (annotationCanvas) annotationCanvas.style.cursor = 'grab';
  document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = 'grab');
  document.removeEventListener('mousemove', handlePanMove);
  document.removeEventListener('mouseup', handlePanEnd);
}

export function handleMiddleButtonPanEnd(e) {
  if (!state.isPanning || !state.isMiddleButtonPanning) return;
  state.isPanning = false;
  state.isMiddleButtonPanning = false;
  // Reset cursors back to default (not grab, since we're not using hand tool)
  document.body.style.cursor = '';
  pdfContainer.style.cursor = '';
  if (annotationCanvas) annotationCanvas.style.cursor = '';
  document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = '');
  document.removeEventListener('mousemove', handlePanMove);
  document.removeEventListener('mouseup', handleMiddleButtonPanEnd);
}

export function startPan(e, isMiddleButton) {
  const scrollContainer = getScrollContainer();
  state.isPanning = true;
  if (isMiddleButton) state.isMiddleButtonPanning = true;
  state.panStartX = e.clientX;
  state.panStartY = e.clientY;
  state.panScrollStartX = scrollContainer ? scrollContainer.scrollLeft : 0;
  state.panScrollStartY = scrollContainer ? scrollContainer.scrollTop : 0;
  // Set grabbing cursor on all relevant elements
  document.body.style.cursor = 'grabbing';
  pdfContainer.style.cursor = 'grabbing';
  if (annotationCanvas) annotationCanvas.style.cursor = 'grabbing';
  document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = 'grabbing');
  document.addEventListener('mousemove', handlePanMove);
  document.addEventListener('mouseup', isMiddleButton ? handleMiddleButtonPanEnd : handlePanEnd);
  e.preventDefault();
}

export function startContinuousPan(e, isMiddleButton) {
  const scrollContainer = getScrollContainer();
  state.isPanning = true;
  if (isMiddleButton) state.isMiddleButtonPanning = true;
  state.panStartX = e.clientX;
  state.panStartY = e.clientY;
  state.panScrollStartX = scrollContainer ? scrollContainer.scrollLeft : 0;
  state.panScrollStartY = scrollContainer ? scrollContainer.scrollTop : 0;
  document.body.style.cursor = 'grabbing';
  pdfContainer.style.cursor = 'grabbing';
  document.querySelectorAll('.annotation-canvas').forEach(c => c.style.cursor = 'grabbing');
  document.addEventListener('mousemove', handlePanMove);
  document.addEventListener('mouseup', isMiddleButton ? handleMiddleButtonPanEnd : handlePanEnd);
  e.preventDefault();
}
