import { loadingOverlay, loadingText } from '../dom-elements.js';
import { state, getPageRotation } from '../../core/state.js';
import { openExternal, getAppVersion, isTauri, invoke, writeBinaryFile } from '../../core/platform.js';
import { createBlankPDF } from '../../pdf/loader.js';
import { exportAsImages, exportAsRasterPdf, parsePageRange, renderPageOffscreen, canvasToBytes } from '../../pdf/exporter.js';
import { insertBlankPages, extractPages, mergeFiles } from '../../pdf/page-manager.js';
import { PDFDocument } from 'pdf-lib';

// Show loading overlay
export function showLoading(message = 'Loading...') {
  if (loadingText) {
    loadingText.textContent = message;
  }
  if (loadingOverlay) {
    loadingOverlay.classList.add('visible');
  }
}

// Hide loading overlay
export function hideLoading() {
  if (loadingOverlay) {
    loadingOverlay.classList.remove('visible');
  }
}

// ============================================
// About Panel (backstage right-side content)
// ============================================

export function showAboutPanel() {
  const panel = document.getElementById('bs-about-panel');
  if (panel) panel.style.display = '';
  // Highlight About sidebar item
  document.querySelectorAll('.backstage-item').forEach(i => i.classList.remove('active'));
  document.getElementById('bs-about')?.classList.add('active');
}

export function hideAboutPanel() {
  const panel = document.getElementById('bs-about-panel');
  if (panel) panel.style.display = 'none';
  document.getElementById('bs-about')?.classList.remove('active');
}

// Initialize about panel
export async function initAboutDialog() {
  // Populate version from Tauri config
  const version = await getAppVersion();
  const versionEl = document.getElementById('bs-about-version');
  if (versionEl && version) {
    versionEl.textContent = `Version ${version}`;
  }

  // Website link
  const websiteLink = document.getElementById('bs-about-website-link');
  if (websiteLink) {
    websiteLink.addEventListener('click', (e) => {
      e.preventDefault();
      openExternal('https://impertio.nl/');
    });
  }

  // Contact link
  const emailLink = document.getElementById('bs-about-email-link');
  if (emailLink) {
    emailLink.addEventListener('click', (e) => {
      e.preventDefault();
      openExternal('mailto:maarten@impertio.nl');
    });
  }
}

// Document Properties Dialog
const docPropsDialog = document.getElementById('doc-props-dialog');

// Show document properties dialog
export async function showDocPropertiesDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }

  // Populate the dialog with document information
  await populateDocProperties();

  if (docPropsDialog) {
    docPropsDialog.classList.add('visible');
  }
}

// Hide document properties dialog
export function hideDocPropertiesDialog() {
  if (docPropsDialog) {
    docPropsDialog.classList.remove('visible');
  }
}

// Populate document properties
async function populateDocProperties() {
  const fs = window.require('fs');
  const path = window.require('path');

  // File information
  const filePath = state.currentPdfPath || '-';
  const fileName = filePath !== '-' ? path.basename(filePath) : '-';

  let fileSize = '-';
  if (filePath !== '-') {
    try {
      const stats = fs.statSync(filePath);
      fileSize = formatFileSize(stats.size);
    } catch (e) {
      fileSize = '-';
    }
  }

  document.getElementById('doc-prop-filename').textContent = fileName;
  document.getElementById('doc-prop-filepath').textContent = filePath;
  document.getElementById('doc-prop-filesize').textContent = fileSize;

  // PDF metadata
  try {
    const metadata = await state.pdfDoc.getMetadata();
    const info = metadata.info || {};

    document.getElementById('doc-prop-title').textContent = info.Title || '-';
    document.getElementById('doc-prop-author').textContent = info.Author || '-';
    document.getElementById('doc-prop-subject').textContent = info.Subject || '-';
    document.getElementById('doc-prop-keywords').textContent = info.Keywords || '-';
    document.getElementById('doc-prop-creator').textContent = info.Creator || '-';
    document.getElementById('doc-prop-producer').textContent = info.Producer || '-';
    document.getElementById('doc-prop-pdfversion').textContent = info.PDFFormatVersion || '-';
    document.getElementById('doc-prop-created').textContent = formatPdfDate(info.CreationDate) || '-';
    document.getElementById('doc-prop-modified').textContent = formatPdfDate(info.ModDate) || '-';
  } catch (e) {
    console.error('Error getting PDF metadata:', e);
  }

  // Page information
  document.getElementById('doc-prop-pagecount').textContent = state.pdfDoc.numPages || '-';

  // Get first page size
  try {
    const page = await state.pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const widthInches = (viewport.width / 72).toFixed(2);
    const heightInches = (viewport.height / 72).toFixed(2);
    const widthMm = (viewport.width / 72 * 25.4).toFixed(1);
    const heightMm = (viewport.height / 72 * 25.4).toFixed(1);
    document.getElementById('doc-prop-pagesize').textContent =
      `${viewport.width.toFixed(0)} x ${viewport.height.toFixed(0)} pts (${widthMm} x ${heightMm} mm)`;
  } catch (e) {
    document.getElementById('doc-prop-pagesize').textContent = '-';
  }
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format PDF date string
function formatPdfDate(pdfDate) {
  if (!pdfDate) return null;
  try {
    // PDF date format: D:YYYYMMDDHHmmSS or similar
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

// Initialize document properties dialog
export function initDocPropertiesDialog() {
  const closeBtn = document.getElementById('doc-props-close-btn');
  const okBtn = document.getElementById('doc-props-ok-btn');

  if (closeBtn) {
    closeBtn.addEventListener('click', hideDocPropertiesDialog);
  }

  if (okBtn) {
    okBtn.addEventListener('click', hideDocPropertiesDialog);
  }

  // Make dialog draggable by header
  initDocPropsDialogDrag();

  // Close with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && docPropsDialog?.classList.contains('visible')) {
      hideDocPropertiesDialog();
    }
  });
}

// ============================================
// New Document Dialog
// ============================================

const PAPER_SIZES = {
  // ISO A series (sorted largest to smallest)
  a0:     { width: 2384, height: 3370, label: 'A0', widthMm: 841, heightMm: 1189 },
  a1:     { width: 1684, height: 2384, label: 'A1', widthMm: 594, heightMm: 841 },
  a2:     { width: 1191, height: 1684, label: 'A2', widthMm: 420, heightMm: 594 },
  a3:     { width: 842,  height: 1191, label: 'A3', widthMm: 297, heightMm: 420 },
  a4:     { width: 595,  height: 842,  label: 'A4', widthMm: 210, heightMm: 297 },
  a5:     { width: 420,  height: 595,  label: 'A5', widthMm: 148, heightMm: 210 },
  a6:     { width: 298,  height: 420,  label: 'A6', widthMm: 105, heightMm: 148 },
  // ISO B series
  b3:     { width: 1001, height: 1417, label: 'B3', widthMm: 353, heightMm: 500 },
  b4:     { width: 709,  height: 1001, label: 'B4', widthMm: 250, heightMm: 353 },
  b5:     { width: 499,  height: 709,  label: 'B5', widthMm: 176, heightMm: 250 },
  // North American sizes
  letter: { width: 612,  height: 792,  label: 'Letter', widthMm: 216, heightMm: 279 },
  legal:  { width: 612,  height: 1008, label: 'Legal', widthMm: 216, heightMm: 356 },
  tabloid:{ width: 792,  height: 1224, label: 'Tabloid', widthMm: 279, heightMm: 432 },
  ledger: { width: 1224, height: 792,  label: 'Ledger', widthMm: 432, heightMm: 279 },
};

