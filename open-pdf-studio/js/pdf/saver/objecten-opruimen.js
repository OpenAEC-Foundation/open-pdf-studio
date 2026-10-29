// Ongebruikte objecten uit het document vóór pdfDocLib.save().
//
// pdf-lib schrijft elk object in zijn context mee, ook als er vanaf de
// trailer niets meer naar verwijst. De saver vervangt bij elke save alle
// annotaties die hij beheert door nieuwe uit het model; de oude
// woordenboeken, hun appearances, beelden en lettertypen bleven zo als
// ballast in het bestand staan. En omdat pdf-lib nieuwe objecten altijd
// boven het hoogste nummer aanmaakt, groeide de xref-tabel bij elke save met
// het hele annotatiebestand, ook als de ballast al weg was.
//
// Daarom: alles wat vanaf de trailer onbereikbaar is gaat weg, en wat deze
// save zelf aanmaakte (nummer boven `nieuwVanaf`) schuift naar de laagste
// vrije nummers. Bestaande objecten houden hun nummer: lagen van een ander
// programma dragen dat in hun id (annotatie-lagen.js). Een nummer waar nog
// een verwijzing naar wijst zonder dat het object bestaat, wordt niet
// hergebruikt; die verwijzing zou anders ineens naar iets anders wijzen.
//
// Aanroepen NA `await pdfDoc.flush()` en het bijwerken van formulier-
// appearances, en daarna opslaan zonder dat pdf-lib nog iets aanmaakt
// (`save({ updateFieldAppearances: false })`): een lettertype of beeld dat
// pas bij het opslaan wordt ingebed, zou zijn oude nummer gebruiken.

import { PDFArray, PDFDict, PDFRef, PDFStream } from 'pdf-lib';

function wortels(context) {
  const t = context.trailerInfo;
  return [t.Root, t.Info, t.Encrypt, t.ID].filter(Boolean);
}

/** De directe inhoud van een object waar verwijzingen in kunnen zitten. */
function kinderen(o) {
  if (o instanceof PDFDict) return o.entries().map(([, v]) => v);
  if (o instanceof PDFArray) return o.asArray();
  if (o instanceof PDFStream) return o.dict.entries().map(([, v]) => v);
  return [];
}

/**
 * Wat vanaf de trailer bereikbaar is: de tags van de objecten, en elk nummer
 * waar een verwijzing naar wijst (ook als dat object niet bestaat).
 */
// Objecten per stap: na zoveel objecten geeft het opruimen de aanroeper een
// veilig punt (een save kan daar geannuleerd worden, #766).
const PER_STAP = 2000;

function* bereikbaar(context) {
  const levend = new Set();
  const verwezen = new Set();
  const stapel = wortels(context);
  let n = 0;
  while (stapel.length) {
    if (++n % PER_STAP === 0) yield;
    let o = stapel.pop();
    if (o instanceof PDFRef) {
      verwezen.add(o.objectNumber);
      if (levend.has(o.tag)) continue;
      levend.add(o.tag);
      o = context.lookup(o);
    }
    // Geen spread: een /Kids- of /Annots-array kan te lang zijn voor push(...).
    for (const k of kinderen(o)) stapel.push(k);
  }
  return { levend, verwezen };
}

/**
 * Vervang in `o` (en zijn directe deelobjecten) de verwijzingen uit `kaart`.
 * `gezien` houdt bij welke woordenboeken en arrays al omgezet zijn: één
 * instantie kan op meerdere plaatsen staan (pdf-lib zet een gedeeld indirect
 * /Resources bij het normaliseren ook rechtstreeks in elke pagina). Een tweede
 * keer omzetten zou een al omgezette verwijzing nóg een stap verschuiven.
 */
function verwijsOm(o, kaart, gezien = new Set()) {
  const stapel = [o];
  while (stapel.length) {
    const huidig = stapel.pop();
    const dict = huidig instanceof PDFStream ? huidig.dict : huidig;
    if (!(dict instanceof PDFDict) && !(dict instanceof PDFArray)) continue;
    if (gezien.has(dict)) continue;
    gezien.add(dict);
    if (dict instanceof PDFDict) {
      for (const [sleutel, v] of dict.entries()) {
        if (v instanceof PDFRef) { if (kaart.has(v.tag)) dict.set(sleutel, kaart.get(v.tag)); }
        else stapel.push(v);
      }
    } else if (dict instanceof PDFArray) {
      for (let i = 0; i < dict.size(); i++) {
        const v = dict.get(i);
        if (v instanceof PDFRef) { if (kaart.has(v.tag)) dict.set(i, kaart.get(v.tag)); }
        else stapel.push(v);
      }
    }
  }
}

