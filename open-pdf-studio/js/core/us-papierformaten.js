// Amerikaanse tekenvellen (#996): ARCH A–E en E1 (architectural) en ANSI A–E
// (engineering), staand, in inches. Eén bron voor elke papierlijst: nieuw
// document, pagina invoegen, lege pagina's in Pagina's bewerken, pagina's
// herschalen en de Pagina-instelling van het afdrukken. Puur, geen app-imports.
//
// ANSI A en ANSI B hebben dezelfde maat als Letter en Tabloid; ze staan er
// onder hun eigen naam bij, omdat tekeningen ze zo noemen.

const MM_PER_IN = 25.4;
const PT_PER_IN = 72;

/** @typedef {{sleutel: string, label: string, reeks: 'arch'|'ansi', breedteIn: number, hoogteIn: number}} UsFormaat */

/** @type {readonly UsFormaat[]} */
export const US_PAPIERFORMATEN = Object.freeze([
  { sleutel: 'arch-a', label: 'ARCH A', reeks: 'arch', breedteIn: 9, hoogteIn: 12 },
  { sleutel: 'arch-b', label: 'ARCH B', reeks: 'arch', breedteIn: 12, hoogteIn: 18 },
  { sleutel: 'arch-c', label: 'ARCH C', reeks: 'arch', breedteIn: 18, hoogteIn: 24 },
  { sleutel: 'arch-d', label: 'ARCH D', reeks: 'arch', breedteIn: 24, hoogteIn: 36 },
  { sleutel: 'arch-e', label: 'ARCH E', reeks: 'arch', breedteIn: 36, hoogteIn: 48 },
  { sleutel: 'arch-e1', label: 'ARCH E1', reeks: 'arch', breedteIn: 30, hoogteIn: 42 },
  { sleutel: 'ansi-a', label: 'ANSI A', reeks: 'ansi', breedteIn: 8.5, hoogteIn: 11 },
  { sleutel: 'ansi-b', label: 'ANSI B', reeks: 'ansi', breedteIn: 11, hoogteIn: 17 },
  { sleutel: 'ansi-c', label: 'ANSI C', reeks: 'ansi', breedteIn: 17, hoogteIn: 22 },
  { sleutel: 'ansi-d', label: 'ANSI D', reeks: 'ansi', breedteIn: 22, hoogteIn: 34 },
  { sleutel: 'ansi-e', label: 'ANSI E', reeks: 'ansi', breedteIn: 34, hoogteIn: 44 },
].map((f) => Object.freeze(f)));

/** De vellen van één reeks, in lijstvolgorde. */
export const usFormatenVan = (reeks) => US_PAPIERFORMATEN.filter((f) => f.reeks === reeks);

/** Het vel bij een sleutel ('arch-d'), of null. */
export const usFormaat = (sleutel) => US_PAPIERFORMATEN.find((f) => f.sleutel === sleutel) || null;

/** Staande maat in PDF-punten: { breedte, hoogte }. */
export const usInPunten = (f) => ({ breedte: f.breedteIn * PT_PER_IN, hoogte: f.hoogteIn * PT_PER_IN });

/** Staande maat in mm (op 0,1 mm): { breedte, hoogte }. */
export const usInMm = (f) => ({
  breedte: Math.round(f.breedteIn * MM_PER_IN * 10) / 10,
  hoogte: Math.round(f.hoogteIn * MM_PER_IN * 10) / 10,
});

/** Tekst in een keuzelijst: "ARCH D (24 x 36 in)". */
export const usFormaatTekst = (f) => `${f.label} (${f.breedteIn} x ${f.hoogteIn} in)`;
