// MCP-opdrachten voor paginabewerkingen: draaien, verwijderen, lege pagina's
// invoegen, uitnemen naar een nieuw bestand, herschikken en de inhoud
// verschuiven (app_rotate_pages, app_delete_pages, app_insert_blank_pages,
// app_extract_pages, app_reorder_pages, app_shift_pages).
//
// Elke opdracht controleert de argumenten en roept dan dezelfde functie aan als
// het lint en de dialogen (page-manager.js, pagina-draaien.js, shift-page.js).
// Zo blijven ongedaan maken, annotaties, paginalabels, meetschalen en
// koppelingen precies zoals bij een bewerking met de hand.
//
// `o` is de app; de tests geven een eigen omgeving met de echte page-manager.

import {
  fout, onbekendArgument, bewerkbaarDocument, paginaLijst, geheelGetal, getal, padFout, zelfdePad,
} from '../core/mcp-document-regels.js';

export const DRAAIHOEKEN = [90, 180, 270, -90];
export const MAX_LEGE_PAGINAS = 500;
// De grenzen van een PDF-pagina in punten (PDF 1.7, bijlage C).
export const MIN_PAGINAMAAT_PT = 3;
export const MAX_PAGINAMAAT_PT = 14400;
// Dezelfde grens als de dialoog Pagina verschuiven (shift-page-geometry.js).
export const MAX_VERSCHUIVING_MM = 5080;

async function appOmgeving() {
  const [st, pm, draaien, verschuiven, beveiliging] = await Promise.all([
    import('../core/state.js'),
    import('./page-manager.js'),
    import('./pagina-draaien.js'),
    import('./shift-page.js'),
    import('./wachtwoord-pdf.js'),
  ]);
  return {
    document: st.getActiveDocument,
    alleenLezen: beveiliging.isAlleenLezen,
    paginaRotatie: st.getPageRotation,
    pm,
    draaiPaginas: draaien.draaiPaginas,
    shiftPages: verschuiven.shiftPages,
  };
}

const aantal = (doc) => doc?.pdfDoc?.numPages ?? 0;

/** app_rotate_pages — `pages` over `angle` graden (met de klok mee), als één ongedaan te maken stap. */
export async function rotatePages(params, o) {
  const p = params || {};
  const onbekend = onbekendArgument(p, ['pages', 'angle']);
  if (onbekend) return fout(onbekend);
  if (!DRAAIHOEKEN.includes(p.angle)) return fout('angle must be 90, 180, 270 (clockwise) or -90 (counter-clockwise)');
  o = o || await appOmgeving();
  const { doc, fout: f } = bewerkbaarDocument(o);
  if (f) return f;
  const lijst = paginaLijst(p.pages, aantal(doc));
  if (lijst.error) return fout(lijst.error);
  const pages = [...lijst.pages].sort((a, b) => a - b);
  const gedraaid = await o.draaiPaginas(p.angle, pages);
  if (!gedraaid) return fout('the pages were not rotated');
  return {
    ok: true,
    angle: p.angle,
    pages,
    // De draaiing die de app bovenop de eigen /Rotate van de pagina zet; ze
    // gaat bij opslaan het bestand in.
    rotations: pages.map((page) => ({ page, rotation: o.paginaRotatie(page) })),
  };
}

/** app_delete_pages — nooit alle pagina's. */
export async function deletePages(params, o) {
  const p = params || {};
  const onbekend = onbekendArgument(p, ['pages']);
  if (onbekend) return fout(onbekend);
  o = o || await appOmgeving();
  const { doc, fout: f } = bewerkbaarDocument(o);
  if (f) return f;
  const voor = aantal(doc);
  const lijst = paginaLijst(p.pages, voor);
  if (lijst.error) return fout(lijst.error);
  if (lijst.pages.length >= voor) return fout('cannot delete all pages: a document keeps at least one page');
  const pages = [...lijst.pages].sort((a, b) => a - b);
  await o.pm.deletePages(pages);
  const na = aantal(doc);
  if (na !== voor - pages.length) return fout('the pages were not deleted', { pagesBefore: voor, pagesAfter: na });
  return { ok: true, deleted: pages, pagesBefore: voor, pagesAfter: na, currentPage: doc.currentPage };
}

