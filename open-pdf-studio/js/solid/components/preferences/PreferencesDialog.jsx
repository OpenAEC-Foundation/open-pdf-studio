import { createSignal, Switch, Match, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { DEFAULT_PREFERENCES } from '../../../core/constants.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { savePreferences, applyTheme } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { isMobile, isTauri, getUsername } from '../../../core/platform.js';

import GeneralTab from './GeneralTab.jsx';
import AnnotationsTab from './AnnotationsTab.jsx';
import BehaviorTab from './BehaviorTab.jsx';
import PageDisplayTab from './PageDisplayTab.jsx';
import FileAssocTab from './FileAssocTab.jsx';
import VirtualPrinterTab from './VirtualPrinterTab.jsx';

const DESKTOP_ONLY_TABS = ['fileassoc', 'vprinter'];

const TAB_IDS = [
  { id: 'general', key: 'tabs.general' },
  { id: 'annotations', key: 'tabs.annotations' },
  { id: 'behavior', key: 'tabs.behavior' },
  { id: 'pageDisplay', key: 'tabs.pageDisplay' },
  { id: 'fileassoc', key: 'tabs.fileAssociation' },
  { id: 'vprinter', key: 'tabs.virtualPrinter' },
];

const TAB_ICONS = {
  general: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 1v4m0 14v4M4.2 4.2l2.8 2.8m10-2.8 2.8 2.8M1 12h4m14 0h4M4.2 19.8l2.8-2.8m10 2.8 2.8-2.8"/>
    </svg>
  ),
  annotations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  behavior: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-3m0-4V3"/><circle cx="4" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="10" r="2" fill="currentColor"/><circle cx="20" cy="16" r="2" fill="currentColor"/>
    </svg>
  ),
  fileassoc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
    </svg>
  ),
  pageDisplay: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="1"/><path d="M7 8h10M7 12h10M7 16h10"/>
    </svg>
  ),
  vprinter: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
    </svg>
  ),
};

function createPrefSignals(source) {
  const signals = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    const val = source[key] !== undefined ? source[key] : DEFAULT_PREFERENCES[key];
    signals[key] = createSignal(val);
  }
  return signals;
}

export default function PreferencesDialog(props) {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const initialTab = props.data?.tab || 'general';
  const [activeTab, setActiveTab] = createSignal(initialTab);

  const prefs = createPrefSignals(state.preferences);

  function close() {
    closeDialog('preferences');
  }

  function handleSave() {
    const prevThinLines = state.preferences.thinLines;
    for (const key of Object.keys(DEFAULT_PREFERENCES)) {
      state.preferences[key] = prefs[key][0]();
    }
    savePreferences();
    applyTheme(state.preferences.theme);
    // AI-koppeling aan/uit of naar een andere poort.
    import('../../../core/mcp-koppeling.js').then(m => m.pasMcpInstellingToe());
    // Apply properties panel visibility change
    import('../../stores/propertiesStore.js').then(m => m.setPanelVisible(state.preferences.propertiesPanelVisible));
    // Apply tool palette visibility change
    import('../ToolPalette.jsx').then(m => m.initToolPalette());
    // Re-render pages when thin lines setting changed
    if (state.preferences.thinLines !== prevThinLines && getActiveDocument()?.pdfDoc) {
      if (getActiveDocument()?.viewMode === 'continuous') {
        import('../../../pdf/renderer.js').then(m => m.renderContinuous());
      } else {
        import('../../../pdf/renderer.js').then(m => m.renderPage(getActiveDocument()?.currentPage || 1));
      }
    }
    close();
  }

  async function handleReset() {
    let confirmed = false;
    if (isTauri() && window.__TAURI__?.dialog) {
      confirmed = await window.__TAURI__.dialog.ask(t('resetConfirm'), { title: t('resetToDefaults'), kind: 'warning' });
    } else {
      confirmed = confirm(t('resetConfirm'));
    }
    if (confirmed) {
      for (const key of Object.keys(DEFAULT_PREFERENCES)) {
        prefs[key][1](DEFAULT_PREFERENCES[key]);
      }
      // Resolve OS username for authorName since default is empty
      try {
        const username = isTauri() ? await getUsername() : 'User';
        prefs.authorName[1](username);
      } catch (e) {
        prefs.authorName[1]('User');
      }
    }
  }

  const footer = (
    <>
      <button class="pref-btn pref-btn-secondary" onClick={handleReset}>{t('resetToDefaults')}</button>
      <div class="pref-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
        <button class="pref-btn pref-btn-primary" onClick={handleSave}>{tCommon('save')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('title')}
      overlayClass="preferences-overlay"
      dialogClass="preferences-dialog"
      headerClass="preferences-header"
      bodyClass="preferences-body-wrapper"
      footerClass="preferences-footer"
      onClose={close}
      footer={footer}
    >
      <div class="preferences-content">
        <div class="pref-tabs">
          <For each={isMobile() ? TAB_IDS.filter(t => !DESKTOP_ONLY_TABS.includes(t.id)) : TAB_IDS}>
            {(tab) => (
              <button
                class="pref-tab"
                classList={{ active: activeTab() === tab.id }}
                onClick={() => setActiveTab(tab.id)}
              >
                <span class="pref-tab-icon">{TAB_ICONS[tab.id]}</span>
                {t(tab.key)}
              </button>
            )}
          </For>
        </div>

        <div class="pref-tab-content active">
          <Switch>
            <Match when={activeTab() === 'general'}>
              <GeneralTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'annotations'}>
              <AnnotationsTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'behavior'}>
              <BehaviorTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'pageDisplay'}>
              <PageDisplayTab prefs={prefs} />
            </Match>
            <Match when={activeTab() === 'fileassoc'}>
              <FileAssocTab />
            </Match>
            <Match when={activeTab() === 'vprinter'}>
              <VirtualPrinterTab />
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  );
}
