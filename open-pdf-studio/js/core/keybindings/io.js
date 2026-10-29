// The keyboard shortcuts file (#714): export on one PC, import on another.
//
//   {
//     "format": "open-pdf-studio-keyboard-shortcuts",
//     "version": 1,
//     "app": "1.33.0",                     (informative)
//     "shortcuts": { "view.fitPage": ["Ctrl+K"], "file.close": [] }
//   }
//
// "shortcuts" holds the same overrides as the preferences: only the commands
// whose shortcuts differ from the defaults ([] = no shortcut). Importing
// replaces all current changes, so both PCs end up with the same set.
// Commands that this PC does not have (an extension that is not installed)
// are kept and work as soon as the command appears.
//
// A file that is not exactly this (other JSON, an unknown key name, a
// combination used twice, ...) is rejected as a whole: half an import would
// leave a mix nobody asked for.
//
// Pure module.

import { parseBinding } from './binding.js';
import { isValidCommandId } from './registry.js';
import { isReserved } from './dispatch.js';

export const FILE_FORMAT = 'open-pdf-studio-keyboard-shortcuts';
export const FILE_VERSION = 1;
export const FILE_EXTENSION = 'json';
export const MAX_FILE_SIZE = 1024 * 1024;
const MAX_COMMANDS = 10000;
const MAX_PER_COMMAND = 32;

/** The file text for these overrides (sorted, so the same set gives the same file). */
export function serializeShortcutsFile(overrides, { appVersion } = {}) {
  const shortcuts = {};
  for (const id of Object.keys(overrides || {}).sort()) shortcuts[id] = [...overrides[id]];
  const bestand = { format: FILE_FORMAT, version: FILE_VERSION };
  if (appVersion) bestand.app = String(appVersion);
  bestand.shortcuts = shortcuts;
  return `${JSON.stringify(bestand, null, 2)}\n`;
}

const fout = (code, detail) => ({ ok: false, error: code, ...(detail ? { detail } : {}) });

/**
 * Read a shortcuts file. { ok: true, overrides } or { ok: false, error, detail }.
 * Error codes: tooLarge, notJson, wrongFormat, unsupportedVersion,
 * invalidShortcuts, invalidCommand, invalidBinding (also a reserved key such
 * as Escape), duplicateBinding.
 */
export function parseShortcutsFile(text) {
  if (typeof text !== 'string') return fout('notJson');
  if (text.length > MAX_FILE_SIZE) return fout('tooLarge');
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return fout('notJson');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fout('wrongFormat');
  if (data.format !== FILE_FORMAT) return fout('wrongFormat');
  if (!Number.isInteger(data.version) || data.version < 1) return fout('wrongFormat');
  if (data.version > FILE_VERSION) return fout('unsupportedVersion', String(data.version));
  const s = data.shortcuts;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return fout('invalidShortcuts');
  const ids = Object.keys(s);
  if (ids.length > MAX_COMMANDS) return fout('tooLarge');
  const overrides = {};
  const gezien = new Map();
  for (const id of ids.sort()) {
    if (!isValidCommandId(id)) return fout('invalidCommand', id);
    const lijst = s[id];
    if (!Array.isArray(lijst) || lijst.length > MAX_PER_COMMAND) return fout('invalidShortcuts', id);
    const uit = [];
    for (const b of lijst) {
      const c = typeof b === 'string' ? parseBinding(b) : null;
      if (!c || isReserved(c)) return fout('invalidBinding', `${id}: ${String(b)}`);
      if (uit.includes(c)) continue;
      if (gezien.has(c)) return fout('duplicateBinding', `${c}: ${gezien.get(c)}, ${id}`);
      gezien.set(c, id);
      uit.push(c);
    }
    overrides[id] = uit;
  }
  return { ok: true, overrides };
}
