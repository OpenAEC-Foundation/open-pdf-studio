// Klembordgeschiedenis (#929): de lijstbewerkingen zonder Solid of DOM, zodat
// ze in Node testbaar zijn. clipboard-history.js houdt de lijst in een signaal.

export const KLEMBORD_MAX = 30;

/** Nieuwe kopie vooraan; hooguit `max` items. */
export function voegToe(lijst, item, max = KLEMBORD_MAX) {
  return [item, ...(lijst || [])].slice(0, Math.max(1, max));
}

/** Lijst zonder het item met dit id. */
export function verwijder(lijst, id) {
  return (lijst || []).filter(i => i.id !== id);
}

/**
 * Korte omschrijving van een kopie: soort en een stukje tekst voor een
 * losse markering, null voor een groep (de weergave toont dan het aantal).
 */
export function omschrijving(annotaties) {
  if (!annotaties || annotaties.length !== 1) return null;
  const a = annotaties[0] || {};
  const tekst = (a.text || a.contents || '').toString().replace(/\s+/g, ' ').trim();
  const soort = a.type || '';
  return tekst ? `${soort}: ${tekst.slice(0, 24)}` : soort;
}
