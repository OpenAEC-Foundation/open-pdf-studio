// Pending page edits of the Edit Pages organizer (#764).
//
// The organizer never touches the document until Apply. Everything the user
// does — reorder, rotate, delete, insert a blank page or the pages of another
// PDF, place split marks — changes a plan; Apply hands the plan to
// applyPageEdits() in page-manager.js, which carries it out as one undo step.
// Cancel throws the plan away.
//
// A plan is { entries, splits, seq }:
// - entries: the pages of the result, in their new order. Each entry is
//     { key, kind: 'page', page, rotation }          a page of the document
//     { key, kind: 'blank', rotation }               a new blank page
//     { key, kind: 'file', source, index, rotation } page `index` (0-based) of
//                                                    an added PDF `source`
//   `rotation` is the pending turn in degrees (0, 90, 180, 270) on top of how
//   the page shows now. A page of the document that is not in the entries is
//   deleted.
// - splits: keys of the entries that start a new part when the result is
//   split into separate files (a split mark in the gap in front of them).
// - seq: counter for the keys of new entries.
//
// No app imports and no DOM: the model is tested on its own. Plans are never
// changed in place; every operation returns a new plan.

import { moveGroupToGap, moveSelectionBy, moveSelectionToEdge } from './page-order.js';

/** Size of a blank page when there is no page to take the size from (A4, points). */
export const A4 = Object.freeze({ width: 595.28, height: 841.89 });

/** A turn in degrees as 0, 90, 180 or 270. */
export function normRotation(degrees) {
  const r = Math.round((Number(degrees) || 0) / 90) * 90;
  return ((r % 360) + 360) % 360;
}

/** The plan of a document with `count` pages as it is now. */
export function createPlan(count) {
  const n = Math.max(0, count | 0);
  return {
    entries: Array.from({ length: n }, (_, i) => ({ key: `p${i + 1}`, kind: 'page', page: i + 1, rotation: 0 })),
    splits: [],
    seq: 0,
  };
}

export function keysOf(plan) {
  return plan.entries.map((e) => e.key);
}

function withEntries(plan, entries, extra = {}) {
  return normalizeSplits({ ...plan, entries, ...extra });
}

/** Split marks only in front of entries that exist and are not the first. */
export function normalizeSplits(plan) {
  const index = new Map(plan.entries.map((e, i) => [e.key, i]));
  const splits = [...new Set(plan.splits || [])]
    .filter((k) => index.has(k) && index.get(k) > 0)
    .sort((a, b) => index.get(a) - index.get(b));
  return { ...plan, splits };
}

/** True when the entries leave the document as it is (split marks aside). */
export function isStructureUnchanged(plan, count) {
  return plan.entries.length === count
    && plan.entries.every((e, i) => e.kind === 'page' && e.page === i + 1 && !normRotation(e.rotation));
}

/** True when Apply would do nothing at all. */
export function isPlanUnchanged(plan, count) {
  return isStructureUnchanged(plan, count) && plan.splits.length === 0;
}

// ── Reorder ─────────────────────────────────────────────────────────────────

/** Moves the selected entries as one group to gap `gap` (see page-order.js). */
export function moveEntriesToGap(plan, keys, gap) {
  const order = moveGroupToGap(keysOf(plan), keys, gap);
  return reorderByKeys(plan, order);
}

/** Keyboard move: every selected entry one place left (-1) or right (+1). */
export function moveEntriesBy(plan, keys, delta) {
  return reorderByKeys(plan, moveSelectionBy(keysOf(plan), keys, delta));
}

/** Moves the selected entries to the start or the end. */
export function moveEntriesToEdge(plan, keys, edge) {
  return reorderByKeys(plan, moveSelectionToEdge(keysOf(plan), keys, edge));
}

function reorderByKeys(plan, order) {
  const byKey = new Map(plan.entries.map((e) => [e.key, e]));
  return withEntries(plan, order.map((k) => byKey.get(k)));
}

// ── Rotate ──────────────────────────────────────────────────────────────────

/** Turns the selected entries by `delta` degrees (a multiple of 90). */
export function rotateEntries(plan, keys, delta) {
  const sel = new Set(keys);
  if (!sel.size) return plan;
  return withEntries(plan, plan.entries.map((e) => (
    sel.has(e.key) ? { ...e, rotation: normRotation(e.rotation + delta) } : e
  )));
}

// ── Delete ──────────────────────────────────────────────────────────────────

/** True when deleting these entries would leave no page at all. */
export function wouldDeleteAll(plan, keys) {
  const sel = new Set(keys);
  return plan.entries.length > 0 && plan.entries.every((e) => sel.has(e.key));
}

/**
 * Deletes the selected entries. A document cannot end up without pages:
 * deleting every entry is refused and the plan stays as it was.
 * A split mark in front of a deleted entry moves to the next entry that
 * stays, so the parts keep their boundary.
 * @returns {{plan: object, refused: boolean}}
 */
