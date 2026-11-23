// The stamp chosen in the picker, waiting to be placed with a click.
//
// Choosing the Stamp tool opens the picker straight away; the choice is kept
// here until the user clicks on the page (and, with "keep tool active", for
// every following click). Pure, so the tool can be tested under node.
//
// A choice is one of:
//   { soort: 'vast', stamp }                  a built-in text stamp
//   { soort: 'sjabloon', template }           a template with fields
//   { soort: 'afbeelding', img, dataUrl }     an image from a file

import { BUILTIN_STAMP_DEFAULT_WIDTH, BUILTIN_STAMP_DEFAULT_HEIGHT } from './stamp-defaults.js';

/** Longest side of a placed image stamp, in page points. */
export const AFBEELDING_STEMPEL_MAX = 200;

let keuze = null;

export function zetStempelKeuze(nieuw) {
  keuze = nieuw && nieuw.soort ? nieuw : null;
}

export function stempelKeuze() {
  return keuze;
}

export function wisStempelKeuze() {
  keuze = null;
}

/** Size of an image stamp as it is placed: at most AFBEELDING_STEMPEL_MAX. */
export function afbeeldingStempelMaat(breedte, hoogte, max = AFBEELDING_STEMPEL_MAX) {
  if (!(breedte > 0) || !(hoogte > 0)) return { width: max, height: max };
  const f = Math.min(1, max / breedte, max / hoogte);
  return { width: breedte * f, height: hoogte * f };
}

/**
 * Size in page points of the chosen stamp, for the preview under the cursor.
 * `sjabloonMaat(template)` gives the natural size of a template.
 */
export function stempelKeuzeMaat(k, sjabloonMaat) {
  if (!k) return null;
  if (k.soort === 'afbeelding') return afbeeldingStempelMaat(k.img?.naturalWidth, k.img?.naturalHeight);
  if (k.soort === 'sjabloon') {
    try {
      const m = sjabloonMaat?.(k.template);
      if (m && m.width > 0 && m.height > 0) return { width: m.width, height: m.height };
    } catch { /* fall through to the default size */ }
  }
  return { width: BUILTIN_STAMP_DEFAULT_WIDTH, height: BUILTIN_STAMP_DEFAULT_HEIGHT };
}

/** Name of the chosen stamp, for the status bar and the preview. */
export function stempelKeuzeNaam(k) {
  if (!k) return '';
  if (k.soort === 'vast') return k.stamp?.text || k.stamp?.name || '';
  if (k.soort === 'sjabloon') return k.template?.name || '';
  return '';
}
