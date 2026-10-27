import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Waarschuwing vóór het bewerken van een PDF/A-document (#379): bewerken
// breekt de conformiteit, tenzij het document bij opslaan opnieuw naar PDF/A
// wordt geconverteerd. De keuze geldt voor dit document tot het sluit.
export default function PdfAEditDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const label = () => props.data?.label || 'PDF/A';
  // Opnieuw converteren kan voor deel 1-3 (altijd niveau b).
  const deel = () => {
    const m = /^PDF\/A-(\d)/.exec(label());
    return m && ['1', '2', '3'].includes(m[1]) ? m[1] : null;
  };
  const [keuze, setKeuze] = createSignal(deel() ? 'herconverteer' : 'verwijder');
  const close = () => closeDialog('pdfa-edit');

  const ok = async () => {
    close();
    const { dismissPdfAForActiveDoc } = await import('../../../pdf/loader.js');
    dismissPdfAForActiveDoc(keuze());
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={ok}>{tCommon('ok')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('pdfa.editTitle')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog pdfa-edit-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="pdfa-tekst">{t('pdfa.editText', { label: label() })}</div>
        <label class="pdfa-keuze">
          <input type="radio" name="pdfa-edit" checked={keuze() === 'herconverteer'} disabled={!deel()}
            onChange={() => setKeuze('herconverteer')} />
          <span>
            <span>{t('pdfa.editKeep')}</span>
            <span class="pdfa-hint">{deel()
              ? t('pdfa.editKeepHint', { label: `PDF/A-${deel()}b` })
              : t('pdfa.reconvertNotSupported', { label: label() })}</span>
          </span>
        </label>
        <label class="pdfa-keuze">
          <input type="radio" name="pdfa-edit" checked={keuze() === 'verwijder'} onChange={() => setKeuze('verwijder')} />
          <span>
            <span>{t('pdfa.editPlain')}</span>
            <span class="pdfa-hint">{t('pdfa.editPlainHint')}</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
