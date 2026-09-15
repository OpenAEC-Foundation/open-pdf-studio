// Reader Mode: per-PDF "where was I" memory — page, scroll position, and
// zoom — saved on close and restored on the next open of that same file,
// gated entirely by state.preferences.readerMode. This is NOT a session
// restore (which files were open, see main.js's restoreLastSession) and
// NOT a different rendering path — bookmarks/highlights/annotations are
// completely untouched; it only remembers a reading position per file.
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
// saver/ocr-text-layer.js's own comment on the same mechanism) registers
// the FILE's PARENT DIRECTORY, not just that one path — so writing/reading
// a sibling sidecar file needs no extra scope call.
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
 */
export async function saveReaderPosition(filePath, position) {
  if (!filePath) return;
  const data = { ...position, savedAt: Date.now() };
  if (isTauri()) {
    try {
      await writeBinaryFile(sidecarPath(filePath), encoder.encode(JSON.stringify(data)));
    } catch (e) {
      // Read-only folder, moved/removed file, etc. — losing the reading
      // position is a minor inconvenience, not worth surfacing to the user.
      console.warn('Failed to save reader-mode position sidecar:', e);
    }
    return;
  }
  try {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + filePath, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save reader-mode position:', e);
  }
}

/**
 * Forget the saved position for one file (e.g. if the user wants a fresh
 * start on their next open of it). Currently unused by the UI — exposed
 * for completeness/future use (e.g. a "forget reading position" item on
 * the file's context menu).
 * @param {string} filePath
 */
export async function clearReaderPosition(filePath) {
  if (!filePath) return;
  if (isTauri()) {
    try {
      if (window.__TAURI__?.fs?.remove) await window.__TAURI__.fs.remove(sidecarPath(filePath));
    } catch (e) {
      // Already gone, or never existed — fine either way.
    }
    return;
  }
  try {
    localStorage.removeItem(LOCAL_STORAGE_PREFIX + filePath);
  } catch (e) {
    // ignore
  }
}

/**
 * One-time migration from the earlier design (a single central
 * reader_positions.json under the app data directory) to per-file
 * sidecars: relocates each entry next to its own PDF, then blanks the
 * central file so it stops being a standing list of every PDF ever
 * opened. Best-effort per entry — a file that's been moved, renamed, or
 * is on a read-only volume just keeps its old central-store entry
 * un-migrated (silently dropped, same as any other inaccessible sidecar
 * write). Call once at startup; safe to call repeatedly (no-ops once the
 * central file is empty).
 */
export async function migrateLegacyReaderPositions() {
  if (!isTauri()) return;
  try {
    const { loadReaderPositionsFile, saveReaderPositionsFile } = await import('./platform.js');
    const legacy = await loadReaderPositionsFile();
    if (!legacy || typeof legacy !== 'object') return;
    const paths = Object.keys(legacy);
    if (paths.length === 0) return;
    for (const filePath of paths) {
      const { savedAt, ...position } = legacy[filePath] || {};
      await saveReaderPosition(filePath, position);
    }
    await saveReaderPositionsFile({});
  } catch (e) {
    console.warn('Reader Mode: legacy position migration failed:', e);
  }
}
