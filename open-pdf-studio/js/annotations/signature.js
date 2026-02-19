import { openDialog } from '../solid/stores/dialogStore.js';

export function showSignatureDialog(x, y) {
  openDialog('signature', { x, y });
}

// No-op init (kept for backward compatibility during transition)
export function initSignatureDialog() {}
