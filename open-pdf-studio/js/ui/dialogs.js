import { loadingOverlay, loadingText, aboutDialog } from './dom-elements.js';
import { state } from '../core/state.js';

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

// Show about dialog
export function showAboutDialog() {
  if (aboutDialog) {
    aboutDialog.classList.add('visible');
  }
}

// Hide about dialog
export function hideAboutDialog() {
  if (aboutDialog) {
    aboutDialog.classList.remove('visible');
  }
}

// Initialize about dialog
export function initAboutDialog() {
  const closeBtn = aboutDialog?.querySelector('.about-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideAboutDialog);
  }

  // Close when clicking overlay background
  if (aboutDialog) {
    aboutDialog.addEventListener('click', (e) => {
      if (e.target === aboutDialog) {
        hideAboutDialog();
      }
    });
  }

  // Close with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aboutDialog?.classList.contains('visible')) {
      hideAboutDialog();
    }
  });
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
