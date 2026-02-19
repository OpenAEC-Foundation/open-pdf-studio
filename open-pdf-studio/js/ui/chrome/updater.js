/**
 * Auto-Update Module
 * Uses Tauri Plugin Updater to check for and install updates.
 */

import { isTauri } from '../../core/platform.js';
import { check } from '@tauri-apps/plugin-updater';
import { openDialog } from '../../solid/stores/dialogStore.js';

/**
 * Check for updates using the Tauri updater plugin.
 * @param {boolean} silent - If true, don't show "no update" or error messages
 */
export async function checkForUpdates(silent = true) {
  if (!isTauri()) return;

  try {
    const update = await check();

    if (update) {
      const skipVersion = localStorage.getItem('openpdfstudio-skip-version');
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
