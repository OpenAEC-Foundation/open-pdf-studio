// Uitlijnen op de pagina (#968): rekenwerk zonder DOM of app-state, zodat
// het in Node testbaar is. alignment.js levert de kaders van de selectie en
// de paginamaat; dit bestand rekent de verschuivingen uit.
//
// De annotaties staan in de paginaruimte (punten vanaf linksboven van de
// pagina, na /Rotate en de paginarotatie van het document; een uitsnede via
// de CropBox en /UserUnit zitten daar al in). "Links" en "boven" bedoelt de
// gebruiker op het scherm, dus in een gedraaide weergave (#200) rekenen we in
// de weergaveruimte en draaien de verschuiving daarna terug.

import { rectNaarWeergave, vectorNaarPagina, weergaveMaat, normaliseerRotatie } from '../pdf/weergave-rotatie.js';

export const PAGINA_KANTEN = ['left', 'center', 'right', 'top', 'middle', 'bottom'];

function geldig(b) {
  return b && [b.x, b.y, b.width, b.height].every(Number.isFinite);
}

function omhullend(kaders) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of kaders) {
    if (!geldig(b)) continue;
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
  }
  return Number.isFinite(x1) ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
}

// Verschuiving die kader `b` met `kant` op de pagina `p` legt.
function verschuivingVoor(b, p, kant) {
  switch (kant) {
    case 'left': return { dx: p.x - b.x, dy: 0 };
    case 'center': return { dx: (p.x + p.width / 2) - (b.x + b.width / 2), dy: 0 };
    case 'right': return { dx: (p.x + p.width) - (b.x + b.width), dy: 0 };
    case 'top': return { dx: 0, dy: p.y - b.y };
    case 'middle': return { dx: 0, dy: (p.y + p.height / 2) - (b.y + b.height / 2) };
    case 'bottom': return { dx: 0, dy: (p.y + p.height) - (b.y + b.height) };
    default: return { dx: 0, dy: 0 };
  }
}

/**
 * Verschuivingen om kaders op een paginarechthoek uit te lijnen, in dezelfde
 * ruimte als de invoer.
 * @param {Array<{x,y,width,height}|null>} kaders
 * @param {{x,y,width,height}} pagina
 * @param {string} kant  een van PAGINA_KANTEN
 * @param {{perStuk?: boolean}} [opties]  perStuk: elk kader apart; anders
 *   schuift de hele groep als een geheel (onderlinge ligging blijft).
 * @returns {Array<{dx:number, dy:number}>} een per kader (0,0 bij een ongeldig kader)
 */
export function paginaUitlijnVerschuivingen(kaders, pagina, kant, { perStuk = false } = {}) {
  const lijst = kaders || [];
  const nul = { dx: 0, dy: 0 };
  if (!geldig(pagina) || !PAGINA_KANTEN.includes(kant)) return lijst.map(() => ({ ...nul }));
  if (perStuk) return lijst.map(b => (geldig(b) ? verschuivingVoor(b, pagina, kant) : { ...nul }));
  const groep = omhullend(lijst);
  const d = groep ? verschuivingVoor(groep, pagina, kant) : nul;
  return lijst.map(b => (geldig(b) ? { ...d } : { ...nul }));
}

/**
 * Zelfde, voor kaders in de paginaruimte van een pagina met maat
 * {breedte, hoogte} die met `rotatie` (0/90/180/270, weergaverotatie) op het
 * scherm staat. Uitlijnen gebeurt t.o.v. de pagina zoals die zichtbaar is;
 * de verschuivingen komen terug in de paginaruimte als {x, y}.
 */
export function paginaUitlijnenInPaginaruimte(kaders, maat, rotatie, kant, opties) {
  const lijst = kaders || [];
  if (!maat || !(maat.breedte > 0) || !(maat.hoogte > 0)) return lijst.map(() => ({ x: 0, y: 0 }));
  const r = normaliseerRotatie(rotatie || 0);
  const zicht = weergaveMaat(maat.breedte, maat.hoogte, r);
  const paginaInZicht = { x: 0, y: 0, width: zicht.breedte, height: zicht.hoogte };
  const inZicht = lijst.map(b => (geldig(b) ? rectNaarWeergave(b, maat.breedte, maat.hoogte, r) : null));
  return paginaUitlijnVerschuivingen(inZicht, paginaInZicht, kant, opties)
    .map(({ dx, dy }) => vectorNaarPagina(dx, dy, r));
}