const newDocDialog = document.getElementById('new-doc-dialog');

export function showNewDocDialog() {
  if (!newDocDialog) return;

  // Reset to defaults
  const paperSelect = document.getElementById('new-doc-paper-size');
  if (paperSelect) paperSelect.value = 'a4';

  const customRow = document.getElementById('new-doc-custom-row');
  if (customRow) customRow.style.display = 'none';

  const customWidth = document.getElementById('new-doc-custom-width');
  const customHeight = document.getElementById('new-doc-custom-height');
  if (customWidth) customWidth.value = '210';
  if (customHeight) customHeight.value = '297';

  const portraitRadio = document.querySelector('input[name="new-doc-orientation"][value="portrait"]');
  if (portraitRadio) portraitRadio.checked = true;

  const pagesInput = document.getElementById('new-doc-pages');
  if (pagesInput) pagesInput.value = '1';

  updateNewDocPreview();

  // Reset dialog position to center
  const dialog = newDocDialog.querySelector('.new-doc-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.position = 'absolute';
  }

  newDocDialog.classList.add('visible');
}

export function hideNewDocDialog() {
  if (newDocDialog) {
    newDocDialog.classList.remove('visible');
  }
}

function getNewDocDimensions() {
  const paperSelect = document.getElementById('new-doc-paper-size');
  const orientation = document.querySelector('input[name="new-doc-orientation"]:checked')?.value || 'portrait';

  let widthPt, heightPt, widthMm, heightMm, label;

  if (paperSelect?.value === 'custom') {
    widthMm = parseFloat(document.getElementById('new-doc-custom-width')?.value) || 210;
    heightMm = parseFloat(document.getElementById('new-doc-custom-height')?.value) || 297;
    widthPt = widthMm / 25.4 * 72;
    heightPt = heightMm / 25.4 * 72;
    label = 'Custom';
  } else {
    const size = PAPER_SIZES[paperSelect?.value || 'a4'];
    widthPt = size.width;
    heightPt = size.height;
    widthMm = size.widthMm;
    heightMm = size.heightMm;
    label = size.label;
  }

  if (orientation === 'landscape') {
    [widthPt, heightPt] = [heightPt, widthPt];
    [widthMm, heightMm] = [heightMm, widthMm];
  }

  return { widthPt, heightPt, widthMm, heightMm, label };
}

function updateNewDocPreview() {
  const { widthMm, heightMm, label } = getNewDocDimensions();

  const previewPage = document.getElementById('new-doc-preview-page');
  const previewText = document.getElementById('new-doc-preview-text');

  if (previewPage) {
    const maxW = 100;
    const maxH = 130;
    const aspect = widthMm / heightMm;

    let displayW, displayH;
    if (aspect > maxW / maxH) {
      displayW = maxW;
      displayH = maxW / aspect;
    } else {
      displayH = maxH;
      displayW = maxH * aspect;
    }

    previewPage.style.width = displayW + 'px';
    previewPage.style.height = displayH + 'px';
  }

  if (previewText) {
    previewText.textContent = `${Math.round(widthMm)} x ${Math.round(heightMm)} mm (${label})`;
  }
}

export function initNewDocDialog() {
  if (!newDocDialog) return;

  const closeBtn = document.getElementById('new-doc-close-btn');
  const cancelBtn = document.getElementById('new-doc-cancel-btn');
  const okBtn = document.getElementById('new-doc-ok-btn');
  const paperSelect = document.getElementById('new-doc-paper-size');
  const customWidth = document.getElementById('new-doc-custom-width');
  const customHeight = document.getElementById('new-doc-custom-height');

  if (closeBtn) closeBtn.addEventListener('click', hideNewDocDialog);
  if (cancelBtn) cancelBtn.addEventListener('click', hideNewDocDialog);

  if (okBtn) {
    okBtn.addEventListener('click', async () => {
      const { widthPt, heightPt } = getNewDocDimensions();
      const numPages = parseInt(document.getElementById('new-doc-pages')?.value) || 1;
      hideNewDocDialog();
      await createBlankPDF(widthPt, heightPt, Math.max(1, Math.min(999, numPages)));
    });
  }

  if (paperSelect) {
    paperSelect.addEventListener('change', () => {
      const customRow = document.getElementById('new-doc-custom-row');
      if (customRow) {
        customRow.style.display = paperSelect.value === 'custom' ? 'flex' : 'none';
      }
      updateNewDocPreview();
    });
  }

  // Orientation radio change
  document.querySelectorAll('input[name="new-doc-orientation"]').forEach(radio => {
    radio.addEventListener('change', updateNewDocPreview);
  });

  // Custom dimension inputs
  if (customWidth) customWidth.addEventListener('input', updateNewDocPreview);
  if (customHeight) customHeight.addEventListener('input', updateNewDocPreview);

  // Make dialog draggable by header
  initNewDocDialogDrag();

  // Close with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && newDocDialog?.classList.contains('visible')) {
      hideNewDocDialog();
    }
  });
}

