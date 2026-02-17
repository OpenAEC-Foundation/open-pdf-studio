import { DEFAULT_PREFERENCES } from './constants.js';
import { state } from './state.js';
import { colorPicker, lineWidth } from '../ui/dom-elements.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';

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

// Resolve the effective theme (handles "system" by detecting OS preference)
function resolveTheme(themeName) {
  if (themeName === 'system') {
    return getSystemTheme();
  }
  return themeName;
}

// Detect OS theme using Tauri native API first, CSS media query as fallback
function getSystemTheme() {
  try {
    const win = window.__TAURI__?.window;
    if (win) {
      const theme = win.getCurrentWindow().theme();
      if (theme) return theme === 'dark' ? 'dark' : 'light';
    }
  } catch (e) { /* fall through */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Apply theme to the document
export function applyTheme(themeName) {
  const effectiveTheme = resolveTheme(themeName);
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect && themeSelect.value !== themeName) {
    themeSelect.value = themeName;
  }
}

// Listen for OS theme changes (applies when user has "System" selected)
// Tauri native listener
try {
  const win = window.__TAURI__?.window;
  if (win) {
    win.getCurrentWindow().onThemeChanged(({ payload }) => {
      if (state.preferences.theme === 'system') {
        applyTheme('system');
      }
    });
  }
} catch (e) { /* ignore */ }
// CSS fallback listener
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.preferences.theme === 'system') {
    applyTheme('system');
  }
});

// Apply preferences to the application
export function applyPreferences() {
  // Apply theme
  if (state.preferences.theme) {
    applyTheme(state.preferences.theme);
  }

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

  // General tab
  const prefThemeSelect = document.getElementById('pref-theme-select');
  if (prefThemeSelect) prefThemeSelect.value = prefs.theme || 'system';
  const restoreSessionGeneral = document.getElementById('pref-restore-session-general');
  if (restoreSessionGeneral) restoreSessionGeneral.checked = prefs.restoreLastSession;
  const authorNameGeneral = document.getElementById('pref-author-name-general');
  if (authorNameGeneral) authorNameGeneral.value = prefs.authorName;

  // Behavior tab (keep in sync with General)
  document.getElementById('pref-author-name').value = prefs.authorName;
  document.getElementById('pref-angle-snap').value = prefs.angleSnapDegrees;
  document.getElementById('pref-enable-angle-snap').checked = prefs.enableAngleSnap;
  document.getElementById('pref-grid-size').value = prefs.gridSize;
  document.getElementById('pref-enable-grid-snap').checked = prefs.enableGridSnap;
  document.getElementById('pref-show-grid').checked = prefs.showGrid;
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

  // Highlight defaults
  updateColorPicker('pref-highlight-color', 'pref-highlight-color-preview', 'pref-highlight-color-hex', prefs.highlightColor);

  // Comment/Note defaults
  updateColorPicker('pref-comment-color', 'pref-comment-color-preview', 'pref-comment-color-hex', prefs.commentColor);
  document.getElementById('pref-comment-icon').value = prefs.commentIcon;

  // Draw/Freehand defaults
  updateColorPicker('pref-draw-stroke-color', 'pref-draw-stroke-color-preview', 'pref-draw-stroke-color-hex', prefs.drawStrokeColor);
  document.getElementById('pref-draw-line-width').value = prefs.drawLineWidth;
  document.getElementById('pref-draw-opacity').value = prefs.drawOpacity;

  // Line defaults
  updateColorPicker('pref-line-stroke-color', 'pref-line-stroke-color-preview', 'pref-line-stroke-color-hex', prefs.lineStrokeColor);
  document.getElementById('pref-line-line-width').value = prefs.lineLineWidth;
  document.getElementById('pref-line-border-style').value = prefs.lineBorderStyle;
  document.getElementById('pref-line-opacity').value = prefs.lineOpacity;

  // Arrow defaults
  updateColorPicker('pref-arrow-stroke-color', 'pref-arrow-stroke-color-preview', 'pref-arrow-stroke-color-hex', prefs.arrowStrokeColor);
  updateColorPicker('pref-arrow-fill-color', 'pref-arrow-fill-color-preview', 'pref-arrow-fill-color-hex', prefs.arrowFillColor);
  document.getElementById('pref-arrow-line-width').value = prefs.arrowLineWidth;
  document.getElementById('pref-arrow-border-style').value = prefs.arrowBorderStyle;
  document.getElementById('pref-arrow-start-head').value = prefs.arrowStartHead;
  document.getElementById('pref-arrow-end-head').value = prefs.arrowEndHead;
  document.getElementById('pref-arrow-head-size').value = prefs.arrowHeadSize;
  document.getElementById('pref-arrow-opacity').value = prefs.arrowOpacity;

  // Polyline defaults
  updateColorPicker('pref-polyline-stroke-color', 'pref-polyline-stroke-color-preview', 'pref-polyline-stroke-color-hex', prefs.polylineStrokeColor);
  document.getElementById('pref-polyline-line-width').value = prefs.polylineLineWidth;
  document.getElementById('pref-polyline-opacity').value = prefs.polylineOpacity;

  // Polygon defaults
  updateColorPicker('pref-polygon-stroke-color', 'pref-polygon-stroke-color-preview', 'pref-polygon-stroke-color-hex', prefs.polygonStrokeColor);
  document.getElementById('pref-polygon-line-width').value = prefs.polygonLineWidth;
  document.getElementById('pref-polygon-opacity').value = prefs.polygonOpacity;

  // Cloud defaults
  updateColorPicker('pref-cloud-stroke-color', 'pref-cloud-stroke-color-preview', 'pref-cloud-stroke-color-hex', prefs.cloudStrokeColor);
  document.getElementById('pref-cloud-line-width').value = prefs.cloudLineWidth;
  document.getElementById('pref-cloud-opacity').value = prefs.cloudOpacity;

  // Redaction defaults
  updateColorPicker('pref-redaction-color', 'pref-redaction-color-preview', 'pref-redaction-color-hex', prefs.redactionOverlayColor);

  // Measurement defaults
  updateColorPicker('pref-measure-stroke-color', 'pref-measure-stroke-color-preview', 'pref-measure-stroke-color-hex', prefs.measureStrokeColor);
  document.getElementById('pref-measure-line-width').value = prefs.measureLineWidth;
  document.getElementById('pref-measure-opacity').value = prefs.measureOpacity;

  // Check current default PDF app
  checkDefaultPdfApp();

  // Check virtual printer status
  checkVirtualPrinterStatus();

  overlay.classList.add('visible');
}

