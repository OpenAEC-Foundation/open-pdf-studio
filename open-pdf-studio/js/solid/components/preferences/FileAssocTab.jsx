import { createSignal, onMount } from 'solid-js';
import { openExternal } from '../../../core/platform.js';

export default function FileAssocTab() {
  const [currentApp, setCurrentApp] = createSignal('Checking...');

  onMount(() => {
    checkDefaultPdfApp();
  });

  async function checkDefaultPdfApp() {
    try {
      const os = require('os');
      const platform = os.platform();

      if (platform === 'win32') {
        const { exec } = require('child_process');
        exec('reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice" /v ProgId', (err, stdout) => {
          if (err) { setCurrentApp('Unable to detect'); return; }
          const match = stdout.match(/ProgId\s+REG_SZ\s+(.+)/);
          if (match) {
            let appName = match[1].trim();
            if (appName.includes('AcroExch') || appName.includes('Acrobat')) appName = 'Adobe Acrobat';
            else if (appName.includes('Edge')) appName = 'Microsoft Edge';
            else if (appName.includes('Chrome')) appName = 'Google Chrome';
            else if (appName.includes('Firefox')) appName = 'Mozilla Firefox';
            else if (appName.includes('OpenPDFStudio') || appName.includes('open-pdf-studio')) appName = 'Open PDF Studio';
            else if (appName.includes('SumatraPDF')) appName = 'SumatraPDF';
            setCurrentApp(appName);
          } else {
            setCurrentApp('Not set');
          }
        });
      } else if (platform === 'darwin') {
        setCurrentApp('Check Finder > Get Info');
      } else {
        const { exec } = require('child_process');
        exec('xdg-mime query default application/pdf', (err, stdout) => {
          if (err || !stdout.trim()) { setCurrentApp('Not set'); return; }
          setCurrentApp(stdout.trim().replace('.desktop', ''));
        });
      }
    } catch {
      setCurrentApp('Unable to detect');
    }
  }

  async function handleSetDefault() {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('win')) {
      try {
        await openExternal('ms-settings:defaultapps');
        alert('Windows Settings opened.\n\nTo set Open PDF Studio as default:\n1. Scroll down to "Choose default apps by file type"\n2. Find .pdf\n3. Click and select Open PDF Studio');
      } catch {
        alert('Could not open Windows Settings.\n\nPlease manually open Settings > Apps > Default Apps.');
      }
    } else if (platform.includes('mac')) {
      alert('To set Open PDF Studio as default PDF viewer on macOS:\n\n1. Right-click any PDF file in Finder\n2. Select "Get Info"\n3. Under "Open with", select Open PDF Studio\n4. Click "Change All..."');
    } else {
      alert('To set Open PDF Studio as default PDF viewer on Linux:\n\nRun in terminal:\nxdg-mime default openpdfstudio.desktop application/pdf');
    }
  }

  return (
    <div class="preferences-section">
      <h3>Default PDF Application</h3>
      <div class="pref-row">
        <label>Current default:</label>
        <span style="font-size:11px;color:#666;">{currentApp()}</span>
      </div>
      <div class="pref-row" style="margin-top:12px;">
        <button type="button" class="pref-btn pref-btn-secondary" style="width:100%;" onClick={handleSetDefault}>
          Set Open PDF Studio as Default PDF Viewer
        </button>
      </div>
      <p style="font-size:10px;color:#888;margin-top:12px;line-height:1.4;">
        This will open your system settings where you can select Open PDF Studio as the default application for opening PDF files.
      </p>
    </div>
  );
}
