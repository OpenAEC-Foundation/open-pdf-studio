// Internal page moves must not enter HTML5 drag-and-drop: on Windows,
// Tauri owns WebView2's native drop handler to receive external file paths.
export function createOrganizerPointerDrag(element, { keyAt, start, move, finish }) {
  const doc = element.ownerDocument;
  let gesture = null;
  let swallowClick = false;

  function removeListeners() {
    doc.removeEventListener('pointermove', pointerMove, true);
    doc.removeEventListener('pointerup', pointerUp, true);
    doc.removeEventListener('pointercancel', pointerCancel, true);
    doc.defaultView?.removeEventListener('blur', cancel);
  }
  function end(event, cancelled) {
    const previous = gesture;
    if (!previous) return;
    gesture = null;
    removeListeners();
    if (element.hasPointerCapture?.(previous.id)) element.releasePointerCapture(previous.id);
    if (!previous.active) return;
    swallowClick = true;
    event?.preventDefault();
    event?.stopPropagation();
    finish({ clientX: event?.clientX ?? previous.x, clientY: event?.clientY ?? previous.y, cancelled });
  }
  function pointerMove(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.active) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 5) return;
      gesture.active = true;
      start(gesture.key);
      try { element.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    event.preventDefault();
    event.stopPropagation();
    move(event);
  }
  function pointerUp(event) {
    if (gesture?.id === event.pointerId) end(event, false);
  }
  function pointerCancel(event) {
    if (gesture?.id === event.pointerId) end(event, true);
  }
  function cancel() { end(null, true); }
  function pointerDown(event) {
    swallowClick = false;
    if (gesture?.active || event.button !== 0 || event.isPrimary === false || event.pointerType === 'touch') return;
    // A press below the threshold whose release never arrived (released
    // outside the page) must not carry its origin into this press.
    if (gesture) { gesture = null; removeListeners(); }
    const key = keyAt(event.target);
    if (key == null) return;
    gesture = { id: event.pointerId, key, x: event.clientX, y: event.clientY, active: false };
    doc.addEventListener('pointermove', pointerMove, true);
    doc.addEventListener('pointerup', pointerUp, true);
    doc.addEventListener('pointercancel', pointerCancel, true);
    doc.defaultView?.addEventListener('blur', cancel);
  }
  function click(event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }
  element.addEventListener('pointerdown', pointerDown);
  element.addEventListener('lostpointercapture', pointerCancel);
  element.addEventListener('click', click, true);
  return {
    isDragging: () => !!gesture?.active,
    cancel,
    destroy() {
      end(null, true);
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('lostpointercapture', pointerCancel);
      element.removeEventListener('click', click, true);
    },
  };
}
