// ── Segment operations layer ────────────────────────────────────────────────
//
// High-level, selection-driven edit operations that reshape existing geometry:
//   * explodeSelection()   — burst a polyline / area / perimeter into the
//                            individual straight line segments it is made of.
//   * joinSelection()      — chain selected lines / polylines whose endpoints
//                            coincide into ONE polyline.
//   * createCollection()   — group the current selection under a shared
//                            groupId so clicking one member selects them all.
//   * explodeCollection()  — ungroup: strip the groupId from the selection.
//
// All operations act on the current selection, mutate doc.annotations directly
// and record undo commands afterwards (mirroring the shape-tool / trim-tool
// convention: caller mutates, then records). No per-type special casing beyond
// the small `POLY_TYPES` table below.

import { state, getActiveDocument } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import {
  recordBulkModify, recordBulkDelete, recordBulkAdd,
  beginUndoTransaction, endUndoTransaction,
} from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';

// Types whose geometry is an ordered list of vertices in `points[]`.
const POLY_TYPES = new Set([
  'polyline', 'cloudPolyline', 'measurePerimeter', 'measureArea', 'filledArea', 'polygon',
]);
// Of those, the ones that are conceptually a CLOSED contour (last vertex joins
// back to the first) — explode adds the closing segment for these.
const CLOSED_POLY_TYPES = new Set(['measureArea', 'filledArea', 'polygon']);

function _redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function _newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

// Copy the visual style of a source annotation onto a fresh line/polyline props
// object. Keeps colour, width and border style consistent with the original.
function _inheritStyle(src) {
  const now = new Date().toISOString();
  return {
    id: _newId(),
    page: src.page,
    color: src.color,
    strokeColor: src.strokeColor || src.color,
    lineWidth: src.lineWidth,
    borderStyle: src.borderStyle || 'solid',
    opacity: src.opacity != null ? src.opacity : 1,
    author: src.author,
    createdAt: now,
    modifiedAt: now,
    locked: false,
    printable: src.printable !== false,
  };
}

// Ordered vertex list for any joinable annotation, or null if not joinable.
function _pointsOf(ann) {
  if (!ann) return null;
  if (ann.type === 'line' || ann.type === 'arrow' || ann.type === 'measureDistance') {
    if (ann.startX === undefined || ann.endX === undefined) return null;
    return [{ x: ann.startX, y: ann.startY }, { x: ann.endX, y: ann.endY }];
  }
  if (Array.isArray(ann.points) && ann.points.length >= 2) {
    return ann.points.map(p => ({ x: p.x, y: p.y }));
  }
  return null;
}

/**
 * Explode every poly-type annotation in the selection into its constituent
 * straight line segments. Non-poly annotations in the selection are left
 * untouched. Returns the number of annotations that were exploded.
 */
export function explodeSelection() {
  const doc = getActiveDocument();
  if (!doc) return 0;
  const sel = (doc.selectedAnnotations || []).filter(a => a && !a.locked && POLY_TYPES.has(a.type));
  if (sel.length === 0) return 0;

  // Build the replacement segments first — only touch the document (and the
  // undo stack) if there is something usable to produce.
  const created = [];
  const exploded = [];
  for (const ann of sel) {
    const pts = ann.points && ann.points.length >= 2 ? ann.points : null;
    if (!pts) continue;
    const segCount = CLOSED_POLY_TYPES.has(ann.type) ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      created.push({
        ..._inheritStyle(ann),
        type: 'line',
        startX: a.x, startY: a.y,
        endX: b.x, endY: b.y,
      });
    }
    exploded.push(ann);
  }

  if (created.length === 0) return 0;

  // Record deletions while the originals are still present (valid indices),
  // then remove them and add the new segments.
  beginUndoTransaction();
  recordBulkDelete(exploded);
  const ids = new Set(exploded.map(a => a.id));
  doc.annotations = doc.annotations.filter(a => !ids.has(a.id));
  doc.annotations.push(...created);
  recordBulkAdd(created);

  doc.selectedAnnotations = created;
  doc.selectedAnnotation = created[0] || null;
  endUndoTransaction();
  _redraw();
  return exploded.length;
}

/**
 * Join selected lines / polylines whose endpoints coincide into a single
 * polyline. Segments that cannot be chained onto the result are left as-is.
 * Returns the number of source annotations that were merged (0 if < 2 joined).
 */
