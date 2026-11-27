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

/**
 * Clear the temporary message now. With `onlyIf`, only when the bar still
 * shows that text, so a tool can take back its own hint without wiping a
 * message something else put there since.
 */
export function clearStatusMessage(onlyIf) {
  if (onlyIf !== undefined && state.statusMessage !== onlyIf) return;
  if (messageTimeout) {
    clearTimeout(messageTimeout);
    messageTimeout = null;
  }
  state.statusMessage = '';
  state.statusMessageVisible = false;
}

// Kept for backward compatibility - now no-ops since StatusBar.jsx derives from state
export function updateStatusTool() {}
export function updateStatusPage() {}
export function updateStatusZoom() {}
export function updateStatusAnnotations() {}
export function updateAllStatus() {}
