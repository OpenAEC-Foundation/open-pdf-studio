/**
 * Auto-Update Module
 * Uses Tauri Plugin Updater to check for and install updates.
 */

import { invoke, isTauri } from '../../core/platform.js';
import { state } from '../../core/state.js';
import { meldSchoonAfsluiten } from '../../herstel/haken.js';
import { closeActiveTab } from './tabs.js';
import { check } from '@tauri-apps/plugin-updater';
import { openDialog } from '../../bridge.js';
import { leesOpslag } from '../../core/opslag.js';

let checking = false;

/**
 * Does the OpenAEC Installer update this app? Only on Windows, and only when the
 * installer is on this computer (OpenAEC-Blueprint#33). Then the version comes from
 * the installer's status file (plugin openaec-update) and the installer installs it:
 * it waits until the app is closed, updates silently in the same kind of setup and
 * starts the app again. Without the installer, and on macOS and Linux, the Tauri
 * updater below stays, because the installer cannot update those (yet).
 */
async function viaInstaller() {
  try {
    const { platform } = await import('@tauri-apps/plugin-os');
    if (platform() !== 'windows') return false;
    return await invoke('plugin:openaec-update|installer_present');
  } catch {
    return false;
  }
}

/**
 * The update from the installer's status file, in the shape UpdateDialog expects.
 * `downloadAndInstall` first closes every tab (asking to save changes), then hands
 * the update to the installer, which closes the app; it never resolves, so the
 * dialog does not relaunch the app itself.
 */
async function checkViaInstaller() {
  const available = await invoke('plugin:openaec-update|check');
  if (!available) return null;
  return {
    version: available.latest,
    currentVersion: available.current,
    // The release notes are not in the status file; "What's new" shows them after the update.
    body: '',
    async downloadAndInstall() {
      while (state.documents.length > 0) {
        if (!(await closeActiveTab())) throw new Error('cancelled');
      }
      await meldSchoonAfsluiten();
      await invoke('plugin:openaec-update|update_now');
      await new Promise(() => {});
    },
  };
}

/**
 * Check for updates using the Tauri updater plugin, or on Windows with the OpenAEC
 * Installer through the installer.
 * @param {boolean} silent - If true, don't show "no update" or error messages
 */
export async function checkForUpdates(silent = true) {
  if (!isTauri() || checking) return;
  checking = true;

  try {
    const update = (await viaInstaller()) ? await checkViaInstaller() : await check();

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
