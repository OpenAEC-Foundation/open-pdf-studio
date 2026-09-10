// Symboolschaal — de maat waarop een symbool geplaatst wordt (issue #357).
//
// Zonder deze instelling komt elk symbool op zijn standaardmaat op de tekening
// en moet je het daarna met de hand bijschalen. Bij een brandveiligheidsplan
// met tientallen symbolen is dat tientallen keren hetzelfde werk.
//
// De factor geldt alleen op het MOMENT van plaatsen. Hem later wijzigen raakt
// niets wat al op de tekening staat — dat is bewust: anders zou een tekening
// onder je handen van maat veranderen.

/** Geen schaal gekozen = ware grootte. */
export const STANDAARD_SCHAAL = 1;

/** Grenzen waarbinnen een schaal zinnig is; daarbuiten is het een typefout. */
export const MIN_SCHAAL = 0.1;
export const MAX_SCHAAL = 10;

/** Vaste stappen voor de keuzelijst in het palet. */
export const SCHAAL_STAPPEN = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];

/**
 * Maakt van een ingevoerde waarde een bruikbare factor. Onzin (leeg, tekst,
 * nul, negatief) valt terug op ware grootte; te groot of te klein wordt
 * afgekapt in plaats van geweigerd, zodat een schuivende invoer niet blokkeert.
 * @param {unknown} waarde
 * @returns {number}
 */
export function normaliseerSchaal(waarde) {
  const n = typeof waarde === 'string' ? parseFloat(waarde.replace(',', '.')) : Number(waarde);
  if (!Number.isFinite(n) || n <= 0) return STANDAARD_SCHAAL;
  return Math.min(MAX_SCHAAL, Math.max(MIN_SCHAAL, n));
}

/**
 * Past de factor toe op een maat. Rondt af op honderdsten zodat er geen
 * eindeloze decimalen in de annotatie belanden.
 * @param {{width:number,height:number}} maat
 * @param {number} factor
 * @returns {{width:number,height:number}}
 */
export function schaalMaat(maat, factor) {
  const f = normaliseerSchaal(factor);
  if (!maat) return maat;
  // Ware grootte: niets aanraken. Ook niet afronden — een symbool met een
  // werkelijke maat in mm moet zijn exacte beeldverhouding houden.
  if (f === 1) return maat;
  const rond = (n) => (Number.isFinite(n) ? Math.round(n * f * 100) / 100 : n);
  return { ...maat, width: rond(maat.width), height: rond(maat.height) };
}

/**
 * Schaalt een omhullende rond haar MIDDEN, zodat het symbool op het klikpunt
 * blijft staan in plaats van naar rechtsonder weg te lopen.
 * @param {{x:number,y:number,width:number,height:number}} vak
 * @param {number} factor
 */
export function schaalVakOmMidden(vak, factor) {
  const f = normaliseerSchaal(factor);
  if (!vak || f === 1) return vak;
  const cx = vak.x + vak.width / 2;
  const cy = vak.y + vak.height / 2;
  const b = Math.round(vak.width * f * 100) / 100;
  const h = Math.round(vak.height * f * 100) / 100;
  return { ...vak, x: cx - b / 2, y: cy - h / 2, width: b, height: h };
}

/** Weergavetekst voor de knop in het palet: 1 -> "1x", 0.5 -> "0,5x". */
export function schaalLabel(factor) {
  const f = normaliseerSchaal(factor);
  const s = Number.isInteger(f) ? String(f) : String(f).replace('.', ',');
  return `${s}x`;
}
