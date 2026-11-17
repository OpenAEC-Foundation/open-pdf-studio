// Properties section for wall annotations: real-world thickness (mm), the
// material hatch and, per end, whether the automatic corner join is allowed
// (#476). Writes go through updateAnnotProp so undo/redo and redraw behave
// exactly like every other property edit.
import { Show, For } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
// Single source of truth for wall materials (NEN hatches + insulation with
// bg colour + thickness-scaled 60° zigzag) — see rendering/walls.js.
import { WALL_MATERIALS, ISOLATIE_MATERIALEN } from '../../../annotations/rendering/walls.js';

export default function WallSection() {
  const { t } = useTranslation('properties');
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  // Checked = join allowed (the default). The model only carries the
  // exception: noJoinStart / noJoinEnd === true; switching back removes it.
  const zetJoin = (sleutel, toegestaan) => updateAnnotProp(sleutel, toegestaan ? undefined : true);
  // Display name of a material in the app language; the stored value stays
  // the id. Without a translation (PIR, EPS, PUR and trade names are proper
  // names) the name from the material table is used.
  const naam = (groep, m) => t(`wall.${groep}.${m.id}`, m.label);
  return (
    <Show when={annotProps.annotationType === 'wall'}>
      <CollapsibleSection title={t('wall.title')} name="wall" id="prop-wall-section">
        <div class="property-group">
          <label>{t('wall.thickness')}</label>
          <input type="text" inputmode="decimal" data-getal min="10" max="1000" step="5"
            value={annotProps.dikteMm ?? 100}
            onChange={(e) => updateAnnotProp('dikteMm', Math.max(10, parseFloat(e.target.value) || 100))}
          />
        </div>
        <div class="property-group">
          <label>{t('wall.material')}</label>
          <select
            value={(annotProps.hatchPattern || '').startsWith('iso-') ? 'isolatie' : (annotProps.hatchPattern || 'nen47-metselwerk-baksteen')}
            onChange={(e) => updateAnnotProp('hatchPattern', e.target.value)}
          >
            <For each={WALL_MATERIALS}>{(m) => (
              <option value={m.id}>{naam('materials', m)}</option>
            )}</For>
          </select>
        </div>
        <Show when={annotProps.hatchPattern === 'isolatie' || (annotProps.hatchPattern || '').startsWith('iso-')}>
          <div class="property-group">
            <label>{t('wall.insulationMaterial')}</label>
            <select
              value={annotProps.isolatieType || ((annotProps.hatchPattern || '').startsWith('iso-') ? annotProps.hatchPattern.slice(4) : 'steenwol')}
              onChange={(e) => updateAnnotProp('isolatieType', e.target.value)}
            >
              <For each={ISOLATIE_MATERIALEN}>{(m) => (
                <option value={m.id}>{naam('insulation', m)}</option>
              )}</For>
            </select>
          </div>
        </Show>
        <div class="property-group" title={t('wall.joinHint')}>
          <label>
            <input type="checkbox" id="prop-wall-join-start"
              checked={annotProps.noJoinStart !== true}
              disabled={locked()}
              onChange={(e) => zetJoin('noJoinStart', e.target.checked)}
            /> {t('wall.joinAtStart')}
          </label>
        </div>
        <div class="property-group" title={t('wall.joinHint')}>
          <label>
            <input type="checkbox" id="prop-wall-join-end"
              checked={annotProps.noJoinEnd !== true}
              disabled={locked()}
              onChange={(e) => zetJoin('noJoinEnd', e.target.checked)}
            /> {t('wall.joinAtEnd')}
          </label>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
