// Rand en /RD van een rechthoek of ellips (/Square, /Circle).
//
// PDF 32000-1, 12.5.6.8: /RD geeft per zijde de afstand van /Rect tot de
// vorm, en de rand (/BS /W) ligt BINNEN de vorm. Het model van de app
// (x, y, breedte, hoogte) is de hartlijn van de rand, dus:
//
//   hartlijn = /Rect − /RD − W/2        (lezen, loader/annotation-converter.js)
//   /Rect    = hartlijn + W/2, /RD 0    (schrijven, saver.js en saver/utils.js)
//
// Een bestand zonder /RD houdt de oude regel: /Rect is de hartlijn. Zo
// schreef de app zelf een rechthoek of ellips vóór deze regel; die bestanden
// openen dus precies als voorheen.
//
// Alleen voor een ongedraaide rechthoek of ellips: een gedraaide schrijft de
// app als omhullende met OPS_Rotation (zonder /RD), en een wolk (/BE) houdt
// zijn eigen /RD, die de uitstulpingen bevat.

/** /RD als vier eindige, niet-negatieve getallen, anders null. */
export function geldigeRd(rd) {
  if (!Array.isArray(rd) || rd.length !== 4) return null;
  return rd.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) ? rd : null;
}

/**
 * De hartlijn van de rand uit /Rect en /RD, in PDF-coördinaten
 * [x1, y1, x2, y2] (x1 < x2, y1 < y2). Null zonder geldige /RD, of als er
 * na de inzet geen vorm overblijft; dan geldt /Rect zelf.
 * @param {number[]} rect  /Rect
 * @param {number[]|null|undefined} rd  /RD: [links, onder, rechts, boven]
 * @param {number} lijndikte  /BS /W zoals in het bestand
 */
export function hartlijnUitRect(rect, rd, lijndikte) {
  const r = geldigeRd(rd);
  if (!r || !Array.isArray(rect) || rect.length < 4) return null;
  const half = Number.isFinite(lijndikte) && lijndikte > 0 ? lijndikte / 2 : 0;
  const x1 = Math.min(rect[0], rect[2]) + r[0] + half;
  const y1 = Math.min(rect[1], rect[3]) + r[1] + half;
  const x2 = Math.max(rect[0], rect[2]) - r[2] - half;
  const y2 = Math.max(rect[1], rect[3]) - r[3] - half;
  if (!(x2 > x1) || !(y2 > y1)) return null;
  return [x1, y1, x2, y2];
}

/**
 * /Rect en /RD voor een hartlijn [x1, y1, x2, y2] in PDF-coördinaten: de
 * rand valt dan binnen /Rect, zoals de specificatie het wil.
 * @param {number[]} hartlijn
 * @param {number} lijndikte  de /BS /W die in het bestand komt
 * @returns {{rect: number[], rd: number[]}}
 */
export function rectRondHartlijn(hartlijn, lijndikte) {
  const half = Number.isFinite(lijndikte) && lijndikte > 0 ? lijndikte / 2 : 0;
  const [x1, y1, x2, y2] = hartlijn;
  return {
    rect: [Math.min(x1, x2) - half, Math.min(y1, y2) - half, Math.max(x1, x2) + half, Math.max(y1, y2) + half],
    rd: [0, 0, 0, 0],
  };
}

/** Schrijft de saver deze annotatie met de rand binnen /Rect en een /RD? */
export function randBinnenRect(ann) {
  return !!ann && (ann.type === 'box' || ann.type === 'circle') && !ann.rotation;
}
