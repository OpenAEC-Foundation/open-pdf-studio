// Command and key binding registry for the customizable keyboard shortcuts
// (#714).
//
// A command: { id, category, labelKey, label, defaults, allowInInput, order }.
//   id           stable id: 'view.fitPage', 'ribbon:#insert-page', 'ext:<ext>:<item>'
//   defaults     canonical combinations it has out of the box (binding.js)
//   allowInInput the command also runs while typing in a text field (Find),
//                but only with Ctrl/Alt/Meta or a function key (dispatch.js)
//
// The user's changes are "overrides": { [commandId]: [canonical, ...] } for
// every command whose shortcuts differ from its defaults ([] = all removed).
// Only differences are stored, so a command the user never touched follows
// the defaults of a newer version. Overrides for commands that are not
// registered (an extension that is not installed here) are kept as they are.
//
// When two commands claim the same combination, an override beats a default.
//
// The editing functions (assignBinding, removeBinding, resetCommand) are pure:
// they take overrides and return new overrides, so the preferences page can
// edit a working copy and apply it on Save.
//
// Pure module: no DOM, no app state.

import { parseBinding } from './binding.js';

const ID_PATTERN = /^[A-Za-z0-9_.:#=\-/@ ]{1,200}$/;
export const isValidCommandId = (id) => typeof id === 'string' && ID_PATTERN.test(id);

/** Same set of combinations, order ignored. */
function zelfdeSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Clean up overrides read from the preferences or a file: valid ids,
 * canonical combinations, no duplicates. A combination claimed by two
 * commands stays with the first (ids sorted, so the outcome is the same on
 * every machine).
 */
export function sanitizeOverrides(raw) {
  const uit = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return uit;
  const gezien = new Set();
  for (const id of Object.keys(raw).sort()) {
    if (!isValidCommandId(id) || !Array.isArray(raw[id])) continue;
    const lijst = [];
    for (const b of raw[id]) {
      const c = parseBinding(b);
      if (!c || gezien.has(c)) continue;
      gezien.add(c);
      lijst.push(c);
    }
    uit[id] = lijst;
  }
  return uit;
}

/** The shortcuts of a command: its override if there is one, else its defaults. */
export function effectiveBindings(model, overrides, id) {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, id)) return [...overrides[id]];
  return [...(model.defaultsOf(id) || [])];
}

/**
 * combination -> command id for everything that is bound. Defaults of
 * commands without an override first, then the overrides (they win).
 */
export function buildIndex(model, overrides = {}) {
  const index = new Map();
  for (const id of model.ids()) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) continue;
    for (const c of model.defaultsOf(id) || []) if (!index.has(c)) index.set(c, id);
  }
  for (const id of Object.keys(overrides)) {
    for (const c of overrides[id]) index.set(c, id);
  }
  return index;
}

/** The command that has this combination now, or null. */
export function ownerOf(model, overrides, combo) {
  const c = parseBinding(combo);
  if (!c) return null;
  return buildIndex(model, overrides).get(c) ?? null;
}

/** Store `lijst` as the shortcuts of `id`; no override if it equals the defaults. */
function zet(model, overrides, id, lijst) {
  const uit = { ...overrides };
  if (zelfdeSet(lijst, model.defaultsOf(id) || [])) delete uit[id];
  else uit[id] = lijst;
  return uit;
}

/** Take `combo` away from every command except `behalve`. */
function neemWeg(model, overrides, combo, behalve) {
  let uit = overrides;
  const index = buildIndex(model, uit);
  // Also a default that an override shadows: once that override goes, the
  // default would reappear.
  const houders = new Set([index.get(combo)].filter(Boolean));
  for (const id of model.ids()) if ((model.defaultsOf(id) || []).includes(combo)) houders.add(id);
  for (const id of Object.keys(uit)) if (uit[id].includes(combo)) houders.add(id);
  for (const id of houders) {
    if (id === behalve) continue;
    const lijst = effectiveBindings(model, uit, id);
    if (!lijst.includes(combo) && !(model.defaultsOf(id) || []).includes(combo)) continue;
    uit = zet(model, uit, id, lijst.filter((c) => c !== combo));
  }
  return uit;
}

/**
 * Give `id` the combination `combo`.
 * Returns { overrides, conflict, combo }:
 *   - combo null              the combination is not valid
 *   - conflict = other id     another command has it and reassign was not asked;
 *                             overrides are unchanged
 *   - otherwise the new overrides (with reassign: taken away from the other)
 */
