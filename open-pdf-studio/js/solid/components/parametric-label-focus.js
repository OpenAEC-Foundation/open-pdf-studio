export function captureParametricLabelReturnFocus(documentRef = document) {
  const activeElement = documentRef?.activeElement;
  if (activeElement !== documentRef?.body && typeof activeElement?.focus === 'function') {
    return activeElement;
  }
  return documentRef?.querySelector?.('#annotation-canvas, .annotation-canvas') || null;
}

export function restoreParametricLabelFocus(target) {
  if (!target || target.isConnected === false || typeof target.focus !== 'function') {
    return false;
  }
  try {
    target.focus({ preventScroll: true });
  } catch (_) {
    target.focus();
  }
  return true;
}
