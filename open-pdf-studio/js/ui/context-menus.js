import { state } from '../core/state.js';
import { annotationCanvas, propertiesPanel } from './dom-elements.js';
import { showProperties, hideProperties } from './properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { copyAnnotation, pasteFromClipboard, duplicateAnnotation } from '../annotations/clipboard.js';
import { bringToFront, sendToBack, bringForward, sendBackward, rotateAnnotation, flipHorizontal, flipVertical } from '../annotations/z-order.js';
import { startTextEditing } from '../tools/text-editing.js';

// Create context menu element
let contextMenu = null;

function getContextMenu() {
  if (!contextMenu) {
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.cssText = `
      position: fixed;
      background: #ffffff;
      border: 1px solid #d0d0d0;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      padding: 4px 0;
      z-index: 10000;
      display: none;
      min-width: 160px;
      font-size: 13px;
    `;
    document.body.appendChild(contextMenu);

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        hideContextMenu();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideContextMenu();
      }
    });
  }
  return contextMenu;
}

// Create menu item
function createMenuItem(label, action, disabled = false) {
  const item = document.createElement('div');
  item.className = 'context-menu-item';
  item.textContent = label;
  item.style.cssText = `
    padding: 6px 16px;
    cursor: ${disabled ? 'default' : 'pointer'};
    color: ${disabled ? '#999' : '#333'};
    white-space: nowrap;
  `;

  if (!disabled) {
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = '#e8e8e8';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = 'transparent';
    });
    item.addEventListener('click', () => {
      action();
      hideContextMenu();
    });
  }

  return item;
}

// Create separator
function createSeparator() {
  const sep = document.createElement('div');
  sep.style.cssText = `
    height: 1px;
    background: #d0d0d0;
    margin: 4px 8px;
  `;
  return sep;
}

// Show context menu for annotation
export function showContextMenu(e, annotation) {
  e.preventDefault();

  const menu = getContextMenu();
  menu.innerHTML = '';

  const isLocked = annotation.locked || false;

  // Edit text (for textbox/callout)
  if (['textbox', 'callout'].includes(annotation.type)) {
    menu.appendChild(createMenuItem('Edit Text...', () => {
      startTextEditing(annotation);
    }, isLocked));
    menu.appendChild(createSeparator());
  }

  // Properties
  menu.appendChild(createMenuItem('Properties...', () => {
    showProperties(annotation);
  }));

  menu.appendChild(createSeparator());

  // Clipboard operations
  menu.appendChild(createMenuItem('Copy', () => {
    copyAnnotation(annotation);
  }));
  menu.appendChild(createMenuItem('Cut', () => {
    copyAnnotation(annotation);
    state.annotations = state.annotations.filter(a => a !== annotation);
    hideProperties();
    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }, isLocked));
  menu.appendChild(createMenuItem('Duplicate', () => {
    state.selectedAnnotation = annotation;
    duplicateAnnotation();
  }));

  menu.appendChild(createSeparator());

  // Z-order operations
  menu.appendChild(createMenuItem('Bring to Front', () => bringToFront(annotation)));
  menu.appendChild(createMenuItem('Send to Back', () => sendToBack(annotation)));
  menu.appendChild(createMenuItem('Bring Forward', () => bringForward(annotation)));
  menu.appendChild(createMenuItem('Send Backward', () => sendBackward(annotation)));

  // Image-specific operations
  if (annotation.type === 'image') {
    menu.appendChild(createSeparator());
    menu.appendChild(createMenuItem('Rotate 90° CW', () => rotateAnnotation(annotation, 90), isLocked));
    menu.appendChild(createMenuItem('Rotate 90° CCW', () => rotateAnnotation(annotation, -90), isLocked));
    menu.appendChild(createMenuItem('Flip Horizontal', () => flipHorizontal(annotation), isLocked));
    menu.appendChild(createMenuItem('Flip Vertical', () => flipVertical(annotation), isLocked));
  }

  menu.appendChild(createSeparator());

  // Lock/Unlock
  menu.appendChild(createMenuItem(isLocked ? 'Unlock' : 'Lock', () => {
    annotation.locked = !annotation.locked;
    annotation.modifiedAt = new Date().toISOString();
    if (state.selectedAnnotation === annotation) {
      showProperties(annotation);
    }
  }));

  // Delete
  menu.appendChild(createMenuItem('Delete', () => {
    if (confirm('Delete this annotation?')) {
      state.annotations = state.annotations.filter(a => a !== annotation);
      hideProperties();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  }, isLocked));

  // Position menu
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.display = 'block';

  // Ensure menu stays within viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }
}

// Show context menu for empty area (page)
export function showPageContextMenu(e) {
  e.preventDefault();

  const menu = getContextMenu();
  menu.innerHTML = '';

  // Paste
  menu.appendChild(createMenuItem('Paste', async () => {
    await pasteFromClipboard();
  }, !state.clipboardAnnotation && !navigator.clipboard));

  menu.appendChild(createSeparator());

  // View options
  menu.appendChild(createMenuItem('Actual Size', () => {
    import('../pdf/renderer.js').then(({ actualSize }) => actualSize());
  }));
  menu.appendChild(createMenuItem('Fit Width', () => {
    import('../pdf/renderer.js').then(({ fitWidth }) => fitWidth());
  }));
  menu.appendChild(createMenuItem('Fit Page', () => {
    import('../pdf/renderer.js').then(({ fitPage }) => fitPage());
  }));

  // Position menu
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.display = 'block';
}

// Hide context menu
export function hideContextMenu() {
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
}

// Initialize context menus
export function initContextMenus() {
  // Context menu on annotation canvas
  if (annotationCanvas) {
    annotationCanvas.addEventListener('contextmenu', (e) => {
      if (!state.pdfDoc) return;

      const rect = annotationCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / state.scale;
      const y = (e.clientY - rect.top) / state.scale;

      // Import findAnnotationAt dynamically
      import('../annotations/geometry.js').then(({ findAnnotationAt }) => {
        const annotation = findAnnotationAt(x, y);
        if (annotation) {
          showContextMenu(e, annotation);
        } else {
          showPageContextMenu(e);
        }
      });
    });
  }
}
