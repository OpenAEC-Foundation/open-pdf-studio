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

// ── Tijdelijke werkbestanden ───────────────────────────────────────────────
// Een geïmporteerde tekening opent uit een tijdelijke PDF (`opds-import-…`) en
// na een paginabewerking rendert een document uit een nieuw werkbestand
// (`opds-edit-…`). Elk document onthoudt welke van die bestanden het heeft
// gebruikt; waar het niet meer naar verwijst hoort meteen weg, en bij sluiten
// alles. Lukt het verwijderen niet (het bestand is nog even in gebruik), dan
// blijft het onthouden en komt het bij de volgende gelegenheid opnieuw aan de
// beurt, in plaats van te blijven staan tot de opruiming van de volgende dag.

/**
 * Is dit een tijdelijk werkbestand dat de app zelf heeft gemaakt? Alleen op
 * de naam, en streng: een bestand van de gebruiker mag hier nooit voor
 * doorgaan, want wat hier doorheen komt wordt verwijderd.
 */
export function isWerkbestand(pad) {
  const naam = String(pad || '').split(/[\\/]/).pop();
  return /^opds-(import|edit)-\d{10,}[^\\/]*\.pdf$/i.test(naam);
}

/**
 * Hoe oud (in ms) is dit werkbestand volgens de tijd in zijn naam? `null` als
 * het geen werkbestand van de app is. De opruiming bij de start gebruikt dit
 * voor wat van een vorige keer is blijven staan: de PDF van een import én de
 * werkkopieën van paginabewerkingen (`opds-edit-…`).
 */
export function ouderdomWerkbestand(naam, nu = Date.now()) {
  if (!isWerkbestand(naam)) return null;
  const match = /^opds-(?:import|edit)-(\d{10,})/i.exec(String(naam).split(/[\\/]/).pop());
  return match ? nu - Number(match[1]) : null;
}

/** Onthoudt bij het document een werkbestand dat de app ervoor heeft gemaakt. */
export function onthoudWerkbestand(doc, pad) {
  if (!doc || !isWerkbestand(pad)) return;
  const lijst = Array.isArray(doc._werkbestanden) ? doc._werkbestanden : [];
  if (!lijst.includes(pad)) doc._werkbestanden = [...lijst, pad];
}

/** Het werkbestand is weg (of was al weg): niet langer onthouden. */
export function vergeetWerkbestand(doc, pad) {
  if (!doc || !Array.isArray(doc._werkbestanden)) return;
  doc._werkbestanden = doc._werkbestanden.filter((p) => p !== pad);
}

/** Gebruikt een van deze documenten het werkbestand nog? */
function werkbestandInGebruik(documenten, pad) {
  return padNogInGebruik(documenten, pad)
    || (documenten || []).some((d) => Array.isArray(d?._werkbestanden) && d._werkbestanden.includes(pad));
}

/**
 * Werkbestanden van een open document waar het niet meer naar verwijst en die
 * geen ander open document gebruikt: die kunnen nu weg.
 * @param {object} doc       het document (nog open)
 * @param {object[]} andere  de andere open documenten
 * @returns {string[]}
 */
export function losgelatenWerkbestanden(doc, andere) {
  return (Array.isArray(doc?._werkbestanden) ? doc._werkbestanden : []).filter(
    (pad) => isWerkbestand(pad) && pad !== doc.filePath && pad !== doc.saveTargetPath && !werkbestandInGebruik(andere, pad),
  );
}

/**
 * Wat er voor een gesloten document vrijgegeven mag worden.
 * @param {object} gesloten      het document dat net uit state.documents is
 * @param {object[]} overgebleven  de documenten die open blijven
 * @returns {{ paden: string[], memoryKey: string|null, pdfjsVrijgeven: boolean, werkbestanden: string[] }}
 *   paden: bestandspaden waarvan alle caches weg mogen;
 *   memoryKey: sleutel van de bytes van een nooit-opgeslagen document;
 *   pdfjsVrijgeven: of de PDF.js-instantie afgesloten mag worden;
 *   werkbestanden: tijdelijke werkbestanden van dit document die van schijf
 *   mogen (geen ander open document gebruikt ze nog).
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
  const werkbestanden = (Array.isArray(gesloten?._werkbestanden) ? gesloten._werkbestanden : [])
    .filter((pad) => isWerkbestand(pad) && !werkbestandInGebruik(rest, pad));
  return { paden, memoryKey, pdfjsVrijgeven, werkbestanden };
}

/** Sleutels van de vorm `<pad>:<...>` die bij dit pad horen. */
export function sleutelsMetPad(sleutels, pad) {
  const prefix = `${pad}:`;
  return Array.from(sleutels).filter((k) => typeof k === 'string' && k.startsWith(prefix));
}

