import { Show, For } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Uitloop van de maatlijn en de hulplijnen, in millimeters op papier
// (maatlijn-geometrie.js). Leeg = automatisch.
const PAPIER_MM_VELDEN = [
  ['dimLineOvershootMm', 'measurement.lineOvershoot'],
  ['dimExtGapMm', 'measurement.extGap'],
  ['dimExtOvershootMm', 'measurement.extOvershoot'],
];

function papierMm(waarde) {
  if (waarde === '' || waarde === null || waarde === undefined) return undefined;
  const n = parseFloat(waarde);
  return Number.isFinite(n) ? Math.max(0, n) : undefined;
}

export default function MeasurementSection() {
  const { t } = useTranslation('properties');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={sectionVis.measurement}>
      <CollapsibleSection title={t('measurement.title')} name="measurement" id="prop-measurement-section">
        <Show when={annotProps.type === 'measureArea'}>
          <div class="property-group">
            <label>{t('measurement.name')}</label>
            <input type="text" value={annotProps.measureName}
              placeholder={t('measurement.namePlaceholder')}
              disabled={isLocked()}
              onInput={(e) => updateAnnotProp('measureName', e.target.value)}
            />
          </div>
          <div class="property-group">
            <label>{t('measurement.showLabel')}</label>
            <input type="checkbox"
              checked={annotProps.measureShowLabel !== false}
              disabled={isLocked()}
              onChange={(e) => updateAnnotProp('measureShowLabel', e.target.checked)}
            />
          </div>
        </Show>

        <Show when={annotProps.type === 'measureDistance'}>
          <div class="property-group">
            <label>{t('measurement.extension') || 'Extensie'}</label>
            <input type="checkbox"
              checked={!!annotProps.dimExtension}
              disabled={isLocked()}
              onChange={(e) => updateAnnotProp('dimExtension', e.target.checked)}
            />
          </div>
          <div class="property-group">
            <label>{t('measurement.showUnit')}</label>
            <input type="checkbox"
              checked={annotProps.dimShowUnit !== false}
              disabled={isLocked()}
              onChange={(e) => updateAnnotProp('dimShowUnit', e.target.checked)}
            />
          </div>
          <For each={PAPIER_MM_VELDEN}>{([veld, sleutel]) => (
            <div class="property-group">
              <label>{t(sleutel)}</label>
              <input type="number" step="0.5" min="0"
                value={annotProps[veld] ?? ''}
                placeholder={t('measurement.auto')}
                disabled={isLocked()}
                onChange={(e) => updateAnnotProp(veld, papierMm(e.target.value))}
              />
            </div>
          )}</For>
        </Show>

        <div class="property-group">
          <label>{t('measurement.scale')}</label>
          <input type="number" step="0.001" min="0"
            value={annotProps.measureScale || ''}
            placeholder={t('measurement.scaleAuto')}
            title={t('measurement.scaleTooltip')}
            disabled={isLocked()}
            onChange={(e) => updateAnnotProp('measureScale', e.target.value)}
          />
        </div>

        <div class="property-group">
          <label>{t('measurement.unit')}</label>
          <select value={annotProps.measureUnit} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('measureUnit', e.target.value)}>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
            <option value="in">in</option>
            <option value="ft">ft</option>
            <option value="pt">pt</option>
            <option value="px">px</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('measurement.precision')}</label>
          <select value={annotProps.measurePrecision} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('measurePrecision', e.target.value)}>
            <option value="0">1</option>
            <option value="1">0.1</option>
            <option value="2">0.01</option>
            <option value="3">0.001</option>
            <option value="4">0.0001</option>
            <option value="5">0.00001</option>
            <option value="6">0.000001</option>
            <option value="7">0.0000001</option>
            <option value="8">0.00000001</option>
            <option value="9">0.000000001</option>
          </select>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
