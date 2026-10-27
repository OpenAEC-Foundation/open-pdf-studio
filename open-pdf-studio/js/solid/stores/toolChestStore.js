// Store of the Tool Chest panel (#311).
//
// Keeps the chest (tool sets with items, see annotations/tool-chest.js),
// persists it in the app data — its own file next to the preferences in the
// desktop app, browser storage on the web — so it survives restarts and a
// reset of the preferences, and runs the actions of the panel and of the
// "Save to Tool Chest" context menu item.
//
// Clicking an item switches to its tool and makes it the active item
// (tools/tool-chest-session.js): the next annotation drawn gets the item's
// properties. The selection is cleared first, so nothing already placed on
// the page is changed by choosing an item.

import { createSignal } from 'solid-js';
import i18next from '../../i18n/config.js';
import { state, getActiveDocument } from '../../core/state.js';
import {
  emptyChest, normalizeChest, captureItem, isToolChestType, toolForType,
  addSet, renameSet, deleteSet, addItem, renameItem, deleteItem, moveItem,
  findSet, findItem, uniqueName, serializeToolSet, parseToolSetFile,
  importToolSet, toolSetFileName, TOOL_SET_EXTENSION, TYPE_LABEL_KEYS,
} from '../../annotations/tool-chest.js';
import {
  armToolChestItem, endToolChestSession, onToolChestSessionChange,
  applyToolChestToNewAnnotation, activeToolChestItemId,
} from '../../tools/tool-chest-session.js';
import { setAddAnnotationHook } from '../../core/undo-manager.js';
import { leesOpslag, schrijfOpslag } from '../../core/opslag.js';
import { openDialog, showMessage } from './dialogStore.js';
import { switchToLeftPanelTab } from './leftPanelStore.js';

const STORAGE_NAME = 'toolChest';
const CATALOG_ID = 'opds-tool-chest';

const [chest, setChest] = createSignal(emptyChest());
const [loaded, setLoaded] = createSignal(false);
const [selectedSetId, setSelectedSetId] = createSignal(null);
const [selectedItemId, setSelectedItemId] = createSignal(null);
const [activeItemId, setActiveItemId] = createSignal(activeToolChestItemId());

onToolChestSessionChange((id) => setActiveItemId(id));

const t = (key, opts) => i18next.t(`properties:toolChest.${key}`, opts);

// Every annotation the user adds passes here (undo-manager recordAdd); the
// active item, if any, puts its properties on it.
setAddAnnotationHook((ann) => applyToolChestToNewAnnotation(ann, state.currentTool, getActiveDocument()));

// ── Persistence ──────────────────────────────────────────────────────────

async function platform() {
  return import('../../core/platform.js');
}

let _loading = null;

/** Load the chest once (desktop: app data file, web: browser storage). */
export function ensureToolChestLoaded() {
  if (_loading) return _loading;
  _loading = (async () => {
    let raw = null;
    try {
      const p = await platform();
      if (p.isTauri()) raw = await p.loadCatalogFile(CATALOG_ID);
    } catch (e) {
      console.warn('Tool Chest file not read:', e);
    }
    if (!raw) {
      try {
        const text = leesOpslag(STORAGE_NAME);
        if (text) raw = JSON.parse(text);
      } catch (e) {
        console.warn('Tool Chest storage not read:', e);
      }
    }
    // Changes made before loading finished (unlikely) are kept on top.
    const stored = normalizeChest(raw);
    const pending = chest();
    setChest(pending.sets.length ? normalizeChest({ sets: [...stored.sets, ...pending.sets] }) : stored);
    setLoaded(true);
  })();
  return _loading;
}

let _saving = Promise.resolve();

function persist(next) {
  const data = JSON.parse(JSON.stringify(next));
  _saving = _saving.then(async () => {
    try {
      const p = await platform();
      if (p.isTauri()) {
        await p.saveCatalogFile(CATALOG_ID, data);
        return;
      }
    } catch (e) {
      console.error('Tool Chest file not saved:', e);
    }
    try {
      schrijfOpslag(STORAGE_NAME, JSON.stringify(data));
    } catch (e) {
      console.error('Tool Chest not saved (storage):', e);
    }
  });
  return _saving;
}

function commit(result) {
  if (!result || result.error) return result;
  setChest(result.chest);
  persist(result.chest);
  return result;
}

// ── Selection in the panel ───────────────────────────────────────────────

/** The tool set new items go to: the selected one, else the first. */
export function targetSet() {
  return findSet(chest(), selectedSetId()) || chest().sets[0] || null;
}

export function selectSet(id) {
  setSelectedSetId(id);
  setSelectedItemId(null);
}

export function selectItem(id) {
  const found = findItem(chest(), id);
  setSelectedItemId(found ? id : null);
  if (found) setSelectedSetId(found.set.id);
}

