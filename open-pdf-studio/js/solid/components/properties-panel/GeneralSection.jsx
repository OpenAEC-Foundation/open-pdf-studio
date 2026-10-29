import { Show, For } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import { ifcCategoryLabel, IFC_LABELS } from '../../data/ifcCategoryMap.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import LayerField from './LayerField.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function GeneralSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={sectionVis.general}>
      <CollapsibleSection title={t('general.title')} name="general" id="prop-general-section">
        <div class="property-group">
          <label>{t('general.type')}</label>
          <input type="text" value={annotProps.typeDisplay} readonly />
        </div>

        <Show when={annotProps.id}>
          <div class="property-group">
            <label>ID</label>
            <input type="text" value={annotProps.id} readonly
              style="font-family: var(--ui-font-mono); font-size: 11px;"
              onClick={(e) => e.target.select()} />
          </div>
        </Show>

        <div class="property-group">
          <label>{t('general.ifcCategory')}</label>
          <input type="text" list="ifc-category-list"
            value={annotProps.ifcCategory === 'mixed' ? '' : annotProps.ifcCategory}
            placeholder={annotProps.ifcCategory === 'mixed' ? tCommon('mixed') : 'IfcBuildingElementProxy'}
            disabled={isLocked()}
            onChange={(e) => updateAnnotProp('ifcCategory', e.target.value)} />
          <Show when={ifcCategoryLabel(annotProps.ifcCategory)}>
            <small style="display:block; margin-top:2px; font-size:11px; color: var(--theme-text-secondary, #888);">
              {ifcCategoryLabel(annotProps.ifcCategory)}
            </small>
          </Show>
          <datalist id="ifc-category-list">
            <For each={Object.entries(IFC_LABELS)}>
              {([code, label]) => <option value={code}>{label}</option>}
            </For>
          </datalist>
        </div>

        <div class="property-group">
          <label>{t('general.subject')}</label>
          <input type="text" value={annotProps.subject} placeholder={t('general.subjectPlaceholder')}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('subject', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('general.author')}</label>
          <input type="text" value={annotProps.author}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('author', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('general.created')}</label>
          <input type="text" value={annotProps.created} readonly class="prop-date" />
        </div>

        <div class="property-group">
          <label>{t('general.modified')}</label>
          <input type="text" value={annotProps.modified} readonly class="prop-date" />
        </div>

        <div class="property-group">
          <label>{t('general.locked')}</label>
          <select value={annotProps.locked === 'mixed' ? 'mixed' : annotProps.locked ? 'yes' : 'no'}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('locked', e.target.value === 'yes')}>
            <Show when={annotProps.locked === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="no">{tCommon('no')}</option>
            <option value="yes">{tCommon('yes')}</option>
          </select>
        </div>

        <Show when={annotProps.id !== '__tool-defaults__'}>
          <LayerField disabled={isLocked()} />
        </Show>

        <div class="property-group">
          <label>{t('general.printable')}</label>
          <select value={annotProps.printable === 'mixed' ? 'mixed' : annotProps.printable ? 'yes' : 'no'}
            disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('printable', e.target.value === 'yes')}>
            <Show when={annotProps.printable === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="yes">{tCommon('yes')}</option>
            <option value="no">{tCommon('no')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('general.readOnly')}</label>
          <select value={annotProps.readOnly === 'mixed' ? 'mixed' : annotProps.readOnly ? 'yes' : 'no'}
            disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('readOnly', e.target.value === 'yes')}>
            <Show when={annotProps.readOnly === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="no">{tCommon('no')}</option>
            <option value="yes">{tCommon('yes')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('general.marked')}</label>
          <select value={annotProps.marked === 'mixed' ? 'mixed' : annotProps.marked ? 'yes' : 'no'}
            disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('marked', e.target.value === 'yes')}>
            <Show when={annotProps.marked === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="no">{tCommon('no')}</option>
            <option value="yes">{tCommon('yes')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('general.altText')}</label>
          <textarea rows="2"
            placeholder={annotProps.altText === '' && annotProps.multiCount > 0 ? tCommon('mixed') : t('general.altTextPlaceholder')}
            style="width: 100%; resize: vertical; font-size: 12px;"
            value={annotProps.altText}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('altText', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('general.status')}</label>
          <select value={annotProps.status}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('status', e.target.value)}>
            <Show when={annotProps.status === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <Show when={!['mixed', 'none', 'accepted', 'rejected', 'cancelled', 'completed', 'reviewed'].includes(annotProps.status)}>
              {/* Niet-standaard status uit een extern PDF-programma — toon as-is */}
              <option value={annotProps.status}>{annotProps.status.charAt(0).toUpperCase() + annotProps.status.slice(1)}</option>
            </Show>
            <option value="none">{tCommon('none')}</option>
            <option value="accepted">{t('general.accepted')}</option>
            <option value="rejected">{t('general.rejected')}</option>
            <option value="cancelled">{t('general.cancelled')}</option>
            <option value="completed">{t('general.completed')}</option>
            <option value="reviewed">{t('general.reviewed')}</option>
          </select>
          <Show when={annotProps.status && annotProps.status !== 'none' && annotProps.statusBy}>
            <small style="display:block; margin-top:2px; font-size:11px; color: var(--theme-text-secondary, #888);">
              {t('general.statusSetBy', { author: annotProps.statusBy, date: annotProps.statusAt })}
            </small>
          </Show>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
