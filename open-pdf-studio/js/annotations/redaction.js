// Apply Redactions (#762): remove the content under the redaction marks from
// the document itself, not just cover it.
//
// The marks are converted to areas in PDF user space and the document bytes
// are redacted (js/pdf/redaction/apply.js): glyphs, path geometry, image
// pixels, Form XObject content, annotations and form fields under the marks
// are deleted and the areas are filled with the mark colour in the page
// content. The document is then reloaded from those bytes, like any other
// page-content edit (one undoable step). The change reaches the file at the
// next save; that save rewrites the whole file (no earlier versions, no
// unreferenced objects) and re-applies the areas after it wrote text edits,
// OCR text and watermarks (saver.js, applyPendingRedactions).
//
// If any content under a mark cannot be removed reliably (unknown font
// metrics, an image that cannot be decoded, …) nothing is changed and the
// user is told why.

import { getActiveDocument, state } from '../core/state.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';

const t = (key, opts) => i18next.t(key, opts);

async function confirmApply(message) {
  if (window.__TAURI__?.dialog?.ask) {
    return await window.__TAURI__.dialog.ask(message, { title: t('redactTitle'), kind: 'warning' });
  }
  return confirm(message);
}

function reasonText(e) {
  const code = e?.code || e?.message;
  if (code === 'REDACTION_INVALID_AREA') return t('redactReasonInvalid');
  if (typeof code === 'string' && code.startsWith('REDACTION_UNSUPPORTED')) {
    return t('redactReasonUnsupported', { detail: typeof e.detail === 'string' ? e.detail : code });
  }
  return e?.message || String(e);
}

/**
 * Apply redaction marks.
 * @param {{all?: boolean, doc?: object, vragen?: boolean}} [opts]
 * @returns {Promise<{ok: boolean, reden?: string, stats?: object}>}
 */
