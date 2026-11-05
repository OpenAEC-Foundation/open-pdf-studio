import { createSignal, createMemo, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { leesGetal, leesGetalBegin } from '../../../core/getal-invoer.js';
import { formatGetal, formatMaat, formatProcent } from '../../../core/maat-notatie.js';
import { startScaleMeasureFlow } from '../../../tools/tools/scale-measure-tool.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { MM_PER_UNIT } from '../../../annotations/scale-from-measurement.js';
import {
  berekenAfwijking, classificeer, bronVoorPunten, richtingVan, anisotropie,
  kanHerkalibreren, herkalibreer, schaalTekstVoorPpu, maakControle,
} from '../../../annotations/schaalcontrole.js';
import { legControleVast, drempelsUitVoorkeuren, bronLabel } from '../../../annotations/schaalcontrole-app.js';

const EENHEDEN = ['mm', 'cm', 'm', 'in', 'ft'];

// Decimalen per eenheid, zoals de maten zelf (formatMeasurement).
const decimalenVoor = (unit) => (unit === 'mm' ? 1 : unit === 'cm' ? 2 : 3);

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/** Punten uit een geselecteerde maatlijn. */
function puntenUitMaat(ann) {
  if (!ann || ann.type !== 'measureDistance') return null;
  if (![ann.startX, ann.startY, ann.endX, ann.endY].every(Number.isFinite)) return null;
  return {
    p1: { x: ann.startX, y: ann.startY },
    p2: { x: ann.endX, y: ann.endY },
    pageNum: ann.page || 1,
  };
}

/**
 * Schaalcontrole (#629): meet een tweede bekende maat na en toon de afwijking
 * in procenten en in eenheden, per schaalbron van de gemeten punten.
 */
export default function ScaleCheckDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const data = props.data || {};
  const doc = getActiveDocument();

  const beginPunten = data.punten || puntenUitMaat(doc?.annotations?.find((a) => a.id === data.annotationId))
    || puntenUitMaat(doc?.selectedAnnotation);
  const [punten] = createSignal(beginPunten || null);
  // Een maatlijn uit een ander programma draagt haar eigen tekst: die waarde
  // is een goede bekende lengte. Komt de tekst van deze app zelf (dezelfde
  // waarde als de schaal geeft), dan zegt hij niets en blijft het veld leeg.
  const vanMaat = doc?.annotations?.find((a) => a.id === data.annotationId) || doc?.selectedAnnotation;
  const [bekendTekst, setBekendTekst] = createSignal(data.restore?.bekend ?? '');
  const [eenheid, setEenheid] = createSignal(data.restore?.eenheid || null);
  const [actie, setActie] = createSignal(data.restore?.actie || 'none');

  const meting = createMemo(() => {
    const p = punten();
    if (!p || !doc) return null;
    const dx = p.p2.x - p.p1.x;
    const dy = p.p2.y - p.p1.y;
    const afstand = Math.sqrt(dx * dx + dy * dy);
    const bronnen = bronVoorPunten(doc, p.pageNum, p.p1, p.p2);
    return { ...p, afstand, ...bronnen, richting: richtingVan(p.p1, p.p2) };
  });

  const bronEenheid = () => meting()?.bron?.unit || eenheid() || 'mm';
  const gekozenEenheid = () => eenheid() || bronEenheid();

  if (!data.restore && vanMaat?.type === 'measureDistance' && typeof vanMaat.measureText === 'string') {
    const m = meting();
    const waarde = leesGetalBegin(vanMaat.measureText);
    if (m?.bron && Number.isFinite(waarde) && waarde > 0) {
      const eigen = m.afstand / m.bron.pixelsPerUnit;
      const unitInTekst = (/([a-z]+)\s*$/i.exec(vanMaat.measureText) || [])[1];
      const u = EENHEDEN.includes(unitInTekst) ? unitInTekst : (vanMaat.measureUnit || m.bron.unit);
      const inBron = (waarde * (MM_PER_UNIT[u] || 1)) / (MM_PER_UNIT[m.bron.unit] || 1);
      if (Math.abs(inBron - eigen) / eigen > 1e-4) {
        setBekendTekst(String(waarde));
        if (EENHEDEN.includes(u)) setEenheid(u);
      }
    }
  }

  /** De bekende lengte in de eenheid van de bron. */
  const bekend = createMemo(() => {
    const v = leesGetal(bekendTekst());
    if (!(v > 0)) return null;
    return (v * (MM_PER_UNIT[gekozenEenheid()] || 1)) / (MM_PER_UNIT[bronEenheid()] || 1);
  });

  const drempels = drempelsUitVoorkeuren();

  const uitkomst = createMemo(() => {
    const m = meting();
    const b = bekend();
    if (!m?.bron || !b) return null;
    const a = berekenAfwijking({ punten: m.afstand, bekend: b, pixelsPerUnit: m.bron.pixelsPerUnit });
    return a ? { ...a, status: classificeer(a.procent, drempels) } : null;
  });

  const geschiedenis = () => {
    const p = punten();
    const lijst = (p && doc?.scaleChecks?.[p.pageNum]) || [];
    return lijst;
  };

  // De anisotropie met de nieuwe meting erbij (nog niet vastgelegd).
  const scheefheid = createMemo(() => {
    const m = meting();
    const b = bekend();
    if (!m?.bron) return null;
    const nu = b ? maakControle({
      bron: m.bron, p1: m.p1, p2: m.p2, punten: m.afstand, bekend: b,
      eenheid: bronEenheid(), pixelsPerUnit: m.bron.pixelsPerUnit, drempels,
    }) : null;
    return anisotropie([...geschiedenis(), ...(nu ? [nu] : [])], m.bron.sleutel);
  });

  const nieuweSchaal = createMemo(() => {
    const m = meting();
    const b = bekend();
    if (!m || !b || actie() === 'none') return null;
    const ppu = herkalibreer(m.bron?.pixelsPerUnit, m.afstand, b, m.bron ? actie() : 'vervang');
    return ppu ? schaalTekstVoorPpu(ppu, bronEenheid()) : null;
  });

  const bronNaam = () => {
    const b = meting()?.bron;
    if (!b) return t('scaleCheck.sourceNone');
    const soort = t(`scaleCheck.source_${b.method}`);
    const label = bronLabel(b);
    const schaal = schaalTekstVoorPpu(b.pixelsPerUnit, b.unit);
    return [soort, label && label !== schaal ? `"${label}"` : '', schaal ? `(${schaal})` : ''].filter(Boolean).join(' ');
  };

  const richtingNaam = () => {
    const r = meting()?.richting;
    if (!r) return '';
    return r.as === 'x' ? t('scaleCheck.horizontal') : r.as === 'y' ? t('scaleCheck.vertical') : t('scaleCheck.diagonal');
  };

  const herkalibrerenMag = () => kanHerkalibreren(meting()?.bron || null);

  function meet() {
    const restore = { bekend: bekendTekst(), eenheid: eenheid(), actie: actie() };
    closeDialog('scale-check');
    const d = getActiveDocument();
    startScaleMeasureFlow({
      // Tijdens het kiezen: de lengte met de schaal op die plek.
      readout: (afstand, p1, p2, pageNum) => {
        const b = bronVoorPunten(d, pageNum, p1, p2).bron;
        return b ? formatMaat(afstand / b.pixelsPerUnit, b.unit, decimalenVoor(b.unit)) : null;
      },
      onDone: (_afstand, p) => openDialog('scale-check', { punten: p, restore }),
      onCancel: () => openDialog('scale-check', { punten: punten(), restore }),
    });
  }

  function legVast() {
    const m = meting();
    const b = bekend();
    if (!m || !b) return;
    const gekozen = m.bron ? (herkalibrerenMag() ? actie() : 'none') : 'vervang';
    const c = legControleVast({
      bron: m.bron, page: m.pageNum, p1: m.p1, p2: m.p2, punten: m.afstand, bekend: b,
      eenheid: bronEenheid(), actie: gekozen,
    });
    if (c) redraw();
    closeDialog('scale-check');
  }

  const kanVastleggen = () => !!meting() && !!bekend() && (!!meting()?.bron || actie() !== 'none');

  const statusTekst = (s) => t(`scaleCheck.status_${s}`);

  const datumTekst = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  };

  const footer = (
    <div class="calibration-footer-right" style="margin-left:auto">
      <button class="pref-btn pref-btn-secondary" onClick={() => closeDialog('scale-check')}>
        {tCommon('cancel')}
      </button>
      <button class="pref-btn pref-btn-primary" disabled={!kanVastleggen()} onClick={legVast}>
        {t('scaleCheck.record')}
      </button>
    </div>
  );

  return (
    <Dialog
      title={t('scaleCheck.title')}
      overlayClass="calibration-overlay"
      dialogClass="calibration-dialog scale-check-dialog"
      onClose={() => closeDialog('scale-check')}
      footer={footer}
    >
      <p class="calibration-help">{t('scaleCheck.help')}</p>

      <div class="calibration-row">
        <button class="calibration-detect-btn" onClick={meet}>{t('scaleCheck.measure')}</button>
        <Show when={meting()}>
          <span class="calibration-unit">
            {t('scaleCheck.page', { page: meting().pageNum })} · {richtingNaam()}
          </span>
        </Show>
      </div>

      <Show when={meting()} fallback={<p class="calibration-help">{t('scaleCheck.noPoints')}</p>}>
        <div class="scale-check-grid">
          <span>{t('scaleCheck.source')}</span>
          <span>{bronNaam()}</span>
        </div>
        <Show when={!meting().gelijk}>
          <p class="scale-check-note scale-check-warn">{t('scaleCheck.mixedSources')}</p>
        </Show>

        <div class="calibration-row">
          <label class="calibration-label">{t('scaleCheck.knownLength')}</label>
          <input
            type="text" inputmode="decimal" data-getal
            class="calibration-input"
            value={bekendTekst()}
            onInput={(e) => setBekendTekst(e.target.value)}
          />
          <select class="calibration-select" value={gekozenEenheid()} onChange={(e) => setEenheid(e.target.value)}>
            <For each={EENHEDEN}>{(u) => <option value={u}>{u}</option>}</For>
          </select>
        </div>

        <Show when={uitkomst()}>
          <div class="scale-check-grid">
            <span>{t('scaleCheck.measured')}</span>
            <span>{formatMaat(uitkomst().gemeten, bronEenheid(), decimalenVoor(bronEenheid()))}</span>
            <span>{t('scaleCheck.deviation')}</span>
            <span>
              {formatMaat(uitkomst().verschil, bronEenheid(), decimalenVoor(bronEenheid()))}
              {' '}({formatProcent(uitkomst().procent, 2, undefined, { teken: true })})
              {' '}<span class={`scale-check-badge scale-check-${uitkomst().status}`}>{statusTekst(uitkomst().status)}</span>
            </span>
          </div>
          <p class="scale-check-note">
            {t('scaleCheck.thresholds', { ok: formatProcent(drempels.ok, 2), warn: formatProcent(drempels.waarschuwing, 2) })}
          </p>
        </Show>

        <Show when={scheefheid()}>
          <div class="scale-check-grid">
            <span>{t('scaleCheck.anisotropy')}</span>
            <span>
              {t('scaleCheck.anisotropyValue', {
                x: formatGetal(scheefheid().factorX, 4),
                y: formatGetal(scheefheid().factorY, 4),
                pct: formatProcent(scheefheid().procent, 2, undefined, { teken: true }),
              })}
            </span>
          </div>
          <Show when={Math.abs(scheefheid().procent) > drempels.ok}>
            <p class="scale-check-note scale-check-warn">{t('scaleCheck.anisotropyHint')}</p>
          </Show>
        </Show>
        <Show when={!scheefheid() && meting()?.bron && (meting().richting.as !== 'schuin')}>
          <p class="scale-check-note">{t('scaleCheck.otherDirection')}</p>
        </Show>

        <fieldset class="pref-fieldset scale-check-fieldset">
          <legend>{t('scaleCheck.recalibrate')}</legend>
          <Show when={meting()?.bron} fallback={
            <label class="pref-checkbox-label">
              <input type="checkbox" checked={actie() !== 'none'} onChange={(e) => setActie(e.target.checked ? 'vervang' : 'none')} />
              <span>{t('scaleCheck.setScaleFromCheck')}</span>
            </label>
          }>
            <Show when={herkalibrerenMag()} fallback={<p class="scale-check-note">{t('scaleCheck.cannotRecalibrate')}</p>}>
              <label class="pref-checkbox-label">
                <input type="radio" name="scale-check-actie" checked={actie() === 'none'} onChange={() => setActie('none')} />
                <span>{t('scaleCheck.keep')}</span>
              </label>
              <label class="pref-checkbox-label">
                <input type="radio" name="scale-check-actie" checked={actie() === 'gemiddeld'} onChange={() => setActie('gemiddeld')} />
                <span>{t('scaleCheck.average')}</span>
              </label>
              <label class="pref-checkbox-label">
                <input type="radio" name="scale-check-actie" checked={actie() === 'vervang'} onChange={() => setActie('vervang')} />
                <span>{t('scaleCheck.replace')}</span>
              </label>
            </Show>
          </Show>
          <Show when={nieuweSchaal()}>
            <p class="scale-check-note">{t('scaleCheck.newScale', { scale: nieuweSchaal() })}</p>
          </Show>
        </fieldset>
      </Show>

      <Show when={geschiedenis().length > 0}>
        <div class="scale-check-history">
          <div class="scale-check-history-title">{t('scaleCheck.history')}</div>
          <table>
            <thead>
              <tr>
                <th>{t('scaleCheck.colDate')}</th>
                <th>{t('scaleCheck.colKnown')}</th>
                <th>{t('scaleCheck.colDeviation')}</th>
                <th>{t('scaleCheck.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={geschiedenis().slice(-6).reverse()}>
                {(c) => (
                  <tr title={[c.auteur, c.bron?.label, c.schaal].filter(Boolean).join(' · ')}>
                    <td>{datumTekst(c.datum)}</td>
                    <td>{formatMaat(c.bekend, c.eenheid, decimalenVoor(c.eenheid))}</td>
                    <td>{formatProcent(c.procent, 2, undefined, { teken: true })}</td>
                    <td><span class={`scale-check-badge scale-check-${c.status}`}>{statusTekst(c.status)}</span>
                      {c.actie && c.actie !== 'none' ? ` · ${t(c.actie === 'vervang' ? 'scaleCheck.replaced' : 'scaleCheck.averaged')}` : ''}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </Dialog>
  );
}
