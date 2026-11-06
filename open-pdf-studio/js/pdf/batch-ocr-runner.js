// Batch OCR (#382): runs a plan from batch-ocr-plan.js, file by file, without
// any question to the user and without opening a tab. Everything that touches
// the outside world comes in through `deps`, so the run is tested with a
// stubbed OCR and an in-memory file system (batch-ocr.test.mjs); the app
// passes the Tauri commands (batch-ocr.js).
//
// Per file: count the text per page (inspect), recognise the pages that need
// it, put the invisible text layer in with the same writer as a normal save
// (saver/ocr-text-layer.js) and write the result in one go: a new file is
// created exclusively (never replaces anything), a replacement is atomic.
// A cancelled or failed file never leaves a partial result behind.

import { PDFDocument } from 'pdf-lib';
import { writeOcrLayers } from './saver/ocr-text-layer.js';
import { pagesToRecognise, numberedName, splitPath, REASON, EXISTING_RENAME } from './batch-ocr-plan.js';

/** Error code of an exclusive write whose target appeared meanwhile. */
const CHOOSE_NEW_FILE = 'CHOOSE_NEW_FILE';
const MAX_RETRIES = 50;

function message(err) {
  const s = String(err?.message ?? err ?? '');
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

/**
 * Add an OCR text layer to `bytes` for the recognised pages.
 * @param {Uint8Array} bytes
 * @param {Record<number, object[]>} ocrResults  1-based page → words
 * @param {() => Promise<Uint8Array>} loadFontBytes
 * @returns {Promise<Uint8Array>}
 */
export async function applyOcrLayer(bytes, ocrResults, loadFontBytes) {
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(message(err))) throw new Error('BATCH_OCR_ENCRYPTED');
    throw err;
  }
  const hasWords = Object.values(ocrResults).some((w) => Array.isArray(w) && w.length > 0);
  const written = await writeOcrLayers(pdf, pdf.getPages(), { ocrResults }, { loadFontBytes, strictReviews: false });
  if (hasWords && !written) throw new Error('BATCH_OCR_FONT_MISSING');
  return new Uint8Array(await pdf.save());
}

/**
 * Run the plan.
 *
 * @param {Array} plan  from planBatchOcr
 * @param {{lang?:string, skipText?:boolean, existing?:string}} options
 * @param {{
 *   inspect: (path:string) => Promise<number[]>,
 *   ocrPage: (path:string, pageIndex:number, lang:string) => Promise<object[]>,
 *   readFile: (path:string) => Promise<Uint8Array>,
 *   writeNew: (path:string, bytes:Uint8Array) => Promise<any>,
 *   writeReplace: (path:string, bytes:Uint8Array) => Promise<any>,
 *   ensureDir?: (dir:string) => Promise<any>,
 *   release?: () => Promise<any>,
 *   loadFontBytes: () => Promise<Uint8Array>,
 * }} deps
 * @param {{isCancelled?: () => boolean, onProgress?: (p:object) => void}} control
 * @returns {Promise<object[]>} one result per plan entry, in plan order
 */
export async function runBatchOcr(plan, options, deps, control = {}) {
  const lang = options.lang || 'auto';
  const isCancelled = control.isCancelled || (() => false);
  const progress = control.onProgress || (() => {});
  const results = plan.map((entry) => ({
    source: entry.source, target: entry.target, status: 'pending',
    pages: null, ocrPages: 0, words: 0, reason: entry.reason, message: '',
  }));
  const madeDirs = new Set();

  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    const result = results[i];
    if (isCancelled()) {
      for (let j = i; j < plan.length; j++) {
        if (results[j].status === 'pending') results[j].status = plan[j].action === 'skip' ? 'skipped' : 'cancelled';
      }
      break;
    }
    if (entry.action === 'skip') {
      result.status = 'skipped';
      progress({ index: i, result });
      continue;
    }
    result.status = 'running';
    progress({ index: i, result });
    try {
      const textChars = await deps.inspect(entry.source);
      result.pages = textChars.length;
      const todo = pagesToRecognise(textChars, { skipText: !!options.skipText });
      if (todo.length === 0) {
        result.status = 'skipped';
        result.reason = REASON.HAS_TEXT;
        result.target = null;
        progress({ index: i, result });
        continue;
      }
      const ocrResults = {};
      let cancelled = false;
      for (let k = 0; k < todo.length; k++) {
        if (isCancelled()) { cancelled = true; break; }
        progress({ index: i, result, page: k + 1, pages: todo.length });
        const words = await deps.ocrPage(entry.source, todo[k], lang);
        ocrResults[todo[k] + 1] = Array.isArray(words) ? words : [];
        result.words += ocrResults[todo[k] + 1].length;
      }
      if (cancelled || isCancelled()) {
        result.status = 'cancelled';
        result.words = 0;
        result.target = null;
        progress({ index: i, result });
        continue;
      }
      result.ocrPages = todo.length;
      const source = await deps.readFile(entry.source);
      const out = await applyOcrLayer(new Uint8Array(source), ocrResults, deps.loadFontBytes);
      if (entry.overwrite) {
        await deps.writeReplace(entry.target, out);
      } else {
        const { dir } = splitPath(entry.target);
        if (dir && deps.ensureDir && !madeDirs.has(dir)) {
          await deps.ensureDir(dir);
          madeDirs.add(dir);
        }
        result.target = await writeExclusive(entry.target, out, deps, options.existing);
      }
      result.status = 'done';
    } catch (err) {
      if (message(err) === 'BATCH_OCR_TARGET_EXISTS' && options.existing === 'skip') {
        // The output file appeared after planning: the chosen policy says skip.
        Object.assign(result, { status: 'skipped', reason: REASON.EXISTS, target: null, words: 0, ocrPages: 0 });
      } else {
        Object.assign(result, { status: 'failed', message: message(err), target: null, words: 0, ocrPages: 0 });
      }
    } finally {
      try { await deps.release?.(); } catch { /* the next file loads its own */ }
    }
    progress({ index: i, result });
  }
  return results;
}

/**
 * Create `target`; when it appeared after planning (another program), the
 * rename policy picks the next free number and the others fail.
 */
async function writeExclusive(target, bytes, deps, existing = EXISTING_RENAME) {
  let path = target;
  for (let n = 2; ; n++) {
    try {
      await deps.writeNew(path, bytes);
      return path;
    } catch (err) {
      if (message(err) !== CHOOSE_NEW_FILE) throw err;
      if (existing !== EXISTING_RENAME || n > MAX_RETRIES) throw new Error('BATCH_OCR_TARGET_EXISTS');
      path = numberedName(target, n);
    }
  }
}
