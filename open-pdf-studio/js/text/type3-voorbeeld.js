// ── Live weergave van een tekstbewerking in een Type3-font (#723) ──
//
// De painter (annotations/rendering.js) tekent een bewerkte tekst met
// fillText in het font dat PDF.js als CSS-font laadde. Een Type3-font is geen
// CSS-font (de glyfen zijn kleine content streams), dus daar viel de weergave
// terug op Helvetica, terwijl de saver de tekst in het originele font
// terugschrijft (saver/text-edit-inplace.js).
//
// Daarom bouwt deze module per bewerking een klein tijdelijk PDF met pdf-lib:
// één pagina met dezelfde box als de originele pagina, de gebruikte fonts
// van de pagina erin gekopieerd (met hun CharProcs, Resources, ...), en de
// nieuwe tekst getekend door DEZELFDE code als de saver (analyseerPagina +
// maakInPlaceResultaat + tekenTextEdit). Dezelfde match, dezelfde glyfcodes,
// dezelfde terugval naar Standard-14 voor een run met een glyf die het font
// niet heeft: de weergave is wat er bij opslaan in het bestand komt.
// PDF.js rendert dat document (alleen het gebied van de tekst, doorzichtig)
// en de painter legt die bitmap in het tekenkader op de plek van de tekst.
//
// - Alleen als de bewerking echt een Type3-font gebruikt; anders blijft het
//   gewone pad (fillText) en wordt niets gebouwd.
// - Bouwen gebeurt na een korte pauze (debounce) en per handtekening van de
//   bewerking; een verouderde bouw of render (de bewerking veranderde
//   intussen, of het document werd gesloten) wordt weggegooid of afgebroken.
// - Tot de bitmap klaar is, of als er iets misgaat, tekent de painter de
//   oude Helvetica-weergave.
// - Het tijdelijke document wordt vrijgegeven zodra de bewerking weg is
//   (opgeslagen, ongedaan gemaakt, document gesloten).

import { PDFDocument, PDFName, PDFDict, PDFRef, PDFObjectCopier } from 'pdf-lib';
import { analyseerPagina, maakInPlaceResultaat } from '../pdf/saver/text-edit-inplace.js';
import { textEditLineAnchor, resolveTextEditLineStyle } from './text-edit-appearance.js';
import { uitsnedeDichtheid, uitsnedeKader, uitsnedeVoldoet } from './text-edit-afdekking.js';

/** Pauze (ms) na de laatste wijziging voordat het voorbeeld gebouwd wordt. */
export const TYPE3_DEBOUNCE_MS = 150;

// ── Het tijdelijke document ──

/**
 * Bouwt het tijdelijke PDF voor één bewerking.
 *
 * @param {PDFDocument} bronPdf  het (gedeelde, alleen-lezen) pdf-lib-document
 * @param {object} edit          het text-edit-record
 * @param {{x:number,y:number,width:number,height:number}} box
 *   de pagina-box in user-space (de box waarin de painter tekent)
 * @param {object} [opties]      { tekenTextEdit, kiesUnicodeFont, fontKeten }
 * @returns {Promise<null|{type3:false}|{type3:true, bytes:Uint8Array,
 *   fonts:{key:string,naam:string,subtype:string}[]}>}
 *   null: geen in-place-match (de saver dekt af en schrijft Standard-14);
 *   type3 false: de bewerking gebruikt geen Type3-font.
 */
