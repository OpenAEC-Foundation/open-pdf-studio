// Kop- en voetteksten in het bestand (#375).
//
// Een kop-/voettekst wordt pagina-inhoud, zichtbaar in elke lezer. Per pagina
// krijgt elke kop-/voettekst een eigen content stream met /OPS_KopVoet (id) in
// het stream-woordenboek. Zo vindt een volgende save hem terug en vervangt hem,
// in plaats van er bij elke save nog een exemplaar overheen te zetten. De
// definities staan als JSON in de catalogus (/OPS_KopVoet), zodat ze na
// heropenen weer in de lijst staan en te bewerken zijn.
//
// Puur pdf-lib, geen app-imports: zo is het in node te testen.

import {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFString, PDFHexString, PDFOperator, PDFOperatorNames,
  StandardFonts, rgb, degrees, drawText, concatTransformationMatrix, pushGraphicsState, popGraphicsState,
  endMarkedContent,
} from 'pdf-lib';
import { removeWatermarkStreams } from './watermark-content.js';
import { toWinAnsiText } from './pdf-text.js';
import { KOPVOET_VAKKEN, vakPositie, vulKopVoetIn, kopVoetWaarden, toegepastePaginas } from '../../watermark/kopvoet-tekst.js';

export const KOPVOET_SLEUTEL = 'OPS_KopVoet';
const FONT_SLEUTEL = 'OPS_KopVoetFont';

// De velden van een definitie die in het bestand mee gaan.
const VELDEN = ['id', 'headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight',
  'fontFamily', 'fontSize', 'color', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'pageRange', 'customPages', 'enabled', 'batesPrefix', 'batesStart', 'batesDigits', 'batesSuffix'];

const tekstVan = (obj) => (obj instanceof PDFHexString || obj instanceof PDFString ? obj.decodeText() : null);

function kopVoetIdVan(context, ref) {
  const stroom = context.lookup(ref);
  if (!(stroom instanceof PDFStream)) return null;
  return tekstVan(stroom.dict.lookup(PDFName.of(KOPVOET_SLEUTEL)));
}

function inhoudVan(page) {
  const inhoud = page.node.get(PDFName.of('Contents'));
  const lijst = page.node.context.lookup(inhoud);
  return lijst instanceof PDFArray ? lijst : null;
}

/** De ids van de kop-/voetteksten die als stream in de pagina's staan. */
export function vindKopVoetIds(pdfDoc) {
  const ids = new Set();
  for (const page of pdfDoc.getPages()) {
    const lijst = inhoudVan(page);
    if (!lijst) continue;
    for (let i = 0; i < lijst.size(); i++) {
      const id = kopVoetIdVan(pdfDoc.context, lijst.get(i));
      if (id !== null) ids.add(id);
    }
  }
  return ids;
}

/**
 * Haalt de kop-/voettekst-streams uit alle pagina's: alleen die met een id uit
 * `ids`, of alle als `ids` null is. Ook het font dat er per pagina bij kwam
 * gaat uit de resources. Geeft het aantal verwijderde streams.
 */
export function verwijderKopVoetStromen(pdfDoc, ids = null) {
  const { context } = pdfDoc;
  let verwijderd = 0;
  if (ids && !ids.size) return 0;
  for (const page of pdfDoc.getPages()) {
    const lijst = inhoudVan(page);
    if (!lijst) continue;
    const resources = context.lookup(page.node.getInheritableAttribute(PDFName.of('Resources')));
    const fonts = resources instanceof PDFDict ? resources.lookup(PDFName.of('Font')) : null;
    for (let i = lijst.size() - 1; i >= 0; i--) {
      const ref = lijst.get(i);
      const id = kopVoetIdVan(context, ref);
      if (id === null || (ids && !ids.has(id))) continue;
      const font = context.lookup(ref).dict.lookup(PDFName.of(FONT_SLEUTEL));
      if (font instanceof PDFName && fonts instanceof PDFDict) fonts.delete(font);
      lijst.remove(i);
      if (ref instanceof PDFRef) context.delete(ref);
      verwijderd++;
    }
  }
  return verwijderd;
}

/** De definities uit de catalogus; ongeldige worden overgeslagen. */
export function leesKopVoetDefinities(pdfDoc) {
  try {
    const tekst = tekstVan(pdfDoc.catalog.lookup(PDFName.of(KOPVOET_SLEUTEL)));
    const lijst = tekst ? JSON.parse(tekst) : [];
    if (!Array.isArray(lijst)) return [];
    return lijst.filter((d) => d && typeof d === 'object' && typeof d.id === 'string' && d.id)
      .map((d) => ({ ...Object.fromEntries(VELDEN.filter((v) => d[v] !== undefined).map((v) => [v, d[v]])), type: 'headerFooter' }));
  } catch {
    return [];
  }
}

/** Schrijft de definities in de catalogus, of haalt de sleutel weg als er geen zijn. */
export function schrijfKopVoetDefinities(pdfDoc, definities) {
  const sleutel = PDFName.of(KOPVOET_SLEUTEL);
  if (!definities?.length) { pdfDoc.catalog.delete(sleutel); return; }
  const schoon = definities.map((d) => Object.fromEntries(VELDEN.filter((v) => d[v] !== undefined).map((v) => [v, d[v]])));
  pdfDoc.catalog.set(sleutel, PDFHexString.fromText(JSON.stringify(schoon)));
}

function standaardFont(familie) {
  const f = String(familie || '').toLowerCase();
  if (f.includes('courier')) return StandardFonts.Courier;
  if (f.includes('times')) return StandardFonts.TimesRoman;
  return StandardFonts.Helvetica;
}

function kleurVan(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0, 0, 0);
}

