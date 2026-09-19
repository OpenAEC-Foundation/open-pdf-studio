// Reader Mode: per-PDF "where was I" memory — page, scroll position, and
// zoom — saved on close and restored on the next open of that same file,
// gated per-document via doc.readerModeActive (rules in
// reader-mode-tracking.js, view glue in pdf/reader-mode-view.js): a file
// starts with tracking off, turns on automatically on open if it already has
// a sidecar, or manually via the ribbon toggle. The sidecar IS the
// per-document setting: switching tracking on writes it at once, switching
// it off removes it. This is NOT a session restore (which files were open, see
// main.js's restoreLastSession) and NOT a different rendering path —
// bookmarks/highlights/annotations are completely untouched; it only
// remembers a reading position per file.
//
// Stored as a small SIDECAR file next to the PDF itself — e.g.
// "MyBook.pdf" gets "MyBook.pdf.readerpos.json" in the same folder —
// rather than one central list under the app's own data directory.
// Deliberately: a central list would accumulate an ever-growing, never-
// pruned record of every PDF the user has ever opened in one place (a
// privacy concern the user raised directly), whereas a sidecar carries no
// information beyond what's already implied by that one PDF sitting in
// that folder, and naturally travels or disappears with the file it
// belongs to. No cap/eviction logic is needed for the same reason — each
// file's sidecar is independent, nothing here accumulates.
//
// The PDF's own directory is already fs-scope-permitted by the time this
// runs: loader.js calls allow_fs_scope(filePath) on every open, which (per
// lib.rs's allow_fs_scope command) registers the FILE's PARENT DIRECTORY,
// not just that one path — so writing/reading a sibling sidecar file needs
// no extra scope call.
//
// Outside Tauri (no real filesystem to place a sidecar next to), falls
// back to a single localStorage entry per file path — same trade-off
// browsers already have for any other per-site storage.
import { isTauri, readBinaryFile, writeBinaryFile } from './platform.js';

const SIDECAR_SUFFIX = '.readerpos.json';
const LOCAL_STORAGE_PREFIX = 'readerModePosition:';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sidecarPath(filePath) {
  return filePath + SIDECAR_SUFFIX;
}

/**
 * @param {string} filePath
 * @returns {Promise<{page: number, scale: number, scrollTop: number, scrollHeight: number, viewMode: string} | null>}
 */
export async function getReaderPosition(filePath) {
  if (!filePath) return null;
  if (isTauri()) {
    try {
      const bytes = await readBinaryFile(sidecarPath(filePath));
      if (!bytes || bytes.length === 0) return null;
      return JSON.parse(decoder.decode(bytes));
    } catch (e) {
      return null; // no sidecar yet, or unreadable — both just mean "nothing saved"
    }
  }
  try {
    const s = localStorage.getItem(LOCAL_STORAGE_PREFIX + filePath);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Save the reading position for a file. No-op if `filePath` is falsy.
 * @param {string} filePath
 * @param {{page: number, scale: number, scrollTop: number, scrollHeight: number, viewMode: string}} position
 * @returns {Promise<boolean>} false when nothing could be written
 */
export async function saveReaderPosition(filePath, position) {
  if (!filePath) return false;
  const data = { ...position, savedAt: Date.now() };
  if (isTauri()) {
    try {
      await writeBinaryFile(sidecarPath(filePath), encoder.encode(JSON.stringify(data)));
      return true;
    } catch (e) {
      // Read-only folder, moved/removed file, etc. At close, losing the
      // reading position is a minor inconvenience; the ribbon toggle does
      // report it, because there it means tracking cannot be switched on.
      console.warn('Failed to save reader-mode position sidecar:', e);
      return false;
    }
  }
  try {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + filePath, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('Failed to save reader-mode position:', e);
    return false;
  }
}

/**
 * Forget the reading position for a file: removes the sidecar (or the
 * localStorage entry outside Tauri). This is what makes switching tracking
 * off stick — a sidecar left behind would switch tracking back on at the
 * next open and jump to a stale position.
 * @param {string} filePath
 * @returns {Promise<boolean>} true when no stored position is left
 */
export async function clearReaderPosition(filePath) {
  if (!filePath) return true;
  if (isTauri()) {
    const fs = window.__TAURI__.fs;
    const target = sidecarPath(filePath);
    try {
      if (fs?.exists && !(await fs.exists(target))) return true;
      await fs.remove(target);
      return true;
    } catch (e) {
      console.warn('Failed to remove reader-mode position sidecar:', e);
      return false;
    }
  }
  try {
    localStorage.removeItem(LOCAL_STORAGE_PREFIX + filePath);
    return true;
  } catch (e) {
    console.warn('Failed to remove reader-mode position:', e);
    return false;
  }
}
