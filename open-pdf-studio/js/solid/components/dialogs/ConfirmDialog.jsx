import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ConfirmDialog(props) {
  const { t } = useTranslation('common');
  const data = props.data || {};
  const [dontShow, setDontShow] = createSignal(false);

  const handleYes = () => {
    if (dontShow() && data.preferenceKey) {
      state.preferences[data.preferenceKey] = false;
      savePreferences();
    }
    closeDialog('confirm');
    if (data.resolve) data.resolve(true);
  };

  const handleNo = () => {
    closeDialog('confirm');
    if (data.resolve) data.resolve(false);
  };

  return (
    <Dialog
      title={data.title || t('confirm')}
      dialogClass="confirm-dialog"
      onClose={handleNo}
    >
      <div class="confirm-dialog-body">
        <div class="confirm-dialog-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e6a700" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13" stroke="#e6a700" stroke-width="2"/>
            <line x1="12" y1="17" x2="12.01" y2="17" stroke="#e6a700" stroke-width="2"/>
          </svg>
        </div>
        <p class="confirm-dialog-message">{data.message || t('areYouSure')}</p>
      </div>
      <div class="confirm-dialog-checkbox" onClick={() => setDontShow(!dontShow())}>
        <input type="checkbox" checked={dontShow()} />
        <span>{t('dontShowAgain')}</span>
      </div>
      <div class="confirm-dialog-buttons">
        <button class="confirm-dialog-btn confirm-dialog-btn-yes" onClick={handleYes}>{t('yes')}</button>
        <button class="confirm-dialog-btn confirm-dialog-btn-no" onClick={handleNo}>{t('no')}</button>
      </div>
    </Dialog>
  );
}
