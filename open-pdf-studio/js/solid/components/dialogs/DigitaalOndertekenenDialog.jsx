import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { foutMelding, geldigeTijdstempelUrl } from '../../../pdf/handtekeningen/ondertekenen-regels.js';
import { formatTijd } from '../../../pdf/handtekeningen/weergave.js';
import {
  leesKeuzes, bewaarKeuzes, opgeslagenAfbeeldingen, kiesCertificaatbestand, leesCertificaat, voerOndertekeningUit,
} from '../../../pdf/handtekeningen/ondertekenen.js';

const NAAM = 'digital-sign';

/**
 * "Digitaal ondertekenen" (#374): certificaat (.p12/.pfx) met wachtwoord,
 * zichtbaar of onzichtbaar, reden/plaats/contact, formaat en optioneel een
 * tijdstempeldienst. Windows-stijl via Dialog.jsx: verplaatsbaar, sluit niet
 * bij een klik ernaast. Het wachtwoord wordt nooit bewaard.
 */
export default function DigitaalOndertekenenDialog(props) {
  const { t, language } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const v = (sleutel, opties) => t(`digitalSign.${sleutel}`, opties);

  // Na een afgebroken vakkeuze komt de dialoog terug met dezelfde invoer.
  const herstel = props.data?.herstel || null;
  const docId = props.data?.docId ?? null;
  const [keuzes, setKeuzes] = createSignal(herstel?.keuzes || leesKeuzes());
  const [wachtwoord, setWachtwoord] = createSignal(herstel?.wachtwoord || '');
  const [certificaat, setCertificaat] = createSignal(herstel?.certificaat || null);
  const [fout, setFout] = createSignal('');
  const [bezig, setBezig] = createSignal(false);
  const afbeeldingen = opgeslagenAfbeeldingen();

  const zet = (veld, waarde) => setKeuzes((k) => ({ ...k, [veld]: waarde }));
  const close = () => closeDialog(NAAM);

  const vergeetCertificaat = () => { setCertificaat(null); setFout(''); };

  async function bladeren() {
    const pad = await kiesCertificaatbestand();
    if (!pad) return;
    zet('p12', pad);
    vergeetCertificaat();
  }

  async function lees() {
    const pad = keuzes().p12;
    if (!pad) {
      setFout(v('needCertificate'));
      return null;
    }
    setBezig(true);
    try {
      const info = await leesCertificaat(pad, wachtwoord());
      setCertificaat(info);
      setFout(info.ondersteund ? '' : v('errors.unsupportedKey', { detail: info.sleuteltype }));
      return info;
    } catch (e) {
      setCertificaat(null);
      const { sleutel, opties } = foutMelding(e);
      setFout(t(sleutel, opties));
      return null;
    } finally {
      setBezig(false);
    }
  }

  async function onderteken() {
    if (bezig()) return;
    const info = certificaat() || (await lees());
    if (!info) return;
    if (!info.ondersteund) return;
    if (info.sleutelgebruikOndertekenen === false) {
      setFout(v('errors.keyUsage'));
      return;
    }
    if (!geldigeTijdstempelUrl(keuzes().tijdstempelUrl)) {
      setFout(v('timestampUrlInvalid'));
      return;
    }
    const doc = getActiveDocument();
    if (!doc || (docId !== null && (doc.id ?? null) !== docId)) {
      close();
      return;
    }
    const k = { ...keuzes(), tijdstempelUrl: (keuzes().tijdstempelUrl || '').trim() };
    bewaarKeuzes(k);
    const ww = wachtwoord();
    // Het wachtwoord niet langer in de dialoog laten staan dan nodig.
    setWachtwoord('');
    close();
    const r = await voerOndertekeningUit({ doc, keuzes: k, wachtwoord: ww, certificaat: info });
    if (r.ok) return;
    if (r.reden === 'vak-afgebroken') {
      openDialog(NAAM, { docId, herstel: { keuzes: k, wachtwoord: ww, certificaat: info } });
      return;
    }
    if (r.reden === 'fout' && r.tekst) showMessage(r.tekst);
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (certificaat()) onderteken();
      else lees();
    }
  };

  const geldigheid = () => {
    const c = certificaat();
    if (!c) return '';
    return v('validity', {
      from: formatTijd(c.geldigVanUnix, language()) || '',
      to: formatTijd(c.geldigTotUnix, language()) || '',
    });
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" id="digital-sign-apply"
          disabled={bezig() || (certificaat() && !certificaat().ondersteund)} onClick={onderteken}>{v('sign')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  const tekstRij = (label, veld) => (
    <div class="crop-margins-row">
      <label class="crop-margins-label digital-sign-label">{v(label)}</label>
      <input type="text" class="crop-margins-input-wide" spellcheck={false} value={keuzes()[veld]}
        onInput={(e) => zet(veld, e.target.value)} onKeyDown={onKeyDown} />
    </div>
  );

  return (
    <Dialog
      title={v('title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog digital-sign-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-info">{v('info')}</div>

        <fieldset class="pref-fieldset">
          <legend>{v('certificateGroup')}</legend>
          <div class="crop-margins-row">
            <label class="crop-margins-label digital-sign-label">{v('certificate')}</label>
            <input type="text" class="crop-margins-input-wide" readOnly value={keuzes().p12} title={keuzes().p12} />
            <button class="pref-btn pref-btn-secondary digital-sign-knop" onClick={bladeren}>{v('browse')}</button>
          </div>
          <div class="crop-margins-row">
            <label class="crop-margins-label digital-sign-label">{v('password')}</label>
            <input type="password" class="crop-margins-input-wide" autocomplete="off" spellcheck={false}
              value={wachtwoord()} onInput={(e) => { setWachtwoord(e.target.value); vergeetCertificaat(); }} onKeyDown={onKeyDown} />
            <button class="pref-btn pref-btn-secondary digital-sign-knop" disabled={bezig()} onClick={lees}>{v('readCertificate')}</button>
          </div>
          <Show when={certificaat()}>
            <div class="digital-sign-cert">
              <div><span class="digital-sign-cert-label">{v('signer')}</span> {certificaat().naam}</div>
              <div><span class="digital-sign-cert-label">{v('issuer')}</span> {certificaat().uitgever}</div>
              <div class="protect-pdf-hint">{geldigheid()}</div>
              <Show when={certificaat().sleutelgebruikOndertekenen === false}>
                <div class="protect-pdf-fout">{v('errors.keyUsage')}</div>
              </Show>
            </div>
          </Show>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{v('appearance')}</legend>
          <label class="pref-checkbox-label">
            <input type="radio" name="digital-sign-zichtbaar" checked={!keuzes().zichtbaar} onChange={() => zet('zichtbaar', false)} />
            <span>{v('invisible')}</span>
          </label>
          <label class="pref-checkbox-label">
            <input type="radio" name="digital-sign-zichtbaar" checked={keuzes().zichtbaar} onChange={() => zet('zichtbaar', true)} />
            <span>{v('visible')}</span>
          </label>
          <Show when={keuzes().zichtbaar}>
            <div class="crop-margins-row">
              <label class="crop-margins-label digital-sign-label">{v('image')}</label>
              <select class="crop-margins-input-wide" value={String(keuzes().afbeelding < afbeeldingen.length ? keuzes().afbeelding : -1)}
                onChange={(e) => zet('afbeelding', Number(e.target.value))}>
                <option value="-1">{v('noImage')}</option>
                <For each={afbeeldingen}>
                  {(_a, i) => <option value={String(i())}>{v('savedImage', { number: i() + 1 })}</option>}
                </For>
              </select>
            </div>
            <Show when={keuzes().afbeelding >= 0 && afbeeldingen[keuzes().afbeelding]}>
              <img class="digital-sign-voorbeeld" src={afbeeldingen[keuzes().afbeelding]?.dataUrl} alt="" />
            </Show>
            <div class="protect-pdf-hint">{v('visibleHint')}</div>
          </Show>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{v('details')}</legend>
          {tekstRij('reason', 'reden')}
          {tekstRij('location', 'plaats')}
          {tekstRij('contact', 'contact')}
          <div class="crop-margins-row">
            <label class="crop-margins-label digital-sign-label">{v('format')}</label>
            <select class="crop-margins-input-wide" value={keuzes().subfilter} onChange={(e) => zet('subfilter', e.target.value)}>
              <option value="ETSI.CAdES.detached">{v('formatPades')}</option>
              <option value="adbe.pkcs7.detached">{v('formatPkcs7')}</option>
            </select>
          </div>
          {tekstRij('timestampUrl', 'tijdstempelUrl')}
          <div class="protect-pdf-hint">{v('timestampHint')}</div>
        </fieldset>

        <div class="protect-pdf-hint">{v('afterSigning')}</div>
        {fout() && <div class="protect-pdf-fout" role="alert">{fout()}</div>}
      </div>
    </Dialog>
  );
}
