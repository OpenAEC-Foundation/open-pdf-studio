// STANDALONE "Open PDF Printer" window — its OWN Tauri window beside Open PDF
// Studio (rendered when main.js sees ?view=printqueue), NOT an in-app dialog.
//
// Catches PDFs printed to "Open PDF Printer" from ANY program: lists the
// captured jobs with a page-1 tile preview, lets the user reorder (drag or
// ▲▼), select all, add/drop extra PDFs, open in Studio, save individually, or
// merge a selection into one PDF. Polls the spool so new prints appear live.
import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import { printQueueJobs as queueJobs, refreshPrintQueue, deletePrintJob } from '../stores/printQueueStore.js';
import { isTauri, invoke, readBinaryFile, writeBinaryFile, saveFileDialog } from '../../core/platform.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const POLL_MS = 2500;

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtSize(b) {
  return b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
}

// Display name: added/dropped files are stored as `job_<epoch>__<RealName>.pdf`
// → show the real PDF name. Printed jobs are `job_<epoch>.pdf` (the print port
// discards the source document name) → show a friendly "Afdruk <time>" instead
// of the raw job_<digits> filename.
function displayName(job) {
  const m = /^job_\d+__(.+)$/i.exec(job.file || '');
  if (m) return m[1];
  return 'Afdruk ' + fmtTime(job.modifiedMs);
}

// Lazily load pdf.js + point it at the bundled worker (same as loader.js).
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import('pdfjs-dist');
  try { lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href; } catch (_) {}
  _pdfjs = lib;
  return lib;
}

