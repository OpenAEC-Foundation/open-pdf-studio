import { state } from '../../core/state.js';
import { isTauri } from '../../core/platform.js';
import { openDialog, closeDialog } from '../../solid/stores/dialogStore.js';
import { openBackstage, setActivePanel } from '../../solid/stores/backstageStore.js';
import { setVisible, setMessage } from '../../solid/stores/loadingStore.js';

// Show loading overlay
export function showLoading(message = 'Loading...') {
  setMessage(message);
  setVisible(true);
}

// Hide loading overlay
export function hideLoading() {
  setVisible(false);
}

// ============================================
// About Panel (bridge to Solid backstage)
// ============================================

export function showAboutPanel() {
  openBackstage();
  setActivePanel('about');
}

// ============================================
// Document Properties Dialog (Solid.js)
// ============================================

export async function showDocPropertiesDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }

  const data = await gatherDocProperties();
  openDialog('doc-properties', data);
}

export function hideDocPropertiesDialog() {
  closeDialog('doc-properties');
}

async function gatherDocProperties() {
  const filePath = state.currentPdfPath || '-';
  const fileName = filePath !== '-' ? filePath.split(/[\\/]/).pop() : '-';

  let fileSize = '-';
  if (filePath !== '-' && isTauri() && window.__TAURI__?.fs) {
    try {
      const stats = await window.__TAURI__.fs.stat(filePath);
      fileSize = formatFileSize(stats.size);
    } catch (e) {
      fileSize = '-';
    }
  }

  let title = '-', author = '-', subject = '-', keywords = '-';
  let creator = '-', producer = '-', pdfVersion = '-';
  let created = '-', modified = '-';

  try {
    const metadata = await state.pdfDoc.getMetadata();
    const info = metadata.info || {};
    title = info.Title || '-';
    author = info.Author || '-';
    subject = info.Subject || '-';
    keywords = info.Keywords || '-';
    creator = info.Creator || '-';
    producer = info.Producer || '-';
    pdfVersion = info.PDFFormatVersion || '-';
    created = formatPdfDate(info.CreationDate) || '-';
    modified = formatPdfDate(info.ModDate) || '-';
  } catch (e) {
    console.error('Error getting PDF metadata:', e);
  }

  const pageCount = state.pdfDoc.numPages || '-';

  let pageSize = '-';
  try {
    const page = await state.pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const widthMm = (viewport.width / 72 * 25.4).toFixed(1);
    const heightMm = (viewport.height / 72 * 25.4).toFixed(1);
    pageSize = `${viewport.width.toFixed(0)} x ${viewport.height.toFixed(0)} pts (${widthMm} x ${heightMm} mm)`;
  } catch (e) {
    // keep '-'
  }

  return {
    fileName, filePath, fileSize,
    title, author, subject, keywords, creator, producer,
    pdfVersion, pageCount, pageSize, created, modified,
  };
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatPdfDate(pdfDate) {
  if (!pdfDate) return null;
  try {
    if (typeof pdfDate === 'string' && pdfDate.startsWith('D:')) {
      const dateStr = pdfDate.substring(2);
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6) || '01';
      const day = dateStr.substring(6, 8) || '01';
      const hour = dateStr.substring(8, 10) || '00';
      const min = dateStr.substring(10, 12) || '00';
      const sec = dateStr.substring(12, 14) || '00';
      const date = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`);
      return date.toLocaleString();
    }
    return pdfDate;
  } catch (e) {
    return pdfDate;
  }
}

// ============================================
// New Document Dialog (Solid.js)
// ============================================

export function showNewDocDialog() {
  openDialog('new-doc');
}

export function hideNewDocDialog() {
  closeDialog('new-doc');
}

// ============================================
// Insert Page Dialog (Solid.js)
// ============================================

export function showInsertPageDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }
  openDialog('insert-page');
}

export function hideInsertPageDialog() {
  closeDialog('insert-page');
}

// ============================================
// Extract Pages Dialog (Solid.js)
// ============================================

export function showExtractPagesDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }
  openDialog('extract-pages', {
    currentPage: state.currentPage,
    totalPages: state.pdfDoc.numPages,
  });
}

export function hideExtractPagesDialog() {
  closeDialog('extract-pages');
}

// ============================================
// Merge PDFs Dialog (Solid.js)
// ============================================

export function showMergePdfsDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }
  openDialog('merge-pdfs');
}

export function hideMergePdfsDialog() {
  closeDialog('merge-pdfs');
}

// ============================================
// Print Dialog (Solid.js)
// ============================================

export function showPrintDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }
  openDialog('print', { currentPage: state.currentPage });
}

export function hidePrintDialog() {
  closeDialog('print');
}

// ============================================
// Page Setup Dialog (Solid.js)
// ============================================

export function showPageSetupDialog() {
  openDialog('page-setup');
}

export function hidePageSetupDialog() {
  closeDialog('page-setup');
}

export { getPageSetupSettings } from '../../solid/components/dialogs/PageSetupDialog.jsx';