function initNewDocDialogDrag() {
  if (!newDocDialog) return;

  const dialog = newDocDialog.querySelector('.new-doc-dialog');
  const header = newDocDialog.querySelector('.new-doc-header');
  if (!dialog || !header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.new-doc-close-btn')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const overlayRect = newDocDialog.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;

    const dialogRect = dialog.getBoundingClientRect();
    const maxX = overlayRect.width - dialogRect.width;
    const maxY = overlayRect.height - dialogRect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
    dialog.style.position = 'absolute';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// Initialize document properties dialog drag functionality
function initDocPropsDialogDrag() {
  if (!docPropsDialog) return;

  const dialog = docPropsDialog.querySelector('.doc-props-dialog');
  const header = docPropsDialog.querySelector('.doc-props-header');
  if (!dialog || !header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    // Don't start drag if clicking on close button
    if (e.target.closest('.doc-props-close-btn')) return;

    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const overlayRect = docPropsDialog.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;

    // Constrain to overlay bounds
    const dialogRect = dialog.getBoundingClientRect();
    const maxX = overlayRect.width - dialogRect.width;
    const maxY = overlayRect.height - dialogRect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
    dialog.style.position = 'absolute';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// ============================================
// Export Panel (backstage right-side content)
// ============================================

let bsExportType = 'images'; // 'images' or 'raster'

export function showExportPanel() {
  const panel = document.getElementById('bs-export-panel');
  if (panel) {
    panel.style.display = '';
    // Reset: show cards, hide options
    const options = document.getElementById('bs-export-options');
    if (options) options.style.display = 'none';
    // Remove active state from cards
    document.querySelectorAll('.bs-export-card').forEach(c => c.classList.remove('active'));
  }
  // Highlight Export sidebar item
  document.querySelectorAll('.backstage-item').forEach(i => i.classList.remove('active'));
  document.getElementById('bs-export')?.classList.add('active');
}

export function hideExportPanel() {
  const panel = document.getElementById('bs-export-panel');
  if (panel) panel.style.display = 'none';
  document.getElementById('bs-export')?.classList.remove('active');
}

function showExportOptions(type) {
  bsExportType = type;

  // Highlight selected card
  document.querySelectorAll('.bs-export-card').forEach(c => c.classList.remove('active'));
  if (type === 'images') {
    document.getElementById('bs-export-images-card')?.classList.add('active');
  } else {
    document.getElementById('bs-export-raster-card')?.classList.add('active');
  }

  // Set options title
  const titleEl = document.getElementById('bs-export-options-title');
  if (titleEl) {
    titleEl.textContent = type === 'raster' ? 'Raster PDF Options' : 'Image Export Options';
  }

  // Show/hide format group (only for images)
  const formatGroup = document.getElementById('bs-export-format-group');
  if (formatGroup) formatGroup.style.display = type === 'raster' ? 'none' : '';

  // Hide quality group
  const qualityGroup = document.getElementById('bs-export-quality-group');
  if (qualityGroup) qualityGroup.style.display = 'none';

  // Reset format
  const formatSelect = document.getElementById('bs-export-format');
  if (formatSelect) formatSelect.value = 'png';

  // Reset page range
  const allRadio = document.querySelector('input[name="bs-export-page-range"][value="all"]');
  if (allRadio) allRadio.checked = true;
  const customInput = document.getElementById('bs-export-custom-pages');
  if (customInput) { customInput.disabled = true; customInput.value = ''; }

  // Set DPI default
  const dpiSelect = document.getElementById('bs-export-dpi');
  if (dpiSelect) dpiSelect.value = type === 'raster' ? '300' : '150';

  // Show options
  const options = document.getElementById('bs-export-options');
  if (options) options.style.display = '';
}

function getBsExportPages() {
  const rangeValue = document.querySelector('input[name="bs-export-page-range"]:checked')?.value;
  const totalPages = state.pdfDoc.numPages;

  if (rangeValue === 'current') {
    return [state.currentPage];
  } else if (rangeValue === 'custom') {
    const customStr = document.getElementById('bs-export-custom-pages')?.value || '';
    const pages = parsePageRange(customStr, totalPages);
    if (pages.length === 0) {
      alert('Invalid page range. Please enter valid page numbers.');
      return null;
    }
    return pages;
  } else {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }
}

async function doBsExport() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }

  const pages = getBsExportPages();
  if (!pages) return;

  const dpi = parseInt(document.getElementById('bs-export-dpi')?.value) || 150;

  // Close backstage
  const { closeBackstage } = await import('../chrome/menus.js');
  closeBackstage();

  if (bsExportType === 'raster') {
    await exportAsRasterPdf({ dpi, pages });
  } else {
    const format = document.getElementById('bs-export-format')?.value || 'png';
    const quality = (parseInt(document.getElementById('bs-export-quality')?.value) || 92) / 100;
    await exportAsImages({ format, quality, dpi, pages });
  }
}

export function initExportDialog() {
  // Export cards
  document.getElementById('bs-export-images-card')?.addEventListener('click', () => {
    showExportOptions('images');
  });
  document.getElementById('bs-export-raster-card')?.addEventListener('click', () => {
    showExportOptions('raster');
  });

  // Export go button
  document.getElementById('bs-export-go-btn')?.addEventListener('click', doBsExport);

  // Page range radio buttons
  document.querySelectorAll('input[name="bs-export-page-range"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const customInput = document.getElementById('bs-export-custom-pages');
      if (customInput) {
        customInput.disabled = radio.value !== 'custom';
        if (radio.value === 'custom') customInput.focus();
      }
    });
  });

  // Format select — show/hide quality group
  const formatSelect = document.getElementById('bs-export-format');
  if (formatSelect) {
    formatSelect.addEventListener('change', () => {
      const qualityGroup = document.getElementById('bs-export-quality-group');
      if (qualityGroup) {
        qualityGroup.style.display = formatSelect.value === 'jpeg' ? '' : 'none';
      }
    });
  }

  // Quality slider label
  const qualitySlider = document.getElementById('bs-export-quality');
  const qualityValue = document.getElementById('bs-export-quality-value');
  if (qualitySlider && qualityValue) {
    qualitySlider.addEventListener('input', () => {
      qualityValue.textContent = qualitySlider.value + '%';
    });
  }
}

// ============================================
// Insert Page Dialog
// ============================================

const insertPageDialog = document.getElementById('insert-page-dialog');

export function showInsertPageDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }
  if (!insertPageDialog) return;

  // Reset to defaults
  const posSelect = document.getElementById('insert-page-position');
  if (posSelect) posSelect.value = 'after';

  const countInput = document.getElementById('insert-page-count');
  if (countInput) countInput.value = '1';

  const paperSelect = document.getElementById('insert-page-paper-size');
  if (paperSelect) paperSelect.value = 'current';

  // Reset dialog position to center
  const dialog = insertPageDialog.querySelector('.insert-page-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.position = 'absolute';
  }

  insertPageDialog.classList.add('visible');
}

export function hideInsertPageDialog() {
  if (insertPageDialog) {
    insertPageDialog.classList.remove('visible');
  }
}

async function getInsertPageDimensions() {
  const paperSelect = document.getElementById('insert-page-paper-size');
  const value = paperSelect?.value || 'current';

  if (value === 'current') {
    const page = await state.pdfDoc.getPage(state.currentPage);
    const vp = page.getViewport({ scale: 1 });
    return { widthPt: vp.width, heightPt: vp.height };
  }

  const size = PAPER_SIZES[value];
  if (size) {
    return { widthPt: size.width, heightPt: size.height };
  }

  return { widthPt: 595, heightPt: 842 }; // A4 fallback
}

export function initInsertPageDialog() {
  if (!insertPageDialog) return;

  const closeBtn = document.getElementById('insert-page-close-btn');
  const cancelBtn = document.getElementById('insert-page-cancel-btn');
  const okBtn = document.getElementById('insert-page-ok-btn');

  if (closeBtn) closeBtn.addEventListener('click', hideInsertPageDialog);
  if (cancelBtn) cancelBtn.addEventListener('click', hideInsertPageDialog);

  if (okBtn) {
    okBtn.addEventListener('click', async () => {
      const position = document.getElementById('insert-page-position')?.value || 'after';
      const count = Math.max(1, Math.min(100, parseInt(document.getElementById('insert-page-count')?.value) || 1));
      const { widthPt, heightPt } = await getInsertPageDimensions();

      hideInsertPageDialog();
      await insertBlankPages(position, state.currentPage, count, widthPt, heightPt);
    });
  }

  // Make dialog draggable
  initInsertPageDialogDrag();

  // Close with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && insertPageDialog?.classList.contains('visible')) {
      hideInsertPageDialog();
    }
  });
}

