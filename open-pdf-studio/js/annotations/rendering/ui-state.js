import { state } from '../../core/state.js';
import { setContextualTabsVisible } from '../../solid/stores/ribbonStore.js';
import { syncFormatStore } from '../../solid/stores/formatStore.js';

// No-op: TitleBar.jsx now derives button states from reactive state
export function updateQuickAccessButtons() {}

// Show/hide Format and Arrange contextual ribbon tabs
export function updateContextualTabs() {
  const hasSelection = state.selectedAnnotations.length > 0;
  setContextualTabsVisible(hasSelection);
  if (hasSelection) {
    syncFormatStore(state.selectedAnnotations);
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
