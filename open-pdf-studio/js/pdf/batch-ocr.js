// Batch OCR (#382): the app side. Lists the folder through Rust, plans with
// batch-ocr-plan.js and runs with batch-ocr-runner.js on the Tauri commands
// (batch_ocr_* in src-tauri/src/batch_ocr.rs). No tab is opened: every file is
// loaded off-screen in its own PDFium handle and written in one go.

import {
  invoke, readBinaryFile, writeBinaryFileNew, writeBinaryFileAtomic, saveFileDialog,
} from '../core/platform.js';
import { state } from '../core/state.js';
import { loadDefaultOcrFontBytes } from './saver/ocr-text-layer.js';
import {
  planBatchOcr, normaliseOptions, samePath, reportCsv, reportFileName, OUTPUT_FOLDER,
} from './batch-ocr-plan.js';
import { runBatchOcr } from './batch-ocr-runner.js';

/** Is this path open in a tab (as file or as save target)? */
export function isOpenInEditor(path) {
  return (state.documents || []).some((d) => (d?.filePath && samePath(d.filePath, path))
    || (d?.saveTargetPath && samePath(d.saveTargetPath, path)));
}

/**
 * The PDF files the run would take, for the dialog's count.
 * @returns {Promise<{files:string[], truncated:boolean}>}
 */
export async function listBatchFiles(options) {
  const opts = normaliseOptions(options);
  const exclude = opts.outputMode === OUTPUT_FOLDER ? opts.outputDir : null;
  return invoke('batch_ocr_list', { dir: opts.sourceDir, recursive: !!options.recursive, exclude });
}

/** The commands the runner needs, on Tauri. */
export function tauriBatchDeps() {
  return {
    inspect: (path) => invoke('batch_ocr_inspect', { path }),
    ocrPage: (path, pageIndex, lang) => invoke('batch_ocr_page', { path, pageIndex, lang }),
    readFile: async (path) => new Uint8Array(await readBinaryFile(path)),
    writeNew: (path, bytes) => writeBinaryFileNew(path, bytes),
    writeReplace: (path, bytes) => writeBinaryFileAtomic(path, bytes),
    ensureDir: (dir) => invoke('batch_ocr_allow_output', { dir }),
    release: () => invoke('batch_ocr_release'),
    loadFontBytes: loadDefaultOcrFontBytes,
  };
}

/**
 * Plan and run. `control.onPlan(plan)` is called once before the first file,
 * `control.onProgress` for every step, `control.isCancelled` between pages.
 */
export async function startBatchOcr(options, control = {}, deps = tauriBatchDeps()) {
  const opts = normaliseOptions(options);
  if (opts.outputMode === OUTPUT_FOLDER) await invoke('batch_ocr_allow_output', { dir: opts.outputDir });
  const { files } = await listBatchFiles(options);
  const plan = await planBatchOcr(files, opts, {
    exists: (path) => invoke('file_exists', { path }),
    isOpen: isOpenInEditor,
  });
  control.onPlan?.(plan);
  try {
    return await runBatchOcr(plan, { lang: options.lang, skipText: !!options.skipText, existing: opts.existing }, deps, control);
  } finally {
    try { await deps.release?.(); } catch { /* nothing held */ }
  }
}

/** Let the user save the report as CSV. Returns the path, or null. */
export async function exportBatchReport(results) {
  const path = await saveFileDialog(reportFileName(), [{ name: 'CSV', extensions: ['csv'] }]);
  if (typeof path !== 'string' || !path) return null;
  await writeBinaryFileAtomic(path, new TextEncoder().encode(reportCsv(results)));
  return path;
}
