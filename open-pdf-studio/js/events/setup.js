import { state } from '../core/state.js';
import {
  annotationCanvas, pdfContainer, placeholder,
  prevPageBtn, nextPageBtn, zoomInBtn, zoomOutBtn, zoomLevel, pageInput,
  toolSelect, toolHand, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle,
  toolBox, toolComment, toolText, toolPolygon, toolCloud,
  toolPolyline, toolTextbox, toolCallout, toolClear, toolUndo,
  propColor, propLineWidth, propText, propFontSize, propDelete, propClose,
  propSubject, propAuthor, propOpacity, propIcon, propLocked, propPrintable,
  propFillColor, propStrokeColor, propBorderStyle, propertiesPanel,
  propTextColor, propFontFamily, propTextFontSize, propLineSpacing,
  propTextBold, propTextItalic, propTextUnderline, propTextStrikethrough,
  propAlignLeft, propAlignCenter, propAlignRight,
  propImageWidth, propImageHeight, propImageRotation, propImageReset,
  propArrowStart, propArrowEnd, propArrowHeadSize
} from '../ui/dom-elements.js';
import { handleMouseDown, handleMouseMove, handleMouseUp } from './mouse-handlers.js';
import { initKeyboardHandlers } from './keyboard-handlers.js';
import { setTool } from '../tools/manager.js';
import { renderPage, renderContinuous, setViewMode, zoomIn, zoomOut, fitWidth, fitPage, actualSize, goToPage } from '../pdf/renderer.js';
import { openPDFFile, loadPDF } from '../pdf/loader.js';
import { savePDFAs } from '../pdf/saver.js';
import { showProperties, hideProperties, updateAnnotationProperties, updateTextFormatProperties, updateArrowProperties } from '../ui/properties-panel.js';
import { redrawAnnotations, redrawContinuous, updateQuickAccessButtons } from '../annotations/rendering.js';
import { closeAllMenus } from '../ui/menus.js';
import { showPreferencesDialog, hidePreferencesDialog, savePreferencesFromDialog, resetPreferencesToDefaults } from '../core/preferences.js';
import { showAboutDialog, showDocPropertiesDialog } from '../ui/dialogs.js';
import { toggleAnnotationsListPanel } from '../ui/annotations-list.js';
import { toggleLeftPanel } from '../ui/left-panel.js';
import { closeActiveTab, createTab, markDocumentModified } from '../ui/tabs.js';
import { openFindBar } from '../search/find-bar.js';