export async function bouwType3VoorbeeldPdf(bronPdf, edit, box, opties = {}) {
  if (!bronPdf || !edit || !box) return null;
  // Zelfde voorwaarden als applyInPlaceTextEdits: anders geen origineel font.
  if (edit.baked || edit.mcpStrict || !edit.originalText) return null;
  if (edit.bakedNewText && !edit.inplaceBaked) return null;
  const pages = bronPdf.getPages();
  const pi = (Number(edit.page) || 0) - 1;
  if (pi < 0 || pi >= pages.length) return null;
  const bronPagina = pages[pi];

  const ana = analyseerPagina(bronPdf, bronPagina, [edit]);
  const match = ana?.editMatches?.[0];
  if (!match) return null;

  const tmp = await PDFDocument.create();
  const pagina = tmp.addPage([box.width, box.height]);
  pagina.setMediaBox(box.x, box.y, box.width, box.height);
  const kopieer = PDFObjectCopier.for(bronPdf.context, tmp.context);
  let bronFonts = null;
  try { bronFonts = bronPagina.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict) || null; } catch (_) { bronFonts = null; }

  // Het font onder `key` (pagina of formulier) naar het tijdelijke document;
  // de naam waaronder het daar staat gaat in de content stream.
  const fonts = [];
  const namen = new Map();
  const paginaSleutel = (key) => {
    if (namen.has(key)) return namen.get(key);
    const fi = ana.fontInfos.get(key);
    const dict = fi?.bron ? fi.bron.dict : bronFonts;
    const waarde = dict ? dict.get(PDFName.of(fi?.bron ? fi.bron.naam : key)) : null;
    if (!waarde) throw new Error(`font ${key} niet gevonden`);
    let kopie = kopieer.copy(waarde);
    if (!(kopie instanceof PDFRef)) kopie = tmp.context.register(kopie);
    const naam = `OPS${namen.size + 1}`;
    pagina.node.setFontDictionary(PDFName.of(naam), kopie);
    namen.set(key, naam);
    fonts.push({ key, naam, subtype: fi?.subtype || '' });
    return naam;
  };
  const inplace = maakInPlaceResultaat(ana, match, paginaSleutel);
  // In de weergave dekt de painter ALLE originele runs af; ongewijzigde regels
  // moeten dus ook getekend worden (de saver laat die in het bestand staan).
  const kopie = { ...edit, page: 1, mcpStrict: false, unchangedLines: undefined };
  const teken = opties.tekenTextEdit
    || (await import('../pdf/saver/text-edits.js')).tekenTextEdit;
  const fontOpties = {};
  if (opties.kiesUnicodeFont) fontOpties.kiesUnicodeFont = opties.kiesUnicodeFont;
  if (opties.fontKeten) fontOpties.fontKeten = opties.fontKeten;
  await teken(tmp, [pagina], kopie, { ...inplace, needsCover: false }, fontOpties);

  if (!fonts.some(f => f.subtype === 'Type3')) return { type3: false };
  const bytes = await tmp.save({ useObjectStreams: false });
  return { type3: true, bytes, fonts };
}

/**
 * Ruime omhullende van de nieuwe tekst in het tekenkader van de painter
 * (x vanaf de linkerrand van de box, y omlaag vanaf de bovenrand, punten).
 * Ruim genoeg voor onder- en bovenstokken en een breder Type3-font.
 */
