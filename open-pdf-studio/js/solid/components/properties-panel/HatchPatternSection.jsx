import { Show, For, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  HATCH_CATEGORIES,
  listHatchPatternsByCategory,
  getHatchSwatchDataUrl,
} from '../../../annotations/rendering/hatch-patterns.js';

// Stable category ordering for the picker
const CATEGORY_ORDER = ['basic', 'hatching', 'material', 'geometric', 'nen47'];

// Resolve a CSS theme variable to a concrete colour (canvas swatches can't
// use var() — they need real values).
function _cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (_) {
    return fallback;
  }
}

// Rough relative luminance for #rrggbb / rgb(…) strings; unknown → light.
function _lum(c) {
  const s = String(c || '').trim();
  let r, g, b;
  const hex = /^#?([0-9a-f]{6})$/i.exec(s);
  const rgb = /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else if (rgb) {
    r = +rgb[1]; g = +rgb[2]; b = +rgb[3];
  } else {
    return 1;
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Display-only swatch colours: theme surface as backdrop; when BOTH the theme
// and the hatch colour are dark, draw the lines in the theme text colour so
// the pattern stays readable. The annotation's real colours are untouched.
export function hatchSwatchColors(hatchColor) {
  const bg = _cssVar('--theme-surface', '#ffffff');
  let line = hatchColor || '#000000';
  if (_lum(bg) < 0.45 && _lum(line) < 0.4) {
    line = _cssVar('--theme-text', '#e8e8e8');
  }
  return { bg, line };
}

export default function HatchPatternSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  const grouped = createMemo(() => listHatchPatternsByCategory());

  const [pickerOpen, setPickerOpen] = createSignal(false);
  // Button ref + computed dropdown position (Portal needs absolute viewport
  // coords because it's rendered outside the panel's overflow:hidden context).
  let buttonRef = null;
  const [dropdownPos, setDropdownPos] = createSignal({ top: 0, right: 0 });

  // Recompute Portal position whenever the dropdown opens AND on scroll/resize
  // (so it tracks the button if the user scrolls the property panel).
  function updateDropdownPos() {
    if (!buttonRef) return;
    const r = buttonRef.getBoundingClientRect();
    setDropdownPos({ top: r.bottom, right: window.innerWidth - r.right });
  }
  createEffect(() => {
    if (pickerOpen()) {
      updateDropdownPos();
      // Listen for window resize + any scroll (capture phase catches scrolls
      // in inner panels too).
      window.addEventListener('resize', updateDropdownPos);
      window.addEventListener('scroll', updateDropdownPos, true);
      // Close-on-outside-click — without this the Portal-rendered dropdown
      // doesn't auto-close when the user clicks elsewhere (it's not a child
      // of the button anymore so the existing click-outside detector on the
      // section doesn't see it either).
      const onDocClick = (e) => {
        if (buttonRef && buttonRef.contains(e.target)) return;
        if (e.target.closest('.hatch-pattern-portal-dropdown')) return;
        setPickerOpen(false);
      };
      document.addEventListener('mousedown', onDocClick, true);
      onCleanup(() => {
        window.removeEventListener('resize', updateDropdownPos);
        window.removeEventListener('scroll', updateDropdownPos, true);
        document.removeEventListener('mousedown', onDocClick, true);
      });
    }
  });

  const patternLabel = (id) => {
    const key = `appearance.hatchPatterns.${id}`;
    const translated = t(key);
    // i18next returns the key itself when missing — fall back to the id
    return translated && translated !== key ? translated : id;
  };

  const currentSwatch = () => {
    const p = annotProps.hatchPattern;
    if (!p || p === 'none' || p === 'mixed') return '';
    const { bg, line } = hatchSwatchColors(annotProps.hatchColor);
    return getHatchSwatchDataUrl(p, line, 16, bg);
  };

  const selectPattern = (id) => {
    updateAnnotProp('hatchPattern', id);
    setPickerOpen(false);
  };

  return (
    <Show when={sectionVis.hatchPatternGroup}>
      <CollapsibleSection title={t('appearance.hatchPattern')} name="hatchPattern" id="prop-hatch-pattern-section">
        <div class="property-group">
          <label>{t('appearance.hatchPattern')}</label>
          {/* Wrapper takes flex:1 so the button column fills available space.
              Without explicit flex the wrapper sized to button's natural
              content width ("None ▾") leaving big whitespace next to it. */}
          <div style={{ position: 'relative', flex: '1', 'min-width': '0' }}>
            <button
              ref={el => (buttonRef = el)}
              type="button"
              disabled={isLocked()}
              onDblClick={cycleSelectNext}
              onClick={() => setPickerOpen(!pickerOpen())}
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '6px',
                width: '100%',
                'text-align': 'left',
                padding: '2px 6px',
                background: 'var(--theme-surface, #fff)',
                color: 'var(--theme-text, #333)',
                border: '1px solid var(--theme-border, #7a7a7a)',
                'border-radius': '0',
                cursor: isLocked() ? 'default' : 'pointer',
                font: 'inherit',
              }}
            >
              <Show when={annotProps.hatchPattern && annotProps.hatchPattern !== 'none' && annotProps.hatchPattern !== 'mixed'}>
                <img src={currentSwatch()} alt="" style={{ width: '16px', height: '16px', 'image-rendering': 'pixelated' }} />
              </Show>
              <span style={{ flex: '1' }}>
                {annotProps.hatchPattern === 'mixed'
                  ? tCommon('mixed')
                  : (!annotProps.hatchPattern || annotProps.hatchPattern === 'none'
                      ? tCommon('none')
                      : patternLabel(annotProps.hatchPattern))}
              </span>
              <span style={{ 'font-size': '10px' }}>{'▾'}</span>
            </button>
            <Show when={pickerOpen() && !isLocked()}>
              {/* Render via Portal because .properties-panel-outer has
                  overflow:hidden — a wide dropdown anchored inside the
                  panel gets clipped at the panel's left edge. Portal moves
                  the dropdown out to <body>, freeing it to extend into
                  the canvas area where pattern names can be fully read. */}
              <Portal>
                <div
                  class="hatch-pattern-portal-dropdown"
                  style={{
                    position: 'fixed',
                    top: `${dropdownPos().top}px`,
                    right: `${dropdownPos().right}px`,
                    width: '320px',
                    'max-height': '420px',
                    'overflow-y': 'auto',
                    background: 'var(--theme-surface, #fff)',
                    color: 'var(--theme-text, #333)',
                    border: '1px solid var(--theme-border, #7a7a7a)',
                    'box-shadow': '2px 2px 6px rgba(0,0,0,0.25)',
                    'z-index': 2000,
                  }}
                >
                <PatternRow
                  active={!annotProps.hatchPattern || annotProps.hatchPattern === 'none'}
                  onClick={() => selectPattern('none')}
                  label={tCommon('none')}
                />
                <For each={CATEGORY_ORDER}>
                  {(cat) => (
                    <Show when={grouped()[cat] && grouped()[cat].length > 0}>
                      <div style={{
                        padding: '4px 8px',
                        background: 'var(--theme-bg, #f5f5f5)',
                        color: 'var(--theme-text, #333)',
                        'border-bottom': '1px solid var(--theme-border, #d4d4d4)',
                        'border-top': '1px solid var(--theme-border, #d4d4d4)',
                        'font-weight': 'bold',
                        'font-size': '11px',
                      }}>
                        {(() => {
                          const k = `appearance.hatchCategories.${cat}`;
                          const v = t(k);
                          return v && v !== k ? v : cat;
                        })()}
                      </div>
                      <For each={grouped()[cat]}>
                        {(p) => (
                          <PatternRow
                            active={annotProps.hatchPattern === p.id}
                            onClick={() => selectPattern(p.id)}
                            swatch={(() => { const c = hatchSwatchColors(annotProps.hatchColor); return getHatchSwatchDataUrl(p.id, c.line, 16, c.bg); })()}
                            label={patternLabel(p.id)}
                          />
                        )}
                      </For>
                    </Show>
                  )}
                </For>
                </div>
              </Portal>
            </Show>
          </div>
        </div>
        <Show when={annotProps.hatchPattern && annotProps.hatchPattern !== 'none'}>
          <ColorPalettePicker
            label={t('appearance.hatchColor')}
            color={() => annotProps.hatchColor}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('hatchColor', color)}
          />
          <div class="property-group">
            <label>{t('appearance.hatchScale')}</label>
            <PrefComboBox
              value={() => annotProps.hatchScale}
              setValue={(val) => updateAnnotProp('hatchScale', val)}
              options={[50, 75, 100, 125, 150, 175, 200]}
              min={25} max={400} fallback={100} suffix="%"
              disabled={isLocked}
            />
          </div>
          <div class="property-group">
            <label>{t('appearance.hatchAngle')}</label>
            <PrefComboBox
              value={() => annotProps.hatchAngle}
              setValue={(val) => updateAnnotProp('hatchAngle', val)}
              options={[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]}
              min={0} max={180} fallback={45} step={5} suffix="°"
              disabled={isLocked}
            />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}

function PatternRow(props) {
  return (
    <div
      onClick={props.onClick}
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '3px 8px',
        cursor: 'pointer',
        background: props.active ? 'var(--theme-accent-soft, #cce4f7)' : 'transparent',
        color: 'var(--theme-text, #333)',
      }}
      onMouseEnter={(e) => { if (!props.active) e.currentTarget.style.background = 'var(--theme-hover, #e6f0fa)'; }}
      onMouseLeave={(e) => { if (!props.active) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ width: '16px', height: '16px', 'flex-shrink': '0' }}>
        <Show when={props.swatch}>
          <img src={props.swatch} alt="" style={{ width: '16px', height: '16px', 'image-rendering': 'pixelated' }} />
        </Show>
      </div>
      <span style={{ 'font-size': '12px' }}>{props.label}</span>
    </div>
  );
}
