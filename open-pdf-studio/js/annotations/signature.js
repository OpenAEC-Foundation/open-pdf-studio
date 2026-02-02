import { state } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/status-bar.js';
import { generateImageId } from '../utils/helpers.js';

let signatureDialog = null;
let signatureCanvas = null;
let signatureCtx = null;
let isDrawingSignature = false;
let signaturePath = [];

// Saved signatures (stored in localStorage)
function getSavedSignatures() {
  try {
    const saved = localStorage.getItem('pdfEditorSignatures');
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveSignatureToStorage(dataUrl) {
  const signatures = getSavedSignatures();
  signatures.push({ dataUrl, createdAt: new Date().toISOString() });
  // Keep max 5 saved signatures
  while (signatures.length > 5) signatures.shift();
  localStorage.setItem('pdfEditorSignatures', JSON.stringify(signatures));
}

function deleteSavedSignature(index) {
  const signatures = getSavedSignatures();
  signatures.splice(index, 1);
  localStorage.setItem('pdfEditorSignatures', JSON.stringify(signatures));
}

// Show signature capture dialog
export function showSignatureDialog(x, y) {
  if (signatureDialog) {
    signatureDialog.remove();
    signatureDialog = null;
  }

  signatureDialog = document.createElement('div');
  signatureDialog.style.cssText = `
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: #ffffff;
    border: 1px solid #d4d4d4;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    z-index: 10001;
    width: 460px;
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
  titleBar.textContent = 'Signature';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00D7';
  closeBtn.style.cssText = `border: none; background: none; font-size: 18px; cursor: pointer; padding: 0 4px; color: #666;`;
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#e81123');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#666');
  closeBtn.addEventListener('click', () => { signatureDialog.remove(); signatureDialog = null; });
  titleBar.appendChild(closeBtn);
  signatureDialog.appendChild(titleBar);

  const body = document.createElement('div');
  body.style.cssText = 'padding: 12px;';

  // Tab bar: Draw | Saved
  const tabs = document.createElement('div');
  tabs.style.cssText = 'display: flex; gap: 0; margin-bottom: 8px; border-bottom: 1px solid #ddd;';

  const drawTab = document.createElement('button');
  drawTab.textContent = 'Draw';
  drawTab.style.cssText = 'padding: 6px 16px; border: none; background: none; cursor: pointer; font-weight: bold; border-bottom: 2px solid #0078d4; color: #0078d4;';

  const savedTab = document.createElement('button');
  savedTab.textContent = 'Saved';
  savedTab.style.cssText = 'padding: 6px 16px; border: none; background: none; cursor: pointer; color: #666;';

  tabs.appendChild(drawTab);
  tabs.appendChild(savedTab);
  body.appendChild(tabs);

  // Draw panel
  const drawPanel = document.createElement('div');

  // Canvas for drawing
  signatureCanvas = document.createElement('canvas');
  signatureCanvas.width = 430;
  signatureCanvas.height = 150;
  signatureCanvas.style.cssText = 'border: 1px solid #ccc; cursor: crosshair; background: #fff; display: block;';
  signatureCtx = signatureCanvas.getContext('2d');
  signatureCtx.lineWidth = 2;
  signatureCtx.lineCap = 'round';
  signatureCtx.lineJoin = 'round';
  signatureCtx.strokeStyle = '#000000';

  signatureCanvas.addEventListener('mousedown', startSignatureDraw);
  signatureCanvas.addEventListener('mousemove', continueSignatureDraw);
  signatureCanvas.addEventListener('mouseup', endSignatureDraw);
  signatureCanvas.addEventListener('mouseleave', endSignatureDraw);

  drawPanel.appendChild(signatureCanvas);

  // Color and buttons
  const controls = document.createElement('div');
  controls.style.cssText = 'display: flex; gap: 8px; margin-top: 8px; align-items: center;';

  const colorLabel = document.createElement('label');
  colorLabel.textContent = 'Color:';
  colorLabel.style.cssText = 'font-size: 12px;';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = '#000000';
  colorInput.style.cssText = 'width: 30px; height: 24px; border: 1px solid #ccc; padding: 0;';
  colorInput.addEventListener('input', () => { signatureCtx.strokeStyle = colorInput.value; });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.cssText = 'padding: 4px 12px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 12px;';
  clearBtn.addEventListener('click', () => {
    signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    signaturePath = [];
  });

  const spacer = document.createElement('div');
  spacer.style.flex = '1';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save & Place';
  saveBtn.style.cssText = 'padding: 4px 12px; border: 1px solid #0078d4; background: #0078d4; color: #fff; cursor: pointer; font-size: 12px;';
  saveBtn.addEventListener('click', () => {
    if (signaturePath.length < 2) { alert('Please draw a signature first.'); return; }
    const dataUrl = signatureCanvas.toDataURL('image/png');
    saveSignatureToStorage(dataUrl);
    placeSignatureFromDataUrl(dataUrl, x, y, colorInput.value);
    signatureDialog.remove();
    signatureDialog = null;
  });

  const placeBtn = document.createElement('button');
  placeBtn.textContent = 'Place';
  placeBtn.style.cssText = 'padding: 4px 12px; border: 1px solid #0078d4; background: #fff; color: #0078d4; cursor: pointer; font-size: 12px;';
  placeBtn.addEventListener('click', () => {
    if (signaturePath.length < 2) { alert('Please draw a signature first.'); return; }
    const dataUrl = signatureCanvas.toDataURL('image/png');
    placeSignatureFromDataUrl(dataUrl, x, y, colorInput.value);
    signatureDialog.remove();
    signatureDialog = null;
  });

  controls.appendChild(colorLabel);
  controls.appendChild(colorInput);
  controls.appendChild(clearBtn);
  controls.appendChild(spacer);
  controls.appendChild(placeBtn);
  controls.appendChild(saveBtn);
  drawPanel.appendChild(controls);

  // Saved panel
  const savedPanel = document.createElement('div');
  savedPanel.style.display = 'none';

  function renderSavedPanel() {
    savedPanel.innerHTML = '';
    const signatures = getSavedSignatures();
    if (signatures.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No saved signatures.';
      empty.style.cssText = 'padding: 20px; text-align: center; color: #888; font-style: italic;';
      savedPanel.appendChild(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';
    signatures.forEach((sig, idx) => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position: relative; border: 1px solid #ddd; cursor: pointer; padding: 4px;';
      const img = document.createElement('img');
      img.src = sig.dataUrl;
      img.style.cssText = 'width: 120px; height: 50px; object-fit: contain;';
      wrapper.appendChild(img);

      const delBtn = document.createElement('button');
      delBtn.textContent = '\u00D7';
      delBtn.style.cssText = 'position: absolute; top: 2px; right: 2px; border: none; background: rgba(255,0,0,0.7); color: #fff; cursor: pointer; font-size: 12px; width: 16px; height: 16px; padding: 0; line-height: 16px;';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSavedSignature(idx);
        renderSavedPanel();
      });
      wrapper.appendChild(delBtn);

      wrapper.addEventListener('click', () => {
        placeSignatureFromDataUrl(sig.dataUrl, x, y, '#000000');
        signatureDialog.remove();
        signatureDialog = null;
      });
      grid.appendChild(wrapper);
    });
    savedPanel.appendChild(grid);
  }

  // Tab switching
  drawTab.addEventListener('click', () => {
    drawPanel.style.display = '';
    savedPanel.style.display = 'none';
    drawTab.style.borderBottom = '2px solid #0078d4';
    drawTab.style.color = '#0078d4';
    drawTab.style.fontWeight = 'bold';
    savedTab.style.borderBottom = 'none';
    savedTab.style.color = '#666';
    savedTab.style.fontWeight = 'normal';
  });
  savedTab.addEventListener('click', () => {
    drawPanel.style.display = 'none';
    savedPanel.style.display = '';
    savedTab.style.borderBottom = '2px solid #0078d4';
    savedTab.style.color = '#0078d4';
    savedTab.style.fontWeight = 'bold';
    drawTab.style.borderBottom = 'none';
    drawTab.style.color = '#666';
    drawTab.style.fontWeight = 'normal';
    renderSavedPanel();
  });

  body.appendChild(drawPanel);
  body.appendChild(savedPanel);
  signatureDialog.appendChild(body);
  document.body.appendChild(signatureDialog);
}

function startSignatureDraw(e) {
  isDrawingSignature = true;
  const rect = signatureCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  signatureCtx.beginPath();
  signatureCtx.moveTo(x, y);
  signaturePath.push({ x, y });
}

function continueSignatureDraw(e) {
  if (!isDrawingSignature) return;
  const rect = signatureCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  signatureCtx.lineTo(x, y);
  signatureCtx.stroke();
  signaturePath.push({ x, y });
}

function endSignatureDraw() {
  isDrawingSignature = false;
}

// Place signature as image annotation
async function placeSignatureFromDataUrl(dataUrl, x, y, color) {
  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve) => { img.onload = resolve; });

  const imageId = generateImageId();
  state.imageCache.set(imageId, img);

  let width = img.naturalWidth;
  let height = img.naturalHeight;
  const maxW = 200;
  if (width > maxW) {
    const ratio = maxW / width;
    width *= ratio;
    height *= ratio;
  }

  const ann = createAnnotation({
    type: 'signature',
    page: state.currentPage,
    x: x - width / 2,
    y: y - height / 2,
    width: width,
    height: height,
    imageId: imageId,
    imageData: dataUrl,
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    color: color,
    opacity: 1,
    rotation: 0,
    locked: false
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

  updateStatusMessage('Signature placed');
}