export function assignBinding(model, overrides, id, combo, { reassign = false } = {}) {
  const c = parseBinding(combo);
  if (!c) return { overrides, conflict: null, combo: null };
  const eigenaar = buildIndex(model, overrides).get(c) ?? null;
  if (eigenaar === id) return { overrides, conflict: null, combo: c };
  if (eigenaar && !reassign) return { overrides, conflict: eigenaar, combo: c };
  let uit = neemWeg(model, overrides, c, id);
  const lijst = effectiveBindings(model, uit, id).filter((x) => x !== c);
  lijst.push(c);
  uit = zet(model, uit, id, lijst);
  return { overrides: uit, conflict: null, combo: c };
}

/** Remove one shortcut from a command. */
export function removeBinding(model, overrides, id, combo) {
  const c = parseBinding(combo);
  if (!c) return overrides;
  const lijst = effectiveBindings(model, overrides, id);
  if (!lijst.includes(c)) return overrides;
  return zet(model, overrides, id, lijst.filter((x) => x !== c));
}

/**
 * Back to the defaults of one command. A default that another command took
 * meanwhile comes back to this command (Reset means: the default keys work
 * again for this command).
 */
export function resetCommand(model, overrides, id) {
  let uit = { ...overrides };
  delete uit[id];
  for (const c of model.defaultsOf(id) || []) uit = neemWeg(model, uit, c, id);
  delete uit[id];
  return uit;
}

/** Has the command other shortcuts than its defaults? */
export function isModified(overrides, id) {
  return !!overrides && Object.prototype.hasOwnProperty.call(overrides, id);
}

/**
 * The registry of the app. Commands are defined once (built-in) or come from
 * providers (the extension commands, the ribbon buttons) that are asked each
 * time, so a command that comes or goes is picked up.
 */
export function createKeybindingRegistry() {
  const vast = new Map();
  const bronnen = new Set();
  const luisteraars = new Set();
  let overrides = {};
  let cache = null;

  const commandsMap = () => {
    if (cache) return cache.map;
    const map = new Map(vast);
    for (const bron of bronnen) {
      let lijst = [];
      try { lijst = bron() || []; } catch { lijst = []; }
      for (const def of lijst) if (def && isValidCommandId(def.id) && !map.has(def.id)) map.set(def.id, normaliseer(def));
    }
    cache = { map, index: null };
    return map;
  };

  const model = {
    ids: () => [...commandsMap().keys()],
    defaultsOf: (id) => commandsMap().get(id)?.defaults || [],
  };

  const index = () => {
    commandsMap();
    if (!cache.index) cache.index = buildIndex(model, overrides);
    return cache.index;
  };

  const meld = () => {
    cache = null;
    for (const fn of [...luisteraars]) { try { fn(); } catch { /* a listener must not break the others */ } }
  };

  return {
    model,

    /** Define a built-in command. */
    define(def) {
      if (!isValidCommandId(def?.id)) throw new Error(`invalid command id: ${def?.id}`);
      vast.set(def.id, normaliseer({ order: vast.size, ...def }));
      meld();
    },

    /** Add a source of commands (called each time the list is needed). Returns a remove function. */
    addProvider(fn) {
      bronnen.add(fn);
      meld();
      return () => { bronnen.delete(fn); meld(); };
    },

    /** Something in a provider changed (extension installed, ...). */
    refresh: meld,

    get: (id) => commandsMap().get(id) || null,
    has: (id) => commandsMap().has(id),
    commands: () => [...commandsMap().values()],

    defaultsOf: (id) => model.defaultsOf(id),
    bindingsOf: (id) => effectiveBindings(model, overrides, id),
    ownerOf: (combo) => {
      const c = parseBinding(combo);
      return c ? (index().get(c) ?? null) : null;
    },
    /** Does the built-in key `combo` still belong to command `id`? */
    isDefaultActive: (id, combo) => {
      const c = parseBinding(combo);
      return !!c && index().get(c) === id;
    },

    getOverrides: () => ({ ...overrides }),
    setOverrides(raw) {
      overrides = sanitizeOverrides(raw);
      meld();
    },

    subscribe(fn) {
      luisteraars.add(fn);
      return () => luisteraars.delete(fn);
    },
  };
}

function normaliseer(def) {
  const defaults = [];
  for (const b of def.defaults || []) {
    const c = parseBinding(b);
    if (c && !defaults.includes(c)) defaults.push(c);
  }
  return {
    id: def.id,
    category: def.category || 'other',
    labelKey: def.labelKey || null,
    label: def.label ?? def.id,
    defaults,
    allowInInput: def.allowInInput === true,
    order: Number.isFinite(def.order) ? def.order : 0,
    ...(def.tab ? { tab: def.tab } : {}),
    ...(def.extension ? { extension: def.extension } : {}),
  };
}
