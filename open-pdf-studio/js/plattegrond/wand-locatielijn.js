// Locatielijn van een wand (#1230): welke lijn volgen de klikken?
//
//   'center'  de hartlijn (de standaard; zo tekende de app altijd al)
//   'left'    het linkervlak, gezien langs de tekenrichting: de geklikte
//             punten zijn het linkervlak en het wandlichaam ligt rechts
//   'right'   het rechtervlak: het wandlichaam ligt links
//
// Het wandmodel verandert niet: een wand blijft een hartlijn met een dikte.
// De locatielijn werkt alleen bij het tekenen. De hartlijn schuift een halve
// dikte opzij van de geklikte lijn, en waar een wand op het geklikte hoekpunt
// van een andere wand begint of eindigt, gaan beide uiteinden naar het
// snijpunt van de hartlijnen. Dan vallen de eindpunten samen en verstekt de
// weergave de hoek zoals bij elke andere wandhoek (wand-join.js); een loop
// die op de binnenvlakken is getekend sluit zo tot een ruimte.
//
// Puur: geen app-state. Coördinaten in paginapunten met y omlaag, zoals het
// blad. "Rechts van de richting" is dan de normaal (-u.y, u.x): van links
// naar rechts getekend ligt rechts onder de lijn.

/** De locatielijnen in de volgorde van de keuzelijst. */
export const LOCATIELIJNEN = Object.freeze(['center', 'left', 'right']);

/** Een geldige locatielijn ('center' bij een onbekende waarde). */
export function normaliseerLocatielijn(waarde) {
  return LOCATIELIJNEN.includes(waarde) ? waarde : 'center';
}

/** Hoeken tot ± 11,5° (sinus 0,2) gelden als doorlopend, niet als hoek. */
export const HOEK_MIN_SIN = 0.2;

/** Een geklikt punt valt binnen deze afstand (paginapunten) op een vlakhoek. */
export const VLAK_TOL = 1.5;

function richting(l) {
  const dx = l.endX - l.startX, dy = l.endY - l.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return null;
  return { x: dx / len, y: dy / len, len };
}

/**
 * De verschuiving van de geklikte lijn naar de hartlijn, als vector.
 * @param {{startX,startY,endX,endY}} klik  de geklikte lijn
 * @param {number} halfPt  halve wanddikte in paginapunten
 * @param {string} locatielijn  'center' | 'left' | 'right'
 * @returns {{x: number, y: number}}
 */
export function hartlijnVerschuiving(klik, halfPt, locatielijn) {
  const lijn = normaliseerLocatielijn(locatielijn);
  const u = lijn === 'center' ? null : richting(klik);
  const h = Number(halfPt);
  if (!u || !(h > 0)) return { x: 0, y: 0 };
  const kant = lijn === 'left' ? 1 : -1;            // links geklikt: lichaam rechts
  return { x: -u.y * h * kant, y: u.x * h * kant };
}

/**
 * De hartlijn van een wand die op `locatielijn` getekend is.
 * @returns {{startX: number, startY: number, endX: number, endY: number}}
 */
export function hartlijnVanKliklijn(klik, halfPt, locatielijn) {
  const v = hartlijnVerschuiving(klik, halfPt, locatielijn);
  return {
    startX: klik.startX + v.x, startY: klik.startY + v.y,
    endX: klik.endX + v.x, endY: klik.endY + v.y,
  };
}

const ANDER = { start: 'end', end: 'start' };

function punt(w, eind) {
  return eind === 'start' ? { x: w.startX, y: w.startY } : { x: w.endX, y: w.endY };
}

function isZelfde(a, b) {
  return a === b || (a?.id != null && a.id === b?.id);
}

function snijpunt(p1, d1, p2, d2) {
  const noemer = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(noemer) < HOEK_MIN_SIN) return null;  // (bijna) evenwijdig
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / noemer;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/** Blijft de wand dezelfde kant op wijzen als uiteinde `eind` naar X gaat? */
function houdtRichting(w, eind, X) {
  const ver = punt(w, ANDER[eind]), nu = punt(w, eind);
  return (X.x - ver.x) * (nu.x - ver.x) + (X.y - ver.y) * (nu.y - ver.y) > 1e-9;
}

/**
 * Hoeken sluiten van een wand die op een vlak is getekend.
 *
 * Voor elk uiteinde van de nieuwe wand: ligt het GEKLIKTE punt op een
 * vlakhoek van een uiteinde van een bestaande wand (het eindpunt een halve
 * dikte opzij, aan een van beide kanten), dan vormen die twee een hoek. Het
 * uiteinde van de bestaande wand en dat van de nieuwe wand gaan naar het
 * snijpunt van hun hartlijnen. Wanden die (bijna) in elkaars verlengde
 * liggen, blijven zoals ze zijn, en een uiteinde dat daardoor zou omklappen
 * ook.
 *
 * @param {object} nieuw  de nieuwe wand, al op haar hartlijn (id, start/end)
 * @param {{startX,startY,endX,endY}} klik  de geklikte lijn van die wand
 * @param {object[]} wanden  de andere wanden op de pagina (nieuw mag erin staan)
 * @param {(w: object) => number} halfW  halve dikte in paginapunten
 * @param {{tol?: number}} [opties]
 * @returns {Array<{id, eind: 'start'|'end', x: number, y: number}>}  de
 *   zetten, in de vorm van hoekTrimPlan (wand-join.js): toe te passen met
 *   pasTrimToe, ook op de nieuwe wand zelf.
 */
export function vlakHoekPlan(nieuw, klik, wanden, halfW, opties = {}) {
  const tol = opties.tol ?? VLAK_TOL;
  const un = nieuw && richting(nieuw);
  if (!un || !klik) return [];
  const plan = [];
  const bezet = new Set();
  for (const eind of ['start', 'end']) {
    const P = eind === 'start'
      ? { x: klik.startX, y: klik.startY } : { x: klik.endX, y: klik.endY };
    if (!Number.isFinite(P.x) || !Number.isFinite(P.y)) continue;
    let beste = null;
    for (const o of wanden || []) {
      if (!o || isZelfde(o, nieuw)) continue;
      const uo = richting(o);
      if (!uo) continue;
      const h = halfW(o);
      for (const f of ['start', 'end']) {
        if (bezet.has(`${o.id}:${f}`)) continue;
        const Q = punt(o, f);
        const d = Math.min(
          Math.hypot(Q.x - uo.y * h - P.x, Q.y + uo.x * h - P.y),
          Math.hypot(Q.x + uo.y * h - P.x, Q.y - uo.x * h - P.y),
        );
        if (d > tol || (beste && d >= beste.d)) continue;
        const X = snijpunt({ x: nieuw.startX, y: nieuw.startY }, un, { x: o.startX, y: o.startY }, uo);
        if (!X || !houdtRichting(o, f, X) || !houdtRichting(nieuw, eind, X)) continue;
        beste = { o, f, d, X };
      }
    }
    if (!beste) continue;
    bezet.add(`${beste.o.id}:${beste.f}`);
    plan.push({ id: beste.o.id, eind: beste.f, x: beste.X.x, y: beste.X.y });
    plan.push({ id: nieuw.id, eind, x: beste.X.x, y: beste.X.y });
  }
  return plan;
}
