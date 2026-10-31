/**
 * Auto-Update Module
 * Uses Tauri Plugin Updater to check for and install updates.
 */

import { isTauri } from '../../core/platform.js';
import { check } from '@tauri-apps/plugin-updater';
import { openDialog } from '../../bridge.js';
import { leesOpslag } from '../../core/opslag.js';
import { isDraagbaar, RELEASES_URL, zipNaam } from '../../core/draagbaar.js';

let checking = false;

/**
 * Check for updates using the Tauri updater plugin.
 * @param {boolean} silent - If true, don't show "no update" or error messages
 */
export async function checkForUpdates(silent = true) {
  if (!isTauri() || checking) return;
  checking = true;

  try {
    const update = await check();

    if (update && await isDraagbaar()) {
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
