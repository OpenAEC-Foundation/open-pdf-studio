// Browser glue for BCF import/export.
//
// Bridges the pure BCF core (bcf-export.js / bcf-import.js) to the app: file
// dialogs, per-page snapshot rendering, and annotation state updates. This is
// the only BCF file that touches the DOM / app state, keeping the core
// unit-testable.

import { getActiveDocument } from '../core/state.js';
import { createAnnotation } from '../annotations/factory.js';
import { recordBulkAdd } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { renderPageOffscreen, canvasToBytes } from '../pdf/exporter.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { isTauri, readBinaryFile, writeBinaryFile, saveFileDialog, openFileDialog } from '../core/platform.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';
import { buildBcfZip } from './bcf-export.js';
import { parseBcfZip } from './bcf-import.js';
import { bevestigExportVerlies } from '../ui/chrome/export-verlies-bevestigen.js';

const SNAPSHOT_MAX_PX = 1400; // cap the longest snapshot side

// Render a page to a PNG snapshot, scaled so its longest side ≤ SNAPSHOT_MAX_PX.
async function renderPageSnapshot(doc, pageNum) {
  try {
    const page = await doc.pdfDoc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const longest = Math.max(base.width, base.height);
    const scale = longest > SNAPSHOT_MAX_PX ? SNAPSHOT_MAX_PX / longest : 1;
    const canvas = await renderPageOffscreen(pageNum, scale);
    return await canvasToBytes(canvas, 'png');
  } catch (e) {
    console.warn('[bcf] snapshot render failed for page', pageNum, e);
    return null;
  }
}

// Export the active document's annotations as a .bcfzip file.
export async function exportBcfToFile() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    showMessage(i18next.t('common:noDocumentOpen'));
    return;
  }
  const annotations = (doc.annotations || []).filter(a => a && a.type);
  if (annotations.length === 0) {
    showMessage(i18next.t('noAnnotationsToExport'));
    return;
  }
  // Wat BCF niet meeneemt (#629): eerst vragen, vóór het werk.
  if (!(await bevestigExportVerlies('bcf', doc, { annotatieLijst: annotations })).ok) return;

  // One snapshot per referenced page, reused for every annotation on it.
  const pages = [...new Set(annotations.map(a => a.page || 1))];
  const pageSnapshots = new Map();
  for (const p of pages) {
    const png = await renderPageSnapshot(doc, p);
    if (png) pageSnapshots.set(p, png);
  }
  const snapshots = new Map();
  for (const a of annotations) {
    const png = pageSnapshots.get(a.page || 1);
    if (png) snapshots.set(a.id, png);
  }

  const projectName = (doc.fileName || 'document').replace(/\.pdf$/i, '');
  let bytes;
  try {
    bytes = buildBcfZip(annotations, { projectName, snapshots });
  } catch (e) {
    console.error('[bcf] export build failed:', e);
    showMessage(i18next.t('bcfExportFailed'));
    return;
  }

  const baseName = doc?.filePath ? doc.filePath.replace(/\.pdf$/i, '') : projectName;
  const savePath = await saveFileDialog(baseName + '.bcfzip', [
    { name: 'BCF', extensions: ['bcfzip', 'bcf'] },
  ]);
  if (!savePath) return;

  try {
    if (isTauri()) {
      try { await window.__TAURI__?.core?.invoke('allow_fs_scope', { path: savePath }); } catch {}
    }
    await writeBinaryFile(savePath, bytes);
    updateStatusMessage(i18next.t('bcfExported', { count: annotations.length }));
  } catch (e) {
    console.error('[bcf] export write failed:', e);
    showMessage(i18next.t('bcfExportFailed'));
  }
}

// Import annotations from a .bcfzip file into the active document.
export async function importBcfFromFile() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    showMessage(i18next.t('common:noDocumentOpen'));
    return;
  }
  if (!isTauri()) {
    showMessage(i18next.t('importRequiresTauri'));
    return;
  }

  const filePath = await openFileDialog(['bcfzip', 'bcf', 'zip']);
  if (!filePath) return;

  let bytes;
  try {
    bytes = await readBinaryFile(filePath);
  } catch (e) {
    console.error('[bcf] read failed:', e);
    showMessage(i18next.t('bcfImportFailed'));
    return;
  }

  let parsed;
  try {
    parsed = await parseBcfZip(new Uint8Array(bytes), { pageCount: doc.pdfDoc.numPages });
  } catch (e) {
    console.error('[bcf] parse failed:', e);
    showMessage(i18next.t('bcfInvalidFile'));
    return;
  }

  if (parsed.warnings?.length) {
    for (const w of parsed.warnings) console.warn('[bcf] import warning:', w);
  }

  const newAnnotations = [];
  for (const raw of parsed.annotations) {
    // Route through the factory so defaults/ids are normalised app-side.
    const { id, ...rest } = raw;
    const ann = createAnnotation(rest);
    doc.annotations.push(ann);
    newAnnotations.push(ann);
  }

  if (newAnnotations.length > 0) {
    recordBulkAdd(newAnnotations);
    if (doc.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
    const warnSuffix = parsed.warnings?.length ? ` (${parsed.warnings.length} warnings)` : '';
    updateStatusMessage(i18next.t('bcfImported', { count: newAnnotations.length }) + warnSuffix);
  } else {
    showMessage(i18next.t('bcfNoTopics'));
  }
}
