// OCR (Optical Character Recognition) orchestration: runs the ocr_pdf_page
// Tauri command across a document's pages and stores the results on the
// document so saver.js can write them out as an invisible, searchable text
// layer next time the file is saved (see saver/ocr-text-layer.js).
import { getActiveDocument } from '../core/state.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import {
  startPrintProgress, updatePrintProgress, finishPrintProgress, failPrintProgress,
} from '../solid/stores/printProgressStore.js';
import i18next from '../i18n/config.js';

function tauri() {
  return window.__TAURI__ || {};
}

async function ocrOnePage(filePath, pageIndex, lang) {
  return await tauri().core.invoke('ocr_pdf_page', { path: filePath, pageIndex, lang });
}

/** OCR the current page only. */
export async function ocrCurrentPage(lang = 'chi_tra+eng') {
  const doc = getActiveDocument();
  if (!doc || !doc.filePath || !doc.pdfDoc) return;
  const pageIndex = doc.currentPage - 1;

  startPrintProgress(i18next.t('ocr.progress.page', { ns: 'statusbar', page: doc.currentPage }) || `Recognizing text on page ${doc.currentPage}...`);
  try {
    const words = await ocrOnePage(doc.filePath, pageIndex, lang);
    doc.ocrResults[doc.currentPage] = words;
    markDocumentModified();
    finishPrintProgress(i18next.t('ocr.progress.done', { ns: 'statusbar', count: words.length }) || `Recognized ${words.length} words`);
  } catch (e) {
    console.warn('OCR failed:', e);
    failPrintProgress(i18next.t('ocr.progress.failed', { ns: 'statusbar' }) || 'Text recognition failed');
  }
}

/** OCR every page of the current document. */
export async function ocrAllPages(lang = 'chi_tra+eng') {
  const doc = getActiveDocument();
  if (!doc || !doc.filePath || !doc.pdfDoc) return;
  const total = doc.pdfDoc.numPages || 1;

  startPrintProgress(i18next.t('ocr.progress.starting', { ns: 'statusbar' }) || 'Recognizing text...');
  let totalWords = 0;
  try {
    for (let i = 0; i < total; i++) {
      const pageNum = i + 1;
      updatePrintProgress(
        i18next.t('ocr.progress.page', { ns: 'statusbar', page: pageNum }) || `Recognizing text on page ${pageNum}...`,
        i / total,
      );
      const words = await ocrOnePage(doc.filePath, i, lang);
      doc.ocrResults[pageNum] = words;
      totalWords += words.length;
    }
    markDocumentModified();
    finishPrintProgress(i18next.t('ocr.progress.doneAll', { ns: 'statusbar', pages: total, count: totalWords }) || `Recognized ${totalWords} words across ${total} pages`);
  } catch (e) {
    console.warn('OCR failed:', e);
    failPrintProgress(i18next.t('ocr.progress.failed', { ns: 'statusbar' }) || 'Text recognition failed');
  }
}

/** Whether the current document has any unsaved OCR results (Format/Organize tab UI hook). */
export function hasOcrResults() {
  const doc = getActiveDocument();
  return !!(doc && doc.ocrResults && Object.keys(doc.ocrResults).length > 0);
}
