import { createSignal, onMount } from 'solid-js';

export default function VirtualPrinterTab() {
  const [status, setStatus] = createSignal('Checking...');
  const [statusColor, setStatusColor] = createSignal('#666');
  const [showInstall, setShowInstall] = createSignal(false);
  const [showRemove, setShowRemove] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    checkStatus();
  });

  async function checkStatus() {
    setShowInstall(false);
    setShowRemove(false);
    try {
      const { invoke } = await import('../../../core/platform.js');
      const installed = await invoke('is_virtual_printer_installed');
      if (installed) {
        setStatus('Installed');
        setStatusColor('#2e7d32');
        setShowRemove(true);
      } else {
        setStatus('Not installed');
        setStatusColor('#666');
        setShowInstall(true);
      }
    } catch {
      setStatus('Unable to detect');
      setStatusColor('#888');
      setShowInstall(true);
    }
  }

  async function handleInstall() {
    setStatus('Installing...');
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      await invoke('install_virtual_printer');
      setStatus('Installed');
      setStatusColor('#2e7d32');
      setShowInstall(false);
      setShowRemove(true);
    } catch (err) {
      setStatus('Installation failed');
      setStatusColor('#c62828');
      alert('Failed to install virtual printer:\n' + (err.message || err));
    }
    setBusy(false);
  }

  async function handleRemove() {
    setStatus('Removing...');
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      await invoke('remove_virtual_printer');
      setStatus('Not installed');
      setStatusColor('#666');
      setShowRemove(false);
      setShowInstall(true);
    } catch (err) {
      setStatus('Removal failed');
      setStatusColor('#c62828');
      alert('Failed to remove virtual printer:\n' + (err.message || err));
    }
    setBusy(false);
  }

  return (
    <div class="preferences-section">
      <h3>Virtual Printer</h3>
      <p style="font-size:11px;color:#555;margin-bottom:12px;line-height:1.4;">
        Install "Open PDF Studio" as a Windows printer. When you print from any application (Word, Chrome, Notepad, etc.) and select this printer, the output PDF will open automatically in this app.
      </p>
      <div class="pref-row">
        <label>Status:</label>
        <span style={{ 'font-size': '11px', color: statusColor() }}>{status()}</span>
      </div>
      <div class="pref-row" style="margin-top:12px;">
        {showInstall() && (
          <button type="button" class="pref-btn pref-btn-primary" style="width:100%;" onClick={handleInstall} disabled={busy()}>
            Install Virtual Printer
          </button>
        )}
        {showRemove() && (
          <button type="button" class="pref-btn pref-btn-secondary" style="width:100%;" onClick={handleRemove} disabled={busy()}>
            Remove Virtual Printer
          </button>
        )}
      </div>
      <p style="font-size:10px;color:#888;margin-top:12px;line-height:1.4;">
        Installation requires administrator privileges (UAC prompt). The printer uses the built-in "Microsoft Print to PDF" driver.
      </p>
    </div>
  );
}
