import { state, getPageRotation } from '../../core/state.js';
import { recordClearAll, recordPageRotation } from '../../core/undo-manager.js';
import { prevPageBtn, propertiesPanel } from '../dom-elements.js';
import { renderPage, renderContinuous, setViewMode, zoomIn, zoomOut, fitWidth, fitPage, actualSize, goToPage, rotatePage } from '../../pdf/renderer.js';
import { showProperties, hideProperties, closePropertiesPanel } from '../panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { bringToFront, sendToBack, bringForward, sendBackward } from '../../annotations/z-order.js';
import { toggleAnnotationsListPanel } from '../panels/annotations-list.js';
import { toggleLeftPanel } from '../panels/left-panel.js';
import { applyTheme, savePreferences } from '../../core/preferences.js';
import {
  alignLeft, alignCenter, alignRight, alignTop, alignMiddle, alignBottom,
  distributeSpaceH, distributeSpaceV, distributeLeft, distributeCenter,
  distributeRight, distributeTop, distributeMiddle, distributeBottom
} from '../../annotations/alignment.js';
import { initFormatRibbon } from '../chrome/format-ribbon.js';
import { showInsertPageDialog, showExtractPagesDialog, showMergePdfsDialog } from '../chrome/dialogs.js';
import { deletePages } from '../../pdf/page-manager.js';
import { setTool } from '../../tools/manager.js';

