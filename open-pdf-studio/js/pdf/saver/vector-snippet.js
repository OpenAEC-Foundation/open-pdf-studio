// Vectorknipsel — het schrijfpad.
//
// Een LOS knipsel wordt een stempel-annotatie waarvan de appearance het
// ingebedde Form XObject tekent. Dat is echte vectordata: elke PDF-lezer toont
// het scherp, en de app leest het bij heropenen terug als verplaatsbaar object.
//
// De bronpagina zelf gaat één keer per sleutel mee in het document, verzameld
// in een OPS_VectorSnippets-woordenboek op de catalogus. Dat is wat een knipsel
// zelfstandig maakt: de appearance is genoeg om te tonen, te weinig om mee te
// werken (scherper hertekenen bij inzoomen, of later alsnog vastzetten).

import { bedKnipselIn } from '../vector-embed.js';

/** Sleutel van het woordenboek met bronpagina's op de catalogus. */
export const CATALOGUS_SLEUTEL = 'OPS_VectorSnippets';

const getal = (n) => (Number.isFinite(n) ? Number(n.toFixed(4)) : 0);

/**
 * De inhoudstroom die het ingebedde knipsel schaalvullend in de annotatie-Rect
 * tekent. De coördinaten zijn absoluut, net als bij de andere AP-bouwers in
 * saver/appearance-vectors.js — attachVectorAP zet BBox en Matrix.
 *
 * @param {number[]} rect  [x1, y1, x2, y2] van de annotatie
 * @param {number} knipselB breedte van het ingebedde knipsel
 * @param {number} knipselH hoogte van het ingebedde knipsel
 * @param {string} naam    resource-naam van het XObject
 * @returns {string|null}
 */
export function knipselApOps(rect, knipselB, knipselH, naam) {
  const [x1, y1, x2, y2] = rect || [];
  const b = x2 - x1;
  const h = y2 - y1;
  if (!(knipselB > 0) || !(knipselH > 0) || !(b > 0) || !(h > 0)) return null;
  return `q ${getal(b / knipselB)} 0 0 ${getal(h / knipselH)} ${getal(x1)} ${getal(y1)} cm /${naam} Do Q`;
}

/**
 * Zet de bronpagina van een knipsel één keer in het document. Tweede aanroep
 * met dezelfde sleutel hergebruikt de bestaande stream.
 * @returns {object} de ref naar de stream
 */
export async function registreerBron(doelDoc, sleutel, bytes) {
  const { PDFName } = await import('pdf-lib');
  const context = doelDoc.context;
  const naam = PDFName.of(CATALOGUS_SLEUTEL);
  let woordenboek = doelDoc.catalog.lookup(naam);
  if (!woordenboek || typeof woordenboek.set !== 'function') {
    woordenboek = context.obj({});
    doelDoc.catalog.set(naam, context.register(woordenboek));
  }
  const sleutelNaam = PDFName.of(sleutel);
  const bestaand = woordenboek.get(sleutelNaam);
  if (bestaand) return bestaand;
  const stream = context.flateStream(bytes, { Type: 'OPSVectorSnippet' });
  const ref = context.register(stream);
  woordenboek.set(sleutelNaam, ref);
  return ref;
}

/**
 * Bedt het knipsel in en levert alles wat saver.js nodig heeft om er een
 * stempel met vectoriële appearance van te maken.
 *
 * @param {import('pdf-lib').PDFDocument} doelDoc
 * @param {{bronBytes: Uint8Array, srcBox: object, rect: number[], sleutel: string, paginaIndex?: number}} opdracht
 * @returns {Promise<{content: string, xobjects: object, breedte: number, hoogte: number, bronRef: object}>}
 */
export async function bouwKnipselAppearance(doelDoc, opdracht) {
  const { bronBytes, srcBox, rect, sleutel, paginaIndex = 0 } = opdracht;
  if (!bronBytes) throw new Error(`geen bronbytes voor knipsel ${sleutel}`);
  const { ingebed, breedte, hoogte } = await bedKnipselIn(doelDoc, bronBytes, srcBox, paginaIndex);
  const naam = 'OPSK0';
  const content = knipselApOps(rect, breedte, hoogte, naam);
  if (!content) throw new Error('knipsel of doelvak heeft geen oppervlak');
  const bronRef = await registreerBron(doelDoc, sleutel, bronBytes);
  return { content, xobjects: { [naam]: ingebed.ref }, breedte, hoogte, bronRef };
}
