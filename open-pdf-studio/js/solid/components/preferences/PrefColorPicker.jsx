import { createSignal, onCleanup } from 'solid-js';

const PALETTE_COLUMNS = [
  ['#ffffff', '#d9d9d9', '#999999', '#666666', '#333333', '#000000'],
  ['#f4cccc', '#ea9999', '#e06666', '#ff0000', '#cc0000', '#660000'],
  ['#fce5cd', '#f9cb9c', '#ffff00', '#ffd966', '#f1c232', '#bf9000'],
  ['#d9ead3', '#b6d7a8', '#93c47d', '#00ff00', '#38761d', '#274e13'],
  ['#d0e0e3', '#a2c4c9', '#76a5af', '#00ffff', '#45818e', '#134f5c'],
  ['#c9daf8', '#6d9eeb', '#4a86e8', '#0000ff', '#1155cc', '#073763'],
  ['#d9d2e9', '#b4a7d6', '#9900ff', '#ff00ff', '#a64d79', '#741b47'],
];

export default function PrefColorPicker(props) {
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  let colorInputRef;
  let wrapperRef;

  function handleDocClick(e) {
    if (wrapperRef && !wrapperRef.contains(e.target)) {
      setDropdownOpen(false);
    }
  }

  document.addEventListener('click', handleDocClick);
  onCleanup(() => document.removeEventListener('click', handleDocClick));

  function selectColor(color) {
    props.setValue(color);
    if (props.setNoneChecked) props.setNoneChecked(false);
    setDropdownOpen(false);
  }

  function handleCustomColor() {
    colorInputRef?.click();
  }

  function handleColorInput(e) {
    props.setValue(e.target.value);
    if (props.setNoneChecked) props.setNoneChecked(false);
  }

  function toggleDropdown(e) {
    if (props.noneChecked?.()) return;
    e.stopPropagation();
    setDropdownOpen(v => !v);
  }

  const isDisabled = () => props.noneChecked?.() || false;

  return (
    <div class="pref-color-row" ref={wrapperRef}>
      {props.noneChecked && (
        <label class="pref-fill-none-checkbox">
          <input
            type="checkbox"
            checked={props.noneChecked()}
            onChange={e => props.setNoneChecked(e.target.checked)}
          />
          <span>None</span>
        </label>
      )}
      <div class="pref-color-wrapper">
        <button
          type="button"
          class="color-picker-button"
          disabled={isDisabled()}
          onClick={toggleDropdown}
        >
          <div class="color-preview" style={{ background: props.value() }}></div>
          <span class="color-hex">{props.value().toUpperCase()}</span>
          <svg class="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <div class="color-palette-dropdown" classList={{ show: dropdownOpen() }}>
          <div class="color-palette" style="display:flex;gap:2px;padding:2px;">
            {PALETTE_COLUMNS.map(col => (
              <div class="color-column" style="display:flex;flex-direction:column;gap:1px;padding:1px;background:var(--theme-border);border-radius:2px;">
                {col.map(color => (
                  <div
                    class="color-swatch"
                    style={{
                      width: '20px',
                      height: '20px',
                      'background-color': color,
                      border: '1px solid rgba(0,0,0,0.15)',
                      cursor: 'pointer',
                      'border-radius': '2px',
                    }}
                    onClick={() => selectColor(color)}
                  />
                ))}
              </div>
            ))}
          </div>
          <button type="button" class="color-custom-btn" onClick={handleCustomColor}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2a10 10 0 0 1 0 20"/>
            </svg>
            More Colors...
          </button>
        </div>
        <input
          type="color"
          ref={colorInputRef}
          value={props.value()}
          onInput={handleColorInput}
          style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;"
        />
      </div>
    </div>
  );
}