/**
 * app_insert_blank_pages — `count` lege pagina's na pagina `after` (0: vooraan).
 * Zonder maat: de maat van pagina `after` (of de eerste), zoals "zelfde als de
 * huidige pagina" in de dialoog.
 */
export async function insertBlankPages(params, o) {
  const p = params || {};
  const onbekend = onbekendArgument(p, ['after', 'count', 'widthPt', 'heightPt']);
  if (onbekend) return fout(onbekend);
  o = o || await appOmgeving();
  const { doc, fout: f } = bewerkbaarDocument(o);
  if (f) return f;
  const voor = aantal(doc);
  const na = geheelGetal(p.after, 'after', 0, voor);
  if (na.error) return fout(`${na.error} (0 inserts before the first page)`);
  const tal = geheelGetal(p.count, 'count', 1, MAX_LEGE_PAGINAS, 1);
  if (tal.error) return fout(tal.error);
  if ((p.widthPt === undefined) !== (p.heightPt === undefined)) return fout('give both widthPt and heightPt, or neither');
  let widthPt;
  let heightPt;
  if (p.widthPt !== undefined) {
    const b = getal(p.widthPt, 'widthPt', MIN_PAGINAMAAT_PT, MAX_PAGINAMAAT_PT);
    if (b.error) return fout(b.error);
    const h = getal(p.heightPt, 'heightPt', MIN_PAGINAMAAT_PT, MAX_PAGINAMAAT_PT);
    if (h.error) return fout(h.error);
    widthPt = b.waarde;
    heightPt = h.waarde;
  } else {
    const pagina = await doc.pdfDoc.getPage(Math.max(1, na.waarde));
    const vp = pagina.getViewport({ scale: 1 });
    widthPt = vp.width;
    heightPt = vp.height;
  }
  const positie = na.waarde === 0 ? 'start' : 'after';
  await o.pm.insertBlankPages(positie, Math.max(1, na.waarde), tal.waarde, widthPt, heightPt);
  const daarna = aantal(doc);
  if (daarna !== voor + tal.waarde) return fout('the pages were not inserted', { pagesBefore: voor, pagesAfter: daarna });
  const inserted = Array.from({ length: tal.waarde }, (_, i) => na.waarde + 1 + i);
  return { ok: true, inserted, widthPt, heightPt, pagesBefore: voor, pagesAfter: daarna, currentPage: doc.currentPage };
}

/**
 * app_extract_pages — `pages` (in deze volgorde) naar een NIEUW bestand; een
 * bestaand bestand wordt nooit vervangen. Met deleteFromOriginal gaan ze
 * daarna uit het document (niet als dat alle pagina's zijn).
 */
export async function extractPages(params, o) {
  const p = params || {};
  const onbekend = onbekendArgument(p, ['pages', 'outputPath', 'deleteFromOriginal']);
  if (onbekend) return fout(onbekend);
  const padfout = padFout(p.outputPath, 'outputPath', ['pdf']);
  if (padfout) return fout(padfout);
  if (p.deleteFromOriginal !== undefined && typeof p.deleteFromOriginal !== 'boolean') return fout('deleteFromOriginal must be a boolean');
  const verwijderen = p.deleteFromOriginal === true;
  o = o || await appOmgeving();
  // Zoals de lintknop: niet in een alleen-lezen document. Een met een
  // wachtwoord geopende PDF mag ook niet als (gedeeltelijke) kopie het huis uit.
  const { doc, fout: f } = bewerkbaarDocument(o);
  if (f) return f;
  if (zelfdePad(p.outputPath, doc.filePath) || zelfdePad(p.outputPath, doc.originalFilePath)) {
    return fout('outputPath is the document itself: choose a new file');
  }
  const voor = aantal(doc);
  const lijst = paginaLijst(p.pages, voor);
  if (lijst.error) return fout(lijst.error);
  if (verwijderen && lijst.pages.length >= voor) return fout('cannot delete all pages from the original: leave deleteFromOriginal off or keep a page');
  let verslag;
  try {
    verslag = await o.pm.extractPages(lijst.pages, verwijderen, { savePath: p.outputPath, nieuwBestand: true });
  } catch (e) {
    return fout(`could not write outputPath (it must not exist yet): ${e?.message ?? e}`);
  }
  if (!verslag) return fout('the pages were not extracted');
  return {
    ok: true,
    outputPath: verslag.path,
    pages: lijst.pages,
    pagesExtracted: verslag.pages,
    deletedFromOriginal: verslag.deleted,
    pagesAfter: aantal(doc),
  };
}

