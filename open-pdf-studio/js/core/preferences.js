import { DEFAULT_PREFERENCES } from './constants.js';
import { state } from './state.js';
import { setColorPickerValue, setLineWidthValue, setCurrentTheme, openDialog } from '../bridge.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { changeLanguage } from '../i18n/useTranslation.js';
import { isTauri, getUsername, savePreferencesFile, loadPreferencesFile } from './platform.js';

// Load preferences from Rust file storage, with localStorage migration fallback
export async function loadPreferences() {
  try {
    // Try Rust-backed file storage first (survives WebView2 data clears)
    let loaded = isTauri() ? await loadPreferencesFile() : null;

    if (!loaded) {
      // Fallback: migrate from localStorage (first launch after update, or non-Tauri)
      const saved = localStorage.getItem('pdfEditorPreferences');
      if (saved) {
        loaded = JSON.parse(saved);
      }
    }

    if (loaded) {
      // Migrate renamed themes
      if (loaded.theme === 'deep-forge') loaded.theme = 'warm-ember';
      // Standards migration: dimension ticks are open circles, not closed
      // arrows — rewrite stale saved defaults once.
      if (loaded.measureDistStartHead === 'closed') loaded.measureDistStartHead = 'openCircle';
      if (loaded.measureDistEndHead === 'closed') loaded.measureDistEndHead = 'openCircle';
      // Angle snap: old default 30° → 45° (Shift snapt dan ook diagonaal).
      // Only the stale default is rewritten; a custom value stays.
      if (loaded.angleSnapDegrees === 30) loaded.angleSnapDegrees = 45;
      // Tekstvak: oude default was géén vulling (crèmekleur ongebruikt) —
      // nieuwe default is wit. Alleen de onaangeroerde oude default-combinatie
      // wordt herschreven; wie zelf een kleur of vulling koos, behoudt die.
      if (loaded.textboxFillNone === true && loaded.textboxFillColor === '#FFFBEB') {
        loaded.textboxFillNone = false;
        loaded.textboxFillColor = '#FFFFFF';
      }
      // Tekstvak: oude standaard-tekstgrootte 14 → 8 (alleen de onaangeroerde
      // oude default; een zelfgekozen grootte blijft staan).
      if (loaded.textboxFontSize === 14) loaded.textboxFontSize = 8;
      // Doorlopende leesmodus werd de standaard voor NIEUWE installaties.
      // Een bestaande installatie (er zijn al opgeslagen voorkeuren, maar
      // nog zonder defaultViewMode) behoudt eenmalig het oude gedrag.
      if (loaded.defaultViewMode === undefined) loaded.defaultViewMode = 'single';
      // Merge with defaults to ensure all keys exist
      state.preferences = { ...DEFAULT_PREFERENCES, ...loaded };
    }

    // Persist to both storages so they stay in sync
    const json = JSON.stringify(state.preferences);
    localStorage.setItem('pdfEditorPreferences', json);
    if (isTauri()) {
      savePreferencesFile(state.preferences).catch(e =>
        console.error('Failed to save preferences file:', e)
      );
    }
  } catch (e) {
    console.error('Failed to load preferences:', e);
    state.preferences = { ...DEFAULT_PREFERENCES };
  }

  // If authorName is empty (first launch or reset), resolve to OS login username
  if (!state.preferences.authorName) {
    try {
      const username = isTauri() ? await getUsername() : 'User';
      state.preferences.authorName = username;
    } catch (e) {
      state.preferences.authorName = 'User';
    }
  }

  applyPreferences();
}

// Save preferences to Rust file storage + localStorage mirror
export function savePreferences() {
  try {
    const json = JSON.stringify(state.preferences);
    // localStorage mirror for synchronous theme script in index.html
    localStorage.setItem('pdfEditorPreferences', json);
    // Rust-backed persistent storage
    if (isTauri()) {
      savePreferencesFile(state.preferences).catch(e =>
        console.error('Failed to save preferences file:', e)
      );
    }
    applyPreferences();
  } catch (e) {
    console.error('Failed to save preferences:', e);
  }
}

// Cached system theme from Tauri API (updated by onThemeChanged listener)
let cachedSystemTheme = null;

// Detect OS theme using Tauri Window API (reliable), with matchMedia fallback
function getSystemTheme() {
  if (cachedSystemTheme) return cachedSystemTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Resolve the effective theme (handles "system" by detecting OS preference)
function resolveTheme(themeName) {
  if (themeName === 'system') {
    return getSystemTheme();
  }
  return themeName;
}

// Apply theme to the document
export function applyTheme(themeName) {
  const effectiveTheme = resolveTheme(themeName);
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  setCurrentTheme(themeName);
}

// Initialize theme change listener using Tauri API (more reliable than matchMedia)
async function initThemeListener() {
  if (isTauri() && window.__TAURI__?.window) {
    try {
      const appWindow = window.__TAURI__.window.getCurrentWindow();
      cachedSystemTheme = await appWindow.theme();
      appWindow.onThemeChanged(({ payload: theme }) => {
        cachedSystemTheme = theme;
        if (state.preferences.theme === 'system') {
          applyTheme('system');
        }
      });
    } catch (e) {
      console.warn('Tauri theme API unavailable, using matchMedia fallback');
    }
  }

  // Fallback listener for non-Tauri or if Tauri API fails
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!cachedSystemTheme && state.preferences.theme === 'system') {
      applyTheme('system');
    }
  });
}

