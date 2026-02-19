import { Show, For, createMemo } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import { systemFontList } from '../../stores/fontStore.js';
import { ensureFontInStore } from '../../../utils/fonts.js';

const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

export default function TextFormatSection() {
  const isLocked = () => annotProps.locked;

  const fonts = createMemo(() => {
    const currentFont = annotProps.fontFamily;
    if (currentFont) {
      ensureFontInStore(currentFont);
    }
    return systemFontList();
  });

  const fontSizeOptions = () => {
    const sizes = [...FONT_SIZE_OPTIONS];
    const current = annotProps.textFontSize;
    if (current && !sizes.includes(current)) {
      sizes.push(current);
      sizes.sort((a, b) => a - b);
    }
    return sizes;
  };

  return (
    <Show when={sectionVis.textFormat}>
      <CollapsibleSection title="Character" name="textFormat" id="prop-text-format-section">
        <ColorPalettePicker
          label="Text Color"
          color={() => annotProps.textColor}
          showNone={false}
          disabled={isLocked()}
          onColorChange={(color) => updateAnnotProp('textColor', color)}
        />

        <div class="property-group">
          <label>Font</label>
          <select value={annotProps.fontFamily} disabled={isLocked()}
            onChange={(e) => updateAnnotProp('fontFamily', e.target.value)}>
            <For each={fonts()}>
              {(font) => <option value={font} style={{ 'font-family': `'${font}', sans-serif` }}>{font}</option>}
            </For>
          </select>
        </div>

        <div class="property-group">
          <label>Font Size</label>
          <select value={annotProps.textFontSize} disabled={isLocked()}
            onChange={(e) => updateAnnotProp('textFontSize', e.target.value)}>
            <For each={fontSizeOptions()}>
              {(size) => <option value={size}>{size} pt</option>}
            </For>
          </select>
        </div>

        <div class="property-group">
          <label>Style</label>
          <div class="text-style-buttons">
            <button type="button" class={`text-style-btn${annotProps.fontBold ? ' active' : ''}`}
              title="Bold" disabled={isLocked()}
              onClick={() => updateAnnotProp('fontBold', !annotProps.fontBold)}>
              <strong>B</strong>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontItalic ? ' active' : ''}`}
              title="Italic" disabled={isLocked()}
              onClick={() => updateAnnotProp('fontItalic', !annotProps.fontItalic)}>
              <em>I</em>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontUnderline ? ' active' : ''}`}
              title="Underline" disabled={isLocked()}
              onClick={() => updateAnnotProp('fontUnderline', !annotProps.fontUnderline)}>
              <u>U</u>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontStrikethrough ? ' active' : ''}`}
              title="Strikethrough" disabled={isLocked()}
              onClick={() => updateAnnotProp('fontStrikethrough', !annotProps.fontStrikethrough)}>
              <s>S</s>
            </button>
          </div>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
