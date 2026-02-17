import { state } from '../../core/state.js';
import { propertiesPanel } from '../dom-elements.js';
import { openPDFFile } from '../../pdf/loader.js';
import { savePDF, savePDFAs } from '../../pdf/saver.js';
import { showProperties, hideProperties, closePropertiesPanel } from '../panels/properties-panel.js';
import { closeAllMenus, closeBackstage, openBackstage } from '../chrome/menus.js';
import { showPreferencesDialog, hidePreferencesDialog, savePreferencesFromDialog, resetPreferencesToDefaults } from '../../core/preferences.js';
import { showDocPropertiesDialog, showNewDocDialog, showImportPanel, hideImportPanel, showExportPanel, hideExportPanel, showAboutPanel, hideAboutPanel } from '../chrome/dialogs.js';
import { toggleAnnotationsListPanel } from '../panels/annotations-list.js';
import { toggleLeftPanel } from '../panels/left-panel.js';
import { hasUnsavedChanges, getUnsavedDocumentNames } from '../chrome/tabs.js';
import { openFindBar } from '../../search/find-bar.js';
import { closeWindow, openExternal } from '../../core/platform.js';
import { zoomIn, zoomOut, actualSize, fitWidth, fitPage, setViewMode } from '../../pdf/renderer.js';
import { setTool } from '../../tools/manager.js';

