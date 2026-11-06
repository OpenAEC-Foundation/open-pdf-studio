// De schalen van de app en de schaalcontroles in het bestand zelf (#629).
//
// Lezen kon al: `/VP`-viewports met `/Measure` uit CAD-plots en de DWG/DXF-
// import (pdf-viewports.js, #400). Schrijven nog niet: een schaalgebied, een
// viewport-annotatie of de documentschaal (kalibratie) stond alleen als
// eigen annotatiesleutel of in de browseropslag. Een andere lezer zag geen
// schaal, en de documentschaal ging niet mee met het bestand.
//
// Bij het opslaan krijgt elke pagina in `/VP` een viewport per schaal van de
// app, gemarkeerd met `/OPS_Bron`. Volgens ISO 32000 (12.9.2) geldt bij
// overlap de laatste viewport in de lijst die het punt bevat; de volgorde is
// daarom die van getMeasureScale, achterstevoren:
//   /Document     de documentschaal, over het hele blad
//   (viewports van anderen, zonder /OPS_Bron: die blijven staan)
//   /Viewport     een viewport-annotatie
//   /ScaleRegion  een schaalgebied, grootste eerst (het binnenste wint)
// Zo kiest een andere lezer op elk punt dezelfde schaal als de app.
//
// Bij het lezen slaat pdf-viewports.js de eigen viewports over: hun
// annotaties komen zelf terug. Alleen de documentschaal wordt hier gelezen
// (leesDocumentSchaal), omdat die geen annotatie heeft.
//
// De schaalcontroles staan per pagina in `/OPS_ScaleChecks` (JSON, zie
// annotations/schaalcontrole.js).
//
// Alleen pdf-lib, geen app-state: de saver en de lader geven alles mee.

import { PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString } from 'pdf-lib';
import { pdfTextString } from './saver/pdf-text.js';
import { pixelsPerUnitFor } from '../annotations/scale-region-scale.js';
import { schaalUitMeasure } from './pdf-viewports.js';
import { leesControlesJson, schrijfControlesJson } from '../annotations/schaalcontrole.js';

const N = (s) => PDFName.of(s);

/** De sleutel die een eigen viewport markeert. */
export const BRON_SLEUTEL = 'OPS_Bron';
/** De paginasleutel met de schaalcontroles. */
export const CONTROLES_SLEUTEL = 'OPS_ScaleChecks';

const BRONNEN = Object.freeze({ document: 'Document', scaleRegion: 'ScaleRegion', viewport: 'Viewport' });

function getal(obj) {
  return obj instanceof PDFNumber ? obj.asNumber() : null;
}

function tekst(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try { return obj.decodeText(); } catch { return ''; }
  }
  return '';
}

function geerfd(node, naam) {
  let n = node;
  for (let i = 0; n && i < 32; i++) {
    const v = n.lookup(N(naam));
    if (v !== undefined && v !== null) return v;
    const ouder = n.lookup(N('Parent'));
    n = ouder instanceof PDFDict ? ouder : null;
  }
  return null;
}

function rechthoek(arr) {
  if (!(arr instanceof PDFArray) || arr.size() < 4) return null;
  const v = [0, 1, 2, 3].map((i) => getal(arr.lookup(i)));
  return v.every((n) => n !== null && Number.isFinite(n)) ? v : null;
}

/** De zichtbare box (CropBox ∩ MediaBox) en /Rotate, zoals pdf-viewports.js ze leest. */
export function paginaRuimte(node) {
  const media = rechthoek(geerfd(node, 'MediaBox'));
  if (!media) return null;
  const crop = rechthoek(geerfd(node, 'CropBox'));
  let view = media;
  if (crop) {
    const x0 = Math.max(Math.min(media[0], media[2]), Math.min(crop[0], crop[2]));
    const y0 = Math.max(Math.min(media[1], media[3]), Math.min(crop[1], crop[3]));
    const x1 = Math.min(Math.max(media[0], media[2]), Math.max(crop[0], crop[2]));
    const y1 = Math.min(Math.max(media[1], media[3]), Math.max(crop[1], crop[3]));
    if (x1 > x0 && y1 > y0) view = [x0, y0, x1, y1];
  }
  const rot = getal(geerfd(node, 'Rotate')) || 0;
  return { view, rot: (((rot % 360) + 360) % 360) };
}

