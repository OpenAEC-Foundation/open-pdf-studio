import { state, getPageRotation, clearSelection } from '../core/state.js';
import { undo, redo, recordClearPage, recordClearAll, recordDelete, recordBulkDelete, recordPageRotation, recordPropertyChange, recordAdd } from '../core/undo-manager.js';
import {
  annotationCanvas, pdfContainer, placeholder,
  prevPageBtn, nextPageBtn, zoomInBtn, zoomOutBtn, zoomLevel, pageInput,
  toolSelect, toolHand, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle,
  toolBox, toolComment, toolText, toolPolygon, toolCloud,
  toolPolyline, toolTextbox, toolCallout, toolClear, toolUndo,
  toolStamp, toolSignature, toolMeasureDistance, toolMeasureArea, toolMeasurePerimeter,
  toolRedaction, btnApplyRedactions,
  propColor, propLineWidth, propText, propFontSize,
  propSubject, propAuthor, propOpacity, propIcon, propLocked, propPrintable,
  propFillColor, propStrokeColor, propBorderStyle, propertiesPanel,
  propTextColor, propFontFamily, propTextFontSize, propLineSpacing,
  propTextBold, propTextItalic, propTextUnderline, propTextStrikethrough,
  propAlignLeft, propAlignCenter, propAlignRight,
  propImageWidth, propImageHeight, propImageRotation, propImageReset,
  propArrowStart, propArrowEnd, propArrowHeadSize,
  propTextboxRotation
} from './dom-elements.js';
import { handleMouseDown, handleMouseMove, handleMouseUp } from '../tools/mouse-handlers.js';
import { initKeyboardHandlers } from '../tools/keyboard-handlers.js';
import { setTool } from '../tools/manager.js';
import { renderPage, renderContinuous, setViewMode, zoomIn, zoomOut, fitWidth, fitPage, actualSize, goToPage, rotatePage } from '../pdf/renderer.js';
import { openPDFFile, loadPDF } from '../pdf/loader.js';
import { savePDF, savePDFAs } from '../pdf/saver.js';
import { showProperties, hideProperties, closePropertiesPanel, updateAnnotationProperties, updateTextFormatProperties, updateArrowProperties } from './panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous, updateQuickAccessButtons } from '../annotations/rendering.js';
import { bringToFront, sendToBack, bringForward, sendBackward } from '../annotations/z-order.js';
import { closeAllMenus, closeBackstage } from './chrome/menus.js';
import { showPreferencesDialog, hidePreferencesDialog, savePreferencesFromDialog, resetPreferencesToDefaults, applyTheme, savePreferences } from '../core/preferences.js';
import { showAboutDialog, showDocPropertiesDialog } from './chrome/dialogs.js';
import { toggleAnnotationsListPanel } from './panels/annotations-list.js';
import { toggleLeftPanel } from './panels/left-panel.js';
import { closeActiveTab, createTab, markDocumentModified, hasUnsavedChanges, getUnsavedDocumentNames } from './chrome/tabs.js';
import { openFindBar } from '../search/find-bar.js';
import { isTauri, minimizeWindow, maximizeWindow, closeWindow, openExternal } from '../core/platform.js';
import {
  alignLeft, alignCenter, alignRight, alignTop, alignMiddle, alignBottom,
  distributeSpaceH, distributeSpaceV, distributeLeft, distributeCenter,
  distributeRight, distributeTop, distributeMiddle, distributeBottom
} from '../annotations/alignment.js';
import { initFormatRibbon } from './chrome/format-ribbon.js';

// Setup window control buttons (minimize, maximize, close)
function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => minimizeWindow());
  document.getElementById('btn-maximize')?.addEventListener('click', () => maximizeWindow());
  document.getElementById('btn-close')?.addEventListener('click', async () => {
    // Close each tab, prompting for unsaved changes (Save/Don't Save/Cancel)
    while (state.documents.length > 0) {
      const closed = await closeActiveTab();
      if (!closed) return; // User cancelled
    }
    closeWindow();
  });
}

