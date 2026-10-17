// STANDALONE "Open PDF Printer" window — its OWN Tauri window beside Open PDF
// Studio (rendered when main.js sees ?view=printqueue), NOT an in-app dialog.
//
// Catches PDFs printed to "Open PDF Printer" from ANY program. Layout:
//   toolbar  — Open in Studio, Merge selected…, Save as…, Delete, Move up/down,
//              Add PDF…, Select all
//   list     — one row per job: page-1 thumbnail, name, pages, paper size of
//              page 1, file size, time; Explorer-style selection (click,
//              Ctrl/Shift+click, arrows, Ctrl+A), drag or Alt+Up/Down to reorder
//   preview  — the focused job page by page
//   status   — counts and progress/result of the last action
// The window polls the spool so new prints appear live. Names, paper sizes
// and the selection rules live in stores/print-queue-model.js.
import { createSignal, createEffect, createMemo, For, Show, on, onMount, onCleanup, batch } from 'solid-js';
import {
  printQueueJobs as queueJobs, refreshPrintQueue, deletePrintJob, readPrinterState, requestPrinterSettings,
} from '../stores/printQueueStore.js';
import {
  PRINTER_NAME, jobDisplayName, saveFileName, paperInfo, paperText, formatFileSize, syncOrder, moveSelected,
  moveBefore, emptySelection, clickSelection, keySelection, selectAll, syncSelection, selectionAfterRemoval,
  selectedInOrder, selectionSummary, clampPage,
} from '../stores/print-queue-model.js';
import { isTauri, invoke, readBinaryFile, writeBinaryFile, saveFileDialog } from '../../core/platform.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const POLL_MS = 2500;
const RESULT_MS = 8000;
const THUMB_W = 60;
const THUMB_H = 80;
const PDF_FILTER = [{ name: 'PDF', extensions: ['pdf'] }];

// Lazily load pdf.js + point it at the bundled worker (same as loader.js).
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import('pdfjs-dist');
  try { lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href; } catch (_) {}
  _pdfjs = lib;
  return lib;
}

async function readJobBytes(path) {
  try { await invoke('allow_fs_scope', { path }); } catch (_) {}
  return new Uint8Array(await readBinaryFile(path));
}

const errText = (e) => String(e?.message ?? e);
const baseName = (p) => String(p || '').split(/[\\/]/).pop();

// ── icons (16 px, currentColor) ──────────────────────────────────────────
const Icon = (props) => (
  <svg class="pq-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">
    {props.children}
  </svg>
);
const ICONS = {
  open: () => <Icon><path d="M2.5 4.5h4l1 1h6v7h-11z" /><path d="M8 8.5h4M10.5 7l1.5 1.5L10.5 10" /></Icon>,
  merge: () => <Icon><rect x="2.5" y="2.5" width="6" height="8" /><rect x="7.5" y="5.5" width="6" height="8" /></Icon>,
  save: () => <Icon><path d="M2.5 2.5h9l2 2v9h-11z" /><path d="M5 2.5v3.5h5V2.5M5 13.5v-4h6v4" /></Icon>,
  del: () => <Icon><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9M7 7v4.5M9 7v4.5" /></Icon>,
  up: () => <Icon><path d="M8 13V3.5M4 7.5l4-4 4 4" /></Icon>,
  down: () => <Icon><path d="M8 3v9.5M4 8.5l4 4 4-4" /></Icon>,
  add: () => <Icon><path d="M4.5 1.5h5l3 3v10h-8z" /><path d="M9.5 1.5v3h3M8.5 7.5v5M6 10h5" /></Icon>,
  all: () => <Icon><rect x="2.5" y="2.5" width="11" height="11" /><path d="M5 8l2 2 4-4" /></Icon>,
  prev: () => <Icon><path d="M10 3.5L5.5 8l4.5 4.5" /></Icon>,
  next: () => <Icon><path d="M6 3.5L10.5 8 6 12.5" /></Icon>,
  close: () => <Icon><path d="M4 4l8 8M12 4l-8 8" /></Icon>,
  page: () => <Icon><path d="M4 1.5h5.5l3 3v10H4z" /><path d="M9.5 1.5v3h3" /></Icon>,
  warn: () => <Icon><path d="M8 2l6.5 11.5h-13z" /><path d="M8 6.5v3.5M8 11.5v.8" /></Icon>,
};
const PrinterArt = () => (
  <svg class="pq-empty-art" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M18 24V8h22l6 6v10" /><path d="M40 8v6h6" />
    <rect x="8" y="24" width="48" height="20" />
    <path d="M18 38h28v18H18z" /><path d="M24 44h16M24 50h10" /><circle cx="48" cy="30" r="1.5" fill="currentColor" />
  </svg>
);