// ── Tool sets ────────────────────────────────────────────────────────────

/** Add a tool set with a free default name. Returns its id. */
export async function createToolSet(name = null) {
  await ensureToolChestLoaded();
  const base = name || t('newSetName');
  const r = commit(addSet(chest(), uniqueName(base, chest().sets.map((s) => s.name))));
  if (r?.set) selectSet(r.set.id);
  return r?.set?.id || null;
}

/** Returns null on success, else an error code ('name-empty' | 'name-taken'). */
export function renameToolSet(id, name) {
  const r = commit(renameSet(chest(), id, name));
  return r?.error || null;
}

export async function requestDeleteToolSet(id) {
  const set = findSet(chest(), id);
  if (!set) return;
  if (set.items.length > 0) {
    const ok = await confirm(t('deleteSetTitle'), t('deleteSetMessage', { name: set.name, count: set.items.length }));
    if (!ok) return;
  }
  if (set.items.some((i) => i.id === activeItemId())) stopActiveItem();
  commit(deleteSet(chest(), id));
  if (selectedSetId() === id) selectSet(chest().sets[0]?.id || null);
}

// ── Items ────────────────────────────────────────────────────────────────

/** Returns null on success, else an error code. */
export function renameToolChestItem(id, name) {
  const r = commit(renameItem(chest(), id, name));
  return r?.error || null;
}

/** Placed annotations are not affected: they hold their own copy of every value. */
export function deleteToolChestItem(id) {
  if (activeItemId() === id) stopActiveItem();
  commit(deleteItem(chest(), id));
  if (selectedItemId() === id) setSelectedItemId(null);
}

export function moveToolChestItem(itemId, toSetId, index = null) {
  commit(moveItem(chest(), itemId, toSetId, index));
}

export function canSaveToToolChest(ann) {
  return !!ann && isToolChestType(ann.type);
}

function typeLabel(type) {
  return TYPE_LABEL_KEYS[type] ? i18next.t(TYPE_LABEL_KEYS[type], { defaultValue: type }) : type;
}

/**
 * Right-click → "Save to Tool Chest": a new item from the annotation, in the
 * selected tool set (a new one when there is none). Opens the panel on it.
 */
export async function saveAnnotationToToolChest(ann) {
  if (!canSaveToToolChest(ann)) return null;
  await ensureToolChestLoaded();
  let set = targetSet();
  if (!set) {
    const id = await createToolSet(t('defaultSetName'));
    set = findSet(chest(), id);
  }
  if (!set) return null;
  const item = captureItem(ann, { doc: getActiveDocument(), fallbackName: typeLabel(ann.type) });
  if (!item) return null;
  const r = commit(addItem(chest(), set.id, item));
  if (!r || r.error) {
    showMessage(t('errorSave'), t('title'));
    return null;
  }
  switchToLeftPanelTab('tool-chest');
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
  endToolChestSession();
}

/**
 * Start the item's tool with the item's properties (Escape or another tool
 * ends it). The current selection is only deselected, never changed: the
 * item applies to what is drawn next.
 */
export async function useToolChestItem(id) {
  const found = findItem(chest(), id);
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
  armToolChestItem(found.item, state.preferences, {
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
  const set = findSet(chest(), id);
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
 * asks first: rename, overwrite or keep both (ToolChestImportDialog).
 * Returns the id of the imported set, or null.
 */
export async function importToolSetText(text) {
  await ensureToolChestLoaded();
  const parsed = parseToolSetFile(text);
  if (!parsed.ok) {
    showMessage(t(importErrorKey(parsed.error)), t('importTitle'));
    return null;
  }
  let r = importToolSet(chest(), parsed.set);
  if (r.error === 'conflict') {
    const choice = await new Promise((resolve) => {
      openDialog('tool-chest-import', {
        name: parsed.set.name,
        existingNames: chest().sets.map((s) => s.name),
        suggestedName: uniqueName(parsed.set.name, chest().sets.map((s) => s.name)),
        resolve,
      });
    });
    if (!choice) return null;
    // Overwriting the set of the active item: that item is gone.
    if (choice.mode === 'overwrite' && r.existing?.items.some((i) => i.id === activeItemId())) stopActiveItem();
    r = importToolSet(chest(), parsed.set, choice);
  }
  if (r.error) {
    showMessage(t(r.error === 'name-taken' ? 'nameTaken' : 'errorFileInvalid'), t('importTitle'));
    return null;
  }
  commit(r);
  switchToLeftPanelTab('tool-chest');
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
  return new Promise((resolve) => openDialog('tool-chest-confirm', { title, message, resolve }));
}

export {
  chest, loaded, selectedSetId, selectedItemId, activeItemId,
};
