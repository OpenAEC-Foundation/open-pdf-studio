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

import { PDFName, PDFRef, PDFDict, PDFArray, PDFStream } from 'pdf-lib';
import { bedKnipselIn } from '../vector-embed.js';

/** Sleutel van het woordenboek met bronpagina's op de catalogus. */
export const CATALOGUS_SLEUTEL = 'OPS_VectorSnippets';

const getal = (n) => (Number.isFinite(n) ? Number(n.toFixed(4)) : 0);

/**
 * De matrix die het ingebedde knipsel (0..knipselB x 0..knipselH, rechtop)
 * schaalvullend in de Rect legt. Op een gedraaid doelblad draait een viewer de
 * hele pagina mee met /Rotate, dus het knipsel moet daar tegengedraaid in: de
 * Rect is dan in ongedraaide paginaruimte en op het scherm zijn breedte en
 * hoogte bij een kwartslag omgewisseld. Dezelfde conventie als de andere
 * stempels: de draaiing zit in de cm, de /Matrix van de appearance blijft een
 * verschuiving.
 *
 * @param {number[]} rect  [x1, y1, x2, y2] in ongedraaide paginaruimte
 * @param {number} knipselB breedte van het ingebedde knipsel
 * @param {number} knipselH hoogte van het ingebedde knipsel
 * @param {number} [paginaRot] /Rotate van het doelblad
 * @returns {number[]|null} [a, b, c, d, e, f]
 */
export function knipselPlaatsing(rect, knipselB, knipselH, paginaRot = 0) {
  const [x1, y1, x2, y2] = rect || [];
  const b = x2 - x1;
  const h = y2 - y1;
  if (!(knipselB > 0) || !(knipselH > 0) || !(b > 0) || !(h > 0)) return null;
  switch (((Math.round((Number(paginaRot) || 0) / 90) * 90) % 360 + 360) % 360) {
    case 90:  return [0, h / knipselB, -b / knipselH, 0, x2, y1];
    case 180: return [-b / knipselB, 0, 0, -h / knipselH, x2, y2];
    case 270: return [0, -h / knipselB, b / knipselH, 0, x1, y2];
    default:  return [b / knipselB, 0, 0, h / knipselH, x1, y1];
  }
}

/**
 * De inhoudstroom die het ingebedde knipsel in de annotatie-Rect tekent. De
 * coördinaten zijn absoluut, net als bij de andere AP-bouwers in
 * saver/appearance-vectors.js — attachVectorAP zet BBox en Matrix.
 *
 * @param {number[]} rect  [x1, y1, x2, y2] van de annotatie
 * @param {number} knipselB breedte van het ingebedde knipsel
 * @param {number} knipselH hoogte van het ingebedde knipsel
 * @param {string} naam    resource-naam van het XObject
 * @param {number} [paginaRot] /Rotate van het doelblad
 * @returns {string|null}
 */
export function knipselApOps(rect, knipselB, knipselH, naam, paginaRot = 0) {
  const m = knipselPlaatsing(rect, knipselB, knipselH, paginaRot);
  if (!m) return null;
  return `q ${m.map(getal).join(' ')} cm /${naam} Do Q`;
}

/**
 * Vastzetten: tekent het knipsel met dezelfde plaatsing als de appearance
 * rechtstreeks in de inhoudstroom van de pagina. Niet via page.drawPage — die
 * schaalt met de maat van het ongedraaide bronvak, wat een knipsel uit een
 * gedraaid blad vervormt.
 */
export async function tekenKnipselInPagina(page, ingebedRef, plaatsing, opacity = 1) {
  const {
    pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, setGraphicsState,
  } = await import('pdf-lib');
  const naam = page.node.newXObject('OPSKnipsel', ingebedRef);
  const ops = [pushGraphicsState()];
  if (Number.isFinite(opacity) && opacity < 1) {
    const context = page.doc.context;
    const gs = context.register(context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }));
    ops.push(setGraphicsState(page.node.newExtGState('GS', gs)));
  }
  ops.push(concatTransformationMatrix(...plaatsing.map(getal)), drawObject(naam), popGraphicsState());
  page.pushOperators(...ops);
}

/**
 * Na een geslaagde save staat elk vastgezet knipsel in de pagina-inhoud van
 * het bestand op `pad`. Onthoud dat op het knipsel zelf.
 * @returns {number} het aantal gemarkeerde knipsels
 */
export function markeerGebakken(annotaties, pad) {
  let n = 0;
  for (const a of annotaties || []) {
    if (a?.type === 'vectorSnippet' && a.flattened) { a.gebakkenIn = pad; n++; }
  }
  return n;
}

/**
 * Staat dit knipsel al in de basisbytes waarop de volgende save voortbouwt?
 * Dan niet nogmaals tekenen en ook geen stempel schrijven. Komt de basis uit
 * een ander pad (werkkopie, of opgeslagen als kopie), dan wél.
 */
