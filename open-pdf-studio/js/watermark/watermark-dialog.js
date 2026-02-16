import { state } from '../core/state.js';
import { recordAddWatermark, recordRemoveWatermark, recordModifyWatermark } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';

let editingWatermark = null;
let lastFocusedHfInput = null;

function generateId() {
  return 'wm-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function refresh() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// ---- Draggable dialog helper ----
function makeDraggable(overlay, dialog, header) {
  let isDragging = false;
  let offsetX = 0, offsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    isDragging = true;
    const rect = dialog.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const overlayRect = overlay.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - offsetX;
    let newY = e.clientY - overlayRect.top - offsetY;
    const dialogRect = dialog.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, overlayRect.width - dialogRect.width));
    newY = Math.max(0, Math.min(newY, overlayRect.height - dialogRect.height));
    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => { isDragging = false; });
}

// ============================================================
// Watermark Dialog
// ============================================================
export function showWatermarkDialog(editWm = null) {
  const overlay = document.getElementById('watermark-dialog');
  if (!overlay) return;

  editingWatermark = editWm;

  // Reset dialog position
  const dialog = overlay.querySelector('.watermark-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
  }

  // Set title
  const title = overlay.querySelector('.watermark-header h2');
  if (title) title.textContent = editWm ? 'Edit Watermark' : 'Add Watermark';
  const addBtn = document.getElementById('wm-add-btn');
  if (addBtn) addBtn.textContent = editWm ? 'Update' : 'Add';

  if (editWm) {
    if (editWm.type === 'imageWatermark') {
      activateWmTab('image');
      document.getElementById('wm-img-opacity').value = (editWm.opacity || 0.2) * 100;
      document.getElementById('wm-img-opacity-val').textContent = Math.round((editWm.opacity || 0.2) * 100) + '%';
      document.getElementById('wm-img-scale').value = (editWm.scale || 1) * 100;
      document.getElementById('wm-img-scale-val').textContent = Math.round((editWm.scale || 1) * 100) + '%';
      document.getElementById('wm-img-rotation').value = editWm.rotation || 0;
      document.getElementById('wm-img-position').value = editWm.position || 'center';
      document.getElementById('wm-img-layer').value = editWm.layer || 'behind';
      document.getElementById('wm-img-page-range').value = editWm.pageRange || 'all';
      document.getElementById('wm-img-custom-pages').value = editWm.customPages || '';
      toggleCustomPos('wm-img-position', '.wm-img-custom-pos');
      toggleCustomPages('wm-img-page-range', '.wm-img-custom-pages');
      if (editWm.imageData) {
        document.getElementById('wm-img-preview').src = editWm.imageData;
        document.getElementById('wm-img-preview-row').style.display = 'flex';
      }
      if (editWm.position === 'custom') {
        document.getElementById('wm-img-custom-x').value = editWm.customX || 0;
        document.getElementById('wm-img-custom-y').value = editWm.customY || 0;
      }
    } else {
      activateWmTab('text');
      document.getElementById('wm-text').value = editWm.text || 'DRAFT';
      document.getElementById('wm-font').value = editWm.fontFamily || 'Helvetica';
      document.getElementById('wm-font-size').value = editWm.fontSize || 72;
      document.getElementById('wm-color').value = editWm.color || '#ff0000';
      document.getElementById('wm-opacity').value = (editWm.opacity || 0.3) * 100;
      document.getElementById('wm-opacity-val').textContent = Math.round((editWm.opacity || 0.3) * 100) + '%';
      document.getElementById('wm-rotation').value = editWm.rotation || -45;
      document.getElementById('wm-position').value = editWm.position || 'center';
      document.getElementById('wm-layer').value = editWm.layer || 'behind';
      document.getElementById('wm-page-range').value = editWm.pageRange || 'all';
      document.getElementById('wm-custom-pages').value = editWm.customPages || '';
      toggleCustomPos('wm-position', '.wm-custom-pos');
      toggleCustomPages('wm-page-range', '.wm-custom-pages');
      if (editWm.position === 'custom') {
        document.getElementById('wm-custom-x').value = editWm.customX || 0;
        document.getElementById('wm-custom-y').value = editWm.customY || 0;
      }
    }
  } else {
    // Reset to defaults
    activateWmTab('text');
    document.getElementById('wm-text').value = 'DRAFT';
    document.getElementById('wm-font').value = 'Helvetica';
    document.getElementById('wm-font-size').value = '72';
    document.getElementById('wm-color').value = '#ff0000';
    document.getElementById('wm-opacity').value = '30';
    document.getElementById('wm-opacity-val').textContent = '30%';
    document.getElementById('wm-rotation').value = '-45';
    document.getElementById('wm-position').value = 'center';
    document.getElementById('wm-layer').value = 'behind';
    document.getElementById('wm-page-range').value = 'all';
    document.getElementById('wm-custom-pages').value = '';
    document.getElementById('wm-img-opacity').value = '20';
    document.getElementById('wm-img-opacity-val').textContent = '20%';
    document.getElementById('wm-img-scale').value = '100';
    document.getElementById('wm-img-scale-val').textContent = '100%';
    document.getElementById('wm-img-rotation').value = '0';
    document.getElementById('wm-img-position').value = 'center';
    document.getElementById('wm-img-layer').value = 'behind';
    document.getElementById('wm-img-page-range').value = 'all';
    document.getElementById('wm-img-custom-pages').value = '';
    document.getElementById('wm-img-preview-row').style.display = 'none';
    document.querySelectorAll('.wm-custom-pos, .wm-custom-pages, .wm-img-custom-pos, .wm-img-custom-pages').forEach(el => el.style.display = 'none');
  }

  overlay.classList.add('visible');
  state.modalDialogOpen = true;
}

