// Bewerker voor een lijst-parameter van een parametrisch symbool (type
// 'list'), zoals de onderdelen in een aanrecht (#478).
//
// Eén blok per item met de velden uit `def.items`, per item wisselen met het
// volgende en verwijderen, en onderaan een regel om een item toe te voegen.
// De bewerkingen zelf komen uit de parameterdefinitie (normalize, add,
// update, remove, swap), zodat paneel en MCP dezelfde regels volgen; zonder
// die haken werkt het als een gewone lijst.
//
// Velden en keuzes dragen hun eigen tweetalige label (label/labelEn), net als
// de gewone parameters in ParametricSymbolSection; alleen de knoppen van de
// bewerker zelf lopen via i18n.
import { For, Show, createSignal } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';

function optieWaarde(opt) {
  return typeof opt === 'string' ? opt : opt.value;
}

function optieLabel(opt) {
  return typeof opt === 'string' ? opt : (opt.label || String(opt.value));
}

// <select> geeft altijd tekst terug; de optie kan een getal zijn (been 1/2).
function waardeUitTekst(opties, tekst) {
  const o = (opties || []).find((x) => String(optieWaarde(x)) === tekst);
  return o === undefined ? tekst : optieWaarde(o);
}

const knopStijl = { flex: '0 0 22px', padding: '0' };

export default function ParamListEditor(props) {
  const { t } = useTranslation('properties');
  const params = () => props.params || {};
  const rijen = () => {
    const def = props.def;
    if (typeof def.normalize === 'function') return def.normalize(props.value, params());
    return Array.isArray(props.value) ? props.value : [];
  };
  const soortVeld = () => (props.def.items || []).find((f) => f.type === 'enum');
  const [nieuw, setNieuw] = createSignal(null);
  const nieuweSoort = () => nieuw() ?? optieWaarde(soortVeld()?.options?.[0] ?? '');

  // Altijd een schone kopie naar buiten: de lijst komt via de paneel-store
  // binnen en mag niet als store-proxy in de annotatie belanden.
  const schrijf = (lijst) => props.onChange(JSON.parse(JSON.stringify(lijst)));

  function wijzig(i, key, waarde) {
    const def = props.def;
    if (typeof def.update === 'function') schrijf(def.update(rijen(), i, { [key]: waarde }, params()));
    else schrijf(rijen().map((r, j) => (j === i ? { ...r, [key]: waarde } : r)));
  }

  function verwijder(i) {
    const def = props.def;
    if (typeof def.remove === 'function') schrijf(def.remove(rijen(), i, params()));
    else schrijf(rijen().filter((_, j) => j !== i));
  }

  function wissel(i) {
    const def = props.def;
    if (typeof def.swap === 'function') { schrijf(def.swap(rijen(), i, params())); return; }
    const r = rijen().slice();
    if (i + 1 >= r.length) return;
    [r[i], r[i + 1]] = [r[i + 1], r[i]];
    schrijf(r);
  }

  function voegToe() {
    const def = props.def;
    const soort = nieuweSoort();
    if (typeof def.add === 'function') schrijf(def.add(rijen(), params(), soort));
    else if (soortVeld()) schrijf([...rijen(), { [soortVeld().key]: soort }]);
  }

  return (
    <div class="ps-list-editor">
      <Show when={rijen().length > 0} fallback={
        <div class="property-group">
          <label />
          <small>{t('parametricSymbol.listEmpty')}</small>
        </div>
      }>
        <For each={rijen()}>{(rij, i) => (
          <div class="ps-list-item"
            style={{ border: '1px solid var(--theme-border)', margin: '0 8px 4px', padding: '3px 0' }}>
            <For each={props.def.items || []}>{(f, fi) => (
              <div class="property-group" style={{ padding: '0 4px' }}>
                <label title={f.labelEn || ''}>{f.label}{f.unit ? ` (${f.unit})` : ''}</label>
                <Show when={f.type === 'enum'}>
                  <select
                    value={String(rij[f.key] ?? '')}
                    onChange={(e) => wijzig(i(), f.key, waardeUitTekst(f.options, e.target.value))}
                  >
                    <For each={f.options}>{(opt) => (
                      <option value={String(optieWaarde(opt))}>{optieLabel(opt)}</option>
                    )}</For>
                  </select>
                </Show>
                <Show when={f.type === 'number'}>
                  <input type="number"
                    step={f.step ?? 1}
                    min={f.min}
                    max={f.max}
                    value={rij[f.key] ?? ''}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n)) wijzig(i(), f.key, n);
                    }}
                  />
                </Show>
                <Show when={fi() === 0}>
                  <button type="button" class="prop-action-btn" style={knopStijl}
                    title={t('parametricSymbol.listSwap')}
                    onClick={() => wissel(i())}>{'⇄'}</button>
                  <button type="button" class="prop-action-btn" style={knopStijl}
                    title={t('parametricSymbol.listRemove')}
                    onClick={() => verwijder(i())}>{'×'}</button>
                </Show>
              </div>
            )}</For>
          </div>
        )}</For>
      </Show>
      <Show when={soortVeld()}>
        <div class="property-group">
          <label>{t('parametricSymbol.listNew')}</label>
          <select
            value={String(nieuweSoort())}
            onChange={(e) => setNieuw(waardeUitTekst(soortVeld().options, e.target.value))}
          >
            <For each={soortVeld().options}>{(opt) => (
              <option value={String(optieWaarde(opt))}>{optieLabel(opt)}</option>
            )}</For>
          </select>
          <button type="button" class="prop-action-btn" style={{ flex: '0 0 auto' }}
            onClick={voegToe}>{t('parametricSymbol.listAdd')}</button>
        </div>
      </Show>
    </div>
  );
}
