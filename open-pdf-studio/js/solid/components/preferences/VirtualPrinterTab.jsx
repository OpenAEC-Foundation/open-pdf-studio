// Preferences → Virtual printer: the state of "Open PDF Printer" with an icon
// (catch active / still shows a Save dialog / not installed), a short 1-2-3
// of how it works, the install/enable/remove buttons and a button that opens
// the printer window. The state is read without changing anything
// (readPrinterState in printQueueStore.js).
import { createSignal, onMount, Show, Switch, Match } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { showMessage } from '../../stores/dialogStore.js';
import { readPrinterState, openPrintQueueWindow } from '../../stores/printQueueStore.js';
import { PRINTER_NAME } from '../../stores/print-queue-model.js';

const StateIcon = (props) => (
  <svg class={`vp-state-icon vp-icon-${props.state}`} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1.6">
    <Switch fallback={<><circle cx="10" cy="10" r="7.5" /><path d="M10 6v5M10 13.5v.6" /></>}>
      <Match when={props.state === 'active'}><circle cx="10" cy="10" r="7.5" /><path d="M6.5 10.2l2.4 2.4 4.6-4.8" /></Match>
      <Match when={props.state === 'dialog'}><path d="M10 2.8l7.8 13.7H2.2z" /><path d="M10 8v4M10 14v.6" /></Match>
      <Match when={props.state === 'missing'}><circle cx="10" cy="10" r="7.5" /><path d="M4.8 15.2L15.2 4.8" /></Match>
      <Match when={props.state === 'checking'}><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5V10l3 2" /></Match>
    </Switch>
  </svg>
);

export default function VirtualPrinterTab() {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  // 'checking' | 'active' | 'dialog' | 'missing' | 'unknown' | 'installFailed' | 'removeFailed'
  const [state, setState] = createSignal('checking');
  const [action, setAction] = createSignal('');        // progress text while installing/removing
  const [busy, setBusy] = createSignal(false);
  const [installedBefore, setInstalledBefore] = createSignal(false);

  onMount(() => {
    checkStatus();
  });

  async function checkStatus() {
    setState('checking');
    const s = await readPrinterState();
    setInstalledBefore(s === 'active' || s === 'dialog');
    setState(s);
  }

  const title = () => {
    if (action()) return action();
    switch (state()) {
      case 'active': return t('virtualPrinter.catchActive');
      case 'dialog': return t('virtualPrinter.saveDialogMode');
      case 'missing': return tCommon('notInstalled');
      case 'checking': return tCommon('checking');
      case 'installFailed': return t('virtualPrinter.installationFailed');
      case 'removeFailed': return t('virtualPrinter.removalFailed');
      default: return tCommon('unableToDetect');
    }
  };
  const detail = () => {
    switch (state()) {
      case 'active': return t('virtualPrinter.stateActiveDetail', { printer: PRINTER_NAME });
      case 'dialog': return t('virtualPrinter.stateDialogDetail');
      case 'missing': return t('virtualPrinter.stateMissingDetail');
      case 'unknown': return t('virtualPrinter.stateUnknownDetail');
      default: return '';
    }
  };
  const installed = () => state() === 'active' || state() === 'dialog' || (state() === 'removeFailed' && installedBefore());
  const iconState = () => {
    if (action() || state() === 'checking') return 'checking';
    if (state() === 'installFailed' || state() === 'removeFailed') return 'error';
    return state();
  };

  async function handleInstall() {
    setAction(t('virtualPrinter.installing'));
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      // Collection port: prints land in the spool dir so the printer window
      // (sort/merge) picks them up — from ANY application.
      await invoke('install_virtual_printer', { useCollection: true });
      // Start watching the spool right away (no restart needed).
      import('../../stores/printQueueStore.js')
        .then(m => m.startPrintQueueWatcher())
        .catch(() => {});
      setAction('');
      await checkStatus();
    } catch (err) {
      setAction('');
      setState('installFailed');
      showMessage(t('virtualPrinter.failedToInstall') + '\n' + (err.message || err));
    }
    setBusy(false);
  }

  // Switch an existing printer from the Save-dialog port (PORTPROMPT) to the
  // silent collection port. No UAC — changing a printer's port is allowed for
  // the current user (unlike installing the printer).
  async function handleEnableCatch() {
    setAction(t('virtualPrinter.installing'));
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      await invoke('virtual_printer_enable_catch');
      import('../../stores/printQueueStore.js').then(m => m.startPrintQueueWatcher()).catch(() => {});
      setAction('');
      await checkStatus();
    } catch (err) {
      setAction('');
      setState('installFailed');
      showMessage(t('virtualPrinter.failedToInstall') + '\n' + (err.message || err));
    }
    setBusy(false);
  }

  async function handleRemove() {
    setAction(t('virtualPrinter.removing'));
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      await invoke('remove_virtual_printer');
      setAction('');
      await checkStatus();
    } catch (err) {
      setAction('');
      setState('removeFailed');
      showMessage(t('virtualPrinter.failedToRemove') + '\n' + (err.message || err));
    }
    setBusy(false);
  }

  return (
    <fieldset class="pref-fieldset vp-tab">
      <legend>{t('virtualPrinter.title')}</legend>
      <p class="vp-description">{t('virtualPrinter.description')}</p>

      <div class={`vp-state vp-state-${iconState()}`} role="status" aria-live="polite">
        <StateIcon state={iconState()} />
        <div class="vp-state-text">
          <div class="vp-state-title">{title()}</div>
          <Show when={!action() && detail()}>
            <div class="vp-state-detail">{detail()}</div>
          </Show>
        </div>
      </div>

      <div class="vp-buttons">
        <Show when={!installed() && state() !== 'checking'}>
          <button type="button" class="pref-btn pref-btn-primary" onClick={handleInstall} disabled={busy()}>
            {t('virtualPrinter.installButton')}
          </button>
        </Show>
        <Show when={state() === 'dialog'}>
          <button type="button" class="pref-btn pref-btn-primary" onClick={handleEnableCatch} disabled={busy()}>
            {t('virtualPrinter.enableCatch')}
          </button>
        </Show>
        <button type="button" class="pref-btn" onClick={() => openPrintQueueWindow()} title={t('virtualPrinter.openWindowTip')}>
          {t('virtualPrinter.openWindow')}
        </button>
        <Show when={installed()}>
          <button type="button" class="pref-btn pref-btn-secondary" onClick={handleRemove} disabled={busy()}>
            {t('virtualPrinter.removeButton')}
          </button>
        </Show>
      </div>

      <div class="vp-how">
        <div class="vp-how-title">{t('virtualPrinter.howTitle')}</div>
        <ol class="vp-how-steps">
          <li>{t('virtualPrinter.how1', { printer: PRINTER_NAME })}</li>
          <li>{t('virtualPrinter.how2')}</li>
          <li>{t('virtualPrinter.how3')}</li>
        </ol>
      </div>

      <p class="vp-note">{t('virtualPrinter.installNote')}</p>
    </fieldset>
  );
}
