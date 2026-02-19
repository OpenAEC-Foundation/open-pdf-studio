import { state } from '../../core/state.js';

// Update status message (temporary message)
let messageTimeout = null;

export function updateStatusMessage(message, duration = 3000) {
  if (messageTimeout) {
    clearTimeout(messageTimeout);
  }

  state.statusMessage = message;
  state.statusMessageVisible = true;

  messageTimeout = setTimeout(() => {
    state.statusMessage = '';
    state.statusMessageVisible = false;
  }, duration);
}

// Kept for backward compatibility - now no-ops since StatusBar.jsx derives from state
export function updateStatusTool() {}
export function updateStatusPage() {}
export function updateStatusZoom() {}
export function updateStatusAnnotations() {}
export function updateAllStatus() {}
