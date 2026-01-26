import { DEFAULT_PREFERENCES } from './constants.js';
import { state } from './state.js';
import { colorPicker, lineWidth } from '../ui/dom-elements.js';

// Load preferences from localStorage
export function loadPreferences() {
  try {
    const saved = localStorage.getItem('pdfEditorPreferences');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge with defaults to ensure all keys exist
      state.preferences = { ...DEFAULT_PREFERENCES, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load preferences:', e);
    state.preferences = { ...DEFAULT_PREFERENCES };
  }
  applyPreferences();
}

// Save preferences to localStorage
export function savePreferences() {
  try {
    localStorage.setItem('pdfEditorPreferences', JSON.stringify(state.preferences));
    applyPreferences();
  } catch (e) {
    console.error('Failed to save preferences:', e);
  }
}

// Get system username
function getSystemUsername() {
  try {
    const os = window.require('os');
    return os.userInfo().username || 'User';
  } catch (e) {
    return 'User';
  }
}

// Apply preferences to the application
export function applyPreferences() {
  // Update default author - use system username if not customized
  const savedAuthor = state.preferences.authorName;
  if (!savedAuthor || savedAuthor === 'User') {
    state.defaultAuthor = getSystemUsername();
  } else {
    state.defaultAuthor = savedAuthor;
  }

  // Update color picker default
  if (colorPicker) {
    colorPicker.value = state.preferences.defaultAnnotationColor;
  }

  // Update line width default
  if (lineWidth) {
    lineWidth.value = state.preferences.defaultLineWidth;
  }
}

// Show preferences dialog
export function showPreferencesDialog(tabName = 'general') {
  const overlay = document.getElementById('preferences-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.preferences-dialog');
  if (dialog) {
    // Reset position to center
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
  }

  // Switch to specified tab
  document.querySelectorAll('.pref-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pref-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.pref-tab[data-pref-tab="${tabName}"]`)?.classList.add('active');
  document.getElementById(`pref-tab-${tabName}`)?.classList.add('active');

  // Helper to update color picker display
  function updateColorPicker(inputId, previewId, hexId, color) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    const hex = document.getElementById(hexId);
    if (input) input.value = color;
    if (preview) preview.style.backgroundColor = color;
    if (hex) hex.textContent = color.toUpperCase();
  }

  // Helper to update fill color picker with None option
  function updateFillColorPicker(inputId, previewId, hexId, btnId, noneId, color, isNone) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    const hex = document.getElementById(hexId);
    const btn = document.getElementById(btnId);
    const noneCheckbox = document.getElementById(noneId);

    if (input) input.value = color;
    if (preview) preview.style.backgroundColor = color;
    if (hex) hex.textContent = color.toUpperCase();
    if (noneCheckbox) noneCheckbox.checked = isNone;
    if (btn) btn.disabled = isNone;
  }

  // Populate form with current values
  const prefs = state.preferences;

  document.getElementById('pref-author-name').value = prefs.authorName;
  document.getElementById('pref-angle-snap').value = prefs.angleSnapDegrees;
  document.getElementById('pref-enable-angle-snap').checked = prefs.enableAngleSnap;
  document.getElementById('pref-grid-size').value = prefs.gridSize;
  document.getElementById('pref-enable-grid-snap').checked = prefs.enableGridSnap;
  updateColorPicker('pref-default-color', 'pref-default-color-preview', 'pref-default-color-hex', prefs.defaultAnnotationColor);
  document.getElementById('pref-default-line-width').value = prefs.defaultLineWidth;
  document.getElementById('pref-default-font-size').value = prefs.defaultFontSize;
  document.getElementById('pref-highlight-opacity').value = prefs.highlightOpacity;
  document.getElementById('pref-auto-select').checked = prefs.autoSelectAfterCreate;
  document.getElementById('pref-confirm-delete').checked = prefs.confirmBeforeDelete;
  document.getElementById('pref-restore-session').checked = prefs.restoreLastSession;

  // TextBox defaults
  updateFillColorPicker('pref-textbox-fill-color', 'pref-textbox-fill-color-preview', 'pref-textbox-fill-color-hex',
    'pref-textbox-fill-color-btn', 'pref-textbox-fill-none', prefs.textboxFillColor, prefs.textboxFillNone);
  updateColorPicker('pref-textbox-stroke-color', 'pref-textbox-stroke-color-preview', 'pref-textbox-stroke-color-hex', prefs.textboxStrokeColor);
  document.getElementById('pref-textbox-border-width').value = prefs.textboxBorderWidth;
  document.getElementById('pref-textbox-border-style').value = prefs.textboxBorderStyle;
  document.getElementById('pref-textbox-opacity').value = prefs.textboxOpacity;
  document.getElementById('pref-textbox-font-size').value = prefs.textboxFontSize;

  // Callout defaults
  updateFillColorPicker('pref-callout-fill-color', 'pref-callout-fill-color-preview', 'pref-callout-fill-color-hex',
    'pref-callout-fill-color-btn', 'pref-callout-fill-none', prefs.calloutFillColor, prefs.calloutFillNone);
  updateColorPicker('pref-callout-stroke-color', 'pref-callout-stroke-color-preview', 'pref-callout-stroke-color-hex', prefs.calloutStrokeColor);
  document.getElementById('pref-callout-border-width').value = prefs.calloutBorderWidth;
  document.getElementById('pref-callout-border-style').value = prefs.calloutBorderStyle;
  document.getElementById('pref-callout-opacity').value = prefs.calloutOpacity;
  document.getElementById('pref-callout-font-size').value = prefs.calloutFontSize;

  // Rectangle defaults
  updateFillColorPicker('pref-rect-fill-color', 'pref-rect-fill-color-preview', 'pref-rect-fill-color-hex',
    'pref-rect-fill-color-btn', 'pref-rect-fill-none', prefs.rectFillColor, prefs.rectFillNone);
  updateColorPicker('pref-rect-stroke-color', 'pref-rect-stroke-color-preview', 'pref-rect-stroke-color-hex', prefs.rectStrokeColor);
  document.getElementById('pref-rect-border-width').value = prefs.rectBorderWidth;
  document.getElementById('pref-rect-border-style').value = prefs.rectBorderStyle;
  document.getElementById('pref-rect-opacity').value = prefs.rectOpacity;

  // Circle/Ellipse defaults
  updateFillColorPicker('pref-circle-fill-color', 'pref-circle-fill-color-preview', 'pref-circle-fill-color-hex',
    'pref-circle-fill-color-btn', 'pref-circle-fill-none', prefs.circleFillColor, prefs.circleFillNone);
  updateColorPicker('pref-circle-stroke-color', 'pref-circle-stroke-color-preview', 'pref-circle-stroke-color-hex', prefs.circleStrokeColor);
  document.getElementById('pref-circle-border-width').value = prefs.circleBorderWidth;
  document.getElementById('pref-circle-border-style').value = prefs.circleBorderStyle;
  document.getElementById('pref-circle-opacity').value = prefs.circleOpacity;

  // Check current default PDF app
  checkDefaultPdfApp();

  overlay.classList.add('visible');
}