export async function runRedactions({ all = false, doc = getActiveDocument(), vragen = true } = {}) {
  if (!doc?.pdfDoc) return { ok: false, reden: 'geen-document' };
  const { opslaanGeweigerd } = await import('../pdf/wachtwoord-pdf.js');
  if (opslaanGeweigerd(doc)) { showMessage(i18next.t('protectedPdfReadOnly')); return { ok: false, reden: 'beveiligd' }; }
  const curPage = doc.currentPage;
  const marksModel = doc.annotations.filter((a) => a.type === 'redaction' && (all || a.page === curPage));
  if (marksModel.length === 0) {
    showMessage(t(all ? 'noRedactionsInDocument' : 'noRedactionsOnPage'));
    return { ok: false, reden: 'geen-markeringen' };
  }
  // Unsaved text edits are written at save time, from the model: they would
  // first have to be in the file to be redacted with it.
  if ((doc.textEdits || []).some((te) => te && !te.baked)) {
    showMessage(t('redactNotApplied', { reason: t('redactReasonTextEdits') }));
    return { ok: false, reden: 'tekstbewerkingen' };
  }
  const pages = [...new Set(marksModel.map((a) => a.page))].sort((a, b) => a - b);
  if (vragen) {
    const head = all
      ? t('redactConfirmAll', { count: marksModel.length, pages: pages.length })
      : t('redactConfirmPage', { count: marksModel.length, page: curPage });
    if (!(await confirmApply(`${head}\n\n${t('redactConfirmBody')}`))) return { ok: false, reden: 'afgebroken' };
  }
  if (!state.documents.includes(doc)) return { ok: false, reden: 'geen-document' };

  const { showLoading, hideLoading } = await import('../ui/chrome/dialogs.js');
  showLoading(t('redactTitle'));
  try {
    // Every page's annotations in the model first: the reload below treats
    // the model as the truth for every page.
    const { laadAlleAnnotaties, huidigeBytes } = await import('../pdf/flatten-all.js');
    if (!(await laadAlleAnnotaties(doc))) throw new Error('annotations not loaded');
    const oudeBytes = await huidigeBytes(doc);
    if (!oudeBytes) throw new Error('no document bytes');
    const { PDFDocument } = await import('pdf-lib');
    const { redactDocument } = await import('../pdf/redaction/apply.js');
    const { marksFromAnnotations, boundsTouchMarks, ocrWordTouches } = await import('../pdf/redaction/marks.js');
    const pdf = await PDFDocument.load(oudeBytes.slice(), { updateMetadata: false });
    const pdfPages = pdf.getPages();
    const pageInfo = (pageNum) => {
      const p = pdfPages[pageNum - 1];
      if (!p) return null;
      const rot = (((p.getRotation().angle + (doc.pageRotations?.[pageNum] || 0)) % 360) + 360) % 360;
      return { rotation: rot, cropBox: p.getCropBox() };
    };
    const { marks, invalid } = marksFromAnnotations(marksModel, pageInfo);
    if (invalid.length) throw Object.assign(new Error('REDACTION_INVALID_AREA'), { code: 'REDACTION_INVALID_AREA' });
    const stats = await redactDocument(pdf, marks, { overlay: true, annotations: true, pending: true });
    const nieuweBytes = new Uint8Array(await pdf.save());
    if (!state.documents.includes(doc)) return { ok: false, reden: 'geen-document' };

    // The model: the marks are applied; other annotations under them are gone.
    const { annotationBounds } = await import('./spatial-index.js');
    const marksByPage = new Map();
    for (const m of marksModel) { if (!marksByPage.has(m.page)) marksByPage.set(m.page, []); marksByPage.get(m.page).push(m); }
    const applied = new Set(marksModel);
    const oudeAnnotaties = doc.annotations.map((a) => ({ ...a }));
    const nieuweAnnotaties = doc.annotations.filter((a) => {
      if (applied.has(a)) return false;
      const pm = marksByPage.get(a.page);
      if (!pm) return true;
      let b = null;
      try { b = annotationBounds(a); } catch { b = null; }
      // Without bounds the annotation cannot be shown to be clear of the marks.
      if (!b) return false;
      return !boundsTouchMarks(b, pm);
    }).map((a) => ({ ...a }));
    // Recognised (OCR) words under the marks would be written again at save.
    if (doc.ocrResults) {
      for (const pageNum of pages) {
        const words = doc.ocrResults[pageNum];
        const p = pdfPages[pageNum - 1];
        if (!Array.isArray(words) || !p) continue;
        const quads = marks.filter((m) => m.pageIndex === pageNum - 1).map((m) => m.quad);
        doc.ocrResults[pageNum] = words.filter((w) => !ocrWordTouches(w, p.getCropBox(), quads));
      }
    }
    const rotaties = { ...(doc.pageRotations || {}) };
    const pagina = doc.currentPage || 1;
    const { reloadFromBytes } = await import('../pdf/page-manager.js');
    await reloadFromBytes(nieuweBytes, nieuweAnnotaties, rotaties, pagina, null, doc);
    const { recordPageStructure } = await import('../core/undo-manager.js');
    recordPageStructure(oudeBytes, oudeAnnotaties, rotaties, pagina, nieuweBytes, nieuweAnnotaties, rotaties, pagina);
    hideLoading();
    showMessage(t('redactDone', { count: marks.length }));
    return { ok: true, stats };
  } catch (e) {
    console.error('[redaction] not applied:', e);
    hideLoading();
    showMessage(t('redactNotApplied', { reason: reasonText(e) }));
    return { ok: false, reden: 'fout', fout: e?.code || e?.message || String(e) };
  } finally {
    hideLoading();
  }
}

/** Apply the redaction marks on the current page. */
export async function applyRedactions() {
  return runRedactions({ all: false });
}

/** Apply the redaction marks on every page. */
export async function applyAllRedactions() {
  return runRedactions({ all: true });
}