export function hideWatermarkDialog() {
  const overlay = document.getElementById('watermark-dialog');
  if (overlay) overlay.classList.remove('visible');
  editingWatermark = null;
  state.modalDialogOpen = false;
}

function activateWmTab(tabName) {
  document.querySelectorAll('.watermark-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.wmTab === tabName);
  });
  document.getElementById('wm-tab-text')?.classList.toggle('active', tabName === 'text');
  document.getElementById('wm-tab-image')?.classList.toggle('active', tabName === 'image');
}

function toggleCustomPos(selectId, rowSelector) {
  const sel = document.getElementById(selectId);
  const row = document.querySelector(rowSelector);
  if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none';
}

function toggleCustomPages(selectId, rowSelector) {
  const sel = document.getElementById(selectId);
  const row = document.querySelector(rowSelector);
  if (sel && row) row.style.display = sel.value === 'custom' ? 'flex' : 'none';
}

function getActiveWmTab() {
  const activeTab = document.querySelector('.watermark-tab.active');
  return activeTab ? activeTab.dataset.wmTab : 'text';
}

function buildTextWatermark() {
  return {
    id: editingWatermark ? editingWatermark.id : generateId(),
    type: 'textWatermark',
    text: document.getElementById('wm-text').value || 'DRAFT',
    fontFamily: document.getElementById('wm-font').value,
    fontSize: parseInt(document.getElementById('wm-font-size').value) || 72,
    color: document.getElementById('wm-color').value,
    opacity: parseInt(document.getElementById('wm-opacity').value) / 100,
    rotation: parseInt(document.getElementById('wm-rotation').value) || 0,
    position: document.getElementById('wm-position').value,
    customX: parseInt(document.getElementById('wm-custom-x')?.value) || 0,
    customY: parseInt(document.getElementById('wm-custom-y')?.value) || 0,
    layer: document.getElementById('wm-layer').value,
    pageRange: document.getElementById('wm-page-range').value,
    customPages: document.getElementById('wm-custom-pages').value,
    enabled: true,
  };
}

function buildImageWatermark() {
  const preview = document.getElementById('wm-img-preview');
  return {
    id: editingWatermark ? editingWatermark.id : generateId(),
    type: 'imageWatermark',
    imageData: preview?.src || (editingWatermark ? editingWatermark.imageData : ''),
    width: 200,
    height: 200,
    opacity: parseInt(document.getElementById('wm-img-opacity').value) / 100,
    rotation: parseInt(document.getElementById('wm-img-rotation').value) || 0,
    position: document.getElementById('wm-img-position').value,
    customX: parseInt(document.getElementById('wm-img-custom-x')?.value) || 0,
    customY: parseInt(document.getElementById('wm-img-custom-y')?.value) || 0,
    layer: document.getElementById('wm-img-layer').value,
    pageRange: document.getElementById('wm-img-page-range').value,
    customPages: document.getElementById('wm-img-custom-pages').value,
    scale: parseInt(document.getElementById('wm-img-scale').value) / 100,
    enabled: true,
  };
}

