// Zoekveld in het miniaturenpaneel (#926): springt naar een pagina op haar
// bladnaam (paginalabel, #580) of, zonder label, haar nummer. Dezelfde
// volgorde als het zoekveld van de bladwijzers (#578): eerst de labels die
// met de tekst beginnen, dan die hem alleen bevatten. Pure functies.

import { volgendeTreffer } from './bladwijzer-zoeken.js';
import { labelVan } from '../../pdf/pagina-labels.js';

/** De pagina's als knopen voor de bladwijzer-zoekfuncties: { id, title, page }. */
export function paginaKnopen(aantal, labels) {
  const n = Math.max(0, aantal | 0);
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, title: labelVan(labels, i + 1), page: i + 1 }));
}

/**
 * De pagina-treffer na `naPagina` (rondgaand), of de eerste als die geen
 * treffer is. Geen treffers of lege tekst: null.
 */
export function volgendePaginaTreffer(aantal, labels, tekst, naPagina = null) {
  return volgendeTreffer(paginaKnopen(aantal, labels), tekst, naPagina);
}