export default function PrintQueueWindow() {
  const { t, language } = useTranslation('dialogs');

  const [order, setOrder] = createSignal([]);
  const [sel, setSel] = createSignal(emptySelection());
  const [meta, setMeta] = createSignal({});            // file -> { pages, w, h, title, thumb, failed }
  const [status, setStatus] = createSignal(null);      // { kind: 'busy'|'ok'|'error', text }
  const [confirm, setConfirm] = createSignal(null);    // { files: [...] } while the delete question is open
  const [printer, setPrinter] = createSignal('unknown');
  const [page, setPage] = createSignal(1);
  const [previewPaper, setPreviewPaper] = createSignal('');
  const [previewFailed, setPreviewFailed] = createSignal(false);
  const [dragFiles, setDragFiles] = createSignal(null);
  const [over, setOver] = createSignal(null);          // { file, where: 'before'|'after' }
  const [extHover, setExtHover] = createSignal(false);
  let listRef;
  let stageRef;
  let canvasRef;
  let known = null;                                    // files seen in the previous poll
  let resultTimer = null;

  const busy = () => status()?.kind === 'busy';
  const fmtTime = (ms) => {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString(language(), { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return new Date(ms).toLocaleString(); }
  };

  // ── jobs, order and selection ─────────────────────────────────────────
  const jobByFile = createMemo(() => new Map(queueJobs().map((j) => [j.file, j])));
  const ordered = () => order().map((f) => jobByFile().get(f)).filter(Boolean);
  const selectedFiles = () => selectedInOrder(order(), sel().selected);
  const selectedJobs = () => selectedFiles().map((f) => jobByFile().get(f)).filter(Boolean);
  // Memo: a selection change that keeps the same focus must not reset the preview.
  const focusFile = createMemo(() => sel().focus);
  const focusJob = () => jobByFile().get(focusFile()) || null;
  const pagesOf = (job) => meta()[job.file]?.pages || job.pages || 0;
  const nameOf = (job) => jobDisplayName(job, meta()[job.file]?.title, t('printQueue.printedAt', { time: fmtTime(job.modifiedMs) }));

  createEffect(on(queueJobs, (jobs) => {
    const files = jobs.map((j) => j.file);
    // First load: everything counts as new, so all jobs are selected and the
    // newest is previewed — the window usually opens right after a print.
    const arrivals = known ? files.filter((f) => !known.has(f)) : files;
    known = new Set(files);
    batch(() => {
      const next = syncOrder(order(), files);
      setOrder(next);
      setSel((s) => syncSelection(next, s, arrivals));
    });
    for (const j of jobs) ensureMeta(j);
    for (const f of Object.keys(meta())) if (!known.has(f)) forgetDoc(f);
  }));

  function setSelection(s) {
    setSel(s);
  }
  function onRowClick(file, e) {
    setSelection(clickSelection(order(), sel(), file, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
    listRef?.focus();
  }
  function toggleFile(file) {
    setSelection(clickSelection(order(), sel(), file, { ctrl: true }));
  }
  function doSelectAll() {
    setSelection(selectAll(order(), sel()));
  }
  function move(dir) {
    setOrder(moveSelected(order(), sel().selected, dir));
  }
  const canMove = (dir) => {
    const o = order();
    const s = sel().selected;
    if (!s.size) return false;
    return moveSelected(o, s, dir).some((f, i) => f !== o[i]);
  };

  // ── pdf.js documents: thumbnail, page count, size, title, preview ────
  const docs = new Map();                              // file -> Promise<PDFDocumentProxy>
  function loadDoc(job) {
    if (!docs.has(job.file)) {
      const p = (async () => {
        const lib = await getPdfjs();
        return lib.getDocument({ data: await readJobBytes(job.path) }).promise;
      })();
      docs.set(job.file, p);
      p.catch(() => {});
    }
    return docs.get(job.file);
  }
  function forgetDoc(file) {
    const p = docs.get(file);
    docs.delete(file);
    if (p) p.then((d) => d.destroy()).catch(() => {});
    setMeta((m) => { const n = { ...m }; delete n[file]; return n; });
  }
  async function ensureMeta(job) {
    if (meta()[job.file]) return;
    setMeta((m) => ({ ...m, [job.file]: { loading: true } }));
    try {
      const doc = await loadDoc(job);
      const p1 = await doc.getPage(1);
      const v1 = p1.getViewport({ scale: 1 });
      let title = null;
      try { title = (await doc.getMetadata())?.info?.Title || null; } catch (_) {}
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const scale = Math.min(THUMB_W / v1.width, THUMB_H / v1.height) * dpr;
      const vp = p1.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(vp.width));
      c.height = Math.max(1, Math.ceil(vp.height));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      await p1.render({ canvasContext: ctx, viewport: vp }).promise;
      const info = { pages: doc.numPages, w: v1.width, h: v1.height, title, thumb: c.toDataURL('image/png') };
      if (docs.has(job.file)) setMeta((m) => ({ ...m, [job.file]: info }));
    } catch (_) {
      if (docs.has(job.file)) setMeta((m) => ({ ...m, [job.file]: { failed: true } }));
    }
  }

  // Preview: the focused job, page by page, fitted into the stage.
  createEffect(on(focusFile, () => { setPage(1); setPreviewFailed(false); }));
  let renderSeq = 0;
  let renderTask = null;
  async function renderPreview() {
    const job = focusJob();
    const seq = ++renderSeq;
    if (!job || !canvasRef || !stageRef) return;
    try {
      const doc = await loadDoc(job);
      const n = clampPage(page(), doc.numPages);
      const pg = await doc.getPage(n);
      if (seq !== renderSeq) return;
      const v1 = pg.getViewport({ scale: 1 });
      const boxW = Math.max(40, stageRef.clientWidth - 16);
      const boxH = Math.max(40, stageRef.clientHeight - 16);
      const fit = Math.min(boxW / v1.width, boxH / v1.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = pg.getViewport({ scale: fit * dpr });
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.floor(vp.width));
      off.height = Math.max(1, Math.floor(vp.height));
      const ctx = off.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, off.width, off.height);
      try { renderTask?.cancel(); } catch (_) {}
      renderTask = pg.render({ canvasContext: ctx, viewport: vp });
      await renderTask.promise;
      if (seq !== renderSeq || !canvasRef) return;
      canvasRef.width = off.width;
      canvasRef.height = off.height;
      canvasRef.style.width = `${Math.floor(v1.width * fit)}px`;
      canvasRef.style.height = `${Math.floor(v1.height * fit)}px`;
      canvasRef.getContext('2d').drawImage(off, 0, 0);
      setPreviewFailed(false);
      setPreviewPaper(paperText(paperInfo(v1.width, v1.height), t));
    } catch (e) {
      if (seq !== renderSeq || e?.name === 'RenderingCancelledException') return;
      setPreviewFailed(true);
      setPreviewPaper('');
    }
  }
  createEffect(on([focusFile, page, () => order().length, language], () => { queueMicrotask(renderPreview); }));
  const previewCount = () => { const j = focusJob(); return j ? pagesOf(j) : 0; };
  function goPage(delta) {
    setPage((p) => clampPage(p + delta, previewCount()));
  }

  // ── status line ───────────────────────────────────────────────────────
  function showStatus(kind, text) {
    if (resultTimer) { clearTimeout(resultTimer); resultTimer = null; }
    setStatus({ kind, text });
    if (kind === 'ok') resultTimer = setTimeout(() => setStatus(null), RESULT_MS);
  }
  const fail = (e) => showStatus('error', t('printQueue.failed', { message: errText(e) }));

  // ── actions ───────────────────────────────────────────────────────────
  async function mergeBytes(jobs) {
    const { PDFDocument } = await import('pdf-lib');
    const out = await PDFDocument.create();
    let done = 0;
    for (const job of jobs) {
      showStatus('busy', t('printQueue.merging', { done: done + 1, count: jobs.length }));
      const src = await PDFDocument.load(await readJobBytes(job.path));
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
      done += 1;
    }
    return out.save();
  }

  async function openSelected() {
    const jobs = selectedJobs();
    if (!jobs.length || busy() || !isTauri()) return;
    try {
      let path = jobs[0].path;
      if (jobs.length > 1) {
        const merged = await mergeBytes(jobs);
        path = await invoke('write_temp_pdf', { data: Array.from(merged) });
      }
      showStatus('busy', t('printQueue.opening'));
      await invoke('spawn_window_with_pdf', { pdfPath: path });
      showStatus('ok', t('printQueue.opened'));
    } catch (e) { fail(e); }
  }

  async function saveSelected() {
    const job = selectedJobs()[0];
    if (!job || selectedJobs().length !== 1 || busy() || !isTauri()) return;
    showStatus('busy', t('printQueue.saving'));
    try {
      const dest = await saveFileDialog(saveFileName(nameOf(job).name, t('printQueue.printedAt', { time: '' })), PDF_FILTER);
      if (!dest) { setStatus(null); return; }
      await writeBinaryFile(dest, await readJobBytes(job.path));
      const next = selectionAfterRemoval(order(), [job.file]);
      await deletePrintJob(job.file);
      setSelection(syncSelection(order(), next, []));
      showStatus('ok', t('printQueue.saved', { name: baseName(dest) }));
    } catch (e) { fail(e); }
  }

  async function mergeSelected() {
    const jobs = selectedJobs();
    if (jobs.length < 2 || busy() || !isTauri()) return;
    try {
      const merged = await mergeBytes(jobs);
      showStatus('busy', t('printQueue.saving'));
      const dest = await saveFileDialog(saveFileName(t('printQueue.mergedFileName'), 'merged'), PDF_FILTER);
      if (!dest) { setStatus(null); return; }
      await writeBinaryFile(dest, new Uint8Array(merged));
      const files = jobs.map((j) => j.file);
      const next = selectionAfterRemoval(order(), files);
      for (const f of files) await deletePrintJob(f);
      setSelection(syncSelection(order(), next, []));
      showStatus('ok', t('printQueue.merged', { name: baseName(dest) }));
    } catch (e) { fail(e); }
  }

  function askDelete() {
    const files = selectedFiles();
    if (!files.length || busy() || confirm()) return;
    setConfirm({ files });
  }
  async function confirmDelete() {
    const files = confirm()?.files || [];
    setConfirm(null);
    if (!files.length) return;
    showStatus('busy', t('printQueue.deleting'));
    try {
      const next = selectionAfterRemoval(order(), files);
      for (const f of files) await deletePrintJob(f);
      setSelection(syncSelection(order(), next, []));
      showStatus('ok', t('printQueue.deleted', { count: files.length }));
    } catch (e) { fail(e); }
    listRef?.focus();
  }
  function cancelDelete() {
    setConfirm(null);
    listRef?.focus();
  }

  // Resolve the spool dir: reuse an existing job's folder, else %LOCALAPPDATA%.
  async function spoolDir() {
    const j = queueJobs()[0];
    if (j?.path) { const m = /^(.*)[\\/][^\\/]+$/.exec(j.path); if (m) return m[1]; }
    const P = window.__TAURI__?.path;
    return P.join(await P.localDataDir(), 'OpenPDFPrinter', 'spool');
  }
  // Add/drop external PDFs into the queue, named after the real file
  // (job_<epoch>__<RealName>.pdf, see embeddedFileName).
  async function ingestPaths(paths) {
    const pdfs = (paths || []).filter((p) => typeof p === 'string' && /\.pdf$/i.test(p));
    if (!pdfs.length) return;
    showStatus('busy', t('printQueue.adding'));
    try {
      const dir = await spoolDir();
      const P = window.__TAURI__?.path;
      try { await invoke('allow_fs_scope', { path: dir }); } catch (_) {}
      let i = 0;
      for (const src of pdfs) {
        const bytes = await readJobBytes(src);
        const name = baseName(src).replace(/[\\/:*?"<>|]/g, '_');
        const target = await P.join(dir, `job_${Date.now() + (i++)}__${name}`);
        try { await invoke('allow_fs_scope', { path: target }); } catch (_) {}
        await writeBinaryFile(target, bytes);
      }
      await refreshPrintQueue();
      setStatus(null);
    } catch (e) { fail(e); }
  }
  async function addFile() {
    if (busy()) return;
    try {
      const picked = await window.__TAURI__?.dialog?.open({ multiple: true, filters: PDF_FILTER });
      if (picked) await ingestPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (e) { fail(e); }
  }

  // ── drag to reorder ───────────────────────────────────────────────────
  function onDragStart(file, e) {
    if (!sel().selected.has(file)) setSelection(clickSelection(order(), sel(), file, {}));
    setDragFiles(selectedFiles());
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', file); } catch (_) {}
  }
  function onDragOver(file, e) {
    if (!dragFiles()) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setOver({ file, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' });
  }
  function onDrop(file, e) {
    e.preventDefault();
    const moving = dragFiles();
    const target = over();
    setDragFiles(null);
    setOver(null);
    if (moving && target) setOrder(moveBefore(order(), moving, target.file, target.where));
  }
  function endDrag() { setDragFiles(null); setOver(null); }

  // ── keyboard ──────────────────────────────────────────────────────────
  function onListKey(e) {
    if (confirm()) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); openSelected(); return; }
    if (e.key === ' ' && sel().focus) { e.preventDefault(); toggleFile(sel().focus); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); goPage(e.key === 'PageUp' ? -1 : 1); return; }
    const next = keySelection(order(), sel(), e.key, { shift: e.shiftKey });
    if (next !== sel()) {
      e.preventDefault();
      setSelection(next);
      queueMicrotask(() => listRef?.querySelector('.pq-row-focus')?.scrollIntoView({ block: 'nearest' }));
    }
  }
  function onWindowKey(e) {
    const inField = e.target?.matches?.('input[type="text"], textarea') || e.target?.isContentEditable;
    if (confirm()) {
      if (e.key === 'Escape') { e.preventDefault(); cancelDelete(); }
      return;
    }
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      doSelectAll();
      listRef?.focus();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      askDelete();
    }
  }

  // Re-fit the preview when the window (and so the stage) is resized.
  let resizeFrame = 0;
  const stageObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(renderPreview); })
    : null;
  function setStage(el) {
    stageRef = el;
    if (el) stageObserver?.observe(el);
  }

  // ── lifecycle: poll the spool, accept dropped files ──────────────────
  let timer = null;
  let unlistenDrop = null;
  async function tick() {
    try { await invoke('virtual_printer_collect'); } catch (_) {}
    await refreshPrintQueue();
  }
  onMount(async () => {
    document.addEventListener('keydown', onWindowKey);
    tick();
    timer = setInterval(tick, POLL_MS);
    readPrinterState().then(setPrinter).catch(() => {});
    try {
      const wv = window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.();
      if (wv?.onDragDropEvent) {
        unlistenDrop = await wv.onDragDropEvent((e) => {
          const kind = e?.payload?.type;
          if (kind === 'enter' || kind === 'over') setExtHover(true);
          else if (kind === 'leave' || kind === 'cancel') setExtHover(false);
          else if (kind === 'drop') { setExtHover(false); ingestPaths(e.payload?.paths || []); }
        });
      }
    } catch (_) {}
  });
  onCleanup(() => {
    document.removeEventListener('keydown', onWindowKey);
    stageObserver?.disconnect();
    if (timer) clearInterval(timer);
    if (resultTimer) clearTimeout(resultTimer);
    if (unlistenDrop) { try { unlistenDrop(); } catch (_) {} }
    for (const f of [...docs.keys()]) forgetDoc(f);
  });

  // ── view helpers ──────────────────────────────────────────────────────
  const metaLine = (job) => {
    const m = meta()[job.file] || {};
    const pages = pagesOf(job);
    const parts = [t('printQueue.pages', { count: pages || '?' })];
    const paper = paperText(paperInfo(m.w, m.h), t);
    if (paper) parts.push(paper);
    const size = formatFileSize(job.size, language());
    if (size) parts.push(size);
    return parts.join(' · ');
  };
  const nameTip = (job) => {
    const n = nameOf(job);
    if (n.source === 'file') return t('printQueue.nameFromFile', { name: n.full });
    if (n.source === 'title') return t('printQueue.nameFromTitle', { name: n.full });
    return t('printQueue.nameFromTime');
  };
  const statusSummary = () => {
    const parts = [t('printQueue.statusJobs', { count: order().length })];
    const s = selectionSummary(selectedJobs().map((j) => ({ pages: pagesOf(j) })));
    if (s.count) {
      parts.push(s.pages ? t('printQueue.statusSelectedPages', { count: s.count, pages: s.pages }) : t('printQueue.statusSelected', { count: s.count }));
    }
    return parts.join('   ');
  };
  const confirmText = () => {
    const files = confirm()?.files || [];
    if (files.length === 1) {
      const job = jobByFile().get(files[0]);
      return t('printQueue.confirmDeleteOne', { name: job ? nameOf(job).name : files[0] });
    }
    return t('printQueue.confirmDeleteMany', { count: files.length });
  };

  const ToolButton = (props) => (
    <button type="button" class="pq-tool" title={props.tip} disabled={props.disabled} onClick={props.onClick}>
      {props.icon()}<span>{props.label}</span>
    </button>
  );

  return (
    <div class="pq-window" classList={{ 'pq-extdrop': extHover() }}>
      <div class="pq-toolbar" role="toolbar" aria-label={t('printQueue.toolbarLabel')}>
        <ToolButton icon={ICONS.open} label={t('printQueue.openInStudio')} tip={t('printQueue.openInStudioTip')}
          disabled={busy() || selectedFiles().length === 0} onClick={openSelected} />
        <ToolButton icon={ICONS.merge} label={t('printQueue.mergeSelected')} tip={t('printQueue.mergeSelectedTip')}
          disabled={busy() || selectedFiles().length < 2} onClick={mergeSelected} />
        <ToolButton icon={ICONS.save} label={t('printQueue.saveAs')} tip={t('printQueue.saveAsTip')}
          disabled={busy() || selectedFiles().length !== 1} onClick={saveSelected} />
        <span class="pq-sep" />
        <ToolButton icon={ICONS.del} label={t('printQueue.delete')} tip={t('printQueue.deleteTip')}
          disabled={busy() || selectedFiles().length === 0} onClick={askDelete} />
        <span class="pq-sep" />
        <button type="button" class="pq-tool pq-tool-icon" title={t('printQueue.moveUpTip')} aria-label={t('printQueue.moveUp')}
          disabled={busy() || !canMove(-1)} onClick={() => move(-1)}>{ICONS.up()}</button>
        <button type="button" class="pq-tool pq-tool-icon" title={t('printQueue.moveDownTip')} aria-label={t('printQueue.moveDown')}
          disabled={busy() || !canMove(1)} onClick={() => move(1)}>{ICONS.down()}</button>
        <span class="pq-sep" />
        <ToolButton icon={ICONS.add} label={t('printQueue.addFile')} tip={t('printQueue.addFileTip')} disabled={busy()} onClick={addFile} />
        <div class="pq-toolbar-spacer" />
        <ToolButton icon={ICONS.all} label={t('printQueue.selectAll')} tip={t('printQueue.selectAllTip')}
          disabled={order().length === 0} onClick={doSelectAll} />
      </div>

      <div class="pq-main">
        <Show when={order().length > 0} fallback={
          <div class="pq-empty">
            <PrinterArt />
            <h1 class="pq-empty-title">{t('printQueue.emptyTitle')}</h1>
            <p class="pq-empty-intro">{t('printQueue.emptyIntro', { printer: PRINTER_NAME })}</p>
            <Show when={printer() === 'missing' || printer() === 'dialog'}>
              <div class="pq-notice" role="alert">
                {ICONS.warn()}
                <span>{printer() === 'missing'
                  ? t('printQueue.notInstalled', { printer: PRINTER_NAME })
                  : t('printQueue.saveDialogMode', { printer: PRINTER_NAME })}</span>
                <button type="button" class="pq-btn" onClick={requestPrinterSettings}>{t('printQueue.openSettings')}</button>
              </div>
            </Show>
            <ol class="pq-steps">
              <li>{t('printQueue.emptyStep1')}</li>
              <li>{t('printQueue.emptyStep2', { printer: PRINTER_NAME })}</li>
              <li>{t('printQueue.emptyStep3')}</li>
            </ol>
            <p class="pq-empty-drop">{t('printQueue.emptyDrop')}</p>
            <button type="button" class="pq-btn" onClick={addFile} disabled={busy()}>{t('printQueue.addFile')}</button>
          </div>
        }>
          <div class="pq-list" ref={listRef} tabIndex={0} role="listbox" aria-multiselectable="true"
            aria-label={t('printQueue.listLabel')} onKeyDown={onListKey}>
            <For each={ordered()}>
              {(job, index) => {
                const isSel = () => sel().selected.has(job.file);
                return (
                  <div
                    class="pq-row"
                    classList={{
                      'pq-row-sel': isSel(),
                      'pq-row-focus': sel().focus === job.file,
                      'pq-row-drag': !!dragFiles()?.includes(job.file),
                      'pq-drop-before': over()?.file === job.file && over()?.where === 'before',
                      'pq-drop-after': over()?.file === job.file && over()?.where === 'after',
                    }}
                    role="option"
                    aria-selected={isSel()}
                    title={t('printQueue.dragToReorder')}
                    draggable={true}
                    onClick={(e) => onRowClick(job.file, e)}
                    onDblClick={() => { setSelection(clickSelection(order(), sel(), job.file, {})); openSelected(); }}
                    onDragStart={(e) => onDragStart(job.file, e)}
                    onDragOver={(e) => onDragOver(job.file, e)}
                    onDrop={(e) => onDrop(job.file, e)}
                    onDragEnd={endDrag}
                  >
                    <span class="pq-pos">{index() + 1}</span>
                    <input type="checkbox" class="pq-check" tabIndex={-1} checked={isSel()}
                      aria-label={t('printQueue.selectJob')} title={t('printQueue.selectJob')}
                      onClick={(e) => { e.stopPropagation(); toggleFile(job.file); listRef?.focus(); }} />
                    <div class="pq-thumb">
                      <Show when={meta()[job.file]?.thumb} fallback={<span class="pq-thumb-ph">{ICONS.page()}</span>}>
                        <img src={meta()[job.file].thumb} alt="" draggable={false} />
                      </Show>
                    </div>
                    <div class="pq-info">
                      <div class="pq-name" classList={{ 'pq-name-time': nameOf(job).source === 'time' }} title={nameTip(job)}>{nameOf(job).name}</div>
                      <div class="pq-meta">{metaLine(job)}</div>
                      <div class="pq-meta pq-time">{fmtTime(job.modifiedMs)}</div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          <aside class="pq-preview" aria-label={t('printQueue.preview')}>
            <div class="pq-preview-head">
              <span class="pq-preview-label">{t('printQueue.preview')}</span>
              <span class="pq-preview-name">{focusJob() ? nameOf(focusJob()).name : ''}</span>
            </div>
            <div class="pq-stage" ref={setStage}>
              <Show when={focusJob() && !previewFailed()} fallback={
                <div class="pq-stage-note">{focusJob() ? t('printQueue.previewFailed') : t('printQueue.previewNone')}</div>
              }>
                <canvas ref={canvasRef} class="pq-canvas" />
              </Show>
            </div>
            <div class="pq-pager">
              <button type="button" class="pq-tool pq-tool-icon" title={t('printQueue.previousPage')} aria-label={t('printQueue.previousPage')}
                disabled={!focusJob() || page() <= 1} onClick={() => goPage(-1)}>{ICONS.prev()}</button>
              <span class="pq-pager-text">{focusJob() ? t('printQueue.pageOf', { page: clampPage(page(), previewCount()), count: previewCount() || '?' }) : ''}</span>
              <button type="button" class="pq-tool pq-tool-icon" title={t('printQueue.nextPage')} aria-label={t('printQueue.nextPage')}
                disabled={!focusJob() || page() >= previewCount()} onClick={() => goPage(1)}>{ICONS.next()}</button>
              <span class="pq-pager-paper">{focusJob() ? previewPaper() : ''}</span>
            </div>
          </aside>
        </Show>
        <Show when={extHover()}>
          <div class="pq-drop-overlay">{t('printQueue.dropToAdd')}</div>
        </Show>
      </div>

      <div class="pq-statusbar">
        <span class="pq-status-summary" title={t('printQueue.keyboardHint')}>{statusSummary()}</span>
        <span class="pq-status-msg" classList={{ 'pq-status-busy': busy(), 'pq-status-error': status()?.kind === 'error' }}
          role="status" aria-live="polite">{status()?.text || ''}</span>
      </div>

      <Show when={confirm()}>
        <ConfirmDelete
          title={t('printQueue.confirmDeleteTitle')}
          text={confirmText()}
          okLabel={t('printQueue.confirmDelete')}
          cancelLabel={t('printQueue.cancel')}
          closeLabel={t('printQueue.close')}
          closeIcon={ICONS.close}
          onOk={confirmDelete}
          onCancel={cancelDelete}
        />
      </Show>
    </div>
  );
}

// Windows-style modal question: movable by its title bar, stays open when
// the user clicks beside it, Escape/Cancel/× close it.
function ConfirmDelete(props) {
  const [pos, setPos] = createSignal(null);            // { x, y } after a drag
  let boxRef;
  let okRef;
  onMount(() => okRef?.focus());
  function startDrag(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = boxRef.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const moveTo = (ev) => {
      const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - r.width);
      const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 30);
      setPos({ x, y });
    };
    const stop = () => { window.removeEventListener('mousemove', moveTo); window.removeEventListener('mouseup', stop); };
    window.addEventListener('mousemove', moveTo);
    window.addEventListener('mouseup', stop);
    e.preventDefault();
  }
  return (
    <div class="pq-modal-backdrop">
      <div class="pq-modal" ref={boxRef} role="alertdialog" aria-modal="true" aria-label={props.title}
        style={pos() ? { position: 'fixed', left: `${pos().x}px`, top: `${pos().y}px`, margin: '0' } : undefined}>
        <div class="pq-modal-title" onMouseDown={startDrag}>
          <span>{props.title}</span>
          <button type="button" class="pq-modal-close" title={props.closeLabel} aria-label={props.closeLabel} onClick={props.onCancel}>{props.closeIcon()}</button>
        </div>
        <div class="pq-modal-body">{props.text}</div>
        <div class="pq-modal-foot">
          <button type="button" class="pq-btn pq-btn-danger" ref={okRef} onClick={props.onOk}>{props.okLabel}</button>
          <button type="button" class="pq-btn" onClick={props.onCancel}>{props.cancelLabel}</button>
        </div>
      </div>
    </div>
  );
}
