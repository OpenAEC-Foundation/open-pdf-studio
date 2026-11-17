import { Show } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefSelect from './PrefSelect.jsx';
import { voorkeurenBijStelsel } from '../../../annotations/eenhedenstelsel.js';
import { opslagIsBlijvend } from '../../../core/opslag.js';
import { isTauri } from '../../../core/platform.js';

/**
 * De ene instelling "Eenheden": Metrisch / Imperiaal (#1158). Staat op het
 * tabblad Algemeen en bij de meetinstellingen; beide plekken zetten dezelfde
 * voorkeur (scaleUnitSystem). Omzetten neemt de voorkeuren mee die erbij
 * horen (voet-inch-breuken, papiermaten in inches); de gebruiker kan die
 * details daarna zelf nog anders kiezen.
 */
export default function UnitSystemRow(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;

  const opties = [
    { value: 'metric', label: t('measurement.unitsMetric') },
    { value: 'imperial', label: t('measurement.unitsImperial') },
    { value: 'both', label: t('measurement.unitsBoth') },
  ];

  function kies(stelsel) {
    p.scaleUnitSystem[1](stelsel);
    const patch = voorkeurenBijStelsel(stelsel, {
      imperialLengthFormat: p.imperialLengthFormat[0](),
      paperSizeUnit: p.paperSizeUnit[0](),
    });
    for (const [sleutel, waarde] of Object.entries(patch)) p[sleutel][1](waarde);
  }

  // In de browser staan de voorkeuren in de browseropslag. Is die
  // geblokkeerd, dan geldt de keuze tot de pagina opnieuw laadt.
  const nietBewaard = () => !isTauri() && !opslagIsBlijvend();

  return (
    <>
      <div class="pref-row">
        <label>{t('measurement.unitsSetting')}</label>
        <PrefSelect id={props.id} value={p.scaleUnitSystem[0]} setValue={kies} options={opties} style={{ width: '260px' }} />
      </div>
      <div class="pref-row"><span class="pref-hint">{t('measurement.unitsHint')}</span></div>
      <Show when={nietBewaard()}>
        <div class="pref-row"><span class="pref-hint">{t('measurement.unitsNotSaved')}</span></div>
      </Show>
    </>
  );
}