// Setup all event listeners
export function setupEventListeners() {
  // Window control buttons
  setupWindowControls();

  // Canvas mouse events (single page mode)
  if (annotationCanvas) {
    annotationCanvas.addEventListener('mousedown', handleMouseDown);
    annotationCanvas.addEventListener('mousemove', handleMouseMove);
    annotationCanvas.addEventListener('mouseup', handleMouseUp);
  }

  // Keyboard events
  initKeyboardHandlers();

  // Tool button events
  setupToolButtons();

  // Properties panel events
  setupPropertiesPanelEvents();

  // Navigation and zoom events
  setupNavigationEvents();

  // Menu events
  setupMenuEvents();

  // Ribbon events
  setupRibbonEvents();

  // Quick access toolbar events
  setupQuickAccessEvents();

  // XFDF import/export
  setupXFDFButtons();

  // Drag and drop for PDF files
  setupDragDrop();

  // Scroll/wheel zoom
  setupWheelZoom();

  // Panel resize handles
  setupPanelResize();
}

// Setup tool button click handlers
function setupToolButtons() {
  toolSelect?.addEventListener('click', () => setTool('select'));
  toolHand?.addEventListener('click', () => setTool('hand'));
  toolHighlight?.addEventListener('click', () => setTool('highlight'));
  toolDraw?.addEventListener('click', () => setTool('draw'));
  toolLine?.addEventListener('click', () => setTool('line'));
  toolArrow?.addEventListener('click', () => setTool('arrow'));
  toolCircle?.addEventListener('click', () => setTool('circle'));
  toolBox?.addEventListener('click', () => setTool('box'));
  toolPolygon?.addEventListener('click', () => setTool('polygon'));
  toolCloud?.addEventListener('click', () => setTool('cloud'));
  toolPolyline?.addEventListener('click', () => setTool('polyline'));
  toolTextbox?.addEventListener('click', () => setTool('textbox'));
  toolCallout?.addEventListener('click', () => setTool('callout'));
  toolComment?.addEventListener('click', () => setTool('comment'));
  toolText?.addEventListener('click', () => setTool('text'));
  toolStamp?.addEventListener('click', () => setTool('stamp'));
  toolSignature?.addEventListener('click', () => setTool('signature'));
  toolMeasureDistance?.addEventListener('click', () => setTool('measureDistance'));
  toolMeasureArea?.addEventListener('click', () => setTool('measureArea'));
  toolMeasurePerimeter?.addEventListener('click', () => setTool('measurePerimeter'));
  toolRedaction?.addEventListener('click', () => setTool('redaction'));
  btnApplyRedactions?.addEventListener('click', async () => {
    const { applyRedactions } = await import('../annotations/redaction.js');
    applyRedactions();
  });

  // Clear annotations on current page
  toolClear?.addEventListener('click', () => {
    if (confirm('Clear all annotations on current page?')) {
      recordClearPage(state.currentPage, state.annotations);
      state.annotations = state.annotations.filter(a => a.page !== state.currentPage);
      hideProperties();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  });

  // Undo
  toolUndo?.addEventListener('click', () => {
    undo();
  });
}

// Setup properties panel event listeners
function setupPropertiesPanelEvents() {
  propColor?.addEventListener('input', updateAnnotationProperties);
  propLineWidth?.addEventListener('input', updateAnnotationProperties);
  propText?.addEventListener('input', updateAnnotationProperties);
  propFontSize?.addEventListener('input', updateAnnotationProperties);
  propSubject?.addEventListener('input', updateAnnotationProperties);
  propAuthor?.addEventListener('input', updateAnnotationProperties);
  // Track Ctrl key state for opacity snapping
  let ctrlKeyDown = false;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control') ctrlKeyDown = true;
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control') ctrlKeyDown = false;
  });

  propOpacity?.addEventListener('input', () => {
    // Snap to nearest 10 only when Ctrl is held
    if (ctrlKeyDown) {
      const snapped = Math.round(propOpacity.value / 10) * 10;
      propOpacity.value = snapped;
    }
    updateAnnotationProperties();
  });
  propIcon?.addEventListener('change', updateAnnotationProperties);
  propLocked?.addEventListener('change', updateAnnotationProperties);
  propPrintable?.addEventListener('change', updateAnnotationProperties);
  propFillColor?.addEventListener('input', updateAnnotationProperties);
  propStrokeColor?.addEventListener('input', updateAnnotationProperties);
  propBorderStyle?.addEventListener('change', updateAnnotationProperties);

  const propReadOnly = document.getElementById('prop-readonly');
  const propMarked = document.getElementById('prop-marked');
  propReadOnly?.addEventListener('change', updateAnnotationProperties);
  propMarked?.addEventListener('change', updateAnnotationProperties);

  // Text formatting
  propTextColor?.addEventListener('input', updateTextFormatProperties);
  propFontFamily?.addEventListener('change', updateTextFormatProperties);
  propTextFontSize?.addEventListener('change', updateTextFormatProperties);
  propLineSpacing?.addEventListener('change', updateTextFormatProperties);

  // Text style buttons
  propTextBold?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.fontBold = !state.selectedAnnotation.fontBold;
      propTextBold.classList.toggle('active', state.selectedAnnotation.fontBold);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextItalic?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.fontItalic = !state.selectedAnnotation.fontItalic;
      propTextItalic.classList.toggle('active', state.selectedAnnotation.fontItalic);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextUnderline?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.fontUnderline = !state.selectedAnnotation.fontUnderline;
      propTextUnderline.classList.toggle('active', state.selectedAnnotation.fontUnderline);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextStrikethrough?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.fontStrikethrough = !state.selectedAnnotation.fontStrikethrough;
      propTextStrikethrough.classList.toggle('active', state.selectedAnnotation.fontStrikethrough);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  // Text alignment buttons
  propAlignLeft?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.textAlign = 'left';
      propAlignLeft.classList.add('active');
      propAlignCenter?.classList.remove('active');
      propAlignRight?.classList.remove('active');
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propAlignCenter?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.textAlign = 'center';
      propAlignLeft?.classList.remove('active');
      propAlignCenter.classList.add('active');
      propAlignRight?.classList.remove('active');
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propAlignRight?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.textAlign = 'right';
      propAlignLeft?.classList.remove('active');
      propAlignCenter?.classList.remove('active');
      propAlignRight.classList.add('active');
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  // Image properties
  propImageWidth?.addEventListener('input', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.width = parseInt(propImageWidth.value) || 20;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageHeight?.addEventListener('input', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.height = parseInt(propImageHeight.value) || 20;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageRotation?.addEventListener('input', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.rotation = parseInt(propImageRotation.value) || 0;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageReset?.addEventListener('click', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.width = state.selectedAnnotation.originalWidth;
      state.selectedAnnotation.height = state.selectedAnnotation.originalHeight;
      state.selectedAnnotation.rotation = 0;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      showProperties(state.selectedAnnotation);
      redrawAnnotations();
    }
  });

  // Textbox rotation
  propTextboxRotation?.addEventListener('input', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.rotation = parseInt(propTextboxRotation.value) || 0;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  // Arrow properties
  propArrowStart?.addEventListener('change', updateArrowProperties);
  propArrowEnd?.addEventListener('change', updateArrowProperties);
  propArrowHeadSize?.addEventListener('input', updateArrowProperties);


  // Status change
  document.getElementById('prop-status')?.addEventListener('change', () => {
    updateAnnotationProperties();
  });

  // Alt text change
  document.getElementById('prop-alt-text')?.addEventListener('input', () => {
    updateAnnotationProperties();
  });

  // Reply add button
  document.getElementById('prop-reply-add')?.addEventListener('click', () => {
    const input = document.getElementById('prop-reply-input');
    if (!input || !input.value.trim() || !state.selectedAnnotation) return;
    if (!state.selectedAnnotation.replies) state.selectedAnnotation.replies = [];
    state.selectedAnnotation.replies.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      author: state.defaultAuthor || 'User',
      text: input.value.trim(),
      createdAt: new Date().toISOString()
    });
    state.selectedAnnotation.modifiedAt = new Date().toISOString();
    input.value = '';
    showProperties(state.selectedAnnotation);
  });

  // Reply input Enter key
  document.getElementById('prop-reply-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('prop-reply-add')?.click();
    }
  });

  // X button (top right) - closes panel entirely
  document.getElementById('prop-panel-close')?.addEventListener('click', closePropertiesPanel);

  // Prevent clicks in properties panel from propagating
  propertiesPanel?.addEventListener('mousedown', (e) => e.stopPropagation());
  propertiesPanel?.addEventListener('click', (e) => e.stopPropagation());

  // Collapsible sections
  propertiesPanel?.querySelectorAll('.property-section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
  });
}

