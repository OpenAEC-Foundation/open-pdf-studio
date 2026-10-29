// One floating pair of buttons serves all locale-aware numeric fields.
// Do not reparent framework-owned inputs or change their event/validation path.
export function installeerGetalStappen(doc) {
  const win = doc.defaultView;
  const controls = doc.createElement('span');
  controls.className = 'numeric-field-controls';
  controls.style.display = 'none';
  let active = null, frame = 0;
  const buttons = [1, -1].map(direction => {
    const button = doc.createElement('button');
    button.type = 'button'; button.tabIndex = -1;
    button.textContent = direction > 0 ? '▴' : '▾';
    button.addEventListener('pointerdown', e => e.preventDefault());
    button.addEventListener('click', () => {
      if (!active?.isConnected || active.disabled || active.readOnly) return;
      active.focus({ preventScroll: true });
      // Same behaviour as the field's arrow keys, including custom handlers,
      // fractional step sizes, bounds, locale parsing and input/change events.
      active.dispatchEvent(new win.KeyboardEvent('keydown', {
        key: direction > 0 ? 'ArrowUp' : 'ArrowDown', bubbles: true, cancelable: true,
      }));
    });
    controls.append(button);
    return button;
  });
  doc.body.append(controls);

  function hide() {
    active?.classList.remove('numeric-field-stepping');
    active = null;
    controls.style.display = 'none';
  }
  function position() {
    frame = 0;
    if (!active?.isConnected || active.disabled || active.readOnly) { hide(); return; }
    const r = active.getBoundingClientRect();
    const rtl = win.getComputedStyle(active).direction === 'rtl';
    const x = rtl ? r.left + 9 : r.right - 9, y = r.top + r.height / 2;
    // Hidden, clipped or covered inputs must not leave clickable floating arrows.
    const hit = doc.elementFromPoint(x, y);
    if (r.width < 24 || r.height < 16 || !hit || (hit !== active && !controls.contains(hit))) { hide(); return; }
    controls.style.left = `${rtl ? r.left + 1 : r.right - 17}px`;
    controls.style.top = `${r.top + 1}px`;
    controls.style.height = `${r.height - 2}px`;
    controls.style.display = 'flex';
  }
  function schedule() {
    if (active && !frame) frame = win.requestAnimationFrame(position);
  }
  function show(el) {
    if (!el?.matches?.('input[data-getal]') || el.disabled || el.readOnly
      || el.closest('.watermark-spin, .number-stepper')) return;
    if (active !== el) {
      hide(); active = el; active.classList.add('numeric-field-stepping');
      const label = el.getAttribute('aria-label') || el.labels?.[0]?.textContent?.trim() || el.title || '';
      const step = el.getAttribute('step');
      const increment = step && step !== 'any' ? step : '1';
      buttons[0].setAttribute('aria-label', `${label} +${increment}`.trim());
      buttons[1].setAttribute('aria-label', `${label} −${increment}`.trim());
    }
    schedule();
  }
  doc.addEventListener('pointerover', e => show(e.target));
  doc.addEventListener('focusin', e => {
    if (!controls.contains(e.target)) { hide(); show(e.target); }
  });
  doc.addEventListener('pointerout', e => {
    if (!active || doc.activeElement === active) return;
    if (e.relatedTarget === active || controls.contains(e.relatedTarget)) return;
    if (e.target === active || controls.contains(e.target)) hide();
  });
  doc.addEventListener('focusout', () => queueMicrotask(() => {
    if (active && doc.activeElement !== active && !controls.contains(doc.activeElement)) hide();
  }));
  doc.addEventListener('scroll', schedule, true);
  doc.addEventListener('pointermove', schedule);
  win.addEventListener('resize', schedule);
  new win.MutationObserver(() => { if (active && !active.isConnected) hide(); })
    .observe(doc.body, { childList: true, subtree: true });
}
