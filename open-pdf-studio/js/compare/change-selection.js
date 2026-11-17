// Selecting several changes in the compare change list (#1149).
//
// The list shows the changes of the current page pair grouped by kind (added,
// removed, modified). A selection of changes can be placed as clouds on the
// new document in one go. Selecting works like a list in the file manager:
//
//   click            show the change (zoom to it); the selection stays
//   Ctrl+click       add the change to the selection, or take it out
//   Shift+click      select everything from the last clicked change up to
//                    this one, in the order of the list
//   Ctrl+A           select everything the list shows
//   check box        as Ctrl+click (Shift+click on it selects a range)
//
// Changes of annotations cannot be selected: they are annotations already.
//
// Pure module: the selection is a Set of change records (by identity), the
// order an array of the same records. Unit tested in change-selection.test.mjs.

export const CHANGE_TYPES = Object.freeze(['added', 'removed', 'modified']);

const typeOf = (c) => (CHANGE_TYPES.includes(c && c.type) ? c.type : 'modified');

/** Can this change be selected (placed as a cloud)? */
export function isSelectable(change) {
  return !!change && change.source !== 'annotation';
}

/**
 * The selectable changes in the order the list shows them: per kind (added,
 * removed, modified), within a kind in the order of the change list. Kinds
 * that are switched off are left out.
 * @param {Array} changes
 * @param {{added?:boolean, removed?:boolean, modified?:boolean}} [visible]
 */
export function selectableOrder(changes, visible = {}) {
  const out = [];
  for (const type of CHANGE_TYPES) {
    if (visible[type] === false) continue;
    for (const c of changes || []) if (typeOf(c) === type && isSelectable(c)) out.push(c);
  }
  return out;
}

/** The selection without what the list no longer shows. */
export function pruneSelection(selected, order) {
  const keep = new Set(order);
  const out = new Set();
  for (const c of selected || []) if (keep.has(c)) out.add(c);
  return out;
}

/** 'none' | 'some' | 'all' of `order` (e.g. one kind) are selected. */
export function selectionState(selected, order) {
  let n = 0;
  for (const c of order) if (selected.has(c)) n++;
  if (n === 0) return 'none';
  return n === order.length ? 'all' : 'some';
}

/** Select every change of `order`, or take them all out; the rest stays. */
export function setAll(selected, order, on) {
  const out = new Set(selected);
  for (const c of order) {
    if (on) out.add(c); else out.delete(c);
  }
  return out;
}

/**
 * A click on a change (or on its check box).
 * @param {{selected:Set, anchor:object|null}} state
 * @param {object} change the clicked change
 * @param {{ctrl?:boolean, shift?:boolean, checkbox?:boolean}} how
 * @param {Array} order selectableOrder() of the list
 * @returns {{selected:Set, anchor:object|null, focus:boolean}} focus: show
 *   this change (a plain click on the row)
 */
export function clickSelection(state, change, how, order) {
  const selected = new Set(state.selected || []);
  const pickable = order.includes(change);
  if (how.shift && pickable) {
    // From the anchor (the last clicked change, else the top of the list) up
    // to this one. The anchor stays, so a second Shift+click moves the end.
    const a = order.indexOf(state.anchor);
    const b = order.indexOf(change);
    const from = a < 0 ? 0 : a;
    for (let i = Math.min(from, b); i <= Math.max(from, b); i++) selected.add(order[i]);
    return { selected, anchor: a < 0 ? order[0] : state.anchor, focus: false };
  }
  if ((how.ctrl || how.checkbox) && pickable) {
    if (selected.has(change)) selected.delete(change); else selected.add(change);
    return { selected, anchor: change, focus: false };
  }
  // A plain click shows the change and leaves the selection alone: the check
  // marks of a selection in the making must not vanish when one looks at a
  // change in between.
  return { selected, anchor: pickable ? change : state.anchor, focus: !how.ctrl && !how.shift && !how.checkbox };
}