// Setup navigation event listeners
function setupNavigationEvents() {
  document.getElementById('first-page')?.addEventListener('click', async () => {
    if (state.pdfDoc && state.currentPage !== 1) {
      state.currentPage = 1;
      hideProperties();
      await renderPage(state.currentPage);
    }
  });

  prevPageBtn?.addEventListener('click', async () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      hideProperties();
      await renderPage(state.currentPage);
    }
  });

  nextPageBtn?.addEventListener('click', async () => {
    if (state.pdfDoc && state.currentPage < state.pdfDoc.numPages) {
      state.currentPage++;
      hideProperties();
      await renderPage(state.currentPage);
    }
  });

  document.getElementById('last-page')?.addEventListener('click', async () => {
    if (state.pdfDoc && state.currentPage !== state.pdfDoc.numPages) {
      state.currentPage = state.pdfDoc.numPages;
      hideProperties();
      await renderPage(state.currentPage);
    }
  });

  // Page input - go to page on Enter key
  pageInput?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const pageNum = parseInt(pageInput.value, 10);
      if (state.pdfDoc && pageNum >= 1 && pageNum <= state.pdfDoc.numPages) {
        state.currentPage = pageNum;
        hideProperties();
        await renderPage(state.currentPage);
      } else {
        // Reset to current page if invalid
        pageInput.value = state.currentPage;
      }
      pageInput.blur();
    }
  });

  // Also validate on blur
  pageInput?.addEventListener('blur', () => {
    if (state.pdfDoc) {
      const pageNum = parseInt(pageInput.value, 10);
      if (isNaN(pageNum) || pageNum < 1 || pageNum > state.pdfDoc.numPages) {
        pageInput.value = state.currentPage;
      }
    }
  });

  zoomInBtn?.addEventListener('click', zoomIn);
  zoomOutBtn?.addEventListener('click', zoomOut);

  // Zoom input - set zoom on Enter key
  zoomLevel?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Parse the zoom value (remove % if present)
      let zoomValue = zoomLevel.value.replace('%', '').trim();
      let zoomPercent = parseInt(zoomValue, 10);

      if (!isNaN(zoomPercent) && zoomPercent >= 10 && zoomPercent <= 500) {
        state.scale = zoomPercent / 100;
        if (state.viewMode === 'continuous') {
          await renderContinuous();
        } else if (state.pdfDoc) {
          await renderPage(state.currentPage);
        }
        zoomLevel.value = `${zoomPercent}%`;
      } else {
        // Reset to current zoom if invalid
        zoomLevel.value = `${Math.round(state.scale * 100)}%`;
      }
      zoomLevel.blur();
    }
  });

  // Also validate on blur
  zoomLevel?.addEventListener('blur', () => {
    let zoomValue = zoomLevel.value.replace('%', '').trim();
    let zoomPercent = parseInt(zoomValue, 10);

    if (isNaN(zoomPercent) || zoomPercent < 10 || zoomPercent > 500) {
      zoomLevel.value = `${Math.round(state.scale * 100)}%`;
    } else if (!zoomLevel.value.includes('%')) {
      zoomLevel.value = `${zoomPercent}%`;
    }
  });
}

