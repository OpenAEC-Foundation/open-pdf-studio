// Grepen van een piepkleine vorm: waar staan ze, en welke wint onder de cursor.
//
// Grepen zijn schermvast (6 px + 4 px raakmarge). Nu een vorm willekeurig klein
// mag worden, liggen bij een vorm van een paar schermpixels acht maatgrepen, de
// verplaatsgreep en het lijf over elkaar: slepen aan het lijf werd dan bijna
// altijd SCHALEN, en de vorm zelf ging schuil achter de grepen.
//
// Vastgelegde keuze:
//  1. Is de vorm op het scherm kleiner dan MIN_GREEPKADER_PX, dan wijken de
//     maatgrepen uit naar een kader van die vaste schermmaat rond de vorm. De
//     verplaatsgreep blijft OP de vorm. Tekenen en raaktest gebruiken dezelfde
//     lijst, dus wat je ziet is wat je pakt.
//  2. Onder de cursor wint de greep waarvan het midden het dichtst bij ligt.
//  3. Bij gelijke afstand wint de verplaatsgreep van een maatgreep: verplaatsen
//     vervormt niets. Daarna geldt de volgorde van de lijst.
//
// Bewust GEEN imports: ook in Node getest (greep-keuze.test.mjs).

/** Schermmaat van het greepkader: drie grepen van 6 px met 3 px tussenruimte. */
export const MIN_GREEPKADER_PX = 24;

// Richting waarin een greep uitwijkt (x, y): -1 = naar links/boven.
const _UITWIJK = {
  tl: [-1, -1], tr: [1, -1], bl: [-1, 1], br: [1, 1],
  t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0],
  // De rotatiegreep hangt boven de bovenrand en schuift mee omhoog, zodat hij
  // 25 px boven de bovenste greep blijft en bereikbaar is.
  rotate: [0, -1],
  // De "aanhaallijn toevoegen"-knop van het tekstvak staat rechtsboven buiten het vak.
  leader_add: [1, -1],
};

const _MAATGREPEN = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];

/**
 * Laat de maatgrepen van een op het scherm te kleine vorm uitwijken.
 * Muteert de greepposities en geeft dezelfde lijst terug.
 *
 * @param {Array<{type:string,x:number,y:number}>} grepen  lokale (ongedraaide) posities
 * @param {{x:number,y:number,width:number,height:number}} vak  het vak van de vorm
 * @param {number} schaal  zoom: schermpixels per paginapunt
 * @param {number} greepPx  schermmaat van een greep (ongebruikt in de rekensom, wel in de drempel)
 * @param {number} [minKaderPx]
 */
export function spreidMaatgrepen(grepen, vak, schaal, greepPx, minKaderPx = MIN_GREEPKADER_PX) {
  if (!Array.isArray(grepen) || !vak) return grepen;
  if (!(typeof schaal === 'number' && Number.isFinite(schaal) && schaal > 0)) return grepen;
  const w = Math.abs(vak.width), h = Math.abs(vak.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return grepen;
  const minKader = minKaderPx / schaal;
  const padX = w < minKader ? (minKader - w) / 2 : 0;
  const padY = h < minKader ? (minKader - h) / 2 : 0;
  if (padX === 0 && padY === 0) return grepen;
  // Zonder maatgrepen (vaste-maat-symbool, lijnvormen) valt er niets uit te
  // wijken; de rotatiegreep schuift alleen mee als er een bovenrij is.
  const types = new Set(grepen.map(g => g?.type));
  if (!_MAATGREPEN.some(t => types.has(t))) return grepen;
  const heeftBovenrij = types.has('tl') || types.has('t') || types.has('tr');
  for (const g of grepen) {
    const r = typeof g?.type === 'string' ? _UITWIJK[g.type] : null;
    if (!r) continue;
    if ((g.type === 'rotate' || g.type === 'leader_add') && !heeftBovenrij) continue;
    g.x += r[0] * padX;
    g.y += r[1] * padY;
  }
  return grepen;
}

function _isVerplaatsgreep(g) {
  return !!g && (g.isCenterGrip === true || g.type === 'callout_move');
}

/**
 * Welke greep ligt onder de cursor? Zie de vastgelegde keuze bovenaan.
 *
 * @param {Array} grepen  posities zoals ze getekend worden
 * @param {number} x  cursor (zelfde ruimte als de grepen)
 * @param {number} y
 * @param {number} greepMaat  maat van een standaardgreep in die ruimte
 * @param {number} raakMarge  extra raakvlak rondom elke greep
 * @returns {object|null}
 */
export function kiesGreep(grepen, x, y, greepMaat, raakMarge) {
  if (!Array.isArray(grepen)) return null;
  let beste = null;
  let besteAfstand = Infinity;
  for (const g of grepen) {
    const gw = g.w !== undefined ? g.w : greepMaat;
    const gh = g.h !== undefined ? g.h : greepMaat;
    if (x < g.x - raakMarge || x > g.x + gw + raakMarge
        || y < g.y - raakMarge || y > g.y + gh + raakMarge) continue;
    const mx = g.x + gw / 2, my = g.y + gh / 2;
    const afstand = (x - mx) * (x - mx) + (y - my) * (y - my);
    const gelijk = Math.abs(afstand - besteAfstand) <= 1e-12;
    if ((!gelijk && afstand < besteAfstand)
        || (gelijk && _isVerplaatsgreep(g) && !_isVerplaatsgreep(beste))) {
      besteAfstand = afstand;
      beste = g;
    }
  }
  return beste;
}
