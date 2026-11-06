// Eigenschappen-sectie voor telmarkeringen (#935): de groep van de gekozen
// markering(en) wijzigen (ook voor een hele selectie tegelijk, zodat je
// groepen samenvoegt), het totaal in die groep, en naam en kleur van de hele
// groep. De groepen en de hernummering staan in countStore / telling.js.
import { Show, For, createMemo } from 'solid-js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { showProperties, showMultiSelectionProperties } from '../../../ui/panels/properties-panel.js';
import { telGroepSleutel } from '../../../annotations/telling.js';
import {
  countTallies, countGroups, assignCountGroup, updateCountGroup, GEEN_TELGROEP,
} from '../../stores/countStore.js';

const GEMENGD = '__gemengd__';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

export default function CountGroupSection() {
  const { t } = useTranslation('properties');

  const markeringen = createMemo(() =>
    (getActiveDocument()?.selectedAnnotations || []).filter(a => a?.type === 'count'));

  // Gedeelde groep van de selectie: een id, GEEN_TELGROEP, of GEMENGD.
  const groepWaarde = createMemo(() => {
    const sleutels = new Set(markeringen().map(telGroepSleutel));
    if (sleutels.size !== 1) return GEMENGD;
    const k = [...sleutels][0];
    return k || GEEN_TELGROEP;
  });
  const groep = createMemo(() => countTallies().find(g => g.id === groepWaarde()) || null);
  const vergrendeld = () => markeringen().some(a => a.locked);

  function verversPaneel() {
    const sel = getActiveDocument()?.selectedAnnotations || [];
    if (sel.length === 1) showProperties(sel[0]);
    else if (sel.length > 1) showMultiSelectionProperties();
    redraw();
  }

  return (
    <Show when={markeringen().length > 0}>
      <CollapsibleSection title={t('countGroup.title')} name="countGroup" id="prop-countgroup-section">
        <div class="property-group">
          <label>{t('countGroup.group')}</label>
          <select id="prop-count-group"
            value={groepWaarde()}
            disabled={vergrendeld()}
            onChange={(e) => {
              if (e.target.value === GEMENGD) return;
              if (assignCountGroup(markeringen(), e.target.value) > 0) verversPaneel();
            }}
          >
            <Show when={groepWaarde() === GEMENGD}>
              <option value={GEMENGD}>{t('countGroup.mixed')}</option>
            </Show>
            <For each={countGroups()}>{(g) => (
              <option value={g.id}>{`${g.name} (${g.count})`}</option>
            )}</For>
            <option value={GEEN_TELGROEP}>{t('countGroup.none')}</option>
          </select>
        </div>
        <Show when={groep()}>
          <div class="property-group">
            <label>{t('countGroup.total')}</label>
            <span id="prop-count-group-total">{t('countGroup.pieces', { count: groep().count })}</span>
          </div>
        </Show>
        <Show when={groep() && groep().id !== GEEN_TELGROEP}>
          <div class="property-group">
            <label>{t('countGroup.name')}</label>
            <input type="text" id="prop-count-group-name"
              value={groep().name}
              disabled={vergrendeld()}
              onChange={(e) => {
                const naam = e.target.value.trim();
                if (!naam) { e.target.value = groep().name; return; }
                updateCountGroup(groep().id, { name: naam });
                verversPaneel();
              }} />
          </div>
          <div class="property-group">
            <label>{t('countGroup.color')}</label>
            <input type="color" id="prop-count-group-color"
              value={groep().color}
              disabled={vergrendeld()}
              onChange={(e) => {
                updateCountGroup(groep().id, { color: e.target.value });
                verversPaneel();
              }} />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
