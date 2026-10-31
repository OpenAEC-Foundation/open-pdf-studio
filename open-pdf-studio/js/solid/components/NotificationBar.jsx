import { Show } from 'solid-js';
import { visible, hideDefaultAppBar } from '../stores/defaultAppBarStore.js';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { showMessage } from '../stores/dialogStore.js';

export default function NotificationBar() {
  const { t } = useTranslation('dialogs');
  const { t: tPrefs } = useTranslation('preferences');
  // Set as Default: on Linux this sets the xdg-mime default, on Windows it
  // opens the settings page. The outcome (done, instructions, or why it
  // could not be done) is shown instead of failing silently.
  const handleSetDefault = async () => {
    hideDefaultAppBar();
    const platform = await import('../../core/platform.js');
    const { zetAlsStandaard, platformUit } = await import('../../core/standaard-pdf-app.js');
    const melding = await zetAlsStandaard({
      invoke: platform.invoke,
      status: await platform.defaultPdfAppStatus(),
      platform: platformUit(navigator.platform || navigator.userAgent),
    });
    if (melding) showMessage(tPrefs(melding.sleutel, melding.opties));
  };

  const handleDontAsk = () => {
    state.preferences.dontAskDefaultPdf = true;
    import('../../core/preferences.js').then(m => m.savePreferences());
    hideDefaultAppBar();
  };

  const handleDismiss = () => {
    hideDefaultAppBar();
  };

  return (
    <Show when={visible()}>
      <div class="notification-bar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M7.5 5V4h1v1h-1zm0 7V6.5h1V12h-1z" fill="currentColor"/>
        </svg>
        <span>{t('defaultPdfApp.message')}</span>
        <button class="notification-bar-action" onClick={handleSetDefault}>{t('defaultPdfApp.setAsDefault')}</button>
        <button class="notification-bar-action" onClick={handleDontAsk}>{t('defaultPdfApp.dontAskAgain')}</button>
        <button class="notification-bar-close" onClick={handleDismiss} title={t('defaultPdfApp.notNow')}>&times;</button>
      </div>
    </Show>
  );
}
