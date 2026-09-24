// Eigenschappen van een gevelelement (vliesgevel of kozijn, #475).
//
// Toont het GEHEEL (lengte, binnenzijde, wand, velden, stijlen, opnieuw
// verdelen) en, als er met Tab of een tweede klik een onderdeel geselecteerd
// is, dat ONDERDEEL: een stijl (positie, type, verwijderen) of een paneel
// (type, scharnier en draairichting van een deur, splitsen).
//
// Elke wijziging loopt via pasToe (gevelelement/app-bewerking.js): één
// ongedaan-stap per handeling. Getallen worden pas vastgelegd bij het
// verlaten van het veld of Enter (onChange), niet per toetsaanslag.
import { Show, For, createMemo } from 'solid-js';
import { annotProps, getCurrentAnnotation } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getTemplate } from '../../../symbols/registry.js';
import {
  indeling, splitsVeld, verwijderStijl, verschuifStijl, wisselStijlType,
  wisselPaneel, verdeelGelijk, rekUit, zetVeldbreedte,
} from '../../../gevelelement/indeling.js';
import {
  preset, stijlTypenVoor, paneelTypenVoor, paneelType, typeNaam,
} from '../../../gevelelement/catalogus.js';
import { pasToe, zetOnderdeel } from '../../../gevelelement/app-bewerking.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';

const rond = (v) => Math.round(v * 10) / 10;

const RIJ = {
  display: 'grid', 'grid-template-columns': '28px 1fr 1fr 22px', gap: '2px',
  'align-items': 'center', padding: '1px 2px', 'border-bottom': '1px solid var(--theme-border, #d4d4d4)',
};
const KOP = { ...RIJ, 'font-weight': 'bold', 'font-size': '11px', background: 'var(--theme-surface, #f5f5f5)' };
const GESELECTEERD = { background: 'rgba(0, 102, 204, 0.18)' };
const KNOP = { flex: 'none', padding: '0 4px', 'min-width': '20px' };

