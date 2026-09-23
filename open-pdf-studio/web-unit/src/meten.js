// Meetkunde en meetschaal voor de web-unit.
//
// Pure module: geen DOM, geen globale state, geen PDF.js. Alles hier is met
// `node --test` te dekken.
//
// Afspraken over coordinaten en eenheden:
//
//   * Punten (`{x, y}`) staan in PDF-punten, met de oorsprong LINKSBOVEN in het
//     snijvak van de pagina en y naar BENEDEN. Dat is dezelfde ruimte als de
//     annotaties in de bureaubladversie gebruiken (zie `convertX`/`convertY`
//     in `js/pdf/saver.js`).
//   * De meetschaal heet hier `eenheidPerPunt`: hoeveel eenheden uit de echte
//     wereld één PDF-punt op papier voorstelt. Dat is exact de waarde die als
//     `/C` in de `/Measure`-woordenboek van de annotatie belandt.

/** Millimeters per eenheid. De basis voor alle omrekeningen. */
export const MM_PER_EENHEID = Object.freeze({
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
});

/** Millimeters per PDF-punt op papier (1 pt = 1/72 inch). */
export const MM_PER_PUNT = 25.4 / 72;

export function kentEenheid(eenheid) {
  return Object.prototype.hasOwnProperty.call(MM_PER_EENHEID, eenheid);
}

/**
 * Tekenschaal 1:<noemer> omrekenen naar eenheden per punt.
 * 1:100 in mm levert 100 * 25.4/72 = 35.2778 mm per punt.
 */
export function eenheidPerPuntUitNoemer(noemer, eenheid = 'mm') {
  if (!(noemer > 0)) throw new Error('noemer moet groter dan 0 zijn');
  if (!kentEenheid(eenheid)) throw new Error('onbekende eenheid: ' + eenheid);
  return (noemer * MM_PER_PUNT) / MM_PER_EENHEID[eenheid];
}

/** De omgekeerde weg: uit eenheden per punt de noemer van 1:<noemer> halen. */
export function noemerUitEenheidPerPunt(eenheidPerPunt, eenheid = 'mm') {
  if (!(eenheidPerPunt > 0)) throw new Error('eenheidPerPunt moet groter dan 0 zijn');
  if (!kentEenheid(eenheid)) throw new Error('onbekende eenheid: ' + eenheid);
  return (eenheidPerPunt * MM_PER_EENHEID[eenheid]) / MM_PER_PUNT;
}

/**
 * Een schaal uit een attribuut lezen. Toegestaan:
 *   "1:100"  -> tekenschaal
 *   "1/100"  -> idem
 *   "35.28"  -> rechtstreeks eenheden per punt
 *   ""/null  -> null (de gastheer laat de schaal open)
 * @returns {{eenheidPerPunt:number, noemer:number, eenheid:string}|null}
 */
export function leesSchaal(tekst, eenheid = 'mm') {
  if (tekst == null) return null;
  const s = String(tekst).trim();
  if (s === '') return null;
  const verhouding = s.match(/^(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)$/);
  if (verhouding) {
    const teller = Number(verhouding[1].replace(',', '.'));
    const noemer = Number(verhouding[2].replace(',', '.'));
    if (!(teller > 0) || !(noemer > 0)) return null;
    const n = noemer / teller;
    return { eenheidPerPunt: eenheidPerPuntUitNoemer(n, eenheid), noemer: n, eenheid };
  }
  const getal = Number(s.replace(',', '.'));
  if (!Number.isFinite(getal) || getal <= 0) return null;
  return { eenheidPerPunt: getal, noemer: noemerUitEenheidPerPunt(getal, eenheid), eenheid };
}

/** Kalibreren: een getekende lijn krijgt een bekende echte lengte. */
export function schaalUitKalibratie(lengtePt, echteWaarde, eenheid = 'mm') {
  if (!(lengtePt > 0)) throw new Error('lengtePt moet groter dan 0 zijn');
  if (!(echteWaarde > 0)) throw new Error('echteWaarde moet groter dan 0 zijn');
  if (!kentEenheid(eenheid)) throw new Error('onbekende eenheid: ' + eenheid);
  const eenheidPerPunt = echteWaarde / lengtePt;
  return { eenheidPerPunt, noemer: noemerUitEenheidPerPunt(eenheidPerPunt, eenheid), eenheid };
}

/** Afstand tussen twee punten, in PDF-punten. */
export function afstandPt(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

/** Omtrek van een reeks punten (open lijn), in PDF-punten. */
export function omtrekPt(punten, gesloten = false) {
  if (!Array.isArray(punten) || punten.length < 2) return 0;
  let som = 0;
  for (let i = 1; i < punten.length; i++) som += afstandPt(punten[i - 1], punten[i]);
  if (gesloten) som += afstandPt(punten[punten.length - 1], punten[0]);
  return som;
}

/** Oppervlakte van een gesloten veelhoek, in vierkante PDF-punten. */
export function oppervlaktePt2(punten) {
  if (!Array.isArray(punten) || punten.length < 3) return 0;
  let twee = 0;
  for (let i = 0; i < punten.length; i++) {
    const a = punten[i];
    const b = punten[(i + 1) % punten.length];
    twee += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twee) / 2;
}

/** Lengte in punten omrekenen naar de echte wereld. */
export function naarEenheid(lengtePt, eenheidPerPunt) {
  return lengtePt * eenheidPerPunt;
}

/** Oppervlakte in vierkante punten omrekenen naar de echte wereld. */
export function naarEenheidKwadraat(oppervlaktePt, eenheidPerPunt) {
  return oppervlaktePt * eenheidPerPunt * eenheidPerPunt;
}

/**
 * Een maat opschrijven. Vaste notatie met punt als decimaalteken, zodat de
 * tekst in het PDF-bestand niet van de taal van de kijker afhangt.
 */
export function formatteer(waarde, eenheid = 'mm', precisie = 2, kwadraat = false) {
  const p = Math.max(0, Math.min(6, Math.trunc(precisie)));
  return waarde.toFixed(p) + ' ' + eenheid + (kwadraat ? '²' : '');
}

/** Alles in één: twee punten -> {lengtePt, waarde, tekst}. */
export function meetAfstand(a, b, schaal, precisie = 2) {
  const lengtePt = afstandPt(a, b);
  const eenheidPerPunt = schaal?.eenheidPerPunt ?? 1;
  const eenheid = schaal?.eenheid ?? 'mm';
  const waarde = naarEenheid(lengtePt, eenheidPerPunt);
  return { lengtePt, waarde, eenheid, tekst: formatteer(waarde, eenheid, precisie) };
}