function handleWmAdd() {
  const tab = getActiveWmTab();
  const wm = tab === 'image' ? buildImageWatermark() : buildTextWatermark();

  if (tab === 'image' && !wm.imageData) {
    alert('Please select an image first.');
    return;
  }

  if (editingWatermark) {
    const oldState = { ...editingWatermark };
    const idx = state.watermarks.findIndex(w => w.id === editingWatermark.id);
    if (idx !== -1) {
      Object.assign(state.watermarks[idx], wm);
      recordModifyWatermark(editingWatermark.id, oldState, { ...state.watermarks[idx] });
    }
  } else {
    state.watermarks.push(wm);
    recordAddWatermark(wm);
  }

  markDocumentModified();
  refresh();
  hideWatermarkDialog();
}

// ============================================================
// Header/Footer Dialog
// ============================================================
export function showHeaderFooterDialog(editWm = null) {
  const overlay = document.getElementById('header-footer-dialog');
  if (!overlay) return;

  editingWatermark = editWm;

  const dialog = overlay.querySelector('.header-footer-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
  }

  const title = overlay.querySelector('.header-footer-header h2');
  if (title) title.textContent = editWm ? 'Edit Header/Footer' : 'Add Header/Footer';
  const addBtn = document.getElementById('hf-add-btn');
  if (addBtn) addBtn.textContent = editWm ? 'Update' : 'Add';

  if (editWm) {
    document.getElementById('hf-header-left').value = editWm.headerLeft || '';
    document.getElementById('hf-header-center').value = editWm.headerCenter || '';
    document.getElementById('hf-header-right').value = editWm.headerRight || '';
    document.getElementById('hf-footer-left').value = editWm.footerLeft || '';
    document.getElementById('hf-footer-center').value = editWm.footerCenter || '';
    document.getElementById('hf-footer-right').value = editWm.footerRight || '';
    document.getElementById('hf-font').value = editWm.fontFamily || 'Helvetica';
    document.getElementById('hf-font-size').value = editWm.fontSize || 10;
    document.getElementById('hf-color').value = editWm.color || '#000000';
    document.getElementById('hf-margin-top').value = editWm.marginTop || 30;
    document.getElementById('hf-margin-bottom').value = editWm.marginBottom || 30;
    document.getElementById('hf-margin-left').value = editWm.marginLeft || 40;
    document.getElementById('hf-margin-right').value = editWm.marginRight || 40;
    document.getElementById('hf-page-range').value = editWm.pageRange || 'all';
    document.getElementById('hf-custom-pages').value = editWm.customPages || '';
    toggleCustomPages('hf-page-range', '.hf-custom-pages');
  } else {
    document.getElementById('hf-header-left').value = '';
    document.getElementById('hf-header-center').value = '{page} of {pages}';
    document.getElementById('hf-header-right').value = '';
    document.getElementById('hf-footer-left').value = '{filename}';
    document.getElementById('hf-footer-center').value = '';
    document.getElementById('hf-footer-right').value = '{date}';
    document.getElementById('hf-font').value = 'Helvetica';
    document.getElementById('hf-font-size').value = '10';
    document.getElementById('hf-color').value = '#000000';
    document.getElementById('hf-margin-top').value = '30';
    document.getElementById('hf-margin-bottom').value = '30';
    document.getElementById('hf-margin-left').value = '40';
    document.getElementById('hf-margin-right').value = '40';
    document.getElementById('hf-page-range').value = 'all';
    document.getElementById('hf-custom-pages').value = '';
    document.querySelector('.hf-custom-pages').style.display = 'none';
  }

  overlay.classList.add('visible');
  state.modalDialogOpen = true;
}

export function hideHeaderFooterDialog() {
  const overlay = document.getElementById('header-footer-dialog');
  if (overlay) overlay.classList.remove('visible');
  editingWatermark = null;
  state.modalDialogOpen = false;
}

function buildHeaderFooter() {
  return {
    id: editingWatermark ? editingWatermark.id : generateId(),
    type: 'headerFooter',
    headerLeft: document.getElementById('hf-header-left').value,
    headerCenter: document.getElementById('hf-header-center').value,
    headerRight: document.getElementById('hf-header-right').value,
    footerLeft: document.getElementById('hf-footer-left').value,
    footerCenter: document.getElementById('hf-footer-center').value,
    footerRight: document.getElementById('hf-footer-right').value,
    fontFamily: document.getElementById('hf-font').value,
    fontSize: parseInt(document.getElementById('hf-font-size').value) || 10,
    color: document.getElementById('hf-color').value,
    marginTop: parseInt(document.getElementById('hf-margin-top').value) || 30,
    marginBottom: parseInt(document.getElementById('hf-margin-bottom').value) || 30,
    marginLeft: parseInt(document.getElementById('hf-margin-left').value) || 40,
    marginRight: parseInt(document.getElementById('hf-margin-right').value) || 40,
    pageRange: document.getElementById('hf-page-range').value,
    customPages: document.getElementById('hf-custom-pages').value,
    enabled: true,
  };
}

