// PDF-woordenboeken van proefleescorrecties (#508): invoegteken (/Caret),
// doorhaling als tekstcorrectie (/StrikeOut /IT /StrikeOutTextEdit) en de
// koppeling van een vervanging (doorhaling met /IRT naar het invoegteken en
// /RT /Group).
//
// Omrekenen gebeurt per PUNT: paginapunt -> _rotVisualMapper -> CropBox. Een
// quad of glyph wordt na het omrekenen nooit opnieuw als assen-uitgelijnd vak
// opgebouwd, zodat de volgorde begin-boven, eind-boven, begin-onder,
// eind-onder op elke /Rotate bij de tekst blijft.
//
// Elke correctie krijgt een /AP: pdf.js maakt van elke quad een assen-
// uitgelijnd vak en tekent dan een horizontale lijn (fout op /Rotate 90/270),
// en kent geen terugvaluiterlijk voor een /Caret. De appearance is een Form
// XObject met /BBox [0 0 w h] zonder /Matrix; de inhoud staat in
// gebruikersruimte min (llx, lly), dus de paginarotatie zit al in de punten.
//
// Alleen pdf-lib en pure modules: ook in node te testen.

import { PDFName, PDFString, PDFNumber, PDFRef, PDFDict } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';
import { _rotVisualMapper } from './rotatie-mapper.js';
import {
  quadCorners, quadMidline, quadUnderline, quadSquiggle, caretGlyphPoints, normTextDir,
} from '../../annotations/corrections/geometry.js';

const N = (naam) => PDFName.of(naam);

// Vier decimalen: genoeg voor 0,0001 pt, geen exponent-notatie in de stream.
const rond = (v) => (Math.round(v * 1e4) / 1e4) || 0;
const getal = (v) => String(rond(v));

/** ISO-datum naar een PDF-datum (D:JJJJMMDDUUmmSS, UTC). Onbruikbaar wordt nu. */
export function pdfDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return PDFString.fromDate(Number.isNaN(d.getTime()) ? new Date() : d);
}

/**
 * Punt in de paginaruimte van de app (getoonde pagina, y omlaag) naar
 * PDF-gebruikersruimte. Gelijk aan convertX/convertY van de saver na
 * _rotVisualMapper.
 * @param {number} pageRot  totale /Rotate van de pagina bij het opslaan
 * @param {{x:number,y:number,width:number,height:number}} cropBox
 */
export function makePointMapper(pageRot, cropBox) {
  const m = _rotVisualMapper(pageRot || 0, cropBox.width, cropBox.height);
  return (x, y) => {
    const p = m(x, y);
    return { x: p.x + cropBox.x, y: cropBox.y + cropBox.height - p.y };
  };
}

/**
 * Quads per tekstregel in gebruikersruimte, in tekstvolgorde.
 * @returns {Array<Array<{x:number,y:number}>>}  per regel [p1, p2, p3, p4]
 */
export function buildStrikeQuads(rects, textDir, map) {
  return (rects || []).map((r) => quadCorners(r, textDir).map((p) => {
    const u = map(p.x, p.y);
    return { x: rond(u.x), y: rond(u.y) };
  }));
}

function omhullende(punten, marge) {
  const xs = punten.map((p) => p.x);
  const ys = punten.map((p) => p.y);
  return [
    rond(Math.min(...xs) - marge), rond(Math.min(...ys) - marge),
    rond(Math.max(...xs) + marge), rond(Math.max(...ys) + marge),
  ];
}

function vormStream(context, rect, inhoud, resources) {
  const [llx, lly, urx, ury] = rect;
  const stream = context.stream(inhoud, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, rond(urx - llx), rond(ury - lly)],
    Resources: resources || context.obj({}),
  });
  return context.register(stream);
}

const kleur = (rgb) => (rgb || [0, 0, 0]).slice(0, 3).map(getal).join(' ');

// Punten als pad, relatief aan (llx, lly): het eerste met m, de rest met l.
const pad = (punten, llx, lly) => punten
  .map((p, i) => `${getal(p.x - llx)} ${getal(p.y - lly)} ${i === 0 ? 'm' : 'l'}`).join(' ');

