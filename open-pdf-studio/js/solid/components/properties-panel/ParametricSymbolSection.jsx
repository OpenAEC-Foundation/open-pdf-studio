// Properties panel section for parametricSymbol annotations.
// Reads the current annotation's symbolId, looks up the template,
// renders an input per parameter and writes back via updateAnnotProp('params.<key>', value).
import { Show, For } from 'solid-js';
import { annotProps, updateAnnotProp, getCurrentAnnotation } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { getTemplate } from '../../../symbols/registry.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { stramienSlotStatus, schakelStramienSlot } from '../../../annotations/stramien-slot.js';

function paramValue(key, fallback) {
  // annotProps.params is mirrored from currentAnnotation.params via setAnnotProps
  const p = annotProps.params || {};
  return p[key] !== undefined ? p[key] : fallback;
}

function setParam(key, value) {
  // Write the whole params object so propertiesStore's default branch updates
  // annotation.params AND its flat-key mirror updates annotProps.params for UI.
  const next = { ...(annotProps.params || {}), [key]: value };
  updateAnnotProp('params', next);
}

// Stramienlijn: per uiteinde de koppeling met de uiteinden van de andere
// stramienlijnen (dezelfde schakelaar als het slotje op de tekening). Aangevinkt
// = gekoppeld; uitgegrijsd = er ligt geen ander uiteinde op één lijn.
function StramienKoppeling() {
  const { t } = useTranslation('properties');
  const status = (eind) => {
    // Lees de paneelgegevens mee: na een wijziging vernieuwt showProperties
    // ze, en dan rekent dit opnieuw.
    void annotProps.params; void annotProps.x; void annotProps.y;
    void annotProps.width; void annotProps.height;
    const ann = getCurrentAnnotation();
    if (!ann || ann.id === '__tool-defaults__') return null;
    return stramienSlotStatus(ann, eind);
  };
  const rij = (eind, sleutel) => (
    <div class="property-group" title={t('parametricSymbol.gridLinkHint')}>
      <label>
        <input type="checkbox"
          checked={status(eind) === 'dicht'}
          disabled={!status(eind) || annotProps.locked === true}
          onChange={(e) => {
            const ann = getCurrentAnnotation();
            if (ann) schakelStramienSlot(ann, eind, e.target.checked);
            e.target.checked = status(eind) === 'dicht';
          }}
        /> {t(sleutel)}
      </label>
    </div>
  );
  return (
    <>
      <div class="property-group">
        <label>{t('parametricSymbol.gridAlignment')}</label>
      </div>
      {rij('begin', 'parametricSymbol.gridStartLinked')}
      {rij('einde', 'parametricSymbol.gridEndLinked')}
    </>
  );
}

export default function ParametricSymbolSection() {
  const { t } = useTranslation('properties');

  return (
    <Show when={annotProps.annotationType === 'parametricSymbol'}>
      {(() => {
        const template = getTemplate(annotProps.symbolId);
        if (!template) {
          return (
            <CollapsibleSection title={t('parametricSymbol.defaultTitle')} name="parametricSymbol" id="prop-parametric-section">
              <div class="property-group">
                <label>{t('parametricSymbol.symbolLabel')}</label>
                <input type="text" readonly value={annotProps.symbolId || '?'} />
                <small style="color:#a00">{t('parametricSymbol.unknownSymbol')}</small>
              </div>
            </CollapsibleSection>
          );
        }
        return (
          <CollapsibleSection title={t('parametricSymbol.sectionTitle', { name: template.name })} name="parametricSymbol" id="prop-parametric-section">
            <div class="property-group">
              <label>{t('parametricSymbol.typeLabel')}</label>
              <input type="text" readonly value={template.name + (template.nameEn ? ` / ${template.nameEn}` : '')} />
            </div>
            <For each={template.params.filter(p => !p.hidden)}>{(p) => (
              <div class="property-group">
                {/* p.label/p.unit come from the symbol template's own data
                    (bilingual NL/EN label+labelEn, per symbols/registry.js),
                    not the i18next resource bundle — units are short
                    abbreviations (mm, °) that read the same in every
                    language, so this is intentionally not run through t().
                    If a template ever spells a unit out in full, it would
                    need the same per-locale treatment as the labels. */}
                <label title={p.labelEn || ''}>{p.label}{p.unit ? ` (${p.unit})` : ''}</label>
                <Show when={p.type === 'number'}>
                  <input type="number"
                    step={p.step ?? 1}
                    min={p.min}
                    max={p.max}
                    value={paramValue(p.key, p.default)}
                    onInput={(e) => setParam(p.key, parseFloat(e.target.value))}
                  />
                </Show>
                <Show when={p.type === 'enum'}>
                  <select
                    value={paramValue(p.key, p.default)}
                    onChange={(e) => setParam(p.key, e.target.value)}
                  >
                    <For each={p.options}>{(opt) => (
                      <option value={typeof opt === 'string' ? opt : opt.value}>
                        {typeof opt === 'string' ? opt : (opt.label || opt.value)}
                      </option>
                    )}</For>
                  </select>
                </Show>
                <Show when={p.type === 'boolean'}>
                  <input type="checkbox"
                    checked={!!paramValue(p.key, p.default)}
                    onChange={(e) => setParam(p.key, e.target.checked)}
                  />
                </Show>
                <Show when={p.type === 'string'}>
                  <input type="text"
                    value={paramValue(p.key, p.default) || ''}
                    onInput={(e) => setParam(p.key, e.target.value)}
                  />
                </Show>
              </div>
            )}</For>
            <Show when={template.id === 'stramien' && annotProps.id !== '__tool-defaults__'}>
              <StramienKoppeling />
            </Show>
          </CollapsibleSection>
        );
      })()}
    </Show>
  );
}
