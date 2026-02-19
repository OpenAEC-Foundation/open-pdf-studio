import { createSignal } from 'solid-js';

const [groups, setGroups] = createSignal([]);
const [countText, setCountText] = createSignal('0 links');
const [emptyMessage, setEmptyMessage] = createSignal('No links in this document');
const [selectedIndex, setSelectedIndex] = createSignal(-1);
const [toolbarDisabled, setToolbarDisabled] = createSignal({ goto: true, open: true, copy: true, export: true });

export {
  groups, setGroups,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  selectedIndex, setSelectedIndex,
  toolbarDisabled, setToolbarDisabled,
};
