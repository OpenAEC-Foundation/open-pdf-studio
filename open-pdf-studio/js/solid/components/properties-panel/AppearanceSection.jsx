import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, updateOpacity, getLineWidthLabel } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';

export default function AppearanceSection() {
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.appearance}>
      <CollapsibleSection title="Appearance" name="appearance" id="prop-appearance-section">
        <Show when={sectionVis.iconGroup}>
          <div class="property-group">
            <label>Icon</label>
            <select value={annotProps.icon} disabled={isLocked()}
              onChange={(e) => updateAnnotProp('icon', e.target.value)}>
              <option value="comment">Comment</option>
              <option value="note">Note</option>
              <option value="help">Help</option>
              <option value="insert">Insert</option>
              <option value="key">Key</option>
              <option value="newparagraph">New Paragraph</option>
              <option value="paragraph">Paragraph</option>
              <option value="check">Check</option>
              <option value="circle">Circle</option>
              <option value="cross">Cross</option>
              <option value="star">Star</option>
            </select>
          </div>
        </Show>

        <Show when={sectionVis.fillColorGroup}>
          <ColorPalettePicker
            label="Fill Color"
            color={() => annotProps.fillColor}
            showNone={true}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('fillColor', color)}
            onNone={() => updateAnnotProp('fillColor', null)}
          />
        </Show>

        <Show when={sectionVis.strokeColorGroup}>
          <ColorPalettePicker
            label="Stroke Color"
            color={() => annotProps.strokeColor}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('strokeColor', color)}
          />
        </Show>

        <Show when={sectionVis.colorGroup}>
          <ColorPalettePicker
            label="Color"
            color={() => annotProps.color}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('color', color)}
          />
        </Show>

        <Show when={sectionVis.opacityGroup}>
          <div class="property-group">
            <label>Opacity</label>
            <div class="opacity-slider-wrapper">
              <input type="range" min="0" max="100"
                value={annotProps.opacity}
                disabled={isLocked()}
                onInput={(e) => updateOpacity(e.target.value, e.ctrlKey)} />
              <span>{annotProps.opacity}%</span>
            </div>
          </div>
        </Show>

        <Show when={sectionVis.lineWidthGroup}>
          <div class="property-group">
            <label>{getLineWidthLabel()}</label>
            <select class="ribbon-input" value={annotProps.lineWidth} disabled={isLocked()}
              onChange={(e) => updateAnnotProp('lineWidth', e.target.value)}>
              <option value="0">0</option>
              <option value="0.5">0.5</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="6">6</option>
              <option value="8">8</option>
              <option value="10">10</option>
              <option value="12">12</option>
            </select>
          </div>
        </Show>

        <Show when={sectionVis.borderStyleGroup}>
          <div class="property-group">
            <label>Border Style</label>
            <select value={annotProps.borderStyle} disabled={isLocked()}
              onChange={(e) => updateAnnotProp('borderStyle', e.target.value)}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
