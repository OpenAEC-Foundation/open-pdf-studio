// Shared review through a folder (#237): the app side. The rules live in
// shared-review-core.js; this file connects them to the open documents, the
// file system (Rust: src-tauri/src/shared_review.rs) and the status bar.
//
// While a review runs, the PDF keeps exactly the annotations it had when the
// review started (see annotationsForPdfSave); everything else lives in the
// review folder until the user imports the review into the PDF.
import { state } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';
import { isTauri, invoke } from '../core/platform.js';
import {
  reviewFolderFor, splitPdfPath, logFileName, xfdfFileName, classifyReviewFile, userKey, sanitizeUserName,
  mergeReviewFiles, applyDerived, diffForPublish, makeEvents, markPublished, serializeEvents,
  annotationsForPdfSave, makeBaseline, createFolderPoller, stablePdfIds, withPdfNames, fingerprint,
} from './shared-review-core.js';
import { registerSharedReviewHooks } from './shared-review-hooks.js';
import { setReviewStatus } from './shared-review-status.js';

const sessions = new Map(); // doc → session
const starting = new Set(); // documents whose review is resuming
const DEFAULT_INTERVAL_S = 5;

const io = {
  list: (dir) => invoke('shared_review_list', { dir }),
  read: (dir, name) => invoke('shared_review_read', { dir, name }),
  write: (dir, name, text) => invoke('shared_review_write', { dir, name, text }),
};

const prefs = () => state.preferences.sharedReview || { intervalSeconds: DEFAULT_INTERVAL_S, documents: {} };
function persist(value) {
  state.preferences.sharedReview = value;
  savePreferences();
}
export function reviewIntervalSeconds() {
  const s = Number(prefs().intervalSeconds);
  return Number.isFinite(s) && s >= 2 ? Math.min(s, 600) : DEFAULT_INTERVAL_S;
}
export function setReviewIntervalSeconds(seconds) {
  persist({ ...prefs(), intervalSeconds: Math.max(2, Math.min(600, Math.round(Number(seconds) || DEFAULT_INTERVAL_S))) });
  for (const s of sessions.values()) s.poller.setInterval(reviewIntervalSeconds() * 1000);
}
export function savedReviewSettings(path) {
  return path ? prefs().documents?.[path] ?? null : null;
}
function rememberSettings(path, value) {
  const documents = { ...(prefs().documents || {}) };
  if (value) documents[path] = value;
  else delete documents[path];
  persist({ ...prefs(), documents });
}

export const reviewUser = () => sanitizeUserName(state.preferences?.authorName || state.defaultAuthor || 'User');

