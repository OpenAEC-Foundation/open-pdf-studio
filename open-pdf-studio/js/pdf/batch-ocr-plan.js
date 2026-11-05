// Batch OCR over a folder (#382): the rules, without Tauri or DOM. Which file
// goes where, what is skipped and why, collisions, the summary and the report.
// The run itself is batch-ocr-runner.js; the app wiring batch-ocr.js.
//
// Paths may use '/' or '\'; a result path uses the separator of the folder it
// is built on. Comparisons ignore case when the path looks like a Windows path
// (drive letter or UNC), because that file system does too.

/** Output modes. */
export const OUTPUT_FOLDER = 'folder'; // a copy in the output folder (same subfolders)
export const OUTPUT_BESIDE = 'beside'; // a copy next to the source, name + suffix
export const OUTPUT_REPLACE = 'replace'; // replace the source file (explicit choice)

/** What to do when the output file already exists. */
export const EXISTING_RENAME = 'rename';
export const EXISTING_SKIP = 'skip';
export const EXISTING_OVERWRITE = 'overwrite';

export const DEFAULT_SUFFIX = '_ocr';

/** Why a file is not processed (stable codes: report and translations). */
export const REASON = Object.freeze({
  HAS_TEXT: 'hasText',
  EXISTS: 'exists',
  OPEN: 'openInEditor',
  SAME_AS_SOURCE: 'sameAsSource',
  OWN_OUTPUT: 'ownOutput',
});

const MAX_RENAME = 999;

