// OCR (Optical Character Recognition) orchestration: runs the preferred OCR
// engine (ocr-engines.js: an extension's or the built-in ocr_pdf_page Tauri
// command) across a document's pages and stores the results on the
// document so saver.js can write them out as an invisible, searchable text
// layer next time the file is saved (see saver/ocr-text-layer.js).
import { state, getActiveDocument } from '../core/state.js';
import { recordOcrPage, recordOcrPages } from '../core/undo-manager.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import {
  startPrintProgress, updatePrintProgress, finishPrintProgress, failPrintProgress, sluitPrintProgress,
} from '../solid/stores/printProgressStore.js';
import i18next from '../i18n/config.js';
import { herkenPagina } from './ocr-engines.js';

// De voorkeursengine: die van een extensie of de ingebouwde Tesseract
// (ocr-engines.js, #970).
async function ocrOnePage(doc, pageIndex, lang) {
  return await herkenPagina(doc, pageIndex + 1, { lang });
}

/** OCR the current page only. `lang`: a Tesseract language spec (e.g.
 *  'eng', 'chi_tra+eng') or 'auto' (default) to detect each page's script
 *  and pick automatically — see src-tauri/src/ocr.rs's detect_page_lang. */
export async function ocrCurrentPage(lang = 'auto') {
  const doc = getActiveDocument();
  if (!doc || !doc.filePath || !doc.pdfDoc) return;
  const pageIndex = doc.currentPage - 1;
  const pdf = doc.pdfDoc, path = doc.filePath;

  startPrintProgress(i18next.t('ocr.progress.page', { ns: 'statusbar', page: doc.currentPage }) || `Recognizing text on page ${doc.currentPage}...`);
  try {
    const words = await ocrOnePage(doc, pageIndex, lang);
    // A page/tab switch is harmless; replacing or closing the source is not.
    if (!state.documents.includes(doc) || doc.pdfDoc !== pdf || doc.filePath !== path) {
      sluitPrintProgress();
      return;
    }
    const oldWords = JSON.parse(JSON.stringify(doc.ocrResults[pageIndex + 1] || []));
    doc.ocrResults[pageIndex + 1] = words;
    recordOcrPage(doc, pageIndex + 1, oldWords, words);
    markDocumentModified(doc);
    finishPrintProgress(i18next.t('ocr.progress.done', { ns: 'statusbar', count: words.length }) || `Recognized ${words.length} words`);
  } catch (e) {
    console.warn('OCR failed:', e);
    failPrintProgress(i18next.t('ocr.progress.failed', { ns: 'statusbar' }) || 'Text recognition failed');
  }
}

/** OCR every page of the current document. `lang`: see ocrCurrentPage —
 *  'auto' (default) detects each page's script independently, so a
 *  document that mixes English-only and Chinese pages gets the right
 *  recognition model per page rather than one language for the whole run. */
export async function ocrAllPages(lang = 'auto') {
  const doc = getActiveDocument();
  if (!doc || !doc.filePath || !doc.pdfDoc) return;
  const total = doc.pdfDoc.numPages || 1;
  const pdf = doc.pdfDoc, path = doc.filePath;

  startPrintProgress(i18next.t('ocr.progress.starting', { ns: 'statusbar' }) || 'Recognizing text...');
  let totalWords = 0;
  // One undo step for the whole run, also when a later page fails.
  const changes = [];
  try {
    for (let i = 0; i < total; i++) {
      const pageNum = i + 1;
      updatePrintProgress(
        i18next.t('ocr.progress.page', { ns: 'statusbar', page: pageNum }) || `Recognizing text on page ${pageNum}...`,
        i / total,
      );
      const words = await ocrOnePage(doc, i, lang);
      if (!state.documents.includes(doc) || doc.pdfDoc !== pdf || doc.filePath !== path) {
        sluitPrintProgress();
        return;
      }
      const oldWords = JSON.parse(JSON.stringify(doc.ocrResults[pageNum] || []));
      doc.ocrResults[pageNum] = words;
      changes.push({ page: pageNum, oldWords, newWords: words });
      // Keep successful pages dirty even if a later page fails.
      markDocumentModified(doc);
      totalWords += words.length;
    }
    finishPrintProgress(i18next.t('ocr.progress.doneAll', { ns: 'statusbar', pages: total, count: totalWords }) || `Recognized ${totalWords} words across ${total} pages`);
  } catch (e) {
    console.warn('OCR failed:', e);
    failPrintProgress(i18next.t('ocr.progress.failed', { ns: 'statusbar' }) || 'Text recognition failed');
  } finally {
    if (changes.length) recordOcrPages(doc, changes);
  }
}

/** Whether the current document has any unsaved OCR results (Format/Organize tab UI hook). */
export function hasOcrResults() {
  const doc = getActiveDocument();
  return !!(doc && doc.ocrResults && Object.keys(doc.ocrResults).length > 0);
}