function initInsertPageDialogDrag() {
  if (!insertPageDialog) return;

  const dialog = insertPageDialog.querySelector('.insert-page-dialog');
  const header = insertPageDialog.querySelector('.insert-page-header');
  if (!dialog || !header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.insert-page-close-btn')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const overlayRect = insertPageDialog.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;
    const dialogRect = dialog.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, overlayRect.width - dialogRect.width));
    newY = Math.max(0, Math.min(newY, overlayRect.height - dialogRect.height));
    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
    dialog.style.position = 'absolute';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// ============================================
// Extract Pages Dialog
// ============================================

const extractPagesDialog = document.getElementById('extract-pages-dialog');

export function showExtractPagesDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }
  if (!extractPagesDialog) return;

  // Default range to current page
  const rangeInput = document.getElementById('extract-pages-range');
  if (rangeInput) rangeInput.value = String(state.currentPage);

  const deleteCheckbox = document.getElementById('extract-pages-delete');
  if (deleteCheckbox) deleteCheckbox.checked = false;

  // Update info text
  updateExtractPagesInfo();

  // Reset dialog position to center
  const dialog = extractPagesDialog.querySelector('.extract-pages-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.position = 'absolute';
  }

  extractPagesDialog.classList.add('visible');
}

export function hideExtractPagesDialog() {
  if (extractPagesDialog) {
    extractPagesDialog.classList.remove('visible');
  }
}

function updateExtractPagesInfo() {
  const info = document.getElementById('extract-pages-info');
  if (!info || !state.pdfDoc) return;
  info.textContent = `Document has ${state.pdfDoc.numPages} pages.`;
}

export function initExtractPagesDialog() {
  if (!extractPagesDialog) return;

  const closeBtn = document.getElementById('extract-pages-close-btn');
  const cancelBtn = document.getElementById('extract-pages-cancel-btn');
  const okBtn = document.getElementById('extract-pages-ok-btn');

  if (closeBtn) closeBtn.addEventListener('click', hideExtractPagesDialog);
  if (cancelBtn) cancelBtn.addEventListener('click', hideExtractPagesDialog);

  if (okBtn) {
    okBtn.addEventListener('click', async () => {
      const rangeStr = document.getElementById('extract-pages-range')?.value || '';
      const totalPages = state.pdfDoc?.numPages || 0;
      const pages = parsePageRange(rangeStr, totalPages);

      if (pages.length === 0) {
        alert('Invalid page range. Please enter valid page numbers.');
        return;
      }

      const deleteAfter = document.getElementById('extract-pages-delete')?.checked || false;

      hideExtractPagesDialog();
      await extractPages(pages, deleteAfter);
    });
  }

  // Make dialog draggable
  initExtractPagesDialogDrag();

  // Close with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && extractPagesDialog?.classList.contains('visible')) {
      hideExtractPagesDialog();
    }
  });
}

function initExtractPagesDialogDrag() {
  if (!extractPagesDialog) return;

  const dialog = extractPagesDialog.querySelector('.extract-pages-dialog');
  const header = extractPagesDialog.querySelector('.extract-pages-header');
  if (!dialog || !header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.extract-pages-close-btn')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const overlayRect = extractPagesDialog.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;
    const dialogRect = dialog.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, overlayRect.width - dialogRect.width));
    newY = Math.max(0, Math.min(newY, overlayRect.height - dialogRect.height));
    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
    dialog.style.position = 'absolute';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// ============================================
// Merge PDFs Dialog
// ============================================

const mergePdfsDialog = document.getElementById('merge-pdfs-dialog');

// Internal file list: [{path, name, pages}]
let mergeFileList = [];
let mergeSelectedIndex = -1;

export function showMergePdfsDialog() {
  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }
  if (!mergePdfsDialog) return;

  // Reset state
  mergeFileList = [];
  mergeSelectedIndex = -1;

  const posSelect = document.getElementById('merge-pdfs-position');
  if (posSelect) posSelect.value = 'end';

  renderMergeFileList();

  // Reset dialog position to center
  const dialog = mergePdfsDialog.querySelector('.merge-pdfs-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.position = 'absolute';
  }

  mergePdfsDialog.classList.add('visible');
}

export function hideMergePdfsDialog() {
  if (mergePdfsDialog) {
    mergePdfsDialog.classList.remove('visible');
  }
}

function renderMergeFileList() {
  const listEl = document.getElementById('merge-pdfs-file-list');
  const countEl = document.getElementById('merge-pdfs-file-count');
  if (!listEl) return;

  if (mergeFileList.length === 0) {
    listEl.innerHTML = '<div class="merge-pdfs-empty">Click + to add PDF files</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  listEl.innerHTML = '';
  let totalPages = 0;

  mergeFileList.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'merge-pdfs-file-item' + (idx === mergeSelectedIndex ? ' selected' : '');

    const icon = document.createElement('div');
    icon.className = 'merge-pdfs-file-icon';
    icon.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>';

    const name = document.createElement('span');
    name.className = 'merge-pdfs-file-name';
    name.textContent = file.name;
    name.title = file.path;

    const pages = document.createElement('span');
    pages.className = 'merge-pdfs-file-pages';
    pages.textContent = file.pages !== null ? `${file.pages} pg` : '';
    totalPages += file.pages || 0;

    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(pages);

    item.addEventListener('click', () => {
      mergeSelectedIndex = idx;
      renderMergeFileList();
    });

    listEl.appendChild(item);
  });

  if (countEl) {
    countEl.textContent = `${mergeFileList.length} file${mergeFileList.length !== 1 ? 's' : ''}, ${totalPages} total pages`;
  }
}