/** Haalt alles wat per bestandspad gecachet staat weg, in de webview en in Rust. */
async function geefPadVrij(pad) {
  const [loader, vector, bitmaps, progressief] = await Promise.all([
    import('./loader.js'),
    import('./vector-renderer.js'),
    import('./page-bitmap-cache.js'),
    import('./progressive-render.js'),
  ]);
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

/** Waarmee de app een werkbestand loslaat en verwijdert; null zonder schijftoegang. */
function schijfMiddelen() {
  const fs = typeof window !== 'undefined' ? window.__TAURI__?.fs : null;
  if (!fs?.remove) return null;
  return {
    geefVrij: geefPadVrij,
    ontgrendel: async (pad) => {
      const { unlockFile } = await import('../core/platform.js');
      await unlockFile(pad);
    },
    verwijder: (pad) => fs.remove(pad),
    bestaat: fs.exists ? (pad) => fs.exists(pad) : null,
  };
}

/**
 * Verwijdert tijdelijke werkbestanden van schijf, na het vrijgeven van wat er
 * per pad gecachet stond en van de vergrendeling die de app er zelf op zette.
 * Wat weg is (of al weg was) wordt vergeten; wat nog in gebruik is blijft
 * onthouden voor de volgende keer.
 *
 * De vergrendeling: elk bestand dat de app opent, houdt zij vast met
 * `lock_file` (alleen lezen gedeeld, dus ook niet te verwijderen), en het
 * sluiten van een tabblad haalt die er alleen af voor het pad waar het
 * document dán naar verwijst. Na een paginabewerking is dat de werkkopie, niet
 * meer de PDF van de import: die bleef zo vergrendeld staan tot de app sloot.
 *
 * @param {object} doc      het document dat ze onthoudt
 * @param {string[]} paden  uit `losgelatenWerkbestanden` of het vrijgaveplan
 * @param {object|null} [middelen]  voor de test: `geefVrij`, `ontgrendel`,
 *   `verwijder` en `bestaat`; standaard de schijf van de app
 * @returns {Promise<number>} aantal verwijderde bestanden
 */
export async function ruimWerkbestandenOp(doc, paden, middelen = schijfMiddelen()) {
  if (!middelen?.verwijder) return 0;
  let weg = 0;
  for (const pad of paden || []) {
    if (!isWerkbestand(pad)) continue;
    try { await middelen.geefVrij?.(pad); } catch (e) { console.warn('[release] caches van werkbestand:', e); }
    try { await middelen.ontgrendel?.(pad); } catch (e) { console.warn('[release] werkbestand ontgrendelen:', e); }
    try {
      await middelen.verwijder(pad);
      vergeetWerkbestand(doc, pad);
      weg += 1;
    } catch {
      // Al weg? Dan hoeft het ook niet meer onthouden te worden.
      try {
        if (middelen.bestaat && !(await middelen.bestaat(pad))) vergeetWerkbestand(doc, pad);
      } catch { /* blijft onthouden */ }
    }
  }
  return weg;
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

  if (plan.memoryKey) {
    const loader = await import('./loader.js');
    loader.clearCachedPdfBytes(plan.memoryKey);
  }
  for (const pad of plan.paden) await geefPadVrij(pad);
  // Pas nu de tijdelijke werkbestanden zelf: niets leest er nog uit.
  try { await ruimWerkbestandenOp(gesloten, plan.werkbestanden); } catch (e) { console.warn('[release] werkbestanden opruimen:', e); }
  return plan;
}
