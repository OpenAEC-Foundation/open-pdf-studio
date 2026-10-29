// Document splitsen (#381): de delen bouwen met pdf-lib.
//
// Elk deel is een kopie van een reeks pagina's (copyPages, zoals
// extractPages in page-manager.js), met:
// - de annotaties van die pagina's (ze reizen mee in /Annots);
// - de draaiing van de app bovenop de eigen /Rotate (zoals de saver dat doet);
// - de paginalabels van die pagina's (/PageLabels, pagina-labels.js);
// - de bladwijzers die in het deel vallen (de bladwijzer-schrijver van de
//   saver, saver/bookmarks.js).
//
// Verwijzingen naar pagina's gaan niet blind mee. pdf-lib kopieert alles waar
// een object naar wijst: een koppeling naar pagina 9 in een deel met de
// pagina's 4-6 zou pagina 9 (met inhoud en bronnen) als losse pagina in het
// bestand slepen, en de /P van elke annotatie een tweede kopie van haar eigen
// pagina. laadBron vervangt daarom in de (eigen, in het geheugen geladen) bron
// elke paginaverwijzing van een koppeling door het paginanummer en haalt /P
// weg; bouwDeel zet ze in het deel terug: naar de pagina in het deel, of de
// koppeling verdwijnt als haar doel buiten het deel ligt.

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFRef, degrees } from 'pdf-lib';
import { schrijfPaginaLabels } from './pagina-labels.js';
import { saveBookmarksToOutline } from './saver/bookmarks.js';
import {
  bereikenPerAantal, bereikenOpBladwijzers, bereikenOpGrootte, bereikenUitDelen,
  bladwijzersVoorDeel, labelsVoorDeel, rotatiesVoorDeel,
} from './splits-logica.js';

const ANNOTS = PDFName.of('Annots');
const P = PDFName.of('P');
const POPUP = PDFName.of('Popup');
const DEST = PDFName.of('Dest');
const A = PDFName.of('A');
const S = PDFName.of('S');
const D = PDFName.of('D');
const B = PDFName.of('B');
const GOTO = PDFName.of('GoTo');
// Merkt een bestemming waarvan het eerste element een paginanummer werd.
const MERK = PDFName.of('OPDS_SplitDest');

function annotatiesVan(context, pagina) {
  const annots = pagina.node.lookup(ANNOTS);
  if (!(annots instanceof PDFArray)) return [];
  return annots.asArray()
    .map((r) => ({ ref: r, dict: context.lookup(r) }))
    .filter((a) => a.dict instanceof PDFDict);
}

// De bestemmingsreeks van een koppeling: /Dest, of /D van een GoTo-actie.
function bestemmingVan(annot) {
  const dest = annot.lookup(DEST);
  if (dest instanceof PDFArray) return dest;
  const actie = annot.lookup(A);
  if (actie instanceof PDFDict && actie.get(S) === GOTO) {
    const d = actie.lookup(D);
    if (d instanceof PDFArray) return d;
  }
  return null;
}

/**
 * De bron voor het splitsen: de bytes geladen en de paginaverwijzingen
 * losgemaakt (zie boven). Alleen deze kopie in het geheugen verandert.
 * @param {Uint8Array} bytes
 * @returns {Promise<PDFDocument>}
 */
export async function laadBron(bytes) {
  const bron = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const context = bron.context;
  const paginas = bron.getPages();
  const index = new Map(paginas.map((p, i) => [p.ref, i]));
  for (const pagina of paginas) {
    // Kralen (artikeldraden) wijzen naar andere pagina's; ze gaan niet mee.
    pagina.node.delete(B);
    for (const { dict } of annotatiesVan(context, pagina)) {
      dict.delete(P);
      const popup = dict.lookup(POPUP);
      if (popup instanceof PDFDict) popup.delete(P);
      const dest = bestemmingVan(dict);
      const doel = dest ? dest.get(0) : null;
      if (doel instanceof PDFRef && index.has(doel)) {
        dest.set(0, PDFNumber.of(index.get(doel)));
        dict.set(MERK, PDFNumber.of(1));
      }
    }
  }
  return bron;
}

/**
 * Eén deel (pagina's `start` t/m `eind`, vanaf 1) als nieuw PDF-document.
 * @param {PDFDocument} bron  uit laadBron
 * @param {{ start:number, eind:number, rotaties?:Record<number, number>,
 *           labels?:string[]|null, bladwijzers?:object[] }} opties
 *   rotaties: de draaiing van de app per paginanummer van het hele document;
 *   labels: doc.pageLabels van het hele document; bladwijzers: doc.bookmarks.
 * @returns {Promise<PDFDocument>}
 */
