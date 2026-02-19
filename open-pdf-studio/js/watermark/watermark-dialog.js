import { openDialog } from '../solid/stores/dialogStore.js';

// Bridge functions — open Solid.js dialogs
export function showWatermarkDialog(editWm = null) {
  openDialog('watermark', { editWm });
}

export function showHeaderFooterDialog(editWm = null) {
  openDialog('header-footer', { editWm });
}

export function showManageWatermarksDialog() {
  openDialog('manage-watermarks');
}

// No-op init functions (kept for backward compatibility during transition)
export function initWatermarkDialog() {}
export function initHeaderFooterDialog() {}
export function initManageWatermarksDialog() {}
