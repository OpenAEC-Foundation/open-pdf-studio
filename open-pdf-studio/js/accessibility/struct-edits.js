// Edits to the structure tree (#384): alt text of an element and the reading
// order (the order of an element's /K children).
//
// The edits live on the document (`doc.structEdits`) and do not touch the
// opened file. The tags panel and read aloud show the tree with the edits
// applied (applyEditsToTree); the saver writes them into its own copy of the
// document (applyEditsToPdf) and clears them after a successful save, after
// which the tree is read again from the saved bytes.
//
// An edit addresses an element by its key (struct-tree.js) and remembers the
// role it had; an element that is no longer there with that role is skipped
// rather than editing the wrong one.
//
// Pure pdf-lib, no app imports: testable under node.

import { PDFName, PDFDict, PDFRef } from 'pdf-lib';
import { kidsOf, isStructElement } from './struct-tree.js';
import { pdfTextString } from '../pdf/saver/pdf-text.js';

const N = (s) => PDFName.of(s);

/** @typedef {{ alt: Record<string, {role: string, value: string}>,
 *              order: Record<string, {role: string, order: number[]}> }} StructEdits */

/** A fresh copy of the edits of a document (never mutate the original). */
export function editsOf(doc) {
  const e = doc?.structEdits;
  return {
    alt: { ...(e?.alt || {}) },
    order: { ...(e?.order || {}) },
  };
}

export function hasEdits(edits) {
  return !!edits && (Object.keys(edits.alt || {}).length > 0 || Object.keys(edits.order || {}).length > 0);
}

const sameOrder = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The key of an element after a save that wrote the reorders in `appliedOrder`:
 * keys are paths of original /K indices, and a written reorder moves the child
 * that was at index i of that parent to position order.indexOf(i). Null when
 * the path no longer exists.
 */
function keyAfterOrder(key, appliedOrder) {
  if (key === '') return '';
  let origPrefix = '';
  const out = [];
  for (const part of String(key).split('.')) {
    const index = Number(part);
    const written = appliedOrder[origPrefix];
    const next = written ? written.order.indexOf(index) : index;
    if (next < 0) return null;
    out.push(next);
    origPrefix = origPrefix === '' ? part : `${origPrefix}.${part}`;
  }
  return out.join('.');
}

/**
 * The structure edits that are still unsaved after a save wrote `applied`,
 * while the document now holds `current`.
 * - `current` is the very object that was written (the usual case): nothing
 *   is left, so null.
 * - Nothing was written: `current` stays as it is (its keys still match the
 *   saved structure).
 * - An edit was made during the save (the tags panel puts a new object on the
 *   document per edit): the edits that differ from what was written are kept,
 *   with keys and orders rebased on the saved structure, where the written
 *   reorders already hold. Returns null when nothing differs.
 */
export function editsAfterSave(current, applied) {
  if (!hasEdits(current) || current === applied) return null;
  if (!hasEdits(applied)) return current;
  const appliedAlt = applied.alt || {};
  const appliedOrder = applied.order || {};
  const out = { alt: {}, order: {} };
  for (const [key, edit] of Object.entries(current.alt || {})) {
    const done = appliedAlt[key];
    if (done && done.role === edit.role && done.value === edit.value) continue;
    const next = keyAfterOrder(key, appliedOrder);
    if (next !== null) out.alt[next] = { ...edit };
  }
  for (const [key, edit] of Object.entries(current.order || {})) {
    const done = appliedOrder[key];
    if (done && done.role === edit.role && sameOrder(done.order, edit.order)) continue;
    const next = keyAfterOrder(key, appliedOrder);
    if (next === null) continue;
    // The written order is now the file's order: express the wanted order in
    // the positions of the saved /K array.
    const order = done ? edit.order.map((i) => done.order.indexOf(i)) : [...edit.order];
    if (order.some((i) => i < 0)) continue;
    out.order[next] = { role: edit.role, order };
  }
  return hasEdits(out) ? out : null;
}

/** Edits after setting the alt text of element `key`. */
export function withAlt(edits, key, role, value) {
  const next = { alt: { ...edits.alt }, order: { ...edits.order } };
  next.alt[key] = { role, value: String(value ?? '') };
  return next;
}

