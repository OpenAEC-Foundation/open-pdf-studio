// Store of the Tool Sets panel (#311).
//
// Keeps the catalog (tool sets with items, see annotations/tool-sets.js),
// persists it in the app data — its own file next to the preferences in the
// desktop app, browser storage on the web — so it survives restarts and a
// reset of the preferences, and runs the actions of the panel and of the
// "Save to Tool Set" context menu item.
//
// Clicking an item switches to its tool and makes it the active item
// (tools/tool-set-session.js): the next annotation drawn gets the item's
// properties. The selection is cleared first, so nothing already placed on
// the page is changed by choosing an item.

import { createSignal } from 'solid-js';
import i18next from '../../i18n/config.js';
import { state, getActiveDocument } from '../../core/state.js';
import {
  emptyCatalog, normalizeCatalog, captureItem, isToolSetType, toolForType,
  addSet, renameSet, deleteSet, addItem, renameItem, deleteItem, moveItem,
  findSet, findItem, uniqueName, serializeToolSet, parseToolSetFile,
  importToolSet, toolSetFileName, readStoredCatalog, damagedCatalogName,
  TOOL_SET_EXTENSION, TYPE_LABEL_KEYS,
} from '../../annotations/tool-sets.js';
import {
  armToolSetItem, endToolSetSession, onToolSetSessionChange,
  applyToolSetToNewAnnotation, activeToolSetItemId,
} from '../../tools/tool-set-session.js';
import { setAddAnnotationHook } from '../../core/undo-manager.js';
import { leesOpslag, schrijfOpslag } from '../../core/opslag.js';
import { openDialog, showMessage } from './dialogStore.js';
import { switchToLeftPanelTab } from './leftPanelStore.js';

const STORAGE_NAME = 'toolSets';
const CATALOG_ID = 'opds-tool-sets';

const [catalog, setCatalog] = createSignal(emptyCatalog());
const [loaded, setLoaded] = createSignal(false);
const [selectedSetId, setSelectedSetId] = createSignal(null);
const [selectedItemId, setSelectedItemId] = createSignal(null);
const [activeItemId, setActiveItemId] = createSignal(activeToolSetItemId());

onToolSetSessionChange((id) => setActiveItemId(id));

const t = (key, opts) => i18next.t(`properties:toolSets.${key}`, opts);

// Every annotation the user adds passes here (undo-manager recordAdd); the
// active item, if any, puts its properties on it.
setAddAnnotationHook((ann) => applyToolSetToNewAnnotation(ann, state.currentTool, getActiveDocument()));

// ── Persistence ──────────────────────────────────────────────────────────

async function platform() {
  return import('../../core/platform.js');
}

let _loading = null;

// The stored catalog could not be read and could not be kept aside either:
// that store is not written this session, so a catalog that is only
// unreadable for now (locked, no access) is never replaced by an empty one.
const _writeBlocked = { file: false, storage: false };

function statusMessage(text) {
  import('../../ui/chrome/status-bar.js').then((m) => m.updateStatusMessage?.(text)).catch(() => {});
}

// A damaged catalog (text that is no catalog) is copied aside before the
// first save replaces it, so the user's tool sets can still be recovered.
async function keepDamaged(kind, text, write) {
  const name = damagedCatalogName(kind === 'file' ? CATALOG_ID : STORAGE_NAME);
  try {
    await write(name, text);
    console.warn(`Tool sets: the stored catalog could not be read; it was kept as "${name}".`);
    statusMessage(t('damagedStatus', { name }));
  } catch (e) {
    _writeBlocked[kind] = true;
    console.error('Tool sets: the damaged catalog could not be kept aside, so it is left as it is:', e);
  }
}

