// De grondvorm die in /Vertices van een veelhoek of wolk terechtkomt (#434).
//
// De opslag en de lader moeten het hier over eens zijn: de lader neemt de
// omhullende van /Vertices als vak (x/y/breedte/hoogte) van de annotatie.
// Schrijft de opslag iets anders dan de grondvorm, dan verschuift of krimpt
// de vorm bij elke rondgang opslaan → heropenen.
//
// Een rechthoekige wolk staat in het model als vak en heeft geen eigen
// punten. De opslag viel daardoor terug op de tak voor een gewone veelhoek en
// schreef de hoekpunten van de INGESCHREVEN regelmatige zeshoek. Die raakt
// links en rechts niet aan het vak, dus de omhullende was nog cos(30°) =
// 86,6 % breed en de wolk werd 13,4 % smaller.
//
// /Vertices van een wolk hoort de grondvorm te zijn waar de bolling omheen
// loopt — zo schrijft een ander programma zijn /Polygon met /BE /S /C ook.
// Voor een rechthoekige wolk zijn dat de vier hoekpunten van het vak.

// Hoek van hoekpunt i van een ingeschreven regelmatige n-hoek: hoekpunt 0
// ligt boven het midden (in app-coördinaten loopt y naar beneden).
const veelhoekHoek = (i, zijden) => (i * 2 * Math.PI / zijden) - Math.PI / 2;

/** Heeft de vorm een bruikbaar vak (x/y/breedte/hoogte)? */
function heeftVak(ann) {
  return !!ann
    && Number.isFinite(ann.x) && Number.isFinite(ann.y)
    && Number.isFinite(ann.width) && Number.isFinite(ann.height)
    && ann.width > 0 && ann.height > 0;
}

/** De ingeschreven regelmatige veelhoek van het vak (hoekpunt 0 bovenaan). */
function regelmatigeVeelhoek(ann, zijden) {
  const cx = ann.x + ann.width / 2;
  const cy = ann.y + ann.height / 2;
  const rx = ann.width / 2;
  const ry = ann.height / 2;
  const punten = [];
  for (let i = 0; i < zijden; i++) {
    const hoek = veelhoekHoek(i, zijden);
    punten.push({ x: cx + rx * Math.cos(hoek), y: cy + ry * Math.sin(hoek) });
  }
  return punten;
}

/** De vier hoekpunten van het vak van een rechthoekige wolk, anders null. */
export function wolkVakHoeken(ann) {
  if (!ann || ann.type !== 'cloud' || !heeftVak(ann)) return null;
  const { x, y, width: b, height: h } = ann;
  return [{ x, y }, { x: x + b, y }, { x: x + b, y: y + h }, { x, y: y + h }];
}

/**
 * De punten die als /Vertices weggeschreven worden (app-coördinaten):
 * de eigen punten van de vorm, anders de vier hoekpunten van een
 * rechthoekige wolk, anders de ingeschreven regelmatige veelhoek van het vak.
 */
export function veelhoekGrondvorm(ann) {
  if (!ann) return [];
  if (Array.isArray(ann.points) && ann.points.length >= 3) return ann.points;
  return wolkVakHoeken(ann) || regelmatigeVeelhoek(ann, ann.sides || 6);
}

/** De omhullende van een puntenlijst, of null bij onbruikbare punten. */
function omhullende(punten, aantal) {
  if (!Array.isArray(punten) || punten.length !== aantal) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of punten) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

const speling = (b, h) => Math.max(0.01, Math.max(b, h) * 1e-4);

/**
 * Het vak van een rechthoekige wolk waarvan de punten PRECIES de vier
 * hoekpunten van dat vak zijn, of null bij elke andere vorm.
 *
 * Zulke punten zeggen niets meer dan het vak zelf, en ze horen niet in het
 * model te blijven staan: een wolk tekent en raakt op zijn vak, dus na een
 * maatwijziging zou de opslag de oude punten terugschrijven en was de nieuwe
 * maat bij het heropenen weer weg.
 */
export function wolkVakUitHoeken(punten) {
  const g = omhullende(punten, 4);
  if (!g) return null;
  const breedte = g.maxX - g.minX;
  const hoogte = g.maxY - g.minY;
  if (!(breedte > 0) || !(hoogte > 0)) return null;
  const tol = speling(breedte, hoogte);
  // Elk hoekpunt van het vak moet precies één keer voorkomen; de volgorde
  // mag van een ander programma zijn.
  const hoeken = [[g.minX, g.minY], [g.maxX, g.minY], [g.maxX, g.maxY], [g.minX, g.maxY]];
  const gezien = new Set();
  for (const p of punten) {
    const i = hoeken.findIndex(([hx, hy], idx) => !gezien.has(idx)
      && Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol);
    if (i < 0) return null;
    gezien.add(i);
  }
  return { x: g.minX, y: g.minY, width: breedte, height: hoogte };
}

/**
 * Het oorspronkelijke vak van een rechthoekige wolk die nog als ingeschreven
 * zeshoek in het bestand staat (opgeslagen vóór #434), of null zodra de
 * punten iets anders beschrijven. Alleen voor annotaties met onze eigen
 * sleutel /OPS_Subtype (cloud): alleen deze app schreef die zeshoek.
 *
 * Zonder dit herstel blijft zo'n wolk op zijn gekrompen maat staan én zet de
 * lader de zeshoek als punten in het model, waarna de volgende opslag hem
 * opnieuw wegschrijft.
 */
export function wolkVakUitZeshoek(punten) {
  const g = omhullende(punten, 6);
  if (!g) return null;
  // De zeshoek is cos(30°) van het vak breed en even hoog.
  const breedte = (g.maxX - g.minX) / Math.cos(Math.PI / 6);
  const hoogte = g.maxY - g.minY;
  if (!(breedte > 0) || !(hoogte > 0)) return null;
  const cx = (g.minX + g.maxX) / 2;
  const cy = (g.minY + g.maxY) / 2;

  // Alleen herstellen als de punten werkelijk de zeshoek van dát vak zijn.
  const tol = speling(breedte, hoogte);
  for (let i = 0; i < 6; i++) {
    const hoek = veelhoekHoek(i, 6);
    if (Math.abs(punten[i].x - (cx + (breedte / 2) * Math.cos(hoek))) > tol) return null;
    if (Math.abs(punten[i].y - (cy + (hoogte / 2) * Math.sin(hoek))) > tol) return null;
  }
  return { x: cx - breedte / 2, y: cy - hoogte / 2, width: breedte, height: hoogte };
}
