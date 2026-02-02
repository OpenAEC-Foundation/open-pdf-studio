import { state } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/status-bar.js';

// Built-in stamp definitions
export const BUILT_IN_STAMPS = [
  { name: 'Approved', color: '#22c55e', text: 'APPROVED' },
  { name: 'Rejected', color: '#ef4444', text: 'REJECTED' },
  { name: 'Draft', color: '#3b82f6', text: 'DRAFT' },
  { name: 'Confidential', color: '#ef4444', text: 'CONFIDENTIAL' },
  { name: 'Final', color: '#22c55e', text: 'FINAL' },
  { name: 'For Review', color: '#f59e0b', text: 'FOR REVIEW' },
  { name: 'Not Approved', color: '#ef4444', text: 'NOT APPROVED' },
  { name: 'Void', color: '#6b7280', text: 'VOID' },
  { name: 'As Is', color: '#6b7280', text: 'AS IS' },
  { name: 'Revised', color: '#8b5cf6', text: 'REVISED' }
];

let stampDialog = null;

// Show stamp picker dialog
export function showStampPicker(x, y) {
  if (stampDialog) {
    stampDialog.remove();
    stampDialog = null;
  }

  stampDialog = document.createElement('div');
  stampDialog.className = 'stamp-picker-dialog';
  stampDialog.style.cssText = `
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: #ffffff;
    border: 1px solid #d4d4d4;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    z-index: 10001;
    width: 360px;
    max-height: 400px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    padding: 8px 12px;
    background: linear-gradient(to bottom, #ffffff, #f5f5f5);
    border-bottom: 1px solid #d4d4d4;
    font-weight: bold;
    font-size: 13px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: default;
  `;
  titleBar.textContent = 'Select Stamp';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00D7';
  closeBtn.style.cssText = `
    border: none;
    background: none;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    color: #666;
  `;
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#e81123');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#666');
  closeBtn.addEventListener('click', () => { stampDialog.remove(); stampDialog = null; });
  titleBar.appendChild(closeBtn);
  stampDialog.appendChild(titleBar);

  // Stamps grid
  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    padding: 12px;
    overflow-y: auto;
  `;

  for (const stamp of BUILT_IN_STAMPS) {
    const btn = document.createElement('button');
    btn.style.cssText = `
      border: 2px solid ${stamp.color};
      background: transparent;
      padding: 8px 12px;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      color: ${stamp.color};
      text-align: center;
      letter-spacing: 1px;
    `;
    btn.textContent = stamp.text;
    btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = stamp.color + '15'; });
    btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = 'transparent'; });
    btn.addEventListener('click', () => {
      placeStamp(stamp, x, y);
      stampDialog.remove();
      stampDialog = null;
    });
    grid.appendChild(btn);
  }

  // Custom stamp from image
  const customBtn = document.createElement('button');
  customBtn.style.cssText = `
    border: 2px dashed #999;
    background: transparent;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 12px;
    color: #666;
    grid-column: span 2;
  `;
  customBtn.textContent = 'Custom Stamp from Image...';
  customBtn.addEventListener('click', () => {
    loadCustomStamp(x, y);
    stampDialog.remove();
    stampDialog = null;
  });
  grid.appendChild(customBtn);

  stampDialog.appendChild(grid);
  document.body.appendChild(stampDialog);
}

// Place a built-in stamp
function placeStamp(stamp, x, y) {
  if (!state.pdfDoc) return;

  const width = 160;
  const height = 50;

  const ann = createAnnotation({
    type: 'stamp',
    page: state.currentPage,
    x: x - width / 2,
    y: y - height / 2,
    width: width,
    height: height,
    stampName: stamp.name,
    stampText: stamp.text,
    stampColor: stamp.color,
    color: stamp.color,
    strokeColor: stamp.color,
    opacity: 0.85,
    rotation: 0
  });

  state.annotations.push(ann);
  recordAdd(ann);

  if (state.preferences.autoSelectAfterCreate) {
    state.selectedAnnotation = ann;
    showProperties(ann);
  }

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(`Stamp "${stamp.name}" placed`);
}

// Load custom stamp from image file
async function loadCustomStamp(x, y) {
  try {
    const { openFileDialog } = await import('../tauri-api.js');
    const filePath = await openFileDialog(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'svg']);
    if (!filePath) return;

    const { readBinaryFile } = await import('../tauri-api.js');
    const data = await readBinaryFile(filePath);
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

    const { generateImageId } = await import('../utils/helpers.js');
    const imageId = generateImageId();
    state.imageCache.set(imageId, img);

    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const maxSize = 200;
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width *= ratio;
      height *= ratio;
    }

    const ann = createAnnotation({
      type: 'stamp',
      page: state.currentPage,
      x: x - width / 2,
      y: y - height / 2,
      width: width,
      height: height,
      stampName: 'Custom',
      stampText: '',
      imageId: imageId,
      imageData: url,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
      color: '#000000',
      opacity: 1,
      rotation: 0
    });

    state.annotations.push(ann);
    recordAdd(ann);

    if (state.preferences.autoSelectAfterCreate) {
      state.selectedAnnotation = ann;
      showProperties(ann);
    }

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    updateStatusMessage('Custom stamp placed');
  } catch (err) {
    console.error('Failed to load custom stamp:', err);
  }
}
