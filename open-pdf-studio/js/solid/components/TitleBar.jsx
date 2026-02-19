import { state } from '../../core/state.js';

async function handleClose() {
  const { closeActiveTab } = await import('../../ui/chrome/tabs.js');
  const { closeWindow } = await import('../../core/platform.js');
  while (state.documents.length > 0) {
    const closed = await closeActiveTab();
    if (!closed) return;
  }
  closeWindow();
}

export default function TitleBar() {
  const doc = () => state.documents[state.activeDocumentIndex];
  const fileName = () => {
    const d = doc();
    if (!d || !d.fileName) return '';
    return (d.modified ? '* ' : '') + d.fileName;
  };
  const hasPdf = () => !!state.pdfDoc;
  const undoEnabled = () => {
    const d = doc();
    return !!d && !!d.undoStack && d.undoStack.length > 0;
  };
  const redoEnabled = () => {
    const d = doc();
    return !!d && !!d.redoStack && d.redoStack.length > 0;
  };

  return (
    <div class="title-bar" data-tauri-drag-region>
      <div class="title-bar-left">
        <div class="quick-access-toolbar">
          <img src="icon.png" class="app-icon" alt="Open PDF Studio" />
          <div class="quick-access-separator"></div>

          <button class="quick-access-btn" title="Open (Ctrl+O)"
            onClick={() => import('../../pdf/loader.js').then(m => m.openPDFFile())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5z"/>
            </svg>
          </button>

          <button class="quick-access-btn" title="Save (Ctrl+S)" disabled={!hasPdf()}
            onClick={() => import('../../pdf/saver.js').then(m => m.savePDF())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12.5 14.5h-9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h7.586a1 1 0 0 1 .707.293l1.414 1.414a1 1 0 0 1 .293.707V13.5a1 1 0 0 1-1 1z"/>
              <path d="M5.5 1.5v3h4v-3"/>
              <rect x="4.5" y="8.5" width="7" height="5"/>
            </svg>
          </button>

          <button class="quick-access-btn" title="Save As (Ctrl+Shift+S)" disabled={!hasPdf()}
            onClick={() => import('../../pdf/saver.js').then(m => m.savePDFAs())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12.5 14.5h-9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h7.586a1 1 0 0 1 .707.293l1.414 1.414a1 1 0 0 1 .293.707V13.5a1 1 0 0 1-1 1z"/>
              <path d="M5.5 1.5v3h4v-3"/>
              <rect x="4.5" y="8.5" width="7" height="5"/>
              <path d="M8 6v4m0 0l-1.5-1.5M8 10l1.5-1.5"/>
            </svg>
          </button>

          <button class="quick-access-btn" title="Print (Ctrl+P)" disabled={!hasPdf()}
            onClick={() => import('../../ui/chrome/dialogs.js').then(m => m.showPrintDialog())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4.5 4.5v-2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2"/>
              <rect x="2.5" y="4.5" width="11" height="5.5" rx="1"/>
              <path d="M4.5 8.5v4a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-4"/>
            </svg>
          </button>

          <button class="quick-access-btn" title="Preferences (Ctrl+,)"
            onClick={() => import('../../core/preferences.js').then(m => m.showPreferencesDialog())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round">
              <path d="M11.9 7L13.3 6.6 13.3 9.4 11.9 9A4 4 0 0 1 10.8 10.8L11.9 11.9 9.4 13.3 9 11.9A4 4 0 0 1 7 11.9L6.6 13.3 4.1 11.9 5.2 10.8A4 4 0 0 1 4.1 9L2.7 9.4 2.7 6.6 4.1 7A4 4 0 0 1 5.2 5.2L4.1 4.1 6.6 2.7 7 4.1A4 4 0 0 1 9 4.1L9.4 2.7 11.9 4.1 10.8 5.2A4 4 0 0 1 11.9 7Z"/>
              <circle cx="8" cy="8" r="2"/>
            </svg>
          </button>

          <div class="quick-access-separator"></div>

          <button class="quick-access-btn" title="Undo (Ctrl+Z)" disabled={!undoEnabled()}
            onClick={() => import('../../core/undo-manager.js').then(m => m.undo())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 5.5h6.5a4 4 0 0 1 0 8H6"/>
              <path d="M6 2.5L3 5.5l3 3"/>
            </svg>
          </button>

          <button class="quick-access-btn" title="Redo (Ctrl+Y)" disabled={!redoEnabled()}
            onClick={() => import('../../core/undo-manager.js').then(m => m.redo())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 5.5H6.5a4 4 0 0 0 0 8H10"/>
              <path d="M10 2.5l3 3-3 3"/>
            </svg>
          </button>

          <div class="quick-access-separator"></div>

          <button class="quick-access-btn" title="Previous View" disabled>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 3L5 8l5 5"/>
            </svg>
          </button>

          <button class="quick-access-btn" title="Next View" disabled>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 3l5 5-5 5"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="title-bar-center" data-tauri-drag-region>
        <span class="app-title">Open PDF Studio</span>
        <span class="file-name">{fileName()}</span>
      </div>

      <div class="window-controls">
        <button class="window-btn" title="Minimize"
          onClick={() => import('../../core/platform.js').then(m => m.minimizeWindow())}>
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="window-btn" title="Maximize"
          onClick={() => import('../../core/platform.js').then(m => m.maximizeWindow())}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
        <button class="window-btn window-btn-close" title="Close"
          onClick={handleClose}>
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
    </div>
  );
}
