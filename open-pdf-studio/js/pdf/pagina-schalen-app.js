// Page scales in the app: set them, detect them, keep them with their pages.
// The rules are in pagina-schalen.js.
//
// Detection reads every page (text layer, OCR where there is none) and can
// take a while. It works on the document it was started for: the result is
// recorded on that document even when the user switched tabs meanwhile, it
// is applied to the page scales as they are when it finishes (a scale typed
// meanwhile is kept), and nothing is applied when the document was reloaded
// (a page operation) or closed, or when the user cancelled.

import { metPaginaSchaal, kiesPaginaSchaal, herschikSchalen, paginaSchaal, schaalUitGebied } from './pagina-schalen.js';
import { recordPageScales } from '../core/undo-manager.js';
import { state, getActiveDocument } from '../core/state.js';
import { recalculateAllMeasurements } from '../annotations/measurement.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { herkenPagina } from './ocr-engines.js';
import i18next from '../i18n/config.js';

const kloon = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
const ofNull = (schalen) => (schalen && Object.keys(schalen).length ? schalen : null);

function isOpen(doc) {
  return state.documents.some((d) => d === doc || (doc.id != null && d.id === doc.id));
}

/**
 * Measurements on a page use its page scale: recalculate them. That works on
 * the active document; a document in the background is recalculated when its
 * tab comes to the front (tabs.js).
 */
function herbereken(doc) {
  if (getActiveDocument() === doc) {
    try { recalculateAllMeasurements(); } catch (e) { console.warn('[page scales] recalculate', e); }
  } else {
    doc._metingenHerberekenen = true;
  }
}

/** Put `nieuw` on the document as one undo step; nothing happens when nothing changed. */
function zetEnRegistreer(doc, oud, nieuw) {
  if (!recordPageScales(doc, oud, nieuw)) return false;
  doc.pageScales = ofNull(nieuw);
  herbereken(doc);
  return true;
}

/** Set (or clear, ratio null) the scale of `pages`; one undo step. */
export function zetPaginaSchalen(doc, pages, ratio) {
  if (!doc?.pdfDoc || !pages?.length) return false;
  const oud = kloon(doc.pageScales);
  return zetEnRegistreer(doc, oud, ofNull(metPaginaSchaal(oud, pages, ratio, 'manual')));
}

/** Text items of a page as { text } lines. */
async function paginaTekst(doc, pageNum) {
  const page = await doc.pdfDoc.getPage(pageNum);
  const inhoud = await page.getTextContent();
  return (inhoud.items || []).map((i) => ({ text: i.str || '' })).filter((r) => r.text.trim());
}

/**
 * Apply detected scales to the page scales as they are now. A page set by
 * hand keeps its scale unless `overschrijf`.
 * @param {Map<number, {ratio:string, methode:string, alle?:string[]}>} gevonden
 */
function pasGevondenToe(doc, gevonden, overschrijf) {
  const oud = kloon(doc.pageScales);
  let schalen = { ...(oud || {}) };
  for (const [p, g] of gevonden) {
    if (!overschrijf && schalen[p]?.method === 'manual') continue;
    schalen = metPaginaSchaal(schalen, [p], g.ratio, g.methode);
    if (g.alle?.length) schalen[p].alternatives = g.alle;
  }
  zetEnRegistreer(doc, oud, ofNull(schalen));
}

/**
 * Detect the scale of `pages` from their text; pages without text are read
 * with OCR (the built-in engine when no other is installed). Pages set by
 * hand keep their scale unless `overschrijf`. One undo step for the lot.
 * @param {{overschrijf?: boolean, bijVoortgang?: (klaar:number, totaal:number) => void, isAfgebroken?: () => boolean}} [opties]
 * @returns {Promise<{gevonden:number, zonder:number[], ocr:number, afgebroken:boolean}>}
 */
export async function detecteerPaginaSchalen(doc, pages, { overschrijf = false, bijVoortgang, isAfgebroken } = {}) {
  const uit = { gevonden: 0, zonder: [], ocr: 0, afgebroken: false };
  if (!doc?.pdfDoc || !pages?.length) return uit;
  const pdf = doc.pdfDoc;
  const gestopt = () => isAfgebroken?.() || doc.pdfDoc !== pdf || !isOpen(doc);
  const gevonden = new Map();
  for (let i = 0; i < pages.length; i++) {
    if (gestopt()) return { ...uit, afgebroken: true };
    const p = pages[i];
    if (overschrijf || doc.pageScales?.[p]?.method !== 'manual') {
      let regels = [];
      let methode = 'auto-detect';
      try { regels = await paginaTekst(doc, p); } catch {}
      if (!regels.length && !gestopt()) {
        try {
          const woorden = await herkenPagina(doc, p, { lang: 'auto' });
          regels = (woorden || []).map((w) => ({ text: w.text || '' }));
          if (regels.length) methode = 'ocr';
        } catch {}
      }
      if (gestopt()) return { ...uit, afgebroken: true };
      const k = kiesPaginaSchaal(regels);
      if (k) {
        gevonden.set(p, { ratio: `1:${k.ratio}`, methode, alle: k.alle });
        uit.gevonden++;
        if (methode === 'ocr') uit.ocr++;
      } else uit.zonder.push(p);
    }
    bijVoortgang?.(i + 1, pages.length);
  }
  if (gestopt()) return { ...uit, afgebroken: true };
  pasGevondenToe(doc, gevonden, overschrijf);
  return uit;
}

