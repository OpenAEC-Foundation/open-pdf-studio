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
//
// Pagina's uitnemen (extractPages in page-manager.js, #880) gebruikt dezelfde
// weg met een vrije lijst pagina's (bouwUittreksel): voorheen kopieerde die
// copyPages rechtstreeks, en sleepte zo via koppelingen andere pagina's mee.
//
// Bytes die nog versleuteld zijn (een beveiligd bestand dat niet via een
// ontsleutelde werkkopie geopend is) kan pdf-lib niet lezen: het kopieert de
// versleutelde stromen in een onversleuteld bestand en elke pagina wordt leeg
// of onleesbaar. laadBron weigert die bytes daarom (code 'encrypted').

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
  if (bron.isEncrypted) {
    throw Object.assign(new Error('The page content is encrypted and cannot be copied'), { code: 'encrypted' });
  }
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

// De pagina's `indexen` (vanaf 0, in deze volgorde) van de bron als nieuw
// document, met de koppelingen en /P teruggezet (zie boven). `extraDraai(j)`
// geeft de draaiing van de app voor de j-de pagina van het nieuwe document.
async function kopieerPaginas(bron, indexen, extraDraai) {
  const uit = await PDFDocument.create();
  const gekopieerd = await uit.copyPages(bron, indexen);
  for (const p of gekopieerd) uit.addPage(p);
  const paginas = uit.getPages();
  const context = uit.context;
  // Bronindex -> plek in het nieuwe document (de eerste, als een pagina vaker komt).
  const plek = new Map();
  indexen.forEach((k, j) => { if (!plek.has(k)) plek.set(k, j); });

  paginas.forEach((pagina, j) => {
    const extra = extraDraai(j);
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
      if (plek.has(k)) dest.set(0, paginas[plek.get(k)].ref);
      else weg.push(ref);
    }
    if (weg.length) {
      const annots = pagina.node.lookup(ANNOTS, PDFArray);
      for (let i = annots.size() - 1; i >= 0; i--) {
        if (weg.includes(annots.get(i))) annots.remove(i);
      }
    }
  });
  return uit;
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
  const indexen = [];
  for (let i = start - 1; i < eind; i++) indexen.push(i);
  const draai = rotatiesVoorDeel(rotaties, start, eind);
  const uit = await kopieerPaginas(bron, indexen, (j) => draai[j + 1]);

  const deelLabels = labelsVoorDeel(labels, start, eind);
  if (deelLabels) schrijfPaginaLabels(uit, deelLabels);
  const deelBladwijzers = bladwijzersVoorDeel(bladwijzers, start, eind);
  if (deelBladwijzers.length) saveBookmarksToOutline(uit, { bookmarks: deelBladwijzers });
  return uit;
}

/**
 * Uitgenomen pagina's (#880): `paginaNummers` (vanaf 1, in deze volgorde) als
 * nieuw PDF-document, met hun annotaties en de draaiing van de app. Een
 * koppeling naar een pagina die meekomt wijst naar die pagina in het nieuwe
 * document; naar een andere pagina valt ze weg (die pagina kwam anders, met
 * al haar inhoud, ongezien mee).
 * @param {PDFDocument} bron  uit laadBron
 * @param {number[]} paginaNummers
 * @param {{ rotaties?: Record<number, number> }} [opties]
 * @returns {Promise<PDFDocument>}
 */
export async function bouwUittreksel(bron, paginaNummers, { rotaties = {} } = {}) {
  const totaal = bron.getPageCount();
  const nummers = (paginaNummers || []).map(Number);
  if (!nummers.length || nummers.some((n) => !Number.isInteger(n) || n < 1 || n > totaal)) {
    throw new RangeError(`Invalid page numbers for a document of ${totaal} pages`);
  }
  const draai = (j) => (((Number(rotaties?.[nummers[j]]) || 0) % 360) + 360) % 360;
  return kopieerPaginas(bron, nummers.map((n) => n - 1), draai);
}

/**
 * De bytes om pagina's uit te nemen (#880). Met niet-opgeslagen wijzigingen
 * de stand die opslaan zou schrijven (`maakMomentopname`, saver.js
 * bouwMomentopname): annotaties, de OCR-tekstlaag, tekstbewerkingen en
 * draaiingen staan nog niet in de opgeslagen bytes, en zonder die stand was
 * een pagina na OCR niet doorzoekbaar en een pagina met alleen nieuwe
 * annotaties leeg. Lukt de momentopname niet (een beveiligd document wordt
 * nooit zo gebouwd), dan de opgeslagen bytes.
 * @param {{ opgeslagen: Uint8Array, gewijzigd?: boolean,
 *           maakMomentopname?: (() => Promise<Uint8Array>)|null }} opties
 * @returns {Promise<{ bytes: Uint8Array, uitApp: boolean }>} uitApp: de
 *   bytes hebben de draaiingen van de app al
 */
export async function bronVoorUittreksel({ opgeslagen, gewijzigd = false, maakMomentopname = null }) {
  if (gewijzigd && typeof maakMomentopname === 'function') {
    try {
      const bytes = await maakMomentopname();
      if (bytes?.length) return { bytes, uitApp: true };
    } catch (e) {
      console.warn('[extract] unsaved changes not included, using the saved bytes:', e?.message || e);
    }
  }
  return { bytes: opgeslagen, uitApp: false };
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