// Lijn per quad en lijnstijl per soort. De kronkellijn krijgt ronde hoeken:
// een scherpe hoek steekt verder uit dan de halve lijndikte rond /Rect.
const LIJN_PER_SOORT = {
  StrikeOut: { lijn: quadMidline, stijl: '0 J' },
  Underline: { lijn: quadUnderline, stijl: '0 J' },
  Squiggly: { lijn: quadSquiggle, stijl: '0 J 1 j' },
};

/**
 * Appearance van een tekstmarkering langs haar quads (gebruikersruimte, per
 * quad begin-boven, eind-boven, begin-onder, eind-onder):
 * - StrikeOut: per quad de lijn van mid(p1,p3) naar mid(p2,p4), dezelfde lijn
 *   die pdf.js als terugval tekent;
 * - Underline: de onderrand, 1 pt naar boven, zoals het scherm (#527);
 * - Squiggly: een zigzag langs de onderrand (#527);
 * - Highlight: alle quads in één vulling met /BM /Multiply, zoals de
 *   markeerlaag op het scherm (mix-blend-mode: multiply) (#527).
 * /Rect is de omhullende van alle quads, bij een lijn plus een halve
 * lijndikte. De doorzichtigheid zet de saver er daarna in
 * (zetDoorzichtigheidInAp).
 * @param {'Highlight'|'Underline'|'StrikeOut'|'Squiggly'} subtype
 * @returns {{ rect: number[], apRef: PDFRef }}
 */
export function buildMarkupAppearance(context, quads, subtype, rgb, lw = 1) {
  if (subtype === 'Highlight') {
    const rect = omhullende(quads.flat(), 0);
    const [llx, lly] = rect;
    const vlakken = quads.map((q) => `${pad([q[0], q[1], q[3], q[2]], llx, lly)} h`);
    const inhoud = `q /GSm gs ${kleur(rgb)} rg ${vlakken.join(' ')} f Q`;
    const resources = context.obj({
      ExtGState: context.obj({ GSm: context.obj({ Type: 'ExtGState', BM: 'Multiply' }) }),
    });
    return { rect, apRef: vormStream(context, rect, inhoud, resources) };
  }
  const { lijn, stijl } = LIJN_PER_SOORT[subtype] || LIJN_PER_SOORT.StrikeOut;
  const rect = omhullende(quads.flat(), lw / 2);
  const [llx, lly] = rect;
  const lijnen = quads.map((q) => pad(lijn(q), llx, lly));
  const inhoud = `q ${kleur(rgb)} RG ${getal(lw)} w ${stijl} [] 0 d ${lijnen.join(' ')} S Q`;
  return { rect, apRef: vormStream(context, rect, inhoud) };
}

/**
 * Appearance van een doorhaling (zie buildMarkupAppearance).
 * @returns {{ rect: number[], apRef: PDFRef }}
 */
export function buildStrikeAppearance(context, quads, rgb, lw = 1) {
  return buildMarkupAppearance(context, quads, 'StrikeOut', rgb, lw);
}

/**
 * /IT, /Subj, /NM, de datums, /OPS_TextDir en /OPS_MarkedText van een
 * correctie. /OPS_TextDir is de leesrichting in de ONGEDRAAIDE pagina:
 * (textDir - pageRot) mod 360. De doorgehaalde tekst staat alleen in
 * /OPS_MarkedText, nooit in /Contents.
 * /NM moet per pagina uniek zijn: met `gebruikteNm` (de namen die al op de
 * pagina staan) valt een kopie die de naam van het origineel meedraagt terug
 * op haar eigen id.
 * @param {Set<string>} [gebruikteNm]
 */
export function addTextEditKeys(dict, ann, pageRot, gebruikteNm) {
  if (ann.intent) dict.set(N('IT'), N(String(ann.intent)));
  const subj = ann.pdfSubject ?? (ann.type === 'caret' ? 'Inserted Text' : 'Cross-Out');
  if (subj) dict.set(N('Subj'), pdfTextString(subj));
  let nm = ann.nm;
  if (!nm || gebruikteNm?.has(String(nm))) nm = ann.id;
  if (nm !== undefined && nm !== null && nm !== '') {
    gebruikteNm?.add(String(nm));
    dict.set(N('NM'), pdfTextString(String(nm)));
  }
  dict.set(N('CreationDate'), pdfDate(ann.createdAt));
  dict.set(N('M'), pdfDate(ann.modifiedAt));
  dict.set(N('OPS_TextDir'), PDFNumber.of(normTextDir((ann.textDir ?? 0) - (pageRot || 0))));
  if (typeof ann.markedText === 'string' && ann.markedText) {
    dict.set(N('OPS_MarkedText'), pdfTextString(ann.markedText));
  }
}