export function voorbeeldOmhullende(edit, offX, top) {
  const regels = String(edit?.newText ?? '').split('\n');
  const angle = Number(edit?.textAngle) || 0;
  const rad = angle * Math.PI / 180;
  const lees = { x: Math.cos(rad), y: Math.sin(rad) };
  const op = { x: -Math.sin(rad), y: Math.cos(rad) };
  const ls = edit?.lineSpacing || (Number(edit?.fontSize) || 12) * 1.2;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  regels.forEach((regel, i) => {
    if (!regel) return;
    const size = Number(resolveTextEditLineStyle(edit, i).fontSize) || Number(edit.fontSize) || 12;
    const anker = textEditLineAnchor(edit.pdfX, edit.pdfY, i, ls, angle);
    const segs = Array.isArray(edit.lineSegments?.[i]) ? edit.lineSegments[i] : null;
    let lengte = [...regel].length * size * 1.2;
    if (segs && segs.length) {
      for (const sg of segs) {
        lengte = Math.max(lengte, (Number(sg.dx) || 0) + [...String(sg.text ?? '')].length * size * 1.2);
      }
    }
    lengte = Math.max(lengte, Number(edit.justifyWidth) || 0, i === 0 ? Number(edit.pdfWidth) || 0 : 0);
    const us = [-size * 0.5, lengte + size * 0.5];
    const vs = [-size * 0.6, size * 1.3];
    for (const u of us) {
      for (const v of vs) {
        const fx = anker.x + lees.x * u + op.x * v - offX;
        const fy = top - (anker.y + lees.y * u + op.y * v);
        x0 = Math.min(x0, fx); x1 = Math.max(x1, fx);
        y0 = Math.min(y0, fy); y1 = Math.max(y1, fy);
      }
    }
  });
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Handtekening van alles wat de weergave van een bewerking bepaalt (plus de
 * box). Verandert die, dan is een gebouwd voorbeeld verouderd.
 */
export function type3Handtekening(edit, box) {
  if (!edit) return '';
  return JSON.stringify([
    edit.id, edit.page, edit.newText, edit.originalText, edit.pdfX, edit.pdfY, edit.pdfWidth,
    edit.fontSize, edit.lineSpacing, edit.color, edit.fontFamily, edit.loadedFontName,
    edit.textAngle, edit.fontUnderline, edit.fontStrikethrough, edit.lineStyles,
    edit.lineSegments, edit.lineJustifyTw, edit.justifyWidth, edit.lineCharSpacing,
    edit.originalLineInfo, edit.originalSpanTexts, edit.inplaceBaked, edit.bakedNewText,
    edit.numOriginalLines, edit.moved, edit.baked, edit.mcpStrict,
    box ? [box.x, box.y, box.width, box.height] : null,
  ]);
}

// ── Bronnen (te vervangen in tests) ──

const STANDAARD_BRONNEN = {
  // Het gedeelde pdf-lib-document van het open bestand (alleen lezen).
  async pdfLibVan(doc) {
    const { getSharedPdfLibDoc } = await import('../pdf/loader.js');
    return getSharedPdfLibDoc(doc);
  },
  async laadPdfjs(bytes) {
    const pdfjs = await import('pdfjs-dist');
    const { pdfjsBronnen } = await import('../core/basis-url.js');
    return pdfjs.getDocument({
      data: bytes, ...pdfjsBronnen(), isEvalSupported: false, verbosity: 0,
    }).promise;
  },
  maakCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  },
  bouw: bouwType3VoorbeeldPdf,
  plan: (fn, ms) => setTimeout(fn, ms),
  annuleer: (t) => clearTimeout(t),
  wachttijd: TYPE3_DEBOUNCE_MS,
};
let _bronnen = { ...STANDAARD_BRONNEN };
let _herteken = null;

/** Voor tests: bronnen vervangen ({} = standaard terug). */
export function zetType3VoorbeeldBronnen(over = {}) {
  _bronnen = { ...STANDAARD_BRONNEN, ...over };
}

/** Wat er moet gebeuren als een voorbeeld klaar is (weergave hertekenen). */
export function zetType3Herteken(fn) {
  _herteken = typeof fn === 'function' ? fn : null;
}

function herteken() {
  if (!_herteken) return;
  try { _herteken(); } catch (e) { console.warn('[type3-voorbeeld] hertekenen faalde:', e); }
}

// ── Cache en planning ──

const _caches = new WeakMap(); // doc → Map<sleutel, item>

function vrijgeven(item) {
  item.weg = true;
  if (item.timer != null) { try { _bronnen.annuleer(item.timer); } catch (_) { /* */ } item.timer = null; }
  if (item.taak) { try { item.taak.cancel(); } catch (_) { /* */ } item.taak = null; }
  const pdf = item.pdfjsDoc;
  item.pdfjsDoc = null;
  item.pagina = null;
  item.bitmap = null;
  if (pdf) {
    try { Promise.resolve((pdf.loadingTask || pdf).destroy()).catch(() => {}); } catch (_) { /* */ }
  }
}