/**
 * Geef de objecten boven `grens` de laagste nummers die niet door een
 * bestaand object of een verwijzing bezet zijn.
 * @returns {number} het aantal verplaatste objecten
 */
function* nummerNieuweTerug(context, grens, verwezen) {
  const objecten = context.enumerateIndirectObjects();
  const bestaand = new Set(objecten.map(([ref]) => ref.objectNumber));
  // Bezet: bestaande objecten, en nummers waar een verwijzing naar wijst
  // zonder dat er een object staat. Een verwijzing naar een nieuw object
  // houdt zijn nummer niet bezet: het object verhuist en de verwijzing gaat mee.
  const bezet = new Set([...verwezen].filter((n) => !bestaand.has(n)));
  const nieuw = [];
  for (const [ref] of objecten) {
    if (ref.objectNumber > grens) nieuw.push(ref);
    else bezet.add(ref.objectNumber);
  }

  const kaart = new Map();
  let vrij = 1;
  for (const ref of nieuw) {
    while (bezet.has(vrij)) vrij++;
    if (vrij !== ref.objectNumber || ref.generationNumber !== 0) kaart.set(ref.tag, PDFRef.of(vrij, 0));
    bezet.add(vrij);
  }
  if (kaart.size === 0) return 0;

  const gezien = new Set();
  let n = 0;
  for (const [, o] of objecten) {
    if (++n % PER_STAP === 0) yield;
    verwijsOm(o, kaart, gezien);
  }
  const t = context.trailerInfo;
  for (const sleutel of ['Root', 'Info', 'Encrypt']) {
    if (t[sleutel] instanceof PDFRef && kaart.has(t[sleutel].tag)) t[sleutel] = kaart.get(t[sleutel].tag);
  }
  if (t.ID) verwijsOm(t.ID, kaart, gezien);

  const verhuizers = objecten.filter(([ref]) => kaart.has(ref.tag));
  for (const [ref] of verhuizers) context.delete(ref);
  for (const [ref, o] of verhuizers) context.assign(kaart.get(ref.tag), o);
  return verhuizers.length;
}

/** De stappen van het opruimen; elke `yield` is een veilig punt. */
function* opruimStappen(pdfDoc, { nieuwVanaf } = {}) {
  const context = pdfDoc.context;
  const { levend, verwezen } = yield* bereikbaar(context);
  let verwijderd = 0;
  let n = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (++n % PER_STAP === 0) yield;
    if (!levend.has(ref.tag) && context.delete(ref)) verwijderd++;
  }
  // Versleuteld: de sleutel van elk object hangt van zijn nummer af.
  const hernummerd = Number.isFinite(nieuwVanaf) && !context.trailerInfo.Encrypt
    ? yield* nummerNieuweTerug(context, nieuwVanaf, verwezen)
    : 0;
  // /Size volgt het hoogste object dat er nog is.
  let hoogste = 0;
  for (const [ref] of context.enumerateIndirectObjects()) hoogste = Math.max(hoogste, ref.objectNumber);
  context.largestObjectNumber = hoogste;
  return { verwijderd, hernummerd };
}

/**
 * Ruim onbereikbare objecten op en nummer wat deze save aanmaakte terug.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {{nieuwVanaf?: number}} [opties] objectnummers boven deze grens zijn
 *   in deze save aangemaakt (pdfDoc.context.largestObjectNumber na het laden)
 * @returns {{verwijderd: number, hernummerd: number}}
 */
export function ruimOngebruikteObjectenOp(pdfDoc, opties = {}) {
  const stappen = opruimStappen(pdfDoc, opties);
  for (;;) {
    const { done, value } = stappen.next();
    if (done) return value;
  }
}

/**
 * Hetzelfde, met een veilig punt na elke partij objecten: `annulering.punt()`
 * (saver/opslag-annuleren.js) kan daar de save stoppen. Een afgebroken
 * opruimbeurt laat een half opgeruimd pdf-lib-document achter; de saver
 * gooit dat weg, het bestand is dan nog niet aangeraakt.
 * @returns {Promise<{verwijderd: number, hernummerd: number}>}
 */
export async function ruimOngebruikteObjectenOpMetPauzes(pdfDoc, { nieuwVanaf, annulering } = {}) {
  const stappen = opruimStappen(pdfDoc, { nieuwVanaf });
  for (;;) {
    const { done, value } = stappen.next();
    if (done) return value;
    if (annulering) await annulering.punt();
  }
}
