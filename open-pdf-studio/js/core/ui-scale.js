// Kleiner dan 100% (#932) geeft meer ruimte aan het document op een scherm
// waar de bediening te veel plek inneemt; groter is voor slechtziendheid (#883).
// Alleen de bediening (lint, panelen, paletten, dialogen) schaalt; de PDF en
// de zoom van het document niet.
export const UI_SCALES = [80, 90, 100, 110, 125, 150, 175, 200];
export function normalizeUiScale(value) {
  const number = Number(value);
  return UI_SCALES.includes(number) ? number : 100;
}

// Event on window after the interface size changed. Code that sizes chrome
// with fixed pixel numbers in JS (ribbon label shrinking, ribbon overflow,
// tool palette columns) listens to it and measures again (#883).
export const UI_SCHAAL_EVENT = 'opds-ui-schaal';

// Current interface factor (1 at 100%), as the stylesheets see it.
export function uiSchaalFactor(root = globalThis.document?.documentElement) {
  const waarde = parseFloat(root?.style?.getPropertyValue('--ui-scale'));
  return Number.isFinite(waarde) && waarde > 0 ? waarde : 1;
}

// Put a (persisted) interface size on the document and tell the listeners.
export function pasUiSchaalToe(value, root = globalThis.document?.documentElement) {
  if (!root) return;
  const scale = normalizeUiScale(value);
  const vorige = uiSchaalFactor(root);
  root.style.setProperty('--ui-scale', String(scale / 100));
  // De ruimtemakende regels (styles/ui-scale.css) zijn voor grotere
  // bediening; kleiner past vanzelf in de gewone indeling.
  root.toggleAttribute('data-ui-scaled', scale > 100);
  if (vorige !== scale / 100) globalThis.dispatchEvent?.(new Event(UI_SCHAAL_EVENT));
}

export function haalUiSchaalWeg(root = globalThis.document?.documentElement) {
  if (!root) return;
  const vorige = uiSchaalFactor(root);
  root.style.removeProperty('--ui-scale');
  root.removeAttribute('data-ui-scaled');
  if (vorige !== 1) globalThis.dispatchEvent?.(new Event(UI_SCHAAL_EVENT));
}
