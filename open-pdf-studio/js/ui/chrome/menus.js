import { openBackstage as open, closeBackstage as close } from '../../solid/stores/backstageStore.js';

export function openBackstage() { open(); }
export function closeBackstage() { close(); }
export function initMenus() {}
export function closeAllMenus() { close(); }