function handleHfAdd() {
  const wm = buildHeaderFooter();

  if (editingWatermark) {
    const oldState = { ...editingWatermark };
    const idx = state.watermarks.findIndex(w => w.id === editingWatermark.id);
    if (idx !== -1) {
      Object.assign(state.watermarks[idx], wm);
      recordModifyWatermark(editingWatermark.id, oldState, { ...state.watermarks[idx] });
    }
  } else {
    state.watermarks.push(wm);
    recordAddWatermark(wm);
  }

  markDocumentModified();
  refresh();
  hideHeaderFooterDialog();
}

// ============================================================
// Manage Watermarks Dialog
// ============================================================
export function showManageWatermarksDialog() {
  const overlay = document.getElementById('manage-watermarks-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.manage-wm-dialog');
  if (dialog) {
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
  }

  populateWatermarksList();
  overlay.classList.add('visible');
  state.modalDialogOpen = true;
}

export function hideManageWatermarksDialog() {
  const overlay = document.getElementById('manage-watermarks-dialog');
  if (overlay) overlay.classList.remove('visible');
  state.modalDialogOpen = false;
}

function getWmDescription(wm) {
  switch (wm.type) {
    case 'textWatermark':
      return `"${wm.text}" - ${wm.fontSize}px, ${wm.rotation}°`;
    case 'imageWatermark':
      return `Image - ${Math.round((wm.scale || 1) * 100)}% scale`;
    case 'headerFooter': {
      const parts = [];
      if (wm.headerLeft || wm.headerCenter || wm.headerRight) parts.push('Header');
      if (wm.footerLeft || wm.footerCenter || wm.footerRight) parts.push('Footer');
      return parts.join(' & ') || 'Header/Footer';
    }
    default:
      return 'Unknown';
  }
}

function getWmIcon(wm) {
  switch (wm.type) {
    case 'textWatermark': return 'T';
    case 'imageWatermark': return '\u{1F5BC}';
    case 'headerFooter': return '\u{1F4C4}';
    default: return '?';
  }
}

function getWmTypeLabel(wm) {
  switch (wm.type) {
    case 'textWatermark': return 'Text';
    case 'imageWatermark': return 'Image';
    case 'headerFooter': return 'Header/Footer';
    default: return '';
  }
}

function populateWatermarksList() {
  const list = document.getElementById('manage-wm-list');
  if (!list) return;

  const watermarks = state.watermarks;
  if (!watermarks || watermarks.length === 0) {
    list.innerHTML = '<div class="manage-wm-empty">No watermarks added yet.</div>';
    return;
  }

  list.innerHTML = '';
  for (const wm of watermarks) {
    const item = document.createElement('div');
    item.className = 'manage-wm-item';
    item.innerHTML = `
      <span class="manage-wm-item-icon">${getWmIcon(wm)}</span>
      <span class="manage-wm-item-desc">${getWmDescription(wm)}<span class="manage-wm-item-type">${getWmTypeLabel(wm)}</span></span>
      <div class="manage-wm-item-actions">
        <input type="checkbox" class="manage-wm-toggle" ${wm.enabled ? 'checked' : ''} title="Enable/Disable">
        <button class="manage-wm-btn edit" title="Edit">Edit</button>
        <button class="manage-wm-btn delete" title="Delete">Delete</button>
      </div>
    `;

    // Toggle enabled
    item.querySelector('.manage-wm-toggle').addEventListener('change', (e) => {
      const oldState = { ...wm };
      wm.enabled = e.target.checked;
      recordModifyWatermark(wm.id, oldState, { ...wm });
      markDocumentModified();
      refresh();
    });

    // Edit
    item.querySelector('.edit').addEventListener('click', () => {
      hideManageWatermarksDialog();
      if (wm.type === 'headerFooter') {
        showHeaderFooterDialog(wm);
      } else {
        showWatermarkDialog(wm);
      }
    });

    // Delete
    item.querySelector('.delete').addEventListener('click', () => {
      const idx = state.watermarks.indexOf(wm);
      if (idx !== -1) {
        state.watermarks.splice(idx, 1);
        recordRemoveWatermark(wm, idx);
        markDocumentModified();
        refresh();
        populateWatermarksList();
      }
    });

    list.appendChild(item);
  }
}

