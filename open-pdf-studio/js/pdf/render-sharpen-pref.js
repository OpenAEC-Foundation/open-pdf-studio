import { state } from '../core/state.js';
import { sharpenRgba, sharpenAmount } from './render-sharpen.js';

export function pageSharpenLevel() {
  const n = Number(state.preferences && state.preferences.pageSharpen);
  return Number.isInteger(n) ? n : 0;
}

/** Applies the user's page-sharpen level to freshly rendered RGBA, in place. */
export function sharpenPageRgba(rgba, w, h) {
  return sharpenRgba(rgba, w, h, sharpenAmount(pageSharpenLevel()));
}