async function addMergeFiles() {
  if (!isTauri() || !window.__TAURI__?.dialog) return;

  try {
    const result = await window.__TAURI__.dialog.open({
      multiple: true,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (!result) return;

    // result can be a string (single file) or array (multiple files)
    const paths = Array.isArray(result) ? result : [result];

    for (const filePath of paths) {
      // Skip duplicates
      if (mergeFileList.some(f => f.path === filePath)) continue;

      const fileName = filePath.split(/[\\/]/).pop();

      // Try to get page count
      let pageCount = null;
      try {
        const { readBinaryFile } = await import('../../core/platform.js');
        const { PDFDocument } = await import('pdf-lib');
        const data = await readBinaryFile(filePath);
        const doc = await PDFDocument.load(new Uint8Array(data), { ignoreEncryption: true });
        pageCount = doc.getPageCount();
      } catch (e) {
        console.warn('Could not read page count for:', fileName, e);
      }

      mergeFileList.push({
        path: filePath,
        name: fileName,
        pages: pageCount,
      });
    }

    renderMergeFileList();
  } catch (e) {
    console.error('Error opening file dialog:', e);
  }
}

function removeMergeFile() {
  if (mergeSelectedIndex < 0 || mergeSelectedIndex >= mergeFileList.length) return;
  mergeFileList.splice(mergeSelectedIndex, 1);
  if (mergeSelectedIndex >= mergeFileList.length) {
    mergeSelectedIndex = mergeFileList.length - 1;
  }
  renderMergeFileList();
}

function moveMergeFileUp() {
  if (mergeSelectedIndex <= 0) return;
  const tmp = mergeFileList[mergeSelectedIndex];
  mergeFileList[mergeSelectedIndex] = mergeFileList[mergeSelectedIndex - 1];
  mergeFileList[mergeSelectedIndex - 1] = tmp;
  mergeSelectedIndex--;
  renderMergeFileList();
}

function moveMergeFileDown() {
  if (mergeSelectedIndex < 0 || mergeSelectedIndex >= mergeFileList.length - 1) return;
  const tmp = mergeFileList[mergeSelectedIndex];
  mergeFileList[mergeSelectedIndex] = mergeFileList[mergeSelectedIndex + 1];
  mergeFileList[mergeSelectedIndex + 1] = tmp;
  mergeSelectedIndex++;
  renderMergeFileList();
}

export function initMergePdfsDialog() {
  if (!mergePdfsDialog) return;

  const closeBtn = document.getElementById('merge-pdfs-close-btn');
  const cancelBtn = document.getElementById('merge-pdfs-cancel-btn');
  const okBtn = document.getElementById('merge-pdfs-ok-btn');
  const addBtn = document.getElementById('merge-pdfs-add-btn');
  const removeBtn = document.getElementById('merge-pdfs-remove-btn');
  const upBtn = document.getElementById('merge-pdfs-up-btn');
  const downBtn = document.getElementById('merge-pdfs-down-btn');

  if (closeBtn) closeBtn.addEventListener('click', hideMergePdfsDialog);
  if (cancelBtn) cancelBtn.addEventListener('click', hideMergePdfsDialog);

  if (addBtn) addBtn.addEventListener('click', addMergeFiles);
  if (removeBtn) removeBtn.addEventListener('click', removeMergeFile);
  if (upBtn) upBtn.addEventListener('click', moveMergeFileUp);
  if (downBtn) downBtn.addEventListener('click', moveMergeFileDown);

  if (okBtn) {
    okBtn.addEventListener('click', async () => {
      if (mergeFileList.length === 0) {
        alert('Please add at least one PDF file to merge.');
        return;
      }

      const position = document.getElementById('merge-pdfs-position')?.value || 'end';
      const paths = mergeFileList.map(f => f.path);

      hideMergePdfsDialog();
      await mergeFiles(paths, position);
    });
  }

  // Make dialog draggable
  initMergePdfsDialogDrag();

  // Close with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mergePdfsDialog?.classList.contains('visible')) {
      hideMergePdfsDialog();
    }
  });
}

function initMergePdfsDialogDrag() {
  if (!mergePdfsDialog) return;

  const dialog = mergePdfsDialog.querySelector('.merge-pdfs-dialog');
  const header = mergePdfsDialog.querySelector('.merge-pdfs-header');
  if (!dialog || !header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.merge-pdfs-close-btn')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const overlayRect = mergePdfsDialog.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;
    const dialogRect = dialog.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, overlayRect.width - dialogRect.width));
    newY = Math.max(0, Math.min(newY, overlayRect.height - dialogRect.height));
    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
    dialog.style.position = 'absolute';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// ============================================
// Print Dialog
// ============================================

const printDialog = document.getElementById('print-dialog');
let printAutoCloseTimer = null;
let printPreviewPages = [];
let printPreviewIndex = 0;
let printPrinterData = [];

export function showPrintDialog() {
  if (printAutoCloseTimer) {
    clearTimeout(printAutoCloseTimer);
    printAutoCloseTimer = null;
  }

  if (!state.pdfDoc) {
    alert('No document is open.');
    return;
  }
  if (!printDialog) return;

  // Reset status
  const statusEl = document.getElementById('print-status');
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.className = 'print-status';
    statusEl.textContent = '';
  }

  // Reset page range buttons: set "All" active
  printDialog.querySelectorAll('.print-page-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === 'all');
  });
  const customInput = document.getElementById('print-custom-pages');
  if (customInput) { customInput.value = ''; customInput.disabled = true; }

  // Update current page number display
  const currentPageNum = document.getElementById('print-current-page-num');
  if (currentPageNum) currentPageNum.textContent = state.currentPage;

  // Reset subset buttons: set "All" active
  printDialog.querySelectorAll('.print-subset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subset === 'all');
  });

  // Uncheck reverse
  const reverseCheck = document.getElementById('print-reverse');
  if (reverseCheck) reverseCheck.checked = false;

  // Reset copies and collate
  const copiesInput = document.getElementById('print-copies');
  if (copiesInput) copiesInput.value = '1';
  const collateCheck = document.getElementById('print-collate');
  if (collateCheck) collateCheck.checked = false;

  // Reset scaling
  const scalingSelect = document.getElementById('print-scaling');
  if (scalingSelect) scalingSelect.value = 'fit';
  const zoomInput = document.getElementById('print-zoom');
  if (zoomInput) { zoomInput.disabled = true; zoomInput.value = '100'; }

  // Reset auto-rotate and auto-center
  const autoRotate = document.getElementById('print-auto-rotate');
  if (autoRotate) autoRotate.checked = true;
  const autoCenter = document.getElementById('print-auto-center');
  if (autoCenter) autoCenter.checked = true;

  // Reset print content
  const contentSelect = document.getElementById('print-content');
  if (contentSelect) contentSelect.value = 'doc-and-markups';

  // Uncheck print as image
  const asImageCheck = document.getElementById('print-as-image');
  if (asImageCheck) asImageCheck.checked = false;

  // Enable print button
  const okBtn = document.getElementById('print-ok-btn');
  if (okBtn) okBtn.disabled = false;

  // Populate printers
  populatePrinters();

  // Update page info
  updatePrintPageInfo();

  // Reset dialog position to center
  const dialog = printDialog.querySelector('.print-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.position = 'absolute';
  }

  printDialog.classList.add('visible');

  // Initialize preview
  updatePrintPreviewPages();
  renderPrintPreview();
}

export function hidePrintDialog() {
  if (printAutoCloseTimer) {
    clearTimeout(printAutoCloseTimer);
    printAutoCloseTimer = null;
  }
  if (printDialog) {
    printDialog.classList.remove('visible');
  }
  const okBtn = document.getElementById('print-ok-btn');
  if (okBtn) okBtn.disabled = false;
}

