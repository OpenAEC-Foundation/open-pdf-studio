/**
 * Auto-Update Module
 * Uses Tauri Plugin Updater to check for and install updates.
 */

import { isTauri } from '../../core/platform.js';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

let updateDialogDrag = { active: false, offsetX: 0, offsetY: 0 };

/**
 * Initialize the update dialog event handlers.
 */
export function initUpdater() {
  const overlay = document.getElementById('update-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.update-dialog');
  const header = overlay.querySelector('.update-header');
  const closeBtn = document.getElementById('update-close-btn');
  const laterBtn = document.getElementById('update-later-btn');
  const skipBtn = document.getElementById('update-skip-btn');
  const installBtn = document.getElementById('update-install-btn');

  // Close button
  closeBtn?.addEventListener('click', () => hideUpdateDialog());
  laterBtn?.addEventListener('click', () => hideUpdateDialog());

  // Skip this version
  skipBtn?.addEventListener('click', () => {
    const newVersion = document.getElementById('update-new-version')?.textContent;
    if (newVersion && newVersion !== '-') {
      localStorage.setItem('openpdfstudio-skip-version', newVersion);
    }
    hideUpdateDialog();
  });

  // Download & Install
  installBtn?.addEventListener('click', () => downloadAndInstall());

  // Make dialog draggable
  if (dialog && header) {
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.update-close-btn')) return;
      updateDialogDrag.active = true;
      const rect = dialog.getBoundingClientRect();
      updateDialogDrag.offsetX = e.clientX - rect.left;
      updateDialogDrag.offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!updateDialogDrag.active) return;
      const overlayRect = overlay.getBoundingClientRect();
      let newX = e.clientX - overlayRect.left - updateDialogDrag.offsetX;
      let newY = e.clientY - overlayRect.top - updateDialogDrag.offsetY;

      const dialogRect = dialog.getBoundingClientRect();
      const maxX = overlayRect.width - dialogRect.width;
      const maxY = overlayRect.height - dialogRect.height;

      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      dialog.style.left = newX + 'px';
      dialog.style.top = newY + 'px';
      dialog.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
      updateDialogDrag.active = false;
    });
  }

  // Wire up the ribbon button
  const ribbonBtn = document.getElementById('ribbon-check-updates');
  ribbonBtn?.addEventListener('click', () => checkForUpdates(false));
}

// Store the pending update so downloadAndInstall can use it
let pendingUpdate = null;

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
      pendingUpdate = update;
      showUpdateDialog(update);
    } else {
      if (!silent) showNoUpdateMessage();
    }
  } catch (e) {
    console.warn('Update check failed:', e);
    if (!silent) showUpdateError(e);
  }
}

function showUpdateDialog(update) {
  const overlay = document.getElementById('update-dialog');
  if (!overlay) return;

  // Set current version
  const currentVersionEl = document.getElementById('update-current-version');
  if (currentVersionEl) {
    currentVersionEl.textContent = update.currentVersion || '-';
  }

  // Set new version
  const newVersionEl = document.getElementById('update-new-version');
  if (newVersionEl) {
    newVersionEl.textContent = update.version || 'Unknown';
  }

  // Set release notes
  const notes = document.getElementById('update-notes');
  if (notes) {
    notes.textContent = update.body || 'No release notes available.';
  }

  // Reset progress
  const progressSection = document.getElementById('update-progress-section');
  if (progressSection) progressSection.style.display = 'none';
  const progressBar = document.getElementById('update-progress-bar');
  if (progressBar) progressBar.style.width = '0%';
  const progressText = document.getElementById('update-progress-text');
  if (progressText) progressText.textContent = 'Downloading... 0%';

  // Enable buttons
  const installBtn = document.getElementById('update-install-btn');
  if (installBtn) {
    installBtn.disabled = false;
    installBtn.textContent = 'Download & Install';
  }
  const skipBtn = document.getElementById('update-skip-btn');
  if (skipBtn) skipBtn.style.display = '';
  const laterBtn = document.getElementById('update-later-btn');
  if (laterBtn) laterBtn.style.display = '';

  // Reset dialog position
  const dialog = overlay.querySelector('.update-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
  }

  overlay.classList.add('visible');
}

function hideUpdateDialog() {
  const overlay = document.getElementById('update-dialog');
  if (overlay) overlay.classList.remove('visible');
}

async function downloadAndInstall() {
  if (!pendingUpdate) return;

  const installBtn = document.getElementById('update-install-btn');
  const skipBtn = document.getElementById('update-skip-btn');
  const laterBtn = document.getElementById('update-later-btn');
  const progressSection = document.getElementById('update-progress-section');
  const progressBar = document.getElementById('update-progress-bar');
  const progressText = document.getElementById('update-progress-text');

  // Disable buttons during download
  if (installBtn) {
    installBtn.disabled = true;
    installBtn.textContent = 'Downloading...';
  }
  if (skipBtn) skipBtn.style.display = 'none';
  if (laterBtn) laterBtn.style.display = 'none';

  // Show progress
  if (progressSection) progressSection.style.display = '';

  let totalBytes = 0;
  let downloadedBytes = 0;

  try {
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        totalBytes = event.data?.contentLength || 0;
        downloadedBytes = 0;
        if (totalBytes > 0) {
          const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
          if (progressText) progressText.textContent = `Downloading... 0% of ${totalMB} MB`;
        }
      } else if (event.event === 'Progress') {
        downloadedBytes += event.data?.chunkLength || 0;
        if (totalBytes > 0) {
          const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          if (progressBar) progressBar.style.width = pct + '%';
          const dlMB = (downloadedBytes / 1024 / 1024).toFixed(1);
          const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
          if (progressText) progressText.textContent = `Downloading... ${pct}% (${dlMB} / ${totalMB} MB)`;
        }
      } else if (event.event === 'Finished') {
        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = 'Download complete. Installing...';
        if (installBtn) installBtn.textContent = 'Installing...';
      }
    });

    // After install, relaunch
    if (progressText) progressText.textContent = 'Restarting application...';
    await relaunch();
  } catch (e) {
    console.error('Update install failed:', e);
    if (progressText) progressText.textContent = 'Update failed: ' + (e.message || e);
    if (installBtn) {
      installBtn.disabled = false;
      installBtn.textContent = 'Retry';
    }
    if (laterBtn) laterBtn.style.display = '';
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
