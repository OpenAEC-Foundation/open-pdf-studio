import { createSignal } from 'solid-js';

const [items, setItems] = createSignal([]);
const [countText, setCountText] = createSignal('0 layers');
const [emptyMessage, setEmptyMessage] = createSignal('No layers in this document');
// "Als standaard instellen" (#377): kan het (de stand wijkt af van die in het
// bestand) en staat het al klaar voor de volgende keer opslaan.
const [canSetDefault, setCanSetDefault] = createSignal(false);
const [defaultPending, setDefaultPending] = createSignal(false);

export {
  items, setItems,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  canSetDefault, setCanSetDefault,
  defaultPending, setDefaultPending,
};
