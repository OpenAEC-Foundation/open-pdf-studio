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
import { updateRoute } from './update-route.js';

let checking = false;

/**
 * Check for updates with the Tauri updater plugin. Managed mode and a portable
 * copy only show a message (see updateRoute in update-route.js).
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
    // A Flatpak gets its updates from Flathub; the backend does not register
    // the updater plugin there.
    if (await updatesManagedExternally()) {
      if (!silent) showManagedExternallyMessage();
      return;
    }

    const draagbaar = await isDraagbaar();
    const route = updateRoute({ draagbaar });
    const update = await check();

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

async function updatesManagedExternally() {
  try {
    return (await invoke('updates_managed_externally')) === true;
  } catch {
    return false; // older backend without the command
  }
}

function showManagedExternallyMessage() {
  if (window.__TAURI__?.dialog?.message) {
    window.__TAURI__.dialog.message(
      'This copy of Open PDF Studio is installed as a Flatpak. Updates are installed through your software center or with "flatpak update".',
      { title: 'Software Update', kind: 'info' }
    );
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
