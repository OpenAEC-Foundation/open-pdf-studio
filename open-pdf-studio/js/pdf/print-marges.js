// The margins from Page Setup, applied to the printed sheet (#1236).
//
// The four margin fields were stored as whole numbers and used nowhere: the
// sheet was laid out with the printer's unprintable edge only. Here they are
// read as decimal numbers (2.5 or 2,5) and combined with that edge, per side
// the larger of the two, so "Fit" and "Shrink" keep the page inside them.

import { leesGetalOfNull } from '../core/getal-invoer.js';

const MAX_MM = 200;
const ZIJDEN = ['links', 'boven', 'rechts', 'onder'];

/** One margin field as millimetres: a decimal number from 0 to 200, else 0. */
export function leesMarge(invoer) {
  const getal = typeof invoer === 'number' ? invoer : leesGetalOfNull(String(invoer ?? ''));
  if (getal == null || !Number.isFinite(getal) || getal < 0) return 0;
  return Math.min(MAX_MM, getal);
}

/** The Page Setup margins as { links, boven, rechts, onder } in mm. */
export function paginaMarges(instelling) {
  return {
    links: leesMarge(instelling?.marginLeft),
    boven: leesMarge(instelling?.marginTop),
    rechts: leesMarge(instelling?.marginRight),
    onder: leesMarge(instelling?.marginBottom),
  };
}

const zijde = (m, z) => (m && typeof m[z] === 'number' && Number.isFinite(m[z]) && m[z] >= 0 ? m[z] : 0);

/**
 * The printable area for the layout: the printer's answer (`staand` and
 * `liggend`, or null when unknown) widened by the Page Setup margins. Without
 * margins the printer's answer comes back untouched, also when it is null.
 */
export function bedrukbaarMetMarges(bedrukbaar, instelling) {
  const eigen = paginaMarges(instelling);
  if (!ZIJDEN.some((z) => eigen[z] > 0)) return bedrukbaar ?? null;
  const samen = (printer) => Object.fromEntries(ZIJDEN.map((z) => [z, Math.max(zijde(printer, z), eigen[z])]));
  return { staand: samen(bedrukbaar?.staand), liggend: samen(bedrukbaar?.liggend) };
}
