import { For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  statusSleutel, redenSleutel, tijdstempelStatusSleutel, formatTijd, woordenboekNietOndertekend,
  heeftZwakAlgoritme, formatGetal, voegSamen, lijstIsAfgekapt, signaalSleutels, tijdstempelSignaalSleutels,
  technischDetail, documenttijdstempelNaam,
} from '../../../pdf/handtekeningen/weergave.js';

function Rij(props) {
  return (
    <Show when={props.value !== null && props.value !== undefined && props.value !== ''}>
      <div class="doc-props-row">
        <span class="doc-props-label">{props.label}</span>
        <span class="doc-props-value">{props.value}</span>
      </div>
    </Show>
  );
}

// Details van één handtekening: status, ondertekenaar, tijd, dekking en keten.
export default function HandtekeningDetailDialog(props) {
  const { t, language } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const { t: tProps } = useTranslation('properties');
  const v = (sleutel, opties) => t(`signatureVerification.${sleutel}`, opties);
  // Haakjes en scheidingstekens volgen de taal.
  const metNoot = (text, note) => v('format.note', { text, note });
  const verbind = (first, second) => v('format.joined', { first, second });
  const h = props.data?.info || {};
  const close = () => closeDialog('handtekening-detail');
  const tijd = (unix) => formatTijd(unix, language());
  // Reden, plaats, contact, opgegeven naam en /M buiten het eigen bytebereik
  // zijn niet mee ondertekend: dat staat er dan direct achter.
  const nietOndertekend = (tekst) => {
    if (tekst === null || tekst === undefined || tekst === '') return tekst;
    return woordenboekNietOndertekend(h) ? metNoot(tekst, v('detail.notCoveredBySignature')) : tekst;
  };

  const status = () => {
    const basis = t(statusSleutel(h));
    return h.daarnaGewijzigd ? verbind(basis, v('changedAfterwards')) : basis;
  };
  const toelichting = () => {
    const sleutel = redenSleutel(h);
    return sleutel ? t(sleutel) : '';
  };
  // Vaste signalen uit de verificatie, vertaald. De ruwe `detail` (Nederlands,
  // voor wie het precies wil weten) staat alleen onder "Technisch detail".
  const signalen = () => signaalSleutels(h).map((s) => t(s));
  const technisch = () => technischDetail(h);
  const ondertekenaar = () => {
    if (h.soort === 'documenttijdstempel') return documenttijdstempelNaam(h, v);
    if (h.ondertekenaar) return h.ondertekenaar;
    if (h.opgegevenNaam) return nietOndertekend(h.opgegevenNaam);
    return v('unknownSigner');
  };
  const tijdstip = () => {
    const tekst = tijd(h.tijdUnix);
    if (!tekst) return v('detail.none');
    if (h.tijdBron === 'tijdstempel') return v('detail.timeFromTimestamp', { time: tekst });
    const opgegeven = v('detail.timeClaimed', { time: tekst });
    return h.tijdBron === 'opgegeven' ? nietOndertekend(opgegeven) : opgegeven;
  };
  const tijdstempel = () => {
    if (!h.tijdstempel) return h.soort === 'documenttijdstempel' ? null : v('detail.none');
    const delen = [
      t(tijdstempelStatusSleutel(h.tijdstempel)),
      h.tijdstempel.tsa,
      tijd(h.tijdstempel.tijdUnix),
      ...tijdstempelSignaalSleutels(h).map((s) => t(s)),
    ];
    return voegSamen(delen, verbind);
  };
  const dekking = () => {
    if (h.soort === 'leeg-veld' || h.bereikEinde === null || h.bereikEinde === undefined) return null;
    if (h.dektHeleDocument) return v('detail.coversWhole');
    const getal = (n) => formatGetal(n, language());
    return v('detail.coversPart', { start: getal(0), end: getal(h.bereikEinde), size: getal(h.bestandsgrootte) });
  };
  const certificaat = (c) => {
    const geldig = v('detail.validFromTo', { from: tijd(c.geldigVanUnix), to: tijd(c.geldigTotUnix) });
    return c.uitgever ? verbind(v('detail.issuedBy', { issuer: c.uitgever }), geldig) : geldig;
  };

  return (
    <Dialog
      title={v('detail.title')}
      dialogClass="doc-props-dialog handtekening-detail-dialog"
      bodyClass="doc-props-content"
      footerClass="doc-props-footer"
      onClose={close}
      footer={<button onClick={close}>{tCommon('ok')}</button>}
    >
      <div class="doc-props-section">
        <Rij label={v('detail.status')} value={status()} />
        <Rij label={v('detail.explanation')} value={toelichting()} />
        <For each={signalen()}>
          {(tekst) => <p class="handtekening-detail-signaal" role="note">{tekst}</p>}
        </For>
        <Show when={heeftZwakAlgoritme(h)}>
          <p class="handtekening-detail-waarschuwing" role="note">{v('detail.weakAlgorithm')}</p>
        </Show>
        <Show when={lijstIsAfgekapt([h])}>
          <p class="handtekening-detail-waarschuwing" role="note">{v('listTruncated')}</p>
        </Show>
      </div>
      <div class="doc-props-section">
        <Rij label={v('detail.signer')} value={ondertekenaar()} />
        <Rij label={v('detail.issuer')} value={h.uitgever} />
        <Rij label={v('detail.field')} value={h.veldnaam} />
        <Rij label={v('detail.time')} value={tijdstip()} />
        <Rij label={v('detail.timestamp')} value={tijdstempel()} />
        <Rij label={v('detail.reason')} value={nietOndertekend(h.reden)} />
        <Rij label={v('detail.location')} value={nietOndertekend(h.plaats)} />
        <Rij label={tProps('leftPanel.contact')} value={nietOndertekend(h.contact)} />
        <Rij label={v('detail.coverage')} value={dekking()} />
      </div>
      <Show when={(h.keten || []).length > 0}>
        <div class="doc-props-section">
          <h3>{v('detail.chain')}</h3>
          <For each={h.keten}>
            {(c) => <Rij label={c.naam} value={certificaat(c)} />}
          </For>
        </div>
      </Show>
      <p class="handtekening-detail-intrekking">{v('detail.revocationNotChecked')}</p>
      <Show when={technisch().length > 0}>
        <details class="handtekening-detail-technisch">
          <summary>{v('detail.technicalDetail')}</summary>
          <For each={technisch()}>
            {(regel) => <div class="handtekening-detail-technisch-regel">{regel}</div>}
          </For>
        </details>
      </Show>
    </Dialog>
  );
}
