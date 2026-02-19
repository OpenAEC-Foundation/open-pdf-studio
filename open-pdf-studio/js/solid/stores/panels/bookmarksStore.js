import { createSignal } from 'solid-js';

const [tree, setTree] = createSignal([]);
const [countText, setCountText] = createSignal('0 bookmarks');
const [emptyMessage, setEmptyMessage] = createSignal('No bookmarks in this document');
const [selectedId, setSelectedId] = createSignal(null);
const [toolbarDisabled, setToolbarDisabled] = createSignal({ add: true, addChild: true, edit: true, delete: true });

export {
  tree, setTree,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  selectedId, setSelectedId,
  toolbarDisabled, setToolbarDisabled,
};
