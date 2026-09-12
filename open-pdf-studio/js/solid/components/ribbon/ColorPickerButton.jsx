import { createSignal, createEffect, onMount, onCleanup, For } from 'solid-js';
import { PALETTE_COLUMNS } from '../../stores/formatStore.js';
import { autoShrinkLabel } from './autoShrinkLabel.js';

export default function ColorPickerButton(props) {
  const [open, setOpen] = createSignal(false);
  let wrapperRef;
  let btnRef;
  let dropdownRef;
  let hiddenInput;

  onMount(() => {
    const handler = (e) => {
      if (wrapperRef && !wrapperRef.contains(e.target) && dropdownRef && !dropdownRef.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  // The ribbon tab's adaptive-groups container clips overflow (needed for
  // its own "More" button — see AdaptiveGroups.jsx), which was silently
  // cutting the bottom rows off this dropdown whenever the palette didn't
  // fit inside the ribbon strip's remaining height. position:fixed escapes
  // that clip entirely; same fix already used for the overflow flyout.
  function reposition() {
    if (!dropdownRef || !btnRef) return;
    const btn = btnRef.getBoundingClientRect();
    dropdownRef.style.left = '0px';
    dropdownRef.style.top = '-9999px';
    const dw = dropdownRef.offsetWidth;
    const dh = dropdownRef.offsetHeight;
    let left = Math.round(btn.left);
    left = Math.max(4, Math.min(left, window.innerWidth - dw - 4));
    let top = Math.round(btn.bottom);
    if (top + dh > window.innerHeight - 4) top = Math.max(4, Math.round(btn.top) - dh);
    dropdownRef.style.left = left + 'px';
    dropdownRef.style.top = top + 'px';
  }

  createEffect(() => {
    if (open()) {
      // Layout on the just-shown dropdown needs a frame before its real
      // offsetWidth/Height are available to measure against.
      requestAnimationFrame(reposition);
    }
  });

  onMount(() => {
    const onScrollOrResize = () => { if (open()) reposition(); };
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    onCleanup(() => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    });
  });

  return (
    <div class="ribbon-color-picker-wrapper" ref={wrapperRef}>
      <button
        class="ribbon-btn medium ribbon-color-btn"
        id={props.id}
        title={props.title}
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}
      >
        <div class="ribbon-btn-icon" ref={el => { if (props.iconSvg) el.innerHTML = props.iconSvg; }}></div>
        <span class="ribbon-btn-label" ref={el => autoShrinkLabel(el)}>{props.label}</span>
        <svg class="ribbon-color-dd-arrow" viewBox="0 0 8 5"><path d="M0 0l4 4 4-4z" fill="currentColor"/></svg>
      </button>
      <div class={`ribbon-color-dropdown${open() ? ' show' : ''}`} id={props.dropdownId} ref={dropdownRef}>
        <div class="ribbon-color-palette" id={props.paletteId}>
          <For each={PALETTE_COLUMNS}>
            {(columnColors) => (
              <div class="color-column">
                <For each={columnColors}>
                  {(color) => (
                    <div
                      class="color-swatch"
                      style={{ 'background-color': color }}
                      title={color}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onColorSelect?.(color);
                        setOpen(false);
                      }}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
        <div class="ribbon-color-dropdown-actions">
          {props.showNoneButton && (
            <button
              class="ribbon-color-none-btn"
              onClick={(e) => {
                e.stopPropagation();
                props.onNone?.();
                setOpen(false);
              }}
            >
              No Fill
            </button>
          )}
          <button
            class="ribbon-color-custom-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (hiddenInput) {
                hiddenInput.value = props.currentColor || '#ffffff';
                hiddenInput.click();
              }
              setOpen(false);
            }}
          >
            Custom...
          </button>
        </div>
      </div>
      <input
        ref={hiddenInput}
        type="color"
        style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;"
        onInput={(e) => props.onCustom?.(e.target.value)}
      />
    </div>
  );
}
