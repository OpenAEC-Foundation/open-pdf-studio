import { state } from '../../core/state.js';

// Update quick access toolbar button states
export function updateQuickAccessButtons() {
  const qaSave = document.getElementById('qa-save');
  const qaSaveAs = document.getElementById('qa-save-as');
  const qaPrint = document.getElementById('qa-print');
  const qaUndo = document.getElementById('qa-undo');
  const qaRedo = document.getElementById('qa-redo');
  const qaPrevView = document.getElementById('qa-prev-view');
  const qaNextView = document.getElementById('qa-next-view');

  // Save/Save As/Print - enabled when PDF is loaded
  if (qaSave) qaSave.disabled = !state.pdfDoc;
  if (qaSaveAs) qaSaveAs.disabled = !state.pdfDoc;
  if (qaPrint) qaPrint.disabled = !state.pdfDoc;

  // Undo - enabled when undo stack has entries
  const doc = state.documents[state.activeDocumentIndex];
  if (qaUndo) qaUndo.disabled = !doc || !doc.undoStack || doc.undoStack.length === 0;

  // Redo - enabled when redo stack has entries
  if (qaRedo) qaRedo.disabled = !doc || !doc.redoStack || doc.redoStack.length === 0;

  // Previous/Next view - disabled (not implemented)
  if (qaPrevView) qaPrevView.disabled = true;
  if (qaNextView) qaNextView.disabled = true;
}

// Enable all buttons/inputs/styles in both contextual tabs
let _contextualTabsInitialized = false;
function initContextualTabsDisabled() {
  if (_contextualTabsInitialized) return;
  _contextualTabsInitialized = true;
  // All Format and Arrange tab controls are now implemented — enable everything
  ['tab-format', 'tab-arrange'].forEach(tabId => {
    const tab = document.getElementById(tabId);
    if (!tab) return;
    tab.querySelectorAll('button').forEach(btn => btn.disabled = false);
    tab.querySelectorAll('select').forEach(sel => sel.disabled = false);
    tab.querySelectorAll('input').forEach(inp => inp.disabled = false);
    tab.querySelectorAll('.ribbon-style-item').forEach(el => el.classList.remove('disabled'));
  });
}

// Show/hide Format and Arrange contextual ribbon tabs
export function updateContextualTabs() {
  initContextualTabsDisabled();
  const hasSelection = state.selectedAnnotations.length > 0;
  const hasLocked = hasSelection && state.selectedAnnotations.some(a => a.locked);
  const els = document.querySelectorAll('.contextual-tabs');
  els.forEach(el => {
    if (hasSelection) {
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
      // If a contextual tab was active, switch back to Home
      if (el.classList.contains('ribbon-tab') && el.classList.contains('active')) {
        el.classList.remove('active');
        const homeTab = document.querySelector('.ribbon-tab[data-tab="home"]');
        if (homeTab) homeTab.click();
      }
    }
  });
  // Disable/enable controls based on locked state
  ['tab-format', 'tab-arrange'].forEach(tabId => {
    const tab = document.getElementById(tabId);
    if (!tab) return;
    tab.querySelectorAll('button').forEach(btn => btn.disabled = hasLocked);
    tab.querySelectorAll('select').forEach(sel => sel.disabled = hasLocked);
    tab.querySelectorAll('input').forEach(inp => inp.disabled = hasLocked);
    tab.querySelectorAll('.ribbon-style-item').forEach(el => {
      if (hasLocked) el.classList.add('disabled');
      else el.classList.remove('disabled');
    });
  });
  // Sync Format ribbon controls with selection
  if (hasSelection && !hasLocked) {
    try {
      import('../../ui/chrome/format-ribbon.js').then(m => m.updateFormatRibbon());
    } catch (e) { /* ignore */ }
  }
}

// Draw grid overlay
export function drawGrid(ctx, width, height) {
  const gridSize = state.preferences.gridSize || 10;
  ctx.save();
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = 0; x <= width; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

// Snap a coordinate to the grid
export function snapToGrid(value) {
  if (!state.preferences.enableGridSnap) return value;
  const gridSize = state.preferences.gridSize || 10;
  return Math.round(value / gridSize) * gridSize;
}