export default function GevelelementSection() {
  const { t, language } = useTranslation('properties');

  // Niet bij de gereedschapsstandaarden (__tool-defaults__): die hebben geen
  // eigen indeling, een bewerking zou daar een lege undo-stap maken.
  const presetId = () => (annotProps.annotationType === 'parametricSymbol'
    && annotProps.id !== '__tool-defaults__'
    ? getTemplate(annotProps.symbolId)?.gevelelement || null : null);
  const lay = createMemo(() => (presetId() ? indeling(annotProps.params, presetId()) : null));
  const sub = () => annotProps.gevelSub;
  const locked = () => annotProps.locked === true;
  const naam = (typeObj) => typeNaam(typeObj, language());

  const reden = (fout) => {
    if (/narrow|too wide/i.test(fout || '')) return t('gevelelement.reasonTooNarrow');
    if (/outer frame/i.test(fout || '')) return t('gevelelement.reasonFrame');
    return fout || '';
  };
  // Bewerking uitvoeren; bij een weigering zet `invoer` (het invoerveld en
  // zijn oude waarde) het veld terug, want de opgeslagen waarde veranderde niet.
  const doe = (bewerk, opties, invoer) => {
    const ann = getCurrentAnnotation();
    if (!ann) return;
    const r = pasToe(ann, bewerk, opties);
    if (r && !r.ok) {
      if (invoer?.el) invoer.el.value = invoer.oud;
      try { updateStatusMessage(t('gevelelement.refused', { reason: reden(r.error) })); } catch (_) { /* optioneel */ }
    }
  };
  const kies = (onderdeel) => {
    const ann = getCurrentAnnotation();
    if (ann) zetOnderdeel(ann, onderdeel);
  };
  const isSel = (soort, index) => sub()?.soort === soort && sub()?.index === index;
  const getal = (e) => {
    const n = parseFloat(e.target.value);
    return Number.isFinite(n) ? n : null;
  };
  const stijlLabel = (s) => (s.rol === 'begin' ? t('gevelelement.frameStart')
    : s.rol === 'eind' ? t('gevelelement.frameEnd')
      : t('gevelelement.mullionNr', { n: s.index }));

  const geselStijl = () => (sub()?.soort === 'stijl' ? lay()?.stijlen[sub().index] : null);
  const geselVeld = () => (sub()?.soort === 'paneel' ? lay()?.velden[sub().index] : null);
  const draaiend = (veld) => {
    const w = paneelType(veld?.paneel?.type)?.weergave;
    return w === 'deur' || w === 'draairaam';
  };

  return (
    <Show when={presetId() && lay()}>
      <CollapsibleSection
        title={t('gevelelement.sectionTitle', { name: naam(preset(presetId())) })}
        name="gevelelement" id="prop-gevelelement-section">

        {/* ── het geheel ─────────────────────────────────────────── */}
        <div class="property-group">
          <label>{t('gevelelement.length')}</label>
          <input type="number" min="100" step="10" id="prop-gevel-lengte"
            value={rond(lay().lengteMm)} disabled={locked()}
            onChange={(e) => {
              const n = getal(e);
              if (n !== null) doe((p, id) => rekUit(p, id, n, 'begin'), undefined, { el: e.target, oud: rond(lay().lengteMm) });
            }} />
        </div>
        <div class="property-group">
          <label>{t('gevelelement.insideSide')}</label>
          <select value={lay().binnenzijde} disabled={locked()}
            onChange={(e) => doe((p) => ({ ok: true, params: { ...p, binnenzijde: e.target.value } }))}>
            <option value="rechts">{t('gevelelement.insideRight')}</option>
            <option value="links">{t('gevelelement.insideLeft')}</option>
          </select>
        </div>
        <div class="property-group">
          <label>{t('gevelelement.hostWall')}</label>
          <div style={{ 'font-size': '11px' }}>
            {annotProps.params?.host
              ? t('gevelelement.hostedAt', {
                from: Math.round(annotProps.params.host.vanMm),
                length: Math.round(annotProps.params.host.lengteMm),
              })
              : t('gevelelement.notHosted')}
          </div>
        </div>

        {/* ── het geselecteerde onderdeel ────────────────────────── */}
        <div class="property-group" style={{ 'border-top': '1px solid var(--theme-border, #d4d4d4)', 'padding-top': '6px' }}>
          <label style={{ 'font-weight': 'bold' }}>
            {geselStijl() ? stijlLabel(geselStijl())
              : geselVeld() ? t('gevelelement.fieldNr', { n: geselVeld().index + 1 })
                : t('gevelelement.whole')}
          </label>
          <Show when={sub()}>
            <button type="button" class="prop-action-btn" onClick={() => kies(null)}>
              {t('gevelelement.selectWhole')}
            </button>
          </Show>
          <div style={{ 'font-size': '11px', opacity: '0.75' }}>{t('gevelelement.tabHint')}</div>
        </div>

        <Show when={geselStijl()}>
          {(() => {
            const s = () => geselStijl();
            const tussen = () => s().rol === 'tussen';
            return (
              <>
                <div class="property-group">
                  <label>{t('gevelelement.position')}</label>
                  <input type="number" step="10" id="prop-gevel-stijlpositie"
                    value={rond(s().posMm)} disabled={locked() || !tussen()}
                    onChange={(e) => {
                      const n = getal(e);
                      if (n !== null) doe((p, id) => verschuifStijl(p, id, s().index, n), undefined, { el: e.target, oud: rond(s().posMm) });
                    }} />
                </div>
                <div class="property-group">
                  <label>{t('gevelelement.mullionType')}</label>
                  <select value={s().type} disabled={locked()} id="prop-gevel-stijltype"
                    onChange={(e) => doe((p, id) => wisselStijlType(p, id, s().index, e.target.value), undefined, { el: e.target, oud: s().type })}>
                    <For each={stijlTypenVoor(presetId())}>
                      {(st) => <option value={st.id}>{naam(st)}</option>}
                    </For>
                  </select>
                </div>
                <div class="property-group">
                  <button type="button" class="prop-action-btn" disabled={locked() || !tussen()}
                    onClick={() => doe((p, id) => verwijderStijl(p, id, s().index),
                      { onderdeel: { soort: 'paneel', index: s().index - 1 } })}>
                    {t('gevelelement.removeMullion')}
                  </button>
                </div>
              </>
            );
          })()}
        </Show>

        <Show when={geselVeld()}>
          {(() => {
            const v = () => geselVeld();
            return (
              <>
                <div class="property-group">
                  <label>{t('gevelelement.panel')}</label>
                  <select value={v().paneel.type} disabled={locked()} id="prop-gevel-paneel"
                    onChange={(e) => doe((p, id) => wisselPaneel(p, id, v().index, e.target.value))}>
                    <For each={paneelTypenVoor(presetId())}>
                      {(pt) => <option value={pt.id}>{naam(pt)}</option>}
                    </For>
                  </select>
                </div>
                <Show when={draaiend(v())}>
                  <div class="property-group">
                    <label>{t('gevelelement.hinge')}</label>
                    <select value={v().paneel.scharnier} disabled={locked()}
                      onChange={(e) => doe((p, id) => wisselPaneel(p, id, v().index, { scharnier: e.target.value }))}>
                      <option value="begin">{t('gevelelement.hingeStart')}</option>
                      <option value="eind">{t('gevelelement.hingeEnd')}</option>
                    </select>
                  </div>
                  <div class="property-group">
                    <label>{t('gevelelement.swing')}</label>
                    <select value={v().paneel.draaiNaar} disabled={locked()}
                      onChange={(e) => doe((p, id) => wisselPaneel(p, id, v().index, { draaiNaar: e.target.value }))}>
                      <option value="binnen">{t('gevelelement.swingInside')}</option>
                      <option value="buiten">{t('gevelelement.swingOutside')}</option>
                    </select>
                  </div>
                </Show>
                <div class="property-group">
                  <label>{t('gevelelement.fieldWidth')}</label>
                  <input type="number" step="10" id="prop-gevel-veldbreedte"
                    value={rond(v().breedteMm)} disabled={locked() || lay().velden.length < 2}
                    onChange={(e) => {
                      const n = getal(e);
                      if (n !== null) doe((p, id) => zetVeldbreedte(p, id, v().index, n), undefined, { el: e.target, oud: rond(v().breedteMm) });
                    }} />
                  <div style={{ 'font-size': '11px', opacity: '0.75' }}>
                    {t('gevelelement.clearWidth')}: {Math.round(v().dagMm)} mm
                  </div>
                </div>
                <div class="property-group">
                  <button type="button" class="prop-action-btn" disabled={locked()}
                    onClick={() => doe((p, id) => splitsVeld(p, id, v().index),
                      { onderdeel: (r) => ({ soort: 'stijl', index: r.index }) })}>
                    {t('gevelelement.split')}
                  </button>
                </div>
              </>
            );
          })()}
        </Show>

        {/* ── velden ─────────────────────────────────────────────── */}
        <div class="property-group">
          <label>{t('gevelelement.fields')}</label>
          <div style={KOP}>
            <span>#</span><span>{t('gevelelement.widthCc')}</span><span>{t('gevelelement.panel')}</span><span />
          </div>
          <For each={lay().velden}>{(v) => (
            <div style={{ ...RIJ, ...(isSel('paneel', v.index) ? GESELECTEERD : {}) }}
              onClick={() => kies({ soort: 'paneel', index: v.index })}>
              <span>{v.index + 1}</span>
              <span>{Math.round(v.breedteMm)}</span>
              <span>{naam(paneelType(v.paneel.type))}</span>
              <button type="button" class="prop-action-btn" style={KNOP} disabled={locked()}
                title={t('gevelelement.split')}
                onClick={(e) => {
                  e.stopPropagation();
                  doe((p, id) => splitsVeld(p, id, v.index),
                    { onderdeel: (r) => ({ soort: 'stijl', index: r.index }) });
                }}>+</button>
            </div>
          )}</For>
        </div>

        {/* ── stijlen ────────────────────────────────────────────── */}
        <div class="property-group">
          <label>{t('gevelelement.mullions')}</label>
          <div style={KOP}>
            <span>#</span><span>{t('gevelelement.positionShort')}</span><span>{t('gevelelement.mullionType')}</span><span />
          </div>
          <For each={lay().stijlen}>{(s) => (
            <div style={{ ...RIJ, ...(isSel('stijl', s.index) ? GESELECTEERD : {}) }}
              onClick={() => kies({ soort: 'stijl', index: s.index })}>
              <span>{s.rol === 'tussen' ? s.index : '▯'}</span>
              <span>{Math.round(s.posMm)}</span>
              <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                {Math.round(s.breedteMm)} × {Math.round(s.diepteMm)}
              </span>
              <Show when={s.rol === 'tussen'} fallback={<span />}>
                <button type="button" class="prop-action-btn" style={KNOP} disabled={locked()}
                  title={t('gevelelement.removeMullion')}
                  onClick={(e) => {
                    e.stopPropagation();
                    doe((p, id) => verwijderStijl(p, id, s.index),
                      { onderdeel: { soort: 'paneel', index: s.index - 1 } });
                  }}>×</button>
              </Show>
            </div>
          )}</For>
        </div>

        {/* ── opnieuw verdelen ───────────────────────────────────── */}
        <div class="property-group">
          <label>{t('gevelelement.divide')}</label>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input type="number" min="1" max="50" step="1" id="prop-gevel-verdeel"
              value={lay().velden.length} disabled={locked()}
              onChange={(e) => {
                const n = Math.round(getal(e) || 0);
                if (n >= 1 && n !== lay().velden.length) {
                  doe((p, id) => verdeelGelijk(p, id, n), { onderdeel: null }, { el: e.target, oud: lay().velden.length });
                }
              }} />
          </div>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
