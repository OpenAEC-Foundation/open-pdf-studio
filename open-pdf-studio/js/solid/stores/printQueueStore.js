// Print-queue for the "Open PDF Printer" virtual printer.
//
// The printer's collection port writes every print job to
// %LOCALAPPDATA%/OpenPDFPrinter/spool/latest.pdf; the Rust side sweeps that
// into unique job_<epoch>.pdf files (virtual_printer_collect) and lists them
// (virtual_printer_jobs). This store polls the sweep while the app runs and
// pops the queue dialog whenever a NEW job arrives — so printing from any
// application opens the STANDALONE catch window (a separate Tauri window,
// not an in-app dialog).

import { createSignal } from 'solid-js';
import { isTauri } from '../../core/platform.js';

const [jobs, setJobs] = createSignal([]);
const [busy, setBusy] = createSignal(false);
export { jobs as printQueueJobs, busy as printQueueBusy };

const POLL_MS = 2500;
let _timer = null;
let _knownFiles = new Set();

function _invoke(cmd, args) {
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) return Promise.reject(new Error('desktop only'));
  return inv(cmd, args);
}

/** Sweep the spool and refresh the job list. Returns the fresh jobs. */
export async function refreshPrintQueue() {
  try {
    await _invoke('virtual_printer_collect');
    const list = await _invoke('virtual_printer_jobs');
    setJobs(Array.isArray(list) ? list : []);
    return jobs();
  } catch (_) {
    return jobs();
  }
}

export async function deletePrintJob(file) {
  try { await _invoke('virtual_printer_delete_job', { file }); } catch (_) {}
  await refreshPrintQueue();
}

/** Open (or focus) the STANDALONE print-queue window — a separate Tauri
 *  window beside the main app, NOT an in-app dialog. Loads the frontend in
 *  print-queue mode (?view=printqueue → main.js renders only PrintQueueWindow). */
export async function openPrintQueueWindow() {
  const wv = window.__TAURI__?.webviewWindow;
  if (!wv?.WebviewWindow) return;
  const W = wv.WebviewWindow;
  const label = 'print-queue';
  // Reuse an already-open window: just show + focus it.
  try {
    const existing = await W.getByLabel(label);
    if (existing) { try { await existing.show(); await existing.setFocus(); } catch (_) {} return; }
  } catch (_) {}
  try {
    const win = new W(label, {
      url: 'index.html?view=printqueue',
      title: 'Open PDF Printer',
      width: 920,
      height: 620,
      minWidth: 560,
      minHeight: 400,
      resizable: true,
      decorations: true,
    });
    win.once('tauri://error', (e) => console.warn('[printqueue] window error:', e));
  } catch (e) {
    console.warn('[printqueue] could not open window:', e);
  }
}

/**
 * State of the virtual printer, read-only (no PowerShell, see lib.rs):
 *  'active'  installed, prints are caught silently in the spool;
 *  'dialog'  installed, but every print still shows a Save dialog;
 *  'missing' not installed;  'unknown' could not be read (or not desktop).
 */
export async function readPrinterState() {
  try {
    if (!(await _invoke('is_virtual_printer_installed'))) return 'missing';
  } catch (_) {
    return 'unknown';
  }
  try {
    return (await _invoke('virtual_printer_catch_enabled')) ? 'active' : 'dialog';
  } catch (_) {
    return 'dialog';
  }
}

const SETTINGS_EVENT = 'print-queue:open-settings';

/** From the printer window: ask the main window to show the printer settings. */
export async function requestPrinterSettings() {
  const ev = window.__TAURI__?.event;
  if (!ev) return false;
  try {
    if (ev.emitTo) await ev.emitTo('main', SETTINGS_EVENT);
    else await ev.emit(SETTINGS_EVENT);
    return true;
  } catch (_) {
    return false;
  }
}

/** In the main window: answer requestPrinterSettings() with the Virtual printer tab. */
export async function listenForPrinterSettingsRequests() {
  const ev = window.__TAURI__?.event;
  const current = window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.();
  if (!ev?.listen || (current && current.label !== 'main')) return;
  await ev.listen(SETTINGS_EVENT, async () => {
    try { await current?.show(); await current?.setFocus(); } catch (_) {}
    const { showPreferencesDialog } = await import('../../core/preferences.js');
    showPreferencesDialog('vprinter');
  });
}

async function _tick() {
  const list = await refreshPrintQueue();
  const files = new Set(list.map(j => j.file));
  let hasNew = false;
  for (const f of files) {
    if (!_knownFiles.has(f)) hasNew = true;
  }
  _knownFiles = files;
  // A new captured print opens the standalone catch window (beside the app).
  if (hasNew) {
    openPrintQueueWindow();
  }
}

/** Start the background watcher (call once at app start). No-ops when the
 *  virtual printer isn't installed; re-checks after the user installs it
 *  via startPrintQueueWatcher() from the preferences tab. */
export async function startPrintQueueWatcher() {
  if (!isTauri() || _timer) return;
  try {
    const installed = await _invoke('is_virtual_printer_installed');
    if (!installed) return;
  } catch (_) {
    return;
  }
  // Seed the known set WITHOUT popping the dialog for jobs that were already
  // sitting in the spool from a previous session.
  const initial = await refreshPrintQueue();
  _knownFiles = new Set(initial.map(j => j.file));
  _timer = setInterval(() => { _tick(); }, POLL_MS);
}

export function stopPrintQueueWatcher() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
