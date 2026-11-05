// Tekst markeren met Markeren in tekstmodus (#927): de rekenregels.
//
// De DOM-kant staat in text-selection.js; hier staat wat zonder DOM te
// toetsen is:
// - welke tekstlaag-spans een sleeplijn raakt (de selectie van de browser
//   volgt de bestandsvolgorde, niet de leesvolgorde, en pakt op tekeningen
//   labels van elders op het blad mee);
// - het woord onder de wijzer (dubbelklik) en het hele label (driemaal klik):
//   buurwoorden onder dezelfde hoek, op dezelfde regel, ongeveer een letter
//   uit elkaar, gemeten in de eigen ruimte van de tekstlaag;
// - de gedraaide quad langs schuine tekst, uit de letterposities op het
//   scherm;
// - de modus van de knop (vlak of tekst).
//
// Puur: geen DOM, geen app-imports.

/** Wachttijd van een dubbelklik, zodat een derde klik het kan overnemen. */
export const MEERKLIK_MS = 350;

export const MARKEER_MODI = Object.freeze(['area', 'text']);

/** Een bewaarde modus terug: alleen 'text' of 'area'. */
export function leesMarkeerModus(waarde) {
  return waarde === 'text' ? 'text' : 'area';
}

/**
 * De modus na een klik op de knop Markeren: staat hij al aan, dan wisselt
 * hij van modus; anders gaat de laatst gekozen modus aan.
 */
export function modusNaKlik(actief, modus) {
  const m = leesMarkeerModus(modus);
  return actief ? (m === 'text' ? 'area' : 'text') : m;
}

/**
 * Raakt de lijn (schermpixels) de rechthoek, binnen `marge` px? Elke 2 px
 * bemonsterd: ruim genoeg voor tekstvakken op het scherm.
 * @param {{x1:number,y1:number,x2:number,y2:number}} l
 * @param {{left:number,top:number,right:number,bottom:number}} r
 */
export function lijnRaaktRect(l, r, marge = 0) {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const stappen = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
  for (let i = 0; i <= stappen; i++) {
    const x = l.x1 + (dx * i) / stappen, y = l.y1 + (dy * i) / stappen;
    if (x >= r.left - marge && x <= r.right + marge && y >= r.top - marge && y <= r.bottom + marge) return true;
  }
  return false;
}

/** De aaneengesloten reeksen van `true` in `geraakt`: [[van, tot], ...] (tot inclusief). */
export function aaneengeslotenReeksen(geraakt) {
  const uit = [];
  let i = 0;
  while (i < geraakt.length) {
    if (!geraakt[i]) { i++; continue; }
    let j = i;
    while (j + 1 < geraakt.length && geraakt[j + 1]) j++;
    uit.push([i, j]);
    i = j + 1;
  }
  return uit;
}

const wit = (c) => /\s/.test(c);

/**
 * Het woord (tekst tussen spaties) rond letter `index`: [begin, eind) of
 * null als daar een spatie staat.
 */
export function woordGrenzen(tekst, index) {
  if (typeof tekst !== 'string' || index < 0 || index >= tekst.length || wit(tekst[index])) return null;
  let a = index, b = index + 1;
  while (a > 0 && !wit(tekst[a - 1])) a--;
  while (b < tekst.length && !wit(tekst[b])) b++;
  return [a, b];
}

/**
 * De letter die het dichtst bij (x, y) ligt. `middens[i]` is het midden van
 * letter i op het scherm, of null (spatie, niet gemeten).
 * @returns {number} index, of -1
 */
export function dichtsteLetter(middens, x, y) {
  let bij = -1, bd = Infinity;
  middens.forEach((m, i) => {
    if (!m) return;
    const d = Math.hypot(x - m.x, y - m.y);
    if (d < bd) { bd = d; bij = i; }
  });
  return bij;
}

/**
 * Horen twee woord-spans bij hetzelfde label? Maten in de eigen ruimte van
 * de tekstlaag: oorsprong (x, y), leesrichting t (radialen), lengte len en
 * letterhoogte h. Dezelfde hoek, ongeveer even hoog, op dezelfde regel en
 * hoogstens ongeveer een letter ertussen.
 * @param {{x:number,y:number,t:number,len:number,h:number}} a
 * @param {{x:number,y:number,t:number,len:number,h:number}} b
 */
export function hoortBijLabel(a, b) {
  if (Math.abs(a.t - b.t) > 0.01) return false;
  const h = Math.max(1, Math.min(a.h, b.h));
  if (Math.abs(a.h - b.h) > h * 0.5) return false;
  const ux = Math.cos(a.t), uy = Math.sin(a.t);
  const dx = b.x - a.x, dy = b.y - a.y;
  // Dezelfde regel: weinig verschuiving dwars op de leesrichting.
  if (Math.abs(-dx * uy + dy * ux) > h * 0.5) return false;
  // Dichtbij langs de regel: hoogstens ongeveer een letter tussen de woorden.
  const s = dx * ux + dy * uy;
  const gat = s >= 0 ? s - a.len : -s - b.len;
  return gat >= -h * 0.5 && gat <= h * 1.2;
}

/**
 * De woorden die met woord `i` één label vormen: [van, tot] (inclusief),
 * buren in bestandsvolgorde zolang hoortBijLabel geldt.
 */
export function labelBereik(maten, i) {
  let a = i, b = i;
  while (a > 0 && hoortBijLabel(maten[a], maten[a - 1])) a--;
  while (b < maten.length - 1 && hoortBijLabel(maten[b], maten[b + 1])) b++;
  return [a, b];
}

/**
 * De quad langs een stuk tekst op het scherm, uit de letterposities van zijn
 * span: begin-boven, eind-boven, begin-onder, eind-onder.
 * @param {object} m
 * @param {{x:number,y:number}} m.p0  midden van de eerste letter van de span
 * @param {{x:number,y:number}} m.p1  midden van de laatste letter van de span
 * @param {number} m.stappen  aantal letters tussen p0 en p1 (laatste - eerste)
 * @param {number} m.letters  aantal letters van de hele span
 * @param {number} m.lLok  lengte van de span in de tekstlaag (met zijn scaleX)
 * @param {number} m.hLok  hoogte van de span in de tekstlaag (met zijn scaleY)
 * @param {{x:number,y:number}} m.q0  midden van de eerste letter van het stuk
 * @param {{x:number,y:number}} m.q1  midden van de laatste letter van het stuk
 * @returns {Array<{x:number,y:number}>|null}
 */
export function quadLangsTekst({ p0, p1, stappen, letters, lLok, hLok, q0, q1 }) {
  const lang = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!(lang > 0) || !(stappen > 0)) return null;
  const ux = (p1.x - p0.x) / lang, uy = (p1.y - p0.y) / lang;
  // Letterafstand en -hoogte op het scherm.
  const steek = lang / stappen;
  const schaal = lLok > 0 ? (steek * letters) / lLok : 1;
  const h = hLok * schaal;
  if (!(h > 0)) return null;
  const s0 = (q0.x - p0.x) * ux + (q0.y - p0.y) * uy - steek / 2;
  const s1 = (q1.x - p0.x) * ux + (q1.y - p0.y) * uy + steek / 2;
  // Middenlijn door de lettermiddens; "boven" is tegen de normaal in.
  const nx = -uy, ny = ux;
  const punt = (s, d) => ({ x: p0.x + ux * s + nx * d, y: p0.y + uy * s + ny * d });
  return [punt(s0, -h / 2), punt(s1, -h / 2), punt(s0, h / 2), punt(s1, h / 2)];
}