// Setup menu event listeners
export function setupMenuEvents() {
  // Helper to hide all backstage content panels
  function hideAllBsPanels() {
    hideImportPanel();
    hideExportPanel();
    hideAboutPanel();
  }

  // Backstage file items
  document.getElementById('bs-new')?.addEventListener('click', () => {
    hideAllBsPanels();
    closeBackstage();
    showNewDocDialog();
  });

  document.getElementById('bs-open')?.addEventListener('click', () => {
    hideAllBsPanels();
    closeBackstage();
    openPDFFile();
  });

  document.getElementById('bs-save')?.addEventListener('click', async () => {
    hideAllBsPanels();
    closeBackstage();
    await savePDF();
  });

  document.getElementById('bs-save-as')?.addEventListener('click', async () => {
    hideAllBsPanels();
    closeBackstage();
    await savePDFAs();
  });

  document.getElementById('bs-print')?.addEventListener('click', () => {
    hideAllBsPanels();
    closeBackstage();
    import('../chrome/dialogs.js').then(({ showPrintDialog }) => showPrintDialog());
  });

  document.getElementById('bs-export')?.addEventListener('click', () => {
    hideImportPanel();
    hideAboutPanel();
    showExportPanel();
  });

  document.getElementById('bs-import')?.addEventListener('click', () => {
    hideExportPanel();
    hideAboutPanel();
    showImportPanel();
  });

  document.getElementById('bs-doc-properties')?.addEventListener('click', () => {
    hideAllBsPanels();
    closeBackstage();
    showDocPropertiesDialog();
  });

  document.getElementById('bs-preferences')?.addEventListener('click', () => {
    hideAllBsPanels();
    closeBackstage();
    showPreferencesDialog();
  });

  document.getElementById('bs-about')?.addEventListener('click', () => {
    hideImportPanel();
    hideExportPanel();
    showAboutPanel();
  });

  document.getElementById('bs-exit')?.addEventListener('click', async () => {
    hideAllBsPanels();
    closeBackstage();
    if (hasUnsavedChanges()) {
      const names = getUnsavedDocumentNames().join(', ');
      let result = false;
      if (window.__TAURI__?.dialog?.ask) {
        result = await window.__TAURI__.dialog.ask(
          `The following files have unsaved changes:\n${names}\n\nDo you want to exit without saving?`,
          { title: 'Unsaved Changes', kind: 'warning' }
        );
      } else {
        result = confirm(`The following files have unsaved changes:\n${names}\n\nDo you want to exit without saving?`);
      }
      if (!result) return;
    }
    closeWindow();
  });

  // Ribbon Find button
  document.getElementById('ribbon-find')?.addEventListener('click', () => {
    openFindBar();
  });

  // View menu
  document.getElementById('menu-zoom-in')?.addEventListener('click', () => {
    closeAllMenus();
    zoomIn();
  });

  document.getElementById('menu-zoom-out')?.addEventListener('click', () => {
    closeAllMenus();
    zoomOut();
  });

  document.getElementById('menu-actual-size')?.addEventListener('click', () => {
    closeAllMenus();
    actualSize();
  });

  document.getElementById('menu-fit-width')?.addEventListener('click', () => {
    closeAllMenus();
    fitWidth();
  });

  document.getElementById('menu-fit-page')?.addEventListener('click', () => {
    closeAllMenus();
    fitPage();
  });

  document.getElementById('menu-single-page')?.addEventListener('click', () => {
    closeAllMenus();
    setViewMode('single');
  });

  // Continuous mode disabled — needs further work
  // document.getElementById('menu-continuous')?.addEventListener('click', () => {
  //   closeAllMenus();
  //   setViewMode('continuous');
  // });

  document.getElementById('menu-show-left-panel')?.addEventListener('click', () => {
    closeAllMenus();
    toggleLeftPanel();
  });

  document.getElementById('menu-show-properties')?.addEventListener('click', () => {
    closeAllMenus();
    if (propertiesPanel?.classList.contains('visible')) {
      closePropertiesPanel();
    } else {
      propertiesPanel.classList.add('visible');
      if (state.selectedAnnotation) {
        showProperties(state.selectedAnnotation);
      } else {
        hideProperties();
      }
    }
  });

  document.getElementById('menu-show-annotations-list')?.addEventListener('click', () => {
    closeAllMenus();
    toggleAnnotationsListPanel();
  });

  // Tools menu
  document.getElementById('menu-tool-select')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('select');
  });

  document.getElementById('menu-tool-hand')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('hand');
  });

  document.getElementById('menu-tool-highlight')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('highlight');
  });

  document.getElementById('menu-tool-draw')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('draw');
  });

  document.getElementById('menu-tool-line')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('line');
  });

  document.getElementById('menu-tool-box')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('box');
  });

  document.getElementById('menu-tool-circle')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('circle');
  });

  document.getElementById('menu-tool-text')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('textbox');
  });

  document.getElementById('menu-tool-comment')?.addEventListener('click', () => {
    closeAllMenus();
    setTool('comment');
  });

  // Help ribbon buttons
  document.getElementById('ribbon-about')?.addEventListener('click', () => {
    openBackstage();
    showAboutPanel();
  });

  document.getElementById('ribbon-file-assoc')?.addEventListener('click', () => {
    showPreferencesDialog('fileassoc');
  });

  document.getElementById('ribbon-shortcuts')?.addEventListener('click', () => {
    const shortcuts = `Keyboard Shortcuts:

FILE:
Ctrl+N - New Document
Ctrl+O - Open PDF
Ctrl+S - Save
Ctrl+P - Print
Ctrl+W - Close

EDIT:
Ctrl+Z - Undo
Ctrl+Y / Ctrl+Shift+Z - Redo
Delete - Delete selected annotation
Ctrl+Shift+C - Clear page annotations

VIEW:
Ctrl++ - Zoom In
Ctrl+- - Zoom Out
Ctrl+0 - Actual Size
Ctrl+1 - Fit Width
Ctrl+2 - Fit Page

TOOLS:
V - Select Tool
1 - Highlight
2 - Freehand
3 - Line
4 - Rectangle
5 - Ellipse
T - Text Box
N - Note`;
    alert(shortcuts);
  });


  // Preferences dialog buttons
  document.getElementById('pref-close-btn')?.addEventListener('click', hidePreferencesDialog);
  document.getElementById('pref-cancel-btn')?.addEventListener('click', hidePreferencesDialog);
  document.getElementById('pref-save-btn')?.addEventListener('click', savePreferencesFromDialog);
  document.getElementById('pref-reset-btn')?.addEventListener('click', resetPreferencesToDefaults);


  // File association - Set as default PDF viewer
  document.getElementById('pref-set-default-app')?.addEventListener('click', async () => {
    const platform = navigator.platform.toLowerCase();

    if (platform.includes('win')) {
      // On Windows, open the Default Apps settings
      try {
        await openExternal('ms-settings:defaultapps');
        alert('Windows Settings opened.\n\nTo set Open PDF Studio as default:\n1. Scroll down to "Choose default apps by file type"\n2. Find .pdf\n3. Click and select Open PDF Studio');
      } catch (err) {
        alert('Could not open Windows Settings.\n\nPlease manually open Settings > Apps > Default Apps.');
      }
    } else if (platform.includes('mac')) {
      // macOS
      alert('To set Open PDF Studio as default PDF viewer on macOS:\n\n1. Right-click any PDF file in Finder\n2. Select "Get Info"\n3. Under "Open with", select Open PDF Studio\n4. Click "Change All..."');
    } else {
      // Linux
      alert('To set Open PDF Studio as default PDF viewer on Linux:\n\nRun in terminal:\nxdg-mime default openpdfstudio.desktop application/pdf');
    }
  });

  // Virtual Printer - Install button
  document.getElementById('pref-vprinter-install-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('pref-vprinter-status');
    const installBtn = document.getElementById('pref-vprinter-install-btn');
    const removeBtn = document.getElementById('pref-vprinter-remove-btn');

    if (statusEl) statusEl.textContent = 'Installing...';
    if (installBtn) installBtn.disabled = true;

    try {
      const { invoke } = await import('../../core/platform.js');
      await invoke('install_virtual_printer');
      if (statusEl) { statusEl.textContent = 'Installed'; statusEl.style.color = '#2e7d32'; }
      if (installBtn) { installBtn.style.display = 'none'; installBtn.disabled = false; }
      if (removeBtn) removeBtn.style.display = '';
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Installation failed'; statusEl.style.color = '#c62828'; }
      if (installBtn) installBtn.disabled = false;
      alert('Failed to install virtual printer:\n' + (err.message || err));
    }
  });

  // Virtual Printer - Remove button
  document.getElementById('pref-vprinter-remove-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('pref-vprinter-status');
    const installBtn = document.getElementById('pref-vprinter-install-btn');
    const removeBtn = document.getElementById('pref-vprinter-remove-btn');

    if (statusEl) statusEl.textContent = 'Removing...';
    if (removeBtn) removeBtn.disabled = true;

    try {
      const { invoke } = await import('../../core/platform.js');
      await invoke('remove_virtual_printer');
      if (statusEl) { statusEl.textContent = 'Not installed'; statusEl.style.color = '#666'; }
      if (removeBtn) { removeBtn.style.display = 'none'; removeBtn.disabled = false; }
      if (installBtn) installBtn.style.display = '';
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Removal failed'; statusEl.style.color = '#c62828'; }
      if (removeBtn) removeBtn.disabled = false;
      alert('Failed to remove virtual printer:\n' + (err.message || err));
    }
  });

  // Setup fill None checkbox handlers
  setupFillNoneCheckboxes();
}

// Setup fill color "None" checkboxes
function setupFillNoneCheckboxes() {
  const pairs = [
    ['pref-textbox-fill-none', 'pref-textbox-fill-color'],
    ['pref-callout-fill-none', 'pref-callout-fill-color'],
    ['pref-rect-fill-none', 'pref-rect-fill-color'],
    ['pref-circle-fill-none', 'pref-circle-fill-color']
  ];

  pairs.forEach(([checkboxId, colorInputId]) => {
    const checkbox = document.getElementById(checkboxId);
    const colorInput = document.getElementById(colorInputId);
    if (checkbox && colorInput) {
      checkbox.addEventListener('change', () => {
        colorInput.disabled = checkbox.checked;
      });
    }
  });
}
