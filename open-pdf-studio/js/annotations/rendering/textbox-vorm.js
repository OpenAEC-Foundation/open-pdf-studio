// De vorm van een tekstvak: rechthoek met scherpe hoeken, rechthoek met
// afgeronde hoeken of ellips (een cirkel bij een vierkant vak). Een vak met
// vulkleur en lichte tekst (paars met wit, bijvoorbeeld) is zo ook een
// afgeronde knop of een ovaal.
//
// Puur: geen app-state. Het canvas (rendering.js), de opgeslagen appearance
// (saver.js) en de tekstinzet (textbox-layout.js) gebruiken dezelfde regels.

export const TEKSTVAK_VORMEN = Object.freeze(['rect', 'rounded', 'ellipse']);

// Kwart van de korte zijde per hoek; een vak van 150 x 50 krijgt zo 10 pt.
const HOEK_FRACTIE = 0.2;
// 1 - cos(45 graden): hoeveel van een afrondingsstraal de tekst vrij moet blijven.
const HOEK_VRIJ = 1 - Math.SQRT1_2;
const BEZIER_K = 0.5522847498;

/** De vorm van een annotatie; onbekend of leeg is een rechthoek. */
export function vormVan(ann) {
  return TEKSTVAK_VORMEN.includes(ann?.boxShape) ? ann.boxShape : 'rect';
}

/** De straal van de afgeronde hoeken van een vak, in paginapunten. */
export function hoekStraal(breedte, hoogte) {
  return Math.max(0, Math.min(breedte, hoogte) * HOEK_FRACTIE);
}

/**
 * Hoeveel de tekst extra van de rand blijft in een afgeronde of ovale vorm,
 * zodat hij binnen de contour past. Eén waarde voor alle zijden (de
 * tekstinzet is overal gelijk): bij een ellips de inzet van de ingeschreven
 * rechthoek langs de korte zijde.
 */
export function vormInzet(ann) {
  const vorm = vormVan(ann);
  if (vorm === 'rect') return 0;
  const b = ann?.width || 150;
  const h = ann?.height || 50;
  if (vorm === 'rounded') return hoekStraal(b, h) * HOEK_VRIJ;
  return (Math.min(b, h) / 2) * HOEK_VRIJ;
}

/**
 * Het pad van een vak op een canvas (nog niet gevuld of getekend).
 * @param {CanvasRenderingContext2D} ctx
 */
export function bouwVakPad(ctx, x, y, breedte, hoogte, vorm) {
  ctx.beginPath();
  if (vorm === 'ellipse') {
    ctx.ellipse(x + breedte / 2, y + hoogte / 2, breedte / 2, hoogte / 2, 0, 0, Math.PI * 2);
  } else if (vorm === 'rounded') {
    ctx.roundRect(x, y, breedte, hoogte, hoekStraal(breedte, hoogte));
  } else {
    ctx.rect(x, y, breedte, hoogte);
  }
}

const getal = (n) => String(Math.round(n * 1e4) / 1e4);

/**
 * Het pad van een vak als PDF-operatoren (y omhoog, het pad is gesloten maar
 * nog niet gevuld of getekend). x, y is de linkeronderhoek.
 */
export function vakPadPdf(x, y, breedte, hoogte, vorm) {
  if (vorm === 'ellipse') {
    const rx = breedte / 2;
    const ry = hoogte / 2;
    const cx = x + rx;
    const cy = y + ry;
    const kx = rx * BEZIER_K;
    const ky = ry * BEZIER_K;
    return [
      `${getal(cx + rx)} ${getal(cy)} m`,
      `${getal(cx + rx)} ${getal(cy + ky)} ${getal(cx + kx)} ${getal(cy + ry)} ${getal(cx)} ${getal(cy + ry)} c`,
      `${getal(cx - kx)} ${getal(cy + ry)} ${getal(cx - rx)} ${getal(cy + ky)} ${getal(cx - rx)} ${getal(cy)} c`,
      `${getal(cx - rx)} ${getal(cy - ky)} ${getal(cx - kx)} ${getal(cy - ry)} ${getal(cx)} ${getal(cy - ry)} c`,
      `${getal(cx + kx)} ${getal(cy - ry)} ${getal(cx + rx)} ${getal(cy - ky)} ${getal(cx + rx)} ${getal(cy)} c`,
      'h',
    ].join('\n');
  }
  if (vorm === 'rounded') {
    const r = hoekStraal(breedte, hoogte);
    const k = r * BEZIER_K;
    const x2 = x + breedte;
    const y2 = y + hoogte;
    return [
      `${getal(x + r)} ${getal(y)} m`,
      `${getal(x2 - r)} ${getal(y)} l`,
      `${getal(x2 - r + k)} ${getal(y)} ${getal(x2)} ${getal(y + r - k)} ${getal(x2)} ${getal(y + r)} c`,
      `${getal(x2)} ${getal(y2 - r)} l`,
      `${getal(x2)} ${getal(y2 - r + k)} ${getal(x2 - r + k)} ${getal(y2)} ${getal(x2 - r)} ${getal(y2)} c`,
      `${getal(x + r)} ${getal(y2)} l`,
      `${getal(x + r - k)} ${getal(y2)} ${getal(x)} ${getal(y2 - r + k)} ${getal(x)} ${getal(y2 - r)} c`,
      `${getal(x)} ${getal(y + r)} l`,
      `${getal(x)} ${getal(y + r - k)} ${getal(x + r - k)} ${getal(y)} ${getal(x + r)} ${getal(y)} c`,
      'h',
    ].join('\n');
  }
  // Ongewijzigd: de maten van een rechthoek komen nauwkeurig in de appearance.
  return `${x} ${y} ${breedte} ${hoogte} re`;
}
