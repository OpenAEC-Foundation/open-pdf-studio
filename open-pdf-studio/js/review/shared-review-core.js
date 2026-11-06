// Shared review through a folder (#237): pure logic, no app state, no I/O.
//
// File layout. Next to `<name>.pdf` (or in a folder the user picks) one file
// per participant:
//
//   <folder>/<name>_Annotation_<User>.jsonl   append-only event log (source of truth)
//   <folder>/<name>_Annotation_<User>.xfdf    snapshot for other XFDF readers
//
// Default folder: `<dir>/<name>/`, as proposed in the issue. Every user only
// ever writes his own two files, so a sync drive never sees two writers on
// one file. The app reads all logs, merges them and derives the current state.
//
// Event model. One JSON object per line:
//   { v:1, id, uk, user, seq, clock, at, op, ann, base, data }
//   op    'create' | 'edit' | 'delete'
//   ann   the annotation id the event is about (the original id, kept by
//         every later edit or delete, also by other users)
//   base  the event id this change was made on top of (null for create)
//   data  full annotation snapshot (create/edit), absent for delete
//   seq   per-user sequence number, clock a Lamport clock (max seen + 1)
//   at    wall-clock time, ONLY for display (clocks of machines disagree)
//
// Conflict rule. Events are ordered by (clock, uk, seq, id). Replaying them
// in that order, the last event for an annotation decides its current state
// ("last writer wins" over a total order every participant computes alike,
// independent of clock skew). An edit or delete whose `base` is not the
// event that was current at that point was made concurrently; it still
// applies, but is marked `concurrent` in the history. Nothing is ever lost:
// every event stays in its author's log and in the history.

export const LOG_EXT = '.jsonl';
export const XFDF_EXT = '.xfdf';
export const MARKER = '_Annotation_';
export const EVENT_VERSION = 1;
const MAX_USER_LENGTH = 64;

// Never part of a snapshot or fingerprint: runtime caches (underscore keys)
// and save bookkeeping that changes without the user touching anything.
const SKIP_KEYS = new Set(['gebakkenIn', 'selected', 'hovered']);

// ── Names and paths ─────────────────────────────────────────────────────────

/**
 * A user name that is safe in a file name on Windows, macOS, Linux and the
 * common sync drives: letters, digits, dot, dash and underscore only. Spaces
 * and brackets become underscores, so a space or "(…)" in a file name is
 * always added by a sync client (a conflicted copy), never by us.
 */
export function sanitizeUserName(name) {
  let s = String(name ?? '').normalize('NFC').trim();
  s = s.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '_');
  s = s.replace(/_+/g, '_').replace(/^[._-]+|[._-]+$/g, '');
  const chars = Array.from(s);
  if (chars.length > MAX_USER_LENGTH) s = chars.slice(0, MAX_USER_LENGTH).join('').replace(/[._-]+$/, '');
  return s || 'User';
}

/** Identity of a participant; case-insensitive like most sync drives. */
export function userKey(name) {
  return sanitizeUserName(name).toLowerCase();
}

/** The separator a path already uses; a Windows path keeps backslashes. */
export function separatorOf(path) {
  const p = String(path || '');
  if (p.includes('\\') && !p.includes('/')) return '\\';
  if (/^[a-zA-Z]:/.test(p) && !p.includes('/')) return '\\';
  return '/';
}

export function joinPath(dir, name) {
  const d = String(dir || '');
  if (!d) return name;
  const sep = separatorOf(d);
  return /[\\/]$/.test(d) ? d + name : d + sep + name;
}

export function splitPdfPath(pdfPath) {
  const p = String(pdfPath || '');
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  let dir = i >= 0 ? p.slice(0, i) : '';
  // A root keeps its separator: "/x.pdf" → "/", "C:\\x.pdf" → "C:\\".
  if (i === 0) dir = p[0];
  else if (/^[a-zA-Z]:$/.test(dir)) dir += p[i];
  const file = i >= 0 ? p.slice(i + 1) : p;
  return { dir, base: file.replace(/\.pdf$/i, '') };
}