function nieuwItem(doc, handtekening) {
  return {
    handtekening, pdfDoc: doc.pdfDoc, status: 'gepland', timer: null,
    pdfjsDoc: null, pagina: null, bitmap: null, doel: null, wens: null, taak: null, weg: false,
    fout: null,
  };
}

async function bouwItem(doc, item, edit, box) {
  item.status = 'bouwen';
  try {
    const bron = await _bronnen.pdfLibVan(doc);
    if (item.weg) return;
    const res = bron ? await _bronnen.bouw(bron, edit, box) : null;
    if (item.weg) return;
    if (!res || !res.type3) { item.status = 'nvt'; return; }
    const pdfjsDoc = await _bronnen.laadPdfjs(res.bytes);
    if (item.weg) {
      try { Promise.resolve((pdfjsDoc.loadingTask || pdfjsDoc).destroy()).catch(() => {}); } catch (_) { /* */ }
      return;
    }
    item.pdfjsDoc = pdfjsDoc;
    item.pagina = await pdfjsDoc.getPage(1);
    if (item.weg) return;
    item.status = 'klaar';
    await renderLus(item);
  } catch (err) {
    if (item.weg) return;
    item.status = 'mislukt';
    item.fout = err;
    console.warn('[type3-voorbeeld] voorbeeld niet gebouwd; Helvetica-weergave blijft:', err);
  }
  if (!item.weg) herteken();
}

// Rendert zolang er een wens ligt; een nieuwe wens tijdens een render wordt
// daarna uitgevoerd. Een afgebroken render (item weg) laat niets achter.
async function renderLus(item) {
  if (item.doel) return;
  while (item.wens && !item.weg && item.pagina) {
    item.doel = item.wens;
    item.wens = null;
    const { kader, px } = item.doel;
    const canvas = _bronnen.maakCanvas(Math.max(1, Math.ceil(kader.width * px)), Math.max(1, Math.ceil(kader.height * px)));
    try {
      const taak = item.pagina.render({
        canvas,
        viewport: item.pagina.getViewport({ scale: px, rotation: 0 }),
        transform: [1, 0, 0, 1, -kader.x * px, -kader.y * px],
        background: 'rgba(0,0,0,0)',
        annotationMode: 0,
      });
      item.taak = taak;
      await taak.promise;
      item.taak = null;
      if (item.weg) break;
      item.bitmap = { canvas, kader, px };
    } catch (err) {
      item.taak = null;
      if (item.weg) break;
      item.status = 'mislukt';
      item.fout = err;
      console.warn('[type3-voorbeeld] render mislukt; Helvetica-weergave blijft:', err);
      break;
    }
  }
  item.doel = null;
}

/**
 * Het voorbeeld van één bewerking in het originele Type3-font:
 * { canvas, kader, px } (op `kader` te tekenen, canvas.width/px breed), of
 * null zolang er geen is — dan tekent de painter de Helvetica-weergave.
 * Plant zo nodig de bouw (na TYPE3_DEBOUNCE_MS) of een nieuwe render op de
 * dichtheid van het doelcanvas; daarna volgt zetType3Herteken().
 *
 * @param {object} doc
 * @param {number} pageNum
 * @param {object} edit
 * @param {{x:number,y:number,width:number,height:number}} box  pagina-box (user-space)
 * @param {number} pxPerPt  pixels per punt van het doelcanvas
 * @param {{plannen?: boolean}} [opties]  plannen:false = alleen uit de cache
 */
