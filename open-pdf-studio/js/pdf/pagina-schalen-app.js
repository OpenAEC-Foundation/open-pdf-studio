// Page scales in the app: set them, detect them, keep them with their pages.
// The rules are in pagina-schalen.js.

import { metPaginaSchaal, kiesPaginaSchaal, herschikSchalen, paginaSchaal } from './pagina-schalen.js';
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

/** After pages were inserted, deleted or moved: the scales move with their pages. */
export function schalenNaHerladen(doc, pageMapping) {
  if (!doc?.pageScales || !pageMapping) return;
  doc.pageScales = herschikSchalen(doc.pageScales, pageMapping, doc.pdfDoc?.numPages || 0);
}

export { paginaSchaal };