// Setup ribbon button events
export function setupRibbonEvents() {
  document.getElementById('zoom-in-ribbon')?.addEventListener('click', zoomIn);
  document.getElementById('zoom-out-ribbon')?.addEventListener('click', zoomOut);
  document.getElementById('prev-page-ribbon')?.addEventListener('click', () => prevPageBtn?.click());
  document.getElementById('next-page-ribbon')?.addEventListener('click', () => document.getElementById('next-page')?.click());

  document.getElementById('first-page')?.addEventListener('click', async () => {
    if (state.pdfDoc && state.currentPage !== 1) {
      await goToPage(1);
    }
  });

  document.getElementById('last-page')?.addEventListener('click', async () => {
    if (state.pdfDoc && state.currentPage !== state.pdfDoc.numPages) {
      await goToPage(state.pdfDoc.numPages);
    }
  });

  document.getElementById('fit-width')?.addEventListener('click', fitWidth);
  document.getElementById('actual-size')?.addEventListener('click', actualSize);
  document.getElementById('fit-page')?.addEventListener('click', fitPage);
  document.getElementById('single-page')?.addEventListener('click', () => setViewMode('single'));
  document.getElementById('continuous')?.addEventListener('click', () => setViewMode('continuous'));

  // View ribbon tab buttons
  document.getElementById('ribbon-zoom-in')?.addEventListener('click', zoomIn);
  document.getElementById('ribbon-zoom-out')?.addEventListener('click', zoomOut);
  document.getElementById('view-actual-size')?.addEventListener('click', actualSize);
  document.getElementById('view-fit-width')?.addEventListener('click', fitWidth);
  document.getElementById('view-fit-page')?.addEventListener('click', fitPage);
  document.getElementById('ribbon-nav-panel')?.addEventListener('click', toggleLeftPanel);
  document.getElementById('ribbon-properties-panel')?.addEventListener('click', () => {
    if (propertiesPanel?.classList.contains('visible')) {
      closePropertiesPanel();
    } else {
      propertiesPanel.classList.add('visible');
      if (state.selectedAnnotation) {
        showProperties(state.selectedAnnotation);
      } else {
        hideProperties(); // Shows "no selection" message
      }
    }
  });
  document.getElementById('ribbon-annotations-list')?.addEventListener('click', toggleAnnotationsListPanel);

  // Rotate buttons
  document.getElementById('rotate-left')?.addEventListener('click', () => {
    const oldRot = getPageRotation(state.currentPage);
    rotatePage(-90);
    recordPageRotation(state.currentPage, oldRot, getPageRotation(state.currentPage));
  });
  document.getElementById('rotate-right')?.addEventListener('click', () => {
    const oldRot = getPageRotation(state.currentPage);
    rotatePage(90);
    recordPageRotation(state.currentPage, oldRot, getPageRotation(state.currentPage));
  });

  // Organize tab - Page management buttons
  document.getElementById('insert-page')?.addEventListener('click', () => {
    showInsertPageDialog();
  });
  document.getElementById('delete-page')?.addEventListener('click', async () => {
    if (!state.pdfDoc) return;
    if (state.pdfDoc.numPages <= 1) {
      alert('Cannot delete the last remaining page.');
      return;
    }
    const confirmed = await window.__TAURI__?.dialog?.ask(`Delete page ${state.currentPage}?`, { title: 'Delete Page', kind: 'warning' });
    if (confirmed) {
      await deletePages([state.currentPage]);
    }
  });
  document.getElementById('extract-pages')?.addEventListener('click', () => {
    showExtractPagesDialog();
  });
  document.getElementById('merge-pdfs')?.addEventListener('click', () => {
    showMergePdfsDialog();
  });

  // Edit Text button
  document.getElementById('edit-text')?.addEventListener('click', () => {
    setTool('editText');
  });

  // Watermark buttons
  document.getElementById('add-watermark')?.addEventListener('click', async () => {
    const { showWatermarkDialog } = await import('../../watermark/watermark-dialog.js');
    showWatermarkDialog();
  });
  document.getElementById('add-header-footer')?.addEventListener('click', async () => {
    const { showHeaderFooterDialog } = await import('../../watermark/watermark-dialog.js');
    showHeaderFooterDialog();
  });
  document.getElementById('manage-watermarks')?.addEventListener('click', async () => {
    const { showManageWatermarksDialog } = await import('../../watermark/watermark-dialog.js');
    showManageWatermarksDialog();
  });

  // Clear All Annotations button
  document.getElementById('ribbon-clear-all')?.addEventListener('click', async () => {
    if (state.annotations.length === 0) return;
    const confirmed = await window.__TAURI__?.dialog?.ask('Clear ALL annotations from ALL pages?', { title: 'Clear All', kind: 'warning' });
    if (confirmed) {
      recordClearAll(state.annotations);
      state.annotations = [];
      hideProperties();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  });

  // Z-Order buttons (Arrange ribbon)
  document.getElementById('arr-bring-forward')?.addEventListener('click', () => {
    for (const ann of state.selectedAnnotations) bringForward(ann);
  });
  document.getElementById('arr-bring-front')?.addEventListener('click', () => {
    for (const ann of state.selectedAnnotations) bringToFront(ann);
  });
  document.getElementById('arr-send-backward')?.addEventListener('click', () => {
    for (const ann of [...state.selectedAnnotations].reverse()) sendBackward(ann);
  });
  document.getElementById('arr-send-back')?.addEventListener('click', () => {
    for (const ann of [...state.selectedAnnotations].reverse()) sendToBack(ann);
  });

  // Alignment buttons (Arrange ribbon)
  document.getElementById('arr-align-left')?.addEventListener('click', alignLeft);
  document.getElementById('arr-align-center')?.addEventListener('click', alignCenter);
  document.getElementById('arr-align-right')?.addEventListener('click', alignRight);
  document.getElementById('arr-align-top')?.addEventListener('click', alignTop);
  document.getElementById('arr-align-middle')?.addEventListener('click', alignMiddle);
  document.getElementById('arr-align-bottom')?.addEventListener('click', alignBottom);

  // Distribution buttons (Arrange ribbon)
  document.getElementById('arr-dist-space-h')?.addEventListener('click', distributeSpaceH);
  document.getElementById('arr-dist-space-v')?.addEventListener('click', distributeSpaceV);
  document.getElementById('arr-dist-left')?.addEventListener('click', distributeLeft);
  document.getElementById('arr-dist-center')?.addEventListener('click', distributeCenter);
  document.getElementById('arr-dist-right')?.addEventListener('click', distributeRight);
  document.getElementById('arr-dist-top')?.addEventListener('click', distributeTop);
  document.getElementById('arr-dist-middle')?.addEventListener('click', distributeMiddle);
  document.getElementById('arr-dist-bottom')?.addEventListener('click', distributeBottom);

  // Screenshot split button
  document.getElementById('screenshot-page')?.addEventListener('click', async () => {
    const { screenshotFullPage } = await import('../../tools/screenshot.js');
    screenshotFullPage();
  });
  const screenshotMenu = document.getElementById('screenshot-menu');
  document.getElementById('screenshot-dropdown-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    screenshotMenu?.classList.toggle('show');
  });
  document.getElementById('screenshot-menu-page')?.addEventListener('click', async () => {
    screenshotMenu?.classList.remove('show');
    const { screenshotFullPage } = await import('../../tools/screenshot.js');
    screenshotFullPage();
  });
  document.getElementById('screenshot-menu-region')?.addEventListener('click', async () => {
    screenshotMenu?.classList.remove('show');
    const { startRegionScreenshot } = await import('../../tools/screenshot.js');
    startRegionScreenshot();
  });
  document.addEventListener('click', () => {
    screenshotMenu?.classList.remove('show');
  });

  // Format ribbon
  initFormatRibbon();

  // Theme selector
  document.getElementById('theme-select')?.addEventListener('change', (e) => {
    state.preferences.theme = e.target.value;
    applyTheme(e.target.value);
    savePreferences();
  });
}
