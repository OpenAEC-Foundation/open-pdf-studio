// Change report and clouds for Compare (#465): the app side of
// change-report.js. Runs the detection over every page pair (with the stored
// or an automatic alignment), attaches the text before and after from the text
// comparison, and writes CSV or a PDF summary through the usual save dialog.
// Selected changes can also be placed as clouds with a comment on the new
// document, so the recipient sees them in any reader.

import i18next from '../i18n/config.js';
import { state } from '../core/state.js';
import { saveFileDialog, writeBinaryFile } from '../core/platform.js';
import { computePairChanges, createBatchClients, renderCompareCrop } from './compare-viewport.js';
import { runTextCompare } from './text-compare.js';
import { diffAnnotationsForPair } from './compare-annotations.js';
import { buildReportRows, buildReportCsv, buildReportPdf, pdfSafeLabels, cloudComment, REPORT_COLUMNS } from './change-report.js';
import { getPairAlignment, applyAutoAlignment } from './compare-store.js';
import { compareSourceInfo } from './compare-sources.js';
import { presetSettings } from './detect-plan.js';

const t = (key, opts) => i18next.t(`compare.${key}`, { ns: 'ribbon', ...opts });
const tEn = (key) => i18next.t(`compare.${key}`, { ns: 'ribbon', lng: 'en' });

export function compareDocName(path) {
  const src = compareSourceInfo(path);
  if (src) return src.name;
  const doc = (state.documents || []).find((d) => d && d.filePath === path);
  return doc?.fileName || String(path || '').split(/[\\/]/).pop() || '';
}

function typeNames(tr = t) {
  return {
    added: tr('added'), removed: tr('removed'), modified: tr('modified'),
    pixel: tr('report.sourcePixel'), vector: tr('report.sourceVector'), text: tr('report.sourceText'), annotation: tr('annotation'),
  };
}

function columnLabels(tr = t) {
  const out = {};
  for (const k of REPORT_COLUMNS) out[k] = tr(`report.col.${k}`);
  return out;
}

function textOnlyChanges(textChanges, oldPage, newPage, covered) {
  const out = [];
  for (const tc of textChanges || []) {
    if (covered.has(tc)) continue;
    const rects = (tc.newRects || []).filter((r) => r.page === newPage);
    const oldRects = (tc.oldRects || []).filter((r) => r.page === oldPage);
    const use = rects.length ? rects : oldRects;
    if (!use.length) continue;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of use) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
    out.push({ type: tc.type, source: 'text', x: x1, y: y1, width: x2 - x1, height: y2 - y1, oldText: tc.oldText || '', newText: tc.newText || '' });
  }
  return out;
}

/**
 * Changes of every matched pair.
 * @param {{oldPath:string,newPath:string,pairs:Array<{old:number,new:number}>,preset:string,method?:string,
 *   autoAlign:boolean, sheets?:Map<number,{sheet?:string,label?:string}>,
 *   onProgress?:(done:number,total:number)=>void, isCancelled?:()=>boolean}} o
 */
export async function collectReport(o) {
  const clients = createBatchClients();
  try {
    let textChanges = [];
    try { textChanges = await runTextCompare(o.oldPath, o.newPath); } catch (_) { textChanges = []; }
    const pairs = o.pairs.filter((p) => p.old != null && p.new != null);
    const out = [];
    for (let i = 0; i < pairs.length; i++) {
      if (o.isCancelled?.()) return null;
      const p = pairs[i];
      o.onProgress?.(i, pairs.length);
      const stored = getPairAlignment(p.old, p.new);
      const res = await computePairChanges({
        oldPath: o.oldPath, newPath: o.newPath, oldPage: p.old, newPage: p.new,
        preset: o.preset, method: o.method, offset: stored?.alignment, autoAlign: !stored && o.autoAlign,
      }, clients);
      if (!res) continue;
      if (res.alignInfo) applyAutoAlignment(p.old, p.new, res.alignInfo);
      const pageText = (textChanges || []).filter((tc) => (tc.oldPage === p.old || tc.newPage === p.new));
      const covered = new Set();
      // Which text records a visual change already explains.
      const rows = buildReportRows([{ pair: i + 1, oldPage: p.old, newPage: p.new, changes: res.changes, textChanges: pageText }]);
      for (const tc of pageText) {
        if (rows.some((r) => (tc.oldText && r.oldText.includes(tc.oldText)) || (tc.newText && r.newText.includes(tc.newText)))) covered.add(tc);
      }
      const annotations = diffAnnotationsForPair(o.oldPath, p.old, o.newPath, p.new).map((a) => ({ ...a, oldText: '', newText: a.label || '' }));
      const sheet = o.sheets?.get(p.new)?.sheet || o.sheets?.get(p.new)?.label || '';
      out.push({
        pair: i + 1, oldPage: p.old, newPage: p.new, sheet,
        changes: [...res.changes, ...textOnlyChanges(pageText, p.old, p.new, covered), ...annotations],
        textChanges: pageText,
        alignment: res.alignment,
      });
    }
    o.onProgress?.(pairs.length, pairs.length);
    return out;
  } finally {
    clients.dispose();
  }
}

