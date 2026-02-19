import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { relaunch } from '@tauri-apps/plugin-process';

export default function UpdateDialog(props) {
  const [downloading, setDownloading] = createSignal(false);
  const [progressPct, setProgressPct] = createSignal(0);
  const [progressText, setProgressText] = createSignal('Downloading... 0%');
  const [installBtnText, setInstallBtnText] = createSignal('Download & Install');
  const [installDisabled, setInstallDisabled] = createSignal(false);
  const [showSkip, setShowSkip] = createSignal(true);
  const [showLater, setShowLater] = createSignal(true);

  const update = () => props.data?.update;
  const currentVersion = () => update()?.currentVersion || '-';
  const newVersion = () => update()?.version || 'Unknown';
  const releaseNotes = () => update()?.body || 'No release notes available.';

  const close = () => closeDialog('update');

  function handleSkip() {
    const ver = newVersion();
    if (ver && ver !== '-' && ver !== 'Unknown') {
      localStorage.setItem('openpdfstudio-skip-version', ver);
    }
    close();
  }

  function handleLater() {
    close();
  }

  async function handleInstall() {
    const upd = update();
    if (!upd) return;

    setDownloading(true);
    setInstallDisabled(true);
    setInstallBtnText('Downloading...');
    setShowSkip(false);
    setShowLater(false);
    setProgressPct(0);
    setProgressText('Downloading... 0%');

    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      await upd.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data?.contentLength || 0;
          downloadedBytes = 0;
          if (totalBytes > 0) {
            const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
            setProgressText(`Downloading... 0% of ${totalMB} MB`);
          }
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data?.chunkLength || 0;
          if (totalBytes > 0) {
            const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            setProgressPct(pct);
            const dlMB = (downloadedBytes / 1024 / 1024).toFixed(1);
            const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
            setProgressText(`Downloading... ${pct}% (${dlMB} / ${totalMB} MB)`);
          }
        } else if (event.event === 'Finished') {
          setProgressPct(100);
          setProgressText('Download complete. Installing...');
          setInstallBtnText('Installing...');
        }
      });

      setProgressText('Restarting application...');
      await relaunch();
    } catch (e) {
      console.error('Update install failed:', e);
      setProgressText('Update failed: ' + (e.message || e));
      setInstallDisabled(false);
      setInstallBtnText('Retry');
      setShowLater(true);
    }
  }

  const footer = (
    <div class="update-footer">
      <Show when={showSkip()}>
        <button class="update-btn update-btn-secondary" onClick={handleSkip}>
          Skip This Version
        </button>
      </Show>
      <div class="update-footer-right">
        <Show when={showLater()}>
          <button class="update-btn update-btn-secondary" onClick={handleLater}>
            Remind Me Later
          </button>
        </Show>
        <button
          class="update-btn update-btn-primary"
          disabled={installDisabled()}
          onClick={handleInstall}
        >
          {installBtnText()}
        </button>
      </div>
    </div>
  );

  return (
    <Dialog
      title="Software Update"
      overlayClass="update-overlay"
      dialogClass="update-dialog"
      headerClass="update-header"
      bodyClass="update-body"
      footerClass=""
      onClose={close}
      footer={footer}
    >
      <div class="update-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0078d7" stroke-width="1.5">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </div>
      <div class="update-info">
        <p class="update-message">A new version of Open PDF Studio is available.</p>
        <div class="update-versions">
          <div class="update-version-row">
            <span class="update-version-label">Current version:</span>
            <span class="update-version-value">{currentVersion()}</span>
          </div>
          <div class="update-version-row">
            <span class="update-version-label">New version:</span>
            <span class="update-version-value update-version-new">{newVersion()}</span>
          </div>
        </div>
        <div class="update-notes-section">
          <label class="update-notes-label">Release Notes:</label>
          <div class="update-notes">{releaseNotes()}</div>
        </div>
      </div>
      <Show when={downloading()}>
        <div class="update-progress-section">
          <div class="update-progress-bar-track">
            <div
              class="update-progress-bar-fill"
              style={{ width: progressPct() + '%' }}
            />
          </div>
          <span class="update-progress-text">{progressText()}</span>
        </div>
      </Show>
    </Dialog>
  );
}