// ============================================================
// Init functions
// ============================================================
export function initWatermarkDialog() {
  const overlay = document.getElementById('watermark-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.watermark-dialog');
  const header = overlay.querySelector('.watermark-header');
  if (dialog && header) makeDraggable(overlay, dialog, header);

  // Close
  document.getElementById('watermark-close-btn')?.addEventListener('click', hideWatermarkDialog);
  document.getElementById('wm-cancel-btn')?.addEventListener('click', hideWatermarkDialog);
  document.getElementById('wm-add-btn')?.addEventListener('click', handleWmAdd);

  // Tabs
  document.querySelectorAll('.watermark-tab').forEach(tab => {
    tab.addEventListener('click', () => activateWmTab(tab.dataset.wmTab));
  });

  // Opacity slider feedback
  document.getElementById('wm-opacity')?.addEventListener('input', (e) => {
    document.getElementById('wm-opacity-val').textContent = e.target.value + '%';
  });
  document.getElementById('wm-img-opacity')?.addEventListener('input', (e) => {
    document.getElementById('wm-img-opacity-val').textContent = e.target.value + '%';
  });
  document.getElementById('wm-img-scale')?.addEventListener('input', (e) => {
    document.getElementById('wm-img-scale-val').textContent = e.target.value + '%';
  });

  // Position/page range toggles
  document.getElementById('wm-position')?.addEventListener('change', () => toggleCustomPos('wm-position', '.wm-custom-pos'));
  document.getElementById('wm-page-range')?.addEventListener('change', () => toggleCustomPages('wm-page-range', '.wm-custom-pages'));
  document.getElementById('wm-img-position')?.addEventListener('change', () => toggleCustomPos('wm-img-position', '.wm-img-custom-pos'));
  document.getElementById('wm-img-page-range')?.addEventListener('change', () => toggleCustomPages('wm-img-page-range', '.wm-img-custom-pages'));

  // Image picker
  document.getElementById('wm-img-pick')?.addEventListener('click', () => {
    document.getElementById('wm-img-file')?.click();
  });
  document.getElementById('wm-img-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('wm-img-preview').src = ev.target.result;
      document.getElementById('wm-img-preview-row').style.display = 'flex';
    };
    reader.readAsDataURL(file);
  });
}

export function initHeaderFooterDialog() {
  const overlay = document.getElementById('header-footer-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.header-footer-dialog');
  const header = overlay.querySelector('.header-footer-header');
  if (dialog && header) makeDraggable(overlay, dialog, header);

  document.getElementById('hf-close-btn')?.addEventListener('click', hideHeaderFooterDialog);
  document.getElementById('hf-cancel-btn')?.addEventListener('click', hideHeaderFooterDialog);
  document.getElementById('hf-add-btn')?.addEventListener('click', handleHfAdd);

  document.getElementById('hf-page-range')?.addEventListener('change', () => toggleCustomPages('hf-page-range', '.hf-custom-pages'));

  // Track last focused input for variable insertion
  const hfInputs = ['hf-header-left', 'hf-header-center', 'hf-header-right', 'hf-footer-left', 'hf-footer-center', 'hf-footer-right'];
  for (const id of hfInputs) {
    document.getElementById(id)?.addEventListener('focus', (e) => {
      lastFocusedHfInput = e.target;
    });
  }

  // Variable buttons
  document.querySelectorAll('.hf-var-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (lastFocusedHfInput) {
        const start = lastFocusedHfInput.selectionStart;
        const end = lastFocusedHfInput.selectionEnd;
        const val = lastFocusedHfInput.value;
        const varText = btn.dataset.var;
        lastFocusedHfInput.value = val.substring(0, start) + varText + val.substring(end);
        lastFocusedHfInput.focus();
        lastFocusedHfInput.setSelectionRange(start + varText.length, start + varText.length);
      }
    });
  });
}

export function initManageWatermarksDialog() {
  const overlay = document.getElementById('manage-watermarks-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.manage-wm-dialog');
  const header = overlay.querySelector('.manage-wm-header');
  if (dialog && header) makeDraggable(overlay, dialog, header);

  document.getElementById('manage-wm-close-btn')?.addEventListener('click', hideManageWatermarksDialog);
  document.getElementById('manage-wm-close-btn2')?.addEventListener('click', hideManageWatermarksDialog);
}