/**
 * Een geladen markering krijgt /IT, /NM en /Subj terug, maar alleen als het
 * model ze heeft; markeringen uit de app zelf blijven byte-gelijk. Een /NM die
 * al op de pagina staat (een kopie) wordt niet nog eens geschreven.
 * @param {Set<string>} [gebruikteNm]
 */
export function addLoadedMarkupKeys(dict, ann, gebruikteNm) {
  if (ann.intent) dict.set(N('IT'), N(String(ann.intent)));
  if (ann.nm && !gebruikteNm?.has(String(ann.nm))) {
    gebruikteNm?.add(String(ann.nm));
    dict.set(N('NM'), pdfTextString(String(ann.nm)));
  }
  if (ann.pdfSubject) dict.set(N('Subj'), pdfTextString(String(ann.pdfSubject)));
}

/**
 * Doorhaling als tekstcorrectie (schrappen, of het kind van een vervanging).
 * De quads komen uit de NIET omgerekende annotatie (paginaruimte van de app).
 * Een gekoppeld kind krijgt geen /Contents.
 * @param {object} ann
 * @param {(x:number,y:number)=>{x:number,y:number}} map  uit makePointMapper
 * @param {{ rgb: number[], opacity?: number, pageRot?: number, flags?: number, linked?: boolean, gebruikteNm?: Set<string> }} opties
 */
export function buildTextEditStrikeDict(context, ann, map, { rgb, opacity = 1, pageRot = 0, flags = 4, linked = false, gebruikteNm } = {}) {
  const rects = Array.isArray(ann.rects) && ann.rects.length > 0
    ? ann.rects : [{ x: ann.x, y: ann.y, width: ann.width, height: ann.height }];
  const quads = buildStrikeQuads(rects, ann.textDir ?? 0, map);
  const lw = ann.lineWidth > 0 ? ann.lineWidth : 1;
  const { rect, apRef } = buildStrikeAppearance(context, quads, rgb, lw);
  const dict = context.obj({
    Type: 'Annot',
    Subtype: 'StrikeOut',
    Rect: rect,
    QuadPoints: quads.flatMap((q) => q.flatMap((p) => [p.x, p.y])),
    C: rgb,
    CA: opacity,
    F: flags,
    T: pdfTextString(ann.author || 'User'),
  });
  if (!linked) dict.set(N('Contents'), pdfTextString(ann.subject || ''));
  addTextEditKeys(dict, ann, pageRot, gebruikteNm);
  dict.set(N('AP'), context.obj({ N: apRef }));
  return dict;
}

/**
 * Invoegteken. /Rect is het glyphvak; de appearance vult de vorm van
 * caretGlyphPoints (de top wijst naar de bovenkant van de tekst). Geen /RD,
 * /Popup of /RC. /Sy /P alleen als het model dat heeft (geladen).
 * @param {{ rgb: number[], opacity?: number, pageRot?: number, flags?: number, gebruikteNm?: Set<string> }} opties
 */
export function buildCaretDict(context, ann, map, { rgb, opacity = 1, pageRot = 0, flags = 4, gebruikteNm } = {}) {
  const vak = { x: ann.x, y: ann.y, width: ann.width, height: ann.height };
  const textDir = ann.textDir ?? 0;
  const hoeken = quadCorners(vak, 0).map((p) => map(p.x, p.y));
  const rect = omhullende(hoeken, 0);
  const [llx, lly] = rect;
  const pt = caretGlyphPoints(vak, textDir).map((p) => {
    const u = map(p.x, p.y);
    return `${getal(u.x - llx)} ${getal(u.y - lly)}`;
  });
  const inhoud = `q ${kleur(rgb)} rg ${pt[0]} m ${pt[1]} l ${pt[2]} l ${pt[3]} l h f Q`;
  const dict = context.obj({
    Type: 'Annot',
    Subtype: 'Caret',
    Rect: rect,
    Sy: ann.symbol === 'P' ? 'P' : 'None',
    Contents: pdfTextString(ann.text || ''),
    C: rgb,
    CA: opacity,
    F: flags,
    T: pdfTextString(ann.author || 'User'),
  });
  addTextEditKeys(dict, ann, pageRot, gebruikteNm);
  dict.set(N('AP'), context.obj({ N: vormStream(context, rect, inhoud) }));
  return dict;
}

