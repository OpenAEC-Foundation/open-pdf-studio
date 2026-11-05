import { Show } from 'solid-js';
import { visible, label } from '../stores/pdfaBarStore.js';
import { openDialog } from '../stores/dialogStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

export default function PdfABar() {
  const { t } = useTranslation('statusbar');
  const { t: tCommon } = useTranslation('common');

  // Bewerken inschakelen vraagt eerst of het document PDF/A moet blijven
  // (#379); de keuze geldt bij het opslaan.
  const handleEnable = () => openDialog('pdfa-edit', { label: label() });
  const handleValidate = () => openDialog('pdfa', {});

  return (
    <Show when={visible()}>
      <div class="pdfa-bar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1.5L1 14h14L8 1.5zm0 2.5l5.2 9H2.8L8 4zm-.5 4v3h1V8h-1zm0 4v1h1v-1h-1z" fill="currentColor"/>
        </svg>
        <span>{t('pdfaReadOnly', { label: label() })}</span>
        <button class="pdfa-bar-action" onClick={handleValidate}>{t('pdfaValidate')}</button>
        <button class="pdfa-bar-action" onClick={handleEnable}>{t('enableEditing')}</button>
        <button class="pdfa-bar-close" onClick={handleEnable} title={tCommon('close')}>&times;</button>
      </div>
    </Show>
  );
}