/** Edits after setting the order of the children of `key` (original /K indices). */
export function withOrder(edits, key, role, order) {
  const next = { alt: { ...edits.alt }, order: { ...edits.order } };
  next.order[key] = { role, order: [...order] };
  return next;
}

/** Is `order` a permutation of 0..n-1? */
export function isPermutation(order, n) {
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Set();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false;
    seen.add(i);
  }
  return true;
}

/**
 * The current order of the children of a (display) node, as original /K
 * indices, after moving the child at display position `from` by `delta`.
 * Returns null when the move is not possible.
 */
export function movedOrder(node, from, delta) {
  const indices = (node?.children || []).map((c) => c.index);
  const to = from + delta;
  if (from < 0 || from >= indices.length || to < 0 || to >= indices.length) return null;
  const [moved] = indices.splice(from, 1);
  indices.splice(to, 0, moved);
  // Entries the reader skipped (not an element or content) keep their place
  // at the end, so the order stays a permutation of the whole /K array.
  const count = Math.max(node.kidCount ?? 0, indices.length);
  for (let i = 0; i < count; i++) if (!indices.includes(i)) indices.push(i);
  return indices;
}

/**
 * The tree with the edits applied: alt texts replaced and children
 * reordered. The input is not changed.
 */
export function applyEditsToTree(root, edits) {
  if (!root || !hasEdits(edits)) return root;
  const visit = (node) => {
    const copy = { ...node };
    const alt = edits.alt[node.key];
    if (node.kind === 'element' && alt && alt.role === node.role) {
      copy.alt = alt.value.trim() ? alt.value : null;
      copy.altEdited = true;
    }
    let children = (node.children || []).map((c) => (c.kind === 'element' ? visit(c) : c));
    const order = edits.order[node.key];
    if (order && order.role === node.role) {
      const pos = new Map(order.order.map((index, i) => [index, i]));
      if (children.every((c) => pos.has(c.index))) {
        children = [...children].sort((a, b) => pos.get(a.index) - pos.get(b.index));
        copy.orderEdited = true;
      }
    }
    copy.children = children;
    return copy;
  };
  return visit(root);
}

/** Resolve a key to its dictionary in a pdf-lib document, or null. */
export function resolveKey(pdfDocLib, key) {
  const ctx = pdfDocLib.context;
  const rootDict = ctx.lookup(pdfDocLib.catalog.get(N('StructTreeRoot')));
  if (!(rootDict instanceof PDFDict)) return null;
  if (key === '') return { dict: rootDict, role: 'StructTreeRoot' };
  let dict = rootDict;
  for (const part of String(key).split('.')) {
    const index = Number(part);
    const raw = kidsOf(ctx, dict)[index];
    if (raw === undefined) return null;
    const obj = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
    if (!isStructElement(obj)) return null;
    dict = obj;
  }
  return { dict, role: dict.get(N('S')).decodeText() };
}

/**
 * Write the edits into `pdfDocLib`. All targets are resolved before anything
 * changes, so a reorder never sends a later edit down the wrong path.
 * @returns {{ applied: number, skipped: number }}
 */
export function applyEditsToPdf(pdfDocLib, edits) {
  if (!hasEdits(edits)) return { applied: 0, skipped: 0 };
  const ctx = pdfDocLib.context;
  const actions = [];
  let skipped = 0;
  for (const [key, edit] of Object.entries(edits.alt || {})) {
    const target = key === '' ? null : resolveKey(pdfDocLib, key);
    if (!target || target.role !== edit.role) { skipped++; continue; }
    actions.push(() => {
      const value = String(edit.value ?? '');
      if (value.trim()) target.dict.set(N('Alt'), pdfTextString(value));
      else target.dict.delete(N('Alt'));
    });
  }
  for (const [key, edit] of Object.entries(edits.order || {})) {
    const target = resolveKey(pdfDocLib, key);
    if (!target || target.role !== edit.role) { skipped++; continue; }
    const kids = kidsOf(ctx, target.dict);
    if (kids.length < 2 || !isPermutation(edit.order, kids.length)) { skipped++; continue; }
    actions.push(() => {
      target.dict.set(N('K'), ctx.obj(edit.order.map((i) => kids[i])));
    });
  }
  for (const act of actions) act();
  return { applied: actions.length, skipped };
}
