// Vrijgeven van wat een gesloten document in het geheugen vasthield.
//
// closeTab() haalde het document alleen uit state.documents. Wat er per
// bestandspad gecachet stond, bleef staan: de ruwe bestandsbytes
// (loader.js, voor de saver), de vector-commandobuffers en gedecodeerde
// afbeeldingen van álle pagina's (vector-renderer.js, bij openen voorverwarmd),
// de paginabitmaps (page-bitmap-cache.js), en aan de Rust-kant de bytes, de
// geparsede handles (lopdf én PDFium), thumbnails, paginatypen en pixmaps.
// Ook de PDF.js-instantie werd nooit afgesloten. Na een reeks zware
// tekeningen stond zo ruim 3 GB heap vast die nooit meer vrijkwam.
//
// De beslissing (wat mag weg) is puur en testbaar: een pad is pas vrij te
// geven als geen ander open tabblad hetzelfde bestand gebruikt — twee
// tabbladen op één bestand delen de caches, en een werkkopie na een save
// (saveTargetPath) telt ook als gebruik. De uitvoering (geefDocumentVrij)
// laadt de cache-modules pas op dat moment, zodat deze module zonder DOM
// te testen is.

/** Gebruikt een van de overgebleven documenten dit pad nog? */
export function padNogInGebruik(overgebleven, pad) {
  if (!pad) return false;
  return (overgebleven || []).some(
    (d) => d && (d.filePath === pad || d.saveTargetPath === pad),
  );
}

/**
 * Wat er voor een gesloten document vrijgegeven mag worden.
 * @param {object} gesloten      het document dat net uit state.documents is
 * @param {object[]} overgebleven  de documenten die open blijven
 * @returns {{ paden: string[], memoryKey: string|null, pdfjsVrijgeven: boolean }}
 *   paden: bestandspaden waarvan alle caches weg mogen;
 *   memoryKey: sleutel van de bytes van een nooit-opgeslagen document;
 *   pdfjsVrijgeven: of de PDF.js-instantie afgesloten mag worden.
 */
export function vrijgaveplan(gesloten, overgebleven) {
  const rest = overgebleven || [];
  const paden = [];
  for (const pad of [gesloten?.filePath, gesloten?.saveTargetPath]) {
    if (pad && !paden.includes(pad) && !padNogInGebruik(rest, pad)) paden.push(pad);
  }
  const memoryKey = gesloten?.id != null ? `__memory__${gesloten.id}` : null;
  const pdfjsVrijgeven = !!gesloten?.pdfDoc
    && !rest.some((d) => d && d.pdfDoc === gesloten.pdfDoc);
  return { paden, memoryKey, pdfjsVrijgeven };
}

/** Sleutels van de vorm `<pad>:<...>` die bij dit pad horen. */
export function sleutelsMetPad(sleutels, pad) {
  const prefix = `${pad}:`;
  return Array.from(sleutels).filter((k) => typeof k === 'string' && k.startsWith(prefix));
}

/**
 * Voert het vrijgaveplan uit. Fouten in één stap houden de andere niet
 * tegen: het document is al dicht, dit is opruimen.
 */
export async function geefDocumentVrij(gesloten, overgebleven) {
  const plan = vrijgaveplan(gesloten, overgebleven);

  if (plan.pdfjsVrijgeven) {
    try { await gesloten.pdfDoc.destroy(); } catch (e) { console.warn('[release] PDF.js afsluiten:', e); }
  }

  const [loader, vector, bitmaps, progressief] = await Promise.all([
    import('./loader.js'),
    import('./vector-renderer.js'),
    import('./page-bitmap-cache.js'),
    import('./progressive-render.js'),
  ]);
  if (plan.memoryKey) loader.clearCachedPdfBytes(plan.memoryKey);

  for (const pad of plan.paden) {
    loader.clearCachedPdfBytes(pad);
    vector.invalidateDocumentCache(pad);
    bitmaps.invalidateDocumentBitmaps(pad);
    progressief.forgetContentBytes(pad);
    try {
      const { isTauri, invoke } = await import('../core/platform.js');
      if (isTauri()) await invoke('release_pdf_document', { path: pad });
    } catch (e) {
      console.warn('[release] Rust-caches vrijgeven:', e);
    }
  }
  return plan;
}
