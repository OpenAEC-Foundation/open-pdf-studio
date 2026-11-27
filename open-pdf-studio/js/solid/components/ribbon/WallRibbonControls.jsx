import { onMount } from 'solid-js';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { isImperiaalStelsel } from '../../../annotations/eenhedenstelsel.js';
import { wandStandaard, wanddikteKeuzes, wanddikteKeuze, wanddikteLabel } from '../../../plattegrond/blad-conventie.js';
import { LOCATIELIJNEN, normaliseerLocatielijn } from '../../../plattegrond/wand-locatielijn.js';
import { wandBladImperiaal, meldWandPagina } from '../../stores/wandOptiesStore.js';

const LOCATIE_SLEUTEL = { center: 'wallLocationCenter', left: 'wallLocationLeft', right: 'wallLocationRight' };

/**
 * Wall tool options in the ribbon (#1230): the thickness of the next wall and
 * the location line the clicks follow. A sheet in feet or inches offers the
 * US sizes, a metric sheet the metric ones. The thickness travels through
 * toolOverrides, the same channel a palette wall uses; the location line is a
 * preference, so it stays as the user left it.
 */
export default function WallRibbonControls() {
  const { t } = useTranslation('ribbon');
  const { t: tProperties } = useTranslation('properties');

  // Until the cursor is on the sheet, the page decides.
  onMount(() => meldWandPagina());

  // The preference is read here too, so switching it updates the list at once.
  const imperiaal = () => wandBladImperiaal() || isImperiaalStelsel(state.preferences?.scaleUnitSystem);
  const soortNaam = (soort, standaard) => tProperties(`wall.kinds.${soort}`, standaard);

  const dikteMm = () => Number(state.toolOverrides?.wallDikteMm) || wandStandaard(imperiaal()).dikteMm;
  const dikteOpties = () => {
    const opties = wanddikteKeuzes(imperiaal(), soortNaam).map((k) => ({ value: String(k.dikteMm), label: k.label }));
    // A thickness from the other convention or from a palette wall stays in the list.
    if (!wanddikteKeuze(dikteMm(), imperiaal())) {
      opties.unshift({ value: String(dikteMm()), label: wanddikteLabel(dikteMm(), imperiaal()) });
    }
    return opties;
  };
  const zetDikte = (waarde) => {
    const mm = Number(waarde);
    if (!(mm > 0)) return;
    state.toolOverrides = { ...(state.toolOverrides || {}), wallDikteMm: mm };
  };

  const locatielijn = () => normaliseerLocatielijn(state.preferences?.wallLocationLine);
  const locatieOpties = () => LOCATIELIJNEN.map((l) => ({ value: l, label: t(`drawing.${LOCATIE_SLEUTEL[l]}`) }));
  const zetLocatielijn = (waarde) => {
    state.preferences.wallLocationLine = normaliseerLocatielijn(waarde);
    savePreferences();
  };

  return (
    <RibbonButtonStack>
      <div class="ribbon-input-row" title={t('drawing.wallThicknessTip')}>
        <label class="ribbon-input-label">{t('drawing.wallThickness')}</label>
        <PrefSelect
          id="wall-thickness-select"
          value={() => String(dikteMm())}
          setValue={zetDikte}
          options={dikteOpties()}
          style={{ width: '128px' }}
        />
      </div>
      <div class="ribbon-input-row" title={t('drawing.wallLocationLineTip')}>
        <label class="ribbon-input-label">{t('drawing.wallLocationLine')}</label>
        <PrefSelect
          id="wall-location-line-select"
          value={locatielijn}
          setValue={zetLocatielijn}
          options={locatieOpties()}
          style={{ width: '128px' }}
        />
      </div>
    </RibbonButtonStack>
  );
}
