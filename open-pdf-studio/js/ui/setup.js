import { state } from '../core/state.js';
import { undo, redo, recordClearPage } from '../core/undo-manager.js';
import {
  annotationCanvas, pdfContainer,
  toolSelect, toolHand, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle,
  toolBox, toolComment, toolText, toolPolygon, toolCloud,
  toolPolyline, toolTextbox, toolCallout, toolClear, toolUndo,
  toolStamp, toolSignature, toolMeasureDistance, toolMeasureArea, toolMeasurePerimeter,
  toolRedaction, btnApplyRedactions
} from './dom-elements.js';
import { handleMouseDown, handleMouseMove, handleMouseUp } from '../tools/mouse-handlers.js';
import { initKeyboardHandlers } from '../tools/keyboard-handlers.js';
import { setTool } from '../tools/manager.js';
import { openPDFFile, loadPDF } from '../pdf/loader.js';
import { savePDF, savePDFAs } from '../pdf/saver.js';
import { hideProperties } from './panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous, updateQuickAccessButtons } from '../annotations/rendering.js';
import { minimizeWindow, maximizeWindow, closeWindow, isTauri } from '../core/platform.js';
import { closeActiveTab, createTab } from './chrome/tabs.js';
import { addImageFromFile } from '../annotations/image-drop.js';

// Sub-module imports
import { setupPropertiesPanelEvents } from './setup/properties-events.js';
import { setupMenuEvents } from './setup/menu-events.js';
import { setupRibbonEvents } from './setup/ribbon-events.js';
import { setupNavigationEvents, setupWheelZoom } from './setup/navigation-events.js';

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

// Setup quick access toolbar events
function setupQuickAccessEvents() {
  document.getElementById('qa-open')?.addEventListener('click', () => openPDFFile());
  document.getElementById('qa-save')?.addEventListener('click', async () => await savePDF());
  document.getElementById('qa-save-as')?.addEventListener('click', async () => await savePDFAs());
  document.getElementById('qa-print')?.addEventListener('click', () => {
    if (state.pdfDoc) {
      import('./chrome/dialogs.js').then(({ showPrintDialog }) => showPrintDialog());
    }
  });
  document.getElementById('qa-undo')?.addEventListener('click', () => undo());
  document.getElementById('qa-redo')?.addEventListener('click', () => redo());
  document.getElementById('qa-prev-view')?.addEventListener('click', () => {});
  document.getElementById('qa-next-view')?.addEventListener('click', () => {});
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

// Image file extensions
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];

function getFileExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot).toLowerCase() : '';
}

// Setup drag and drop for PDF and image files
function setupDragDrop() {
  // Prevent default browser drag behavior globally
  document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); });

  if (isTauri()) {
    setupTauriDragDrop();
  } else {
    setupHtmlDragDrop();
  }
}

// Tauri v2: use onDragDropEvent for reliable file paths
function setupTauriDragDrop() {
  try {
    const webview = window.__TAURI__?.webviewWindow;
    if (!webview) return;

    const currentWebview = webview.getCurrentWebviewWindow();
    currentWebview.onDragDropEvent(async (event) => {
      if (event.payload.type !== 'drop') return;

      const paths = event.payload.paths;
      if (!paths || paths.length === 0) return;

      for (const filePath of paths) {
        const ext = getFileExtension(filePath);
        if (ext === '.pdf') {
          createTab(filePath);
          await loadPDF(filePath);
        } else if (IMAGE_EXTENSIONS.includes(ext)) {
          await addImageFromFile(filePath);
        }
      }
    });
  } catch (e) {
    console.warn('Failed to setup Tauri drag-drop:', e);
    setupHtmlDragDrop();
  }
}

// HTML5 fallback: read files via FileReader
function setupHtmlDragDrop() {
  const dropZone = document.body;
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      const ext = getFileExtension(file.name);
      if (ext === '.pdf' && file.path) {
        createTab(file.path);
        await loadPDF(file.path);
      } else if (IMAGE_EXTENSIONS.includes(ext)) {
        const blob = file;
        const { pasteImageFromBlob } = await import('../annotations/clipboard.js');
        await pasteImageFromBlob(blob);
      }
    }
  });
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

// Setup all event listeners
export function setupEventListeners() {
  setupWindowControls();

  // Canvas mouse events (single page mode)
  if (annotationCanvas) {
    annotationCanvas.addEventListener('mousedown', handleMouseDown);
    annotationCanvas.addEventListener('mousemove', handleMouseMove);
    annotationCanvas.addEventListener('mouseup', handleMouseUp);
  }

  initKeyboardHandlers();
  setupToolButtons();
  setupPropertiesPanelEvents();
  setupNavigationEvents();
  setupMenuEvents();
  setupRibbonEvents();
  setupQuickAccessEvents();
  setupXFDFButtons();
  setupDragDrop();
  setupWheelZoom();
  setupPanelResize();
}
