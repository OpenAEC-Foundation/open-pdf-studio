import { Show, createEffect } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Vrije hand (#385): pendruk aan/uit, minimale breedte en gladheid.
export default function InkSection() {
  const { t } = useTranslation('properties');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={sectionVis.ink}>
      <CollapsibleSection title={t('ink.title')} name="ink" id="prop-ink-section">
        <div class="property-group" title={t('ink.pressureHint')}>
          <label for="prop-ink-pressure">{t('ink.pressure')}</label>
          <input type="checkbox" id="prop-ink-pressure"
            checked={annotProps.inkPressure === true}
            ref={(el) => createEffect(() => { el.indeterminate = annotProps.inkPressure === 'mixed'; })}
            disabled={isLocked()}
            onChange={(e) => updateAnnotProp('inkPressure', e.target.checked)} />
        </div>

        <div class="property-group" title={t('ink.minWidthHint')}>
          <label>{t('ink.minWidth')}</label>
          <PrefComboBox
            value={() => annotProps.inkMinWidth}
            setValue={(val) => updateAnnotProp('inkMinWidth', val)}
            options={[10, 20, 30, 40, 50, 75, 100]}
            min={5} max={100} fallback={30} suffix="%"
            disabled={() => isLocked() || annotProps.inkPressure === false}
          />
        </div>

        <div class="property-group" title={t('ink.smoothingHint')}>
          <label>{t('ink.smoothing')}</label>
          <PrefComboBox
            value={() => annotProps.inkSmoothing}
            setValue={(val) => updateAnnotProp('inkSmoothing', val)}
            options={[0, 25, 50, 75, 100]}
            min={0} max={100} fallback={0}
            disabled={isLocked}
          />
        </div>
      </CollapsibleSection>
    </Show>
  );
}
