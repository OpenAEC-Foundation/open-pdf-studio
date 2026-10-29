// Gesplitste weergave (#715): de paginabeelden van het tweede paneel.
//
// Het tweede paneel tekent met dezelfde paginabitmaps als de echte viewer
// (page-bitmap-cache.js). Die cache is klein (12 entries) en gedeeld. Zonder
// grenzen verdrong het paneel bij scrollen de bitmap die de viewer elk frame
// tekent, en met meer zichtbare pagina's dan de cache houdt verdrong elke
// voltooide render een andere zichtbare pagina, die het paneel dan opnieuw
// aanvroeg: een renderlus. Daarom:
// - het paneel vraagt hooguit PANEEL_BUDGET pagina's aan (de grootste in
//   beeld eerst) en claimt precies die sleutels, zodat ze niet verdrongen
//   worden tot het paneel iets anders toont;
// - de overige zichtbare pagina's tekent het met wat er al in de cache staat
//   (een andere zoomtrap), zonder aanvraag;
// - wat de viewer toont, sluit de cache nooit (zie registreerGetoondeBitmaps).
//
// Zonder Rust-renderer (webversie, documenten zonder pad) tekent PDF.js de
// pagina's in een eigen, kleine cache van canvassen, met hetzelfde budget en
// een grens op het totaal aantal pixels. Die canvassen houden het PDF.js-
// document vast: bij sluiten van het document en bij opheffen van de
// splitsing gaan ze weg (vergeetPaneelBeelden).

import * as paginaBitmaps from '../page-bitmap-cache.js';

export const PANEEL_EIGENAAR = 'split-pane';
// Hoeveel pagina's het paneel tegelijk mag laten renderen en vasthouden.
export const PANEEL_BUDGET = 6;
// Langste as van een paginabeeld (zoals de viewer: PDFium-grens).
export const MAX_BEELD_AS_PX = 4096;
// PDF.js-pad: hooguit zoveel canvassen en pixels samen (~4 bytes per pixel).
export const PDFJS_MAX_BEELDEN = 8;
export const PDFJS_MAX_PIXELS = 48 * 1024 * 1024;

const _aanvragen = new Set();

function bruikbaar(entry) {
  return !!(entry && entry.bitmap && entry.bitmap.width > 0);
}

