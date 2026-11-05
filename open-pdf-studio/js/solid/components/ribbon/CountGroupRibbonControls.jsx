import { createSignal } from 'solid-js';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import {
  countGroups, activeCountCategory, activeCountCategoryId, setActiveCountCategory,
  addCountCategory, updateCountGroup,
} from '../../stores/countStore.js';

// Kleuren voor nieuwe telgroepen, op volgorde (daarna weer van voren af).
const GROEPKLEUREN = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/**
 * Telgroep-bediening in het lint bij het telgereedschap (#935): de actieve
 * groep (nieuwe markeringen komen daarin) met het aantal per groep, de kleur
 * van de hele groep, en een nieuwe groep aanmaken.
 */
export default function CountGroupRibbonControls() {
  const { t } = useTranslation('ribbon');
  const [nieuweNaam, setNieuweNaam] = createSignal('');

  const opties = () => countGroups().map(g => ({ value: g.id, label: `${g.name} (${g.count})` }));

  function voegToe() {
    const naam = nieuweNaam().trim();
    if (!naam) return;
    const kleur = GROEPKLEUREN[countGroups().length % GROEPKLEUREN.length];
    setActiveCountCategory(addCountCategory(naam, kleur));
    setNieuweNaam('');
  }

  return (
    <RibbonButtonStack>
      <div class="ribbon-input-row" title={t('drawing.countGroupTip')}>
        <label class="ribbon-input-label">{t('drawing.countGroupLabel')}</label>
        <PrefSelect
          id="count-group-select"
          value={() => activeCountCategory()?.id || activeCountCategoryId()}
          setValue={setActiveCountCategory}
          options={opties()}
          style={{ width: '150px' }}
        />
      </div>
      <div class="ribbon-input-row">
        <label class="ribbon-input-label">{t('drawing.countGroupColor')}</label>
        <input type="color" id="count-group-color" class="ribbon-color-input"
          title={t('drawing.countGroupColorTip')}
          value={activeCountCategory()?.color || '#e11d48'}
          disabled={!activeCountCategory()}
          onChange={(e) => {
            const groep = activeCountCategory();
            if (!groep) return;
            updateCountGroup(groep.id, { color: e.currentTarget.value });
            redraw();
          }} />
      </div>
      <div class="ribbon-input-row">
        <input type="text" id="count-group-new" class="ribbon-input" style={{ width: '112px' }}
          placeholder={t('drawing.countGroupNew')}
          value={nieuweNaam()}
          onInput={(e) => setNieuweNaam(e.currentTarget.value)}
          onKeyDown={(e) => {
            // Het lint mag de toets niet als sneltoets opvatten.
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); voegToe(); }
          }} />
        <button type="button" class="ribbon-row-btn" id="count-group-add"
          title={t('drawing.countGroupAdd')}
          disabled={!nieuweNaam().trim()}
          onClick={voegToe}>+</button>
      </div>
    </RibbonButtonStack>
  );
}