async function populatePrinters() {
  const printerSelect = document.getElementById('print-printer');
  if (!printerSelect) return;

  printerSelect.innerHTML = '<option value="">Loading printers...</option>';
  updatePrinterInfo(null);

  try {
    const json = await invoke('get_printers');
    const printers = JSON.parse(json);
    printPrinterData = printers || [];

    printerSelect.innerHTML = '';

    if (printPrinterData.length === 0) {
      printerSelect.innerHTML = '<option value="">No printers found</option>';
      const okBtn = document.getElementById('print-ok-btn');
      if (okBtn) okBtn.disabled = true;
      return;
    }

    let defaultPrinter = null;
    for (const p of printPrinterData) {
      const option = document.createElement('option');
      option.value = p.Name;
      option.textContent = p.Name;
      printerSelect.appendChild(option);
      if (p.Default === true) {
        defaultPrinter = p.Name;
      }
    }

    if (defaultPrinter) {
      printerSelect.value = defaultPrinter;
    }

    updatePrinterInfo(printerSelect.value);
  } catch (e) {
    console.error('Failed to enumerate printers:', e);
    printerSelect.innerHTML = '<option value="">Failed to load printers</option>';
    const okBtn = document.getElementById('print-ok-btn');
    if (okBtn) okBtn.disabled = true;
  }
}

function updatePrinterInfo(printerName) {
  const statusEl = document.getElementById('print-printer-status');
  const typeEl = document.getElementById('print-printer-type');

  if (!printerName) {
    if (statusEl) statusEl.textContent = 'Status:';
    if (typeEl) typeEl.textContent = 'Type:';
    return;
  }

  const printer = printPrinterData.find(p => p.Name === printerName);
  if (!printer) {
    if (statusEl) statusEl.textContent = 'Status:';
    if (typeEl) typeEl.textContent = 'Type:';
    return;
  }

  const statusMap = { 1: 'Other', 2: 'Unknown', 3: 'Idle', 4: 'Printing', 5: 'Warmup', 6: 'Stopped', 7: 'Offline' };
  const statusText = statusMap[printer.PrinterStatus] || 'Ready';
  if (statusEl) statusEl.textContent = `Status: ${statusText}`;
  if (typeEl) typeEl.textContent = `Type: ${printer.DriverName || ''}`;
}

function getActiveRange() {
  const activeBtn = printDialog?.querySelector('.print-page-btn.active');
  return activeBtn?.dataset.range || 'all';
}

function getActiveSubset() {
  const activeBtn = printDialog?.querySelector('.print-subset-btn.active');
  return activeBtn?.dataset.subset || 'all';
}

function getPrintPages() {
  const totalPages = state.pdfDoc.numPages;
  const range = getActiveRange();
  let pages = [];

  if (range === 'current') {
    pages = [state.currentPage];
  } else if (range === 'custom') {
    const customStr = document.getElementById('print-custom-pages')?.value || '';
    pages = parsePageRange(customStr, totalPages);
    if (pages.length === 0) return null;
  } else {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  }

  const subset = getActiveSubset();
  if (subset === 'odd') {
    pages = pages.filter(p => p % 2 === 1);
  } else if (subset === 'even') {
    pages = pages.filter(p => p % 2 === 0);
  }

  if (document.getElementById('print-reverse')?.checked) {
    pages.reverse();
  }

  return pages;
}

function updatePrintPageInfo() {
  const infoEl = document.getElementById('print-page-info');
  if (!infoEl || !state.pdfDoc) return;

  const pages = getPrintPages();
  if (pages && pages.length > 0) {
    infoEl.textContent = `${pages.length} page${pages.length !== 1 ? 's' : ''} to print`;
  } else {
    infoEl.textContent = '';
  }
}

function updatePrintPreviewPages() {
  printPreviewPages = getPrintPages() || [];
  printPreviewIndex = 0;

  const pageNumEl = document.getElementById('print-preview-page-num');
  const totalEl = document.getElementById('print-preview-total');
  if (pageNumEl) pageNumEl.textContent = printPreviewPages.length > 0 ? '1' : '0';
  if (totalEl) totalEl.textContent = printPreviewPages.length;
}

async function renderPrintPreview() {
  const canvas = document.getElementById('print-preview-canvas');
  if (!canvas || !state.pdfDoc || printPreviewPages.length === 0) {
    if (canvas) {
      const ctx = canvas.getContext('2d');
      canvas.width = 200;
      canvas.height = 280;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 200, 280);
    }
    return;
  }

  const pageNum = printPreviewPages[printPreviewIndex];
  if (!pageNum) return;

  try {
    const contentSelect = document.getElementById('print-content');
    const includeAnnotations = contentSelect?.value === 'doc-and-markups';

    const page = await state.pdfDoc.getPage(pageNum);
    const extraRotation = getPageRotation(pageNum);
    const vpOpts = { scale: 1 };
    if (extraRotation) {
      vpOpts.rotation = (page.rotate + extraRotation) % 360;
    }
    const viewport = page.getViewport(vpOpts);

    const maxW = 300;
    const maxH = 350;
    const previewScale = Math.min(maxW / viewport.width, maxH / viewport.height);

    if (includeAnnotations) {
      const offscreen = await renderPageOffscreen(pageNum, previewScale);
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(offscreen, 0, 0);
    } else {
      const scaledVpOpts = { scale: previewScale };
      if (extraRotation) {
        scaledVpOpts.rotation = (page.rotate + extraRotation) % 360;
      }
      const scaledViewport = page.getViewport(scaledVpOpts);

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport,
        annotationMode: 0
      }).promise;
    }

    const paperEl = document.getElementById('print-preview-paper');
    if (paperEl) {
      const wMm = (viewport.width / 72 * 25.4).toFixed(0);
      const hMm = (viewport.height / 72 * 25.4).toFixed(0);
      paperEl.textContent = `Paper: ${wMm} x ${hMm} mm`;
    }

    const pageNumEl = document.getElementById('print-preview-page-num');
    if (pageNumEl) pageNumEl.textContent = printPreviewIndex + 1;
  } catch (e) {
    console.warn('Preview render failed:', e);
  }
}

