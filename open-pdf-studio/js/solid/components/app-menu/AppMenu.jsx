import { Show, Switch, Match, onMount, onCleanup } from 'solid-js';
import { isAppMenuOpen, closeAppMenu, getActivePanel, setActivePanel } from '../../stores/appMenuStore.js';
import { openDialog } from '../../stores/dialogStore.js';
import ImportPanel from './ImportPanel.jsx';
import ExportPanel from './ExportPanel.jsx';
import OpenPanel from './OpenPanel.jsx';
import { openPDFFile } from '../../../pdf/loader.js';
import { savePDF, savePDFAs } from '../../../pdf/saver.js';
import { showPreferencesDialog } from '../../../core/preferences.js';
import { showDocPropertiesDialog, showNewDocDialog, showPrintDialog } from '../../../ui/chrome/dialogs.js';
import { hasUnsavedChanges, getUnsavedDocumentNames } from '../../../ui/chrome/tabs.js';
import { closeWindow, isTauri } from '../../../core/platform.js';
import { knopUitInBrowser, meldingTekst } from '../../../core/webfuncties.js';
import i18next from '../../../i18n/config.js';
import { persistAllReaderPositions } from '../../../pdf/reader-mode-view.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

function MenuItem(props) {
  // Zelfde regel als bij de lintknoppen: wat de webversie niet kan staat uit
  // en draagt de ene melding (#456). Zie js/core/webfuncties.js.
  const geenWebvariant = () => knopUitInBrowser(props.id, isTauri());
  return (
    <button
      class={`app-menu-item${props.active ? ' active' : ''}`}
      id={props.id}
      title={geenWebvariant() ? meldingTekst(i18next.t.bind(i18next), props.label) : undefined}
      disabled={geenWebvariant()}
      onClick={props.onClick}
    >
      <span class="app-menu-item-icon" innerHTML={props.icon} />
      <span class="app-menu-item-label">{props.label}</span>
      <span class="app-menu-item-shortcut">{props.shortcut || ''}</span>
    </button>
  );
}

function Divider() {
  return <div class="app-menu-divider" />;
}

const ICONS = {
  new: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6m-3 3h6"/></svg>',
  open: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
  save: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z"/><path d="M17 3v4a1 1 0 01-1 1H8"/><path d="M7 14h10v7H7z"/></svg>',
  saveAs: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z"/><path d="M17 3v4a1 1 0 01-1 1H8"/><path d="M12 12v6m-3-3h6"/></svg>',
  print: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  import: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  export: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  docProperties: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8m8 4H8m2-8H8"/></svg>',
  preferences: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  about: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  exit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  extensions: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
  annotateScreenshot: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="3"/></svg>',
};

function actionAndClose(fn) {
  closeAppMenu();
  fn();
}

export default function AppMenu() {
  const { t } = useTranslation('appMenu');
  const { t: tDialogs } = useTranslation('dialogs');

  async function handleExit() {
    closeAppMenu();
    if (hasUnsavedChanges()) {
      const names = getUnsavedDocumentNames().join(', ');
      const message = tDialogs('unsavedChanges.message', { names });
      const title = tDialogs('unsavedChanges.title');
      let result = false;
      if (window.__TAURI__?.dialog?.ask) {
        result = await window.__TAURI__.dialog.ask(
          message,
          { title: title, kind: 'warning' }
        );
      } else {
        result = confirm(message);
      }
      if (!result) return;
    }
    // closeWindow() destroys the window: no close-requested event, so the
    // per-tab close that normally saves the Reader Mode positions never
    // runs. Save them here, for the documents whose tracking is on.
    await persistAllReaderPositions();
    closeWindow();
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && isAppMenuOpen()) {
      closeAppMenu();
    }
  };

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  const handleContentClick = (e) => {
    if (e.target === e.currentTarget) {
      closeAppMenu();
    }
  };

  return (
    <Show when={isAppMenuOpen()}>
      <div class="app-menu-overlay visible">
        <div class="app-menu-sidebar">
          <button class="app-menu-back" onClick={closeAppMenu}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            <span>{t('file')}</span>
          </button>
          <div class="app-menu-items">
            <MenuItem icon={ICONS.new} label={t('new')} shortcut="Ctrl+N" onClick={() => actionAndClose(showNewDocDialog)} />
            <MenuItem icon={ICONS.open} label={t('open')} shortcut="Ctrl+O" active={getActivePanel() === 'open'} onClick={() => setActivePanel('open')} />
            <MenuItem icon={ICONS.save} label={t('save')} shortcut="Ctrl+S" onClick={() => actionAndClose(savePDF)} />
            <MenuItem icon={ICONS.saveAs} label={t('saveAs')} shortcut="Ctrl+Shift+S" onClick={() => actionAndClose(savePDFAs)} />
            <MenuItem id="menu-print" icon={ICONS.print} label={t('print')} shortcut="Ctrl+P" onClick={() => actionAndClose(showPrintDialog)} />
            <Divider />
            <MenuItem icon={ICONS.annotateScreenshot} label={t('annotateScreenshot')} onClick={() => actionAndClose(() => import('../../../tools/screenshot-annotate.js').then((m) => m.annotateClipboardScreenshot()))} />
            <Divider />
            <MenuItem icon={ICONS.import} label={t('import')} active={getActivePanel() === 'import'} onClick={() => setActivePanel('import')} />
            <MenuItem icon={ICONS.export} label={t('export')} active={getActivePanel() === 'export'} onClick={() => setActivePanel('export')} />
            <Divider />
            <MenuItem id="menu-extensions" icon={ICONS.extensions} label={t('extensions')} onClick={() => { closeAppMenu(); openDialog('extensions'); }} />
            <Divider />
            <MenuItem icon={ICONS.docProperties} label={t('docProperties')} shortcut="Ctrl+D" onClick={() => actionAndClose(showDocPropertiesDialog)} />
            <Divider />
            <MenuItem icon={ICONS.preferences} label={t('preferences')} shortcut="Ctrl+," onClick={() => actionAndClose(showPreferencesDialog)} />
            <Divider />
            <MenuItem icon={ICONS.about} label={t('about')} onClick={() => actionAndClose(() => openDialog('about'))} />
            <MenuItem icon={ICONS.about} label={t('whatsNew.title')} onClick={() => actionAndClose(() => import('../../../help/whats-new-trigger.js').then(m => m.openWhatsNewManual()))} />
            <Divider />
            <MenuItem icon={ICONS.exit} label={t('exit')} shortcut="Alt+F4" onClick={handleExit} />
          </div>
        </div>
        <div class="app-menu-content" onClick={handleContentClick}>
          <Switch>
            <Match when={getActivePanel() === 'open'}>
              <OpenPanel />
            </Match>
            <Match when={getActivePanel() === 'import'}>
              <ImportPanel />
            </Match>
            <Match when={getActivePanel() === 'export'}>
              <ExportPanel />
            </Match>
          </Switch>
        </div>
      </div>
    </Show>
  );
}
