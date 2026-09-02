import { createSignal, createMemo } from 'solid-js';
import { BUILT_IN_CATEGORIES } from '../data/symbolLibrary.js';
import { NEN1414_CATEGORIES } from '../data/nen1414Library.js';
import { NL_CATEGORIES } from '../data/nlSymbolLibrary.js';
import { INB_CATEGORIES } from '../data/inbSymbolLibrary.js';
import { matchesLocale, DEFAULT_INDUSTRY, DEFAULT_COUNTRY } from '../data/symbolLocales.js';
import { state } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';
import { registerPaletteDock } from './paletteOrder.js';
import { removeSteelCatalog } from '../../symbols/steel-catalog-store.js';
import { removeLineworkCatalog } from '../../symbols/linework-catalog-store.js';

// --- State ---
const [searchQuery, setSearchQuery] = createSignal('');
const [expandedCategories, setExpandedCategories] = createSignal(new Set(['electrical']));
const [symbolPaletteVisible, setSymbolPaletteVisibleRaw] = createSignal(true);
const [symbolPaletteMode, setSymbolPaletteModeRaw] = createSignal('docked-right');
const [symbolFloatPos, setSymbolFloatPos] = createSignal({ x: 300, y: 150 });
const [settingsOpen, setSettingsOpen] = createSignal(false);
const [disabledGroups, setDisabledGroupsRaw] = createSignal(new Set());
const [selectedIndustry, setSelectedIndustryRaw] = createSignal(DEFAULT_INDUSTRY);
const [selectedCountry, setSelectedCountryRaw] = createSignal(DEFAULT_COUNTRY);

function setSelectedIndustry(id) {
  setSelectedIndustryRaw(id);
  state.preferences.symbolLibraryIndustry = id;
  savePreferences();
}

function setSelectedCountry(id) {
  setSelectedCountryRaw(id);
  state.preferences.symbolLibraryCountry = id;
  savePreferences();
}

function setDisabledGroups(groups) {
  const s = groups instanceof Set ? groups : new Set(groups);
  setDisabledGroupsRaw(s);
  state.preferences.disabledSymbolGroups = [...s];
  savePreferences();
}

function toggleGroupEnabled(id) {
  const s = new Set(disabledGroups());
  if (s.has(id)) s.delete(id); else s.add(id);
  setDisabledGroups(s);
}

function isGroupEnabled(id) {
  return !disabledGroups().has(id);
}

