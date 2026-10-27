import { DEFAULT_PREFERENCES } from './constants.js';
import { state } from './state.js';
import { setColorPickerValue, setLineWidthValue, setCurrentTheme, openDialog } from '../bridge.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { changeLanguage } from '../i18n/useTranslation.js';
import { isTauri, getUsername, savePreferencesFile, loadPreferencesFile } from './platform.js';
import { preferencesMirrorJson } from './preferences-mirror.js';
import { leesOpslag, schrijfOpslag, VOORKEUREN_NAAM } from './opslag.js';
import { voegSamenMetStandaarden } from './preferences-merge.js';
import { randkleurenUitVoorkeur } from '../annotations/fill-utils.js';
import { writeStylePrefs } from './style-prefs.js';
import { prefsForStorage } from '../tools/tool-chest-session.js';
import { zetRanddikte } from '../annotations/rendering/textbox-layout.js';
import { getStyleMapping } from './stijl-mapping.js';
import { setZoomDpi, setZoomDpiSource, normalizeZoomDpi } from './zoom-display.js';
import { kalibratieVoor } from '../pdf/schermkalibratie.js';

// What 100% zoom means (#523), read live so a new calibration, a changed
// preference or a move to a screen with another scale applies at once: on a
// screen with a calibration (#520) its CSS pixels per inch (100% = the real
// paper size), otherwise the 'Screen resolution for 100% zoom' preference.
setZoomDpiSource(() => kalibratieVoor(state.preferences?.screenCalibration, globalThis.devicePixelRatio || 1)
  ?? normalizeZoomDpi(state.preferences?.zoomDpi));

// Load preferences from Rust file storage, with localStorage migration fallback
export async function loadPreferences() {
  try {
    // Try Rust-backed file storage first (survives WebView2 data clears)
    let loaded = isTauri() ? await loadPreferencesFile() : null;

    if (!loaded) {
      // Fallback: migrate from localStorage (first launch after update, or non-Tauri)
      const saved = leesOpslag(VOORKEUREN_NAAM);
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
      // Enkelpagina is de standaard-weergavemodus. 'continuous' was korte
      // tijd de default voor nieuwe installaties; omdat deze voorkeur nergens
      // in de UI instelbaar is, is een opgeslagen 'continuous' altijd die
      // oude default en geen gebruikerskeuze — terugzetten.
      if (loaded.defaultViewMode === undefined || loaded.defaultViewMode === 'continuous') {
        loaded.defaultViewMode = 'single';
      }
      // Merge with defaults to ensure all keys exist
      state.preferences = voegSamenMetStandaarden(DEFAULT_PREFERENCES, loaded);
    }

    // Persist to both storages so they stay in sync — bestand eerst,
    // spiegel apart en (in Tauri) alleen het thema (#353, zie savePreferences).
    if (isTauri()) {
      savePreferencesFile(state.preferences).catch(e =>
        console.error('Failed to save preferences file:', e)
      );
    }
    try {
      schrijfOpslag(VOORKEUREN_NAAM, preferencesMirrorJson(state.preferences, isTauri()));
    } catch (e) {
      console.warn('Voorkeuren-spiegel niet bijgewerkt (localStorage):', e);
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

// Save preferences to Rust file storage + localStorage mirror.
// VOLGORDE EN ISOLATIE (#353): het bestand is de echte opslag en gaat
// eerst; de localStorage-spiegel staat in een eigen try. De spiegel ging
// eerder vóór het bestand in dezelfde try — bij een QuotaExceededError
// (spiegel ~5 MB door gedownloade symboolcollecties) werden bestand én
// applyPreferences dan stil overgeslagen en gingen instellingen bij een
// herstart verloren. In Tauri spiegelen we bovendien alleen nog het thema
// (het enige dat het pre-boot-themascript leest) zodat het quotum niet
// eens in beeld komt.
export function savePreferences() {
  // While a Tool Chest item is active its style is a temporary overlay on
  // the preferences (#311); what is saved is the user's own value.
  const opTeSlaan = prefsForStorage(state.preferences);
  if (isTauri()) {
    savePreferencesFile(opTeSlaan).catch(e =>
      console.error('Failed to save preferences file:', e)
    );
  }
  applyPreferences();
  try {
    schrijfOpslag(VOORKEUREN_NAAM, preferencesMirrorJson(opTeSlaan, isTauri()));
  } catch (e) {
    // Alleen de pre-boot-themaflits staat op het spel — niet de instellingen.
    console.warn('Voorkeuren-spiegel niet bijgewerkt (localStorage):', e);
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

  // Screen resolution behind the 100% zoom label
  setZoomDpi(state.preferences.zoomDpi);

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

  // Unit for paper sizes in the properties panel (#598).
  import('../solid/stores/papierEenheidStore.js')
    .then((m) => m.hydratePapierEenheid())
    .catch(() => {});
}

// Show preferences dialog (bridges to Solid.js dialog)
export function showPreferencesDialog(tabName = 'general') {
  openDialog('preferences', { tab: tabName });
}

// De stijltabel per soort staat in stijl-mapping.js (zonder app-imports, #668).
export { getStyleMapping };

// Set the current annotation's style as default for its type
export function setAsDefaultStyle(annotation) {
  if (!annotation) return;
  if (!writeStylePrefs(annotation, state.preferences)) return;
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

  // Een voorkeur op 'none' geldt alleen voor soorten die zonder rand kunnen;
  // een andere soort krijgt hier een zichtbare kleur (#433).
  if (m.stroke && prefs[p + m.stroke]) {
    annotation.strokeColor = randkleurenUitVoorkeur(prefs, p, annotation.type, annotation.color).strokeColor;
  }
  if (m.color && prefs[p + m.color]) annotation.color = prefs[p + m.color];
  if (m.fill) {
    if (prefs[p + m.fillNone]) {
      annotation.fillColor = null;
    } else if (prefs[p + m.fill]) {
      annotation.fillColor = prefs[p + m.fill];
    }
  }
  if (m.width && prefs[p + m.width] != null) zetRanddikte(annotation, prefs[p + m.width]);
  if (m.borderStyle && prefs[p + m.borderStyle]) annotation.borderStyle = prefs[p + m.borderStyle];
  if (m.opacity && prefs[p + m.opacity] !== undefined) annotation.opacity = prefs[p + m.opacity] / 100;
  if (m.fillOpacity && typeof prefs[p + m.fillOpacity] === 'number') annotation.fillOpacity = prefs[p + m.fillOpacity] / 100;
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
    if (!m.noDimScale) {
      if (prefs[p + 'DimScale'] != null) annotation.measureScale = prefs[p + 'DimScale'];
      if (prefs[p + 'DimUnit']) annotation.measureUnit = prefs[p + 'DimUnit'];
    }
    if (prefs[p + 'DimPrecision'] != null) annotation.measurePrecision = prefs[p + 'DimPrecision'];
    if (prefs[p + 'DimType']) annotation.dimType = prefs[p + 'DimType'];
    if (prefs[p + 'DimExtension'] != null) annotation.dimExtension = !!prefs[p + 'DimExtension'];
  }

  if (m.edgeLengths) annotation.measureShowEdgeLengths = prefs[p + m.edgeLengths] === true;

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