function showPrintStatus(message, type = '') {
  const statusEl = document.getElementById('print-status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = 'print-status' + (type ? ' ' + type : '');
  statusEl.style.display = '';
}

async function executePrint() {
  const printer = document.getElementById('print-printer')?.value;
  if (!printer) {
    showPrintStatus('Please select a printer.', 'error');
    return;
  }

  const pages = getPrintPages();
  if (!pages || pages.length === 0) {
    showPrintStatus('Invalid page range or no pages selected.', 'error');
    return;
  }

  const copies = Math.max(1, Math.min(99, parseInt(document.getElementById('print-copies')?.value) || 1));
  const contentSelect = document.getElementById('print-content');
  const includeAnnotations = contentSelect?.value === 'doc-and-markups';

  const okBtn = document.getElementById('print-ok-btn');
  if (okBtn) okBtn.disabled = true;

  try {
    showPrintStatus('Preparing print job...');

    const dpi = 300;
    const exportScale = dpi / 72;
    const newPdf = await PDFDocument.create();

    for (let i = 0; i < pages.length; i++) {
      const pageNum = pages[i];
      showPrintStatus(`Rendering page ${i + 1} of ${pages.length}...`);

      if (includeAnnotations) {
        const canvas = await renderPageOffscreen(pageNum, exportScale);
        const jpegBytes = await canvasToBytes(canvas, 'jpeg', 0.92);
        const jpegImage = await newPdf.embedJpg(jpegBytes);

        const origPage = await state.pdfDoc.getPage(pageNum);
        const extraRotation = getPageRotation(pageNum);
        const origViewportOpts = { scale: 1 };
        if (extraRotation) {
          origViewportOpts.rotation = (origPage.rotate + extraRotation) % 360;
        }
        const origViewport = origPage.getViewport(origViewportOpts);

        const page = newPdf.addPage([origViewport.width, origViewport.height]);
        page.drawImage(jpegImage, {
          x: 0,
          y: 0,
          width: origViewport.width,
          height: origViewport.height,
        });
      } else {
        const origPage = await state.pdfDoc.getPage(pageNum);
        const extraRotation = getPageRotation(pageNum);
        const viewportOpts = { scale: exportScale };
        if (extraRotation) {
          viewportOpts.rotation = (origPage.rotate + extraRotation) % 360;
        }
        const viewport = origPage.getViewport(viewportOpts);

        const pdfCanvas = document.createElement('canvas');
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        const pdfCtx = pdfCanvas.getContext('2d');

        await origPage.render({
          canvasContext: pdfCtx,
          viewport: viewport,
          annotationMode: 0
        }).promise;

        const jpegBytes = await canvasToBytes(pdfCanvas, 'jpeg', 0.92);
        const jpegImage = await newPdf.embedJpg(jpegBytes);

        const origVpOpts = { scale: 1 };
        if (extraRotation) {
          origVpOpts.rotation = (origPage.rotate + extraRotation) % 360;
        }
        const origViewport = origPage.getViewport(origVpOpts);

        const newPage = newPdf.addPage([origViewport.width, origViewport.height]);
        newPage.drawImage(jpegImage, {
          x: 0,
          y: 0,
          width: origViewport.width,
          height: origViewport.height,
        });
      }
    }

    showPrintStatus('Sending to printer...');

    const pdfBytes = await newPdf.save();
    const tempPath = await invoke('write_temp_pdf', { data: Array.from(new Uint8Array(pdfBytes)) });

    for (let c = 0; c < copies; c++) {
      await invoke('print_pdf', { path: tempPath, printer });
    }

    showPrintStatus('Sent to printer.', 'success');

    setTimeout(async () => {
      try {
        await invoke('delete_file', { path: tempPath });
      } catch (e) {
        // Ignore cleanup errors
      }
    }, 30000);

    printAutoCloseTimer = setTimeout(() => {
      printAutoCloseTimer = null;
      hidePrintDialog();
    }, 1500);

  } catch (e) {
    console.error('Print failed:', e);
    showPrintStatus('Print failed: ' + (e.message || e), 'error');
    if (okBtn) okBtn.disabled = false;
  }
}

export function initPrintDialog() {
  if (!printDialog) return;

  const closeBtn = document.getElementById('print-close-btn');
  const cancelBtn = document.getElementById('print-cancel-btn');
  const okBtn = document.getElementById('print-ok-btn');

  if (closeBtn) closeBtn.addEventListener('click', hidePrintDialog);
  if (cancelBtn) cancelBtn.addEventListener('click', hidePrintDialog);
  if (okBtn) okBtn.addEventListener('click', executePrint);

  // Printer properties button
  document.getElementById('print-properties-btn')?.addEventListener('click', async () => {
    const printer = document.getElementById('print-printer')?.value;
    if (!printer) return;
    try {
      await invoke('open_printer_properties', { printer });
    } catch (e) {
      console.warn('Could not open printer properties:', e);
    }
  });

  // Page Setup button
  document.getElementById('print-page-setup-btn')?.addEventListener('click', () => {
    showPageSetupDialog();
  });

  // Printer selection change
  document.getElementById('print-printer')?.addEventListener('change', (e) => {
    updatePrinterInfo(e.target.value);
  });

  // Page range toggle buttons
  printDialog.querySelectorAll('.print-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      printDialog.querySelectorAll('.print-page-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cInput = document.getElementById('print-custom-pages');
      if (cInput) {
        cInput.disabled = btn.dataset.range !== 'custom';
        if (btn.dataset.range === 'custom') cInput.focus();
      }

      updatePrintPageInfo();
      updatePrintPreviewPages();
      renderPrintPreview();
    });
  });

  // Custom pages input
  document.getElementById('print-custom-pages')?.addEventListener('input', () => {
    updatePrintPageInfo();
    updatePrintPreviewPages();
    renderPrintPreview();
  });

  // Subset toggle buttons
  printDialog.querySelectorAll('.print-subset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      printDialog.querySelectorAll('.print-subset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updatePrintPageInfo();
      updatePrintPreviewPages();
      renderPrintPreview();
    });
  });

  // Reverse order checkbox
  document.getElementById('print-reverse')?.addEventListener('change', () => {
    updatePrintPageInfo();
    updatePrintPreviewPages();
    renderPrintPreview();
  });

  // Scaling dropdown
  document.getElementById('print-scaling')?.addEventListener('change', (e) => {
    const zoomEl = document.getElementById('print-zoom');
    if (zoomEl) zoomEl.disabled = e.target.value !== 'custom-scale';
  });

  // Print content change updates preview
  document.getElementById('print-content')?.addEventListener('change', () => {
    renderPrintPreview();
  });

  // Preview navigation
  document.getElementById('print-preview-prev')?.addEventListener('click', () => {
    if (printPreviewIndex > 0) {
      printPreviewIndex--;
      renderPrintPreview();
    }
  });
  document.getElementById('print-preview-next')?.addEventListener('click', () => {
    if (printPreviewIndex < printPreviewPages.length - 1) {
      printPreviewIndex++;
      renderPrintPreview();
    }
  });

  // Make dialog draggable
  initPrintDialogDrag();

  // Close with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && printDialog?.classList.contains('visible')) {
      hidePrintDialog();
    }
  });
}

function initPrintDialogDrag() {
  if (!printDialog) return;

  const dialog = printDialog.querySelector('.print-dialog');
  const header = printDialog.querySelector('.print-header');
  if (!dialog || !header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.print-close-btn')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const overlayRect = printDialog.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;
    const dialogRect = dialog.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, overlayRect.width - dialogRect.width));
    newY = Math.max(0, Math.min(newY, overlayRect.height - dialogRect.height));
    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
    dialog.style.position = 'absolute';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// ============================================
// Page Setup Dialog
// ============================================

const pageSetupDialog = document.getElementById('page-setup-dialog');