/** The review folder: the user's choice, else `<dir>/<name>/`. */
export function reviewFolderFor(pdfPath, customFolder = '') {
  const custom = String(customFolder || '').trim();
  if (custom) return custom.replace(/(.)[\\/]+$/, '$1');
  const { dir, base } = splitPdfPath(pdfPath);
  return joinPath(dir, base);
}

export function logFileName(pdfBase, user) {
  return `${pdfBase}${MARKER}${sanitizeUserName(user)}${LOG_EXT}`;
}

export function xfdfFileName(pdfBase, user) {
  return `${pdfBase}${MARKER}${sanitizeUserName(user)}${XFDF_EXT}`;
}

// Suffixes sync clients add to a copy they could not merge. Our own names
// never contain spaces or brackets, so anything from there on is theirs.
const SYNC_CONFLICT = /\.sync-conflict-[^.]*$/i;

/**
 * What a file in the review folder is. `null` for anything that is not a
 * review file of this PDF: other documents, temp files, hidden files.
 * @returns {{kind:'log'|'xfdf', user:string, uk:string, conflicted:boolean}|null}
 */
export function classifyReviewFile(fileName, pdfBase) {
  const name = String(fileName || '');
  if (!name || name.startsWith('.') || name.startsWith('~')) return null;
  const lower = name.toLowerCase();
  let kind = null;
  if (lower.endsWith(LOG_EXT)) kind = 'log';
  else if (lower.endsWith(XFDF_EXT)) kind = 'xfdf';
  if (!kind) return null;
  const prefix = `${pdfBase}${MARKER}`;
  if (!lower.startsWith(prefix.toLowerCase())) return null;
  let rest = name.slice(prefix.length, name.length - (kind === 'log' ? LOG_EXT : XFDF_EXT).length);
  let conflicted = false;
  if (SYNC_CONFLICT.test(rest)) { rest = rest.replace(SYNC_CONFLICT, ''); conflicted = true; }
  const foreign = rest.search(/[\s()]/);
  if (foreign >= 0) { rest = rest.slice(0, foreign); conflicted = true; }
  rest = rest.replace(/[._-]+$/, '');
  if (!rest) return null;
  if (sanitizeUserName(rest) !== rest) conflicted = true;
  return { kind, user: sanitizeUserName(rest), uk: userKey(rest), conflicted };
}

// ── Snapshots ───────────────────────────────────────────────────────────────

function plain(value) {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' || value === undefined ? undefined : value;
  }
  if (Array.isArray(value)) return value.map((v) => { const p = plain(v); return p === undefined ? null : p; });
  if (ArrayBuffer.isView(value)) return undefined;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (key.startsWith('_') || SKIP_KEYS.has(key)) continue;
    const p = plain(value[key]);
    if (p !== undefined) out[key] = p;
  }
  return out;
}

/** A plain, JSON-safe copy of an annotation without runtime fields. */
export function snapshotAnnotation(ann) {
  return plain(ann);
}

/** Stable text for comparing two versions (key order does not matter). */
export function fingerprint(ann) {
  return ann == null ? null : JSON.stringify(plain(ann));
}

/** Replace the contents of `target` by `data`, keeping object identity. */
export function replaceContents(target, data) {
  for (const key of Object.keys(target)) {
    if (key.startsWith('_') || SKIP_KEYS.has(key)) continue;
    if (!(key in data)) delete target[key];
  }
  Object.assign(target, structuredClone(data));
  return target;
}

// ── Event log (JSON lines) ──────────────────────────────────────────────────

const OPS = new Set(['create', 'edit', 'delete']);

export function isValidEvent(e) {
  return !!e && typeof e === 'object'
    && typeof e.id === 'string' && e.id
    && typeof e.uk === 'string' && e.uk
    && typeof e.ann === 'string' && e.ann
    && OPS.has(e.op)
    && Number.isFinite(e.clock) && Number.isFinite(e.seq)
    && (e.op === 'delete' || (e.data && typeof e.data === 'object'));
}

/**
 * Tolerant reader. A sync drive can hand over a file that is still being
 * written: a last line without newline that does not parse is `partial` and
 * simply read again next time; other broken lines are counted as `invalid`.
 */