// Setup window control buttons (minimize, maximize, close)
function setupWindowControls() {
  const { ipcRenderer } = window.require('electron');

  document.getElementById('btn-minimize')?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
  document.getElementById('btn-maximize')?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
  document.getElementById('btn-close')?.addEventListener('click', () => ipcRenderer.send('window-close'));
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

  // Drag and drop for PDF files
  setupDragDrop();

  // Scroll/wheel zoom
  setupWheelZoom();
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

  // Clear annotations on current page
  toolClear?.addEventListener('click', () => {
    if (confirm('Clear all annotations on current page?')) {
      state.annotations = state.annotations.filter(a => a.page !== state.currentPage);
      markDocumentModified();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  });

  // Undo (remove last annotation)
  toolUndo?.addEventListener('click', () => {
    if (state.annotations.length > 0) {
      state.annotations.pop();
      markDocumentModified();
      hideProperties();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
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
      state.selectedAnnotation.fontBold = !state.selectedAnnotation.fontBold;
      propTextBold.classList.toggle('active', state.selectedAnnotation.fontBold);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextItalic?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      state.selectedAnnotation.fontItalic = !state.selectedAnnotation.fontItalic;
      propTextItalic.classList.toggle('active', state.selectedAnnotation.fontItalic);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextUnderline?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      state.selectedAnnotation.fontUnderline = !state.selectedAnnotation.fontUnderline;
      propTextUnderline.classList.toggle('active', state.selectedAnnotation.fontUnderline);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextStrikethrough?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      state.selectedAnnotation.fontStrikethrough = !state.selectedAnnotation.fontStrikethrough;
      propTextStrikethrough.classList.toggle('active', state.selectedAnnotation.fontStrikethrough);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  // Text alignment buttons
  propAlignLeft?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
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
      state.selectedAnnotation.width = parseInt(propImageWidth.value) || 20;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageHeight?.addEventListener('input', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      state.selectedAnnotation.height = parseInt(propImageHeight.value) || 20;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageRotation?.addEventListener('input', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      state.selectedAnnotation.rotation = parseInt(propImageRotation.value) || 0;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageReset?.addEventListener('click', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      state.selectedAnnotation.width = state.selectedAnnotation.originalWidth;
      state.selectedAnnotation.height = state.selectedAnnotation.originalHeight;
      state.selectedAnnotation.rotation = 0;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      showProperties(state.selectedAnnotation);
      redrawAnnotations();
    }
  });

  // Arrow properties
  propArrowStart?.addEventListener('change', updateArrowProperties);
  propArrowEnd?.addEventListener('change', updateArrowProperties);
  propArrowHeadSize?.addEventListener('input', updateArrowProperties);

  // Delete button
  propDelete?.addEventListener('click', () => {
    if (state.selectedAnnotation) {
      if (state.selectedAnnotation.locked) {
        alert('This annotation is locked and cannot be deleted.');
        return;
      }
      if (confirm('Delete this annotation?')) {
        state.annotations = state.annotations.filter(a => a !== state.selectedAnnotation);
        markDocumentModified();
        hideProperties();
        if (state.viewMode === 'continuous') {
          redrawContinuous();
        } else {
          redrawAnnotations();
        }
      }
    }
  });

  // Close button
  propClose?.addEventListener('click', hideProperties);

  // Prevent clicks in properties panel from propagating
  propertiesPanel?.addEventListener('mousedown', (e) => e.stopPropagation());
  propertiesPanel?.addEventListener('click', (e) => e.stopPropagation());
}

// Setup navigation event listeners
function setupNavigationEvents() {
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
  // File menu
  document.getElementById('menu-open')?.addEventListener('click', () => {
    closeAllMenus();
    openPDFFile();
  });

  document.getElementById('menu-save')?.addEventListener('click', async () => {
    closeAllMenus();
    await savePDFAs();
  });

  document.getElementById('menu-save-as')?.addEventListener('click', async () => {
    closeAllMenus();
    await savePDFAs();
  });

  document.getElementById('menu-doc-properties')?.addEventListener('click', () => {
    closeAllMenus();
    showDocPropertiesDialog();
  });

  document.getElementById('menu-close')?.addEventListener('click', () => {
    closeAllMenus();
    closeActiveTab();
  });

  document.getElementById('menu-exit')?.addEventListener('click', () => {
    closeAllMenus();
    if (confirm('Exit PDF Annotator?')) {
      window.close();
    }
  });

  // Ribbon Find button
  document.getElementById('ribbon-find')?.addEventListener('click', () => {
    openFindBar();
  });

  document.getElementById('menu-preferences')?.addEventListener('click', () => {
    closeAllMenus();
    showPreferencesDialog();
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
      hideProperties();
    } else if (state.selectedAnnotation) {
      showProperties(state.selectedAnnotation);
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
    const CURRENT_VERSION = '1.0.2';

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
          require('electron').shell.openExternal(release.html_url);
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
    const { shell } = require('electron');
    const os = require('os');
    const platform = os.platform();

    if (platform === 'win32') {
      // On Windows, open the Default Apps settings
      try {
        // Try to open Windows Settings directly to Default Apps
        await shell.openExternal('ms-settings:defaultapps');
        alert('Windows Settings opened.\n\nTo set OpenPDFStudio as default:\n1. Scroll down to "Choose default apps by file type"\n2. Find .pdf\n3. Click and select OpenPDFStudio');
      } catch (err) {
        // Fallback: open Control Panel
        const { exec } = require('child_process');
        exec('control /name Microsoft.DefaultPrograms');
        alert('Default Programs opened.\n\nSelect "Set your default programs" and choose OpenPDFStudio.');
      }
    } else if (platform === 'darwin') {
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
  // Save button
  document.getElementById('qa-save')?.addEventListener('click', async () => {
    await savePDFAs();
  });

  // Print button
  document.getElementById('qa-print')?.addEventListener('click', () => {
    if (state.pdfDoc) {
      window.print();
    }
  });

  // Undo button - remove last annotation
  document.getElementById('qa-undo')?.addEventListener('click', () => {
    if (state.annotations.length > 0) {
      // Store removed annotation for redo
      const removed = state.annotations.pop();
      if (!state.redoStack) state.redoStack = [];
      state.redoStack.push(removed);
      markDocumentModified();
      hideProperties();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
      updateQuickAccessButtons();
    }
  });

  // Redo button - restore last undone annotation
  document.getElementById('qa-redo')?.addEventListener('click', () => {
    if (state.redoStack && state.redoStack.length > 0) {
      const restored = state.redoStack.pop();
      state.annotations.push(restored);
      markDocumentModified();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
      updateQuickAccessButtons();
    }
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
      hideProperties();
    } else if (state.selectedAnnotation) {
      showProperties(state.selectedAnnotation);
    }
  });
  document.getElementById('ribbon-annotations-list')?.addEventListener('click', toggleAnnotationsListPanel);

  // Clear All Annotations button
  document.getElementById('ribbon-clear-all')?.addEventListener('click', () => {
    if (state.annotations.length > 0 && confirm('Clear ALL annotations from ALL pages?')) {
      state.annotations = [];
      state.redoStack = [];
      markDocumentModified();
      hideProperties();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
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

      const zoomStep = 0.1;
      const minZoom = 0.5;
      const maxZoom = 5.0;

      if (e.deltaY < 0) {
        // Zoom in
        state.scale = Math.min(state.scale + zoomStep, maxZoom);
      } else {
        // Zoom out
        state.scale = Math.max(state.scale - zoomStep, minZoom);
      }

      if (zoomLevel) {
        zoomLevel.value = `${Math.round(state.scale * 100)}%`;
      }

      if (state.viewMode === 'continuous') {
        await renderContinuous();
      } else {
        await renderPage(state.currentPage);
      }
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
