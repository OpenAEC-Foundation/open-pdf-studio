// Change report for Compare (#465): the change list as CSV and as a PDF
// summary, so a comparison can be handed on.
//
// Rows carry the page pair, the change type, its position and size in
// millimetres on the new sheet, and the text before and after when the text
// comparison knows it. The PDF summary lists the same rows and shows, per
// change, a crop of the old and the new sheet around it.
//
// Pure module (pdf-lib only): the caller collects the changes, renders the
// crops and writes the files. Unit tested in compare-report.test.mjs.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { bouwCsv } from '../annotations/opmerkingen-export.js';
import { toWinAnsiText, heeftNietWinAnsi } from '../pdf/saver/pdf-text.js';
import { MM_PER_PT } from './detect-plan.js';

export const REPORT_COLUMNS = Object.freeze([
  'no', 'pair', 'oldPage', 'newPage', 'sheet', 'type', 'source', 'xMm', 'yMm', 'widthMm', 'heightMm', 'oldText', 'newText',
]);

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function grow(r, by) {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

/**
 * Text before and after for a visual change, from the text comparison
 * records ({type, oldPage, newPage, oldText, newText, oldRects, newRects};
 * rects {page, x, y, w, h} in points). Removed changes look on the old page,
 * the others on the new page.
 */
export function textForChange(change, textChanges, oldPage, newPage) {
  const oldTexts = [];
  const newTexts = [];
  const oldRect = change.old ? grow(change.old, 2) : null;
  const newRect = grow(change, 2);
  for (const t of textChanges || []) {
    const hitNew = (t.newRects || []).some((r) => r.page === newPage && intersects(newRect, { x: r.x, y: r.y, width: r.w, height: r.h }));
    const hitOld = oldRect && (t.oldRects || []).some((r) => r.page === oldPage && intersects(oldRect, { x: r.x, y: r.y, width: r.w, height: r.h }));
    if (!hitNew && !hitOld) continue;
    if (t.oldText && !oldTexts.includes(t.oldText)) oldTexts.push(t.oldText);
    if (t.newText && !newTexts.includes(t.newText)) newTexts.push(t.newText);
  }
  return { oldText: oldTexts.join(' | '), newText: newTexts.join(' | ') };
}

/**
 * Flatten per-pair results into report rows.
 * @param {Array<{pair:number, oldPage:number, newPage:number, sheet?:string|null,
 *   changes:Array, textChanges?:Array}>} pairs
 *   changes are compare records in points on the new page: {type, x, y,
 *   width, height, source?, old?, oldText?, newText?}
 */
export function buildReportRows(pairs) {
  const rows = [];
  for (const p of pairs || []) {
    for (const c of p.changes || []) {
      const known = (c.oldText !== undefined || c.newText !== undefined)
        ? { oldText: c.oldText || '', newText: c.newText || '' }
        : textForChange(c, p.textChanges, p.oldPage, p.newPage);
      rows.push({
        no: rows.length + 1,
        pair: p.pair,
        oldPage: p.oldPage,
        newPage: p.newPage,
        sheet: p.sheet || '',
        type: c.type,
        source: c.source || 'pixel',
        xMm: round1(c.x * MM_PER_PT),
        yMm: round1(c.y * MM_PER_PT),
        widthMm: round1(c.width * MM_PER_PT),
        heightMm: round1(c.height * MM_PER_PT),
        oldText: known.oldText,
        newText: known.newText,
        _change: c,
        _pair: p,
      });
    }
  }
  return rows;
}

/**
 * CSV text (BOM, CRLF, safe quoting — the same writer as the comment export).
 * @param {object[]} rows from buildReportRows
 * @param {Record<string,string>} headers column key -> heading
 * @param {Record<string,string>} [typeNames] type -> display name
 */
export function buildReportCsv(rows, headers, typeNames = {}) {
  const head = REPORT_COLUMNS.map((k) => headers?.[k] || k);
  const body = rows.map((r) => REPORT_COLUMNS.map((k) => {
    if (k === 'type') return typeNames[r.type] || r.type;
    if (k === 'source') return typeNames[r.source] || r.source;
    const v = r[k];
    return v === null || v === undefined ? '' : v;
  }));
  return bouwCsv(head, body);
}

/** Choose report labels that the standard PDF font can show. */
export function pdfSafeLabels(labels, fallback) {
  const values = Object.values(labels || {}).filter((v) => typeof v === 'string');
  return values.some((v) => heeftNietWinAnsi(v)) ? fallback : labels;
}

const A4L = [841.89, 595.28];

/**
 * PDF summary.
 * @param {object} opts
 * @param {object[]} opts.rows from buildReportRows
 * @param {Record<string,string>} opts.labels title, generated, oldDoc, newDoc,
 *   changes, settings, page, crop, none, plus a heading per REPORT_COLUMNS key
 * @param {Record<string,string>} [opts.typeNames]
 * @param {{oldName:string,newName:string,date:string,settings?:string}} opts.meta
 * @param {Map<number,{old?:Uint8Array,new?:Uint8Array}>} [opts.crops] row no -> PNG/JPEG bytes
 * @returns {Promise<Uint8Array>}
 */
export async function buildReportPdf({ rows, labels, typeNames = {}, meta, crops = new Map() }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(toWinAnsiText(labels.title || 'Compare report'));
  pdf.setCreator('Open PDF Studio');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = A4L;
  const M = 36;
  const txt = (s) => toWinAnsiText(String(s ?? ''), { newlines: 'space' });
  const fit = (s, f, size, max) => {
    let t = txt(s);
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + '...', size) > max) t = t.slice(0, -1);
    return t + '...';
  };
  const colors = { added: rgb(0.09, 0.64, 0.29), removed: rgb(0.86, 0.15, 0.15), modified: rgb(0.79, 0.54, 0.02) };

  let page = pdf.addPage(A4L);
  let y = H - M;
  const newPage = () => { page = pdf.addPage(A4L); y = H - M; };
  const line = (text, { f = font, size = 10, color = rgb(0, 0, 0), x = M } = {}) => {
    if (y < M + size) newPage();
    page.drawText(fit(text, f, size, W - x - M), { x, y: y - size, size, font: f, color });
    y -= size + 4;
  };

  // Summary.
  line(labels.title || 'Compare report', { f: bold, size: 16 });
  y -= 4;
  line(`${labels.oldDoc || 'Old'}: ${meta?.oldName || ''}`);
  line(`${labels.newDoc || 'New'}: ${meta?.newName || ''}`);
  line(`${labels.generated || 'Generated'}: ${meta?.date || ''}`);
  if (meta?.settings) line(`${labels.settings || 'Settings'}: ${meta.settings}`);
  const counts = { added: 0, removed: 0, modified: 0 };
  for (const r of rows) if (counts[r.type] !== undefined) counts[r.type]++;
  line(`${labels.changes || 'Changes'}: ${rows.length}  (${typeNames.added || 'added'} ${counts.added}, ${typeNames.removed || 'removed'} ${counts.removed}, ${typeNames.modified || 'modified'} ${counts.modified})`);
  y -= 8;
  if (!rows.length) line(labels.none || 'No changes');

  // Table, with crops per change.
  const cols = [
    { k: 'no', w: 28 }, { k: 'oldPage', w: 44 }, { k: 'newPage', w: 44 }, { k: 'sheet', w: 60 },
    { k: 'type', w: 62 }, { k: 'xMm', w: 46 }, { k: 'yMm', w: 46 }, { k: 'widthMm', w: 50 }, { k: 'heightMm', w: 50 },
    { k: 'oldText', w: 170 }, { k: 'newText', w: 170 },
  ];
  const header = () => {
    if (y < M + 40) newPage();
    let x = M;
    page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 14, color: rgb(0.93, 0.93, 0.93) });
    for (const c of cols) {
      page.drawText(fit(labels[c.k] || c.k, bold, 8, c.w - 4), { x: x + 2, y: y - 10, size: 8, font: bold });
      x += c.w;
    }
    y -= 18;
  };
  if (rows.length) header();
  const CROP_H = 120;
  for (const r of rows) {
    const crop = crops.get(r.no);
    const need = 14 + (crop ? CROP_H + 8 : 0);
    if (y - need < M) { newPage(); header(); }
    let x = M;
    for (const c of cols) {
      let v = r[c.k];
      if (c.k === 'type') v = typeNames[r.type] || r.type;
      const color = c.k === 'type' ? (colors[r.type] || rgb(0, 0, 0)) : rgb(0, 0, 0);
      page.drawText(fit(v ?? '', font, 8, c.w - 4), { x: x + 2, y: y - 10, size: 8, font, color });
      x += c.w;
    }
    y -= 14;
    if (crop) {
      let cx = M + 28;
      for (const side of ['old', 'new']) {
        const bytes = crop[side];
        if (!bytes) continue;
        let img = null;
        try {
          img = bytes[0] === 0x89 ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        } catch (_) { img = null; }
        if (!img) continue;
        const s = Math.min(CROP_H / img.height, 300 / img.width);
        const w = img.width * s;
        const h = img.height * s;
        page.drawImage(img, { x: cx, y: y - h, width: w, height: h });
        page.drawRectangle({ x: cx, y: y - h, width: w, height: h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
        page.drawText(txt(side === 'old' ? (labels.oldDoc || 'Old') : (labels.newDoc || 'New')), { x: cx, y: y - h - 9, size: 7, font, color: rgb(0.3, 0.3, 0.3) });
        cx += w + 16;
      }
      y -= CROP_H + 12;
    }
    page.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
  }

  // Page numbers.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const s = txt(`${labels.page || 'Page'} ${i + 1} / ${pages.length}`);
    p.drawText(s, { x: W - M - font.widthOfTextAtSize(s, 8), y: M / 2, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  });
  return pdf.save();
}

/** Comment text for a cloud placed on the new document. */
export function cloudComment(row, labels, typeNames = {}) {
  const parts = [`${labels.prefix || 'Compare'}: ${typeNames[row.type] || row.type}`];
  parts.push(`${row.widthMm} x ${row.heightMm} mm`);
  if (row.oldText) parts.push(`${labels.before || 'Before'}: ${row.oldText}`);
  if (row.newText) parts.push(`${labels.after || 'After'}: ${row.newText}`);
  return parts.join('\n');
}
