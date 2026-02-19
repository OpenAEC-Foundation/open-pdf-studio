import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 signatures');
const [emptyMessage, setEmptyMessage] = createSignal('No digital signatures in this document');

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
};
