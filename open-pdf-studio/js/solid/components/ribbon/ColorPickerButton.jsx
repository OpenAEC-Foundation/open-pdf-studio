import { createSignal, onMount, onCleanup, For } from 'solid-js';
import { PALETTE_COLUMNS } from '../../stores/formatStore.js';

export default function ColorPickerButton(props) {
  const [open, setOpen] = createSignal(false);
  let wrapperRef;
  let hiddenInput;

  onMount(() => {
    const handler = (e) => {
      if (wrapperRef && !wrapperRef.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  return (
    <div class="ribbon-color-picker-wrapper" ref={wrapperRef}>
      <button
        class="ribbon-btn medium ribbon-color-btn"
        id={props.id}
        title={props.title}
        onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}
      >
        <div class="ribbon-btn-icon" ref={el => { if (props.iconSvg) el.innerHTML = props.iconSvg; }}></div>
        <span class="ribbon-btn-label">{props.label}</span>
        <svg class="ribbon-color-dd-arrow" viewBox="0 0 8 5"><path d="M0 0l4 4 4-4z" fill="currentColor"/></svg>
      </button>
      <div class={`ribbon-color-dropdown${open() ? ' show' : ''}`} id={props.dropdownId}>
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