export function alInBasis(ann, basisPad) {
  return ann?.type === 'vectorSnippet' && !!ann.gebakkenIn && ann.gebakkenIn === basisPad;
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
 * @param {{bronBytes: Uint8Array, srcBox: object, rect: number[], sleutel: string, paginaIndex?: number, paginaRot?: number, bewaarBron?: boolean}} opdracht
 * @returns {Promise<{content: string, xobjects: object, breedte: number, hoogte: number, bronRef: object, ingebed: object, plaatsing: number[]}>}
 */
export async function bouwKnipselAppearance(doelDoc, opdracht) {
  const { bronBytes, srcBox, rect, sleutel, paginaIndex = 0, paginaRot = 0, bewaarBron = true } = opdracht;
  if (!bronBytes) throw new Error(`geen bronbytes voor knipsel ${sleutel}`);
  const { ingebed, breedte, hoogte } = await bedKnipselIn(doelDoc, bronBytes, srcBox, paginaIndex);
  const naam = 'OPSK0';
  const plaatsing = knipselPlaatsing(rect, breedte, hoogte, paginaRot);
  const content = knipselApOps(rect, breedte, hoogte, naam, paginaRot);
  if (!content || !plaatsing) throw new Error('knipsel of doelvak heeft geen oppervlak');
  // Een vastgezet knipsel is na opslaan gewone pagina-inhoud: de kopie van de
  // bronpagina is dan alleen nog ballast (bij een zware tekening megabytes).
  const bronRef = bewaarBron ? await registreerBron(doelDoc, sleutel, bronBytes) : null;
  return { content, xobjects: { [naam]: ingebed.ref }, breedte, hoogte, bronRef, ingebed, plaatsing };
}

// ─── Opruimen: geen groei bij elke save ───────────────────────────────────
//
// Bij elke save vervangt de saver een knipsel-stempel door een nieuwe, met een
// verse kopie van de bronpagina in de appearance. De oude stempel raakt los van
// de pagina, maar pdf-lib schrijft ook onbereikbare objecten weg: zonder deze
// stap groeide een bestand per save met de hele bronpagina (bij een zware
// tekening ruim 11 MB). Daar komt bij dat pdf-lib bij embedPage de hele
// bronpagina kopieert en daarna alleen de gedecodeerde inhoud gebruikt: de
// gekopieerde content-streams blijven als wezen achter.
//
// Bewust smal: alleen wat bij een vervangen knipsel of een niet meer gebruikte
// bron hoorde, en wat deze save zelf aanmaakte — en alles alleen als het vanaf
// de trailer onbereikbaar is. Wat weg gaat, kon dus nooit getoond worden.

function _tekst(v) {
  if (v && typeof v.decodeText === 'function') return v.decodeText();
  if (v && typeof v.value === 'string') return v.value;
  return null;
}

/** Alle indirecte objecten die vanaf `starts` bereikbaar zijn, op tag. */
function _bereikbaar(context, starts) {
  const gezien = new Map();
  const stapel = [...starts];
  while (stapel.length) {
    let o = stapel.pop();
    if (o instanceof PDFRef) {
      if (gezien.has(o.tag)) continue;
      gezien.set(o.tag, o);
      o = context.lookup(o);
      if (!o) continue;
    }
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stapel.push(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) stapel.push(v);
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stapel.push(v);
  }
  return gezien;
}

/**
 * Ruimt de resten van vervangen knipsel-stempels op, plus bronpagina's op de
 * catalogus waar geen enkele stempel in het document nog naar verwijst (een
 * vastgezet knipsel heeft zijn bron niet meer nodig). Aanroepen vlak voor
 * doc.save(), als alle annotaties geschreven zijn en NA `await doc.flush()` —
 * pas dan staan de ingebedde pagina's echt in de context.
 *
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {object[]} oudeStempels  refs van de knipsel-stempels die de saver uit /Annots haalde
 * @param {{nieuwVanaf?: number}} [opties]  objectnummers boven deze grens zijn in
 *   deze save aangemaakt; wat daarvan onbereikbaar is, is afval
 * @returns {{verwijderd: number, bronnenWeg: string[]}}
 */
export function ruimKnipselRestenOp(doc, oudeStempels = [], { nieuwVanaf } = {}) {
  const context = doc.context;

  const gebruikt = new Set();
  for (const pagina of doc.getPages()) {
    const annots = pagina.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (const ref of annots.asArray()) {
      const d = context.lookup(ref);
      const k = d instanceof PDFDict ? d.get(PDFName.of('OPS_SnippetKey')) : null;
      const t = k ? _tekst(context.lookup(k) || k) : null;
      if (t) gebruikt.add(t);
    }
  }

  const kandidaten = [...oudeStempels];
  const bronnenWeg = [];
  const naam = PDFName.of(CATALOGUS_SLEUTEL);
  const wbRaw = doc.catalog.get(naam);
  const wb = wbRaw ? context.lookup(wbRaw) : null;
  if (wb instanceof PDFDict) {
    for (const sleutelNaam of wb.keys()) {
      const sleutel = sleutelNaam.asString().replace(/^\//, '');
      if (gebruikt.has(sleutel)) continue;
      kandidaten.push(wb.get(sleutelNaam));
      wb.delete(sleutelNaam);
      bronnenWeg.push(sleutel);
    }
    if (wb.keys().length === 0) {
      doc.catalog.delete(naam);
      if (wbRaw instanceof PDFRef) kandidaten.push(wbRaw);
    }
  }
  if (Number.isFinite(nieuwVanaf)) {
    for (const [ref] of context.enumerateIndirectObjects()) {
      if (ref.objectNumber > nieuwVanaf) kandidaten.push(ref);
    }
  }
  if (!kandidaten.length) return { verwijderd: 0, bronnenWeg };

  const t = context.trailerInfo;
  const levend = _bereikbaar(context, [t.Root, t.Info, t.Encrypt, t.ID].filter(Boolean));
  let verwijderd = 0;
  for (const [tag, ref] of _bereikbaar(context, kandidaten)) {
    if (levend.has(tag)) continue;
    if (context.delete(ref)) verwijderd++;
  }
  return { verwijderd, bronnenWeg };
}
