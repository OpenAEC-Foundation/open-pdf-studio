// Tekenopdrachten van een stift: één pure bouwer voor het canvas én de
// appearance stream in de PDF, zodat scherm en opgeslagen bestand gelijk zijn.
//
// Een opdracht is een gewoon object in paginacoördinaten (punten, y omlaag):
//   { soort: 'lijn', punten: [[x, y], …], kleur, dikte, streep: null | [streep, gat] }
//   { soort: 'vlak', punten: [[x, y], …], kleur }            gevulde veelhoek
//   { soort: 'cirkel', x, y, r, kleur }                      gevulde cirkel
//   { soort: 'rechthoek', x, y, b, h, vulling }             gevuld vak
//   { soort: 'tekst', x, y, tekst, grootte, vet, kleur, uitlijning, breedte }
// Bij tekst is y de basislijn en x het begin ('links') of het midden
// ('midden'); `breedte` is de Helvetica-breedte, nodig om in de PDF te
// centreren.

import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';
import { toWinAnsiText } from '../../pdf/saver/pdf-text.js';
import { mmNaarPt } from './definities.js';

export const WIT = '#FFFFFF';
/** Legendagroen en tekstkleur uit 3052-CP-21. */
export const LEGENDA_GROEN = '#45B5A8';
export const LEGENDA_TEKST = '#350E35';
/** Lengte van een pijlpunt op papier. */
export const PIJLPUNT_MM = 3;
/** Het lettervak op een vloerpijl, in punten (10 × 15 pt, zoals in 3052). */
export const LETTERVAK = Object.freeze({ breedte: 10, hoogte: 15, grootte: 12 });
/** Basislijn ten opzichte van het midden van een tekstvak, als deel van de lettergrootte. */
export const BASISLIJN = 0.35;

const ONBEKEND = Object.freeze({
  kleur: '#999999', lijnsoort: 'gestreept', dikteMm: 0.5, letter: '?', puntvorm: 'vierkant', maatMm: 4,
});

let _helv = null;
let _helvBold = null;

/** Breedte van `tekst` in Helvetica (of Helvetica-Bold) op `grootte` punt. */
export function helveticaBreedte(tekst, grootte, vet = false) {
  if (vet) _helvBold ||= StandardFontEmbedder.for(StandardFonts.HelveticaBold);
  else _helv ||= StandardFontEmbedder.for(StandardFonts.Helvetica);
  return (vet ? _helvBold : _helv).widthOfTextAtSize(toWinAnsiText(String(tekst ?? '')), grootte);
}

/** Streep 2 × de dikte, gat 1 × de dikte (3052: [8,1 4,0] bij 4,03 pt). */
export function streepPatroon(diktePt) {
  return [2 * diktePt, diktePt];
}

/** Gesloten pijlpunt met de top op `tip`, wijzend weg van `van`. */
export function pijlpunt(tip, van, lengte) {
  const dx = tip[0] - van[0];
  const dy = tip[1] - van[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const half = lengte * 0.3;
  const bx = tip[0] - ux * lengte;
  const by = tip[1] - uy * lengte;
  return [[tip[0], tip[1]], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]];
}

function lijnOpdrachten(punten, def) {
  const dikte = mmNaarPt(def.dikteMm);
  if (def.lijnsoort === 'gestreept') {
    // Witte onderlaag: de gaten tonen wit, niet de grijze wand eronder.
    return [
      { soort: 'lijn', punten, kleur: WIT, dikte, streep: null },
      { soort: 'lijn', punten, kleur: def.kleur, dikte, streep: streepPatroon(dikte) },
    ];
  }
  return [{ soort: 'lijn', punten, kleur: def.kleur, dikte, streep: null }];
}

function tekstOpdracht(x, midden, tekst, grootte, vet, kleur, uitlijning, meet) {
  return {
    soort: 'tekst', x, y: midden + grootte * BASISLIJN, tekst, grootte, vet, kleur, uitlijning,
    breedte: meet(tekst, grootte, vet),
  };
}

function pijlOpdrachten(stift, def, meet) {
  const a = [stift.startX, stift.startY];
  const b = [stift.endX, stift.endY];
  const lengte = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const kop = Math.min(mmNaarPt(PIJLPUNT_MM), lengte / 2);
  const opdrachten = [];
  if (lengte > 2 * kop) {
    const ux = (b[0] - a[0]) / lengte;
    const uy = (b[1] - a[1]) / lengte;
    // De lijn stopt bij de basis van de pijlpunten, anders steekt hij erdoor.
    opdrachten.push({
      soort: 'lijn',
      punten: [[a[0] + ux * kop, a[1] + uy * kop], [b[0] - ux * kop, b[1] - uy * kop]],
      kleur: def.kleur, dikte: mmNaarPt(def.dikteMm), streep: null,
    });
  }
  if (lengte > 0) {
    opdrachten.push({ soort: 'vlak', punten: pijlpunt(a, b, kop), kleur: def.kleur });
    opdrachten.push({ soort: 'vlak', punten: pijlpunt(b, a, kop), kleur: def.kleur });
  }
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  opdrachten.push({
    soort: 'rechthoek', x: mx - LETTERVAK.breedte / 2, y: my - LETTERVAK.hoogte / 2,
    b: LETTERVAK.breedte, h: LETTERVAK.hoogte, vulling: LEGENDA_GROEN,
  });
  opdrachten.push(tekstOpdracht(mx, my, def.letter || '', LETTERVAK.grootte, true, LEGENDA_TEKST, 'midden', meet));
  return opdrachten;
}

