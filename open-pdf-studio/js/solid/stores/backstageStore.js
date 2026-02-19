import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';

// Active panel within backstage (UI-only state)
const [activePanel, setActivePanelSignal] = createSignal('none');

export function openBackstage() {
  state.backstageOpen = true;
  setActivePanelSignal('none');
}

export function closeBackstage() {
  state.backstageOpen = false;
}

export function setActivePanel(name) {
  setActivePanelSignal(name);
}

export function isBackstageOpen() {
  return state.backstageOpen;
}

export function getActivePanel() {
  return activePanel();
}