export function joinSelection(tol = 2.0) {
  const doc = getActiveDocument();
  if (!doc) return 0;
  const sel = (doc.selectedAnnotations || []).filter(a => a && !a.locked);
  // Build a pool of { ann, pts } for joinable annotations.
  const pool = [];
  for (const ann of sel) {
    const pts = _pointsOf(ann);
    if (pts) pool.push({ ann, pts });
  }
  if (pool.length < 2) return 0;

  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;

  // Greedy chain: seed with the first item, then repeatedly attach any pool
  // item whose head/tail meets the chain's head/tail.
  const used = new Set();
  used.add(0);
  let chain = pool[0].pts.slice();
  const members = [pool[0].ann];

  let extended = true;
  while (extended) {
    extended = false;
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      const pts = pool[i].pts;
      const head = chain[0];
      const tail = chain[chain.length - 1];
      const pFirst = pts[0];
      const pLast = pts[pts.length - 1];

      if (near(tail, pFirst)) {
        chain = chain.concat(pts.slice(1));
      } else if (near(tail, pLast)) {
        chain = chain.concat(pts.slice(0, -1).reverse());
      } else if (near(head, pLast)) {
        chain = pts.slice(0, -1).concat(chain);
      } else if (near(head, pFirst)) {
        chain = pts.slice(1).reverse().concat(chain);
      } else {
        continue;
      }
      used.add(i);
      members.push(pool[i].ann);
      extended = true;
    }
  }

  if (members.length < 2) return 0;

  const src = members[0];
  const joined = {
    ..._inheritStyle(src),
    type: 'polyline',
    points: chain.map(p => ({ x: p.x, y: p.y })),
  };

  beginUndoTransaction();
  recordBulkDelete(members);
  const ids = new Set(members.map(a => a.id));
  doc.annotations = doc.annotations.filter(a => !ids.has(a.id));
  doc.annotations.push(joined);
  recordBulkAdd([joined]);

  doc.selectedAnnotations = [joined];
  doc.selectedAnnotation = joined;
  endUndoTransaction();
  _redraw();
  return members.length;
}

/**
 * Group the current selection: assign a shared, freshly-generated groupId to
 * every selected annotation. Clicking any member with the select tool then
 * selects the whole group (see select-tool.js). Returns the group size.
 */
export function createCollection() {
  const doc = getActiveDocument();
  if (!doc) return 0;
  const sel = (doc.selectedAnnotations || []).filter(a => a && !a.locked);
  if (sel.length < 2) return 0;
  // Capture originals with an EXPLICIT groupId key (null when previously
  // ungrouped). bulkModify's undo uses Object.assign, which cannot delete a
  // key — so the "before" state must carry groupId as a real key for undo to
  // clear the grouping. `null` reads as ungrouped everywhere (select-tool
  // checks truthiness).
  const originals = sel.map(a => {
    const c = cloneAnnotation(a);
    c.groupId = a.groupId ?? null;
    return c;
  });
  const gid = 'grp_' + _newId();
  for (const a of sel) {
    a.groupId = gid;
    a.modifiedAt = new Date().toISOString();
  }
  recordBulkModify(sel, originals);
  _redraw();
  return sel.length;
}

/**
 * Ungroup: strip the groupId from every selected annotation (and, when a single
 * grouped member is selected, from all of its fellow group members too).
 * Returns the number of annotations affected.
 */
export function explodeCollection() {
  const doc = getActiveDocument();
  if (!doc) return 0;
  const sel = (doc.selectedAnnotations || []).filter(a => a && a.groupId);
  if (sel.length === 0) return 0;

  // Expand to every annotation sharing any selected groupId, so ungrouping one
  // member dissolves the whole collection.
  const gids = new Set(sel.map(a => a.groupId));
  const targets = doc.annotations.filter(a => a.groupId && gids.has(a.groupId));
  if (targets.length === 0) return 0;

  const originals = targets.map(a => cloneAnnotation(a));
  for (const a of targets) {
    // Set to null rather than delete: bulkModify redo uses Object.assign and
    // cannot remove a key, so `null` (read as ungrouped everywhere) makes both
    // undo and redo of the ungroup deterministic.
    a.groupId = null;
    a.modifiedAt = new Date().toISOString();
  }
  recordBulkModify(targets, originals);
  _redraw();
  return targets.length;
}
