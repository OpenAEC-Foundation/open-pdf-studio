// Pure logic of the "Open PDF Printer" window (PrintQueueWindow.jsx): the
// name shown for a captured job, the paper size of page 1, the file size, and
// the order/selection rules of the job list. No DOM, no Tauri: unit-tested in
// print-queue-model.test.mjs.

import { PAPIERFORMATEN, paginaFormaat, paginaOrientatie } from '../../pdf/print-pagina-instelling.js';

/** The name of the virtual printer as Windows shows it (a proper name). */
export const PRINTER_NAME = 'Open PDF Printer';

// ── names ────────────────────────────────────────────────────────────────

/**
 * PDFs added to the queue by hand (Add PDF… or a drop from Explorer) are
 * stored as `job_<epoch>__<RealName>.pdf`; this gives `<RealName>.pdf`.
 * Printed jobs are plain `job_<epoch>.pdf` → null.
 */
export function embeddedFileName(file) {
  const m = /^job_\d+__(.+)$/i.exec(typeof file === 'string' ? file : '');
  if (!m) return null;
  return /^\.pdf$/i.test(m[1]) ? null : m[1];
}

// Extensions of documents people print. Only these are stripped from a name,
// so "Report v1.2" or "Notes Q3.final" stay whole.
const DOC_EXT = 'pdf|docx?|docm|xlsx?|xlsm|csv|pptx?|odt|ods|odp|odg|rtf|txt|md|log|xml|json|html?|mht|eml|msg|png|jpe?g|gif|bmp|tiff?|webp|svg|dwg|dxf|ifc|vsdx?|pub|xps|oxps|one';
const EXT_RE = new RegExp(`\\.(?:${DOC_EXT})$`, 'i');
const FILE_RE = `[^\\\\/]*?\\S\\.(?:${DOC_EXT})`;
// "<Program> - <file.ext>" and "<file.ext> - <Program>": a program name is 1-4
// words without digits.
const PROGRAM = '[^\\d\\-–.\\\\/]{1,40}?';
const PREFIX_RE = new RegExp(`^(${PROGRAM})\\s+[-–]\\s+(${FILE_RE})$`, 'i');
const SUFFIX_RE = new RegExp(`^(${FILE_RE})\\s+[-–]\\s+(${PROGRAM})$`, 'i');
const GENERIC = new Set(['untitled', 'untitled document', 'document', 'print document', 'print', '-']);
const MAX_TITLE = 200;

function isProgramName(s) {
  const words = s.trim().split(/\s+/);
  return words.length >= 1 && words.length <= 4;
}

/**
 * The document title as a print driver wrote it (/Info /Title, which carries
 * the print job's document name), made presentable: white space tidied, a
 * path or file URL reduced to its file name, and a program name before or
 * after a file name dropped. null for an empty or generic title.
 */
export function cleanPrintTitle(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^file:\/\//i.test(s)) {
    try { s = decodeURIComponent(s.replace(/^file:\/+/i, '')); } catch (_) { /* keep as is */ }
    s = s.split('/').pop() || s;
  } else if (/^([a-z]:[\\/]|\\\\|\/)/i.test(s)) {
    s = s.split(/[\\/]/).filter(Boolean).pop() || s;
  }
  let m = PREFIX_RE.exec(s);
  if (m && isProgramName(m[1])) s = m[2];
  else if ((m = SUFFIX_RE.exec(s)) && isProgramName(m[2])) s = m[1];
  s = s.trim();
  if (!s || GENERIC.has(s.toLowerCase())) return null;
  return s.length > MAX_TITLE ? s.slice(0, MAX_TITLE) : s;
}

/** "Rapport.docx" → "Rapport"; only known document extensions. */
export function stripFileExtension(name) {
  const s = String(name ?? '');
  const out = s.replace(EXT_RE, '');
  return out ? out : s;
}

/**
 * The name shown for a job.
 *  1. an added PDF: its real file name;
 *  2. a printed job: the document title in the PDF (`job.title` from the job
 *     list, or `pdfTitle` read in the window when the list has none);
 *  3. otherwise `fallback`, the translated "Print <time>".
 * `name` is what the list shows, `full` the unshortened text (tooltip).
 */
