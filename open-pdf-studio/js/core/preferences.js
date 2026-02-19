import { DEFAULT_PREFERENCES } from './constants.js';
import { state } from './state.js';
import { setColorPickerValue, setLineWidthValue, setCurrentTheme } from '../solid/stores/ribbonStore.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { openDialog } from '../solid/stores/dialogStore.js';

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
  setCurrentTheme(themeName);
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
  setColorPickerValue(state.preferences.defaultAnnotationColor);

  // Update line width default
  setLineWidthValue(state.preferences.defaultLineWidth);
}

// Show preferences dialog (bridges to Solid.js dialog)
export function showPreferencesDialog(tabName = 'general') {
  openDialog('preferences', { tab: tabName });
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
  state.preferences = { ...DEFAULT_PREFERENCES };
  savePreferences();
}