// Setup menu event listeners
function setupMenuEvents() {
  // Backstage file items
  document.getElementById('bs-open')?.addEventListener('click', () => {
    closeBackstage();
    openPDFFile();
  });

  document.getElementById('bs-save')?.addEventListener('click', async () => {
    closeBackstage();
    await savePDF();
  });

  document.getElementById('bs-save-as')?.addEventListener('click', async () => {
    closeBackstage();
    await savePDFAs();
  });

  document.getElementById('bs-doc-properties')?.addEventListener('click', () => {
    closeBackstage();
    showDocPropertiesDialog();
  });

  document.getElementById('bs-preferences')?.addEventListener('click', () => {
    closeBackstage();
    showPreferencesDialog();
  });

  document.getElementById('bs-about')?.addEventListener('click', () => {
    closeBackstage();
    showAboutDialog();
  });

  document.getElementById('bs-exit')?.addEventListener('click', async () => {
    closeBackstage();
    if (hasUnsavedChanges()) {
      const names = getUnsavedDocumentNames().join(', ');
      let result = false;
      if (window.__TAURI__?.dialog?.ask) {
        result = await window.__TAURI__.dialog.ask(
          `The following files have unsaved changes:\n${names}\n\nDo you want to exit without saving?`,
          { title: 'Unsaved Changes', kind: 'warning' }
        );
      } else {
        result = confirm(`The following files have unsaved changes:\n${names}\n\nDo you want to exit without saving?`);
      }
      if (!result) return;
    }
    closeWindow();
  });

  // Ribbon Find button
  document.getElementById('ribbon-find')?.addEventListener('click', () => {
    openFindBar();
  });

  // View menu
  document.getElementById('menu-zoom-in')?.addEventListener('click', () => {
    closeAllMenus();
    zoomIn();
  });

  document.getElementById('menu-zoom-out')?.addEventListener('click', () => {
    closeAllMenus();
    zoomOut();
  });

  document.getElementById('menu-actual-size')?.addEventListener('click', () => {
    closeAllMenus();
    actualSize();
  });

  document.getElementById('menu-fit-width')?.addEventListener('click', () => {
    closeAllMenus();
    fitWidth();
  });

  document.getElementById('menu-fit-page')?.addEventListener('click', () => {
    closeAllMenus();
    fitPage();
  });

  document.getElementById('menu-single-page')?.addEventListener('click', () => {
    closeAllMenus();
    setViewMode('single');
  });

  document.getElementById('menu-continuous')?.addEventListener('click', () => {
    closeAllMenus();
    setViewMode('continuous');
  });

  document.getElementById('menu-show-left-panel')?.addEventListener('click', () => {
    closeAllMenus();
    toggleLeftPanel();
  });

  document.getElementById('menu-show-properties')?.addEventListener('click', () => {
    closeAllMenus();
    if (propertiesPanel?.classList.contains('visible')) {
      closePropertiesPanel();
    } else {
      propertiesPanel.classList.add('visible');
      if (state.selectedAnnotation) {
        showProperties(state.selectedAnnotation);
      } else {
        hideProperties();
      }
    }
  });

  document.getElementById('menu-show-annotations-list')?.addEventListener('click', () => {
    closeAllMenus();
    toggleAnnotationsListPanel();
  });

  // Tools menu
  document.getElementById('menu-tool-select')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('select');
  });

  document.getElementById('menu-tool-hand')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('hand');
  });

  document.getElementById('menu-tool-highlight')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('highlight');
  });

  document.getElementById('menu-tool-draw')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('draw');
  });

  document.getElementById('menu-tool-line')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('line');
  });

  document.getElementById('menu-tool-box')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('box');
  });

  document.getElementById('menu-tool-circle')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('circle');
  });

  document.getElementById('menu-tool-text')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('textbox');
  });

  document.getElementById('menu-tool-comment')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('comment');
  });

  // Help ribbon buttons
  document.getElementById('ribbon-about')?.addEventListener('click', () => {
    showAboutDialog();
  });

  document.getElementById('ribbon-file-assoc')?.addEventListener('click', () => {
    showPreferencesDialog('fileassoc');
  });

  document.getElementById('ribbon-shortcuts')?.addEventListener('click', () => {
    const shortcuts = `Keyboard Shortcuts:

FILE:
Ctrl+O - Open PDF
Ctrl+S - Save
Ctrl+W - Close

EDIT:
Ctrl+Z - Undo
Ctrl+Y / Ctrl+Shift+Z - Redo
Delete - Delete selected annotation
Ctrl+Shift+C - Clear page annotations

VIEW:
Ctrl++ - Zoom In
Ctrl+- - Zoom Out
Ctrl+0 - Actual Size
Ctrl+1 - Fit Width
Ctrl+2 - Fit Page

TOOLS:
V - Select Tool
1 - Highlight
2 - Freehand
3 - Line
4 - Rectangle
5 - Ellipse
T - Text Box
N - Note`;
    alert(shortcuts);
  });

  document.getElementById('ribbon-check-updates')?.addEventListener('click', async () => {
    const GITHUB_REPO = 'OpenAEC-Foundation/Open-2D-Studio';
    const CURRENT_VERSION = '1.0.3';

    try {
      const btn = document.getElementById('ribbon-check-updates');
      const originalLabel = btn.querySelector('.ribbon-btn-label').textContent;
      btn.querySelector('.ribbon-btn-label').textContent = '...';
      btn.disabled = true;

      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github+json' }
      });

      if (!response.ok) {
        if (response.status === 404) {
          alert('No releases found yet.\n\nYou are running the latest development version.');
        } else {
          throw new Error(`GitHub API error: ${response.status}`);
        }
        return;
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, '');

      // Compare versions
      const current = CURRENT_VERSION.split('.').map(Number);
      const latest = latestVersion.split('.').map(Number);

      let needsUpdate = false;
      for (let i = 0; i < Math.max(current.length, latest.length); i++) {
        const c = current[i] || 0;
        const l = latest[i] || 0;
        if (l > c) { needsUpdate = true; break; }
        if (c > l) { break; }
      }

      if (needsUpdate) {
        const update = confirm(
          `A new version is available!\n\n` +
          `Current: v${CURRENT_VERSION}\n` +
          `Latest: v${latestVersion}\n\n` +
          `${release.name || ''}\n\n` +
          `Click OK to open the download page.`
        );
        if (update) {
          openExternal(release.html_url);
        }
      } else {
        alert(`You're up to date!\n\nCurrent version: v${CURRENT_VERSION}`);
      }
    } catch (err) {
      console.error('Update check failed:', err);
      alert('Failed to check for updates.\n\nPlease check your internet connection and try again.');
    } finally {
      const btn = document.getElementById('ribbon-check-updates');
      if (btn) {
        btn.querySelector('.ribbon-btn-label').textContent = 'Updates';
        btn.disabled = false;
      }
    }
  });

  // Preferences dialog buttons
  document.getElementById('pref-close-btn')?.addEventListener('click', hidePreferencesDialog);
  document.getElementById('pref-cancel-btn')?.addEventListener('click', hidePreferencesDialog);
  document.getElementById('pref-save-btn')?.addEventListener('click', savePreferencesFromDialog);
  document.getElementById('pref-reset-btn')?.addEventListener('click', resetPreferencesToDefaults);

  // Close preferences dialog when clicking overlay background
  document.getElementById('preferences-dialog')?.addEventListener('click', (e) => {
    if (e.target.id === 'preferences-dialog') {
      hidePreferencesDialog();
    }
  });

  // File association - Set as default PDF viewer
  document.getElementById('pref-set-default-app')?.addEventListener('click', async () => {
    const platform = navigator.platform.toLowerCase();

    if (platform.includes('win')) {
      // On Windows, open the Default Apps settings
      try {
        await openExternal('ms-settings:defaultapps');
        alert('Windows Settings opened.\n\nTo set OpenPDFStudio as default:\n1. Scroll down to "Choose default apps by file type"\n2. Find .pdf\n3. Click and select OpenPDFStudio');
      } catch (err) {
        alert('Could not open Windows Settings.\n\nPlease manually open Settings > Apps > Default Apps.');
      }
    } else if (platform.includes('mac')) {
      // macOS
      alert('To set OpenPDFStudio as default PDF viewer on macOS:\n\n1. Right-click any PDF file in Finder\n2. Select "Get Info"\n3. Under "Open with", select OpenPDFStudio\n4. Click "Change All..."');
    } else {
      // Linux
      alert('To set OpenPDFStudio as default PDF viewer on Linux:\n\nRun in terminal:\nxdg-mime default openpdfstudio.desktop application/pdf');
    }
  });

  // Setup fill None checkbox handlers
  setupFillNoneCheckboxes();
}

