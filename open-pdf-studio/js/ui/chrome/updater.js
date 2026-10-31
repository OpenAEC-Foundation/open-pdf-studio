/**
 * Auto-Update Module
 * Uses Tauri Plugin Updater to check for and install updates.
 */

import { invoke, isTauri } from '../../core/platform.js';
import { check } from '@tauri-apps/plugin-updater';
import { openDialog } from '../../bridge.js';
import { leesOpslag } from '../../core/opslag.js';
import { magMelden } from '../../core/beheerd.js';
import { isDraagbaar, RELEASES_URL, zipNaam } from '../../core/draagbaar.js';
import { maakInstallerUpdate, updateRoute } from './installer-update.js';

let checking = false;

/**
 * Is the OpenAEC Installer on this computer (OpenAEC-Blueprint#33)? Only asked on
 * Windows. Rust registers the plugin only where the installer may update this copy
 * (not in managed mode, not portable, not headless); without the plugin the call
 * fails and the app keeps its own updater.
 */
async function installerAanwezig() {
  try {
    return (await invoke('plugin:openaec-update|installer_present')) === true;
  } catch {
    return false;
  }
}

async function platformNaam() {
  try {
    const { platform } = await import('@tauri-apps/plugin-os');
    return platform();
  } catch {
    return '';
  }
}

/** Close every tab, asking to save changes; throws when the user cancels. */
async function sluitAlleTabs() {
  const { state } = await import('../../core/state.js');
  const { closeActiveTab } = await import('./tabs.js');
  while (state.documents.length > 0) {
    if (!(await closeActiveTab())) throw new Error('cancelled');
  }
}

/** The update from the installer's status file, or null (installer-update.js). */
async function checkViaInstaller() {
  const available = await invoke('plugin:openaec-update|check');
  if (!available) return null;
  return maakInstallerUpdate(available, {
    invoke,
    bestaat: (path) => invoke('file_exists', { path }),
    sluitAlleTabs,
    meldSchoonAfsluiten: async () => (await import('../../herstel/haken.js')).meldSchoonAfsluiten(),
    eigenUpdate: () => check(),
    wacht: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
}

/**
 * Check for updates: on Windows with the OpenAEC Installer through the installer,
 * otherwise with the Tauri updater plugin. Managed mode and a portable copy only
 * show a message (see updateRoute in installer-update.js).
 * @param {boolean} silent - If true, don't show "no update" or error messages
 */
export async function checkForUpdates(silent = true) {
  if (!isTauri() || checking) return;
  // Beheerde modus (OPENAEC_BEHEERD=1): de omgeving regelt de versie. Geen
  // controle en geen updatevenster; wie zelf zoekt, krijgt dat te horen.
  if (!(await magMelden('update-controle'))) {
    if (!silent) await showUpdatesManagedMessage();
    return;
  }
  checking = true;

  try {
    const draagbaar = await isDraagbaar();
    const platform = await platformNaam();
    const route = updateRoute({
      draagbaar,
      platform,
      installerAanwezig: !draagbaar && platform === 'windows' && (await installerAanwezig()),
    });
    const update = route === 'installer' ? await checkViaInstaller() : await check();

    if (update && route === 'draagbaar') {
      // Draagbaar (#881): de updater zou een installer starten. Alleen melden
      // dat er een nieuwe zip is en desgewenst de releasepagina openen.
      const skipVersion = leesOpslag('openpdfstudio-skip-version');
      if (silent && skipVersion === update.version) return;
      await showPortableUpdateMessage(update.version);
    } else if (update) {
      const skipVersion = leesOpslag('openpdfstudio-skip-version');
      if (silent && skipVersion === update.version) {
        return;
      }
      openDialog('update', { update });
    } else {
      if (!silent) showNoUpdateMessage();
    }
  } catch (e) {
    console.warn('Update check failed:', e);
    if (!silent) showUpdateError(e);
  } finally {
    checking = false;
  }
}

async function showUpdatesManagedMessage() {
  const i18next = (await import('i18next')).default;
  window.__TAURI__?.dialog?.message?.(
    i18next.t('ribbon:help.updatesManaged'),
    { title: i18next.t('ribbon:help.updatesLabel'), kind: 'info' });
}

async function showPortableUpdateMessage(version) {
  const ask = window.__TAURI__?.dialog?.ask;
  if (!ask) return;
  const i18next = (await import('i18next')).default;
  const open = await ask(
    i18next.t('common:portable.updateAvailable', { version, file: zipNaam(version) }),
    { title: i18next.t('common:portable.updateTitle'), kind: 'info' }
  );
  if (open) {
    const { openExtern } = await import('../../core/extern-openen.js');
    await openExtern(RELEASES_URL);
  }
}

function showNoUpdateMessage() {
  if (window.__TAURI__?.dialog?.message) {
    window.__TAURI__.dialog.message(
      'You are running the latest version of Open PDF Studio.',
      { title: 'Software Update', kind: 'info' }
    );
  }
}

function showUpdateError(error) {
  if (window.__TAURI__?.dialog?.message) {
    window.__TAURI__.dialog.message(
      'Could not check for updates. Please try again later.\n\n' + (error.message || error),
      { title: 'Update Error', kind: 'error' }
    );
  }
}