function baseName(newPath) {
  return compareDocName(newPath).replace(/\.pdf$/i, '') || 'compare';
}

/** Write the CSV report. Returns true when written. */
export async function exportReportCsv(o, pairResults) {
  const rows = buildReportRows(pairResults);
  const csv = buildReportCsv(rows, columnLabels(), typeNames());
  const path = await saveFileDialog(`${baseName(o.newPath)}-${t('report.fileSuffix')}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
  if (!path) return false;
  await writeBinaryFile(path, new TextEncoder().encode(csv));
  return true;
}

/** Write the PDF summary with crops. Returns true when written. */
export async function exportReportPdf(o, pairResults, { maxCrops = 150, onProgress } = {}) {
  const rows = buildReportRows(pairResults);
  const crops = new Map();
  const n = Math.min(rows.length, maxCrops);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    onProgress?.(i, n);
    const c = r._change;
    try {
      const [oldPng, newPng] = await Promise.all([
        c.old ? renderCompareCrop(o.oldPath, r.oldPage, c.old) : (c.type === 'removed' ? renderCompareCrop(o.oldPath, r.oldPage, c) : null),
        renderCompareCrop(o.newPath, r.newPage, c),
      ]);
      crops.set(r.no, { old: oldPng, new: newPng });
    } catch (_) { /* a crop that fails only leaves the row without picture */ }
  }
  // The standard PDF font covers Latin scripts; other languages get the
  // English headings (the CSV keeps every language).
  const local = { ...columnLabels(), ...reportLabels() };
  const english = { ...columnLabels(tEn), ...reportLabels(tEn) };
  const labels = pdfSafeLabels(local, english);
  const tr = labels === local ? t : tEn;
  const names = typeNames(tr);
  const p = presetSettings(o.preset);
  const method = o.method === 'vector' ? `, ${tr('methodVector')}` : '';
  const bytes = await buildReportPdf({
    rows,
    labels,
    typeNames: names,
    meta: {
      oldName: compareDocName(o.oldPath),
      newName: compareDocName(o.newPath),
      date: new Date().toLocaleString(),
      settings: `${labels.preset || 'Preset'}: ${tr(`preset.${o.preset || 'line'}`)} (${p.toleranceMm} mm, ${p.minAreaMm2} mm2, ${p.mergeMm} mm)${method}`,
    },
    crops,
  });
  const path = await saveFileDialog(`${baseName(o.newPath)}-${t('report.fileSuffix')}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
  if (!path) return false;
  await writeBinaryFile(path, bytes);
  return true;
}

function reportLabels(tr = t) {
  return {
    title: tr('report.title'),
    generated: tr('report.generated'),
    oldDoc: tr('oldDoc'),
    newDoc: tr('newDoc'),
    changes: tr('changes'),
    settings: tr('report.settings'),
    preset: tr('sensitivity'),
    page: tr('page'),
    none: tr('noChanges'),
  };
}

/** Is the new side an open document that can take clouds? */
export function canPlaceClouds(newPath) {
  return (state.documents || []).some((d) => d && d.filePath === newPath);
}

/**
 * Place changes of the current pair as clouds with a comment on the new
 * document (an open tab). Returns the number placed.
 */
export async function placeChangeClouds(newPath, newPage, changes) {
  const index = (state.documents || []).findIndex((d) => d && d.filePath === newPath);
  if (index < 0 || !changes.length) return 0;
  const [{ switchToTab }, { createAnnotation }, { recordBulkAdd }, rendering, { blurCompareTab }] = await Promise.all([
    import('../ui/chrome/tabs.js'),
    import('../annotations/factory.js'),
    import('../core/undo-manager.js'),
    import('../annotations/rendering.js'),
    import('./compare-store.js'),
  ]);
  blurCompareTab();
  switchToTab(index);
  const doc = state.documents[index];
  const colors = { added: '#16a34a', removed: '#dc2626', modified: '#ca8a04' };
  const rows = buildReportRows([{ pair: 1, oldPage: 0, newPage, changes }]);
  const pad = 2 / (25.4 / 72); // 2 mm around the change
  const anns = rows.map((r) => {
    const c = r._change;
    return createAnnotation({
      type: 'cloud',
      page: newPage,
      x: c.x - pad,
      y: c.y - pad,
      width: c.width + 2 * pad,
      height: c.height + 2 * pad,
      color: colors[r.type] || colors.modified,
      strokeColor: colors[r.type] || colors.modified,
      fillColor: 'none',
      lineWidth: 1.5,
      opacity: 1,
      subject: t('report.cloudSubject'),
      text: cloudComment(r, { prefix: t('report.cloudSubject'), before: t('report.before'), after: t('report.after') }, typeNames()),
    });
  });
  doc.annotations.push(...anns);
  recordBulkAdd(anns);
  if (doc.viewMode === 'continuous') rendering.redrawContinuous();
  else rendering.redrawAnnotations();
  try {
    const { updateAnnotationsList } = await import('../ui/panels/annotations-list.js');
    updateAnnotationsList();
  } catch (_) { /* list not mounted */ }
  return anns.length;
}