export default function PrintQueueWindow() {
  const { t } = useTranslation('dialogs');
  const [order, setOrder] = createSignal([]);
  const [checked, setChecked] = createSignal(new Set());
  const [thumbs, setThumbs] = createSignal({});   // file -> dataURL
  const [busyMsg, setBusyMsg] = createSignal('');
  const [dragFile, setDragFile] = createSignal(null);   // row being dragged
  const [overFile, setOverFile] = createSignal(null);   // row dragged over
  const [extHover, setExtHover] = createSignal(false);  // external file hovering
  let seen = new Set();

  // Keep local order/selection in sync as jobs arrive/leave.
  createEffect(() => {
    const files = queueJobs().map(j => j.file);
    setOrder(prev => {
      const kept = prev.filter(f => files.includes(f));
      const added = files.filter(f => !kept.includes(f));
      return [...kept, ...added];
    });
    setChecked(prev => {
      const next = new Set([...prev].filter(f => files.includes(f)));
      for (const f of files) if (!seen.has(f)) next.add(f); // auto-check new arrivals
      seen = new Set(files);
      return next;
    });
  });

  // Render a page-1 tile for any job that doesn't have one yet.
  createEffect(() => { for (const j of ordered()) ensureThumb(j); });
  async function ensureThumb(job) {
    if (thumbs()[job.file]) return;
    try {
      try { await invoke('allow_fs_scope', { path: job.path }); } catch (_) {}
      const bytes = await readBinaryFile(job.path);
      const lib = await getPdfjs();
      const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
      const page = await doc.getPage(1);
      const v0 = page.getViewport({ scale: 1 });
      const scale = Math.min(96 / v0.width, 128 / v0.height) || 0.2;
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(vp.width));
      c.height = Math.max(1, Math.ceil(vp.height));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const url = c.toDataURL('image/png');
      setThumbs(prev => ({ ...prev, [job.file]: url }));
      try { doc.destroy(); } catch (_) {}
    } catch (_) { /* tile is best-effort */ }
  }

  // This window polls the spool itself so new prints show up live.
  let timer = null;
  let unlistenDrop = null;
  async function tick() {
    try { await invoke('virtual_printer_collect'); } catch (_) {}
    await refreshPrintQueue();
  }
  onMount(async () => {
    tick(); timer = setInterval(tick, POLL_MS);
    // External "sleur en pleur": accept PDFs dropped onto the window from Explorer.
    try {
      const wv = window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.();
      if (wv?.onDragDropEvent) {
        unlistenDrop = await wv.onDragDropEvent((e) => {
          const t = e?.payload?.type;
          if (t === 'enter' || t === 'over') setExtHover(true);
          else if (t === 'leave' || t === 'cancel') setExtHover(false);
          else if (t === 'drop') { setExtHover(false); ingestPaths(e.payload?.paths || []); }
        });
      }
    } catch (_) {}
  });
  onCleanup(() => { if (timer) clearInterval(timer); if (unlistenDrop) { try { unlistenDrop(); } catch (_) {} } });

  const jobByFile = (f) => queueJobs().find(j => j.file === f);
  const ordered = () => order().map(jobByFile).filter(Boolean);
  const checkedJobs = () => ordered().filter(j => checked().has(j.file));
  const allChecked = () => { const o = ordered(); return o.length > 0 && o.every(j => checked().has(j.file)); };

  function toggle(f) {
    setChecked(prev => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });
  }
  function toggleAll() {
    const o = ordered();
    setChecked(prev => (o.every(j => prev.has(j.file)) ? new Set() : new Set(o.map(j => j.file))));
  }
  function move(f, dir) {
    setOrder(prev => {
      const i = prev.indexOf(f), j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const n = prev.slice(); [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  }
  // Drag-to-reorder.
  function onDragStart(f, e) { setDragFile(f); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f); } catch (_) {} }
  function onDragOverRow(f, e) { e.preventDefault(); if (dragFile()) setOverFile(f); }
  function onDropRow(f, e) {
    e.preventDefault();
    const src = dragFile(); setDragFile(null); setOverFile(null);
    if (!src || src === f) return;
    setOrder(prev => { const a = prev.slice(); a.splice(a.indexOf(src), 1); a.splice(a.indexOf(f), 0, src); return a; });
  }

  // Resolve the spool dir: reuse an existing job's folder, else %LOCALAPPDATA%.
  async function spoolDir() {
    const j = queueJobs()[0];
    if (j?.path) { const m = /^(.*)[\\/][^\\/]+$/.exec(j.path); if (m) return m[1]; }
    const P = window.__TAURI__?.path;
    const base = await P.localDataDir();
    return P.join(base, 'OpenPDFPrinter', 'spool');
  }
  // Add/drop external PDFs into the queue, named after the real file.
  async function ingestPaths(paths) {
    const pdfs = (paths || []).filter(p => typeof p === 'string' && /\.pdf$/i.test(p));
    if (!pdfs.length) return;
    setBusyMsg(t('printQueue.adding'));
    try {
      const dir = await spoolDir();
      const P = window.__TAURI__?.path;
      try { await invoke('allow_fs_scope', { path: dir }); } catch (_) {}
      let i = 0;
      for (const src of pdfs) {
        try { await invoke('allow_fs_scope', { path: src }); } catch (_) {}
        const bytes = await readBinaryFile(src);
        const baseName = (src.split(/[\\/]/).pop() || 'bestand.pdf').replace(/[\\/:*?"<>|]/g, '_');
        const target = await P.join(dir, `job_${Date.now() + (i++)}__${baseName}`);
        try { await invoke('allow_fs_scope', { path: target }); } catch (_) {}
        await writeBinaryFile(target, new Uint8Array(bytes));
      }
      await refreshPrintQueue();
    } catch (e) { setBusyMsg(String(e?.message ?? e)); return; }
    setBusyMsg('');
  }
  async function addFile() {
    try {
      const sel = await window.__TAURI__?.dialog?.open({ multiple: true, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!sel) return;
      await ingestPaths(Array.isArray(sel) ? sel : [sel]);
    } catch (e) { setBusyMsg(String(e?.message ?? e)); }
  }

  async function openInStudio(job) {
    if (!isTauri()) return;
    try { await invoke('spawn_window_with_pdf', { pdfPath: job.path }); } catch (e) { setBusyMsg(String(e?.message ?? e)); }
  }

  async function saveJob(job) {
    if (!isTauri()) return;
    setBusyMsg(t('printQueue.saving'));
    try {
      const dest = await saveFileDialog(displayName(job), [{ name: 'PDF', extensions: ['pdf'] }]);
      if (!dest) { setBusyMsg(''); return; }
      try { await invoke('allow_fs_scope', { path: job.path }); } catch (_) {}
      const bytes = await readBinaryFile(job.path);
      await writeBinaryFile(dest, new Uint8Array(bytes));
      await deletePrintJob(job.file);
    } catch (e) { setBusyMsg(String(e?.message ?? e)); return; }
    setBusyMsg('');
  }

  async function mergeAndSave() {
    const targets = checkedJobs();
    if (targets.length === 0) return;
    setBusyMsg(t('printQueue.merging'));
    try {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const job of targets) {
        try { await invoke('allow_fs_scope', { path: job.path }); } catch (_) {}
        const bytes = await readBinaryFile(job.path);
        const src = await PDFDocument.load(new Uint8Array(bytes));
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
      }
      const merged = await out.save();
      const dest = await saveFileDialog('Samengevoegd.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
      if (!dest) { setBusyMsg(''); return; }
      await writeBinaryFile(dest, new Uint8Array(merged));
      for (const job of targets) await deletePrintJob(job.file);
    } catch (e) { setBusyMsg(String(e?.message ?? e)); return; }
    setBusyMsg('');
  }

  async function mergeOpen() {
    const targets = checkedJobs();
    if (targets.length === 0) return;
    setBusyMsg(t('printQueue.merging'));
    try {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const job of targets) {
        try { await invoke('allow_fs_scope', { path: job.path }); } catch (_) {}
        const bytes = await readBinaryFile(job.path);
        const src = await PDFDocument.load(new Uint8Array(bytes));
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
      }
      const merged = await out.save();
      const tempPath = await invoke('write_temp_pdf', { data: Array.from(merged) });
      await invoke('spawn_window_with_pdf', { pdfPath: tempPath });
      for (const job of targets) await deletePrintJob(job.file);
    } catch (e) { setBusyMsg(String(e?.message ?? e)); return; }
    setBusyMsg('');
  }

  function closeWindow() {
    try { window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow()?.close(); } catch (_) {}
  }

  return (
    <div class={'pq-window' + (extHover() ? ' pq-extdrop' : '')}>
      <div class="pq-titlebar" data-tauri-drag-region>
        <span class="pq-title">Open PDF Printer</span>
      </div>
      <div class="pq-toolbar">
        <label class="pq-selectall" title={t('printQueue.selectAll')}>
          <input type="checkbox" checked={allChecked()} onChange={toggleAll} />
          {t('printQueue.selectAll')}
        </label>
        <div class="pq-toolbar-spacer" />
        <button class="pref-btn" onClick={addFile}>{t('printQueue.addFile')}</button>
      </div>
      <div class="pq-body">
        <Show when={ordered().length > 0} fallback={
          <div class="pq-empty">
            Nog geen afdrukopdrachten.<br/>
            Print vanuit een programma naar <b>"Open PDF Printer"</b> — of <b>sleep een PDF hierheen</b> — en de opdracht verschijnt hier.
          </div>
        }>
          <div class="pq-list">
            <For each={ordered()}>
              {(job) => (
                <div
                  class={'pq-row' + (overFile() === job.file ? ' pq-row-over' : '') + (dragFile() === job.file ? ' pq-row-drag' : '')}
                  draggable={true}
                  onDragStart={(e) => onDragStart(job.file, e)}
                  onDragOver={(e) => onDragOverRow(job.file, e)}
                  onDragLeave={() => { if (overFile() === job.file) setOverFile(null); }}
                  onDrop={(e) => onDropRow(job.file, e)}
                  onDragEnd={() => { setDragFile(null); setOverFile(null); }}
                >
                  <span class="pq-grip" title={t('printQueue.dragToReorder')}>⠿</span>
                  <input type="checkbox" checked={checked().has(job.file)} onChange={() => toggle(job.file)} />
                  <div class="pq-tile">
                    <Show when={thumbs()[job.file]} fallback={<span class="pq-tile-ph">PDF</span>}>
                      <img src={thumbs()[job.file]} alt="" draggable={false} />
                    </Show>
                  </div>
                  <div class="pq-info">
                    <div class="pq-name">{displayName(job)}</div>
                    <div class="pq-meta">{t('printQueue.pages')}: {job.pages || '?'} · {fmtSize(job.size)} · {fmtTime(job.modifiedMs)}</div>
                  </div>
                  <div class="pq-actions">
                    <button class="pref-btn" title={t('printQueue.moveUp')} onClick={() => move(job.file, -1)}>▲</button>
                    <button class="pref-btn" title={t('printQueue.moveDown')} onClick={() => move(job.file, 1)}>▼</button>
                    <button class="pref-btn" onClick={() => openInStudio(job)}>{t('printQueue.open')}</button>
                    <button class="pref-btn" onClick={() => saveJob(job)}>{t('printQueue.save')}</button>
                    <button class="pref-btn" title={t('printQueue.delete')} onClick={() => deletePrintJob(job.file)}>🗑</button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={extHover()}>
          <div class="pq-drop-overlay">{t('printQueue.dropToAdd')}</div>
        </Show>
      </div>
      <div class="pq-footer">
        <span class="pq-status">{busyMsg()}</span>
        <div class="pq-footer-btns">
          <button class="pref-btn" disabled={checkedJobs().length === 0} onClick={mergeOpen}>
            {t('printQueue.mergeAndOpen')}
          </button>
          <button class="pref-btn pref-btn-primary" disabled={checkedJobs().length === 0} onClick={mergeAndSave}>
            {t('printQueue.mergeAndSave')}{checkedJobs().length > 1 ? ` (${checkedJobs().length})` : ''}
          </button>
          <button class="pref-btn pref-btn-secondary" onClick={closeWindow}>{t('printQueue.close')}</button>
        </div>
      </div>
    </div>
  );
}