export async function bouwDeel(bron, { start, eind, rotaties = {}, labels = null, bladwijzers = [] }) {
  const uit = await PDFDocument.create();
  const indexen = [];
  for (let i = start - 1; i < eind; i++) indexen.push(i);
  const gekopieerd = await uit.copyPages(bron, indexen);
  for (const p of gekopieerd) uit.addPage(p);
  const paginas = uit.getPages();
  const context = uit.context;

  const draai = rotatiesVoorDeel(rotaties, start, eind);
  paginas.forEach((pagina, j) => {
    const extra = draai[j + 1];
    if (extra) pagina.setRotation(degrees((pagina.getRotation().angle + extra) % 360));

    const weg = [];
    for (const { ref, dict } of annotatiesVan(context, pagina)) {
      dict.set(P, pagina.ref);
      const popup = dict.lookup(POPUP);
      if (popup instanceof PDFDict) popup.set(P, pagina.ref);
      if (!dict.has(MERK)) continue;
      dict.delete(MERK);
      const dest = bestemmingVan(dict);
      const doel = dest ? dest.get(0) : null;
      if (doel instanceof PDFRef) continue; // al gezet via een gedeelde bestemming
      const k = doel instanceof PDFNumber ? doel.asNumber() : -1;
      if (k >= start - 1 && k <= eind - 1) dest.set(0, paginas[k - (start - 1)].ref);
      else weg.push(ref);
    }
    if (weg.length) {
      const annots = pagina.node.lookup(ANNOTS, PDFArray);
      for (let i = annots.size() - 1; i >= 0; i--) {
        if (weg.includes(annots.get(i))) annots.remove(i);
      }
    }
  });

  const deelLabels = labelsVoorDeel(labels, start, eind);
  if (deelLabels) schrijfPaginaLabels(uit, deelLabels);
  const deelBladwijzers = bladwijzersVoorDeel(bladwijzers, start, eind);
  if (deelBladwijzers.length) saveBookmarksToOutline(uit, { bookmarks: deelBladwijzers });
  return uit;
}

/** De bytes van één deel (zie bouwDeel). */
export async function deelBytes(bron, opties) {
  return new Uint8Array(await (await bouwDeel(bron, opties)).save());
}

/**
 * Welke pagina's samen een deel worden.
 * @param {PDFDocument} bron
 * @param {{ modus:'pages'|'bookmarks'|'size'|'ranges', n?:number, maxBytes?:number,
 *           delen?:{start:number, eind:number}[],
 *           bladwijzers?:object[], rotaties?:object, labels?:string[]|null }} opties
 *   modus 'ranges': de delen staan al vast (`delen`, de splitsmarkeringen van
 *   Pagina's bewerken, #764)
 * @returns {Promise<{start:number, eind:number, titel?:string|null, teGroot?:boolean}[]>}
 */
export async function berekenDelen(bron, { modus, n = 1, maxBytes = 0, delen = [], bladwijzers = [], rotaties = {}, labels = null }) {
  const totaal = bron.getPageCount();
  if (modus === 'ranges') return bereikenUitDelen(delen, totaal);
  if (modus === 'bookmarks') return bereikenOpBladwijzers(bladwijzers, totaal);
  if (modus === 'size') {
    return bereikenOpGrootte(totaal, maxBytes, async (start, eind) => (
      await deelBytes(bron, { start, eind, rotaties, labels, bladwijzers })
    ).length);
  }
  return bereikenPerAantal(totaal, n);
}

/**
 * Alle delen op volgorde. Zonder `schrijf` komen de bytes in de uitkomst; met
 * `schrijf(deel, bytes, index)` gaat elk deel meteen weg en houdt het geheugen
 * nooit meer dan één deel vast. `voortgang(klaar, totaal)` na elk deel.
 * @returns {Promise<Array<{start:number, eind:number, titel?:string|null, teGroot?:boolean, bytes?:Uint8Array}>>}
 */
export async function maakDelen(bron, delen, {
  rotaties = {}, labels = null, bladwijzers = [], voortgang = () => {}, schrijf = null,
} = {}) {
  const uit = [];
  for (const [i, deel] of delen.entries()) {
    const bytes = await deelBytes(bron, { start: deel.start, eind: deel.eind, rotaties, labels, bladwijzers });
    if (schrijf) {
      await schrijf(deel, bytes, i);
      uit.push({ ...deel });
    } else {
      uit.push({ ...deel, bytes });
    }
    voortgang(i + 1, delen.length);
  }
  return uit;
}
