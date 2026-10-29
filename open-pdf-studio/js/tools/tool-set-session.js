// The active tool set item (#311): while the user draws with an item from
// Tool Sets, its style is a TEMPORARY overlay on the style preferences
// (so preview, tool defaults panel and tool all use it), and every new
// annotation of its type gets the item's other properties — layer, label,
// depth, … — when it is added (undo-manager recordAdd hook).
//
// Choosing another tool ends the session (tools/manager.js setTool) and puts
// the user's own preferences back. Nothing of the item is ever persisted as
// a preference: savePreferences writes prefsForStorage(). A preference the
// user changes while the item is active (tool defaults panel, Format tab) is
// a real change: it is kept afterwards and wins over the item.
//
// No app imports: the caller passes the preferences object, the document and
// the current tool, so this module is node-testable.

import {
  applyItemToAnnotation, stylePrefsOverlay, prefKeyToAnnKeys, toolForType,
} from '../annotations/tool-sets.js';

let session = null;
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(session ? session.item.id : null); } catch (e) { console.warn('Tool Sets listener:', e); }
  }
}

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Listen for the active item changing (id, or null when none). Returns an unsubscribe. */
export function onToolSetSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function activeToolSetItemId() {
  return session ? session.item.id : null;
}

export function activeToolSetTool() {
  return session ? session.tool : null;
}

/**
 * Make `item` the active tool set item: overlay its style on `prefs`
 * (mutated in place). Call after switching to the item's tool.
 * Options: onLayerAdded() when applying created a layer in the document,
 * formatMeasurement(m) the app's area formatter.
 */
export function armToolSetItem(item, prefs, { onLayerAdded = null, formatMeasurement = null } = {}) {
  endToolSetSession();
  const tool = toolForType(item?.type);
  if (!tool || !prefs) return false;
  const overlay = stylePrefsOverlay(item, prefs);
  const snapshot = {};
  for (const [k, v] of Object.entries(overlay)) {
    snapshot[k] = hasOwn(prefs, k) ? { has: true, value: prefs[k] } : { has: false };
    if (v === undefined) delete prefs[k];
    else prefs[k] = v;
  }
  session = {
    item: JSON.parse(JSON.stringify(item)),
    tool,
    prefs,
    overlay,
    snapshot,
    onLayerAdded,
    formatMeasurement,
  };
  notify();
  return true;
}

/** End the session and give the user's own preferences back. */
export function endToolSetSession() {
  if (!session) return;
  const { prefs, overlay, snapshot } = session;
  for (const k of Object.keys(overlay)) {
    // Changed by the user while the item was active: keep their choice.
    if (!same(prefs[k], overlay[k])) continue;
    const s = snapshot[k];
    if (s.has) prefs[k] = s.value;
    else delete prefs[k];
  }
  session = null;
  notify();
}

/**
 * The preferences as they must be saved: every key that still holds the
 * item's overlay value gets the user's own value back.
 */
export function prefsForStorage(prefs) {
  if (!session || session.prefs !== prefs) return prefs;
  const out = { ...prefs };
  for (const k of Object.keys(session.overlay)) {
    if (!same(prefs[k], session.overlay[k])) continue;
    const s = session.snapshot[k];
    if (s.has) out[k] = s.value;
    else delete out[k];
  }
  return out;
}

/**
 * The user made the current values of `keys` their own preferences while an
 * item is active ("Set as Default Style"): they are saved, and they stay when
 * the session ends, also where they equal the item's overlay value (which
 * otherwise reads as "still the item's value" and is given back).
 */
export function keepPrefsAsOwn(prefs, keys) {
  if (!session || session.prefs !== prefs || !keys) return;
  for (const k of keys) {
    if (!hasOwn(session.overlay, k)) continue;
    session.snapshot[k] = hasOwn(prefs, k) ? { has: true, value: prefs[k] } : { has: false };
  }
}

/** Annotation properties whose preference the user changed during the session. */
export function changedDuringSession() {
  const keys = new Set();
  if (!session) return keys;
  const map = prefKeyToAnnKeys(session.item.type);
  for (const [prefKey, overlayValue] of Object.entries(session.overlay)) {
    if (same(session.prefs[prefKey], overlayValue)) continue;
    for (const annKey of map.get(prefKey) || []) keys.add(annKey);
  }
  return keys;
}

/**
 * Apply the active item to an annotation that was just added. Only for an
 * annotation of the item's type drawn with the item's tool; anything else
 * (another tool, a paste in the select tool) is left alone.
 */
export function applyToolSetToNewAnnotation(ann, currentTool, doc) {
  if (!session || !ann || ann.type !== session.item.type || currentTool !== session.tool) return false;
  const r = applyItemToAnnotation(ann, session.item, {
    skipKeys: changedDuringSession(),
    doc,
    formatMeasurement: session.formatMeasurement,
  });
  if (r.layerAdded && typeof session.onLayerAdded === 'function') {
    try { session.onLayerAdded(); } catch (_) { /* panel refresh only */ }
  }
  return r.applied;
}