// Setup fill color "None" checkboxes
function setupFillNoneCheckboxes() {
  const pairs = [
    ['pref-textbox-fill-none', 'pref-textbox-fill-color'],
    ['pref-callout-fill-none', 'pref-callout-fill-color'],
    ['pref-rect-fill-none', 'pref-rect-fill-color'],
    ['pref-circle-fill-none', 'pref-circle-fill-color']
  ];

  pairs.forEach(([checkboxId, colorInputId]) => {
    const checkbox = document.getElementById(checkboxId);
    const colorInput = document.getElementById(colorInputId);
    if (checkbox && colorInput) {
      checkbox.addEventListener('change', () => {
        colorInput.disabled = checkbox.checked;
      });
    }
  });
}

// Setup quick access toolbar events
function setupQuickAccessEvents() {
  // Open button
  document.getElementById('qa-open')?.addEventListener('click', () => {
    openPDFFile();
  });

  // Save button
  document.getElementById('qa-save')?.addEventListener('click', async () => {
    await savePDF();
  });

  // Save As button
  document.getElementById('qa-save-as')?.addEventListener('click', async () => {
    await savePDFAs();
  });

  // Print button
  document.getElementById('qa-print')?.addEventListener('click', () => {
    if (state.pdfDoc) {
      window.print();
    }
  });

  // Undo button
  document.getElementById('qa-undo')?.addEventListener('click', () => {
    undo();
  });

  // Redo button
  document.getElementById('qa-redo')?.addEventListener('click', () => {
    redo();
  });

  // Previous/Next view - placeholder for view history
  document.getElementById('qa-prev-view')?.addEventListener('click', () => {
    // View history not implemented yet
  });

  document.getElementById('qa-next-view')?.addEventListener('click', () => {
    // View history not implemented yet
  });

  // Initial state update
  updateQuickAccessButtons();
}