export function deleteEntries(plan, keys) {
  const sel = new Set(keys);
  if (![...sel].some((k) => plan.entries.some((e) => e.key === k))) return { plan, refused: false };
  if (wouldDeleteAll(plan, keys)) return { plan, refused: true };
  const splits = new Set(plan.splits);
  let carry = false;
  for (const e of plan.entries) {
    if (sel.has(e.key)) {
      if (splits.has(e.key)) carry = true;
      splits.delete(e.key);
    } else if (carry) {
      splits.add(e.key);
      carry = false;
    }
  }
  return {
    plan: withEntries(plan, plan.entries.filter((e) => !sel.has(e.key)), { splits: [...splits] }),
    refused: false,
  };
}

// ── Insert ──────────────────────────────────────────────────────────────────

function clampGap(plan, gap) {
  return Math.max(0, Math.min(plan.entries.length, Math.round(Number(gap) || 0)));
}

function insertAt(plan, gap, newEntries, seq) {
  const g = clampGap(plan, gap);
  const entries = [...plan.entries.slice(0, g), ...newEntries, ...plan.entries.slice(g)];
  return withEntries(plan, entries, { seq });
}

/**
 * Inserts `count` blank pages in gap `gap`. Their size is decided on Apply:
 * that of the page in front of them, or else the page after them (see
 * blankSizeNeighbour), or A4.
 * @returns {{plan: object, keys: string[]}} the plan and the keys of the new pages
 */
export function insertBlank(plan, gap, count = 1) {
  let seq = plan.seq;
  const added = [];
  for (let i = 0; i < Math.max(1, count | 0); i++) {
    seq += 1;
    added.push({ key: `b${seq}`, kind: 'blank', rotation: 0 });
  }
  return { plan: insertAt(plan, gap, added, seq), keys: added.map((e) => e.key) };
}

/**
 * Inserts all `pageCount` pages of an added PDF (`source`) in gap `gap`.
 * @returns {{plan: object, keys: string[]}}
 */
export function insertSource(plan, gap, source, pageCount) {
  let seq = plan.seq;
  const added = [];
  for (let i = 0; i < Math.max(0, pageCount | 0); i++) {
    seq += 1;
    added.push({ key: `f${seq}`, kind: 'file', source, index: i, rotation: 0 });
  }
  if (!added.length) return { plan, keys: [] };
  return { plan: insertAt(plan, gap, added, seq), keys: added.map((e) => e.key) };
}

/**
 * The page a blank entry takes its size from: the nearest document page in
 * front of it, else the nearest after it. Returns the entry or null.
 */
export function blankSizeNeighbour(entries, index) {
  for (let i = index - 1; i >= 0; i--) if (entries[i].kind === 'page') return entries[i];
  for (let i = index + 1; i < entries.length; i++) if (entries[i].kind === 'page') return entries[i];
  return null;
}

/**
 * Size of a blank page next to a page of `width` x `height` points (its
 * unrotated box) that shows turned by `shownRotation` degrees: the blank
 * page shows the same way up as its neighbour. Without a neighbour: A4.
 */
export function blankSizeFor(neighbour, shownRotation = 0) {
  if (!neighbour || !(neighbour.width > 0) || !(neighbour.height > 0)) return { ...A4 };
  const turned = normRotation(shownRotation) % 180 === 90;
  return turned
    ? { width: neighbour.height, height: neighbour.width }
    : { width: neighbour.width, height: neighbour.height };
}

// ── Split marks ─────────────────────────────────────────────────────────────

/** True when there is a split mark in gap `gap` (in front of entries[gap]). */
export function hasSplitAt(plan, gap) {
  const e = plan.entries[gap];
  return gap > 0 && !!e && plan.splits.includes(e.key);
}

/** Places or removes the split mark in gap `gap`; gap 0 and the end take none. */
export function toggleSplit(plan, gap) {
  const g = Math.round(Number(gap));
  if (!(g > 0 && g < plan.entries.length)) return plan;
  const key = plan.entries[g].key;
  const splits = plan.splits.includes(key) ? plan.splits.filter((k) => k !== key) : [...plan.splits, key];
  return normalizeSplits({ ...plan, splits });
}

/**
 * Split marks around the selection: every run of selected entries becomes a
 * part of its own (batch action "Split").
 */
export function splitAroundSelection(plan, keys) {
  const sel = new Set(keys);
  const splits = new Set(plan.splits);
  plan.entries.forEach((e, i) => {
    if (i === 0) return;
    const prev = plan.entries[i - 1];
    if (sel.has(e.key) !== sel.has(prev.key)) splits.add(e.key);
  });
  return normalizeSplits({ ...plan, splits: [...splits] });
}

/** Removes every split mark. */
export function clearSplits(plan) {
  return { ...plan, splits: [] };
}

