// Pointer events also work in WebViews whose native file-drop handler consumes
// HTML drag events. The owner removes all listeners on unmount.
export function installSectionOrdering(root, { move, identity }) {
  const headerSelector = '.property-section-header, .prop-section-header';
  const headers = () => [...root.querySelectorAll('[data-property-block]')]
    .map(block => ({ id: block.dataset.propertyBlock, header: block.querySelector(headerSelector) }))
    .filter(item => item.header?.getClientRects().length);
  const itemAt = target => headers().find(item => item.header === target?.closest?.(headerSelector));
  let gesture = null, suppressClick = false, frame = 0;
  const doc = root.ownerDocument, win = doc.defaultView;
  const clearIndicator = () => root.querySelectorAll('[data-section-drop]').forEach(el => el.removeAttribute('data-section-drop'));
  function finish(commit = false) {
    const g = gesture;
    gesture = null;
    win.cancelAnimationFrame(frame);
    clearIndicator();
    if (!g) return;
    suppressClick = g.dragging;
    if (g.header.hasPointerCapture?.(g.pointerId)) g.header.releasePointerCapture(g.pointerId);
    if (commit && g.dragging && g.target && g.header.isConnected && identity() === g.identity) {
      move(g.id, g.target.id, g.after);
      g.header.focus({ preventScroll: true });
    }
  }
  function updateTarget() {
    const g = gesture;
    if (!g?.dragging) return;
    if (!g.header.isConnected || identity() !== g.identity) { finish(); return; }
    clearIndicator(); g.target = null;
    const rootBounds = root.getBoundingClientRect();
    const bounds = { left: rootBounds.left, right: rootBounds.right, top: rootBounds.top, bottom: rootBounds.bottom };
    const panelBounds = root.closest('.properties-panel').getBoundingClientRect();
    bounds.top = Math.max(bounds.top, panelBounds.top);
    bounds.bottom = Math.min(bounds.bottom, panelBounds.bottom);
    if (g.x < bounds.left || g.x > bounds.right || g.y < bounds.top || g.y > bounds.bottom) return;
    const items = headers().filter(item => item.id !== g.id);
    const target = items.find(item => g.y < item.header.getBoundingClientRect().bottom) || items.at(-1);
    if (!target) return;
    const rect = target.header.getBoundingClientRect();
    g.target = target; g.after = g.y >= rect.top + rect.height / 2;
    target.header.dataset.sectionDrop = g.after ? 'after' : 'before';
  }
  function autoScroll() {
    if (!gesture?.dragging) return;
    const panel = root.closest('.properties-panel');
    const bounds = panel?.getBoundingClientRect();
    if (bounds && gesture.x >= bounds.left && gesture.x <= bounds.right) {
      const delta = gesture.y < bounds.top + 28 ? -10 : gesture.y > bounds.bottom - 28 ? 10 : 0;
      if (delta) { panel.scrollTop += delta; updateTarget(); }
    }
    frame = win.requestAnimationFrame(autoScroll);
  }
  function down(e) {
    const item = itemAt(e.target);
    if (!item || e.button !== 0 || !e.isPrimary || e.target.closest('input, select, button, a, textarea')) return;
    finish(); suppressClick = false;
    gesture = { ...item, identity: identity(), pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dragging: false };
    item.header.setPointerCapture?.(e.pointerId);
  }
  function pointerMove(e) {
    const g = gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    g.x = e.clientX; g.y = e.clientY;
    if (!g.dragging && Math.hypot(g.x - g.x0, g.y - g.y0) < 6) return;
    e.preventDefault();
    if (!g.dragging) { g.dragging = true; frame = win.requestAnimationFrame(autoScroll); }
    updateTarget();
  }
  function up(e) { if (e.pointerId === gesture?.pointerId) finish(true); }
  function cancel(e) { if (e.pointerId === gesture?.pointerId) finish(); }
  function click(e) {
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation(); }
  }
  function key(e) {
    if (e.key === 'Escape' && gesture) { finish(); e.preventDefault(); e.stopPropagation(); return; }
    const item = itemAt(e.target);
    if (!item || e.target !== item.header || !e.altKey || e.ctrlKey || e.metaKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation(); finish();
    const items = headers(), direction = e.key === 'ArrowUp' ? -1 : 1;
    const target = items[items.findIndex(x => x.id === item.id) + direction];
    if (target) { move(item.id, target.id, direction > 0); item.header.focus({ preventScroll: true }); item.header.scrollIntoView({ block: 'nearest' }); }
  }
  function dragStart(e) { if (itemAt(e.target)) e.preventDefault(); }
  function blur() { finish(); }
  root.addEventListener('pointerdown', down);
  doc.addEventListener('pointermove', pointerMove, { passive: false });
  doc.addEventListener('pointerup', up);
  doc.addEventListener('pointercancel', cancel);
  root.addEventListener('lostpointercapture', cancel);
  root.addEventListener('click', click, true);
  doc.addEventListener('keydown', key, true);
  root.addEventListener('dragstart', dragStart);
  win.addEventListener('blur', blur);
  return () => {
    finish();
    root.removeEventListener('pointerdown', down);
    doc.removeEventListener('pointermove', pointerMove);
    doc.removeEventListener('pointerup', up);
    doc.removeEventListener('pointercancel', cancel);
    root.removeEventListener('lostpointercapture', cancel);
    root.removeEventListener('click', click, true);
    doc.removeEventListener('keydown', key, true);
    root.removeEventListener('dragstart', dragStart);
    win.removeEventListener('blur', blur);
  };
}
