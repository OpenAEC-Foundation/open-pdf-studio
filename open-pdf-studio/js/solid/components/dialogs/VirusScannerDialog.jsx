import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { DIALOOG, feedbackVoorinvulling } from '../../../help/virusscanner-melding.js';

// Uitleg over een waarschuwing van een virusscanner (#761), als los venster
// via Help en het app-menu. Dezelfde tekst staat één keer in de release-notes
// (WhatsNewDialog.jsx, help/virusscanner-melding.js).
export default function VirusScannerDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const close = () => closeDialog(DIALOOG);

  // Het feedbackvenster opent met het onderwerp en de gevraagde gegevens al
  // ingevuld; deze melding maakt er plaats voor.
  const meld = () => {
    close();
    openDialog('feedback', feedbackVoorinvulling(t));
  };

  const footer = (
    <div class="message-dialog-footer">
      <button id="virus-notice-report" class="pref-btn pref-btn-primary" onClick={meld}>{t('virusNotice.report')}</button>
      <button id="virus-notice-ok" class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('ok')}</button>
    </div>
  );

  return (
    <Dialog
      title={t('virusNotice.title')}
      dialogClass="message-dialog virus-notice-dialog"
      onClose={close}
      footer={footer}
    >
      <div class="message-dialog-body virus-notice-body">
        <p>{t('virusNotice.intro')}</p>
        <p>{t('virusNotice.signed')}</p>
        <p>{t('virusNotice.action')}</p>
        <p>{t('virusNotice.include')}</p>
      </div>
    </Dialog>
  );
}