// Check which app is set as default for PDF files
async function checkDefaultPdfApp() {
  const statusEl = document.getElementById('pref-current-pdf-app');
  if (!statusEl) return;

  statusEl.textContent = 'Checking...';

  try {
    const os = require('os');
    const platform = os.platform();

    if (platform === 'win32') {
      const { exec } = require('child_process');

      // Query Windows registry for PDF file association
      exec('reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice" /v ProgId', (err, stdout) => {
        if (err) {
          statusEl.textContent = 'Unable to detect';
          return;
        }

        const match = stdout.match(/ProgId\s+REG_SZ\s+(.+)/);
        if (match) {
          let appName = match[1].trim();
          // Clean up common app identifiers
          if (appName.includes('AcroExch') || appName.includes('Acrobat')) {
            appName = 'Adobe Acrobat';
          } else if (appName.includes('Edge')) {
            appName = 'Microsoft Edge';
          } else if (appName.includes('Chrome')) {
            appName = 'Google Chrome';
          } else if (appName.includes('Firefox')) {
            appName = 'Mozilla Firefox';
          } else if (appName.includes('OpenPDFStudio') || appName.includes('open-pdf-studio')) {
            appName = 'OpenPDFStudio ✓';
          } else if (appName.includes('SumatraPDF')) {
            appName = 'SumatraPDF';
          } else if (appName.includes('FoxitReader') || appName.includes('Foxit')) {
            appName = 'Foxit Reader';
          }
          statusEl.textContent = appName;
        } else {
          statusEl.textContent = 'Not set';
        }
      });
    } else if (platform === 'darwin') {
      // macOS - would need duti or similar
      statusEl.textContent = 'Check Finder → Get Info';
    } else {
      // Linux
      const { exec } = require('child_process');
      exec('xdg-mime query default application/pdf', (err, stdout) => {
        if (err || !stdout.trim()) {
          statusEl.textContent = 'Not set';
          return;
        }
        let appName = stdout.trim().replace('.desktop', '');
        statusEl.textContent = appName;
      });
    }
  } catch (err) {
    statusEl.textContent = 'Unable to detect';
  }
}