function puntOpdrachten(stift, def) {
  const maat = mmNaarPt(def.maatMm);
  const h = maat / 2;
  const { x, y } = stift;
  if (def.puntvorm === 'cirkel') return [{ soort: 'cirkel', x, y, r: h, kleur: def.kleur }];
  if (def.puntvorm === 'i-profiel') {
    const flens = maat / 5;
    const lijf = maat / 6;
    const vlakken = [
      [[-h, -h], [h, -h], [h, -h + flens], [-h, -h + flens]],
      [[-h, h - flens], [h, h - flens], [h, h], [-h, h]],
      [[-lijf / 2, -h + flens], [lijf / 2, -h + flens], [lijf / 2, h - flens], [-lijf / 2, h - flens]],
    ];
    // Stand 90: het profiel een kwartslag gedraaid (flenzen verticaal).
    const kwart = ((((stift.rotation || 0) % 180) + 180) % 180) === 90;
    return vlakken.map((vlak) => ({
      soort: 'vlak', kleur: def.kleur,
      punten: vlak.map(([px, py]) => (kwart ? [x - py, y + px] : [x + px, y + py])),
    }));
  }
  return [{ soort: 'vlak', kleur: def.kleur, punten: [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]] }];
}

function kruisOpdrachten(stift, def) {
  const dikte = mmNaarPt(def.dikteMm);
  const { x, y, width: b, height: h } = stift;
  return [
    { soort: 'lijn', punten: [[x, y], [x + b, y + h]], kleur: def.kleur, dikte, streep: null },
    { soort: 'lijn', punten: [[x + b, y], [x, y + h]], kleur: def.kleur, dikte, streep: null },
  ];
}

function eerstePunt(stift) {
  switch (stift.vorm) {
    case 'pijl': return [stift.startX, stift.startY];
    case 'punt':
    case 'kruis': return [stift.x, stift.y];
    default: return stift.points?.length ? [stift.points[0].x, stift.points[0].y] : [0, 0];
  }
}

/**
 * De opdrachten van één stift. Zonder bruikbare definitie: grijs gestreept
 * met een vraagteken, en de stift behoudt al zijn gegevens.
 * @param {object} stift  annotatie van type 'stift' (met `vorm`)
 * @param {object|null} definitie
 * @param {{meet?: (tekst: string, grootte: number, vet: boolean) => number}} [opties]
 */
export function stiftTekenopdrachten(stift, definitie, { meet = helveticaBreedte } = {}) {
  const def = definitie || ONBEKEND;
  let opdrachten;
  switch (stift.vorm) {
    case 'pijl': opdrachten = pijlOpdrachten(stift, def, meet); break;
    case 'punt': opdrachten = puntOpdrachten(stift, def); break;
    case 'kruis': opdrachten = kruisOpdrachten(stift, def); break;
    default: opdrachten = lijnOpdrachten((stift.points || []).map((p) => [p.x, p.y]), def);
  }
  if (!definitie && stift.vorm !== 'pijl') {
    const [px, py] = eerstePunt(stift);
    opdrachten.push(tekstOpdracht(px, py, '?', 12, true, ONBEKEND.kleur, 'midden', meet));
  }
  return opdrachten;
}

/** Omhullende van een reeks opdrachten, inclusief halve lijndikte. */
export function opdrachtenOmhullende(opdrachten) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const neem = (x, y, marge = 0) => {
    x1 = Math.min(x1, x - marge); y1 = Math.min(y1, y - marge);
    x2 = Math.max(x2, x + marge); y2 = Math.max(y2, y + marge);
  };
  for (const o of opdrachten) {
    switch (o.soort) {
      case 'lijn': for (const [x, y] of o.punten) neem(x, y, o.dikte / 2); break;
      case 'vlak': for (const [x, y] of o.punten) neem(x, y); break;
      case 'cirkel': neem(o.x, o.y, o.r); break;
      case 'rechthoek': neem(o.x, o.y); neem(o.x + o.b, o.y + o.h); break;
      case 'tekst': {
        const begin = o.uitlijning === 'midden' ? o.x - o.breedte / 2 : o.x;
        neem(begin, o.y - o.grootte); neem(begin + o.breedte, o.y + o.grootte * 0.25);
        break;
      }
      default: break;
    }
  }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Omhullende van een getekende stift. */
export function stiftOmhullende(stift, definitie, opties) {
  return opdrachtenOmhullende(stiftTekenopdrachten(stift, definitie, opties));
}