// Check whether the virtual printer is installed and update UI
async function checkVirtualPrinterStatus() {
  const statusEl = document.getElementById('pref-vprinter-status');
  const installBtn = document.getElementById('pref-vprinter-install-btn');
  const removeBtn = document.getElementById('pref-vprinter-remove-btn');
  if (!statusEl) return;

  statusEl.textContent = 'Checking...';
  if (installBtn) installBtn.style.display = 'none';
  if (removeBtn) removeBtn.style.display = 'none';

  try {
    const { invoke } = await import('./platform.js');
    const installed = await invoke('is_virtual_printer_installed');
    if (installed) {
      statusEl.textContent = 'Installed';
      statusEl.style.color = '#2e7d32';
      if (removeBtn) removeBtn.style.display = '';
    } else {
      statusEl.textContent = 'Not installed';
      statusEl.style.color = '#666';
      if (installBtn) installBtn.style.display = '';
    }
  } catch {
    statusEl.textContent = 'Unable to detect';
    statusEl.style.color = '#888';
    if (installBtn) installBtn.style.display = '';
  }
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
            appName = 'Open PDF Studio ✓';
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

  // General tab values (take priority over Behavior tab duplicates)
  const prefThemeSelect = document.getElementById('pref-theme-select');
  if (prefThemeSelect) {
    prefs.theme = prefThemeSelect.value;
    applyTheme(prefs.theme);
    // Keep ribbon theme selector in sync
    const ribbonThemeSelect = document.getElementById('theme-select');
    if (ribbonThemeSelect) ribbonThemeSelect.value = prefs.theme;
  }
  const authorGeneral = document.getElementById('pref-author-name-general');
  if (authorGeneral) prefs.authorName = authorGeneral.value || 'User';
  const restoreGeneral = document.getElementById('pref-restore-session-general');
  if (restoreGeneral) prefs.restoreLastSession = restoreGeneral.checked;

  // Behavior tab (sync back from General)
  document.getElementById('pref-author-name').value = prefs.authorName;
  document.getElementById('pref-restore-session').checked = prefs.restoreLastSession;

  prefs.angleSnapDegrees = parseInt(document.getElementById('pref-angle-snap').value) || 30;
  prefs.enableAngleSnap = document.getElementById('pref-enable-angle-snap').checked;
  prefs.gridSize = parseInt(document.getElementById('pref-grid-size').value) || 10;
  prefs.enableGridSnap = document.getElementById('pref-enable-grid-snap').checked;
  prefs.showGrid = document.getElementById('pref-show-grid').checked;
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

  // Highlight defaults
  prefs.highlightColor = document.getElementById('pref-highlight-color').value;

  // Comment/Note defaults
  prefs.commentColor = document.getElementById('pref-comment-color').value;
  prefs.commentIcon = document.getElementById('pref-comment-icon').value;

  // Draw/Freehand defaults
  prefs.drawStrokeColor = document.getElementById('pref-draw-stroke-color').value;
  prefs.drawLineWidth = parseInt(document.getElementById('pref-draw-line-width').value) || 3;
  prefs.drawOpacity = parseInt(document.getElementById('pref-draw-opacity').value) || 100;

  // Line defaults
  prefs.lineStrokeColor = document.getElementById('pref-line-stroke-color').value;
  prefs.lineLineWidth = parseInt(document.getElementById('pref-line-line-width').value) || 2;
  prefs.lineBorderStyle = document.getElementById('pref-line-border-style').value;
  prefs.lineOpacity = parseInt(document.getElementById('pref-line-opacity').value) || 100;

  // Arrow defaults
  prefs.arrowStrokeColor = document.getElementById('pref-arrow-stroke-color').value;
  prefs.arrowFillColor = document.getElementById('pref-arrow-fill-color').value;
  prefs.arrowLineWidth = parseInt(document.getElementById('pref-arrow-line-width').value) || 2;
  prefs.arrowBorderStyle = document.getElementById('pref-arrow-border-style').value;
  prefs.arrowStartHead = document.getElementById('pref-arrow-start-head').value;
  prefs.arrowEndHead = document.getElementById('pref-arrow-end-head').value;
  prefs.arrowHeadSize = parseInt(document.getElementById('pref-arrow-head-size').value) || 12;
  prefs.arrowOpacity = parseInt(document.getElementById('pref-arrow-opacity').value) || 100;

  // Polyline defaults
  prefs.polylineStrokeColor = document.getElementById('pref-polyline-stroke-color').value;
  prefs.polylineLineWidth = parseInt(document.getElementById('pref-polyline-line-width').value) || 2;
  prefs.polylineOpacity = parseInt(document.getElementById('pref-polyline-opacity').value) || 100;

  // Polygon defaults
  prefs.polygonStrokeColor = document.getElementById('pref-polygon-stroke-color').value;
  prefs.polygonLineWidth = parseInt(document.getElementById('pref-polygon-line-width').value) || 2;
  prefs.polygonOpacity = parseInt(document.getElementById('pref-polygon-opacity').value) || 100;

  // Cloud defaults
  prefs.cloudStrokeColor = document.getElementById('pref-cloud-stroke-color').value;
  prefs.cloudLineWidth = parseInt(document.getElementById('pref-cloud-line-width').value) || 2;
  prefs.cloudOpacity = parseInt(document.getElementById('pref-cloud-opacity').value) || 100;

  // Redaction defaults
  prefs.redactionOverlayColor = document.getElementById('pref-redaction-color').value;

  // Measurement defaults
  prefs.measureStrokeColor = document.getElementById('pref-measure-stroke-color').value;
  prefs.measureLineWidth = parseInt(document.getElementById('pref-measure-line-width').value) || 1;
  prefs.measureOpacity = parseInt(document.getElementById('pref-measure-opacity').value) || 100;

  savePreferences();
  hidePreferencesDialog();
}

