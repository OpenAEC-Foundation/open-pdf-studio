// Verdeelt de beschikbare lintbreedte: welke groepen tonen tekst bij hun
// knoppen? Zo veel als er passen. Eerst de gewone groepen van links naar
// rechts, daarna de groepen die uit zichzelf alleen pictogrammen tonen
// (compact). Een groep die niet past wordt overgeslagen; een latere, kleinere
// groep kan dan nog wel tekst krijgen.

/**
 * @param {number} breedte beschikbare breedte in px
 * @param {{ smal: number, metTekst: number, compact: boolean }[]} groepen
 *   breedte per groep zonder en met tekst
 * @returns {{ tekst: boolean[], past: boolean }} `past` is false als zelfs
 *   alles zonder tekst niet past (dan volgt het overloopmenu).
 */
export function kiesLintIndeling(breedte, groepen) {
  const tekst = groepen.map(() => false);
  let gebruikt = groepen.reduce((som, g) => som + g.smal, 0);
  if (gebruikt > breedte) return { tekst, past: false };
  for (const compact of [false, true]) {
    groepen.forEach((g, i) => {
      if (g.compact !== compact) return;
      const extra = g.metTekst - g.smal;
      if (gebruikt + extra > breedte) return;
      gebruikt += extra;
      tekst[i] = true;
    });
  }
  return { tekst, past: true };
}

/**
 * Korte naam van een knop uit zijn titel: zonder de uitleg tussen haakjes of
 * na een streep ("Polylijn (dubbelklik om te voltooien)" wordt "Polylijn").
 */
export function korteKnopnaam(titel) {
  return String(titel ?? '').split(/\s+[(—–-]\s*/)[0].trim();
}
