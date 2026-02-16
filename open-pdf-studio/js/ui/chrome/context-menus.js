import { state, clearSelection, isSelected } from '../../core/state.js';
import { annotationCanvas, propertiesPanel } from '../dom-elements.js';
import { showProperties, hideProperties, showMultiSelectionProperties } from '../panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { copyAnnotation, copyAnnotations, pasteFromClipboard, duplicateAnnotation } from '../../annotations/clipboard.js';
import { recordAdd, recordDelete, recordBulkDelete } from '../../core/undo-manager.js';
import { bringToFront, sendToBack, bringForward, sendBackward, rotateAnnotation, flipHorizontal, flipVertical } from '../../annotations/z-order.js';
import { startTextEditing } from '../../tools/text-editing.js';
import { createTextMarkupAnnotation } from '../../text/text-markup.js';
import { setAsDefaultStyle } from '../../core/preferences.js';
import { setTool } from '../../tools/manager.js';
import { alignAnnotations } from '../../annotations/smart-guides.js';
import { getSelectedText, getSelectionRectsForAnnotation, clearTextSelection } from '../../text/text-selection.js';

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

  const isMultiSelect = state.selectedAnnotations.length > 1 && isSelected(annotation);
  const isLocked = annotation.locked || false;

  if (isMultiSelect) {
    // Multi-selection context menu
    const count = state.selectedAnnotations.length;

    menu.appendChild(createMenuItem(`Copy ${count} Annotations`, () => {
      copyAnnotations(state.selectedAnnotations);
    }));
    menu.appendChild(createMenuItem(`Cut ${count} Annotations`, () => {
      copyAnnotations(state.selectedAnnotations);
      recordBulkDelete(state.selectedAnnotations);
      const toDelete = new Set(state.selectedAnnotations);
      state.annotations = state.annotations.filter(a => !toDelete.has(a));
      clearSelection();
      hideProperties();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }));

    menu.appendChild(createSeparator());

    // Z-order for all selected
    menu.appendChild(createMenuItem('Bring All to Front', () => {
      for (const ann of state.selectedAnnotations) bringToFront(ann);
    }));
    menu.appendChild(createMenuItem('Send All to Back', () => {
      for (const ann of [...state.selectedAnnotations].reverse()) sendToBack(ann);
    }));

    menu.appendChild(createSeparator());

    // Alignment options
    menu.appendChild(createMenuItem('Align Left', () => { alignAnnotations('left'); redrawAnnotations(); }));
    menu.appendChild(createMenuItem('Align Right', () => { alignAnnotations('right'); redrawAnnotations(); }));
    menu.appendChild(createMenuItem('Align Top', () => { alignAnnotations('top'); redrawAnnotations(); }));
    menu.appendChild(createMenuItem('Align Bottom', () => { alignAnnotations('bottom'); redrawAnnotations(); }));
    menu.appendChild(createMenuItem('Center Horizontally', () => { alignAnnotations('center'); redrawAnnotations(); }));
    menu.appendChild(createMenuItem('Center Vertically', () => { alignAnnotations('middle'); redrawAnnotations(); }));
    if (count >= 3) {
      menu.appendChild(createMenuItem('Distribute Horizontally', () => { alignAnnotations('distribute-h'); redrawAnnotations(); }));
      menu.appendChild(createMenuItem('Distribute Vertically', () => { alignAnnotations('distribute-v'); redrawAnnotations(); }));
    }

    menu.appendChild(createSeparator());

    menu.appendChild(createMenuItem(`Delete ${count} Annotations`, async () => {
      let confirmed = false;
      if (window.__TAURI__?.dialog?.ask) {
        confirmed = await window.__TAURI__.dialog.ask(`Delete ${count} annotations?`, { title: 'Delete Annotations', kind: 'warning' });
      } else {
        confirmed = confirm(`Delete ${count} annotations?`);
      }
      if (confirmed) {
        recordBulkDelete(state.selectedAnnotations);
        const toDelete = new Set(state.selectedAnnotations);
        state.annotations = state.annotations.filter(a => !toDelete.has(a));
        clearSelection();
        hideProperties();
        if (state.viewMode === 'continuous') {
          redrawContinuous();
        } else {
          redrawAnnotations();
        }
      }
    }));
  } else {
    // Single annotation context menu

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
      const idx = state.annotations.indexOf(annotation);
      recordDelete(annotation, idx);
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

    // Set as Default Style
    menu.appendChild(createMenuItem('Set as Default Style', () => {
      setAsDefaultStyle(annotation);
    }));

    // Lock/Unlock
    menu.appendChild(createMenuItem(isLocked ? 'Unlock' : 'Lock', () => {
      annotation.locked = !annotation.locked;
      annotation.modifiedAt = new Date().toISOString();
      if (state.selectedAnnotation === annotation) {
        showProperties(annotation);
      }
    }));

    // Delete
    menu.appendChild(createMenuItem('Delete', async () => {
      let confirmed = false;
      if (window.__TAURI__?.dialog?.ask) {
        confirmed = await window.__TAURI__.dialog.ask('Delete this annotation?', { title: 'Delete Annotation', kind: 'warning' });
      } else {
        confirmed = confirm('Delete this annotation?');
      }
      if (confirmed) {
        const idx = state.annotations.indexOf(annotation);
        recordDelete(annotation, idx);
        state.annotations = state.annotations.filter(a => a !== annotation);
        hideProperties();
        if (state.viewMode === 'continuous') {
          redrawContinuous();
        } else {
          redrawAnnotations();
        }
      }
    }, isLocked));
  }

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
    import('../../pdf/renderer.js').then(({ actualSize }) => actualSize());
  }));
  menu.appendChild(createMenuItem('Fit Width', () => {
    import('../../pdf/renderer.js').then(({ fitWidth }) => fitWidth());
  }));
  menu.appendChild(createMenuItem('Fit Page', () => {
    import('../../pdf/renderer.js').then(({ fitPage }) => fitPage());
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
  // Right-click deactivates annotation tool when not mid-draw
  document.addEventListener('contextmenu', (e) => {
    const nonDrawTools = ['select', 'hand'];
    if (!nonDrawTools.includes(state.currentTool) && !state.isDrawing && !state.isDrawingPolyline && !(state.measurePoints && state.measurePoints.length >= 1)) {
      e.preventDefault();
      e.stopPropagation();
      setTool('select');
    }
  }, true);

  // Context menu on annotation canvas
  if (annotationCanvas) {
    annotationCanvas.addEventListener('contextmenu', (e) => {
      if (!state.pdfDoc) return;

      // Right-click finishes measure area/perimeter
      if ((state.currentTool === 'measureArea' || state.currentTool === 'measurePerimeter') && state.measurePoints && state.measurePoints.length >= 2) {
        e.preventDefault();
        import('../../annotations/factory.js').then(({ createAnnotation }) => {
          import('../../annotations/measurement.js').then(({ calculateArea, calculatePerimeter, formatMeasurement }) => {
            const points = [...state.measurePoints];
            let ann;
            const mPrefs = state.preferences;
            if (state.currentTool === 'measureArea' && points.length >= 3) {
              const area = calculateArea(points);
              ann = createAnnotation({
                type: 'measureArea',
                page: state.currentPage,
                points: points,
                color: mPrefs.measureStrokeColor,
                strokeColor: mPrefs.measureStrokeColor,
                lineWidth: mPrefs.measureLineWidth,
                opacity: (mPrefs.measureOpacity || 100) / 100,
                measureText: formatMeasurement(area),
                measureValue: area.value,
                measureUnit: area.unit
              });
            } else if (state.currentTool === 'measurePerimeter' && points.length >= 2) {
              const perim = calculatePerimeter(points);
              ann = createAnnotation({
                type: 'measurePerimeter',
                page: state.currentPage,
                points: points,
                color: mPrefs.measureStrokeColor,
                strokeColor: mPrefs.measureStrokeColor,
                lineWidth: mPrefs.measureLineWidth,
                opacity: (mPrefs.measureOpacity || 100) / 100,
                measureText: formatMeasurement(perim),
                measureValue: perim.value,
                measureUnit: perim.unit
              });
            }
            if (ann) {
              state.annotations.push(ann);
              recordAdd(ann);
            }
            state.measurePoints = null;
            import('../../annotations/rendering.js').then(({ redrawAnnotations }) => {
              redrawAnnotations();
            });
          });
        });
        return;
      }

      // Right-click finishes polyline drawing
      if (state.currentTool === 'polyline' && state.isDrawingPolyline) {
        e.preventDefault();
        import('../../annotations/factory.js').then(({ createAnnotation }) => {
          if (state.polylinePoints.length >= 2) {
            const pPrefs = state.preferences;
            const ann = createAnnotation({
              type: 'polyline',
              page: state.currentPage,
              points: [...state.polylinePoints],
              color: pPrefs.polylineStrokeColor,
              strokeColor: pPrefs.polylineStrokeColor,
              lineWidth: pPrefs.polylineLineWidth,
              opacity: (pPrefs.polylineOpacity || 100) / 100
            });
            state.annotations.push(ann);
            recordAdd(ann);
          }
          state.polylinePoints = [];
          state.isDrawingPolyline = false;
          import('../../annotations/rendering.js').then(({ redrawAnnotations }) => {
            redrawAnnotations();
          });
        });
        return;
      }

      const rect = annotationCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / state.scale;
      const y = (e.clientY - rect.top) / state.scale;

      // Import findAnnotationAt dynamically
      import('../../annotations/geometry.js').then(({ findAnnotationAt }) => {
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

// Show context menu for text selection
export function showTextSelectionContextMenu(e) {
  e.preventDefault();

  const menu = getContextMenu();
  menu.innerHTML = '';

  const selectedText = getSelectedText();
  if (!selectedText) return;

  // Copy
  menu.appendChild(createMenuItem('Copy', async () => {
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = selectedText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }));

  menu.appendChild(createSeparator());

  // Highlight Selection
  menu.appendChild(createMenuItem('Highlight Selection', () => {
    createTextMarkupAnnotation('textHighlight', '#FFFF00', 0.3);
    clearTextSelection();
  }));

  // Strikethrough Selection
  menu.appendChild(createMenuItem('Strikethrough Selection', () => {
    createTextMarkupAnnotation('textStrikethrough', '#FF0000', 1.0);
    clearTextSelection();
  }));

  // Underline Selection
  menu.appendChild(createMenuItem('Underline Selection', () => {
    createTextMarkupAnnotation('textUnderline', '#0000FF', 1.0);
    clearTextSelection();
  }));

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
