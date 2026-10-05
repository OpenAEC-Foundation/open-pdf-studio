// "Plakken op plaats" (paste in place) — GitHub issue #269.
//
// Pure clone-logic: kopieert clipboard-annotaties naar een doelpagina met
// EXACT dezelfde positie (x/y, start/end, center, path), afmetingen en
// rotatie als het origineel. Alleen id, page en timestamps worden vervangen,
// plus de koppeling van proefleescorrecties en hun /NM (#508, zie
// relinkPastedCorrections). Onderlinge posities van een multi-selectie
// blijven daardoor vanzelf behouden.
//
// Dit bestand importeert bewust GEEN app-state, zodat de logica in kaal
// Node te testen is (zie scripts/test-paste-in-place.mjs).

import { relinkPastedCorrections } from './corrections/model.js';

// Zelfde deep-clone-techniek als cloneAnnotation in annotations/factory.js.
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Zelfde id-formaat als de bestaande paste-paden in annotations/clipboard.js.
export function defaultIdGenerator() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Kloon annotaties voor "plakken op plaats".
 *
 * @param {Array<Object>|Object} sources  clipboard-annotatie(s); worden niet gemuteerd
 * @param {number} targetPage             pagina waarop de klonen landen
 * @param {Object} [opts]
 * @param {Function} [opts.makeId]        id-generator (injecteerbaar voor tests)
 * @param {Function} [opts.now]           timestamp-bron (injecteerbaar voor tests)
 * @returns {Array<Object>} nieuwe annotatie-objecten met ongewijzigde posities
 */
export function cloneAnnotationsInPlace(sources, targetPage, opts = {}) {
  const makeId = opts.makeId || defaultIdGenerator;
  const now = opts.now || (() => new Date().toISOString());

  const list = Array.isArray(sources) ? sources : (sources ? [sources] : []);
  const result = list.map(source => {
    const clone = deepClone(source);
    clone.id = makeId();
    clone.page = targetPage;
    clone.createdAt = now();
    clone.modifiedAt = now();
    return clone;
  });
  // Vervangingen (#508) koppelen aan hun eigen kopie; geen gedeelde /NM.
  return relinkPastedCorrections(list, result);
}
