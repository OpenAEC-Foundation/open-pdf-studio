import { createSignal } from 'solid-js';

const [groups, setGroups] = createSignal([]);
const [countText, setCountText] = createSignal('0 fields');
const [emptyMessage, setEmptyMessage] = createSignal('No form fields in this document');

export {
  groups, setGroups,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
};
