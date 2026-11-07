// Which captured print jobs the "Open PDF Printer" window has already shown.
//
// Jobs stay in the spool after "Open in Studio" (only Save, Merge and Delete
// remove them), so "every job in the spool" is not the same as "every job the
// user has not seen yet". The watcher remembers the job file names it has
// presented, across app starts, so a start only pops the window for jobs that
// arrived while the app was closed — not again for jobs already shown or
// opened. No DOM, no Tauri: unit-tested in print-queue-presented.test.mjs.

/** localStorage key of the presented job file names. */
export const PRESENTED_KEY = 'opds.printQueue.presented';

/** Upper bound of remembered names (the spool is cleaned by the user). */
export const MAX_PRESENTED = 1000;

const JOB_FILE_RE = /^job_[^\\/:\u0000]+\.pdf$/;

/** A spooled job file name as the Rust side lists it: the bare name
 *  `job_*.pdf` (case-sensitive, same rule as vp_job_naam_geldig in lib.rs). */
export function isJobFile(file) {
  return typeof file === 'string' && file.length <= 260 && JOB_FILE_RE.test(file);
}

/** The remembered names; an empty set when storage is missing or corrupt. */
export function readPresented(storage) {
  try {
    const raw = storage?.getItem?.(PRESENTED_KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter(isJobFile) : []);
  } catch (_) {
    return new Set();
  }
}

/** Store the names (sorted, valid job names only). Returns false on failure. */
export function writePresented(storage, files) {
  if (!storage?.setItem) return false;
  const list = [...new Set([...(files || [])].filter(isJobFile))].sort().slice(-MAX_PRESENTED);
  try {
    storage.setItem(PRESENTED_KEY, JSON.stringify(list));
    return true;
  } catch (_) {
    return false;
  }
}

/** Jobs of `list` that have not been presented yet (in list order). */
export function unpresentedJobs(list, presented) {
  return (Array.isArray(list) ? list : []).filter((j) => isJobFile(j?.file) && !presented.has(j.file));
}

/**
 * The names to remember after a sweep: the jobs still in the spool that were
 * presented before, plus all of them when the window was just shown (it lists
 * the whole queue). Names of jobs that left the spool are dropped.
 */
export function nextPresented(list, presented, shownNow) {
  const out = new Set();
  for (const j of Array.isArray(list) ? list : []) {
    if (!isJobFile(j?.file)) continue;
    if (shownNow || presented.has(j.file)) out.add(j.file);
  }
  return out;
}

/** Same members? */
export function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
