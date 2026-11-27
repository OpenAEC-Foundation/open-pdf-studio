import { state, getActiveDocument } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';
import { readBinaryFile, isTauri } from '../core/platform.js';
import { validateManifest, validateSheet, revisionPreview, commitRevision, transferPreview } from './model.js';
import { documentRevisie, beginUndoTransaction, endUndoTransaction, recordAdd, recordModify, recordDelete } from '../core/undo-manager.js';
import { createAnnotation } from '../annotations/factory.js';
import { applyAnnotationBatch } from '../plugins/annotation-batch.js';
import { redrawAnnotations } from '../annotations/rendering.js';

const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const clone = value => JSON.parse(JSON.stringify(value));
const current = () => validateManifest(state.preferences.drawingSet || { version: 1, name: 'Drawing set', sheets: [] });
const sessions = new Map();

export function drawingSetState() {
  return {
    manifest: current(),
    root: state.preferences.drawingSetRoot || '',
    report: clone(state.preferences.drawingSetReport || null)
  };
}

async function bytesFor(doc) {
  const { getCachedPdfBytes } = await import('../pdf/loader.js');
  return getCachedPdfBytes(doc.saveTargetPath || doc.filePath) || (await doc.pdfDoc.getData());
}

export async function captureActiveSheets() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || !doc.filePath) throw new Error('OPEN_SAVED_SOURCE');
  const pdf = doc.pdfDoc,
    revision = documentRevisie(doc),
    path = (doc.saveTargetPath || doc.filePath).replaceAll('\\', '/'),
    root = (state.preferences.drawingSetRoot || '').replaceAll('\\', '/').replace(/\/+$/, '');
  const source = root ? path.startsWith(root + '/') ? path.slice(root.length + 1) : null : path.split('/').pop();
  if (!source) throw new Error('SOURCE_OUTSIDE_ROOT');
  const digest = await hash(await bytesFor(doc));
  const labels = await pdf.getPageLabels(),
    sheets = [];
  if (pdf.numPages > 1000) throw new Error('PAGE_LIMIT');
  for (let page = 1; page <= pdf.numPages; page++) {
    const p = await pdf.getPage(page),
      v = p.getViewport({ scale: 1 });
    sheets.push(validateSheet({
      number: labels?.[page - 1] || `${source.replace(/\.pdf$/i, '')}-${page}`,
      title: '',
      discipline: '',
      revision: '',
      date: '',
      source,
      hash: digest,
      page,
      width: v.width,
      height: v.height,
      rotation: p.rotate
    }));
  }
  if (getActiveDocument() !== doc || doc.pdfDoc !== pdf || documentRevisie(doc) !== revision) throw new Error('SOURCE_CHANGED');
  return sheets;
}

async function openVersion(sheet) {
  sheet = validateSheet(sheet);
  const root = state.preferences.drawingSetRoot;
  const candidates = state.documents.filter(d => d.pdfDoc && (d.filePath || '').replaceAll('\\', '/').endsWith('/' + sheet.source)
    || d.pdfDoc && d.filePath === sheet.source);
  let doc;
  for (const d of candidates) if ((await hash(await bytesFor(d))) === sheet.hash) {
    doc = d;
    break;
  }
  const { createTab, switchToTab } = await import('../ui/chrome/tabs.js');
  if (!doc) {
    if (!isTauri() || !root) throw new Error('OPEN_SOURCE_OR_SET_ROOT');
    const path = root.replace(/[\\/]+$/, '') + '/' + sheet.source,
      bytes = new Uint8Array(await readBinaryFile(path));
    if ((await hash(bytes)) !== sheet.hash) throw new Error('SOURCE_FILE_CHANGED');
    const tab = createTab(path);
    // The sheet decides where the document opens, not its last view (#1245).
    (await import('../core/last-view.js')).markExplicitTarget(state.documents[tab.index]);
    await (await import('../pdf/loader.js')).loadPDF(path, tab.index, bytes);
    doc = state.documents[tab.index];
  }
  switchToTab(state.documents.indexOf(doc));
  await (await import('../pdf/renderer.js')).goToPage(sheet.page);
  return doc;
}

async function findOpen(sheet) {
  for (const doc of state.documents) if (doc.pdfDoc && (await hash(await bytesFor(doc))) === sheet.hash) return doc;
  throw new Error('OPEN_BOTH_REVISIONS');
}