/**
 * Like the sheet-name builder: the user draws a box round the scale in the
 * title block once, and that box is read on every page (text layer, OCR when
 * the box has no text). Pages where the box holds a scale get it, also pages
 * set by hand: the user asked for this. One undo step.
 * @param {{bijVoortgang?: Function, isAfgebroken?: () => boolean, bijStart?: () => void}} [opties]
 *   bijStart: called once the box is drawn, before the pages are read.
 * @returns {Promise<{gevonden:number, zonder:number[], ocr:number, afgebroken:boolean} | null>} null when no box was drawn
 */
export async function detecteerUitGebied(doc, hint, { bijVoortgang, isAfgebroken, bijStart } = {}) {
  if (!doc?.pdfDoc) return null;
  const { kiesLabelGebied } = await import('../tools/tools/label-gebied-tool.js');
  const { leesAllePaginas } = await import('./pagina-labels-app.js');
  const keuze = await kiesLabelGebied(hint);
  if (!keuze?.rect || !(keuze.rect.width > 0) || !(keuze.rect.height > 0)) return null;
  const pdf = doc.pdfDoc;
  const gestopt = () => isAfgebroken?.() || doc.pdfDoc !== pdf || !isOpen(doc);
  bijStart?.();
  const rijen = await leesAllePaginas(doc, [{ n: 1, rect: keuze.rect }], { ocr: true, bijVoortgang, isAfgebroken: gestopt });
  const uit = { gevonden: 0, zonder: [], ocr: 0, afgebroken: false };
  if (gestopt()) return { ...uit, afgebroken: true };
  const gevonden = new Map();
  for (const r of rijen || []) {
    const ratio = schaalUitGebied(r.teksten?.[1]);
    if (!ratio) { uit.zonder.push(r.page); continue; }
    gevonden.set(r.page, { ratio, methode: r.ocr ? 'ocr' : 'auto-detect' });
    if (r.ocr) uit.ocr++;
    uit.gevonden++;
  }
  pasGevondenToe(doc, gevonden, true);
  return uit;
}

/**
 * Run a detection with the progress window (LoadingOverlay): a bar per page
 * and a Cancel button (also Esc). Cancelling applies nothing.
 * @param {(opties: {bijVoortgang: Function, isAfgebroken: () => boolean, bijStart: () => void}) => Promise<any>} werk
 */
export async function metVoortgang(werk) {
  let afgebroken = false;
  let open = false;
  const annuleer = () => { afgebroken = true; };
  const toon = (klaar, totaal) => {
    open = true;
    showLoading(i18next.t('context:thumbnail.detectingPageScales', { done: klaar, total: totaal }),
      { voortgang: totaal > 0 ? klaar / totaal : 0, annuleren: annuleer });
  };
  try {
    return await werk({ bijVoortgang: toon, isAfgebroken: () => afgebroken, bijStart: () => toon(0, 0) });
  } finally {
    if (open) hideLoading();
  }
}

/** Detect the scales of `pages` with the progress window. */
export function detecteerMetVoortgang(doc, pages, opties = {}) {
  return metVoortgang((v) => {
    v.bijStart();
    return detecteerPaginaSchalen(doc, pages, { ...opties, bijVoortgang: v.bijVoortgang, isAfgebroken: v.isAfgebroken });
  });
}

/** Detect the scales from a drawn box, with the progress window once the box is drawn. */
export function detecteerUitGebiedMetVoortgang(doc, hint) {
  return metVoortgang((v) => detecteerUitGebied(doc, hint, v));
}

/** After pages were inserted, deleted or moved: the scales move with their pages. */
export function schalenNaHerladen(doc, pageMapping) {
  if (!doc) return;
  // The scales from before the operation, for its undo step (recordPageStructure).
  doc._paginaSchalenVoorHerladen = kloon(doc.pageScales);
  if (!doc.pageScales || !pageMapping) return;
  doc.pageScales = herschikSchalen(doc.pageScales, pageMapping, doc.pdfDoc?.numPages || 0);
}

export { paginaSchaal };
