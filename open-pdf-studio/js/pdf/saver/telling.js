// De telmarkering van de app opslaan (#621).
//
// Een telmarkering (type 'count') is één genummerde stip. De saver kende de
// soort niet: bij opslaan verdween hij zonder melding. Hij gaat nu als /Circle
// het bestand in, met een appearance die hem tekent zoals het scherm (stip,
// witte rand, het volgnummer erin), zodat elke lezer hem ziet. Nummer,
// categorie (groep + groepsnaam, #935) en markeringsstijl staan in eigen sleutels; de lader maakt er
// weer een telmarkering van (/OPS_Subtype count).
//
// Alleen pdf-lib: ook in node te testen.

import { PDFName, PDFString } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';
import { hexToRgb } from './utils.js';
import { TELSTIP_STRAAL } from '../../annotations/telling.js';

const getal = (v) => String(Math.round(v * 1e4) / 1e4 || 0);

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {object} ann  het model, al omgerekend naar de ongedraaide pagina
 * @param {(x:number)=>number} X
 * @param {(y:number)=>number} Y
 * @param {{ opacity?: number, flags?: number }} opties
 */
export function bouwTellingDict(context, ann, X, Y, { opacity = 1, flags = 4 } = {}) {
  const r = TELSTIP_STRAAL;
  const cx = X(ann.x);
  const cy = Y(ann.y);
  const rect = [cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1];
  const kleur = hexToRgb(ann.color || ann.strokeColor || '#e11d48');
  const dict = context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: rect,
    C: kleur,
    IC: kleur,
    CA: opacity,
    T: pdfTextString(ann.author || 'User'),
    Contents: pdfTextString(ann.subject || ''),
    M: PDFString.fromDate(new Date()),
    F: flags,
    BS: context.obj({ W: 1.5, S: PDFName.of('S') }),
    OPS_Subtype: PDFString.of('count'),
  });
  if (Number.isFinite(ann.number)) dict.set(PDFName.of('OPS_CountNumber'), context.obj(ann.number));
  if (ann.categoryId) dict.set(PDFName.of('OPS_CountCategory'), pdfTextString(String(ann.categoryId)));
  // Groepsnaam (#935): de groep komt bij heropenen terug met haar naam.
  if (ann.categoryId && ann.categoryName) dict.set(PDFName.of('OPS_CountCategoryName'), pdfTextString(String(ann.categoryName)));
  if (ann.markerStyle) dict.set(PDFName.of('OPS_MarkerStyle'), pdfTextString(String(ann.markerStyle)));
  if (ann.symbolId) dict.set(PDFName.of('OPS_SymbolId'), pdfTextString(String(ann.symbolId)));

  // Appearance in de eigen ruimte: oorsprong linksonder van /Rect.
  const k = 0.5522847498;
  const m = r + 1; // midden
  const cirkel = (straal) => `${getal(m + straal)} ${getal(m)} m `
    + `${getal(m + straal)} ${getal(m + k * straal)} ${getal(m + k * straal)} ${getal(m + straal)} ${getal(m)} ${getal(m + straal)} c `
    + `${getal(m - k * straal)} ${getal(m + straal)} ${getal(m - straal)} ${getal(m + k * straal)} ${getal(m - straal)} ${getal(m)} c `
    + `${getal(m - straal)} ${getal(m - k * straal)} ${getal(m - k * straal)} ${getal(m - straal)} ${getal(m)} ${getal(m - straal)} c `
    + `${getal(m + k * straal)} ${getal(m - straal)} ${getal(m + straal)} ${getal(m - k * straal)} ${getal(m + straal)} ${getal(m)} c h `;
  const [kr, kg, kb] = kleur.map(getal);
  let inhoud = `q ${kr} ${kg} ${kb} rg ${cirkel(r)}f Q\n`;
  const resources = {};
  if (ann.markerStyle !== 'symbol') {
    inhoud += `q 1 1 1 RG 1.5 w ${cirkel(r)}S Q\n`;
    const tekst = String(ann.number ?? '');
    if (tekst) {
      // Helvetica-cijfers zijn 0,556 em breed.
      const grootte = Math.round(r * 1.3);
      const breedte = tekst.length * 0.556 * grootte;
      inhoud += `BT 1 1 1 rg /HelvB ${grootte} Tf ${getal(m - breedte / 2)} ${getal(m - grootte * 0.35)} Td (${tekst.replace(/[()\\]/g, '')}) Tj ET\n`;
      resources.Font = context.obj({
        HelvB: context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica-Bold', Encoding: 'WinAnsiEncoding' }),
      });
    }
  }
  const stroom = context.stream(inhoud, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 2 * m, 2 * m], Resources: context.obj(resources),
  });
  dict.set(PDFName.of('AP'), context.obj({ N: context.register(stroom) }));
  return dict;
}

/** Het model van een telmarkering uit een opgeslagen /Circle, of null. */
export function tellingUitExtra(extra, rect) {
  const e = extra || {};
  if (e.opsSubtype !== 'count' || !rect) return null;
  return {
    type: 'count',
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    number: Number.isFinite(e.opsCountNumber) ? e.opsCountNumber : undefined,
    categoryId: e.opsCountCategory || null,
    ...(e.opsCountCategory && e.opsCountCategoryName ? { categoryName: e.opsCountCategoryName } : {}),
    markerStyle: e.opsMarkerStyle === 'symbol' ? 'symbol' : 'dot',
    ...(e.opsSymbolId ? { symbolId: e.opsSymbolId } : {}),
  };
}
