/**
 * Auto-Update Module
 * Uses Tauri Plugin Updater to check for and install updates.
 */

import { isTauri } from '../../core/platform.js';
import { check } from '@tauri-apps/plugin-updater';
import { openDialog } from '../../bridge.js';
import { leesOpslag } from '../../core/opslag.js';
import { magMelden } from '../../core/beheerd.js';

let checking = false;

/**
 * Check for updates using the Tauri updater plugin.
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
    const update = await check();

    if (update) {
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
