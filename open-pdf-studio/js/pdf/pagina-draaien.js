// Pagina's draaien als één stap die Ctrl+Z helemaal terugzet (#464).
//
// De draaiknoppen op het lint en de sneltoets draaiden alleen de huidige
// pagina, ook als er in de miniaturen meer pagina's geselecteerd waren. Het
// contextmenu van de miniaturen draaide ze wel allemaal, maar legde geen
// ongedaan-maakstap vast. En de stap die wél werd vastgelegd, bevatte alleen de
// draaihoek: rotatePage() draait ook de annotaties van de pagina en de
// meetschalen uit de PDF (/VP) mee, en Ctrl+Z liet die in de gedraaide stand
// staan. Een rechthoek op een A4 belandde zo naast de pagina.
//
// Hier komen per pagina de draaihoek, de meetschalen en de oude en nieuwe
// stand van haar annotaties in één transactie. Getekend wordt één keer, aan
// het eind, op de pagina die de gebruiker bekijkt.

/**
 * Welke pagina's draait een draaiknop? Meer dan één miniatuur geselecteerd,
 * met het miniaturenpaneel open: die pagina's. Anders de huidige pagina; een
 * selectie in een dicht paneel ziet de gebruiker niet.
 */
export function teDraaienPaginas({ huidige, selectie = [], miniaturenZichtbaar = false, aantal = Infinity }) {
  const geldig = (p) => Number.isInteger(p) && p >= 1 && p <= aantal;
  const gekozen = [...new Set(selectie)].filter(geldig).sort((a, b) => a - b);
  if (miniaturenZichtbaar && gekozen.length > 1) return gekozen;
  return geldig(huidige) ? [huidige] : [];
}

async function appOmgeving() {
  const [st, renderer, undo, factory] = await Promise.all([
    import('../core/state.js'),
    import('./renderer.js'),
    import('../core/undo-manager.js'),
    import('../annotations/factory.js'),
  ]);
  return {
    document: () => st.getActiveDocument(),
    paginaRotatie: (p) => st.getPageRotation(p),
    draaiPagina: (delta, p) => renderer.rotatePage(delta, p, { tekenen: false }),
    legRotatieVast: undo.recordPageRotation,
    legAnnotatiesVast: undo.recordBulkModify,
    kloon: factory.cloneAnnotation,
    beginTransactie: undo.beginUndoTransaction,
    eindTransactie: undo.endUndoTransaction,
    tekenOpnieuw: renderer.tekenNaPaginaRotatie,
  };
}

/**
 * Draai `paginas` over `delta` graden als één ongedaan te maken stap.
 * @param {number} delta  graden, veelvoud van 90
 * @param {number[]} paginas  paginanummers (vanaf 1)
 * @param {object} [omgeving]  de app zelf; de tests geven een nagebootste
 * @returns {Promise<boolean>} of er gedraaid is
 */
export async function draaiPaginas(delta, paginas, omgeving) {
  if (!paginas?.length) return false;
  const o = omgeving || await appOmgeving();
  const doc = o.document();
  if (!doc) return false;
  o.beginTransactie();
  try {
    for (const p of paginas) {
      const annotaties = (doc.annotations || []).filter((a) => a.page === p);
      const voorheen = annotaties.map(o.kloon);
      const oudeRotatie = o.paginaRotatie(p);
      const oudeViewports = doc.pdfViewports?.[p];
      await o.draaiPagina(delta, p);
      o.legRotatieVast(p, oudeRotatie, o.paginaRotatie(p), { oud: oudeViewports, nieuw: doc.pdfViewports?.[p] });
      if (annotaties.length) o.legAnnotatiesVast(annotaties, voorheen);
    }
  } finally {
    o.eindTransactie();
    await o.tekenOpnieuw();
  }
  return true;
}

/** De draaiknoppen (lint, sneltoets, mobiel): de selectie of de huidige pagina. */
export async function draaiVanafKnop(delta) {
  const [st, miniaturen, paneel] = await Promise.all([
    import('../core/state.js'),
    import('../solid/stores/panels/thumbnailStore.js'),
    import('../solid/stores/leftPanelStore.js'),
  ]);
  const doc = st.getActiveDocument();
  if (!doc?.pdfDoc) return false;
  return draaiPaginas(delta, teDraaienPaginas({
    huidige: doc.currentPage || 1,
    selectie: miniaturen.getSelectedPagesArray(),
    miniaturenZichtbaar: paneel.activeTab() === 'thumbnails' && !paneel.collapsed(),
    aantal: doc.pdfDoc.numPages,
  }));
}
