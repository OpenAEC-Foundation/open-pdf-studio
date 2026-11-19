import { createSignal, createMemo, createEffect, onMount, Show, For } from 'solid-js';
import { kleurOpname } from '../../../tools/screenshot-lijnkleur.js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import {
  RESOLUTIES, MIN_DPI, MAX_DPI,
  keuzeUitVoorkeuren, keuzeNaarVoorkeuren, gekozenDpi, uitvoerMaat, dpiVoorBreedte,
} from '../../../tools/screenshot-keuze.js';

const VOORBEELD_B = 340;
const VOORBEELD_H = 200;

// Home → Screenshot: what to do with the selected area. The area is rendered
// again from the page at the chosen resolution (tools/screenshot.js).
export default function ScreenshotDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const gebied = props.data?.gebied;
  const start = keuzeUitVoorkeuren(state.preferences);

  const [resolutie, setResolutie] = createSignal(start.resolutie);
  const [eigenDpi, setEigenDpi] = createSignal(start.eigenDpi);
  const [formaat, setFormaat] = createSignal(start.formaat);
  const [kwaliteit, setKwaliteit] = createSignal(start.kwaliteit);
  const [standaardActie, setStandaardActie] = createSignal(start.actie);
  const [bezig, setBezig] = createSignal(false);
  const [fout, setFout] = createSignal('');
  const [kleurAan, setKleurAan] = createSignal(false);
  const [kleur, setKleur] = createSignal('#c00000');
  const lijnkleur = () => kleurAan() ? kleur() : null;
  const [voorbeeldBron, setVoorbeeldBron] = createSignal(null);
  let voorbeeldRef;
  createEffect(() => {
    const bron = voorbeeldBron();
    const inkt = lijnkleur();
    if (!bron) return;
    voorbeeldRef.getContext('2d').drawImage(bron, 0, 0);
    kleurOpname(voorbeeldRef, inkt);
  });

  const keuze = () => ({ resolutie: resolutie(), eigenDpi: eigenDpi(), formaat: formaat(), kwaliteit: kwaliteit(), actie: standaardActie() });
  const dpi = createMemo(() => gekozenDpi(keuze(), gebied?.schermDpi));
  const maat = createMemo(() => (gebied ? uitvoerMaat(gebied.rect.width, gebied.rect.height, dpi()) : null));
  // Width and height as they come out (a quarter turn of the view swaps them).
  const kwartslag = () => {
    const r = ((Number(gebied?.doc?.viewRotation) || 0) % 360 + 360) % 360;
    return r === 90 || r === 270;
  };
  const pxB = () => (maat() ? (kwartslag() ? maat().hoogte : maat().breedte) : 0);
  const pxH = () => (maat() ? (kwartslag() ? maat().breedte : maat().hoogte) : 0);
  const mm = (pt) => Math.round((pt * 25.4) / 72);

  const close = () => closeDialog('screenshot');

  const bewaarKeuze = (actie) => {
    setStandaardActie(actie);
    Object.assign(state.preferences, keuzeNaarVoorkeuren({ ...keuze(), actie }));
    import('../../../core/preferences.js').then((m) => m.savePreferences()).catch(() => {});
  };

  const voerUit = async (actie) => {
    if (!gebied || bezig()) return;
    setBezig(true);
    setFout('');
    try {
      const m = await import('../../../tools/screenshot.js');
      if (actie === 'save') {
        const pad = await m.bewaarSchermafbeelding(gebied, dpi(), formaat(), kwaliteit(), lijnkleur());
        if (!pad) { setBezig(false); return; } // save dialog cancelled: stay open
      } else {
        await m.kopieerSchermafbeelding(gebied, dpi(), lijnkleur());
      }
      bewaarKeuze(actie);
      close();
    } catch (e) {
      console.error('[screenshot]', e);
      setFout(t(actie === 'save' ? 'screenshot.saveFailed' : 'screenshot.copyFailed') + (e?.message ? ` (${e.message})` : ''));
      setBezig(false);
    }
  };

  // Enter = the default action (the one used last), unless a button has focus
  // (Enter clicks that button).
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.target?.closest?.('button')) return;
    e.preventDefault();
    voerUit(standaardActie());
  };

  const zetBreedte = (px) => {
    const breedtePt = kwartslag() ? gebied.rect.height : gebied.rect.width;
    const d = dpiVoorBreedte(breedtePt, px);
    if (!d) return;
    setEigenDpi(d);
    setResolutie('custom');
  };

  onMount(async () => {
    if (!gebied || !voorbeeldRef) return;
    try {
      const { renderGebied } = await import('../../../tools/screenshot.js');
      const dpr = window.devicePixelRatio || 1;
      const zijB = kwartslag() ? gebied.rect.height : gebied.rect.width;
      const zijH = kwartslag() ? gebied.rect.width : gebied.rect.height;
      // Fill the preview box (sharper than the screen when zoomed out); a
      // tiny area stops at 8 px per point.
      const schaal = Math.min((VOORBEELD_B * dpr) / zijB, (VOORBEELD_H * dpr) / zijH, 8);
      const m = uitvoerMaat(gebied.rect.width, gebied.rect.height, schaal * 72);
      const pagina = await renderGebied(gebied, m.schaal, m.breedte, m.hoogte);
      const r = ((Number(gebied.doc?.viewRotation) || 0) % 360 + 360) % 360;
      const c = voorbeeldRef;
      c.width = kwartslag() ? pagina.height : pagina.width;
      c.height = kwartslag() ? pagina.width : pagina.height;
      c.style.width = `${c.width / dpr}px`;
      c.style.height = `${c.height / dpr}px`;
      const bron = document.createElement('canvas');
      bron.width = c.width;
      bron.height = c.height;
      const ctx = bron.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((r * Math.PI) / 180);
      ctx.drawImage(pagina, -pagina.width / 2, -pagina.height / 2);
      setVoorbeeldBron(bron);
      c.dataset.klaar = '1';
    } catch (e) {
      console.warn('[screenshot] preview failed:', e);
    }
  });

  const resolutieLabel = (r) => {
    if (r === 'screen') return t('screenshot.screenResolution', { dpi: gebied?.schermDpi ?? 96 });
    if (r === 'custom') return t('screenshot.custom');
    return `${r} dpi`;
  };

  const knop = (actie, label, id) => (
    <button
      id={id}
      class={`pref-btn ${standaardActie() === actie ? 'pref-btn-primary' : 'pref-btn-secondary'}`}
      disabled={bezig() || !gebied}
      onClick={() => voerUit(actie)}
    >{label}</button>
  );

  const footer = (
    <>
      <div class="screenshot-status">{bezig() ? t('screenshot.busy') : ''}</div>
      <div class="crop-margins-footer-right">
        {knop('copy', t('screenshot.copy'), 'screenshot-copy')}
        {knop('save', t('screenshot.saveAs'), 'screenshot-save')}
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('screenshot.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog screenshot-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form" onKeyDown={onKeyDown}>
        <div class="screenshot-preview">
          <canvas ref={voorbeeldRef} id="screenshot-preview-canvas" width="1" height="1" />
        </div>
        <Show when={gebied}>
          <div class="crop-margins-info">
            {t('screenshot.area', {
              page: gebied.pageNum,
              width: mm(kwartslag() ? gebied.rect.height : gebied.rect.width),
              height: mm(kwartslag() ? gebied.rect.width : gebied.rect.height),
            })}
            <Show when={gebied.afgesneden}>{' '}{t('screenshot.clipped')}</Show>
          </div>
        </Show>
        <div class="crop-margins-row">
          <label class="crop-margins-label" for="screenshot-resolution">{t('screenshot.resolution')}</label>
          <select
            id="screenshot-resolution"
            class="crop-margins-select"
            value={String(resolutie())}
            onChange={(e) => {
              const v = e.target.value;
              // Custom starts from the resolution that was showing.
              if (v === 'custom') setEigenDpi(dpi());
              setResolutie(/^\d+$/.test(v) ? Number(v) : v);
            }}
          >
            <For each={RESOLUTIES}>{(r) => <option value={String(r)}>{resolutieLabel(r)}</option>}</For>
          </select>
          <input
            id="screenshot-dpi"
            class="crop-margins-input"
            type="text" inputmode="decimal" data-getal
            min={MIN_DPI}
            max={MAX_DPI}
            step="1"
            disabled={resolutie() !== 'custom'}
            value={resolutie() === 'custom' ? eigenDpi() : dpi()}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (n >= MIN_DPI && n <= MAX_DPI) setEigenDpi(n);
              else e.target.value = eigenDpi();
            }}
          />
          <span class="screenshot-unit">dpi</span>
        </div>
        <div class="crop-margins-row">
          <label class="crop-margins-label" for="screenshot-width">{t('screenshot.size')}</label>
          <input
            id="screenshot-width"
            class="crop-margins-input"
            type="text" inputmode="decimal" data-getal
            min="1"
            step="1"
            value={pxB()}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (n > 0) zetBreedte(n);
              else e.target.value = pxB();
            }}
          />
          <span class="screenshot-unit">× <span id="screenshot-height">{pxH()}</span> px</span>
        </div>
        <Show when={maat()?.beperkt}>
          <div class="crop-margins-info screenshot-warning">{t('screenshot.limited', { dpi: maat().dpi })}</div>
        </Show>
        <div class="crop-margins-row">
          <label class="crop-margins-label"><input type="checkbox" checked={kleurAan()} onChange={e => setKleurAan(e.currentTarget.checked)} /> {t('properties:appearance.lineworkColor')}</label>
          <input id="screenshot-line-color" type="color" aria-label={t('properties:appearance.lineworkColor')} value={kleur()} disabled={!kleurAan()} onInput={e => setKleur(e.currentTarget.value)} />
        </div>
        <div class="crop-margins-row">
          <label class="crop-margins-label" for="screenshot-format">{t('screenshot.format')}</label>
          <select id="screenshot-format" class="crop-margins-select" value={formaat()}
            onChange={(e) => setFormaat(e.target.value === 'jpeg' ? 'jpeg' : 'png')}>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </select>
        </div>
        <Show when={formaat() === 'jpeg'}>
          <div class="crop-margins-row">
            <label class="crop-margins-label" for="screenshot-quality">{t('screenshot.quality')}</label>
            <input id="screenshot-quality" class="crop-margins-slider" type="range" min="10" max="100" step="5"
              value={kwaliteit()} onInput={(e) => setKwaliteit(Number(e.target.value))} />
            <span class="crop-margins-threshold-value">{kwaliteit()}</span>
          </div>
        </Show>
        <div class="crop-margins-info">{t('screenshot.clipboardNote')}</div>
        <Show when={fout()}>
          <div class="crop-margins-info screenshot-warning">{fout()}</div>
        </Show>
      </div>
    </Dialog>
  );
}