export function parseEventLog(text) {
  const events = [];
  let invalid = 0;
  let partial = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  const lines = src.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) return;
    let e = null;
    try { e = JSON.parse(line); } catch { /* below */ }
    if (isValidEvent(e)) { events.push(e); return; }
    if (i === lines.length - 1 && !src.endsWith('\n')) partial = true;
    else invalid++;
  });
  return { events, invalid, partial };
}

export function serializeEvents(events) {
  return events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
}

export function compareEvents(a, b) {
  if (a.clock !== b.clock) return a.clock - b.clock;
  if (a.uk !== b.uk) return a.uk < b.uk ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** All events of all files, each event once (a conflicted copy repeats them). */
export function uniqueEvents(lists) {
  const seen = new Map();
  for (const list of lists) for (const e of list) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()].sort(compareEvents);
}

/**
 * Replays the events in total order.
 * @returns {{annotations: Map<string, {id, data, deleted, head, createdBy, updatedBy, updatedAt, history}>,
 *            events: object[], maxClock: number}}
 */
export function replayEvents(events) {
  const sorted = uniqueEvents([events]);
  const annotations = new Map();
  let maxClock = 0;
  for (const e of sorted) {
    maxClock = Math.max(maxClock, e.clock);
    let s = annotations.get(e.ann);
    if (!s) {
      s = { id: e.ann, data: null, deleted: false, head: null, createdBy: null, updatedBy: null, updatedAt: null, history: [] };
      annotations.set(e.ann, s);
    }
    // Concurrent: made without seeing the event that is current now. A
    // create for an id that already exists is a concurrent create.
    const concurrent = s.head !== null && (e.op === 'create' || e.base !== s.head);
    if (e.op === 'delete') {
      s.deleted = true;
    } else {
      s.data = e.data;
      s.deleted = false;
      if (!s.createdBy) s.createdBy = e.user || e.uk;
    }
    s.head = e.id;
    s.updatedBy = e.user || e.uk;
    s.updatedAt = e.at || null;
    s.history.push({ id: e.id, op: e.op, user: e.user || e.uk, uk: e.uk, at: e.at || null, clock: e.clock, base: e.base ?? null, concurrent });
  }
  return { annotations, events: sorted, maxClock };
}

/**
 * Reads all files of the folder into one view.
 * @param files  [{name, text, mtimeMs?}]
 * @param parseXfdf optional (xml) => annotation[]: a participant with only an
 *   XFDF file (written by another program) counts as his create events.
 */
export function mergeReviewFiles(files, pdfBase, { parseXfdf = null } = {}) {
  const participants = new Map();
  const participant = (uk, user) => {
    let p = participants.get(uk);
    if (!p) { p = { uk, user, events: 0, lastAt: null, lastClock: 0, files: [], conflictedFiles: 0, invalidLines: 0, partial: false }; participants.set(uk, p); }
    return p;
  };
  const lists = [];
  const logUsers = new Set();
  const xfdfFiles = [];
  for (const f of files) {
    const c = classifyReviewFile(f.name, pdfBase);
    if (!c) continue;
    if (c.kind === 'xfdf') { xfdfFiles.push({ ...f, c }); continue; }
    logUsers.add(c.uk);
    const { events, invalid, partial } = parseEventLog(f.text);
    lists.push(events);
    const p = participant(c.uk, c.user);
    p.files.push(f.name);
    p.invalidLines += invalid;
    p.partial = p.partial || partial;
    // A copy whose content belongs to someone else (e.g. "Bob-LAPTOP"):
    // the events name their author, the file name does not decide.
    if (c.conflicted || events.some((e) => e.uk !== c.uk)) p.conflictedFiles++;
  }
  if (parseXfdf) {
    for (const f of xfdfFiles) {
      if (logUsers.has(f.c.uk)) continue;
      let anns = [];
      try { anns = parseXfdf(f.text) || []; } catch { anns = []; }
      lists.push(anns.filter((a) => a && a.id).map((a, i) => ({
        v: EVENT_VERSION, id: `xfdf.${f.c.uk}.${a.id}`, uk: f.c.uk, user: f.c.user, seq: i + 1, clock: 0,
        at: a.modifiedAt || a.createdAt || null, op: 'create', ann: a.id, base: null, data: snapshotAnnotation(a),
      })));
      participant(f.c.uk, f.c.user).files.push(f.name);
    }
  }
  const replay = replayEvents(lists.flat());
  for (const e of replay.events) {
    const p = participant(e.uk, e.user || e.uk);
    if (e.user) p.user = e.user;
    p.events++;
    p.lastClock = Math.max(p.lastClock, e.clock);
    if (e.at && (!p.lastAt || e.at > p.lastAt)) p.lastAt = e.at;
  }
  return { ...replay, participants };
}

