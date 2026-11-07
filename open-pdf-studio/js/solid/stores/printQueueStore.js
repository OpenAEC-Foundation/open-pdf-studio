// Print-queue for the "Open PDF Printer" virtual printer.
//
// The printer's collection port writes every print job to
// %LOCALAPPDATA%/OpenPDFPrinter/spool/latest.pdf; the Rust side sweeps that
// into unique job_<epoch>.pdf files (virtual_printer_collect) and lists them
// (virtual_printer_jobs). This store polls the sweep while the app runs and
// pops the queue dialog whenever a NEW job arrives — so printing from any
// application opens the STANDALONE catch window (a separate Tauri window,
// not an in-app dialog). At app start it also pops the window for jobs that
// were caught while the app was closed; jobs it already presented in an
// earlier session (print-queue-presented.js) do not pop it again.

import { createSignal } from 'solid-js';
import { isTauri } from '../../core/platform.js';
import { leesOpslag, schrijfOpslag } from '../../core/opslag.js';
import { headlessVensterOpties, toonEnFocus } from '../../core/headless.js';
import {
  readPresented, writePresented, unpresentedJobs, nextPresented, sameSet,
} from './print-queue-presented.js';

const [jobs, setJobs] = createSignal([]);
const [busy, setBusy] = createSignal(false);
export { jobs as printQueueJobs, busy as printQueueBusy };

const POLL_MS = 2500;
let _timer = null;
let _knownFiles = new Set();
let _starting = null;
let _lastSweepOk = false;

/** De opslag van de app (core/opslag.js) in de getItem/setItem-vorm die
 *  print-queue-presented.js verwacht. opslag.js valt zelf terug op geheugen
 *  als localStorage ontbreekt of geblokkeerd is. */
function _storage() {
  return {
    getItem: (sleutel) => leesOpslag(sleutel),
    setItem: (sleutel, waarde) => schrijfOpslag(sleutel, waarde),
  };
}

/** Remember which jobs have been presented, pruned to `list`. */
function _rememberPresented(list, shownNow) {
  const storage = _storage();
  // A failed sweep says nothing about which jobs left the spool: keep the list.
  if (!storage || !_lastSweepOk) return;
  const before = readPresented(storage);
  const next = nextPresented(list, before, shownNow);
  if (!sameSet(before, next)) writePresented(storage, next);
}

/** The window could not be created: present the queue again next start. */
function _forgetPresented() {
  const storage = _storage();
  if (storage) writePresented(storage, []);
}

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
    _lastSweepOk = Array.isArray(list);
    return jobs();
  } catch (_) {
    _lastSweepOk = false;
    return jobs();
  }
}

export async function deletePrintJob(file) {
  try { await _invoke('virtual_printer_delete_job', { file }); } catch (_) {}
  await refreshPrintQueue();
}

/** Open (or focus) the STANDALONE print-queue window — a separate Tauri
 *  window beside the main app, NOT an in-app dialog. Loads the frontend in
 *  print-queue mode (?view=printqueue → main.js renders only PrintQueueWindow).
 *  Resolves true when the window exists or was created, false otherwise. */
export async function openPrintQueueWindow() {
  const wv = window.__TAURI__?.webviewWindow;
  if (!wv?.WebviewWindow) return false;
  const W = wv.WebviewWindow;
  const label = 'print-queue';
  // Reuse an already-open window: just show + focus it.
  try {
    const existing = await W.getByLabel(label);
    if (existing) { try { await toonEnFocus(existing); } catch (_) {} return true; }
  } catch (_) {}
  try {
    // Headless (testinstantie): onzichtbaar en zonder focus aanmaken; de
    // Rust-kant parkeert het venster buiten beeld.
    const win = new W(label, headlessVensterOpties({
      url: 'index.html?view=printqueue',
      title: 'Open PDF Printer',
      width: 920,
      height: 620,
      minWidth: 560,
      minHeight: 400,
      resizable: true,
      decorations: true,
    }));
    win.once('tauri://error', (e) => {
      console.warn('[printqueue] window error:', e);
      _forgetPresented();
    });
    return true;
  } catch (e) {
    console.warn('[printqueue] could not open window:', e);
    return false;
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
    try { await toonEnFocus(current); } catch (_) {}
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
  const shown = hasNew ? await openPrintQueueWindow() : false;
  _rememberPresented(list, shown);
}

/** Start the background watcher (call once at app start). No-ops when the
 *  virtual printer isn't installed; re-checks after the user installs it
 *  via startPrintQueueWatcher() from the preferences tab. Concurrent calls
 *  share one start, so there is never more than one poll timer. */
export function startPrintQueueWatcher() {
  if (!isTauri() || _timer) return Promise.resolve();
  if (!_starting) {
    _starting = _start().finally(() => { _starting = null; });
  }
  return _starting;
}

async function _start() {
  try {
    const installed = await _invoke('is_virtual_printer_installed');
    if (!installed) return;
  } catch (_) {
    return;
  }
  // Jobs caught while the app was closed are presented once; jobs already
  // presented in an earlier session (and still in the spool, e.g. after
  // "Open in Studio") are not. The known set keeps later polls from
  // reopening the window for the same jobs.
  const initial = await refreshPrintQueue();
  _knownFiles = new Set(initial.map(j => j.file));
  _timer = setInterval(() => { _tick(); }, POLL_MS);
  const fresh = unpresentedJobs(initial, readPresented(_storage()));
  const shown = fresh.length > 0 ? await openPrintQueueWindow() : false;
  _rememberPresented(initial, shown);
}

export function stopPrintQueueWatcher() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
