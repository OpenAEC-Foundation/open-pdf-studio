// Lijnkoppen van pijlen naar /LE (ISO 32000 tabel 176) en terug, op één plek
// voor de saver en de loader (zie lijnkoppen.test.mjs).

const NAAR_LE = {
  open: 'OpenArrow',
  closed: 'ClosedArrow',
  diamond: 'Diamond',
  circle: 'Circle',
  square: 'Square',
  slash: 'Slash',
  butt: 'Butt',
  openReversed: 'ROpenArrow',
  closedReversed: 'RClosedArrow',
  // Geen eigen /LE-naam: de dichtstbijzijnde, plus /OPS_LineHeads.
  stealth: 'OpenArrow',
};
const UIT_LE = {
  OpenArrow: 'open',
  ClosedArrow: 'closed',
  Diamond: 'diamond',
  Circle: 'circle',
  Square: 'square',
  Slash: 'slash',
  Butt: 'butt',
  ROpenArrow: 'openReversed',
  RClosedArrow: 'closedReversed',
};
const BEKEND = new Set(['none', ...Object.keys(NAAR_LE)]);

/** /LE-naam (zonder '/') van een kop van de app. */
export function kopNaarLE(kop) {
  return NAAR_LE[kop] || 'None';
}

/**
 * Waarde voor /OPS_LineHeads ('begin,eind'), of null als /LE beide koppen
 * exact vastlegt.
 */
export function koppenSleutel(startHead, endHead) {
  const exact = (k) => !k || k === 'none' || UIT_LE[kopNaarLE(k)] === k;
  return exact(startHead) && exact(endHead) ? null : `${startHead || 'none'},${endHead || 'none'}`;
}

/**
 * Koppen bij het inlezen. /OPS_LineHeads geldt per uiteinde, en alleen zolang
 * het nog bij /LE past: een ander programma kan /LE wijzigen en deze sleutel
 * laten staan. Anders telt /LE.
 * @param {string[]} le  /LE-namen zoals PDF.js ze geeft
 * @param {string|null|undefined} sleutel  /OPS_LineHeads
 */
export function koppenUitBestand(le, sleutel) {
  const uitLe = { startHead: UIT_LE[le?.[0]] || 'none', endHead: UIT_LE[le?.[1]] || 'none' };
  if (typeof sleutel !== 'string') return uitLe;
  const koppen = sleutel.split(',').map((s) => s.trim());
  const kies = (i) => (BEKEND.has(koppen[i]) && kopNaarLE(koppen[i]) === (le?.[i] || 'None') ? koppen[i] : null);
  return { startHead: kies(0) || uitLe.startHead, endHead: kies(1) || uitLe.endHead };
}