// ── Local view ⇄ shared state ───────────────────────────────────────────────
//
// `idOf(ann)` is the id an annotation has in the review. Normally its own id;
// annotations that were already in the PDF get a stable id (see stablePdfIds),
// because their local ids are made up anew each time the PDF is opened.

const ownId = (a) => a.id;
const viewOf = (ann, idOf) => {
  const id = idOf(ann);
  return id === ann.id ? ann : { ...ann, id };
};
const viewFp = (ann, idOf) => fingerprint(viewOf(ann, idOf));

/**
 * Ids for the annotations a PDF itself contains, the same on every machine
 * that opens the same file: the annotation's name (/NM, kept as `nm`) when it
 * has one, else page and position in the page's annotation list. Importing
 * the review into the PDF stores each shared id as /NM (see withPdfNames), so
 * after a save and reopen those annotations keep their review id.
 */
export function stablePdfIds(annotations) {
  const perPage = new Map();
  const ids = new Map();
  const used = new Set();
  for (const a of annotations) {
    if (!a?.id) continue;
    const n = perPage.get(a.page) ?? 0;
    perPage.set(a.page, n + 1);
    const nm = typeof a.nm === 'string' && a.nm.trim() ? a.nm : null;
    const id = nm && !used.has(nm) ? nm : `pdf:${a.page}:${n}`;
    used.add(id);
    ids.set(a.id, id);
  }
  return ids;
}

/** Gives each annotation its review id as PDF name, before an import into the PDF. */
export function withPdfNames(annotations, idOf = ownId) {
  for (const a of annotations) {
    const id = idOf(a);
    if (a?.id && a.nm == null && id) a.nm = id;
  }
  return annotations;
}

/**
 * Applies the derived state to the local annotations. `applied` remembers per
 * id what the local view was last synced to ({fp, head}); an annotation the
 * user changed since then stays as he left it (it is published later as a
 * concurrent edit). Returns a new array; changed objects keep their identity.
 */
export function applyDerived(current, derived, applied, baseline = new Map(), idOf = ownId) {
  const list = [...current];
  const byId = new Map(list.map((a) => [idOf(a), a]));
  const next = new Map(applied);
  const changes = { added: [], updated: [], removed: [] };
  for (const [id, s] of derived.annotations) {
    const prev = applied.get(id);
    const targetFp = s.deleted ? null : fingerprint(s.data);
    if (prev && prev.head === s.head) continue;
    const cur = byId.get(id);
    // A local change not yet published stays: also on an annotation of the PDF.
    if (prev && (cur ? viewFp(cur, idOf) : null) !== prev.fp) continue;
    if (!prev && cur && baseline.has(id) && viewFp(cur, idOf) !== baseline.get(id).fp) continue;
    if (s.deleted) {
      if (cur) { list.splice(list.indexOf(cur), 1); byId.delete(id); changes.removed.push(id); }
    } else if (cur) {
      if (viewFp(cur, idOf) !== targetFp) { replaceContents(cur, { ...s.data, id: cur.id }); changes.updated.push(id); }
    } else {
      const fresh = structuredClone(s.data);
      list.push(fresh);
      byId.set(id, fresh);
      changes.added.push(id);
    }
    next.set(id, { fp: targetFp, head: s.head });
  }
  return { annotations: list, applied: next, changes };
}

/**
 * What the user changed locally since the last sync, as events to publish.
 * `baseline` (id → {fp}) are the annotations the PDF itself contained.
 */
