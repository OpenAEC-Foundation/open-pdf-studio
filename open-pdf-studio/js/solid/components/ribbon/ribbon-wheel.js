// Wheel navigation has hard ends, unlike the wrapping keyboard tab order.
export function wheelTab(tabs, active, event) {
  if (event.defaultPrevented || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey
      || !Number.isFinite(event.deltaY) || event.deltaY === 0
      || Math.abs(event.deltaX || 0) > Math.abs(event.deltaY)) return null;
  const index = tabs.indexOf(active === 'measure' ? 'comment' : active);
  if (index < 0) return null;
  return tabs[Math.max(0, Math.min(tabs.length - 1, index + Math.sign(event.deltaY)))];
}

const OWN_WHEEL = [
  'input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])',
  '[role="menu"]', '[role="listbox"]', '[role="combobox"]', '[role="dialog"]',
  '.ribbon-menu-dropdown', '.ribbon-color-dropdown', '.ribbon-split-btn-menu', '.theme-picker-dropdown',
  '.ribbon-style-gallery', '.ribbon-style-more-popup', '.ribbon-overflow-flyout',
].join(',');

export function ownsWheel(target, root) {
  if (target.closest?.(OWN_WHEEL)) return true;
  // Also respect scrollable extension lists without application-specific classes.
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight
        && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) return true;
  }
  return false;
}

export function bindRibbonWheel(root, tablist, enabled, active) {
  const onWheel = event => {
    // The document's wheel handlers must never receive ribbon gestures.
    // Keep native scrolling/number inputs intact by not cancelling their default.
    event.stopPropagation();
    if (!enabled() || ownsWheel(event.target, root)) return;
    const buttons = [...tablist.querySelectorAll('.ribbon-tab[role="tab"]')]
      .filter(button => !button.disabled && button.getClientRects().length
        && getComputedStyle(button).visibility !== 'hidden');
    const next = wheelTab(buttons.map(button => button.dataset.tab), active(), event);
    if (!next) return;
    event.preventDefault(); // also at the ends: do not scroll the page behind the ribbon
    const button = buttons.find(button => button.dataset.tab === next);
    if (button.getAttribute('aria-selected') === 'true') return;
    const focusInTabs = tablist.contains(document.activeElement);
    button.click(); // use the same activation path for built-in and extension tabs
    if (focusInTabs) button.focus({ preventScroll: true });
  };
  root.addEventListener('wheel', onWheel, { passive: false });
  return () => root.removeEventListener('wheel', onWheel);
}