function isWindowsLike(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

/** The separator a path uses ('\' only when it has no '/'). */
export function separatorOf(p) {
  const s = String(p || '');
  return s.includes('\\') && !s.includes('/') ? '\\' : '/';
}

/** A path for comparisons: '/' separators, no trailing separator, case folded on Windows. */
export function pathKey(p) {
  let s = String(p || '').replace(/\\/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return isWindowsLike(String(p || '')) ? s.toLowerCase() : s;
}

export function samePath(a, b) {
  return pathKey(a) === pathKey(b);
}

/** Folder and file name of a path. */
export function splitPath(p) {
  const s = String(p || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i < 0 ? { dir: '', base: s } : { dir: s.slice(0, i), base: s.slice(i + 1) };
}

/** Join path parts with the separator of the first one. */
export function joinPath(dir, ...parts) {
  const sep = separatorOf(dir);
  let out = String(dir || '').replace(/[\\/]+$/, '');
  for (const part of parts) {
    const clean = String(part || '').replace(/^[\\/]+|[\\/]+$/g, '').replace(/[\\/]+/g, sep);
    if (!clean) continue;
    out = out ? `${out}${sep}${clean}` : clean;
  }
  return out;
}

/** File name without its .pdf extension (any case). */
export function stemOf(name) {
  return String(name || '').replace(/\.pdf$/i, '');
}

/**
 * The folder of `file` relative to `root` with '/' separators ('' = the root
 * itself), or null when the file is not inside the root.
 */
export function relativeDir(root, file) {
  const rootKey = pathKey(root);
  const { dir } = splitPath(file);
  const dirKey = pathKey(dir);
  if (dirKey === rootKey) return '';
  const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
  if (!dirKey.startsWith(prefix)) return null;
  // Keep the original spelling of the subfolders.
  return String(dir).replace(/\\/g, '/').slice(prefix.length);
}

/** `name.pdf` → `name (2).pdf`, `name (3).pdf`, ... */
export function numberedName(path, n) {
  const { dir, base } = splitPath(path);
  const stem = stemOf(base);
  const ext = base.slice(stem.length) || '.pdf';
  const name = `${stem} (${n})${ext}`;
  return dir ? joinPath(dir, name) : name;
}

/** A suffix is safe as part of a file name (no separators, no reserved characters). */
export function validSuffix(suffix) {
  const s = String(suffix ?? '');
  return s.length <= 64 && !/[\\/:*?"<>|\u0000-\u001f]/.test(s);
}

/**
 * Normalised options. Throws BATCH_OCR_* codes for choices that cannot work.
 * @param {object} o
 */
export function normaliseOptions(o = {}) {
  const outputMode = [OUTPUT_FOLDER, OUTPUT_BESIDE, OUTPUT_REPLACE].includes(o.outputMode) ? o.outputMode : OUTPUT_FOLDER;
  const existing = [EXISTING_RENAME, EXISTING_SKIP, EXISTING_OVERWRITE].includes(o.existing) ? o.existing : EXISTING_RENAME;
  const suffix = o.suffix === undefined || o.suffix === null
    ? (outputMode === OUTPUT_BESIDE ? DEFAULT_SUFFIX : '')
    : String(o.suffix).trim();
  if (!validSuffix(suffix)) throw new Error('BATCH_OCR_BAD_SUFFIX');
  if (!String(o.sourceDir || '').trim()) throw new Error('BATCH_OCR_NO_SOURCE');
  if (outputMode === OUTPUT_BESIDE && !suffix) throw new Error('BATCH_OCR_SUFFIX_REQUIRED');
  if (outputMode === OUTPUT_FOLDER && !String(o.outputDir || '').trim()) throw new Error('BATCH_OCR_NO_OUTPUT');
  return {
    sourceDir: String(o.sourceDir).trim(),
    outputDir: outputMode === OUTPUT_FOLDER ? String(o.outputDir).trim() : '',
    outputMode,
    suffix,
    existing,
  };
}

/** Where the output of `source` goes before collision handling. */
export function targetFor(source, opts) {
  const { dir, base } = splitPath(source);
  if (opts.outputMode === OUTPUT_REPLACE) return source;
  const name = `${stemOf(base)}${opts.suffix}.pdf`;
  if (opts.outputMode === OUTPUT_BESIDE) return dir ? joinPath(dir, name) : name;
  const rel = relativeDir(opts.sourceDir, source);
  return joinPath(opts.outputDir, rel || '', name);
}

/**
 * The plan: one entry per source file, in the given order.
 *
 * @param {string[]} files  source paths (from batch_ocr_list)
 * @param {object} options  see normaliseOptions
 * @param {{exists?: (path:string) => boolean|Promise<boolean>, isOpen?: (path:string) => boolean}} ctx
 * @returns {Promise<Array<{source:string, target:string|null, action:'ocr'|'skip',
 *   overwrite:boolean, reason:string|null}>>}
 */
export async function planBatchOcr(files, options, ctx = {}) {
  const opts = normaliseOptions(options);
  const exists = ctx.exists || (() => false);
  const isOpen = ctx.isOpen || (() => false);
  const claimed = new Set();
  const sources = new Set(files.map(pathKey));
  const plan = [];

  const skip = (source, reason) => plan.push({ source, target: null, action: 'skip', overwrite: false, reason });

  for (const source of files) {
    const { base } = splitPath(source);
    if (opts.outputMode === OUTPUT_BESIDE && stemOf(base).endsWith(opts.suffix)) {
      // The result of an earlier run next to its source: not again.
      skip(source, REASON.OWN_OUTPUT);
      continue;
    }
    if (opts.outputMode === OUTPUT_REPLACE) {
      if (isOpen(source)) skip(source, REASON.OPEN);
      else {
        plan.push({ source, target: source, action: 'ocr', overwrite: true, reason: null });
        claimed.add(pathKey(source));
      }
      continue;
    }
    let target = targetFor(source, opts);
    if (samePath(target, source)) {
      skip(source, REASON.SAME_AS_SOURCE);
      continue;
    }
    // Another source file of this run, or an output this run already plans,
    // is never overwritten; an existing file follows the chosen policy.
    const takenByRun = (p) => claimed.has(pathKey(p)) || sources.has(pathKey(p));
    const taken = async (p) => takenByRun(p) || isOpen(p) || await exists(p);
    let overwrite = false;
    if (await taken(target)) {
      if (opts.existing === EXISTING_SKIP && !takenByRun(target)) {
        skip(source, isOpen(target) ? REASON.OPEN : REASON.EXISTS);
        continue;
      }
      if (opts.existing === EXISTING_OVERWRITE && !takenByRun(target)) {
        if (isOpen(target)) {
          skip(source, REASON.OPEN);
          continue;
        }
        overwrite = true;
      } else {
        const original = target;
        let n = 2;
        while (await taken(target = numberedName(original, n))) {
          if (++n > MAX_RENAME) break;
        }
        if (n > MAX_RENAME) {
          skip(source, REASON.EXISTS);
          continue;
        }
      }
    }
    claimed.add(pathKey(target));
    plan.push({ source, target, action: 'ocr', overwrite, reason: null });
  }
  return plan;
}

/** Pages to recognise: all, or with `skipText` only those without text. */
export function pagesToRecognise(textChars, { skipText = false, minChars = 1 } = {}) {
  const pages = [];
  (textChars || []).forEach((chars, index) => {
    if (!skipText || !(Number(chars) >= minChars)) pages.push(index);
  });
  return pages;
}

/** Totals of a run. */
export function summarise(results) {
  const sum = { total: results.length, done: 0, skipped: 0, failed: 0, cancelled: 0, pages: 0, words: 0 };
  for (const r of results) {
    if (r.status in sum) sum[r.status]++;
    sum.pages += r.ocrPages || 0;
    sum.words += r.words || 0;
  }
  return sum;
}

const CSV_COLUMNS = ['file', 'status', 'pages', 'ocr_pages', 'words', 'output', 'reason', 'message'];

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The report as CSV (stable English column names and status codes, so it can
 * be filtered and compared between runs). CRLF line ends and a BOM, so a
 * spreadsheet opens it with the right encoding.
 */
export function reportCsv(results) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of results) {
    lines.push([
      r.source, r.status, r.pages ?? '', r.ocrPages ?? '', r.words ?? '', r.target || '', r.reason || '', r.message || '',
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Only the files that did not succeed (the report of failures). */
export function failures(results) {
  return results.filter((r) => r.status === 'failed' || r.status === 'cancelled');
}

/** File name for the exported report. */
export function reportFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `batch-ocr-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.csv`;
}