// Setup XFDF import/export
function setupXFDFButtons() {
  document.getElementById('xfdf-export')?.addEventListener('click', async () => {
    const { exportXFDFToFile } = await import('../annotations/xfdf.js');
    exportXFDFToFile();
  });

  document.getElementById('xfdf-import')?.addEventListener('click', async () => {
    const { importXFDFFromFile } = await import('../annotations/xfdf.js');
    importXFDFFromFile();
  });
}

// Setup ribbon button events
function setupRibbonEvents() {
  document.getElementById('zoom-in-ribbon')?.addEventListener('click', zoomIn);
  document.getElementById('zoom-out-ribbon')?.addEventListener('click', zoomOut);
  document.getElementById('prev-page-ribbon')?.addEventListener('click', () => prevPageBtn?.click());
  document.getElementById('next-page-ribbon')?.addEventListener('click', () => nextPageBtn?.click());

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

  // Clear All Annotations button
  document.getElementById('ribbon-clear-all')?.addEventListener('click', () => {
    if (state.annotations.length > 0 && confirm('Clear ALL annotations from ALL pages?')) {
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

  // Format ribbon
  initFormatRibbon();

  // Theme selector
  document.getElementById('theme-select')?.addEventListener('change', (e) => {
    state.preferences.theme = e.target.value;
    applyTheme(e.target.value);
    savePreferences();
  });
}

// Setup drag and drop for PDF files
function setupDragDrop() {
  const dropZone = pdfContainer || document.body;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.pdf')) {
        createTab(file.path);
        await loadPDF(file.path);
      }
    }
  });
}