// Hide preferences dialog
export function hidePreferencesDialog() {
  const dialog = document.getElementById('preferences-dialog');
  if (dialog) {
    dialog.classList.remove('visible');
  }
}

// Save preferences from dialog
export function savePreferencesFromDialog() {
  const prefs = state.preferences;

  prefs.authorName = document.getElementById('pref-author-name').value || 'User';
  prefs.angleSnapDegrees = parseInt(document.getElementById('pref-angle-snap').value) || 30;
  prefs.enableAngleSnap = document.getElementById('pref-enable-angle-snap').checked;
  prefs.gridSize = parseInt(document.getElementById('pref-grid-size').value) || 10;
  prefs.enableGridSnap = document.getElementById('pref-enable-grid-snap').checked;
  prefs.defaultAnnotationColor = document.getElementById('pref-default-color').value;
  prefs.defaultLineWidth = parseInt(document.getElementById('pref-default-line-width').value) || 3;
  prefs.defaultFontSize = parseInt(document.getElementById('pref-default-font-size').value) || 16;
  prefs.highlightOpacity = parseInt(document.getElementById('pref-highlight-opacity').value) || 30;
  prefs.autoSelectAfterCreate = document.getElementById('pref-auto-select').checked;
  prefs.confirmBeforeDelete = document.getElementById('pref-confirm-delete').checked;
  prefs.restoreLastSession = document.getElementById('pref-restore-session').checked;

  // TextBox defaults
  prefs.textboxFillNone = document.getElementById('pref-textbox-fill-none')?.checked || false;
  prefs.textboxFillColor = document.getElementById('pref-textbox-fill-color').value;
  prefs.textboxStrokeColor = document.getElementById('pref-textbox-stroke-color').value;
  prefs.textboxBorderWidth = parseInt(document.getElementById('pref-textbox-border-width').value) || 1;
  prefs.textboxBorderStyle = document.getElementById('pref-textbox-border-style').value;
  prefs.textboxOpacity = parseInt(document.getElementById('pref-textbox-opacity').value) || 100;
  prefs.textboxFontSize = parseInt(document.getElementById('pref-textbox-font-size').value) || 14;

  // Callout defaults
  prefs.calloutFillNone = document.getElementById('pref-callout-fill-none')?.checked || false;
  prefs.calloutFillColor = document.getElementById('pref-callout-fill-color').value;
  prefs.calloutStrokeColor = document.getElementById('pref-callout-stroke-color').value;
  prefs.calloutBorderWidth = parseInt(document.getElementById('pref-callout-border-width').value) || 1;
  prefs.calloutBorderStyle = document.getElementById('pref-callout-border-style').value;
  prefs.calloutOpacity = parseInt(document.getElementById('pref-callout-opacity').value) || 100;
  prefs.calloutFontSize = parseInt(document.getElementById('pref-callout-font-size').value) || 14;

  // Rectangle defaults
  prefs.rectFillNone = document.getElementById('pref-rect-fill-none')?.checked || false;
  prefs.rectFillColor = document.getElementById('pref-rect-fill-color').value;
  prefs.rectStrokeColor = document.getElementById('pref-rect-stroke-color').value;
  prefs.rectBorderWidth = parseInt(document.getElementById('pref-rect-border-width').value) || 2;
  prefs.rectBorderStyle = document.getElementById('pref-rect-border-style').value;
  prefs.rectOpacity = parseInt(document.getElementById('pref-rect-opacity').value) || 100;

  // Circle/Ellipse defaults
  prefs.circleFillNone = document.getElementById('pref-circle-fill-none')?.checked || false;
  prefs.circleFillColor = document.getElementById('pref-circle-fill-color').value;
  prefs.circleStrokeColor = document.getElementById('pref-circle-stroke-color').value;
  prefs.circleBorderWidth = parseInt(document.getElementById('pref-circle-border-width').value) || 2;
  prefs.circleBorderStyle = document.getElementById('pref-circle-border-style').value;
  prefs.circleOpacity = parseInt(document.getElementById('pref-circle-opacity').value) || 100;

  savePreferences();
  hidePreferencesDialog();
}

// Reset preferences to defaults
export function resetPreferencesToDefaults() {
  if (confirm('Reset all preferences to default values?')) {
    state.preferences = { ...DEFAULT_PREFERENCES };
    savePreferences();
    showPreferencesDialog(); // Refresh the dialog
  }
}
