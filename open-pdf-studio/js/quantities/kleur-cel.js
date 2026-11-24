// Een kleur in een staat (#1242). Los van schedule-templates.js, zodat het
// tekenen van de staat op het blad er niet de hele staatlogica bij laadt.

/**
 * Is deze celtekst een kleur (#rgb of #rrggbb)? Zo'n cel toont de kleur zelf
 * als vlakje in plaats van de code: op een tekening zoek je een kleur, geen
 * code (#1242). De CSV houdt de code.
 */
export function isKleurCel(s) {
  return typeof s === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}
