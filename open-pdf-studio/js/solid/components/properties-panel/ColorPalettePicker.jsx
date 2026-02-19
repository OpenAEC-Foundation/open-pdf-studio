import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';
import { PALETTE_COLUMNS } from '../../stores/formatStore.js';

export default function ColorPalettePicker(props) {
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

  const colorPreviewStyle = () => {
    const c = props.color?.();
    if (!c && props.showNone) {
      const surfaceColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--theme-surface').trim() || '#fff';
      return {
        background: `linear-gradient(135deg, ${surfaceColor} 45%, #ff0000 45%, #ff0000 55%, ${surfaceColor} 55%)`
      };
    }
    return { 'background-color': c || '#000000' };
  };

  const hexDisplay = () => {
    const c = props.color?.();
    if (!c && props.showNone) return 'None';
    return (c || '#000000').toUpperCase();
  };

  return (
    <div class="property-group" ref={wrapperRef}>
      <label>{props.label}</label>
      <div class="color-palette-wrapper">
        <button type="button" class="color-picker-button"
          disabled={props.disabled}
          onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}>
          <div class="color-preview" style={colorPreviewStyle()} />
          <span class="color-hex">{hexDisplay()}</span>
          <svg class="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <div class={`color-palette-dropdown${open() ? ' show' : ''}`}>
          <Show when={props.showNone}>
            <button type="button" class="color-none-btn"
              onClick={(e) => {
                e.stopPropagation();
                props.onNone?.();
                setOpen(false);
              }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="4" y1="4" x2="20" y2="20"/>
              </svg>
              None
            </button>
          </Show>
          <div class="color-palette" style="display: flex; gap: 2px; padding: 2px;">
            <For each={PALETTE_COLUMNS}>
              {(columnColors) => (
                <div class="color-column" style="display: flex; flex-direction: column; gap: 1px; padding: 1px; background: var(--theme-border); border-radius: 2px;">
                  <For each={columnColors}>
                    {(color) => (
                      <div
                        class="color-swatch"
                        style={{
                          width: '20px',
                          height: '20px',
                          'background-color': color,
                          border: '1px solid rgba(0,0,0,0.15)',
                          cursor: 'pointer',
                          'border-radius': '2px'
                        }}
                        title={color}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onColorChange?.(color);
                          setOpen(false);
                        }}
                        onMouseEnter={(e) => { e.target.style.transform = 'scale(1.2)'; e.target.style.zIndex = '1'; }}
                        onMouseLeave={(e) => { e.target.style.transform = 'scale(1)'; e.target.style.zIndex = '0'; }}
                      />
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
          <button type="button" class="color-custom-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (hiddenInput) {
                hiddenInput.value = props.color?.() || '#ffffff';
                hiddenInput.click();
              }
              setOpen(false);
            }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2a10 10 0 0 1 0 20"/>
            </svg>
            More Colors...
          </button>
        </div>
        <input
          ref={hiddenInput}
          type="color"
          style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;"
          onInput={(e) => props.onColorChange?.(e.target.value)}
        />
      </div>
    </div>
  );
}