// --- Symbol type overrides (user-edited geometry) ---
// Palette stamps carry no stable symbolId — a placed type is identified by its
// source SVG string. We key overrides by a short deterministic hash of that
// original SVG so the same type always resolves to the same edited geometry.
function symbolTypeKey(svg) {
  if (!svg) return null;
  // Normalize insignificant whitespace so cosmetically-different but identical
  // sources hash the same.
  const s = String(svg).replace(/\s+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return 'sym_' + (h >>> 0).toString(36);
}

function getSymbolTypeOverrides() {
  return state.preferences.symbolTypeOverrides || {};
}

// Resolve the effective SVG for a symbol type: returns the user override when
// one exists for this source SVG, otherwise the original SVG unchanged.
function resolveSymbolSvg(originalSvg) {
  const key = symbolTypeKey(originalSvg);
  if (!key) return originalSvg;
  const ov = getSymbolTypeOverrides()[key];
  return ov && ov.svg ? ov.svg : originalSvg;
}

// Persist an edited type. baseSvg is the ORIGINAL source SVG (used for the key)
// so future edits of an already-edited stamp still map back to the same type.
function setSymbolTypeOverride(baseSvg, svg, name) {
  const key = symbolTypeKey(baseSvg);
  if (!key) return null;
  const overrides = { ...getSymbolTypeOverrides() };
  overrides[key] = { svg, name: name || overrides[key]?.name || 'Symbol' };
  state.preferences.symbolTypeOverrides = overrides;
  savePreferences();
  return key;
}

// --- Custom groups stored in preferences ---
function getCustomGroups() {
  return state.preferences.customSymbolGroups || [];
}

function setCustomGroups(groups) {
  state.preferences.customSymbolGroups = groups;
  savePreferences();
}

// --- All categories (built-in + custom) ---
const allCategories = createMemo(() => {
  const custom = getCustomGroups().map(g => ({
    ...g,
    builtin: false,
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><line x1="8" y1="5" x2="8" y2="11"/><line x1="5" y1="8" x2="11" y2="8"/></svg>`,
  }));
  return [
    ...NL_CATEGORIES,
    ...INB_CATEGORIES,
    ...BUILT_IN_CATEGORIES,
    ...NEN1414_CATEGORIES,
    ...custom
  ];
});

// --- Filtered categories based on search + enabled state + locale ---
const filteredCategories = createMemo(() => {
  const q = searchQuery().toLowerCase().trim();
  const disabled = disabledGroups();
  const industry = selectedIndustry();
  const country = selectedCountry();
  let cats = allCategories()
    .filter(c => !disabled.has(c.id))
    .filter(c => matchesLocale(c, industry, country));
  if (q) {
    cats = cats
      .map(cat => ({
        ...cat,
        symbols: cat.symbols.filter(s =>
          s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
        )
      }))
      .filter(cat => cat.symbols.length > 0);
  }
  return cats;
});

// --- Category expand/collapse ---
function toggleCategory(id) {
  setExpandedCategories(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function isCategoryExpanded(id) {
  return expandedCategories().has(id);
}

// --- Custom group CRUD ---
function addCustomGroup(name) {
  const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const groups = [...getCustomGroups(), { id, name, industry: selectedIndustry(), country: selectedCountry(), symbols: [] }];
  setCustomGroups(groups);
  // Auto-expand new group
  setExpandedCategories(prev => {
    const next = new Set(prev);
    next.add(id);
    return next;
  });
  return id;
}

function removeCustomGroup(id) {
  const group = getCustomGroups().find(g => g.id === id);
  setCustomGroups(getCustomGroups().filter(g => g.id !== id));
  // Bibliotheek-groep met parametrische staalcatalogus: ook de geregistreerde
  // templates + de gepersisteerde catalogus opruimen (no-op voor de rest).
  if (group && group.collectionId) {
    removeSteelCatalog(group.collectionId);
    removeLineworkCatalog(group.collectionId);
  }
}

function addSymbolToGroup(groupId, name, svg) {
  const groups = getCustomGroups().map(g => {
    if (g.id !== groupId) return g;
    const symId = groupId + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { ...g, symbols: [...g.symbols, { id: symId, name, svg }] };
  });
  setCustomGroups(groups);
}

// --- Online bibliotheek-groepen (gedownloade collecties) ---
// Zelfde persist-mechanisme als custom groepen (state.preferences.
// customSymbolGroups) zodat downloads na herstart blijven en de bestaande
// Remove-knop ze gewoon verwijdert. Een bibliotheek-groep draagt
// `collectionId` + `online: true` en industry/country als ARRAYS.
function upsertCustomGroup(group) {
  const groups = getCustomGroups();
  const i = groups.findIndex(g => g.id === group.id);
  const next = i >= 0
    ? groups.map((g, j) => (j === i ? { ...g, ...group } : g))
    : [...groups, group];
  setCustomGroups(next);
}

// Locale-tags bijwerken van een al gedownloade bibliotheek-groep: dezelfde
// collectie (bv. een internationale set) hoort bij meerdere landen/sectoren;
// bij elke download voor een nieuw land groeien de tag-arrays mee.
function addGroupLocaleTag(groupId, industryId, countryId) {
  let changed = false;
  const groups = getCustomGroups().map(g => {
    if (g.id !== groupId) return g;
    const ind = new Set(Array.isArray(g.industry) ? g.industry : g.industry ? [g.industry] : []);
    const cty = new Set(Array.isArray(g.country) ? g.country : g.country ? [g.country] : []);
    if (ind.has(industryId) && cty.has(countryId)) return g;
    ind.add(industryId);
    cty.add(countryId);
    changed = true;
    return { ...g, industry: [...ind], country: [...cty] };
  });
  if (changed) setCustomGroups(groups);
}

function removeSymbolFromGroup(groupId, symbolId) {
  const groups = getCustomGroups().map(g => {
    if (g.id !== groupId) return g;
    return { ...g, symbols: g.symbols.filter(s => s.id !== symbolId) };
  });
  setCustomGroups(groups);
}

// --- Palette visibility/mode persistence ---
function setSymbolPaletteVisible(v) {
  setSymbolPaletteVisibleRaw(v);
  state.preferences.symbolPaletteVisible = v;
  savePreferences();
}

function setSymbolPaletteMode(m) {
  setSymbolPaletteModeRaw(m);
  state.preferences.symbolPaletteMode = m;
  savePreferences();
}

function saveSymbolPaletteState() {
  state.preferences.symbolPaletteVisible = symbolPaletteVisible();
  state.preferences.symbolPaletteMode = symbolPaletteMode();
  const pos = symbolFloatPos();
  state.preferences.symbolPaletteFloatX = pos.x;
  state.preferences.symbolPaletteFloatY = pos.y;
  savePreferences();
}

function initSymbolPalette() {
  const prefs = state.preferences;
  if (prefs.symbolPaletteVisible != null) setSymbolPaletteVisibleRaw(prefs.symbolPaletteVisible);
  if (prefs.disabledSymbolGroups) setDisabledGroupsRaw(new Set(prefs.disabledSymbolGroups));
  if (prefs.symbolLibraryIndustry != null) setSelectedIndustryRaw(prefs.symbolLibraryIndustry);
  if (prefs.symbolLibraryCountry != null) setSelectedCountryRaw(prefs.symbolLibraryCountry);
  const mode = prefs.symbolPaletteMode || 'docked-right';
  setSymbolPaletteModeRaw(mode);
  if (prefs.symbolPaletteFloatX != null) {
    setSymbolFloatPos({ x: prefs.symbolPaletteFloatX, y: prefs.symbolPaletteFloatY ?? 150 });
  }
  // Register dock position
  if (symbolPaletteVisible() && mode.startsWith('docked-')) {
    registerPaletteDock('symbols', mode.replace('docked-', ''));
  }
}

export {
  searchQuery, setSearchQuery,
  filteredCategories, allCategories,
  toggleCategory, isCategoryExpanded,
  symbolPaletteVisible, setSymbolPaletteVisible,
  symbolPaletteMode, setSymbolPaletteMode,
  symbolFloatPos, setSymbolFloatPos,
  saveSymbolPaletteState, initSymbolPalette,
  settingsOpen, setSettingsOpen,
  selectedIndustry, setSelectedIndustry,
  selectedCountry, setSelectedCountry,
  toggleGroupEnabled, isGroupEnabled,
  addCustomGroup, removeCustomGroup,
  addSymbolToGroup, removeSymbolFromGroup,
  getCustomGroups, upsertCustomGroup, addGroupLocaleTag,
  symbolTypeKey, getSymbolTypeOverrides, resolveSymbolSvg, setSymbolTypeOverride,
};
