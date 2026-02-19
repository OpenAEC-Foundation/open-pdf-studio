import { createSignal, onMount, onCleanup, For } from 'solid-js';
import { state } from '../../../core/state.js';
import { applyTheme, savePreferences } from '../../../core/preferences.js';
import { currentTheme } from '../../stores/ribbonStore.js';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', swatches: ['#1a1a2e', '#16213e', '#e94560', '#eaeaea'] },
  { value: 'light', label: 'Light', swatches: ['#f5f5f5', '#ffffff', '#e94560', '#1f2937'] },
  { value: 'dark', label: 'Dark', swatches: ['#1a1a2e', '#16213e', '#e94560', '#eaeaea'] },
  { value: 'blue', label: 'Blue', swatches: ['#0d1b2a', '#1b263b', '#00b4d8', '#e0e1dd'] },
  { value: 'highContrast', label: 'High Contrast', swatches: ['#000000', '#0a0a0a', '#ffff00', '#ffffff'] },
];

export default function ThemePicker() {
  const [open, setOpen] = createSignal(false);
  let pickerRef;

  onMount(() => {
    const handler = (e) => {
      if (pickerRef && !pickerRef.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handler);
    onCleanup(() => document.removeEventListener('click', handler));
  });

  const getLabel = () => {
    const theme = currentTheme();
    return THEME_OPTIONS.find(t => t.value === theme)?.label || 'Dark';
  };

  const getSwatches = () => {
    const theme = currentTheme();
    return THEME_OPTIONS.find(t => t.value === theme)?.swatches || THEME_OPTIONS[2].swatches;
  };

  function selectTheme(option) {
    state.preferences.theme = option.value;
    applyTheme(option.value);
    savePreferences();
    setOpen(false);
  }

  return (
    <div class="ribbon-input-group" style={{ 'justify-content': 'center' }}>
      <label class="ribbon-input-label">Theme</label>
      <div class="theme-picker" id="theme-picker" ref={pickerRef}>
        <button
          class="theme-picker-toggle"
          id="theme-picker-toggle"
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}
        >
          <span class="theme-picker-swatches">
            <For each={getSwatches()}>
              {(color) => <span class="theme-swatch" style={{ background: color }}></span>}
            </For>
          </span>
          <span class="theme-picker-label">{getLabel()}</span>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="10" height="10">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <div class={`theme-picker-dropdown${open() ? ' open' : ''}`} id="theme-picker-dropdown" onClick={(e) => e.stopPropagation()}>
          <For each={THEME_OPTIONS}>
            {(option) => (
              <div
                class={`theme-picker-option${option.value === currentTheme() ? ' selected' : ''}`}
                data-theme-value={option.value}
                onClick={() => selectTheme(option)}
              >
                <span class="theme-picker-option-swatches">
                  <For each={option.swatches}>
                    {(color) => <span class="theme-swatch" style={{ background: color }}></span>}
                  </For>
                </span>
                <span class="theme-picker-option-label">{option.label}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