// Van weergaveruimte (punten vanaf linksonder van de pagina zoals hij getoond
// wordt, ná /Rotate) naar de gebruikersruimte van de pagina.
function weergaveMatrix(rotatie, vak) {
  const { x, y, width: w, height: h } = vak;
  switch (rotatie) {
    case 90: return [0, 1, -1, 0, x + w, y];
    case 180: return [-1, 0, 0, -1, x + w, y + h];
    case 270: return [0, -1, 1, 0, x, y + h];
    default: return [1, 0, 0, 1, x, y];
  }
}

const markering = (rij, context) => PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
  PDFName.of('Artifact'),
  context.obj({ Type: 'Pagination', Subtype: rij === 'kop' ? 'Header' : 'Footer' }),
]);

/**
 * Zet alle ingeschakelde kop-/voetteksten op de pagina's. Bestaande streams van
 * de ids in `vervang` gaan eerst weg (zie verwijderKopVoetStromen). In de
 * catalogus komen de definities van alle kop-/voetteksten (ook uitgeschakelde,
 * die na heropenen weer aan te zetten zijn), samen met `behouden`: definities
 * van streams die blijven staan.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {object[]} kopVoeten  headerFooter-definities uit doc.watermarks
 * @param {{ vervang?: Set<string>|null, behouden?: object[], bestandsnaam?: string,
 *           titel?: string, nu?: Date, paginaBereik: Function }} opties
 * @returns {Promise<{ geschreven: string[], streams: number }>} geschreven: de ids
 *   die nu op minstens één pagina staan
 */
export async function schrijfKopVoeten(pdfDoc, kopVoeten, opties) {
  const { vervang = null, behouden = [], bestandsnaam = '', titel = '', nu = new Date(), paginaBereik } = opties;
  verwijderKopVoetStromen(pdfDoc, vervang);
  const pages = pdfDoc.getPages();
  const totaal = pages.length;
  const { context } = pdfDoc;
  const fonts = new Map();
  let streams = 0;
  const geschreven = [];
  const definities = [];

  for (const wm of kopVoeten) {
    if (wm?.type !== 'headerFooter' || !wm.id) continue;
    definities.push(wm);
    if (!wm.enabled) continue;
    const toegepast = toegepastePaginas(wm, totaal, paginaBereik);
    const fontNaam = standaardFont(wm.fontFamily);
    if (!fonts.has(fontNaam)) fonts.set(fontNaam, await pdfDoc.embedFont(fontNaam));
    const font = fonts.get(fontNaam);
    const grootte = wm.fontSize || 10;
    const kleur = kleurVan(wm.color || '#000000');
    let opPagina = false;

    for (const pagina of toegepast) {
      const page = pages[pagina - 1];
      if (!page) continue;
      const rotatie = ((page.getRotation().angle % 360) + 360) % 360;
      const vak = page.getCropBox();
      const kwart = rotatie === 90 || rotatie === 270;
      const breedte = kwart ? vak.height : vak.width;
      const hoogte = kwart ? vak.width : vak.height;
      const waarden = kopVoetWaarden(wm, { pagina, paginas: totaal, toegepast, bestandsnaam, titel, nu });

      // Eerst de teksten: een pagina zonder tekst krijgt geen stream en geen font.
      const regels = [];
      for (const vakDef of KOPVOET_VAKKEN) {
        // Standaardfonts zijn WinAnsi: tekens daarbuiten worden een zichtbare vervanger.
        const tekst = toWinAnsiText(vulKopVoetIn(wm[vakDef.sleutel], waarden), { newlines: 'space' });
        if (!tekst.trim()) continue;
        const { x, basislijn } = vakPositie(wm, vakDef, breedte, hoogte);
        const tw = font.widthOfTextAtSize(tekst, grootte);
        const links = vakDef.uitlijning === 'center' ? x - tw / 2 : vakDef.uitlijning === 'right' ? x - tw : x;
        regels.push({ rij: vakDef.rij, tekst, x: links, y: hoogte - basislijn });
      }
      if (!regels.length) continue;

      const fontSleutel = page.node.newFontDictionary(font.name, font.ref);
      const ops = [pushGraphicsState(), concatTransformationMatrix(...weergaveMatrix(rotatie, vak))];
      for (const rij of ['kop', 'voet']) {
        const vanRij = regels.filter((r) => r.rij === rij);
        if (!vanRij.length) continue;
        ops.push(markering(rij, context));
        for (const r of vanRij) {
          ops.push(...drawText(font.encodeText(r.tekst), {
            color: kleur, font: fontSleutel, size: grootte, rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0),
            x: r.x, y: r.y,
          }));
        }
        ops.push(endMarkedContent());
      }
      ops.push(popGraphicsState());
      const ref = context.register(context.contentStream(ops, {
        [KOPVOET_SLEUTEL]: PDFHexString.fromText(wm.id),
        [FONT_SLEUTEL]: fontSleutel,
      }));
      page.node.addContentStream(ref);
      streams++;
      opPagina = true;
    }
    if (opPagina) geschreven.push(wm.id);
  }

  schrijfKopVoetDefinities(pdfDoc, [...behouden, ...definities]);
  return { geschreven, streams };
}

/**
 * De bytes zonder eigen kop-/voettekst- en watermerkstreams, voor de weergave: het scherm tekent
 * de kop-/voetteksten zelf (watermark-renderer.js). Zonder streams komen de
 * bytes ongewijzigd terug.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function zonderKopVoetStromen(bytes) {
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const removed = verwijderKopVoetStromen(pdfDoc, null) + removeWatermarkStreams(pdfDoc);
  if (!removed) return bytes;
  return new Uint8Array(await pdfDoc.save());
}
