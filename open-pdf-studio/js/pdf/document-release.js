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

import { renderQueue } from './render-queue.js';

/** Gebruikt een van de overgebleven documenten dit pad nog? */
export function padNogInGebruik(overgebleven, pad) {
  if (!pad) return false;
  return (overgebleven || []).some(
    (d) => d && (d.filePath === pad || d.saveTargetPath === pad),
  );
}

// ── Tijdelijke werkbestanden ───────────────────────────────────────────────
// Een geïmporteerde tekening opent uit een tijdelijke PDF (`opds-import-…`),
// na een paginabewerking rendert een document uit een nieuw werkbestand
// (`opds-edit-…`), en met geschakelde lagen uit een weergavekopie
// (`opds-lagen-…`, #684). Elk document onthoudt welke van die bestanden het heeft
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
  return /^opds-(import|edit|lagen)-\d{10,}[^\\/]*\.pdf$/i.test(naam);
}

/**
 * Hoe oud (in ms) is dit werkbestand volgens de tijd in zijn naam? `null` als
 * het geen werkbestand van de app is. De opruiming bij de start gebruikt dit
 * voor wat van een vorige keer is blijven staan: de PDF van een import én de
 * werkkopieën van paginabewerkingen (`opds-edit-…`).
 */
export function ouderdomWerkbestand(naam, nu = Date.now()) {
  if (!isWerkbestand(naam)) return null;
  const match = /^opds-(?:import|edit|lagen)-(\d{10,})/i.exec(String(naam).split(/[\\/]/).pop());
  return match ? nu - Number(match[1]) : null;
}

/** Onthoudt bij het document een werkbestand dat de app ervoor heeft gemaakt. */
export function onthoudWerkbestand(doc, pad) {
  if (!doc || !isWerkbestand(pad)) return;
  const lijst = Array.isArray(doc._werkbestanden) ? doc._werkbestanden : [];
  if (!lijst.includes(pad)) doc._werkbestanden = [...lijst, pad];
}

// Werkbestanden waar de app nu nog uit tekent zonder dat het document ernaar
// verwijst: de weergavekopie van geschakelde lagen (#684). Die blijven staan
// tot de lagenstand ze loslaat of het tabblad sluit.
const vastgehouden = new Set();

/** Dit werkbestand is in gebruik, ook al verwijst het document er niet naar. */
export function houdWerkbestandVast(pad) {
  if (pad) vastgehouden.add(pad);
}

/** Niet langer vasthouden (zie houdWerkbestandVast). */
export function laatWerkbestandLos(pad) {
  vastgehouden.delete(pad);
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
    (pad) => isWerkbestand(pad) && pad !== doc.filePath && pad !== doc.saveTargetPath
      && !vastgehouden.has(pad) && !werkbestandInGebruik(andere, pad),
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

/**
 * Haalt alles wat per bestandspad gecachet staat weg, in de webview en in Rust.
 * `renders`: ook het renderwerk van dit pad laten vallen (zie
 * geefDocumentVrij, dat dat zelf al vooraf doet).
 */
async function geefPadVrij(pad, renders = true) {
  // Renders die nog wachten vervallen; wat nog loopt wordt bij aankomst
  // weggegooid, zodat geen late bitmap de net geleegde caches weer vult (#506).
  if (renders) renderQueue.releaseDocument(pad);
  const [loader, vector, bitmaps, progressief, weergave, tegels, renderer, snap] = await Promise.all([
    import('./loader.js'),
    import('./vector-renderer.js'),
    import('./page-bitmap-cache.js'),
    import('./progressive-render.js'),
    import('./weergave-per-document.js'),
    import('./tile-cache.js'),
    import('./renderer.js'),
    import('../tools/pdf-snap-extractor.js'),
  ]);
  loader.clearCachedPdfBytes(pad);
  vector.invalidateDocumentCache(pad);
  bitmaps.invalidateDocumentBitmaps(pad);
  progressief.forgetContentBytes(pad);
  // De tegels van hoge zoom, de JS-bitmapcache en de voorvertoningen bleven
  // na sluiten staan zolang er een ander tabblad open was (ImageBitmaps en
  // canvassen, buiten de JS-heap maar wel in het geheugen van de WebView), en
  // de snap-geometrie van de tekening ook (#705).
  tegels.tileCacheClearForFile(pad);
  renderer.clearBitmapJSCacheForFile(pad);
  renderer.clearLowResCacheForFile(pad);
  snap.vergeetSnapGeometrie(pad);
  // Bewaarde zoom/uitsnede van de tabwissel (#539): opnieuw openen begint
  // gewoon passend.
  weergave.vergeetWeergaveStand(pad);
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
      laatWerkbestandLos(pad);
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
 * @param {object} gesloten
 * @param {object[]} overgebleven
 * @param {{klembord?: unknown[]}} [opties]  klembord: gekopieerde annotaties,
 *   die de inhoud van hun bijlage nog nodig hebben
 */
export async function geefDocumentVrij(gesloten, overgebleven, { klembord = [] } = {}) {
  const plan = vrijgaveplan(gesloten, overgebleven);
  // Meteen, vóór de eerste await: het renderwerk van dit document laat de
  // pagina van het volgende document anders wachten (#506).
  for (const pad of plan.paden) renderQueue.releaseDocument(pad);

  // De bestanden achter bijlage-annotaties (#376) van dit document.
  try {
    const { geefBijlagenVrij } = await import('../annotations/bijlage-store.js');
    geefBijlagenVrij(gesloten, overgebleven, klembord);
  } catch (e) { console.warn('[release] bijlage-inhoud vrijgeven:', e); }

  // Tijdelijke documenten van de live Type3-weergave (#723).
  try {
    const { vergeetType3Voorbeelden } = await import('../text/type3-voorbeeld.js');
    vergeetType3Voorbeelden(gesloten);
  } catch (e) { console.warn('[release] Type3-voorbeelden:', e); }

  // De paginabeelden van het tweede paneel van de gesplitste weergave (#715):
  // de PDF.js-canvassen houden het document vast, ook na afsluiten.
  try {
    const { vergeetPaneelBeelden } = await import('./split-view/paneel-bitmaps.js');
    vergeetPaneelBeelden(gesloten);
  } catch (e) { console.warn('[release] beelden van het tweede paneel:', e); }

  if (plan.pdfjsVrijgeven) {
    try { await (gesloten.pdfDoc.loadingTask || gesloten.pdfDoc).destroy(); } catch (e) { console.warn('[release] PDF.js afsluiten:', e); }
  }

  if (plan.memoryKey) {
    const [loader, snap] = await Promise.all([import('./loader.js'), import('../tools/pdf-snap-extractor.js')]);
    loader.clearCachedPdfBytes(plan.memoryKey);
    snap.vergeetSnapGeometrie(plan.memoryKey);
  }
  for (const pad of plan.paden) await geefPadVrij(pad, false);
  // Pas nu de tijdelijke werkbestanden zelf: niets leest er nog uit.
  try { await ruimWerkbestandenOp(gesloten, plan.werkbestanden); } catch (e) { console.warn('[release] werkbestanden opruimen:', e); }
  return plan;
}
