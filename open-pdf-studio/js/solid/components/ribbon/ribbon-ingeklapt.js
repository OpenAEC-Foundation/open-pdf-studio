// Ingeklapt lint (#278, #960): een klik op een tabtitel klapt het lint
// tijdelijk open, als een paneel over het document heen. Een klik buiten het
// lint of Esc klapt het weer in; een klik op de titel van het tabblad dat al
// open staat ook. Het pijltje rechts (of de voorkeur) zet het lint vast open.
// Pure beslisregels, zonder DOM, los te testen.

/**
 * Staat het lint na een klik op een tabtitel tijdelijk open?
 * @param {{ ingeklapt: boolean, tijdelijkOpen: boolean, zelfdeTab: boolean }} t
 *   zelfdeTab: de geklikte titel is die van het tabblad dat al actief is
 */
export function tijdelijkNaTabKlik({ ingeklapt, tijdelijkOpen, zelfdeTab }) {
  if (!ingeklapt) return false;
  return !(tijdelijkOpen && zelfdeTab);
}

/**
 * Moet het tijdelijk geopende lint dicht na deze gebeurtenis?
 * @param {{ tijdelijkOpen: boolean, soort: 'pointerdown'|'keydown', binnenLint?: boolean, toets?: string }} g
 */
export function tijdelijkSluitenBij({ tijdelijkOpen, soort, binnenLint = false, toets = '' }) {
  if (!tijdelijkOpen) return false;
  if (soort === 'pointerdown') return !binnenLint;
  if (soort === 'keydown') return toets === 'Escape';
  return false;
}