export async function prepareTransfer(source, target, dx = 0, dy = 0) {
  source = validateSheet(source);
  target = validateSheet(target);
  if (source.hash === target.hash && source.page === target.page) throw new Error('CHOOSE_DIFFERENT_REVISIONS');
  const from = await findOpen(source),
    to = await findOpen(target);
  if (getActiveDocument() !== to) throw new Error('ACTIVATE_TARGET');
  const { ensureAnnotationsForPage, isPdfAReadOnly } = await import('../pdf/loader.js');
  if (isPdfAReadOnly()) throw new Error('READ_ONLY');
  if (from.pageRotations?.[source.page] || to.pageRotations?.[target.page]) throw new Error('SAVE_ROTATIONS_FIRST');
  const fromPdf = from.pdfDoc,
    toPdf = to.pdfDoc,
    fromRev = documentRevisie(from),
    toRev = documentRevisie(to);
  const check = () => {
    if (getActiveDocument() !== to
      || from.pdfDoc !== fromPdf
      || to.pdfDoc !== toPdf
      || documentRevisie(from) !== fromRev
      || documentRevisie(to) !== toRev
      || !state.documents.includes(from)
      || !state.documents.includes(to)) throw new Error('DOCUMENT_CHANGED');
  };
  await ensureAnnotationsForPage(source.page, from);
  await ensureAnnotationsForPage(target.page, to);
  check();
  if (from._annotationPagesReady && !from._annotationPagesReady.has(source.page)
    || to._annotationPagesReady && !to._annotationPagesReady.has(target.page)) throw new Error('ANNOTATIONS_LOADING');
  const sourcePage = await fromPdf.getPage(source.page),
    targetPage = await toPdf.getPage(target.page),
    sv = sourcePage.getViewport({ scale: 1 }),
    tv = targetPage.getViewport({ scale: 1 });
  if ([sv.width, sv.height, sourcePage.rotate].join() !== [source.width, source.height, source.rotation].join()
    || [tv.width, tv.height, targetPage.rotate].join() !== [target.width, target.height, target.rotation].join()) throw new Error('PAGE_GEOMETRY_CHANGED');
  const oldBox = sourcePage.view,
    newBox = targetPage.view;
  const mapPoint = (x, y) => {
    const [px, py] = sv.convertToPdfPoint(x, y),
      [nx, ny] = tv.convertToViewportPoint(newBox[0] + (px - oldBox[0]) / (oldBox[2] - oldBox[0]) * (newBox[2] - newBox[0]), newBox[1] + (py - oldBox[1]) / (oldBox[3] - oldBox[1]) * (newBox[3] - newBox[1]));
    return { x: nx, y: ny };
  };
  const prefix = 'set-' + (await hash(new TextEncoder().encode(`${source.hash}:${source.page}:${target.hash}:${target.page}`))).slice(0, 20);
  const rows = transferPreview(from.annotations.filter(a => a.page === source.page), { source, target, mapPoint, dx, dy, prefix }).map(r => to.annotations.some(a => a.id === r.annotation?.id) ? { ...r, status: 'existing' } : r);
  check();
  const id = crypto.randomUUID();
  sessions.set(id, { to, rows, check, sourcePage, targetPage, source, target, expires: Date.now() + 15 * 60 * 1000 });
  while (sessions.size > 4) sessions.delete(sessions.keys().next().value);
  return { id, rows: clone(rows), source, target };
}

export async function renderTransfer(id, side, canvas) {
  const session = sessions.get(id);
  if (!session || session.expires < Date.now()) throw new Error('PREVIEW_EXPIRED');
  session.check();
  const page = side === 'source' ? session.sourcePage : session.targetPage,
    base = page.getViewport({ scale: 1 }),
    viewport = page.getViewport({ scale: Math.min(1, 900 / Math.max(base.width, base.height)) });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  session.check();
  return { scale: viewport.scale };
}

export async function drawingSetRequest(request) {
  if (request.action === 'list') return drawingSetState();
  if (request.action === 'capture') return { sheets: await captureActiveSheets() };
  if (request.action === 'import') {
    state.preferences.drawingSet = validateManifest(request.manifest);
    savePreferences();
    return drawingSetState();
  }
  if (request.action === 'root') {
    if (typeof request.root !== 'string') throw new Error('INVALID_ROOT');
    state.preferences.drawingSetRoot = request.root;
    savePreferences();
    return drawingSetState();
  }
  if (request.action === 'preview') return { base: JSON.stringify(current()), rows: revisionPreview(current(), request.sheets) };
  if (request.action === 'commit') {
    if (request.base !== JSON.stringify(current())) throw new Error('SET_CHANGED');
    const result = commitRevision(current(), request.sheets, request.resolutions);
    state.preferences.drawingSet = result.manifest;
    state.preferences.drawingSetReport = result.report;
    savePreferences();
    return result;
  }
  if (request.action === 'open') {
    const entry = current().sheets.find(s => s.id === request.id),
      sheet = entry?.versions[request.version ?? entry.versions.length - 1];
    if (!sheet) throw new Error('SHEET_NOT_FOUND');
    await openVersion(sheet);
    return { opened: sheet };
  }
  if (request.action === 'transferPreview') return prepareTransfer(request.source, request.target, request.dx, request.dy);
  if (request.action === 'transferApply') {
    const session = sessions.get(request.id);
    if (!session || session.expires < Date.now()) throw new Error('PREVIEW_EXPIRED');
    session.check();
    if (request.confirmed !== true || !Array.isArray(request.selected)) throw new Error('CONFIRM_PLACEMENTS');
    const ids = new Set(request.selected);
    if (ids.size !== request.selected.length) throw new Error('DUPLICATE_SELECTION');
    const rows = session.rows.filter(r => ids.has(r.sourceId));
    if (rows.length !== ids.size || rows.some(r => !['ready', 'review'].includes(r.status))) throw new Error('UNSUPPORTED_SELECTION');
    const result = applyAnnotationBatch(session.to, rows.map(r => ({ op: 'create', annotation: r.annotation })), {
      createAnnotation,
      beginUndoTransaction,
      endUndoTransaction,
      recordAdd,
      recordModify,
      recordDelete,
      redraw: redrawAnnotations
    });
    sessions.delete(request.id);
    return result;
  }
  throw new Error('INVALID_ACTION');
}
