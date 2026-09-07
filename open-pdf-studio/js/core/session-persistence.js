// Shared-session persistence — survive a browser reload without losing work.
//
// Why this exists, and how it relates to the relay journal:
//
//   OPFS (here)     the tab's OWN complete state — the PDF bytes and every
//                   annotation, agent-drawn and person-drawn alike. Same
//                   browser, same session: a refresh or a crash restores
//                   instantly. There is no sync problem because the tab is
//                   the only writer.
//
//   Relay journal   the ordered list of calls the agent made. Recovers the
//                   agent's half when the TAB is gone for good — a different
//                   machine, cleared storage, a new session.
//
// They are complementary, not duplicates. The journal deliberately cannot see
// the person's redlines: those are drawn in the tab and never travel through
// the relay, which is exactly the gap this closes.
//
// Keyed by relay session code. The transport keeps that code in
// sessionStorage across a reload (inside the relay's grace window), so the
// key is stable for precisely as long as the session is.

const DIR_NAME = 'ops-sessions';
const SNAPSHOT_VERSION = 1;

/** Sessions older than this are swept — an abandoned tab should not leave
 *  a document in the user's storage quota forever. */
export const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ── Pure logic (tested; no OPFS, no DOM) ────────────────────────────────

/** Session codes come from the relay's fixed alphabet. Anything else must not
 *  reach a file name. */
export function isValidKey(code) {
  return typeof code === 'string' && /^[0-9A-HJKMNP-TV-Z]{8,64}$/.test(code);
}

/**
 * The serialisable half of a document. Deliberately NOT the PDF bytes — those
 * are written alongside as a binary file, because base64 in JSON would inflate
 * a 17x11 sheet by a third for no benefit.
 */
export function snapshotFromDocument(doc, extra = {}) {
  if (!doc) return null;
  return {
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    fileName: doc.fileName || 'Untitled.pdf',
    isUntitled: doc.isUntitled !== false,
    currentPage: doc.currentPage || 1,
    pageDims: doc.pageDims || {},
    undoFloor: doc.undoFloor || 0,
    annotations: Array.isArray(doc.annotations) ? doc.annotations : [],
    ...extra,
  };
}

/** Is a parsed snapshot usable? A version bump or a torn write must not take
 *  the app down on startup — it should read as "nothing to restore". */
export function isRestorable(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.version !== SNAPSHOT_VERSION) return false;
  if (!Array.isArray(snapshot.annotations)) return false;
  if (!Number.isFinite(snapshot.savedAt)) return false;
  return true;
}

/** Which stored keys should be swept, given the live one and a clock. */
export function keysToPrune(entries, keepKey, now = Date.now(), maxAgeMs = MAX_SNAPSHOT_AGE_MS) {
  return entries
    .filter((e) => e.key !== keepKey)
    .filter((e) => !Number.isFinite(e.savedAt) || now - e.savedAt > maxAgeMs)
    .map((e) => e.key);
}

/** Split the person's marks from the agent's. Used for the restore summary —
 *  "3 of these were yours" is the reassurance that matters after a refresh. */
export function countByAuthor(annotations, agentAuthor) {
  let agent = 0;
  let person = 0;
  for (const a of annotations || []) {
    if (a?.author && a.author === agentAuthor) agent++;
    else person++;
  }
  return { agent, person, total: agent + person };
}

// ── OPFS I/O ────────────────────────────────────────────────────────────

export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

async function sessionsDir(create = false) {
  if (!isSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR_NAME, { create });
  } catch {
    return null; // no OPFS (private mode, old browser) — persistence is off
  }
}

async function writeFile(dir, name, data) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

/**
 * Persist the document under a session key. Never throws into the caller:
 * a storage failure must not break drawing, it just means the safety net is
 * not there this time.
 */
export async function saveSnapshot(key, doc, pdfBytes, extra) {
  if (!isValidKey(key) || !doc) return false;
  const dir = await sessionsDir(true);
  if (!dir) return false;

  try {
    const snapshot = snapshotFromDocument(doc, extra);
    await writeFile(dir, `${key}.json`, JSON.stringify(snapshot));
    if (pdfBytes && pdfBytes.byteLength) {
      // The bytes never change for a blank sheet, but a page insert or a
      // save rewrites them, so keep them in step with the annotations.
      await writeFile(dir, `${key}.pdf`, pdfBytes);
    }
    return true;
  } catch (e) {
    console.warn('[session-persistence] save failed:', e?.message ?? e);
    return false;
  }
}

/** Read a snapshot back. Returns `{ snapshot, bytes }` or null. */
export async function loadSnapshot(key) {
  if (!isValidKey(key)) return null;
  const dir = await sessionsDir(false);
  if (!dir) return null;

  try {
    const jsonHandle = await dir.getFileHandle(`${key}.json`);
    const snapshot = JSON.parse(await (await jsonHandle.getFile()).text());
    if (!isRestorable(snapshot)) return null;

    let bytes = null;
    try {
      const pdfHandle = await dir.getFileHandle(`${key}.pdf`);
      bytes = new Uint8Array(await (await pdfHandle.getFile()).arrayBuffer());
    } catch {
      // Annotations without their page bytes cannot be shown on anything.
      return null;
    }
    return { snapshot, bytes };
  } catch {
    return null; // nothing stored for this session — the normal first-run case
  }
}

export async function clearSnapshot(key) {
  if (!isValidKey(key)) return;
  const dir = await sessionsDir(false);
  if (!dir) return;
  for (const name of [`${key}.json`, `${key}.pdf`]) {
    try { await dir.removeEntry(name); } catch { /* already gone */ }
  }
}

/** Drop snapshots from sessions that are over. Returns the keys removed. */
export async function pruneSnapshots(keepKey) {
  const dir = await sessionsDir(false);
  if (!dir) return [];

  const entries = [];
  try {
    for await (const [name, handle] of dir.entries()) {
      if (!name.endsWith('.json')) continue;
      const key = name.slice(0, -'.json'.length);
      let savedAt = NaN;
      try {
        savedAt = JSON.parse(await (await handle.getFile()).text())?.savedAt;
      } catch { /* unreadable counts as stale */ }
      entries.push({ key, savedAt });
    }
  } catch {
    return [];
  }

  const doomed = keysToPrune(entries, keepKey);
  for (const key of doomed) await clearSnapshot(key);
  return doomed;
}
