// Eigenschappen-sectie voor de stavenreeks (wapeningsstaven-reeks).
//
// Toont aantal (stepper), diameter (vaste lijst 6–40 mm), staaflengte in mm,
// pootrichting (4 knoppen), pootlengte en labelzijde. Schrijft terug via
// updateAnnotProp('sr…'), dat de waarden op de annotatie zet; de geometrie
// volgt automatisch bij het renderen uit start/eind + deze parameters.
import { Show, For } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { STAVENREEKS_DIAMETERS, labelText } from '../../../annotations/stavenreeks.js';

// Pootrichting: {boven|onder} × {links|rechts hellend}. De pijltjes tonen de
// stand van de poot t.o.v. de reekslijn.
const LEG_DIRS = [
  { value: 'up-left', glyph: '↖' },
  { value: 'up-right', glyph: '↗' },
  { value: 'down-left', glyph: '↙' },
  { value: 'down-right', glyph: '↘' },
];

export default function StavenreeksSection() {
  const { t } = useTranslation('properties');
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={annotProps.annotationType === 'stavenreeks'}>
      <CollapsibleSection title={t('stavenreeks.title')} name="stavenreeks" id="prop-stavenreeks-section">
        {/* Voorbeeld van het label zoals het getekend wordt */}
        <div class="property-group">
          <label>{t('stavenreeks.label')}</label>
          <input type="text" readonly id="prop-sr-preview"
            value={labelText(annotProps.srCount, annotProps.srDiameter)} />
        </div>

        <div class="property-group">
          <label>{t('stavenreeks.count')}</label>
          <input type="number" id="prop-sr-count" step="1" min="1" max="999"
            value={annotProps.srCount}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('srCount', e.target.value)}
          />
        </div>

        <div class="property-group">
          <label>{t('stavenreeks.diameter')}</label>
          <select id="prop-sr-diameter"
            value={annotProps.srDiameter}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('srDiameter', e.target.value)}
          >
            <For each={STAVENREEKS_DIAMETERS}>{(d) => (
              <option value={d}>{`⌀ ${d}`}</option>
            )}</For>
          </select>
        </div>

        <div class="property-group">
          <label>{t('stavenreeks.barLength')}</label>
          <input type="number" id="prop-sr-barlength" step="10" min="0"
            value={annotProps.srBarLengthMm}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('srBarLengthMm', e.target.value)}
          />
        </div>

        <div class="property-group">
          <label>{t('stavenreeks.legDirection')}</label>
          <div class="button-row" id="prop-sr-legdir">
            <For each={LEG_DIRS}>{(d) => (
              <button type="button"
                id={`prop-sr-legdir-${d.value}`}
                class={annotProps.srLegDir === d.value ? 'active' : ''}
                title={t(`stavenreeks.legDir.${d.value}`)}
                disabled={locked()}
                onClick={() => updateAnnotProp('srLegDir', d.value)}
              >{d.glyph}</button>
            )}</For>
          </div>
        </div>

        <div class="property-group">
          <label>{t('stavenreeks.legLength')}</label>
          <input type="number" id="prop-sr-leglength" step="1" min="1" max="200"
            value={annotProps.srLegLength}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('srLegLength', e.target.value)}
          />
        </div>

        {/* Uitloop: hoever de aanhaallijn aan de labelzijde voorbij de laatste
            poot doorloopt vóórdat het label begint. 0 = lijn stopt op de poot. */}
        <div class="property-group">
          <label>{t('stavenreeks.lineTail')}</label>
          <input type="number" id="prop-sr-linetail" step="1" min="0" max="200"
            value={annotProps.srLineTail}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('srLineTail', e.target.value)}
          />
        </div>

        {/* Tekstgrootte van het label "N ⌀ D" (papier-constant, app-px). */}
        <div class="property-group">
          <label>{t('stavenreeks.fontSize')}</label>
          <input type="number" id="prop-sr-fontsize" step="1" min="6" max="72"
            value={annotProps.srFontSize}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('srFontSize', e.target.value)}
          />
        </div>

        <div class="property-group">
          <label>{t('stavenreeks.labelSide')}</label>
          <select id="prop-sr-labelside"
            value={annotProps.srLabelSide}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('srLabelSide', e.target.value)}
          >
            <option value="start">{t('stavenreeks.labelSideStart')}</option>
            <option value="end">{t('stavenreeks.labelSideEnd')}</option>
          </select>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
