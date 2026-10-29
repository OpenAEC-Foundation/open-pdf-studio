// The keyboard shortcuts of the app (#714): the one registry, filled with the
// built-in commands, the ribbon buttons and the extension commands, and the
// functions the rest of the app uses. Only plain functions are exported for
// the keyboard handling, so its tests can stub them.
//
//   sneltoetsActief(id, combo)   does the built-in key still belong to the command?
//   eigenSneltoetsVoor(e, ...)   the user-assigned shortcut for this keydown
//   voerSneltoetsUit(id, e)      run a command (built-in, ribbon or extension)
//   sneltoetsTekst(id)           "Ctrl+2" (all shortcuts of the command) for tooltips and menus
//
// No DOM and no Solid here: the ribbon and the keyboard handling register how
// their commands run (zetLintUitvoerder, zetIngebouwdeUitvoerder).

import { createKeybindingRegistry } from './registry.js';
import { CORE_COMMANDS, RIBBON_ALIASES } from './default-commands.js';
import { RIBBON_COMMANDS } from './ribbon-commands.generated.js';
import { formatBinding, bindingParts, detectPlatform, eventFieldsFor } from './binding.js';
import { customShortcutFor } from './dispatch.js';
import { extensieOpdrachten, voerExtensieOpdrachtUit } from '../../plugins/extension-commands.js';

export const sneltoetsen = createKeybindingRegistry();
for (const def of CORE_COMMANDS) sneltoetsen.define(def);

export const lintOpdrachtId = (knopId) => `ribbon:#${knopId}`;

// Ribbon buttons with a fixed id, except those that run a built-in command.
sneltoetsen.addProvider(() => RIBBON_COMMANDS
  .filter((o) => !RIBBON_ALIASES[o.id])
  .map((o, i) => ({
    id: lintOpdrachtId(o.id), category: `ribbon:${o.tab}`, tab: o.tab,
    labelKey: o.labelKey || null, label: o.label || o.id, order: 1000 + i,
  })));

// Extension commands (ext:<extId>:<item>), as long as the extension is there.
let _taal = () => 'en';
export function zetTaalBron(fn) { if (typeof fn === 'function') _taal = fn; }
sneltoetsen.addProvider(() => extensieOpdrachten.lijst(_taal()).map((o, i) => ({
  id: o.command, category: 'extensions', extension: o.extension,
  label: o.label || o.title || o.command, order: 5000 + i,
})));
extensieOpdrachten.abonneer(() => sneltoetsen.refresh());

/** The command a ribbon button stands for: its built-in command, or ribbon:#<id>, or its extension command. */
export function opdrachtVoorKnop({ id, extCommand } = {}) {
  if (extCommand) return extCommand;
  if (!id) return null;
  return RIBBON_ALIASES[id] || lintOpdrachtId(id);
}

/** Apply the shortcuts from the preferences (state.preferences.keyboardShortcuts). */
export function pasSneltoetsVoorkeurToe(overrides) {
  const nu = JSON.stringify(sneltoetsen.getOverrides());
  sneltoetsen.setOverrides(overrides);
  return nu !== JSON.stringify(sneltoetsen.getOverrides());
}

/** Does the built-in key `combo` still run command `id`? */
export function sneltoetsActief(id, combo) {
  return sneltoetsen.isDefaultActive(id, combo);
}

/** The user-assigned shortcut for this keydown, or null (see dispatch.js). */
export function eigenSneltoetsVoor(e, context) {
  return customShortcutFor(e, sneltoetsen, context);
}

/** Does this command run while typing in a text field (Find)? */
export function sneltoetsInInvoer(id) {
  return sneltoetsen.get(id)?.allowInInput === true;
}

/**
 * A keydown for the first default key of a built-in command, based on the
 * real event (target, preventDefault): the built-in handling runs the
 * command as if that key had been pressed.
 */
export function maakStandaardToets(e, id) {
  const combo = sneltoetsen.defaultsOf(id)[0];
  const velden = combo ? eventFieldsFor(combo) : null;
  if (!velden) return null;
  return {
    ...velden,
    target: e?.target ?? null,
    repeat: !!e?.repeat,
    get defaultPrevented() { return !!e?.defaultPrevented; },
    preventDefault() { e?.preventDefault?.(); },
    stopPropagation() { e?.stopPropagation?.(); },
    stopImmediatePropagation() { e?.stopImmediatePropagation?.(); },
  };
}

let _ingebouwd = null;
let _lint = null;
/** keyboard-handlers.js: how a built-in command runs. */
export function zetIngebouwdeUitvoerder(fn) { _ingebouwd = fn; }
/** Ribbon.jsx: how a ribbon button is clicked, also when its tab is not open. */
export function zetLintUitvoerder(fn) { _lint = fn; }

/** Run a command by its id. */
export async function voerSneltoetsUit(id, e = null) {
  if (typeof id !== 'string') return false;
  if (id.startsWith('ext:')) {
    const r = await voerExtensieOpdrachtUit(id, { source: 'ui' });
    return r?.ok === true;
  }
  if (id.startsWith('ribbon:#')) {
    const knop = id.slice('ribbon:#'.length);
    const def = RIBBON_COMMANDS.find((o) => o.id === knop);
    return _lint ? !!(await _lint(knop, def?.tab || null)) : false;
  }
  if (!sneltoetsen.has(id) || !_ingebouwd) return false;
  await _ingebouwd(id, e);
  return true;
}

// ── Display ─────────────────────────────────────────────────────────────────

const PLATFORM = detectPlatform();
export const platform = () => PLATFORM;

/** The shortcuts of a command as text, "Ctrl+Y, Ctrl+Shift+Z"; '' without one. */
export function sneltoetsTekst(id) {
  if (!id) return '';
  return sneltoetsen.bindingsOf(id).map((c) => formatBinding(c, PLATFORM)).join(', ');
}

/** The first shortcut as keycap parts, for a menu: ['Ctrl', 'S']. */
export function sneltoetsDelen(combo) {
  return bindingParts(combo, PLATFORM);
}

// ── Recording a new shortcut ────────────────────────────────────────────────
// While the preferences page records a key, the other keyboard handling
// (proofreading, tab switching, ...) leaves every key alone.

let _opname = false;
export function zetSneltoetsOpname(aan) { _opname = !!aan; }
export function isSneltoetsOpname() { return _opname; }
