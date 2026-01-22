import { loadingOverlay, loadingText, aboutDialog } from './dom-elements.js';

// Show loading overlay
export function showLoading(message = 'Loading...') {
  if (loadingText) {
    loadingText.textContent = message;
  }
  if (loadingOverlay) {
    loadingOverlay.classList.add('visible');
  }
}

// Hide loading overlay
export function hideLoading() {
  if (loadingOverlay) {
    loadingOverlay.classList.remove('visible');
  }
}

// Show about dialog
export function showAboutDialog() {
  if (aboutDialog) {
    aboutDialog.classList.add('visible');
  }
}

// Hide about dialog
export function hideAboutDialog() {
  if (aboutDialog) {
    aboutDialog.classList.remove('visible');
  }
}

// Initialize about dialog
export function initAboutDialog() {
  const closeBtn = aboutDialog?.querySelector('.about-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideAboutDialog);
  }

  // Close when clicking overlay background
  if (aboutDialog) {
    aboutDialog.addEventListener('click', (e) => {
      if (e.target === aboutDialog) {
        hideAboutDialog();
      }
    });
  }

  // Close with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aboutDialog?.classList.contains('visible')) {
      hideAboutDialog();
    }
  });
}
