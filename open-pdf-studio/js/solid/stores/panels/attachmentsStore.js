import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 attachments');
const [emptyMessage, setEmptyMessage] = createSignal('No attachments in this document');
const [selectedKey, setSelectedKey] = createSignal(null);
const [toolbarDisabled, setToolbarDisabled] = createSignal({ add: true, open: true, save: true, saveAll: true, delete: true });

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  selectedKey, setSelectedKey,
  toolbarDisabled, setToolbarDisabled,
};
