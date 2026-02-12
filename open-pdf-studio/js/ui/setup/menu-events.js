import { state } from '../../core/state.js';
import { propertiesPanel } from '../dom-elements.js';
import { openPDFFile } from '../../pdf/loader.js';
import { savePDF, savePDFAs } from '../../pdf/saver.js';
import { showProperties, hideProperties, closePropertiesPanel } from '../panels/properties-panel.js';
import { closeAllMenus, closeBackstage } from '../chrome/menus.js';
import { showPreferencesDialog, hidePreferencesDialog, savePreferencesFromDialog, resetPreferencesToDefaults } from '../../core/preferences.js';
import { showAboutDialog, showDocPropertiesDialog } from '../chrome/dialogs.js';
import { toggleAnnotationsListPanel } from '../panels/annotations-list.js';
import { toggleLeftPanel } from '../panels/left-panel.js';
import { hasUnsavedChanges, getUnsavedDocumentNames } from '../chrome/tabs.js';
import { openFindBar } from '../../search/find-bar.js';
import { closeWindow, openExternal } from '../../core/platform.js';
import { zoomIn, zoomOut, actualSize, fitWidth, fitPage, setViewMode } from '../../pdf/renderer.js';
import { setTool } from '../../tools/manager.js';

// Setup menu event listeners
export function setupMenuEvents() {
  // Backstage file items
  document.getElementById('bs-open')?.addEventListener('click', () => {
    closeBackstage();
    openPDFFile();
  });

  document.getElementById('bs-save')?.addEventListener('click', async () => {
    closeBackstage();
    await savePDF();
  });

  document.getElementById('bs-save-as')?.addEventListener('click', async () => {
    closeBackstage();
    await savePDFAs();
  });

  document.getElementById('bs-doc-properties')?.addEventListener('click', () => {
    closeBackstage();
    showDocPropertiesDialog();
  });

  document.getElementById('bs-preferences')?.addEventListener('click', () => {
    closeBackstage();
    showPreferencesDialog();
  });

  document.getElementById('bs-about')?.addEventListener('click', () => {
    closeBackstage();
    showAboutDialog();
  });

  document.getElementById('bs-exit')?.addEventListener('click', async () => {
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

  document.getElementById('menu-continuous')?.addEventListener('click', () => {
    closeAllMenus();
    setViewMode('continuous');
  });

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
    showAboutDialog();
  });

  document.getElementById('ribbon-file-assoc')?.addEventListener('click', () => {
    showPreferencesDialog('fileassoc');
  });

  document.getElementById('ribbon-shortcuts')?.addEventListener('click', () => {
    const shortcuts = `Keyboard Shortcuts:

FILE:
Ctrl+O - Open PDF
Ctrl+S - Save
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

  document.getElementById('ribbon-check-updates')?.addEventListener('click', async () => {
    const GITHUB_REPO = 'OpenAEC-Foundation/Open-2D-Studio';
    const CURRENT_VERSION = '1.0.3';

    try {
      const btn = document.getElementById('ribbon-check-updates');
      const originalLabel = btn.querySelector('.ribbon-btn-label').textContent;
      btn.querySelector('.ribbon-btn-label').textContent = '...';
      btn.disabled = true;

      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github+json' }
      });

      if (!response.ok) {
        if (response.status === 404) {
          alert('No releases found yet.\n\nYou are running the latest development version.');
        } else {
          throw new Error(`GitHub API error: ${response.status}`);
        }
        return;
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, '');

      // Compare versions
      const current = CURRENT_VERSION.split('.').map(Number);
      const latest = latestVersion.split('.').map(Number);

      let needsUpdate = false;
      for (let i = 0; i < Math.max(current.length, latest.length); i++) {
        const c = current[i] || 0;
        const l = latest[i] || 0;
        if (l > c) { needsUpdate = true; break; }
        if (c > l) { break; }
      }

      if (needsUpdate) {
        const update = confirm(
          `A new version is available!\n\n` +
          `Current: v${CURRENT_VERSION}\n` +
          `Latest: v${latestVersion}\n\n` +
          `${release.name || ''}\n\n` +
          `Click OK to open the download page.`
        );
        if (update) {
          openExternal(release.html_url);
        }
      } else {
        alert(`You're up to date!\n\nCurrent version: v${CURRENT_VERSION}`);
      }
    } catch (err) {
      console.error('Update check failed:', err);
      alert('Failed to check for updates.\n\nPlease check your internet connection and try again.');
    } finally {
      const btn = document.getElementById('ribbon-check-updates');
      if (btn) {
        btn.querySelector('.ribbon-btn-label').textContent = 'Updates';
        btn.disabled = false;
      }
    }
  });

  // Preferences dialog buttons
  document.getElementById('pref-close-btn')?.addEventListener('click', hidePreferencesDialog);
  document.getElementById('pref-cancel-btn')?.addEventListener('click', hidePreferencesDialog);
  document.getElementById('pref-save-btn')?.addEventListener('click', savePreferencesFromDialog);
  document.getElementById('pref-reset-btn')?.addEventListener('click', resetPreferencesToDefaults);

  // Close preferences dialog when clicking overlay background
  document.getElementById('preferences-dialog')?.addEventListener('click', (e) => {
    if (e.target.id === 'preferences-dialog') {
      hidePreferencesDialog();
    }
  });

  // File association - Set as default PDF viewer
  document.getElementById('pref-set-default-app')?.addEventListener('click', async () => {
    const platform = navigator.platform.toLowerCase();

    if (platform.includes('win')) {
      // On Windows, open the Default Apps settings
      try {
        await openExternal('ms-settings:defaultapps');
        alert('Windows Settings opened.\n\nTo set OpenPDFStudio as default:\n1. Scroll down to "Choose default apps by file type"\n2. Find .pdf\n3. Click and select OpenPDFStudio');
      } catch (err) {
        alert('Could not open Windows Settings.\n\nPlease manually open Settings > Apps > Default Apps.');
      }
    } else if (platform.includes('mac')) {
      // macOS
      alert('To set OpenPDFStudio as default PDF viewer on macOS:\n\n1. Right-click any PDF file in Finder\n2. Select "Get Info"\n3. Under "Open with", select OpenPDFStudio\n4. Click "Change All..."');
    } else {
      // Linux
      alert('To set OpenPDFStudio as default PDF viewer on Linux:\n\nRun in terminal:\nxdg-mime default openpdfstudio.desktop application/pdf');
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
