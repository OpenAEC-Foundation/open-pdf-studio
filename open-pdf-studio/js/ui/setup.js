import { state } from '../core/state.js';
import { annotationCanvas } from './dom-elements.js';
import { handlePointerDown, handlePointerMove, handlePointerUp, handleDblClick } from '../tools/tool-dispatcher.js';
import { registerAllTools } from '../tools/tools/index.js';
import { initKeyboardHandlers } from '../tools/keyboard-handlers.js';
import { installeerMiddelmuisPan } from '../tools/middelmuis-pan.js';
import { loadPDFIfNeeded } from '../pdf/loader.js';
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

// Tauri v2: use onDragDropEvent for reliable file paths.
// Also drives the cross-instance tab re-dock UX: when a PDF (e.g. a tab being
// dragged out of ANOTHER app instance) hovers over this window's tab bar we
// show a highlight, and dropping docks it as a new tab.
function setupTauriDragDrop() {
  try {
    const webview = window.__TAURI__?.webviewWindow;
    if (!webview) return;

    const currentWebview = webview.getCurrentWebviewWindow();
    currentWebview.onDragDropEvent(async (event) => {
      const t = event.payload.type;

      // enter / over: while a drag hovers the window, light up the tab bar as
      // the dock target (the "where it will land" preview the user asked for).
      if (t === 'over' || t === 'enter') {
        updateDockHighlight(event.payload.position);
        return;
      }
      if (t === 'leave') {
        clearDockHighlight();
        return;
      }
      if (t !== 'drop') return;

      clearDockHighlight();

      // Self-drop guard: if THIS instance started the drag (dragging its own
      // tab out) and the drop landed back on itself, don't re-open a duplicate
      // — just flag it so the drag-out side keeps the tab in place.
      if (window.__OPDS_DRAGGING_OUT__) {
        window.__OPDS_SELF_DROP__ = true;
        return;
      }

      const paths = event.payload.paths;
      if (!paths || paths.length === 0) return;

      for (const filePath of paths) {
        const ext = getFileExtension(filePath);
        if (ext === '.pdf') {
          const { index } = createTab(filePath);
          await loadPDFIfNeeded(filePath, index);
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

// Show/hide the tab-bar dock highlight based on whether the drag cursor is
// near the top of the window (over the document tab bar). `position` is in
// physical pixels relative to the window's top-left.
function updateDockHighlight(position) {
  const tabs = document.getElementById('document-tabs');
  if (!tabs) return;
  // Convert the physical cursor Y to CSS px and test against the tab bar rect
  // plus a generous catch margin below it.
  const dpr = window.devicePixelRatio || 1;
  const cssY = (position?.y ?? 0) / dpr;
  const rect = tabs.getBoundingClientRect();
  const overBar = cssY >= rect.top - 8 && cssY <= rect.bottom + 40;
  tabs.classList.toggle('drag-dock-target', overBar);
}

function clearDockHighlight() {
  const tabs = document.getElementById('document-tabs');
  if (tabs) tabs.classList.remove('drag-dock-target');
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
        const { index } = createTab(file.path);
        await loadPDFIfNeeded(file.path, index);
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
      leftPanel.style.transition = 'none';
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (e) => {
        // Don't resize if collapsed
        if (leftPanel.classList.contains('collapsed')) return;
        const isRtl = document.documentElement.dir === 'rtl';
        const delta = e.clientX - startX;
        const newWidth = Math.max(120, Math.min(500, startWidth + (isRtl ? -delta : delta)));
        leftPanel.style.width = newWidth + 'px';
      };

      const onMouseUp = () => {
        leftHandle.classList.remove('dragging');
        leftPanel.style.transition = '';
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
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
  // Register all tool handlers
  registerAllTools();

  // Canvas pointer events (single page mode) — pointer events enable setPointerCapture
  if (annotationCanvas) {
    annotationCanvas.addEventListener('pointerdown', handlePointerDown);
    annotationCanvas.addEventListener('pointermove', handlePointerMove);
    annotationCanvas.addEventListener('pointerup', handlePointerUp);
    annotationCanvas.addEventListener('dblclick', handleDblClick);
  }

  // Middelmuis-slepen pant bij elk gereedschap en overal in de weergave
  installeerMiddelmuisPan();

  // Catch pointerup outside canvas to stop stuck drawing/shape state
  document.addEventListener('pointerup', handlePointerUp);

  initKeyboardHandlers();
  setupDragDrop();
  setupWheelZoom();
  setupPanelResize();

  // Track the cursor in app-space for the move engine — required for the
  // "hover an annotation and press G/mv" grab (it was exported but never
  // installed, so hover-grab silently did nothing).
  import('../tools/g-move-mode.js').then(m => m.installGMoveMouseTracker());
}
