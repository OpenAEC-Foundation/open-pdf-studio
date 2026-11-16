import { createEffect, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { volgPopup } from './ribbon/ribbon-popup.js';

/** Compact quick-access Save with a keyboard-accessible menu of alternatives. */
export default function SaveSplitButton(props) {
  const [open, setOpen] = createSignal(false);
  let container, arrow, menu;
  volgPopup(() => menu, () => container, open);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) arrow?.focus();
  };
  const items = () => [...(menu?.querySelectorAll('button:not(:disabled)') || [])];
  const show = (last = false) => {
    if (props.disabled || props.blocked) return;
    setOpen(true);
    queueMicrotask(() => { if (open()) (last ? items().at(-1) : items()[0])?.focus(); });
  };
  createEffect(() => { if (props.disabled || props.blocked) close(); });
  onMount(() => {
    const outside = e => { if (!container.contains(e.target)) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    });
  });
  const menuKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const buttons = items();
      const current = buttons.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
        : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
    // Keep Tab's native focus movement; focusin closes the menu after it leaves.
  };
  const run = action => { close(true); action(); };
  return (
    <div class="quick-save-split" ref={container}>
      <button class="quick-access-btn" title={`${props.saveLabel} (Ctrl+S)`}
        aria-label={props.saveLabel} disabled={props.disabled || props.readOnly || props.blocked}
        onClick={props.onSave}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12.5 14.5h-9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h7.586a1 1 0 0 1 .707.293l1.414 1.414a1 1 0 0 1 .293.707V13.5a1 1 0 0 1-1 1z"/>
          <path d="M5.5 1.5v3h4v-3"/><rect x="4.5" y="8.5" width="7" height="5"/>
        </svg>
      </button>
      <button class="quick-access-btn quick-save-arrow" ref={arrow}
        title={props.saveLabel} aria-label={props.saveLabel} aria-haspopup="menu"
        aria-expanded={open()} aria-controls="quick-save-menu" disabled={props.disabled || props.blocked}
        onClick={() => open() ? close() : show()}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation(); show(e.key === 'ArrowUp');
          }
        }}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M2 4h8L6 8z"/></svg>
      </button>
      <Show when={open()}>
        <div id="quick-save-menu" class="quick-save-menu" role="menu" aria-label={props.saveLabel}
          ref={menu} onKeyDown={menuKey}>
          <button role="menuitem" onClick={() => run(props.onSaveAs)}>
            <span>{props.saveAsLabel}</span><span class="quick-save-shortcut">Ctrl+Shift+S</span>
          </button>
          <Show when={props.onSaveAsIfcx}>
            <button role="menuitem" id="quick-save-ifcx" onClick={() => run(props.onSaveAsIfcx)}>{props.ifcxLabel}</button>
          </Show>
          <button role="menuitem" onClick={() => run(props.onExport)}>{props.exportLabel}</button>
        </div>
      </Show>
    </div>
  );
}
