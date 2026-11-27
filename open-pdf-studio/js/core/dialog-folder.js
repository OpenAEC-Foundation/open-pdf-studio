// Start folder of the Open and Save As dialogs (#1245).
//
// Open starts in the folder of the file that was opened or saved last. Save As
// starts next to the document itself (saver.js); a document without a file of
// its own starts in the folder of the last Save As. What was opened last is
// already in the recent-files list; only the last Save As folder is kept here,
// in the app's storage (core/opslag.js). Desktop only: in the browser a dialog
// has no start folder and nothing is recorded.

import { leesOpslagJson, schrijfOpslagJson } from './opslag.js';

/** Name of the entry in the app's storage. */
export const LAST_SAVE_FOLDER_NAME = 'lastSaveFolder';

/**
 * The folder a file lies in, or null when the path has none: a bare file
 * name, an in-memory key, or an address that is not a file path (content://
 * on a phone, a document of the hosting site).
 * @param {string} path
 * @returns {string | null}
 */
export function folderOf(path) {
  if (typeof path !== 'string' || !path) return null;
  if (path.startsWith('__memory__') || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return null;
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  if (cut < 0) return null;
  // A file directly in a root keeps the separator: "C:" alone means the
  // current folder of that drive, and the root of a Unix path is "/".
  if (cut === 0 || /^[a-zA-Z]:$/.test(path.slice(0, cut))) return path.slice(0, cut + 1);
  return path.slice(0, cut);
}

/**
 * Where the Open dialog starts: the folder of the most recently opened file
 * or of the last Save As, whichever is newer. Undefined when neither is known
 * (the dialog then starts where the system puts it).
 * @param {{path?: string, timestamp?: number}[]} recents  the recent-files list
 * @param {{dir?: string, t?: number} | null} [lastSave]   see readLastSaveFolder
 * @returns {string | undefined}
 */
export function openStartFolder(recents, lastSave) {
  let best = null;
  for (const file of Array.isArray(recents) ? recents : []) {
    const dir = folderOf(file?.path);
    const t = Number(file?.timestamp) || 0;
    if (dir && (!best || t > best.t)) best = { dir, t };
  }
  const saved = normalizeSaveFolder(lastSave);
  if (saved && (!best || saved.t >= best.t)) return saved.dir;
  return best ? best.dir : undefined;
}

/**
 * The folder a document without a file of its own is offered to be saved in:
 * the one the caller suggests for this document, else the folder of the last
 * Save As, else `fallback` (the Documents folder).
 * @param {{suggested?: string | null, lastSave?: {dir?: string} | null, fallback?: string | null}} from
 * @returns {string | null}
 */
export function saveAsStartFolder({ suggested = null, lastSave = null, fallback = null } = {}) {
  return suggested || normalizeSaveFolder(lastSave)?.dir || fallback || null;
}

function normalizeSaveFolder(value) {
  if (!value || typeof value.dir !== 'string' || !value.dir) return null;
  return { dir: value.dir, t: Number(value.t) || 0 };
}

/** @returns {{dir: string, t: number} | null} the folder of the last Save As */
export function readLastSaveFolder() {
  return normalizeSaveFolder(leesOpslagJson(LAST_SAVE_FOLDER_NAME));
}

/**
 * Remember the folder of a file the user just saved through the Save As
 * dialog. Does nothing for a path without a folder.
 * @param {string} savedPath
 * @param {number} [now]
 * @returns {boolean} whether a folder was recorded
 */
export function rememberSaveFolder(savedPath, now = Date.now()) {
  const dir = folderOf(savedPath);
  if (!dir) return false;
  try {
    schrijfOpslagJson(LAST_SAVE_FOLDER_NAME, { dir, t: now });
    return true;
  } catch (e) {
    console.warn('[dialog-folder] not stored:', e);
    return false;
  }
}