/**
 * app_reorder_pages — `order[i]` is de huidige pagina die pagina i+1 wordt:
 * elke pagina precies één keer.
 */
export async function reorderPages(params, o) {
  const p = params || {};
  const onbekend = onbekendArgument(p, ['order']);
  if (onbekend) return fout(onbekend);
  o = o || await appOmgeving();
  const { doc, fout: f } = bewerkbaarDocument(o);
  if (f) return f;
  const totaal = aantal(doc);
  const lijst = paginaLijst(p.order, totaal, 'order');
  if (lijst.error) return fout(lijst.error);
  if (lijst.pages.length !== totaal) {
    return fout(`order must list every page exactly once: the document has ${totaal} pages, order has ${lijst.pages.length}`);
  }
  const order = lijst.pages;
  if (order.every((pagina, i) => pagina === i + 1)) return { ok: true, changed: false, order, pages: totaal, currentPage: doc.currentPage };
  const pdfVoor = doc.pdfDoc;
  await o.pm.reorderPages(order);
  // reorderPages laadt het document opnieuw; anders is er niets gebeurd.
  if (doc.pdfDoc === pdfVoor) return fout('the pages were not reordered');
  return { ok: true, changed: true, order, pages: aantal(doc), currentPage: doc.currentPage };
}

/**
 * app_shift_pages — de inhoud van `pages` verschuiven met dx/dy millimeter,
 * zoals de pagina wordt weergegeven: dx positief naar rechts, dy positief
 * omhoog. Annotaties, koppelingen, formuliervelden en meetschalen gaan mee.
 */
export async function shiftPages(params, o) {
  const p = params || {};
  const onbekend = onbekendArgument(p, ['pages', 'dx', 'dy']);
  if (onbekend) return fout(onbekend);
  const dx = getal(p.dx, 'dx', -MAX_VERSCHUIVING_MM, MAX_VERSCHUIVING_MM, 0);
  if (dx.error) return fout(`${dx.error} (millimetres)`);
  const dy = getal(p.dy, 'dy', -MAX_VERSCHUIVING_MM, MAX_VERSCHUIVING_MM, 0);
  if (dy.error) return fout(`${dy.error} (millimetres)`);
  if (dx.waarde === 0 && dy.waarde === 0) return fout('give a non-zero dx or dy (millimetres)');
  o = o || await appOmgeving();
  const { doc, fout: f } = bewerkbaarDocument(o);
  if (f) return f;
  const lijst = paginaLijst(p.pages, aantal(doc));
  if (lijst.error) return fout(lijst.error);
  const pages = [...lijst.pages].sort((a, b) => a - b);
  let r;
  try {
    r = await o.shiftPages(dx.waarde, dy.waarde, pages);
  } catch (e) {
    return fout(`shift failed: ${e?.message ?? e}`);
  }
  if (!r?.shifted) {
    return fout(r?.reason === 'no-shift'
      ? 'the shift is too small to apply'
      : 'nothing to shift: the pages have no content and no annotations', { reason: r?.reason ?? null });
  }
  return { ok: true, pages, dx: dx.waarde, dy: dy.waarde, shifted: r.shifted };
}