// Setup wheel zoom
function setupWheelZoom() {
  document.querySelector('.main-view')?.addEventListener('wheel', async (e) => {
    if (!state.pdfDoc) return;

    // Check if Ctrl key is pressed for zoom functionality
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const minZoom = 0.25;
      const maxZoom = 10.0;
      const oldScale = state.scale;

      // Multiplicative zoom: smooth at all levels, works with trackpad pinch too
      // Mouse wheel deltaY is ~±100 per tick, trackpad gives smaller values
      const factor = Math.pow(0.999, e.deltaY);
      state.scale = Math.min(Math.max(state.scale * factor, minZoom), maxZoom);

      // Round to avoid floating point noise (e.g. 0.9999999 → 1.0)
      state.scale = Math.round(state.scale * 1000) / 1000;

      if (state.scale === oldScale) return;

      // Anchor zoom to mouse cursor: find document point under cursor,
      // re-render, then scroll so that same point is back under cursor
      const mainView = e.currentTarget;
      const canvas = annotationCanvas;
      const canvasRect = canvas.getBoundingClientRect();

      // Mouse position relative to canvas (in rendered pixels at old scale)
      const mouseOnCanvasX = e.clientX - canvasRect.left;
      const mouseOnCanvasY = e.clientY - canvasRect.top;

      // Convert to unscaled document coordinates
      const docX = mouseOnCanvasX / oldScale;
      const docY = mouseOnCanvasY / oldScale;

      if (zoomLevel) {
        zoomLevel.value = `${Math.round(state.scale * 100)}%`;
      }

      if (state.viewMode === 'continuous') {
        await renderContinuous();
      } else {
        await renderPage(state.currentPage);
      }

      // After render, that document point is at new pixel position on canvas
      const newCanvasRect = canvas.getBoundingClientRect();
      const newPointViewportX = newCanvasRect.left + docX * state.scale;
      const newPointViewportY = newCanvasRect.top + docY * state.scale;

      // Scroll so that point moves back under the mouse cursor
      mainView.scrollLeft += newPointViewportX - e.clientX;
      mainView.scrollTop += newPointViewportY - e.clientY;
      return;
    }

    // Page navigation in single page mode (without Ctrl)
    if (state.viewMode !== 'single') return;

    const mainView = e.currentTarget;
    const scrollTop = mainView.scrollTop;
    const scrollHeight = mainView.scrollHeight;
    const clientHeight = mainView.clientHeight;

    // Scrolling down at the bottom
    if (e.deltaY > 0 && scrollTop + clientHeight >= scrollHeight - 5) {
      if (state.currentPage < state.pdfDoc.numPages) {
        e.preventDefault();
        await goToPage(state.currentPage + 1);
        mainView.scrollTop = 0;
      }
    }
    // Scrolling up at the top
    else if (e.deltaY < 0 && scrollTop <= 5) {
      if (state.currentPage > 1) {
        e.preventDefault();
        await goToPage(state.currentPage - 1);
        mainView.scrollTop = mainView.scrollHeight;
      }
    }
  }, { passive: false });
}

// Setup resizable panel handles
function setupPanelResize() {
  const leftPanel = document.getElementById('left-panel');
  const leftHandle = document.getElementById('left-panel-resize');

  if (leftPanel && leftHandle) {
    let startX, startWidth;

    leftHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = leftPanel.offsetWidth;
      leftHandle.classList.add('dragging');
      document.body.style.userSelect = 'none';

      const onMouseMove = (e) => {
        const delta = e.clientX - startX;
        const newWidth = Math.max(120, Math.min(500, startWidth + delta));
        leftPanel.style.width = newWidth + 'px';
      };

      const onMouseUp = () => {
        leftHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}
