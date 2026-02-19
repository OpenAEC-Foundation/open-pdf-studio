import { state } from '../core/state.js';
import { annotationCanvas } from './dom-elements.js';
import { handleMouseDown, handleMouseMove, handleMouseUp } from '../tools/mouse-handlers.js';
import { initKeyboardHandlers } from '../tools/keyboard-handlers.js';
import { loadPDF } from '../pdf/loader.js';
import { isTauri } from '../core/platform.js';
import { createTab } from './chrome/tabs.js';
import { addImageFromFile } from '../annotations/image-drop.js';

// Sub-module imports
import { setupWheelZoom } from './setup/navigation-events.js';

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
  // Canvas mouse events (single page mode)
  if (annotationCanvas) {
    annotationCanvas.addEventListener('mousedown', handleMouseDown);
    annotationCanvas.addEventListener('mousemove', handleMouseMove);
    annotationCanvas.addEventListener('mouseup', handleMouseUp);
  }

  initKeyboardHandlers();
  setupDragDrop();
  setupWheelZoom();
  setupPanelResize();
}