/**
 * The parts the split marks cut the result into, as page ranges of the
 * result ({start, eind}, 1-based, inclusive — the shape splits-logica.js
 * uses). Without split marks: [] (nothing to split).
 */
export function splitRanges(plan) {
  const p = normalizeSplits(plan);
  if (!p.splits.length) return [];
  const starts = [1, ...p.splits.map((k) => p.entries.findIndex((e) => e.key === k) + 1)];
  return starts.map((start, i) => ({ start, eind: i + 1 < starts.length ? starts[i + 1] - 1 : p.entries.length }));
}

// ── Applying ────────────────────────────────────────────────────────────────

/**
 * True when the plan can be carried out on a document of `count` pages with
 * these added PDFs (`sourcePageCounts`: source id -> number of pages).
 */
export function isValidPlan(plan, count, sourcePageCounts = {}) {
  if (!plan || !Array.isArray(plan.entries) || plan.entries.length === 0) return false;
  const seen = new Set();
  const keys = new Set();
  for (const e of plan.entries) {
    if (!e || keys.has(e.key)) return false;
    keys.add(e.key);
    if (e.kind === 'page') {
      if (!Number.isInteger(e.page) || e.page < 1 || e.page > count || seen.has(e.page)) return false;
      seen.add(e.page);
    } else if (e.kind === 'file') {
      const n = sourcePageCounts[e.source];
      if (!Number.isInteger(n) || !Number.isInteger(e.index) || e.index < 0 || e.index >= n) return false;
    } else if (e.kind !== 'blank') {
      return false;
    }
  }
  return true;
}

/** Old page number -> new page number, or null for a deleted page. */
export function pageMappingForPlan(plan, count) {
  const mapping = {};
  for (let p = 1; p <= count; p++) mapping[p] = null;
  plan.entries.forEach((e, i) => { if (e.kind === 'page') mapping[e.page] = i + 1; });
  return mapping;
}

/** The old pages the plan deletes, ascending. */
export function deletedPages(plan, count) {
  const kept = new Set(plan.entries.filter((e) => e.kind === 'page').map((e) => e.page));
  const out = [];
  for (let p = 1; p <= count; p++) if (!kept.has(p)) out.push(p);
  return out;
}

/**
 * How the page tree is rewritten: the new pages are first appended (in plan
 * order) behind the `count` existing ones, numbered count+1, count+2, …;
 * then `order` (a page order over all of them, see page-tree-reorder.js)
 * puts every page in place, with the deleted pages at the end; then the last
 * `removeCount` pages are removed.
 * @returns {{added: object[], order: number[], removeCount: number}}
 */
export function treeOrderForPlan(plan, count) {
  const added = plan.entries.filter((e) => e.kind !== 'page');
  const addedNumber = new Map(added.map((e, i) => [e.key, count + i + 1]));
  const deleted = deletedPages(plan, count);
  const order = [
    ...plan.entries.map((e) => (e.kind === 'page' ? e.page : addedNumber.get(e.key))),
    ...deleted,
  ];
  return { added, order, removeCount: deleted.length };
}

/**
 * Bookmarks follow their page. A bookmark on a deleted page moves to the
 * next page that stays (in the old order), or else the previous one; the
 * tree (parentId, sortOrder) stays as it is.
 */
export function remapBookmarksForPlan(bookmarks, mapping, count) {
  if (!Array.isArray(bookmarks)) return bookmarks;
  const target = (page) => {
    const to = mapping[page];
    if (to != null) return to;
    if (!(page >= 1 && page <= count)) return page;
    for (let p = page + 1; p <= count; p++) if (mapping[p] != null) return mapping[p];
    for (let p = page - 1; p >= 1; p--) if (mapping[p] != null) return mapping[p];
    return page;
  };
  return bookmarks.map((b) => ({ ...b, page: target(b.page) }));
}

/** Display size of a page box turned by `rotation` degrees. */
export function shownSize(width, height, rotation) {
  return normRotation(rotation) % 180 === 90 ? { width: height, height: width } : { width, height };
}

// ── Pending history (Ctrl+Z / Ctrl+Y inside the organizer) ───────────────────

export function createHistory(plan) {
  return { past: [], present: plan, future: [] };
}

/** True when two plans hold the same entries in the same order and the same marks. */
export function samePlan(a, b) {
  if (a === b) return true;
  if (!a || !b || a.entries.length !== b.entries.length || a.splits.length !== b.splits.length) return false;
  return a.entries.every((e, i) => e === b.entries[i]) && a.splits.every((k, i) => k === b.splits[i]);
}

/** Records a new plan; a plan that changes nothing records nothing. */
export function pushHistory(history, plan) {
  if (samePlan(plan, history.present)) return history;
  return { past: [...history.past, history.present], present: plan, future: [] };
}

export function undoHistory(history) {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function redoHistory(history) {
  if (!history.future.length) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
}
