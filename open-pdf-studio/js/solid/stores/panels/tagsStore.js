import { createSignal } from 'solid-js';

const [tree, setTree] = createSignal([]);
const [countText, setCountText] = createSignal('0 tags');
const [emptyMessage, setEmptyMessage] = createSignal('No structure tags in this document');

export {
  tree, setTree,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
};
