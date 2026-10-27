import { createSignal } from 'solid-js';

const [tree, setTree] = createSignal([]);
const [countText, setCountText] = createSignal('0 tags');
const [emptyMessage, setEmptyMessage] = createSignal('No structure tags in this document');
// Tags panel editing (#384): the selected row and what can be done with it.
// selected: { uid, kind, key, role, standardRole, alt, altRole, canMoveUp, canMoveDown } | null
const [selected, setSelected] = createSignal(null);
const [hasTree, setHasTree] = createSignal(false);

export {
  tree, setTree,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  selected, setSelected,
  hasTree, setHasTree,
};