/**
 * Eén punt uit de app-ruimte terug naar de PDF-gebruikersruimte: het
 * omgekeerde van puntNaarAppRuimte in pdf-viewports.js.
 * @returns {[number, number]}
 */
export function puntNaarPdfRuimte(x, y, viewBox, rotatie) {
  const [vx0, vy0, vx1, vy1] = viewBox;
  const W = vx1 - vx0;
  const H = vy1 - vy0;
  const r = (((Number(rotatie) || 0) % 360) + 360) % 360;
  let u;
  let v;
  switch (r) {
    case 90: u = y; v = x; break;
    case 180: u = W - x; v = y; break;
    case 270: u = W - y; v = H - x; break;
    default: u = x; v = H - y;
  }
  return [u + vx0, v + vy0];
}

/** Rechthoek in app-ruimte naar een /BBox in gebruikersruimte. */
export function naarPdfRuimte(rect, viewBox, rotatie) {
  const a = puntNaarPdfRuimte(rect.x, rect.y, viewBox, rotatie);
  const b = puntNaarPdfRuimte(rect.x + rect.width, rect.y + rect.height, viewBox, rotatie);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/**
 * De eigen schalen van één pagina: de documentschaal, dan de viewport-
 * annotaties, dan de schaalgebieden van groot naar klein (zie boven).
 * @param {Array<object>} annotaties  de annotaties van deze pagina
 * @param {{pixelsPerUnit:number, unit?:string, scaleRatio?:string|number, method?:string} | null} docSchaal
 * @param {{width:number, height:number}} blad  weergegeven bladmaat in app-ruimte
 * @returns {Array<{bron:string, rect:object, pixelsPerUnit:number, unit:string, ratio:string, naam:string, id?:string, method?:string}>}
 */
export function eigenSchalen(annotaties, docSchaal, blad) {
  const uit = [];
  if (docSchaal && docSchaal.pixelsPerUnit > 0 && blad?.width > 0 && blad?.height > 0) {
    uit.push({
      bron: BRONNEN.document,
      rect: { x: 0, y: 0, width: blad.width, height: blad.height },
      pixelsPerUnit: docSchaal.pixelsPerUnit,
      unit: docSchaal.unit || 'mm',
      ratio: typeof docSchaal.scaleRatio === 'string' ? docSchaal.scaleRatio : '',
      naam: '',
      method: typeof docSchaal.method === 'string' ? docSchaal.method : '',
    });
  }
  const lijst = Array.isArray(annotaties) ? annotaties : [];
  const geldig = (a) => a.width > 0 && a.height > 0 && [a.x, a.y, a.width, a.height].every(Number.isFinite);
  for (const v of lijst.filter((a) => a.type === 'viewport' && geldig(a) && a.pixelsPerUnit > 0)) {
    uit.push({
      bron: BRONNEN.viewport, rect: v, id: v.id,
      pixelsPerUnit: v.pixelsPerUnit, unit: v.unit || 'mm',
      ratio: typeof v.scaleRatio === 'string' ? v.scaleRatio : '', naam: v.name || '',
    });
  }
  const gebieden = lijst.filter((a) => a.type === 'scaleRegion' && geldig(a))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
  for (const g of gebieden) {
    const unit = g.units || 'mm';
    uit.push({
      bron: BRONNEN.scaleRegion, rect: g, id: g.id,
      pixelsPerUnit: pixelsPerUnitFor(g.scaleString || '1:100', unit), unit,
      ratio: g.scaleString || '1:100', naam: g.label || '',
    });
  }
  return uit;
}

function measureDict(context, { pixelsPerUnit, unit, ratio }) {
  const c = 1 / pixelsPerUnit;
  return context.obj({
    Type: N('Measure'),
    Subtype: N('RL'),
    R: pdfTextString(ratio || `1 pt = ${Number(c.toPrecision(8))} ${unit}`),
    X: context.obj([context.obj({ Type: N('NumberFormat'), U: pdfTextString(unit), C: c, D: 100 })]),
    D: context.obj([context.obj({ Type: N('NumberFormat'), U: pdfTextString(unit), C: 1, D: 100 })]),
    A: context.obj([context.obj({ Type: N('NumberFormat'), U: pdfTextString(`${unit}²`), C: 1, D: 100 })]),
  });
}

function isEigen(d) {
  return d instanceof PDFDict && d.get(N(BRON_SLEUTEL)) !== undefined;
}

/**
 * Zet de eigen viewports van één pagina in /VP: de vorige eigen viewports
 * gaan eruit, die van anderen blijven (na de documentschaal, vóór de
 * gebieden en viewport-annotaties). Geen viewports meer: /VP verdwijnt.
 * @param {import('pdf-lib').PDFPage} pagina  (/Rotate al toegepast)
 * @param {ReturnType<typeof eigenSchalen>} schalen  in app-ruimte
 * @returns {number} het aantal geschreven eigen viewports
 */
export function schrijfEigenViewports(pagina, schalen) {
  const node = pagina.node;
  const context = node.context;
  const ruimte = paginaRuimte(node);
  if (!ruimte) return 0;
  const vreemd = [];
  const oud = node.lookup(N('VP'));
  if (oud instanceof PDFArray) {
    for (let i = 0; i < oud.size(); i++) {
      const d = oud.lookup(i);
      if (!isEigen(d)) vreemd.push(oud.get(i));
    }
  }
  const eerst = [];
  const eigen = [];
  for (const s of schalen || []) {
    if (!(s.pixelsPerUnit > 0) || !Number.isFinite(s.pixelsPerUnit)) continue;
    const velden = {
      Type: N('Viewport'),
      BBox: naarPdfRuimte(s.rect, ruimte.view, ruimte.rot),
      Measure: measureDict(context, s),
      [BRON_SLEUTEL]: N(s.bron),
    };
    if (s.naam) velden.Name = pdfTextString(s.naam);
    if (s.id) velden.OPS_Id = pdfTextString(String(s.id));
    if (s.method) velden.OPS_Method = pdfTextString(s.method);
    (s.bron === BRONNEN.document ? eerst : eigen).push(context.obj(velden));
  }
  const lijst = [...eerst, ...vreemd, ...eigen];
  if (lijst.length) node.set(N('VP'), context.obj(lijst));
  else if (node.get(N('VP')) !== undefined) node.delete(N('VP'));
  return eerst.length + eigen.length;
}

/** Is deze viewport-dict er een van de app zelf? (pdf-viewports.js slaat ze over.) */
export function isEigenViewport(d) {
  return isEigen(d);
}

/**
 * De documentschaal uit de eigen viewports (de eerste pagina waar hij staat).
 * @param {import('pdf-lib').PDFDocument} pdfLibDoc
 * @returns {{pixelsPerUnit:number, unit:string, method:string, scaleRatio:string|number} | null}
 */
export function leesDocumentSchaal(pdfLibDoc) {
  let paginas;
  try { paginas = pdfLibDoc.getPages(); } catch { return null; }
  for (const pagina of paginas) {
    try {
      const vp = pagina.node.lookup(N('VP'));
      if (!(vp instanceof PDFArray)) continue;
      for (let i = 0; i < vp.size(); i++) {
        const d = vp.lookup(i);
        if (!isEigen(d) || String(d.get(N(BRON_SLEUTEL))) !== `/${BRONNEN.document}`) continue;
        const measure = d.lookup(N('Measure'));
        const x = measure instanceof PDFDict ? measure.lookup(N('X')) : null;
        const opmaak = x instanceof PDFArray ? x.lookup(0) : null;
        if (!(opmaak instanceof PDFDict)) continue;
        const schaal = schaalUitMeasure(getal(opmaak.lookup(N('C'))), tekst(opmaak.lookup(N('U'))));
        if (!schaal) continue;
        const ratio = tekst(measure.lookup(N('R'))).trim();
        return {
          pixelsPerUnit: schaal.pixelsPerUnit,
          unit: schaal.unit,
          method: tekst(d.lookup(N('OPS_Method'))) || 'file',
          scaleRatio: /^1\s*:\s*\d/.test(ratio) ? ratio : 0,
        };
      }
    } catch {
      // Een kapotte pagina houdt de rest niet tegen.
    }
  }
  return null;
}

/**
 * Zet de schaalcontroles van één pagina. Een lege lijst haalt de sleutel weg.
 * @param {import('pdf-lib').PDFPage} pagina
 * @param {Array<object>} controles
 */
export function schrijfControles(pagina, controles) {
  const node = pagina.node;
  if (Array.isArray(controles) && controles.length) {
    node.set(N(CONTROLES_SLEUTEL), pdfTextString(schrijfControlesJson(controles)));
  } else if (node.get(N(CONTROLES_SLEUTEL)) !== undefined) {
    node.delete(N(CONTROLES_SLEUTEL));
  }
}

/**
 * De schaalcontroles van alle pagina's.
 * @param {import('pdf-lib').PDFDocument} pdfLibDoc
 * @returns {Record<number, object[]>} per 1-gebaseerd paginanummer; pagina's zonder ontbreken
 */
export function leesControles(pdfLibDoc) {
  const uit = {};
  let paginas;
  try { paginas = pdfLibDoc.getPages(); } catch { return uit; }
  paginas.forEach((pagina, i) => {
    try {
      const lijst = leesControlesJson(tekst(pagina.node.lookup(N(CONTROLES_SLEUTEL))));
      if (lijst.length) uit[i + 1] = lijst;
    } catch { /* optioneel */ }
  });
  return uit;
}

/**
 * Alles wat de saver per pagina schrijft: de eigen viewports en de controles.
 * @param {import('pdf-lib').PDFPage[]} paginas
 * @param {object} doc  het document uit de app (annotations, measureScale, scaleChecks, pageDims)
 * @param {(pageNum:number) => boolean} geladen  zijn de annotaties van die pagina geladen?
 *   Een niet-geladen pagina blijft ongemoeid: haar schaalgebieden staan nog niet in het model.
 */
export function schrijfSchalenInPdf(paginas, doc, geladen = () => true) {
  const perPagina = new Map();
  for (const a of doc?.annotations || []) {
    if (a.type !== 'scaleRegion' && a.type !== 'viewport') continue;
    if (!perPagina.has(a.page)) perPagina.set(a.page, []);
    perPagina.get(a.page).push(a);
  }
  let viewports = 0;
  (paginas || []).forEach((pagina, i) => {
    const pageNum = i + 1;
    if (!geladen(pageNum)) return;
    const ruimte = paginaRuimte(pagina.node);
    if (!ruimte) return;
    const breedte = ruimte.view[2] - ruimte.view[0];
    const hoogte = ruimte.view[3] - ruimte.view[1];
    const blad = ruimte.rot === 90 || ruimte.rot === 270
      ? { width: hoogte, height: breedte } : { width: breedte, height: hoogte };
    viewports += schrijfEigenViewports(pagina, eigenSchalen(perPagina.get(pageNum), doc?.measureScale, blad));
    // Geen regel in het model: de sleutel van het bestand blijft staan (een
    // ingevoegde pagina neemt haar geschiedenis mee). Een lege lijst wist.
    const controles = doc?.scaleChecks?.[pageNum];
    if (Array.isArray(controles)) schrijfControles(pagina, controles);
  });
  return viewports;
}

/**
 * Na het openen: de documentschaal en de schaalcontroles uit het bestand in
 * het document zetten. De schaal uit het bestand wint van de browseropslag en
 * van de schaal uit de titelhoek, maar niet van een schaal die de gebruiker
 * in deze sessie al zette (dan staat er iets in de undo-geschiedenis).
 * @param {object} doc
 * @param {import('pdf-lib').PDFDocument} pdfLibDoc
 * @returns {{schaal: boolean, controles: number}}  wat er gezet is
 */
export function pasSchalenUitBestandToe(doc, pdfLibDoc) {
  const uit = { schaal: false, controles: 0 };
  if (!doc || !pdfLibDoc) return uit;
  const controles = leesControles(pdfLibDoc);
  const aantal = Object.keys(controles).length;
  if (aantal && !doc.scaleChecks) {
    doc.scaleChecks = controles;
    uit.controles = aantal;
  }
  const schaal = leesDocumentSchaal(pdfLibDoc);
  const ongewijzigd = !(Array.isArray(doc.undoStack) && doc.undoStack.length > 0);
  if (schaal && ongewijzigd) {
    doc.measureScale = schaal;
    uit.schaal = true;
  }
  return uit;
}