/** Load the catalog once (desktop: app data file, web: browser storage). */
export function ensureToolSetsLoaded() {
  if (_loading) return _loading;
  _loading = (async () => {
    let raw = null;
    let p = null;
    try {
      p = await platform();
    } catch (e) {
      console.warn('Tool sets: platform not available:', e);
    }
    if (p?.isTauri()) {
      try {
        const text = await p.loadCatalogText(CATALOG_ID);
        const read = readStoredCatalog(text);
        if (read.ok) raw = read.raw;
        else await keepDamaged('file', text, (name, data) => p.saveCatalogText(name, data));
      } catch (e) {
        _writeBlocked.file = true;
        console.warn('Tool sets file not read; it is not written this session:', e);
      }
    }
    if (!raw) {
      let text = null;
      try {
        text = leesOpslag(STORAGE_NAME);
      } catch (e) {
        console.warn('Tool sets storage not read:', e);
      }
      const read = readStoredCatalog(text);
      if (read.ok) raw = read.raw;
      else await keepDamaged('storage', text, async (name, data) => schrijfOpslag(name, data));
    }
    // Changes made before loading finished (unlikely) are kept on top.
    const stored = normalizeCatalog(raw);
    const pending = catalog();
    setCatalog(pending.sets.length ? normalizeCatalog({ sets: [...stored.sets, ...pending.sets] }) : stored);
    setLoaded(true);
  })();
  return _loading;
}

let _saving = Promise.resolve();

// Desktop: the catalog file (written atomically by save_catalog); browser
// storage when that is not possible.
function persist(next) {
  const data = JSON.parse(JSON.stringify(next));
  _saving = _saving.then(async () => {
    try {
      const p = await platform();
      if (p.isTauri() && !_writeBlocked.file) {
        await p.saveCatalogFile(CATALOG_ID, data);
        return;
      }
    } catch (e) {
      console.error('Tool sets file not saved:', e);
    }
    if (_writeBlocked.storage) return;
    try {
      schrijfOpslag(STORAGE_NAME, JSON.stringify(data));
    } catch (e) {
      console.error('Tool sets not saved (storage):', e);
    }
  });
  return _saving;
}

function commit(result) {
  if (!result || result.error) return result;
  setCatalog(result.catalog);
  persist(result.catalog);
  return result;
}

// ── Selection in the panel ───────────────────────────────────────────────

/** The tool set new items go to: the selected one, else the first. */
export function targetSet() {
  return findSet(catalog(), selectedSetId()) || catalog().sets[0] || null;
}

export function selectSet(id) {
  setSelectedSetId(id);
  setSelectedItemId(null);
}

export function selectItem(id) {
  const found = findItem(catalog(), id);
  setSelectedItemId(found ? id : null);
  if (found) setSelectedSetId(found.set.id);
}

// ── Tool sets ────────────────────────────────────────────────────────────

/** Add a tool set with a free default name. Returns its id. */
export async function createToolSet(name = null) {
  await ensureToolSetsLoaded();
  const base = name || t('newSetName');
  const r = commit(addSet(catalog(), uniqueName(base, catalog().sets.map((s) => s.name))));
  if (r?.set) selectSet(r.set.id);
  return r?.set?.id || null;
}

/** Returns null on success, else an error code ('name-empty' | 'name-taken'). */
export function renameToolSet(id, name) {
  const r = commit(renameSet(catalog(), id, name));
  return r?.error || null;
}

export async function requestDeleteToolSet(id) {
  const set = findSet(catalog(), id);
  if (!set) return;
  if (set.items.length > 0) {
    const ok = await confirm(t('deleteSetTitle'), t('deleteSetMessage', { name: set.name, count: set.items.length }));
    if (!ok) return;
  }
  if (set.items.some((i) => i.id === activeItemId())) stopActiveItem();
  commit(deleteSet(catalog(), id));
  if (selectedSetId() === id) selectSet(catalog().sets[0]?.id || null);
}

// ── Items ────────────────────────────────────────────────────────────────

/** Returns null on success, else an error code. */
export function renameToolSetItem(id, name) {
  const r = commit(renameItem(catalog(), id, name));
  return r?.error || null;
}

