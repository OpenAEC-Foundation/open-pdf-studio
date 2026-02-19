import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 layers');
const [emptyMessage, setEmptyMessage] = createSignal('No layers in this document');

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
};
