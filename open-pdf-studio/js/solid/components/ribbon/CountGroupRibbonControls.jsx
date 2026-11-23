import { createSignal } from 'solid-js';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import {
  countGroups, activeCountCategory, activeCountCategoryId, setActiveCountCategory,
  addCountCategory, updateCountGroup, deleteCountGroup,
} from '../../stores/countStore.js';
import { volgendeTelGroepKleur, TELSCHAAL_KEUZES, telSchaal } from '../../../annotations/telling.js';
import { showConfirm } from '../../../ui/chrome/confirm-dialog.js';
import { showMessage } from '../../stores/dialogStore.js';

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
    // Zelfde palet als Nieuwe telling (#1004): de eerste kleur die nog vrij is.
    const kleur = volgendeTelGroepKleur(countGroups());
    setActiveCountCategory(addCountCategory(naam, kleur));
    setNieuweNaam('');
  }

  const maatOpties = () => TELSCHAAL_KEUZES.map(p => ({ value: String(p), label: `${p}%` }));
  const maat = () => String(Math.round(telSchaal(activeCountCategory()) * 100));

  // De groep met haar markeringen verwijderen (#1235); eerst vragen als er
  // markeringen in staan.
  async function verwijder() {
    const groep = activeCountCategory();
    if (!groep) return;
    if (groep.count > 0) {
      const ja = await showConfirm({
        title: t('drawing.countGroupDelete'),
        message: t('drawing.countGroupDeleteConfirm', { name: groep.name, count: groep.count }),
      });
      if (!ja) return;
    }
    const uit = deleteCountGroup(groep.id);
    if (!uit.ok && uit.vergrendeld > 0) showMessage(t('drawing.countGroupDeleteLocked', { name: groep.name }));
    redraw();
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
          style={{ width: '128px' }}
        />
        <button type="button" class="ribbon-row-btn" id="count-group-delete"
          title={t('drawing.countGroupDelete')} aria-label={t('drawing.countGroupDelete')}
          disabled={!activeCountCategory()}
          onClick={verwijder}>×</button>
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
        <label class="ribbon-input-label">{t('drawing.countGroupSize')}</label>
        <PrefSelect
          id="count-group-size"
          value={maat}
          setValue={(v) => {
            const groep = activeCountCategory();
            if (!groep) return;
            updateCountGroup(groep.id, { markerScale: Number(v) / 100 });
            redraw();
          }}
          options={maatOpties()}
          style={{ width: '64px' }}
        />
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