// Zichtbaar oppervlak van een plaatsing in het paneel (CSS-px²).
function zichtbaarOppervlak(p, W, H) {
  const w = (p.sw || p.pw || 0) * (p.z || 0);
  const h = (p.sh || p.ph || 0) * (p.z || 0);
  const x0 = Math.max(0, p.tx || 0);
  const y0 = Math.max(0, p.ty || 0);
  const x1 = Math.min(W, (p.tx || 0) + w);
  const y1 = Math.min(H, (p.ty || 0) + h);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

/**
 * Welke plaatsingen mogen een beeld aanvragen: de PANEEL_BUDGET grootste in
 * beeld. Geeft een Set van indexen in `plaatsingen`.
 */
export function kiesBudget(plaatsingen, W, H, budget = PANEEL_BUDGET) {
  return new Set(
    plaatsingen
      .map((p, i) => ({ i, opp: zichtbaarOppervlak(p, W, H) }))
      .sort((a, b) => b.opp - a.opp || a.i - b.i)
      .slice(0, Math.max(0, budget))
      .map((x) => x.i),
  );
}

/** Zoomtrap voor een plaatsing (zoals de viewer: begrensd op MAX_BEELD_AS_PX). */
export function bucketVoor(p, pxPerPt, computeZoomBucket = paginaBitmaps.computeZoomBucket) {
  const maxAs = Math.max(p.pw || 0, p.ph || 0) || 1;
  return computeZoomBucket(Math.min(pxPerPt, MAX_BEELD_AS_PX / maxAs));
}

/**
 * De paginabitmaps (Rust-renderer) voor de zichtbare pagina's van het paneel.
 * @param {object[]} plaatsingen  { page, rotatie, pw, ph, sw, sh, z, tx, ty }
 * @param {{filePath: string, dpr: number, W: number, H: number,
 *   opKlaar?: () => void, cache?: object, aanvragen?: Set<string>}} opties
 *   cache: voor de test; standaard page-bitmap-cache.js
 * @returns {{beeld: any, exact: boolean}[]}  per plaatsing; exact = er komt
 *   niets scherpers meer (pagina's buiten het budget wachten nergens op)
 */
export function paneelBitmaps(plaatsingen, { filePath, dpr = 1, W, H, opKlaar, cache = paginaBitmaps, aanvragen = _aanvragen } = {}) {
  const budget = kiesBudget(plaatsingen, W, H);
  const buckets = plaatsingen.map((p) => bucketVoor(p, p.z * dpr, cache.computeZoomBucket));
  // Eerst claimen: wat straks binnenkomt, mag niet meteen weer verdrongen worden.
  cache.claimBitmaps(PANEEL_EIGENAAR, plaatsingen
    .map((p, i) => (budget.has(i) ? cache.bitmapSleutel(filePath, p.page, p.rotatie, buckets[i]) : null))
    .filter(Boolean));
  return plaatsingen.map((p, i) => {
    const bucket = buckets[i];
    const exact = cache.getCachedBitmap(filePath, p.page, p.rotatie, bucket);
    if (bruikbaar(exact)) return { beeld: exact.bitmap, exact: true };
    const inBudget = budget.has(i);
    if (inBudget) {
      const sleutel = cache.bitmapSleutel(filePath, p.page, p.rotatie, bucket);
      if (!aanvragen.has(sleutel)) {
        aanvragen.add(sleutel);
        Promise.resolve()
          .then(() => cache.ensureBitmap(filePath, p.page, p.rotatie, bucket))
          .then((e) => { if (e && opKlaar) opKlaar(); })
          .catch(() => {})
          .finally(() => { aanvragen.delete(sleutel); });
      }
    }
    const best = cache.getBestAvailableBitmap(filePath, p.page, p.rotatie, bucket);
    return { beeld: bruikbaar(best) ? best.bitmap : null, exact: !inBudget };
  });
}

/** Het paneel toont niets meer (opgeheven, verborgen): claims los. */
export function laatPaneelBitmapsLos(cache = paginaBitmaps) {
  try { cache.claimBitmaps(PANEEL_EIGENAAR, []); } catch { /* cache niet geladen */ }
}

// ── PDF.js-pad ────────────────────────────────────────────────────────────

// sleutel `${docId}|${page}|${rotatie}|${bucket}` → { beeld, pdfDoc, docId, pixels }
const _pdfjsBeelden = new Map();
const _pdfjsAanvragen = new Set();
// Per document: verhoogd bij vergeten, zodat een lopende render daarna niets
// meer in de cache zet.
const _generaties = new Map();
let _pdfjsClaims = new Set();

function generatie(docId) {
  return _generaties.get(docId) || 0;
}

function geefCanvasVrij(beeld) {
  // Een canvas houdt zijn pixels tot hij opgeruimd wordt; maat 0 geeft ze
  // meteen terug.
  try { if (beeld && 'width' in beeld) { beeld.width = 0; beeld.height = 0; } } catch { /* al weg */ }
}

function pdfjsPixels() {
  let n = 0;
  for (const v of _pdfjsBeelden.values()) n += v.pixels || 0;
  return n;
}

// Oudste eerst weg tot aantal en pixels binnen de grenzen zijn; nooit wat het
// paneel nu nodig heeft (geclaimd) of wat net binnenkwam.
function pdfjsBeperk(nieuw) {
  for (const k of Array.from(_pdfjsBeelden.keys())) {
    if (_pdfjsBeelden.size <= PDFJS_MAX_BEELDEN && pdfjsPixels() <= PDFJS_MAX_PIXELS) break;
    if (k === nieuw || _pdfjsClaims.has(k)) continue;
    geefCanvasVrij(_pdfjsBeelden.get(k).beeld);
    _pdfjsBeelden.delete(k);
  }
}

/**
 * De paginabeelden (PDF.js) voor de zichtbare pagina's van het paneel.
 * @param {object} doc  het document (id, pdfDoc)
 * @param {object[]} plaatsingen
 * @param {{dpr: number, W: number, H: number, opKlaar?: () => void,
 *   maakDoek?: () => any}} opties  maakDoek: voor de test
 * @returns {{beeld: any, exact: boolean}[]}
 */
export function paneelPdfjsBeelden(doc, plaatsingen, { dpr = 1, W, H, opKlaar, maakDoek } = {}) {
  const budget = kiesBudget(plaatsingen, W, H);
  const sleutels = plaatsingen.map((p) => `${doc.id}|${p.page}|${p.rotatie}|${bucketVoor(p, p.z * dpr)}`);
  _pdfjsClaims = new Set(sleutels.filter((_, i) => budget.has(i)));
  return plaatsingen.map((p, i) => {
    const sleutel = sleutels[i];
    const klaar = _pdfjsBeelden.get(sleutel);
    if (klaar && klaar.pdfDoc === doc.pdfDoc) return { beeld: klaar.beeld, exact: true };
    const inBudget = budget.has(i);
    if (inBudget && !_pdfjsAanvragen.has(sleutel)) {
      _pdfjsAanvragen.add(sleutel);
      renderPdfjs(doc, p, sleutel, bucketVoor(p, p.z * dpr), maakDoek)
        .then((gelukt) => { if (gelukt && opKlaar) opKlaar(); })
        .catch(() => {})
        .finally(() => { _pdfjsAanvragen.delete(sleutel); });
    }
    const prefix = `${doc.id}|${p.page}|${p.rotatie}|`;
    for (const [k, v] of _pdfjsBeelden) {
      if (v.pdfDoc === doc.pdfDoc && k.startsWith(prefix)) return { beeld: v.beeld, exact: !inBudget };
    }
    return { beeld: null, exact: !inBudget };
  });
}

async function renderPdfjs(doc, p, sleutel, bucket, maakDoek) {
  const pdfDoc = doc.pdfDoc;
  const docId = doc.id;
  const gen = generatie(docId);
  const page = await pdfDoc.getPage(p.page);
  // Begrensd op MAX_BEELD_AS_PX: de zoomtrap rondt naar boven af en een A4
  // ver ingezoomd werd anders een canvas van 128 MB.
  const basis = page.getViewport({ scale: 1, rotation: ((page.rotate || 0) + p.rotatie) % 360 });
  const maxAs = Math.max(basis.width, basis.height) || 1;
  const schaal = Math.min(bucket, MAX_BEELD_AS_PX / maxAs);
  const vpj = page.getViewport({ scale: schaal, rotation: ((page.rotate || 0) + p.rotatie) % 360 });
  const doek = maakDoek ? maakDoek() : document.createElement('canvas');
  doek.width = Math.max(1, Math.floor(vpj.width));
  doek.height = Math.max(1, Math.floor(vpj.height));
  const ctx = doek.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, doek.width, doek.height);
  await page.render({ canvasContext: ctx, viewport: vpj, annotationMode: 0 }).promise;
  // Intussen gesloten, opgeheven of een ander document geladen: niet bewaren.
  if (generatie(docId) !== gen || doc.pdfDoc !== pdfDoc) {
    geefCanvasVrij(doek);
    return false;
  }
  const oud = _pdfjsBeelden.get(sleutel);
  if (oud && oud.beeld !== doek) geefCanvasVrij(oud.beeld);
  _pdfjsBeelden.set(sleutel, { beeld: doek, pdfDoc, docId, pixels: doek.width * doek.height });
  pdfjsBeperk(sleutel);
  return true;
}

/**
 * Alles wat het paneel voor dit document vasthoudt weg: de PDF.js-canvassen
 * (en daarmee de verwijzing naar het PDF.js-document) en de claims in de
 * paginabitmapcache. Bij sluiten van het document en bij opheffen.
 */
export function vergeetPaneelBeelden(doc) {
  const docId = doc && doc.id;
  if (docId == null) return;
  _generaties.set(docId, generatie(docId) + 1);
  const prefix = `${docId}|`;
  for (const [k, v] of Array.from(_pdfjsBeelden)) {
    if (k.startsWith(prefix) || (doc.pdfDoc && v.pdfDoc === doc.pdfDoc)) {
      geefCanvasVrij(v.beeld);
      _pdfjsBeelden.delete(k);
    }
  }
  for (const k of Array.from(_pdfjsClaims)) if (k.startsWith(prefix)) _pdfjsClaims.delete(k);
  laatPaneelBitmapsLos();
}

/** Voor tests: wat staat er in de PDF.js-cache van het paneel? */
export function pdfjsCacheOverzicht() {
  return { aantal: _pdfjsBeelden.size, pixels: pdfjsPixels(), sleutels: Array.from(_pdfjsBeelden.keys()) };
}