const PAGE_SETUP_SIZES = {
  a3:      { width: 297, height: 420, label: 'A3' },
  a4:      { width: 210, height: 297, label: 'A4' },
  a5:      { width: 148, height: 210, label: 'A5' },
  letter:  { width: 216, height: 279, label: 'Letter' },
  legal:   { width: 216, height: 356, label: 'Legal' },
  tabloid: { width: 279, height: 432, label: 'Tabloid' },
};

let pageSetupSettings = {
  size: 'a4',
  source: 'auto',
  orientation: 'portrait',
  marginLeft: 25,
  marginRight: 25,
  marginTop: 25,
  marginBottom: 25,
};

export function getPageSetupSettings() {
  return { ...pageSetupSettings };
}

export function showPageSetupDialog() {
  if (!pageSetupDialog) return;

  const sizeSelect = document.getElementById('page-setup-size');
  if (sizeSelect) sizeSelect.value = pageSetupSettings.size;

  const sourceSelect = document.getElementById('page-setup-source');
  if (sourceSelect) sourceSelect.value = pageSetupSettings.source;

  const orientRadio = document.querySelector(`input[name="page-setup-orient"][value="${pageSetupSettings.orientation}"]`);
  if (orientRadio) orientRadio.checked = true;

  document.getElementById('page-setup-margin-left').value = pageSetupSettings.marginLeft;
  document.getElementById('page-setup-margin-right').value = pageSetupSettings.marginRight;
  document.getElementById('page-setup-margin-top').value = pageSetupSettings.marginTop;
  document.getElementById('page-setup-margin-bottom').value = pageSetupSettings.marginBottom;

  const dialog = pageSetupDialog.querySelector('.page-setup-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.position = 'absolute';
  }

  pageSetupDialog.classList.add('visible');
  updatePageSetupPreview();
}

export function hidePageSetupDialog() {
  if (pageSetupDialog) {
    pageSetupDialog.classList.remove('visible');
  }
}

function updatePageSetupPreview() {
  const canvas = document.getElementById('page-setup-preview-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const sizeKey = document.getElementById('page-setup-size')?.value || 'a4';
  const orientation = document.querySelector('input[name="page-setup-orient"]:checked')?.value || 'portrait';
  const size = PAGE_SETUP_SIZES[sizeKey] || PAGE_SETUP_SIZES.a4;

  let paperW = size.width;
  let paperH = size.height;
  if (orientation === 'landscape') {
    [paperW, paperH] = [paperH, paperW];
  }

  const marginL = parseInt(document.getElementById('page-setup-margin-left')?.value) || 0;
  const marginR = parseInt(document.getElementById('page-setup-margin-right')?.value) || 0;
  const marginT = parseInt(document.getElementById('page-setup-margin-top')?.value) || 0;
  const marginB = parseInt(document.getElementById('page-setup-margin-bottom')?.value) || 0;

  const maxW = 160;
  const maxH = 200;
  const scale = Math.min(maxW / paperW, maxH / paperH) * 0.85;

  const drawW = paperW * scale;
  const drawH = paperH * scale;

  canvas.width = maxW;
  canvas.height = maxH;

  ctx.clearRect(0, 0, maxW, maxH);

  const offsetX = (maxW - drawW) / 2;
  const offsetY = (maxH - drawH) / 2;

  // Paper shadow
  ctx.fillStyle = '#888';
  ctx.fillRect(offsetX + 2, offsetY + 2, drawW, drawH);

  // Paper
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(offsetX, offsetY, drawW, drawH);
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1;
  ctx.strokeRect(offsetX, offsetY, drawW, drawH);

  // Content area within margins
  const mL = marginL * scale;
  const mR = marginR * scale;
  const mT = marginT * scale;
  const mB = marginB * scale;

  const contentX = offsetX + mL;
  const contentY = offsetY + mT;
  const contentW = drawW - mL - mR;
  const contentH = drawH - mT - mB;

  if (contentW > 5 && contentH > 5) {
    // Faux text lines
    ctx.fillStyle = '#ccc';
    const lineH = 4;
    const lineGap = 3;
    let y = contentY + 2;
    while (y + lineH < contentY + contentH - 2) {
      const lineW = contentW * (0.6 + Math.random() * 0.35);
      ctx.fillRect(contentX + 2, y, Math.min(lineW, contentW - 4), lineH);
      y += lineH + lineGap;
    }

    // Margin boundary dashes
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(contentX, contentY, contentW, contentH);
    ctx.setLineDash([]);
  }
}

function applyPageSetup() {
  pageSetupSettings.size = document.getElementById('page-setup-size')?.value || 'a4';
  pageSetupSettings.source = document.getElementById('page-setup-source')?.value || 'auto';
  pageSetupSettings.orientation = document.querySelector('input[name="page-setup-orient"]:checked')?.value || 'portrait';
  pageSetupSettings.marginLeft = parseInt(document.getElementById('page-setup-margin-left')?.value) || 0;
  pageSetupSettings.marginRight = parseInt(document.getElementById('page-setup-margin-right')?.value) || 0;
  pageSetupSettings.marginTop = parseInt(document.getElementById('page-setup-margin-top')?.value) || 0;
  pageSetupSettings.marginBottom = parseInt(document.getElementById('page-setup-margin-bottom')?.value) || 0;
  hidePageSetupDialog();
}

export function initPageSetupDialog() {
  if (!pageSetupDialog) return;

  const closeBtn = document.getElementById('page-setup-close-btn');
  const cancelBtn = document.getElementById('page-setup-cancel-btn');
  const okBtn = document.getElementById('page-setup-ok-btn');

  if (closeBtn) closeBtn.addEventListener('click', hidePageSetupDialog);
  if (cancelBtn) cancelBtn.addEventListener('click', hidePageSetupDialog);
  if (okBtn) okBtn.addEventListener('click', applyPageSetup);

  document.getElementById('page-setup-size')?.addEventListener('change', updatePageSetupPreview);
  document.querySelectorAll('input[name="page-setup-orient"]').forEach(r => {
    r.addEventListener('change', updatePageSetupPreview);
  });
  document.getElementById('page-setup-margin-left')?.addEventListener('input', updatePageSetupPreview);
  document.getElementById('page-setup-margin-right')?.addEventListener('input', updatePageSetupPreview);
  document.getElementById('page-setup-margin-top')?.addEventListener('input', updatePageSetupPreview);
  document.getElementById('page-setup-margin-bottom')?.addEventListener('input', updatePageSetupPreview);

  initPageSetupDialogDrag();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pageSetupDialog?.classList.contains('visible')) {
      hidePageSetupDialog();
    }
  });
}

function initPageSetupDialogDrag() {
  if (!pageSetupDialog) return;

  const dialog = pageSetupDialog.querySelector('.page-setup-dialog');
  const header = pageSetupDialog.querySelector('.page-setup-header');
  if (!dialog || !header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.page-setup-close-btn')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const overlayRect = pageSetupDialog.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;
    const dialogRect = dialog.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, overlayRect.width - dialogRect.width));
    newY = Math.max(0, Math.min(newY, overlayRect.height - dialogRect.height));
    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
    dialog.style.position = 'absolute';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}
