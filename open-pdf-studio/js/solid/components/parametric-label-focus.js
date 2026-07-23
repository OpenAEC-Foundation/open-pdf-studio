function makeProgrammaticallyFocusable(target) {
  if (
    target
    && typeof target.hasAttribute === 'function'
    && typeof target.setAttribute === 'function'
    && !target.hasAttribute('tabindex')
  ) {
    target.setAttribute('tabindex', '-1');
  }
  return target;
}

export function captureParametricLabelReturnFocus(
  documentRef = document,
  preferredCanvas = null,
) {
  const activeElement = documentRef?.activeElement;
  if (
    activeElement
    && activeElement !== documentRef?.body
    && activeElement !== documentRef?.documentElement
    && typeof activeElement.focus === 'function'
  ) {
    return activeElement;
  }
  const canvas = preferredCanvas?.isConnected === false
    ? null
    : preferredCanvas;
  return makeProgrammaticallyFocusable(
    canvas || documentRef?.querySelector?.('#annotation-canvas, .annotation-canvas') || null,
  );
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
  const documentRef = target.ownerDocument
    || (typeof document !== 'undefined' ? document : null);
  return !documentRef?.activeElement || documentRef.activeElement === target;
}