async function redraw(doc) {
  if (!state.documents.includes(doc) || state.documents[state.activeDocumentIndex] !== doc) return;
  const { redrawAnnotations, redrawContinuous } = await import('../annotations/rendering.js');
  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

let parseXfdf = null;
async function xfdfReader() {
  if (!parseXfdf) parseXfdf = (await import('../annotations/xfdf.js')).parseXfdfAnnotations;
  return parseXfdf;
}

function publishStatus(s) {
  if (!sessions.has(s.doc)) { setReviewStatus(s.path, null); return; }
  setReviewStatus(s.path, {
    folder: s.folder,
    user: s.user,
    autoPublish: s.autoPublish,
    unseen: s.unseen,
    lastUpdate: s.lastUpdate,
    lastPublished: s.lastPublished,
    error: s.error,
    pending: diffForPublish(s.doc.annotations || [], s.applied, s.baseline, s.idOf).length,
  });
}

async function refresh(s, files) {
  if (!state.documents.includes(s.doc)) { stopSharedReview(s.doc, { forget: false }); return; }
  if (!sessions.has(s.doc) || sessions.get(s.doc) !== s) return;
  const seen = new Set();
  for (const f of files) {
    if (!classifyReviewFile(f.name, s.base)) continue;
    seen.add(f.name);
    const cached = s.cache.get(f.name);
    if (cached && cached.size === f.size && cached.mtimeMs === f.mtimeMs) continue;
    const text = await io.read(s.folder, f.name);
    if (!sessions.has(s.doc)) return;
    s.cache.set(f.name, { size: f.size, mtimeMs: f.mtimeMs, text });
  }
  for (const name of [...s.cache.keys()]) if (!seen.has(name) && !s.ownWrites.has(name)) s.cache.delete(name);
  await rebuild(s, { countUnseen: !s.firstRead });
  s.firstRead = false;
}

async function rebuild(s, { countUnseen }) {
  const files = [...s.cache].map(([name, c]) => ({ name, text: c.text }));
  s.merged = mergeReviewFiles(files, s.base, { parseXfdf: await xfdfReader() });
  s.lastSeq = s.merged.events.filter((e) => e.uk === s.uk).reduce((m, e) => Math.max(m, e.seq), 0);
  const res = applyDerived(s.doc.annotations || [], s.merged, s.applied, s.baseline, s.idOf);
  s.applied = res.applied;
  const n = res.changes.added.length + res.changes.updated.length + res.changes.removed.length;
  if (n) {
    s.doc.annotations = res.annotations;
    if (res.changes.removed.length && Array.isArray(s.doc.selectedAnnotations)) {
      const gone = new Set(res.changes.removed);
      s.doc.selectedAnnotations = s.doc.selectedAnnotations.filter((a) => !gone.has(a.id));
    }
    if (countUnseen) s.unseen += n;
    await redraw(s.doc);
  }
  s.lastUpdate = new Date().toISOString();
  s.error = null;
  publishStatus(s);
}

// The background loader fills the model page by page (pdf/loader.js); wait
// for it, then load what is still missing. Bounded: a stuck page must not
// keep the review from starting.
async function waitForPdfAnnotations(doc, { timeoutMs = 60000, stepMs = 100 } = {}) {
  const pages = doc.pdfDoc?.numPages || 0;
  if (!pages) return;
  const ready = () => (doc._annotationPagesReady?.size ?? pages) >= pages && !(doc._pagesNeedingColorUpdate?.size);
  for (let waited = 0; !ready() && waited < timeoutMs; waited += stepMs) {
    await new Promise((r) => setTimeout(r, stepMs));
    if (!state.documents.includes(doc)) return;
  }
  if (!ready()) {
    const { laadAnnotatiesVoorPaginas } = await import('../pdf/loader.js');
    await laadAnnotatiesVoorPaginas(doc, Array.from({ length: pages }, (_, i) => i + 1));
  }
}

/** Starts (or restarts) the shared review of `doc`. */
export async function startSharedReview(doc, { folder = '', autoPublish = true } = {}) {
  if (!isTauri()) throw new Error('DESKTOP_REQUIRED');
  if (!doc?.filePath || doc.isUntitled || !/\.pdf$/i.test(doc.filePath)) throw new Error('SAVE_FIRST');
  stopSharedReview(doc, { forget: false });
  // All annotations of the PDF in the model first: they are the baseline the
  // PDF keeps, and must not be mistaken for new shared annotations.
  await waitForPdfAnnotations(doc);
  const user = reviewUser();
  const pdfIds = stablePdfIds(doc.annotations || []);
  const idOf = (a) => pdfIds.get(a.id) ?? a.id;
  const s = {
    doc, path: doc.filePath, folder: reviewFolderFor(doc.filePath, folder), customFolder: folder || '',
    base: splitPdfPath(doc.filePath).base, user, uk: userKey(user), autoPublish: !!autoPublish, idOf,
    cache: new Map(), ownWrites: new Set(), merged: null, applied: new Map(), baseline: makeBaseline(doc.annotations || [], idOf),
    lastSeq: 0, unseen: 0, lastUpdate: null, lastPublished: null, error: null, firstRead: true, queue: Promise.resolve(),
  };
  s.poller = createFolderPoller({
    list: () => io.list(s.folder),
    onChange: (files) => enqueue(s, () => refresh(s, files)),
    onError: () => { s.error = 'READ_FAILED'; publishStatus(s); },
    intervalMs: reviewIntervalSeconds() * 1000,
  });
  sessions.set(doc, s);
  rememberSettings(doc.filePath, { folder: s.customFolder, autoPublish: s.autoPublish });
  await s.poller.start();
  publishStatus(s);
  return sharedReviewInfo(doc);
}

export function stopSharedReview(doc, { forget = true } = {}) {
  const s = sessions.get(doc);
  if (s) {
    s.poller.stop();
    sessions.delete(doc);
    setReviewStatus(s.path, null);
  }
  if (forget && doc?.filePath) rememberSettings(doc.filePath, null);
}

export function setAutoPublish(doc, value) {
  const s = sessions.get(doc);
  if (!s) return;
  s.autoPublish = !!value;
  rememberSettings(s.path, { folder: s.customFolder, autoPublish: s.autoPublish });
  publishStatus(s);
}

/** Writes my changes since the last sync to my own files. */
export function publishSharedReview(doc) {
  const s = sessions.get(doc);
  if (!s) return Promise.resolve(0);
  return enqueue(s, () => publishNow(s)).catch((e) => {
    s.error = 'WRITE_FAILED';
    publishStatus(s);
    throw e;
  });
}

// Reading and publishing one after another; a failure does not block the next.
function enqueue(s, fn) {
  const run = s.queue.then(fn);
  s.queue = run.catch(() => {});
  return run;
}

async function publishNow(s) {
  // The latest state of the others first, so my edits build on it.
  const files = await io.list(s.folder);
  await refresh(s, files);
  const changes = diffForPublish(s.doc.annotations || [], s.applied, s.baseline, s.idOf);
  const logName = logFileName(s.base, s.user);
  if (!changes.length && s.cache.has(logName)) return 0;
  const events = makeEvents(changes, { user: s.user, lastSeq: s.lastSeq, maxClock: s.merged?.maxClock || 0 });
  // My log: every event of mine from every copy (a conflicted copy of my own
  // file included) plus the new ones; written whole, atomically.
  const mine = [...(s.merged?.events || []).filter((e) => e.uk === s.uk), ...events];
  const text = serializeEvents(mine);
  await io.write(s.folder, logName, text);
  s.ownWrites.add(logName);
  s.cache.set(logName, { size: -1, mtimeMs: -1, text });
  s.applied = markPublished(s.applied, events);
  await rebuild(s, { countUnseen: false });
  await writeSnapshot(s);
  s.lastPublished = new Date().toISOString();
  publishStatus(s);
  return events.length;
}

// For other programs: my current annotations (the ones I created) as XFDF.
async function writeSnapshot(s) {
  const { annotationsToXfdf } = await import('../annotations/xfdf.js');
  const ids = new Set([...s.merged.annotations.values()].filter((a) => !a.deleted && userKey(a.createdBy || '') === s.uk).map((a) => a.id));
  const mine = (s.doc.annotations || []).filter((a) => ids.has(s.idOf(a)));
  const name = xfdfFileName(s.base, s.user);
  const xml = annotationsToXfdf(mine, { fileName: `${s.base}.pdf`, doc: s.doc, names: true });
  await io.write(s.folder, name, xml);
  s.ownWrites.add(name);
  s.cache.set(name, { size: -1, mtimeMs: -1, text: xml });
}

export function refreshSharedReview(doc) {
  return sessions.get(doc)?.poller.pollNow(true) ?? Promise.resolve(false);
}

/** The review becomes part of the PDF: the next save writes it. */
export function importSharedIntoPdf(doc) {
  const s = sessions.get(doc);
  if (!s) return false;
  // Each annotation keeps its review id as PDF name (/NM): opened again,
  // the review recognises them instead of showing them twice.
  withPdfNames(doc.annotations || [], s.idOf);
  for (const a of doc.annotations || []) {
    const id = s.idOf(a);
    const prev = s.applied.get(id);
    if (prev) s.applied.set(id, { ...prev, fp: fingerprint({ ...a, id }) });
  }
  s.baseline = makeBaseline(doc.annotations || [], s.idOf);
  import('../ui/chrome/tabs.js').then((m) => m.markDocumentModified(doc)).catch(() => {});
  publishStatus(s);
  return true;
}

export function markReviewSeen(doc) {
  const s = sessions.get(doc);
  if (s && s.unseen) { s.unseen = 0; publishStatus(s); }
}

export function sharedReviewInfo(doc) {
  const s = sessions.get(doc);
  if (!s) return null;
  const participants = [...(s.merged?.participants.values() || [])]
    .map((p) => ({ ...p, files: [...p.files], me: p.uk === s.uk }))
    .sort((a, b) => (a.lastAt || '') < (b.lastAt || '') ? 1 : -1);
  const byId = new Map((doc.annotations || []).map((a) => [s.idOf(a), a]));
  const annotations = [...(s.merged?.annotations.values() || [])].map((a) => {
    const data = byId.get(a.id) || a.data || {};
    return {
      id: a.id, type: data.type || '', page: data.page || null,
      label: String(data.text || data.subject || data.label || data.stampText || '').slice(0, 80),
      deleted: a.deleted, createdBy: a.createdBy, updatedBy: a.updatedBy, updatedAt: a.updatedAt,
      history: a.history.map((h) => ({ ...h })),
    };
  });
  return {
    folder: s.folder, customFolder: s.customFolder, user: s.user, autoPublish: s.autoPublish,
    unseen: s.unseen, lastUpdate: s.lastUpdate, lastPublished: s.lastPublished, error: s.error,
    pending: diffForPublish(doc.annotations || [], s.applied, s.baseline, s.idOf).length,
    participants, annotations,
  };
}

export function hasSharedReview(doc) {
  return sessions.has(doc);
}

registerSharedReviewHooks({
  annotationsForSave(doc) {
    const s = sessions.get(doc);
    return s ? annotationsForPdfSave(doc.annotations || [], s.baseline, s.idOf) : null;
  },
  afterPdfSaved(doc) {
    const s = sessions.get(doc);
    if (s?.autoPublish) publishSharedReview(doc).catch((e) => console.warn('[shared-review] publish failed:', e));
  },
});

/** Resume the review of a document that had one, when it is opened again. */
export function installSharedReview() {
  if (typeof document === 'undefined' || !isTauri()) return;
  const resume = () => {
    for (const doc of state.documents) {
      const saved = savedReviewSettings(doc?.filePath);
      if (!saved || !doc.pdfDoc || sessions.has(doc) || starting.has(doc)) continue;
      starting.add(doc);
      startSharedReview(doc, saved)
        .catch((e) => console.warn('[shared-review] resume failed:', e))
        .finally(() => starting.delete(doc));
    }
  };
  document.addEventListener('pdf-loaded', resume);
  resume();
}