// Set the current annotation's style as default for its type
export function setAsDefaultStyle(annotation) {
  if (!annotation) return;
  const prefs = state.preferences;
  const type = annotation.type;

  switch (type) {
    case 'draw':
      prefs.drawStrokeColor = annotation.strokeColor || annotation.color || prefs.drawStrokeColor;
      prefs.drawLineWidth = annotation.lineWidth || prefs.drawLineWidth;
      if (annotation.opacity !== undefined) prefs.drawOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'highlight':
      prefs.highlightColor = annotation.color || annotation.fillColor || prefs.highlightColor;
      if (annotation.opacity !== undefined) prefs.highlightOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'line':
      prefs.lineStrokeColor = annotation.strokeColor || annotation.color || prefs.lineStrokeColor;
      prefs.lineLineWidth = annotation.lineWidth || prefs.lineLineWidth;
      if (annotation.borderStyle) prefs.lineBorderStyle = annotation.borderStyle;
      if (annotation.opacity !== undefined) prefs.lineOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'arrow':
      prefs.arrowStrokeColor = annotation.strokeColor || annotation.color || prefs.arrowStrokeColor;
      prefs.arrowFillColor = annotation.fillColor || prefs.arrowFillColor;
      prefs.arrowLineWidth = annotation.lineWidth || prefs.arrowLineWidth;
      if (annotation.borderStyle) prefs.arrowBorderStyle = annotation.borderStyle;
      if (annotation.startHead) prefs.arrowStartHead = annotation.startHead;
      if (annotation.endHead) prefs.arrowEndHead = annotation.endHead;
      if (annotation.headSize) prefs.arrowHeadSize = annotation.headSize;
      if (annotation.opacity !== undefined) prefs.arrowOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'box':
      prefs.rectStrokeColor = annotation.strokeColor || annotation.color || prefs.rectStrokeColor;
      prefs.rectFillColor = annotation.fillColor || prefs.rectFillColor;
      prefs.rectFillNone = !annotation.fillColor || annotation.fillColor === 'transparent' || annotation.fillColor === null;
      prefs.rectBorderWidth = annotation.lineWidth || prefs.rectBorderWidth;
      if (annotation.borderStyle) prefs.rectBorderStyle = annotation.borderStyle;
      if (annotation.opacity !== undefined) prefs.rectOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'circle':
      prefs.circleStrokeColor = annotation.strokeColor || annotation.color || prefs.circleStrokeColor;
      prefs.circleFillColor = annotation.fillColor || prefs.circleFillColor;
      prefs.circleFillNone = !annotation.fillColor || annotation.fillColor === 'transparent' || annotation.fillColor === null;
      prefs.circleBorderWidth = annotation.lineWidth || prefs.circleBorderWidth;
      if (annotation.borderStyle) prefs.circleBorderStyle = annotation.borderStyle;
      if (annotation.opacity !== undefined) prefs.circleOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'textbox':
      prefs.textboxStrokeColor = annotation.strokeColor || annotation.color || prefs.textboxStrokeColor;
      prefs.textboxFillColor = annotation.fillColor || prefs.textboxFillColor;
      prefs.textboxFillNone = !annotation.fillColor || annotation.fillColor === 'transparent';
      prefs.textboxBorderWidth = annotation.lineWidth || prefs.textboxBorderWidth;
      if (annotation.borderStyle) prefs.textboxBorderStyle = annotation.borderStyle;
      if (annotation.fontSize) prefs.textboxFontSize = annotation.fontSize;
      if (annotation.opacity !== undefined) prefs.textboxOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'callout':
      prefs.calloutStrokeColor = annotation.strokeColor || annotation.color || prefs.calloutStrokeColor;
      prefs.calloutFillColor = annotation.fillColor || prefs.calloutFillColor;
      prefs.calloutFillNone = !annotation.fillColor || annotation.fillColor === 'transparent';
      prefs.calloutBorderWidth = annotation.lineWidth || prefs.calloutBorderWidth;
      if (annotation.borderStyle) prefs.calloutBorderStyle = annotation.borderStyle;
      if (annotation.fontSize) prefs.calloutFontSize = annotation.fontSize;
      if (annotation.opacity !== undefined) prefs.calloutOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'polygon':
      prefs.polygonStrokeColor = annotation.strokeColor || annotation.color || prefs.polygonStrokeColor;
      prefs.polygonLineWidth = annotation.lineWidth || prefs.polygonLineWidth;
      if (annotation.opacity !== undefined) prefs.polygonOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'cloud':
      prefs.cloudStrokeColor = annotation.strokeColor || annotation.color || prefs.cloudStrokeColor;
      prefs.cloudLineWidth = annotation.lineWidth || prefs.cloudLineWidth;
      if (annotation.opacity !== undefined) prefs.cloudOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'comment':
      prefs.commentColor = annotation.color || prefs.commentColor;
      if (annotation.icon) prefs.commentIcon = annotation.icon;
      break;
    case 'polyline':
      prefs.polylineStrokeColor = annotation.strokeColor || annotation.color || prefs.polylineStrokeColor;
      prefs.polylineLineWidth = annotation.lineWidth || prefs.polylineLineWidth;
      if (annotation.opacity !== undefined) prefs.polylineOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'redaction':
      prefs.redactionOverlayColor = annotation.overlayColor || prefs.redactionOverlayColor;
      break;
    case 'measureDistance':
    case 'measureArea':
    case 'measurePerimeter':
      prefs.measureStrokeColor = annotation.strokeColor || annotation.color || prefs.measureStrokeColor;
      prefs.measureLineWidth = annotation.lineWidth || prefs.measureLineWidth;
      if (annotation.opacity !== undefined) prefs.measureOpacity = Math.round(annotation.opacity * 100);
      break;
  }

  savePreferences();
  updateStatusMessage('Style set as default');
}

// Reset preferences to defaults
export function resetPreferencesToDefaults() {
  if (confirm('Reset all preferences to default values?')) {
    state.preferences = { ...DEFAULT_PREFERENCES };
    savePreferences();
    showPreferencesDialog(); // Refresh the dialog
  }
}
