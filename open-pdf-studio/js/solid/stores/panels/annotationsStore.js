import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 annotations');
const [emptyMessage, setEmptyMessage] = createSignal('');

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
};
