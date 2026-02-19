import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 destinations');
const [emptyMessage, setEmptyMessage] = createSignal('No named destinations in this document');

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
};