export function type3Voorbeeld(doc, pageNum, edit, box, pxPerPt, { plannen = true } = {}) {
  if (!doc || !edit || edit.id == null || !box) return null;
  if (edit.baked || edit.mcpStrict || !edit.originalText) return null;
  const omhullende = voorbeeldOmhullende(edit, box.x, box.y + box.height);
  if (!omhullende) return null;
  let cache = _caches.get(doc);
  if (!cache) { cache = new Map(); _caches.set(doc, cache); }
  const sleutel = type3Sleutel(pageNum, edit.id);
  const handtekening = type3Handtekening(edit, box);
  let item = cache.get(sleutel);
  if (item && (item.handtekening !== handtekening || item.pdfDoc !== doc.pdfDoc)) {
    // Verouderd: de bewerking veranderde, of het document werd herladen.
    vrijgeven(item);
    cache.delete(sleutel);
    item = null;
  }
  if (!item) {
    if (!plannen) return null;
    item = nieuwItem(doc, handtekening);
    cache.set(sleutel, item);
  }
  if (item.status === 'nvt' || item.status === 'mislukt') return null;

  const nodig = uitsnedeDichtheid(omhullende, pxPerPt);
  const bruikbaar = item.bitmap && bevat(item.bitmap.kader, omhullende) ? item.bitmap : null;
  if (plannen) {
    const goed = (bruikbaar && uitsnedeVoldoet(bruikbaar.px, nodig))
      || (item.doel && bevat(item.doel.kader, omhullende) && uitsnedeVoldoet(item.doel.px, nodig));
    if (!goed) item.wens = { kader: uitsnedeKader(omhullende, nodig), px: nodig };
    if (item.status === 'gepland' && item.timer == null) {
      // Momentopname: de bouw gebruikt de bewerking zoals hij nu getekend
      // wordt (de handtekening hoort daarbij).
      let bewerking = edit;
      try { bewerking = JSON.parse(JSON.stringify(edit)); } catch (_) { bewerking = edit; }
      item.timer = _bronnen.plan(() => {
        item.timer = null;
        if (!item.weg) bouwItem(doc, item, bewerking, { ...box });
      }, _bronnen.wachttijd);
    } else if (item.status === 'klaar' && item.wens && !item.doel) {
      renderLus(item).then(() => { if (!item.weg) herteken(); });
    }
  }
  return bruikbaar ? { canvas: bruikbaar.canvas, kader: bruikbaar.kader, px: bruikbaar.px } : null;
}

function bevat(a, b) {
  const eps = 1e-3;
  return !!a && !!b
    && a.x <= b.x + eps && a.y <= b.y + eps
    && a.x + a.width >= b.x + b.width - eps
    && a.y + a.height >= b.y + b.height - eps;
}

/** Sleutel van een voorbeeld: pagina en bewerking. */
export function type3Sleutel(pageNum, editId) {
  return `${pageNum}|${editId}`;
}

/** Geeft de voorbeelden van een pagina vrij die niet meer bij een bewerking horen. */
export function houdType3Voorbeelden(doc, pageNum, sleutels) {
  const cache = doc ? _caches.get(doc) : null;
  if (!cache) return;
  const houden = new Set(sleutels);
  const prefix = `${pageNum}|`;
  for (const [k, item] of [...cache]) {
    if (k.startsWith(prefix) && !houden.has(k)) {
      vrijgeven(item);
      cache.delete(k);
    }
  }
}

/** Geeft alle voorbeelden van een document vrij (document gesloten). */
export function vergeetType3Voorbeelden(doc) {
  const cache = doc ? _caches.get(doc) : null;
  if (!cache) return;
  for (const item of cache.values()) vrijgeven(item);
  cache.clear();
  _caches.delete(doc);
}

/** Voor tests: de status van een voorbeeld. */
export function type3VoorbeeldStatus(doc, pageNum, editId) {
  const item = doc ? _caches.get(doc)?.get(type3Sleutel(pageNum, editId)) : null;
  return item ? item.status : null;
}

/** Voor tests en diagnose: de fout achter de status 'mislukt' (of null). */
export function type3VoorbeeldFout(doc, pageNum, editId) {
  const item = doc ? _caches.get(doc)?.get(type3Sleutel(pageNum, editId)) : null;
  return item?.fout || null;
}