export function diffForPublish(current, applied, baseline = new Map(), idOf = ownId) {
  const out = [];
  const ids = new Set();
  for (const ann of current) {
    if (!ann?.id) continue;
    const view = viewOf(ann, idOf);
    const id = view.id;
    ids.add(id);
    const fp = fingerprint(view);
    const a = applied.get(id);
    if (a) {
      if (fp !== a.fp) out.push({ op: 'edit', ann: id, base: a.head, data: snapshotAnnotation(view) });
    } else if (baseline.has(id)) {
      if (fp !== baseline.get(id).fp) out.push({ op: 'edit', ann: id, base: null, data: snapshotAnnotation(view) });
    } else {
      out.push({ op: 'create', ann: id, base: null, data: snapshotAnnotation(view) });
    }
  }
  for (const [id, a] of applied) {
    if (a.fp !== null && !ids.has(id)) out.push({ op: 'delete', ann: id, base: a.head });
  }
  for (const id of baseline.keys()) {
    if (!ids.has(id) && !applied.has(id)) out.push({ op: 'delete', ann: id, base: null });
  }
  return out;
}

const defaultRandom = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/** Turns changes into events of `user`, after everything seen so far. */
export function makeEvents(changes, { user, lastSeq = 0, maxClock = 0, now = () => new Date(), random = defaultRandom }) {
  const uk = userKey(user);
  const at = new Date(now()).toISOString();
  return changes.map((c, i) => {
    const seq = lastSeq + i + 1;
    const e = { v: EVENT_VERSION, id: `${uk}.${seq}.${random()}`, uk, user: sanitizeUserName(user), seq, clock: maxClock + i + 1, at, op: c.op, ann: c.ann, base: c.base ?? null };
    if (c.op !== 'delete') e.data = c.data;
    return e;
  });
}

/** Records published events in `applied`, so they do not publish again. */
export function markPublished(applied, events) {
  const next = new Map(applied);
  for (const e of events) next.set(e.ann, { fp: e.op === 'delete' ? null : fingerprint(e.data), head: e.id });
  return next;
}

/**
 * The annotations a PDF save writes while shared review is on: exactly the
 * ones the PDF had (unchanged versions), never the shared ones. The PDF stays
 * as it was until the user imports the review into it.
 * @param baseline Map id → {fp, data, localId}, in PDF order
 */
export function annotationsForPdfSave(current, baseline, idOf = ownId) {
  const byId = new Map(current.map((a) => [idOf(a), a]));
  const out = [];
  for (const [id, b] of baseline) {
    const cur = byId.get(id);
    out.push(cur && viewFp(cur, idOf) === b.fp ? cur : { ...structuredClone(b.data), id: b.localId ?? id });
  }
  return out;
}

export function makeBaseline(annotations, idOf = ownId) {
  return new Map(annotations.filter((a) => a?.id).map((a) => {
    const view = viewOf(a, idOf);
    return [view.id, { fp: fingerprint(view), data: snapshotAnnotation(view), localId: a.id }];
  }));
}

// ── Folder polling ──────────────────────────────────────────────────────────

export function folderSignature(files) {
  return files.map((f) => `${f.name}|${f.size ?? ''}|${f.mtimeMs ?? ''}`).sort().join('\n');
}

/**
 * Polls `list()` and calls `onChange(files)` when the listing changed (name,
 * size or modification time). Timer and clock are injected so tests and the
 * app agree on behaviour without waiting. Polling instead of a file watcher:
 * network shares and sync drives often deliver no change events at all.
 */
export function createFolderPoller({ list, onChange, onError = () => {}, intervalMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let stopped = true;
  let running = null;
  let last = null;
  let interval = intervalMs;
  const schedule = () => {
    if (stopped) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; pollNow(); }, interval);
  };
  async function poll(force) {
    try {
      const files = await list();
      if (stopped) return false;
      const sig = folderSignature(files);
      if (!force && sig === last) return false;
      last = sig;
      await onChange(files);
      return true;
    } catch (e) {
      onError(e);
      return false;
    }
  }
  function pollNow(force = false) {
    if (running) return running;
    running = poll(force).finally(() => { running = null; schedule(); });
    return running;
  }
  return {
    start() { if (!stopped) return running || Promise.resolve(false); stopped = false; return pollNow(true); },
    stop() { stopped = true; if (timer !== null) clearTimer(timer); timer = null; },
    pollNow,
    setInterval(ms) { interval = Math.max(1000, Number(ms) || intervalMs); schedule(); },
    get running() { return !stopped; },
  };
}