export function jobDisplayName(job, pdfTitle, fallback) {
  const file = embeddedFileName(job?.file);
  if (file) return { source: 'file', name: stripFileExtension(file), full: file };
  const rawTitle = cleanPrintTitle(job?.title) ? job.title : (cleanPrintTitle(pdfTitle) ? pdfTitle : null);
  if (rawTitle) {
    return { source: 'title', name: stripFileExtension(cleanPrintTitle(rawTitle)), full: String(rawTitle).trim() };
  }
  return { source: 'time', name: fallback, full: fallback };
}

/** A safe Windows file name ending in .pdf; `fallback` when nothing is left. */
export function saveFileName(name, fallback) {
  const clean = (s) => stripFileExtension(String(s ?? ''))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 150);
  const base = clean(name) || clean(fallback) || 'Print';
  return `${base}.pdf`;
}

// ── paper size ───────────────────────────────────────────────────────────

const PT_TO_MM = 25.4 / 72;
const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Paper of a page as shown (rotation applied), in PDF points: the standard
 * size it matches ("A3", "Letter"; same tolerance as the print dialog) or
 * label null, the orientation, and the size in whole millimetres.
 */
export function paperInfo(wPt, hPt) {
  if (!ok(wPt) || !ok(hPt)) return null;
  const key = paginaFormaat(wPt, hPt);
  const f = PAPIERFORMATEN[key];
  return {
    label: f ? f.label : null,
    orientation: paginaOrientatie(wPt, hPt),
    wMm: Math.round(wPt * PT_TO_MM),
    hMm: Math.round(hPt * PT_TO_MM),
  };
}

/** "A3 landscape" / "A4 portrait" / "353 × 176 mm" via the window's `t`. */
export function paperText(info, t) {
  if (!info) return '';
  if (!info.label) return t('printQueue.paperMm', { w: info.wMm, h: info.hMm });
  return t(info.orientation === 'landscape' ? 'printQueue.paperLandscape' : 'printQueue.paperPortrait', { paper: info.label });
}

/** "45 kB" / "1.3 MB" with the decimal sign of `locale`. */
export function formatFileSize(bytes, locale) {
  if (!ok(bytes)) return '';
  let nf;
  try { nf = new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 1 }); } catch (_) { nf = new Intl.NumberFormat('en', { maximumFractionDigits: 1 }); }
  if (bytes >= 1024 * 1024) return `${nf.format(Math.round(bytes / 1024 / 1024 * 10) / 10)} MB`;
  return `${nf.format(Math.max(1, Math.round(bytes / 1024)))} kB`;
}

// ── order ────────────────────────────────────────────────────────────────

/** The user's order, without jobs that are gone, new jobs appended. */
export function syncOrder(prev, files) {
  const present = new Set(files);
  const kept = prev.filter((f) => present.has(f));
  const known = new Set(kept);
  return [...kept, ...files.filter((f) => !known.has(f))];
}

