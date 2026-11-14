// Page scales in the app: set them, detect them, keep them with their pages.
// The rules are in pagina-schalen.js.

import { metPaginaSchaal, kiesPaginaSchaal, herschikSchalen, paginaSchaal, schaalUitGebied } from './pagina-schalen.js';
import { recordPageScales } from '../core/undo-manager.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { redrawAnnotations } from '../annotations/rendering.js';
import { herkenPagina } from './ocr-engines.js';

function bijgewerkt(doc, oud) {
  recordPageScales(oud, doc.pageScales);
  markDocumentModified(doc);
  try { redrawAnnotations(); } catch {}
}

/** Set (or clear, ratio null) the scale of `pages`; one undo step. */
export function zetPaginaSchalen(doc, pages, ratio) {
  if (!doc?.pdfDoc || !pages?.length) return;
  const oud = doc.pageScales ? { ...doc.pageScales } : null;
  const nieuw = metPaginaSchaal(doc.pageScales, pages, ratio, 'manual');
  doc.pageScales = Object.keys(nieuw).length ? nieuw : null;
  bijgewerkt(doc, oud);
}

/** Text items of a page as { text } lines. */
async function paginaTekst(doc, pageNum) {
  const page = await doc.pdfDoc.getPage(pageNum);
  const inhoud = await page.getTextContent();
  return (inhoud.items || []).map((i) => ({ text: i.str || '' })).filter((r) => r.text.trim());
}

/**
 * Detect the scale of `pages` from their text; pages without text are read
 * with OCR when an OCR engine is available. Pages set by hand keep their
 * scale unless `overschrijf`. One undo step for the lot.
 * @returns {Promise<{gevonden:number, zonder:number[], ocr:number}>}
 */
export async function detecteerPaginaSchalen(doc, pages, { overschrijf = false, voortgang } = {}) {
  const uit = { gevonden: 0, zonder: [], ocr: 0 };
  if (!doc?.pdfDoc) return uit;
  const oud = doc.pageScales ? { ...doc.pageScales } : null;
  let schalen = { ...(doc.pageScales || {}) };
  const kanOcr = true;   // herkenPagina falls back to the built-in engine
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    voortgang?.(i + 1, pages.length);
    if (!overschrijf && schalen[p]?.method === 'manual') continue;
    let regels = [];
    let methode = 'auto-detect';
    try { regels = await paginaTekst(doc, p); } catch {}
    if (!regels.length && kanOcr) {
      try {
        const woorden = await herkenPagina(doc, p, { lang: 'auto' });
        regels = (woorden || []).map((w) => ({ text: w.text || '' }));
        if (regels.length) { methode = 'ocr'; uit.ocr++; }
      } catch {}
    }
    const gevonden = kiesPaginaSchaal(regels);
    if (gevonden) {
      schalen = metPaginaSchaal(schalen, [p], `1:${gevonden.ratio}`, methode);
      schalen[p].alternatives = gevonden.alle;
      uit.gevonden++;
    } else uit.zonder.push(p);
  }
  doc.pageScales = Object.keys(schalen).length ? schalen : null;
  bijgewerkt(doc, oud);
  return uit;
}

/**
 * Like the sheet-name builder: the user draws a box round the scale in the
 * title block once, and that box is read on every page (text layer, OCR when
 * the box has no text). Pages where the box holds a scale get it, also pages
 * set by hand: the user asked for this. One undo step.
 * @returns {Promise<{gevonden:number, zonder:number[], ocr:number} | null>} null when cancelled
 */
export async function detecteerUitGebied(doc, hint) {
  if (!doc?.pdfDoc) return null;
  const { kiesLabelGebied } = await import('../tools/tools/label-gebied-tool.js');
  const { leesAllePaginas } = await import('./pagina-labels-app.js');
  const keuze = await kiesLabelGebied(hint);
  if (!keuze?.rect || !(keuze.rect.width > 0) || !(keuze.rect.height > 0)) return null;
  const rijen = await leesAllePaginas(doc, [{ n: 1, rect: keuze.rect }], { ocr: true });
  const uit = { gevonden: 0, zonder: [], ocr: 0 };
  const oud = doc.pageScales ? { ...doc.pageScales } : null;
  let schalen = { ...(doc.pageScales || {}) };
  for (const r of rijen) {
    const ratio = schaalUitGebied(r.teksten?.[1]);
    if (!ratio) { uit.zonder.push(r.page); continue; }
    schalen = metPaginaSchaal(schalen, [r.page], ratio, r.ocr ? 'ocr' : 'auto-detect');
    if (r.ocr) uit.ocr++;
    uit.gevonden++;
  }
  doc.pageScaleArea = { rect: keuze.rect, page: keuze.page };
  doc.pageScales = Object.keys(schalen).length ? schalen : null;
  bijgewerkt(doc, oud);
  return uit;
}

/** After pages were inserted, deleted or moved: the scales move with their pages. */
export function schalenNaHerladen(doc, pageMapping) {
  if (!doc) return;
  // The scales from before the operation, for its undo step (recordPageStructure).
  doc._paginaSchalenVoorHerladen = doc.pageScales ? JSON.parse(JSON.stringify(doc.pageScales)) : null;
  if (!doc.pageScales || !pageMapping) return;
  doc.pageScales = herschikSchalen(doc.pageScales, pageMapping, doc.pdfDoc?.numPages || 0);
}

export { paginaSchaal };
