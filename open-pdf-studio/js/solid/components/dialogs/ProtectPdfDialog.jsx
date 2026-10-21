import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { controleerWachtwoorden, STANDAARD_RECHTEN } from '../../../pdf/protect-pdf.js';

const LABEL_STYLE = { width: '170px' };

// Rights, in the order they are shown: [key in the rights object, i18n key].
const RECHTEN = [
  ['print', 'protectPdf.allowPrint'],
  ['printHogeKwaliteit', 'protectPdf.allowPrintHigh'],
  ['kopieren', 'protectPdf.allowCopy'],
  ['wijzigen', 'protectPdf.allowEdit'],
  ['annoteren', 'protectPdf.allowAnnotate'],
  ['formulieren', 'protectPdf.allowForms'],
  ['samenstellen', 'protectPdf.allowAssemble'],
];

/**
 * "Protect with password": passwords and rights for a protected copy of the
 * open document (js/pdf/protect-pdf.js). Windows-style dialog via Dialog.jsx:
 * movable, does not close on a click outside.
 */
export default function ProtectPdfDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [gebruiker, setGebruiker] = createSignal('');
  const [gebruikerHerhaald, setGebruikerHerhaald] = createSignal('');
  const [eigenaar, setEigenaar] = createSignal('');
  const [eigenaarHerhaald, setEigenaarHerhaald] = createSignal('');
  const [rechten, setRechten] = createSignal({ ...STANDAARD_RECHTEN });
  const [fout, setFout] = createSignal('');
  const [bezig, setBezig] = createSignal(false);

  const close = () => closeDialog('protect-pdf');

  const zetRecht = (sleutel, aan) => setRechten((r) => ({ ...r, [sleutel]: aan }));

  const handleApply = async () => {
    if (bezig()) return;
    const probleem = controleerWachtwoorden({
      gebruiker: gebruiker(),
      gebruikerHerhaald: gebruikerHerhaald(),
      eigenaar: eigenaar(),
      eigenaarHerhaald: eigenaarHerhaald(),
    });
    if (probleem) {
      setFout(t(probleem));
      return;
    }
    setFout('');
    setBezig(true);
    const invoer = { gebruiker: gebruiker(), eigenaar: eigenaar(), rechten: rechten() };
    // De wachtwoorden niet langer in de dialoog laten staan dan nodig.
    setGebruiker(''); setGebruikerHerhaald(''); setEigenaar(''); setEigenaarHerhaald('');
    close();
    try {
      const { maakBeveiligdeKopie } = await import('../../../pdf/protect-pdf.js');
      const r = await maakBeveiligdeKopie(invoer);
      if (r.ok) showMessage(t('protectPdf.saved', { path: r.pad }));
      else if (r.reden === 'doel-is-geopend') showMessage(t('print.targetIsOpenFile'));
      else if (r.reden === 'mislukt') showMessage(t('protectPdf.failed', { error: r.fout }));
    } catch (e) {
      console.warn('Protect PDF failed:', e?.message || e);
      showMessage(t('protectPdf.failed', { error: e?.message || String(e) }));
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" id="protect-pdf-apply" disabled={bezig()} onClick={handleApply}>{t('protectPdf.apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  const wachtwoordRij = (labelKey, waarde, zet) => (
    <div class="crop-margins-row">
      <label class="crop-margins-label" style={LABEL_STYLE}>{t(labelKey)}</label>
      <input
        type="password"
        class="crop-margins-input"
        autocomplete="new-password"
        value={waarde()}
        onInput={(e) => zet(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );

  return (
    <Dialog
      title={t('protectPdf.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-info">{t('protectPdf.info')}</div>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.openPassword')}</legend>
          {wachtwoordRij('protectPdf.password', gebruiker, setGebruiker)}
          {wachtwoordRij('protectPdf.repeat', gebruikerHerhaald, setGebruikerHerhaald)}
          <div class="pref-hint">{t('protectPdf.openPasswordHint')}</div>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.rightsPassword')}</legend>
          {wachtwoordRij('protectPdf.password', eigenaar, setEigenaar)}
          {wachtwoordRij('protectPdf.repeat', eigenaarHerhaald, setEigenaarHerhaald)}
          <div class="pref-hint">{t('protectPdf.rightsPasswordHint')}</div>
          <div class="pref-hint">{t('protectPdf.rightsWarning')}</div>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.allow')}</legend>
          {RECHTEN.map(([sleutel, label]) => (
            <label class="pref-checkbox-row" style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
              <input type="checkbox" checked={rechten()[sleutel]} onChange={(e) => zetRecht(sleutel, e.target.checked)} />
              <span>{t(label)}</span>
            </label>
          ))}
        </fieldset>

        {fout() && <div class="crop-margins-info" style={{ color: '#e81123' }}>{fout()}</div>}
      </div>
    </Dialog>
  );
}