/** Move every selected job one step up (dir -1) or down (+1); blocks stop at the edge. */
export function moveSelected(order, selected, dir) {
  const out = order.slice();
  if (dir < 0) {
    for (let i = 1; i < out.length; i++) {
      if (selected.has(out[i]) && !selected.has(out[i - 1])) [out[i - 1], out[i]] = [out[i], out[i - 1]];
    }
  } else if (dir > 0) {
    for (let i = out.length - 2; i >= 0; i--) {
      if (selected.has(out[i]) && !selected.has(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
  }
  return out;
}

/** Put `moving` (in their current order) before or after `target`. */
export function moveBefore(order, moving, target, where) {
  const set = new Set(moving.filter((f) => order.includes(f)));
  if (!set.size || set.has(target) || !order.includes(target)) return order;
  const block = order.filter((f) => set.has(f));
  const rest = order.filter((f) => !set.has(f));
  const at = rest.indexOf(target) + (where === 'after' ? 1 : 0);
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

// ── selection ────────────────────────────────────────────────────────────
// { selected: Set<file>, anchor: file|null (start of a Shift range),
//   focus: file|null (the job shown in the preview, keyboard position) }

export function emptySelection() {
  return { selected: new Set(), anchor: null, focus: null };
}

function range(order, a, b) {
  let i = order.indexOf(a);
  let j = order.indexOf(b);
  if (i < 0) i = j;
  if (i > j) [i, j] = [j, i];
  return order.slice(i, j + 1);
}

/** Click on a job: plain = only this one, Ctrl = toggle, Shift = range from the anchor. */
export function clickSelection(order, state, file, { ctrl = false, shift = false } = {}) {
  if (shift) {
    const anchor = state.anchor && order.includes(state.anchor) ? state.anchor : file;
    const span = range(order, anchor, file);
    const selected = ctrl ? new Set([...state.selected, ...span]) : new Set(span);
    return { selected, anchor, focus: file };
  }
  if (ctrl) {
    const selected = new Set(state.selected);
    if (selected.has(file)) selected.delete(file); else selected.add(file);
    return { selected, anchor: file, focus: file };
  }
  return { selected: new Set([file]), anchor: file, focus: file };
}

const KEY_STEP = { ArrowUp: -1, ArrowDown: 1 };

/** Arrow keys and Home/End in the list; Shift extends from the anchor. Other keys: same state. */
export function keySelection(order, state, key, { shift = false } = {}) {
  if (!order.length) return state;
  let target;
  const at = order.indexOf(state.focus);
  if (key in KEY_STEP) target = at < 0 ? 0 : Math.min(order.length - 1, Math.max(0, at + KEY_STEP[key]));
  else if (key === 'Home') target = 0;
  else if (key === 'End') target = order.length - 1;
  else return state;
  return clickSelection(order, state, order[target], { shift });
}

export function selectAll(order, state) {
  const focus = state.focus && order.includes(state.focus) ? state.focus : (order[0] ?? null);
  return { selected: new Set(order), anchor: state.anchor ?? focus, focus };
}

/**
 * After the job list changed: drop gone jobs; `arrivals` (new prints) are
 * added to the selection so they can be merged straight away, and the newest
 * gets the focus (preview). A lost focus falls back to the first job.
 */
export function syncSelection(order, state, arrivals) {
  const present = new Set(order);
  const selected = new Set([...state.selected].filter((f) => present.has(f)));
  const fresh = arrivals.filter((f) => present.has(f));
  for (const f of fresh) selected.add(f);
  if (fresh.length) {
    const last = fresh[fresh.length - 1];
    return { selected, anchor: last, focus: last };
  }
  const focus = present.has(state.focus) ? state.focus : (order[0] ?? null);
  const anchor = present.has(state.anchor) ? state.anchor : focus;
  return { selected, anchor, focus };
}

/** Selection after deleting/saving `removed`: the next job (or the one before) alone. */
export function selectionAfterRemoval(order, removed) {
  const gone = new Set(removed);
  const first = order.findIndex((f) => gone.has(f));
  const rest = order.filter((f) => !gone.has(f));
  if (!rest.length) return emptySelection();
  const next = order.slice(Math.max(0, first)).find((f) => !gone.has(f));
  const focus = next ?? rest[rest.length - 1];
  return { selected: new Set([focus]), anchor: focus, focus };
}

export function selectedInOrder(order, selected) {
  return order.filter((f) => selected.has(f));
}

/** Number of jobs and their total pages (null when a page count is unknown). */
export function selectionSummary(jobs) {
  let pages = 0;
  for (const j of jobs) {
    if (!(j && j.pages > 0)) { pages = null; break; }
    pages += j.pages;
  }
  return { count: jobs.length, pages };
}

/** Preview page within 1..count. */
export function clampPage(n, count) {
  const max = Math.max(1, count | 0);
  if (!Number.isFinite(n)) return 1;
  return Math.min(max, Math.max(1, Math.round(n)));
}