initThemeListener();

// Apply preferences to the application
export function applyPreferences() {
  // Apply theme
  if (state.preferences.theme) {
    applyTheme(state.preferences.theme);
  }

  // Update default author from preferences
  state.defaultAuthor = state.preferences.authorName || 'User';

  // Update color picker default
  setColorPickerValue(state.preferences.defaultAnnotationColor);

  // Update line width default
  setLineWidthValue(state.preferences.defaultLineWidth);

  // Apply language
  changeLanguage(state.preferences.language || 'auto');

  // Apply the opt-in PrtScn global hotkey for screenshot-annotate mode
  // (lazy import to avoid a static import cycle with the loader/tools layer).
  import('../tools/screenshot-annotate.js')
    .then((m) => m.applyPrintScreenHotkeyPref())
    .catch(() => {});
}

// Show preferences dialog (bridges to Solid.js dialog)
export function showPreferencesDialog(tabName = 'general') {
  openDialog('preferences', { tab: tabName });
}

// Map annotation type to preference key prefix and property mappings
export function getStyleMapping(type) {
  const hasHatch = ['box', 'circle', 'polygon', 'cloud'].includes(type);
  switch (type) {
    case 'draw':
      return { prefix: 'draw', stroke: 'StrokeColor', width: 'LineWidth', opacity: 'Opacity' };
    case 'highlight':
      return { prefix: 'highlight', color: 'Color', opacity: 'Opacity' };
    case 'line':
      return { prefix: 'line', stroke: 'StrokeColor', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity' };
    case 'arrow':
      return { prefix: 'arrow', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', startHead: 'StartHead', endHead: 'EndHead', headSize: 'HeadSize' };
    case 'box':
      return { prefix: 'rect', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'BorderWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', hatch: hasHatch };
    case 'circle':
      return { prefix: 'circle', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'BorderWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', hatch: hasHatch };
    case 'textbox':
      return { prefix: 'textbox', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'BorderWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', fontSize: 'FontSize' };
    case 'callout':
      return { prefix: 'callout', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'BorderWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', fontSize: 'FontSize' };
    case 'polygon':
      return { prefix: 'polygon', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', hatch: hasHatch };
    case 'cloud':
      return { prefix: 'cloud', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', hatch: hasHatch };
    case 'comment':
      return { prefix: 'comment', color: 'Color', icon: 'Icon' };
    case 'polyline':
      return { prefix: 'polyline', stroke: 'StrokeColor', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity' };
    case 'filledArea':
      // Keys match what filled-area-tool.js reads at draw time
      // (filledAreaStrokeColor, filledAreaHatchPattern, …).
      return { prefix: 'filledArea', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', hatch: true };
    case 'redaction':
      return { prefix: 'redaction', overlayColor: 'OverlayColor' };
    case 'measureDistance':
      return { prefix: 'measureDist', stroke: 'StrokeColor', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', startHead: 'StartHead', endHead: 'EndHead', headSize: 'HeadSize', fontSize: 'FontSize', dimension: true };
    case 'measureArea':
      return { prefix: 'measureArea', stroke: 'StrokeColor', fill: 'FillColor', fillNone: 'FillNone', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', dimension: true };
    case 'measurePerimeter':
      return { prefix: 'measurePerim', stroke: 'StrokeColor', width: 'LineWidth', borderStyle: 'BorderStyle', opacity: 'Opacity', startHead: 'StartHead', endHead: 'EndHead', headSize: 'HeadSize', dimension: true };
    default:
      return null;
  }
}

// Set the current annotation's style as default for its type
export function setAsDefaultStyle(annotation) {
  if (!annotation) return;
  const prefs = state.preferences;
  const m = getStyleMapping(annotation.type);
  if (!m) return;

  const p = m.prefix;

  if (m.stroke) prefs[p + m.stroke] = annotation.strokeColor || annotation.color || prefs[p + m.stroke];
  if (m.color) prefs[p + m.color] = annotation.color || annotation.fillColor || prefs[p + m.color];
  if (m.fill) {
    prefs[p + m.fill] = annotation.fillColor || prefs[p + m.fill];
    if (m.fillNone) prefs[p + m.fillNone] = !annotation.fillColor || annotation.fillColor === 'transparent' || annotation.fillColor === 'none' || annotation.fillColor === null;
  }
  if (m.width) prefs[p + m.width] = annotation.lineWidth ?? prefs[p + m.width];
  if (m.borderStyle && annotation.borderStyle) prefs[p + m.borderStyle] = annotation.borderStyle;
  if (m.opacity && annotation.opacity !== undefined) prefs[p + m.opacity] = Math.round(annotation.opacity * 100);
  if (m.startHead && annotation.startHead) prefs[p + m.startHead] = annotation.startHead;
  if (m.endHead && annotation.endHead) prefs[p + m.endHead] = annotation.endHead;
  if (m.headSize && annotation.headSize) prefs[p + m.headSize] = annotation.headSize;
  if (m.fontSize && annotation.fontSize) prefs[p + m.fontSize] = annotation.fontSize;
  if (m.icon && annotation.icon) prefs[p + m.icon] = annotation.icon;
  if (m.overlayColor) prefs[p + m.overlayColor] = annotation.overlayColor || prefs[p + m.overlayColor];

  // Hatch properties
  if (m.hatch) {
    if (annotation.hatchPattern) prefs[p + 'HatchPattern'] = annotation.hatchPattern;
    if (annotation.hatchColor) prefs[p + 'HatchColor'] = annotation.hatchColor;
    if (annotation.hatchScale != null) prefs[p + 'HatchScale'] = annotation.hatchScale;
  }

  // Generic style-type preset id (see annotations/style-types.js) — '' = custom.
  prefs[p + 'StyleType'] = annotation.styleType || '';

  // Dimension measurement properties (use 'Dim' prefix to avoid clash with global measureScale object)
  if (m.dimension) {
    if (annotation.measureScale != null) prefs[p + 'DimScale'] = annotation.measureScale;
    if (annotation.measureUnit) prefs[p + 'DimUnit'] = annotation.measureUnit;
    if (annotation.measurePrecision != null) prefs[p + 'DimPrecision'] = annotation.measurePrecision;
    // Dimension type preset (1.8/2.5/3.5/5.0 mm) — '' means custom.
    prefs[p + 'DimType'] = annotation.dimType || '';
    prefs[p + 'DimExtension'] = !!annotation.dimExtension;
  }

  savePreferences();
  updateStatusMessage('Style set as default');
}

// Apply saved default style to an annotation
export function applyDefaultStyle(annotation) {
  if (!annotation) return;
  const prefs = state.preferences;
  const m = getStyleMapping(annotation.type);
  if (!m) return;

  const p = m.prefix;

  if (m.stroke && prefs[p + m.stroke]) annotation.strokeColor = prefs[p + m.stroke];
  if (m.color && prefs[p + m.color]) annotation.color = prefs[p + m.color];
  if (m.fill) {
    if (prefs[p + m.fillNone]) {
      annotation.fillColor = null;
    } else if (prefs[p + m.fill]) {
      annotation.fillColor = prefs[p + m.fill];
    }
  }
  if (m.width && prefs[p + m.width] != null) annotation.lineWidth = prefs[p + m.width];
  if (m.borderStyle && prefs[p + m.borderStyle]) annotation.borderStyle = prefs[p + m.borderStyle];
  if (m.opacity && prefs[p + m.opacity] !== undefined) annotation.opacity = prefs[p + m.opacity] / 100;
  if (m.startHead && prefs[p + m.startHead]) annotation.startHead = prefs[p + m.startHead];
  if (m.endHead && prefs[p + m.endHead]) annotation.endHead = prefs[p + m.endHead];
  if (m.headSize && prefs[p + m.headSize]) annotation.headSize = prefs[p + m.headSize];
  if (m.fontSize && prefs[p + m.fontSize]) annotation.fontSize = prefs[p + m.fontSize];
  if (m.icon && prefs[p + m.icon]) annotation.icon = prefs[p + m.icon];
  if (m.overlayColor && prefs[p + m.overlayColor]) annotation.overlayColor = prefs[p + m.overlayColor];

  // Hatch properties
  if (m.hatch) {
    if (prefs[p + 'HatchPattern']) annotation.hatchPattern = prefs[p + 'HatchPattern'];
    if (prefs[p + 'HatchColor']) annotation.hatchColor = prefs[p + 'HatchColor'];
    if (prefs[p + 'HatchScale'] != null) annotation.hatchScale = prefs[p + 'HatchScale'];
  }

  // Generic style-type preset id round-trip.
  if (prefs[p + 'StyleType']) annotation.styleType = prefs[p + 'StyleType'];

  // Dimension measurement properties (use 'Dim' prefix to avoid clash with global measureScale object)
  if (m.dimension) {
    if (prefs[p + 'DimScale'] != null) annotation.measureScale = prefs[p + 'DimScale'];
    if (prefs[p + 'DimUnit']) annotation.measureUnit = prefs[p + 'DimUnit'];
    if (prefs[p + 'DimPrecision'] != null) annotation.measurePrecision = prefs[p + 'DimPrecision'];
    if (prefs[p + 'DimType']) annotation.dimType = prefs[p + 'DimType'];
    if (prefs[p + 'DimExtension'] != null) annotation.dimExtension = !!prefs[p + 'DimExtension'];
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Reset preferences to defaults
export async function resetPreferencesToDefaults() {
  state.preferences = { ...DEFAULT_PREFERENCES };
  // Restore OS username as default author
  try {
    const username = isTauri() ? await getUsername() : 'User';
    state.preferences.authorName = username;
  } catch (e) {
    state.preferences.authorName = 'User';
  }
  savePreferences();
}