/** Placed annotations are not affected: they hold their own copy of every value. */
export function deleteToolSetItem(id) {
  if (activeItemId() === id) stopActiveItem();
  commit(deleteItem(catalog(), id));
  if (selectedItemId() === id) setSelectedItemId(null);
}

export function moveToolSetItem(itemId, toSetId, index = null) {
  commit(moveItem(catalog(), itemId, toSetId, index));
}

export function canSaveToToolSet(ann) {
  return !!ann && isToolSetType(ann.type);
}

function typeLabel(type) {
  return TYPE_LABEL_KEYS[type] ? i18next.t(TYPE_LABEL_KEYS[type], { defaultValue: type }) : type;
}

/**
 * Right-click → "Save to Tool Set": a new item from the annotation, in the
 * selected tool set (a new one when there is none). Opens the panel on it.
 */
export async function saveAnnotationToToolSet(ann) {
  if (!canSaveToToolSet(ann)) return null;
  await ensureToolSetsLoaded();
  let set = targetSet();
  if (!set) {
    const id = await createToolSet(t('defaultSetName'));
    set = findSet(catalog(), id);
  }
  if (!set) return null;
  const item = captureItem(ann, { doc: getActiveDocument(), fallbackName: typeLabel(ann.type) });
  if (!item) return null;
  const r = commit(addItem(catalog(), set.id, item));
  if (!r || r.error) {
    showMessage(t('errorSave'), t('title'));
    return null;
  }
  switchToLeftPanelTab('tool-sets');
  selectItem(r.item.id);
  import('../../ui/chrome/status-bar.js')
    .then((m) => m.updateStatusMessage?.(t('savedStatus', { name: r.item.name, set: set.name })))
    .catch(() => {});
  return r.item.id;
}

// ── Using an item ────────────────────────────────────────────────────────

function redraw() {
  import('../../annotations/rendering.js').then((m) => {
    if (getActiveDocument()?.viewMode === 'continuous') m.redrawContinuous();
    else m.redrawAnnotations();
  }).catch(() => {});
}

export async function stopActiveItem() {
  if (!activeItemId()) return;
  const { setTool } = await import('../../tools/manager.js');
  setTool('select');
  endToolSetSession();
}

/**
 * Start the item's tool with the item's properties (Escape or another tool
 * ends it). The current selection is only deselected, never changed: the
 * item applies to what is drawn next.
 */
export async function useToolSetItem(id) {
  const found = findItem(catalog(), id);
  if (!found) return;
  if (activeItemId() === id && state.currentTool === toolForType(found.item.type)) return;
  if (!getActiveDocument()) {
    showMessage(t('noDocument'), t('title'));
    return;
  }
  const tool = toolForType(found.item.type);
  if (!tool) return;
  selectItem(id);

  const [{ setTool }, sel, measurement, layers] = await Promise.all([
    import('../../tools/manager.js'),
    import('../../core/stores/selection-helpers.js'),
    import('../../annotations/measurement.js'),
    import('./annotationLayersStore.js'),
  ]);
  const doc = getActiveDocument();
  if (doc && (doc.selectedAnnotations?.length || doc.selectedAnnotation)) {
    sel.clearSelection();
    redraw();
  }
  setTool(tool);
  // Refused (read-only PDF/A): no session.
  if (state.currentTool !== tool) return;
  armToolSetItem(found.item, state.preferences, {
    onLayerAdded: () => layers.annotationLayersChanged?.(),
    formatMeasurement: measurement.formatMeasurement,
  });
  import('../../ui/chrome/status-bar.js')
    .then((m) => m.updateStatusMessage?.(t('activeStatus', { name: found.item.name })))
    .catch(() => {});
}

// ── Export / import ──────────────────────────────────────────────────────

function fileFilters() {
  return [{ name: t('fileType'), extensions: [TOOL_SET_EXTENSION, 'json'] }];
}