const kopie = (context, v) => (v && typeof v.clone === 'function' ? v.clone(context) : v);

/**
 * Koppelt de kinderen van vervangingen aan hun invoegteken: /IRT naar de ref
 * van de ouder en /RT /Group; /C, /T, /CreationDate en /M komen van de ouder
 * (lezers nemen die van de groepsleider over) en /Contents verdwijnt. Met
 * `annotsArray` komt het kind vóór zijn ouder te staan, zodat het invoegteken
 * erbovenop getekend wordt.
 * @returns {number} aantal gekoppelde kinderen
 */
export function applyGroupLinks(context, plan, refById, dictById, annotsArray) {
  let aantal = 0;
  for (const { childId, parentId } of plan?.links || []) {
    const ouderRef = refById.get(parentId);
    const ouder = dictById.get(parentId);
    const kind = dictById.get(childId);
    if (!(ouderRef instanceof PDFRef) || !ouder || !kind) continue;
    kind.set(N('IRT'), ouderRef);
    kind.set(N('RT'), N('Group'));
    for (const sleutel of ['C', 'T', 'CreationDate', 'M']) {
      const v = ouder.get(N(sleutel));
      if (v !== undefined) kind.set(N(sleutel), kopie(context, v));
    }
    kind.delete(N('Contents'));
    if (Array.isArray(annotsArray)) {
      const kindRef = refById.get(childId);
      const k = annotsArray.indexOf(kindRef);
      const o = annotsArray.indexOf(ouderRef);
      if (k > o && o >= 0) {
        annotsArray.splice(k, 1);
        annotsArray.splice(o, 0, kindRef);
      }
    }
    aantal++;
  }
  return aantal;
}

const subtypeVan = (d) => d?.get?.(N('Subtype'))?.toString();
const isCorrectieSoort = (d) => subtypeVan(d) === '/Caret' || subtypeVan(d) === '/StrikeOut';

/**
 * Sleutels (ref.toString()) van weggehaalde annotaties die proefleescorrecties
 * zijn: elk invoegteken, een doorhaling met /IT /StrikeOutTextEdit, en beide
 * leden van een /RT /Group-paar van invoegteken en doorhaling. Popups van
 * andere annotaties blijven zoals voorheen.
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFRef[]} removedRefs
 * @returns {Set<string>}
 */
export function correctionRefKeys(context, removedRefs) {
  const sleutels = new Set();
  const weg = new Map();
  for (const ref of removedRefs || []) {
    const d = context.lookup(ref);
    if (d instanceof PDFDict) weg.set(ref.toString(), d);
  }
  for (const [sleutel, d] of weg) {
    if (!isCorrectieSoort(d)) continue;
    const groep = d.get(N('RT'))?.toString() === '/Group';
    if (subtypeVan(d) === '/Caret' || d.get(N('IT'))?.toString() === '/StrikeOutTextEdit' || groep) {
      sleutels.add(sleutel);
    }
    const irt = d.get(N('IRT'));
    if (groep && irt instanceof PDFRef && isCorrectieSoort(weg.get(irt.toString()))) {
      sleutels.add(irt.toString());
    }
  }
  return sleutels;
}

/**
 * Laat popups weg waarvan de ouder door deze save is weggehaald en herschreven
 * (zie correctionRefKeys); anders blijft een popup achter die naar een
 * annotatie wijst die niet meer in /Annots staat.
 * @returns {Array} de overgebleven /Annots-items
 */
export function dropOrphanPopups(context, annotsArray, removedRefKeys) {
  if (!removedRefKeys || removedRefKeys.size === 0) return annotsArray;
  return annotsArray.filter((item) => {
    const d = context.lookup(item);
    if (!(d instanceof PDFDict) || subtypeVan(d) !== '/Popup') return true;
    const ouder = d.get(N('Parent'));
    return !(ouder instanceof PDFRef && removedRefKeys.has(ouder.toString()));
  });
}
