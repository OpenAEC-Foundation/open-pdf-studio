import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';

// Tracks the order palettes were docked to each side.
// Each entry is a palette id string. First entry = closest to edge.
const [leftOrder, setLeftOrder] = createSignal([]);
const [rightOrder, setRightOrder] = createSignal([]);
// Top and bottom docks: a horizontal strip above or below the page view.
const [topOrder, setTopOrder] = createSignal([]);
const [bottomOrder, setBottomOrder] = createSignal([]);

export { leftOrder, rightOrder, topOrder, bottomOrder };

const ORDERS = {
  left: [leftOrder, setLeftOrder],
  right: [rightOrder, setRightOrder],
  top: [topOrder, setTopOrder],
  bottom: [bottomOrder, setBottomOrder],
};

/** The dock sides a palette can use. */
export const DOCK_SIDES = Object.freeze(Object.keys(ORDERS));

function save() {
  state.preferences.paletteLeftOrder = leftOrder();
  state.preferences.paletteRightOrder = rightOrder();
  state.preferences.paletteTopOrder = topOrder();
  state.preferences.paletteBottomOrder = bottomOrder();
  savePreferences();
}

export function initPaletteOrder() {
  const prefs = state.preferences;
  setLeftOrder(prefs.paletteLeftOrder ?? []);
  setRightOrder(prefs.paletteRightOrder ?? []);
  setTopOrder(prefs.paletteTopOrder ?? []);
  setBottomOrder(prefs.paletteBottomOrder ?? []);
}

/** Call when a palette becomes visible/docked on a side. */
export function registerPaletteDock(id, side) {
  const doel = ORDERS[side] ? side : 'right';
  for (const [kant, [, zet]] of Object.entries(ORDERS)) {
    if (kant === doel) zet(prev => prev.includes(id) ? prev : [...prev, id]);
    else zet(prev => prev.filter(p => p !== id));
  }
  save();
}

/** Call when a palette is hidden or undocked (goes floating). */
export function unregisterPaletteDock(id) {
  for (const [, zet] of Object.values(ORDERS)) zet(prev => prev.filter(p => p !== id));
  save();
}
