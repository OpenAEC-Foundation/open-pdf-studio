// Gedeelde /Resources blijven gedeeld.
//
// Veel tekeningensets (publicatie uit een CAD-programma) geven alle pagina's
// één /Resources-woordenboek: een verwijzing op elke pagina, of geërfd van de
// paginaboom. pdf-lib's PDFPageLeaf.normalize() (elke drawText, addContentStream,
// newFontDictionary, ...) zoekt dat woordenboek op en zet het als DIRECT object
// op de pagina. Bij het opslaan schrijft elke pagina dan een eigen kopie, en
// zet elke pagina daarna nog een sleutel in hetzelfde woordenboek, dan bevat
// elke kopie alle sleutels van alle pagina's: het bestand groeit kwadratisch
// met het aantal pagina's.
//
// Twee bouwstenen:
// - vasteResourceSleutel: één sleutel per kop-/voettekst of watermerk in
//   plaats van een nieuwe willekeurige per pagina (newFontDictionary).
// - deelResourcesWeer: vlak voor het opslaan krijgen pagina's die hetzelfde
//   woordenboek-object als direct /Resources hebben weer één verwijzing.
//
// Puur pdf-lib, geen app-imports: zo is het in node te testen.

import { PDFName, PDFDict } from 'pdf-lib';

const RESOURCES = PDFName.of('Resources');

/**
 * Een vaste, geldige PDF-naam voor een resource van één definitie, bijv.
 * `OPSKV_wm-test` voor kop-/voettekst `wm-test`. Alleen [A-Za-z0-9_-] blijven
 * staan; zo hoeft er niets ge-escaped te worden en is de naam bij elke save
 * dezelfde.
 */
export function vasteResourceSleutel(voorvoegsel, id) {
  return PDFName.of(`${voorvoegsel}_${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}`);
}

/**
 * Zet `waarde` onder `sleutel` in de categorie (`Font`, `XObject`,
 * `ExtGState`) van de /Resources van de pagina. Gedeelde woordenboeken krijgen
 * de sleutel zo maar één keer, hoeveel pagina's er ook naar verwijzen.
 */
export function zetPaginaResource(page, categorie, sleutel, waarde) {
  // normalizedEntries() maakt Font, XObject en ExtGState aan als ze ontbreken.
  const dict = page.node.normalizedEntries()[categorie];
  dict.set(sleutel, waarde);
  return sleutel;
}

/**
 * Pagina's die hetzelfde /Resources-woordenboek als direct object dragen
 * (door normalize() van een gedeeld woordenboek) krijgen weer één indirecte
 * verwijzing; het oorspronkelijke objectnummer wordt hergebruikt als het
 * woordenboek er een had. Geeft het aantal pagina's terug dat weer deelt.
 */
export function deelResourcesWeer(pdfDoc) {
  const pages = pdfDoc.getPages();
  const aantal = new Map();
  for (const page of pages) {
    const waarde = page.node.get(RESOURCES);
    if (waarde instanceof PDFDict) aantal.set(waarde, (aantal.get(waarde) || 0) + 1);
  }
  const verwijzingen = new Map();
  for (const [dict, n] of aantal) {
    if (n < 2) continue;
    verwijzingen.set(dict, pdfDoc.context.getObjectRef(dict) ?? pdfDoc.context.register(dict));
  }
  if (!verwijzingen.size) return 0;
  let gedeeld = 0;
  for (const page of pages) {
    const ref = verwijzingen.get(page.node.get(RESOURCES));
    if (!ref) continue;
    page.node.set(RESOURCES, ref);
    gedeeld++;
  }
  return gedeeld;
}
