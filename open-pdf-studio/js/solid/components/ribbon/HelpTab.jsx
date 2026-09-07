import { Show } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import { aboutIcon, shortcutsIcon, updatesIcon, fileAssocIcon, extensionsIcon, pairAgentIcon } from '../../data/ribbonIcons.js';
import { showPreferencesDialog } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';
import { session } from '../../stores/sessionStore.js';

export default function HelpTab() {
  const { t } = useTranslation('ribbon');

  const revealStartupDiagnostics = async () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    const path = await invoke('startup_diagnostics_path');
    await invoke('reveal_in_file_manager', { path });
  };

  return (
    <div class="ribbon-content active" id="tab-help">
      <AdaptiveGroups>
        <RibbonGroup label={t('help.settings')}>
          <RibbonButton
            id="ribbon-extensions"
            title={t('help.extensionsTitle')}
            icon={extensionsIcon}
            label={t('help.extensions')}
            onClick={() => openDialog('extensions')}
          />
          <RibbonButton
            id="ribbon-file-assoc"
            title={t('help.setDefaultPdf')}
            icon={fileAssocIcon}
            label={t('help.fileAssociations')}
            onClick={() => showPreferencesDialog('fileassoc')}
          />
          {/* Shared session only: the desktop build and an ordinary browser
              tab have no relay, so the button is absent there. */}
          <Show when={session()}>
            <RibbonButton
              id="ribbon-pair-agent"
              title="Give an agent the code for this shared session"
              icon={pairAgentIcon}
              label="Pair agent"
              onClick={() => openDialog('pair-agent')}
            />
          </Show>
        </RibbonGroup>

        <RibbonGroup label={t('help.help')}>
          <RibbonButton
            id="ribbon-shortcuts"
            title={t('help.keyboardShortcutsTitle')}
            icon={shortcutsIcon}
            label={t('help.shortcuts')}
            onClick={() => openDialog('shortcuts')}
          />
          <RibbonButton
            id="ribbon-about"
            title={t('help.aboutTitle')}
            icon={aboutIcon}
            label={t('help.about')}
            onClick={() => openDialog('about')}
          />
          <RibbonButton
            id="ribbon-whats-new"
            title={t('help.whatsNewTitle')}
            icon={aboutIcon}
            label={t('help.whatsNew')}
            onClick={() => import('../../../help/whats-new-trigger.js').then(m => m.openWhatsNewManual())}
          />
          <RibbonButton
            id="ribbon-check-updates"
            title={t('help.checkForUpdates')}
            icon={updatesIcon}
            label={t('help.updatesLabel')}
            onClick={() => import('../../../ui/chrome/updater.js').then(m => m.checkForUpdates(false))}
          />
          <RibbonButton
            id="ribbon-startup-diagnostics"
            title={t('help.startupDiagnosticsTitle')}
            icon={updatesIcon}
            label={t('help.startupDiagnostics')}
            onClick={revealStartupDiagnostics}
          />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