export async function exportToolSet(id) {
  const set = findSet(catalog(), id);
  if (!set) return false;
  const p = await platform();
  const path = await p.saveFileDialog(toolSetFileName(set.name), fileFilters());
  if (!path) return false;
  try {
    const bytes = new TextEncoder().encode(serializeToolSet(set));
    await p.writeBinaryFile(path, bytes);
    import('../../ui/chrome/status-bar.js')
      .then((m) => m.updateStatusMessage?.(t('exportedStatus', { name: set.name })))
      .catch(() => {});
    return true;
  } catch (e) {
    console.error('Tool set export failed:', e);
    showMessage(t('errorExport', { error: String(e?.message || e) }), t('title'));
    return false;
  }
}

const IMPORT_ERRORS = {
  'empty': 'errorFileEmpty',
  'too-large': 'errorFileTooLarge',
  'not-json': 'errorFileInvalid',
  'wrong-format': 'errorFileInvalid',
  'no-name': 'errorFileInvalid',
  'no-items': 'errorFileInvalid',
  'invalid-item': 'errorFileInvalid',
  'newer-version': 'errorFileNewer',
};

/** Message for an import error code (also used by the tests of the panel). */
export function importErrorKey(code) {
  return IMPORT_ERRORS[code] || 'errorFileInvalid';
}

/**
 * Import a tool set from its file text. A set whose name already exists
 * asks first: rename, overwrite or keep both (ToolSetImportDialog).
 * Returns the id of the imported set, or null.
 */
export async function importToolSetText(text) {
  await ensureToolSetsLoaded();
  const parsed = parseToolSetFile(text);
  if (!parsed.ok) {
    showMessage(t(importErrorKey(parsed.error)), t('importTitle'));
    return null;
  }
  let r = importToolSet(catalog(), parsed.set);
  if (r.error === 'conflict') {
    const choice = await new Promise((resolve) => {
      openDialog('tool-sets-import', {
        name: parsed.set.name,
        existingNames: catalog().sets.map((s) => s.name),
        suggestedName: uniqueName(parsed.set.name, catalog().sets.map((s) => s.name)),
        resolve,
      });
    });
    if (!choice) return null;
    // Overwriting the set of the active item: that item is gone.
    if (choice.mode === 'overwrite' && r.existing?.items.some((i) => i.id === activeItemId())) stopActiveItem();
    r = importToolSet(catalog(), parsed.set, choice);
  }
  if (r.error) {
    showMessage(t(r.error === 'name-taken' ? 'nameTaken' : 'errorFileInvalid'), t('importTitle'));
    return null;
  }
  commit(r);
  switchToLeftPanelTab('tool-sets');
  selectSet(r.set.id);
  const msg = parsed.skipped > 0
    ? t('importedSkipped', { name: r.set.name, count: r.set.items.length, skipped: parsed.skipped })
    : t('importedStatus', { name: r.set.name, count: r.set.items.length });
  import('../../ui/chrome/status-bar.js').then((m) => m.updateStatusMessage?.(msg)).catch(() => {});
  return r.set.id;
}

export async function importToolSetFromFile() {
  const p = await platform();
  const path = await p.openFileDialog([TOOL_SET_EXTENSION, 'json']);
  if (!path || Array.isArray(path)) return null;
  let bytes;
  try {
    bytes = await p.readBinaryFile(path);
  } catch (e) {
    console.error('Tool set file not read:', e);
  }
  if (!bytes) {
    showMessage(t('errorFileRead'), t('importTitle'));
    return null;
  }
  const text = new TextDecoder('utf-8').decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return importToolSetText(text);
}

// ── Small helpers ────────────────────────────────────────────────────────

function confirm(title, message) {
  return new Promise((resolve) => openDialog('tool-sets-confirm', { title, message, resolve }));
}

export {
  catalog, loaded, selectedSetId, selectedItemId, activeItemId,
};
