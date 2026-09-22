// Import van DWG en DXF (#400): verbindt het importvenster met de Tauri-
// commando's van de crate open-pdf-cad en zet de gemaakte PDF in de app.
// De rekenregels staan in cad-import-logica.js (unit-getest), het venster in
// CadImportDialog.jsx.

import { invoke, isTauri, openFileDialog, openFolderDialog } from '../core/platform.js';
import { state, getNextUntitledName, getActiveDocument } from '../core/state.js';
import { createTab, updateWindowTitle, markDocumentModified } from '../ui/chrome/tabs.js';
import { loadPDF } from './loader.js';
import { fitPage } from './renderer.js';
import { pdfNaamVoor, mapVan, isCadTekening, maakWachtrij } from './cad-import-logica.js';
import { onthoudWerkbestand, ouderdomWerkbestand } from './document-release.js';
import {
  dekkingUitProcent, onderleggerFactor, onderleggerVak, paginaNoemer, rasterPlanVoorVak, witNaarDoorzichtig,
} from './cad-import-plaatsing.js';

let volgnummer = 0;

/** Uniek kenmerk voor een verkenning of import (om af te breken). */
export function nieuwJobId(soort) {
  volgnummer += 1;
  return `${soort}-${Date.now()}-${volgnummer}`;
}

/** Tekeningen die nog aan de beurt zijn (meerdere bestanden tegelijk). */
const wachtrij = maakWachtrij();

/**
 * Opent het importvenster voor een tekening als het pad een DWG of DXF is.
 * Openen, slepen en de MCP-koppeling gebruiken dit, zodat een tekening overal
 * hetzelfde venster krijgt.
 *
 * Er kan er maar een tegelijk open: staat het venster al open, dan gaat de
 * tekening in de wachtrij (`'queued'`) - of, met `wachten: false`, komt er
 * `'busy'` terug zodat de aanroeper het zelf kan melden.
 * @returns {Promise<false | true | 'queued' | 'busy'>} false = geen tekening
 */
export async function openAlsCadTekening(pad, { wachten = true } = {}) {
  if (!isCadTekening(pad)) return false;
  const { openDialog, getDialogs } = await import('../solid/stores/dialogStore.js');
  if (getDialogs().some((d) => d.name === 'cad-import')) {
    if (!wachten) return 'busy';
    wachtrij.voegToe(pad);
    return 'queued';
  }
  openDialog('cad-import', { path: pad });
  return true;
}

/** Opent de volgende tekening uit de wachtrij, als die er is. */
export async function volgendeTekening() {
  const pad = wachtrij.volgende();
  if (!pad) return false;
  const { openDialog } = await import('../solid/stores/dialogStore.js');
  openDialog('cad-import', { path: pad });
  return true;
}

/** Aantal tekeningen dat nog wacht. */
export function aantalInWachtrij() {
  return wachtrij.lengte;
}

/** Meldt elke wijziging van dat aantal; geeft de afmeldfunctie terug. */
export function luisterWachtrij(cb) {
  return wachtrij.luister(cb);
}

/** Bestandskeuze voor een tekening. */
export function kiesTekening(defaultPath) {
  return openFileDialog(['dwg', 'dxf'], defaultPath ? { defaultPath } : {});
}

/**
 * Leest de tekening en geeft de verkenning voor het venster. Met zoekpaden
 * zoekt de verkenning externe bestanden ook in die mappen.
 */
export function verkenTekening(jobId, pad, zoekpaden = []) {
  return invoke('scan_cad_file', { jobId, path: pad, searchPaths: zoekpaden });
}

/**
 * Zoekt de externe bestanden van de al gelezen tekening opnieuw, met andere
 * zoekpaden. De tekening wordt niet opnieuw gelezen en de lagenkeuze blijft
 * staan. Geeft `{ externals, externalsTruncated }`.
 */
export function zoekBuitenBestanden(jobId, pad, zoekpaden = []) {
  return invoke('locate_cad_externals', { jobId, path: pad, searchPaths: zoekpaden });
}

/** Welke zoekpaden bestaan (nog) als map? Eén booleaan per pad. */
export async function controleerZoekpaden(zoekpaden) {
  if (!zoekpaden?.length) return [];
  try {
    const uitkomst = await invoke('check_cad_search_paths', { paths: zoekpaden });
    return Array.isArray(uitkomst) ? uitkomst.map((ok) => ok === true) : zoekpaden.map(() => true);
  } catch {
    // Zonder antwoord geen valse melding; de omzetter controleert zelf ook.
    return zoekpaden.map(() => true);
  }
}

/** De grenzen van de omzetter (`cad_import_limits`), of null buiten de app. */
export async function importGrenzen() {
  try {
    const grenzen = await invoke('cad_import_limits');
    return grenzen && typeof grenzen === 'object' ? grenzen : null;
  } catch {
    return null;
  }
}

/** Laat de gebruiker een map kiezen om verwijzingen en afbeeldingen in te zoeken. */
export async function kiesZoekpad(titel) {
  const gekozen = await openFolderDialog(titel);
  return typeof gekozen === 'string' && gekozen.trim() ? gekozen : null;
}

/** Zet de tekening om naar een PDF; geeft het importverslag terug. */
export function importeerTekening(jobId, args) {
  return invoke('import_cad_to_pdf', { jobId, args });
}

/**
 * Zet de tekening om naar een tijdelijke PDF voor de voorbeeldweergave. De app
 * kiest zelf het bestand (in haar cachemap); het pad staat in het verslag
 * (`outputPath`). Altijd in voorbeeldstand.
 */
export function voorbeeldTekening(jobId, args) {
  return invoke('preview_cad_import', { jobId, args });
}

/** Gooit een voorbeeld weg dat vervangen is (alleen een bestand van deze sessie). */
export function gooiVoorbeeldWeg(pad) {
  if (!pad) return Promise.resolve(false);
  return invoke('discard_cad_preview', { path: pad }).catch(() => false);
}

/**
 * Rastert de eerste pagina van een PDF op schijf, via dezelfde route als de
 * voorvertoning van een vectorknipsel.
 * @param {string} pad
 * @param {number} breedtePt  paginabreedte in punten
 * @param {number} hoogtePt   paginahoogte in punten
 * @param {number} schaal     beeldpunten per punt
 * @returns {Promise<ImageBitmap|null>}
 */
export async function tekenPdfNaarBitmap(pad, breedtePt, hoogtePt, schaal) {
  const { rasterVanPad } = await import('../annotations/vector-snippet-preview.js');
  return rasterVanPad(pad, { x: 0, y: 0, width: breedtePt, height: hoogtePt }, schaal);
}

/** Breekt een lopende verkenning of import af. */
export function annuleerImport(jobId) {
  if (!jobId) return Promise.resolve(false);
  return invoke('cancel_cad_import', { jobId }).catch(() => false);
}

/** Laat de vastgehouden tekening los (venster sluit). */
export function laatTekeningLos() {
  return invoke('release_cad_import').catch(() => false);
}

/**
 * Luistert naar de voortgang van imports. Geeft een functie terug die het
 * luisteren weer stopt.
 * @param {(p: {jobId:string, phase:string, done:number, total:number}) => void} cb
 */
export async function luisterImportVoortgang(cb) {
  const ev = window.__TAURI__?.event;
  if (!ev?.listen) return () => {};
  const stop = await ev.listen('cad-import-progress', (e) => cb(e.payload));
  return () => { try { stop(); } catch { /* al gestopt */ } };
}

/** Een map met scheidingsteken aan het eind. */
const metScheiding = (map) => (map.endsWith('\\') || map.endsWith('/') ? map : `${map}/`);

/**
 * De afgeschermde map van de app voor import-PDF's (`cad_import_dir`: per
 * gebruiker, op Unix 0700). Lukt dat niet, dan de tijdelijke map van het
 * systeem, zoals vroeger. Null buiten de app.
 */
export async function importMap() {
  if (!isTauri()) return null;
  try {
    const map = await invoke('cad_import_dir');
    if (typeof map === 'string' && map) return metScheiding(map);
  } catch { /* geen cachemap: de tijdelijke map */ }
  const tempDir = window.__TAURI__?.path?.tempDir;
  return tempDir ? metScheiding(await tempDir()) : null;
}

/**
 * Pad voor de PDF die de import maakt: in de afgeschermde importmap van de
 * app. Niet in de gedeelde tijdelijke map van het systeem: daar is het
 * bestand met een voorspelbare naam voor elke lokale gebruiker leesbaar
 * zolang het tabblad open staat.
 */
export async function tijdelijkPdfPad(bron) {
  const naam = pdfNaamVoor(bron);
  const map = await importMap();
  if (map) {
    const pad = `${map}opds-import-${Date.now()}-${naam}`;
    try { await invoke('allow_fs_scope', { path: pad }); } catch { /* buiten het bereik, de schrijver doet het zelf */ }
    return pad;
  }
  return `${mapVan(bron)}${naam}`;
}

/**
 * Opent een PDF die de import maakte als naamloos document, net als een nieuw
 * of uit een sjabloon gemaakt document: Opslaan vraagt straks om een plek.
 * @param {string} pad        pad van de gemaakte PDF
 * @param {string} tekening   pad van de tekening (voor de naam op de tab)
 */
export async function openImportAlsNieuwDocument(pad, tekening) {
  try { await invoke('allow_fs_scope', { path: pad }); } catch { /* best effort */ }
  const { index } = createTab(pad);
  const doc = state.documents[index];
  if (doc) doc.isUntitled = true;
  // De tijdelijke PDF hoort bij dit tabblad: zodra het document er niet meer
  // naar verwijst (paginabewerking, opslaan onder een naam) of het tabblad
  // sluit, gaat hij weg (document-release.js).
  onthoudWerkbestand(doc, pad);
  await loadPDF(pad, index);
  if (doc) {
    doc.fileName = pdfNaamVoor(tekening) || getNextUntitledName();
    doc.importedFrom = tekening;
  }
  markDocumentModified();
  try { await fitPage(); } catch { /* past zich later vanzelf */ }
  updateWindowTitle();
  return doc;
}

/**
 * Voegt de pagina's van de gemaakte PDF achter de huidige pagina van het
 * actieve document, inclusief de PDF-lagen (OCG's) van die pagina's. Het
 * tijdelijke bestand is daarna niet meer nodig.
 */
export async function voegImportToeAanDocument(pad) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) throw new Error('geen document open');
  const { insertPagesFromFile } = await import('./page-manager.js');
  let gelukt = false;
  try {
    // Stil: het importvenster toont de mislukking zelf; een los
    // meldingsvenster erbij zou dezelfde fout twee keer melden.
    gelukt = await insertPagesFromFile(doc.currentPage || 1, 'after', pad, { stil: true });
  } finally {
    await ruimOp(pad);
  }
  // Mislukt het invoegen, dan hoort het venster open te blijven met de fout.
  if (!gelukt) throw new Error('IMPORT_INSERT_FAILED');
  return doc;
}

const PT_PER_MM = 72 / 25.4;

/** Maat van een pagina van het document in punten, zoals zij getoond wordt. */
async function paginaMaatPt(doc, paginaNr) {
  try {
    const pagina = await doc.pdfDoc.getPage(paginaNr);
    const vp = pagina.getViewport({ scale: 1 });
    return vp.width > 0 && vp.height > 0 ? { breedte: vp.width, hoogte: vp.height } : null;
  } catch {
    return null;
  }
}

/**
 * De schaalnoemer van de meetschaal op de huidige pagina van het actieve
 * document (in het midden van de pagina), of null als de pagina er geen heeft.
 * Het venster toont daarmee of "op schaal" kan.
 */
export async function meetschaalHuidigePagina() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  const paginaNr = doc.currentPage || 1;
  const maat = await paginaMaatPt(doc, paginaNr);
  if (!maat) return null;
  try {
    const { getMeasureScale } = await import('../annotations/measurement.js');
    return paginaNoemer(getMeasureScale(paginaNr, maat.breedte / 2, maat.hoogte / 2));
  } catch {
    return null;
  }
}

function hertekenAnnotaties(doc) {
  return import('../annotations/rendering.js').then(({ redrawAnnotations, redrawContinuous }) => {
    if (doc?.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
  }).catch(() => {});
}

/**
 * Rastert het blad in stroken en maakt er een PNG van met doorzichtig papier.
 * Dezelfde renderroute als de voorvertoning; de stroken houden elk verzoek
 * binnen het gedeelde geheugen van de renderer. De beeldpunten volgen de
 * maat van het vak op de pagina, zodat de gekozen resolutie op de pagina
 * geldt en niet op het blad (dat op schaal groter of kleiner wordt).
 * @param {{width:number, height:number, factor:number}} vak  uit `onderleggerVak`
 * @returns {Promise<{img: HTMLImageElement, dataUrl: string, plan: object}>}
 */
async function rasterBlad(pad, bladPt, vak, dpi) {
  const plan = rasterPlanVoorVak(vak, dpi);
  if (!plan) throw new Error('IMPORT_INSERT_FAILED');
  const { rasterBytesVanPad } = await import('../annotations/vector-snippet-preview.js');
  const vlak = document.createElement('canvas');
  vlak.width = plan.breedtePx;
  vlak.height = plan.hoogtePx;
  const ctx = vlak.getContext('2d');
  if (!ctx) throw new Error('IMPORT_INSERT_FAILED');
  for (const strook of plan.stroken) {
    const regio = {
      x: 0,
      y: strook.yPx / plan.bronSchaal,
      width: bladPt.breedte,
      height: strook.hoogtePx / plan.bronSchaal,
    };
    const beeld = await rasterBytesVanPad(pad, regio, plan.bronSchaal);
    if (!beeld) throw new Error('IMPORT_INSERT_FAILED');
    witNaarDoorzichtig(beeld.rgba);
    ctx.putImageData(new ImageData(beeld.rgba, beeld.breedte, beeld.hoogte), 0, strook.yPx);
  }
  const blob = await new Promise((klaar) => vlak.toBlob(klaar, 'image/png'));
  vlak.width = 1;
  vlak.height = 1;
  if (!blob) throw new Error('IMPORT_INSERT_FAILED');
  // Een data:-URL, want daar leest de saver de bytes uit (zoals bij plakken).
  const dataUrl = await new Promise((klaar, mis) => {
    const lezer = new FileReader();
    lezer.onload = () => klaar(lezer.result);
    lezer.onerror = mis;
    lezer.readAsDataURL(blob);
  });
  const img = new Image();
  await new Promise((klaar, mis) => {
    img.onload = klaar;
    img.onerror = mis;
    img.src = dataUrl;
  });
  return { img, dataUrl, plan };
}

/**
 * Legt de PDF die de import maakte als opmaakobject op de huidige pagina van
 * het actieve document. Er is geen tweede route: als vector wordt het een
 * vectorknipsel (verplaatsbaar, schaalbaar, vast te zetten, te verwijderen, in
 * het bestand echte vectordata), "als afbeelding" een afbeeldingsannotatie
 * van het gerasterde blad.
 *
 * Heeft de pagina een meetschaal en is `opSchaal` gevraagd, dan valt de
 * tekening op ware grootte over de pagina; anders komt het blad op papiermaat,
 * passend verkleind. Het tijdelijke bestand is daarna niet meer nodig.
 *
 * @param {string} pad  pad van de gemaakte PDF
 * @param {object} o
 * @param {string} o.tekening  pad van de tekening (voor het bijschrift)
 * @param {{widthMm:number, heightMm:number, scale:number}} o.blad  de pagina uit het importverslag
 * @param {boolean} [o.isModel]  modelruimte (een layout heeft geen modelschaal)
 * @param {number} [o.dekking]   dekking in procenten
 * @param {boolean} [o.onder]    bij het vastzetten onder de bestaande inhoud (alleen vector)
 * @param {boolean} [o.opSchaal]
 * @param {boolean} [o.alsAfbeelding]
 * @param {number} [o.dpi]
 * @returns {Promise<{annotatie: object, pagina: number, opSchaal: boolean, begrensd: boolean, dpi: number|null}>}
 *   `begrensd`: de resolutie is verlaagd tot `dpi` omdat het beeld anders te groot werd
 */
export async function legTekeningOpPagina(pad, o = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) throw new Error('geen document open');
  try {
    const paginaNr = doc.currentPage || 1;
    const bladPt = { breedte: Number(o.blad?.widthMm) * PT_PER_MM, hoogte: Number(o.blad?.heightMm) * PT_PER_MM };
    const paginaPt = await paginaMaatPt(doc, paginaNr);
    let factor = null;
    if (o.opSchaal !== false && paginaPt) {
      const { getMeasureScale } = await import('../annotations/measurement.js');
      factor = onderleggerFactor(o.blad?.scale, getMeasureScale(paginaNr, paginaPt.breedte / 2, paginaPt.hoogte / 2), o.isModel !== false);
    }
    const vak = onderleggerVak(bladPt, paginaPt, factor);
    if (!vak) throw new Error('IMPORT_INSERT_FAILED');
    const opacity = dekkingUitProcent(o.dekking);
    const bijschrift = pdfNaamVoor(o.tekening || pad);
    let annotatie = null;
    let begrensd = false;
    let dpi = null;

    if (o.alsAfbeelding === true) {
      const { img, dataUrl, plan } = await rasterBlad(pad, bladPt, vak, o.dpi);
      begrensd = plan.begrensd;
      dpi = Math.round(plan.dpi);
      const { plaatsAfbeeldingAnnotatie } = await import('../annotations/image-drop.js');
      annotatie = plaatsAfbeeldingAnnotatie(img, dataUrl, {
        page: paginaNr, x: vak.x, y: vak.y, width: vak.width, height: vak.height, opacity, subject: bijschrift,
      });
    } else {
      const fs = window.__TAURI__?.fs;
      if (!fs?.readFile) throw new Error('IMPORT_INSERT_FAILED');
      const bytes = await fs.readFile(pad);
      const { PDFDocument } = await import('pdf-lib');
      const bronPagina = (await PDFDocument.load(bytes)).getPage(0);
      const bronVak = bronPagina.getCropBox();
      const { knipselAlsMiniPdf } = await import('./vector-embed.js');
      const { bewaar } = await import('../annotations/vector-snippet-store.js');
      const { plaatsKnipsel } = await import('../annotations/vector-snippet-clipboard.js');
      const sleutel = bewaar(await knipselAlsMiniPdf(bytes, 0, 0));
      annotatie = plaatsKnipsel({
        snippetKey: sleutel,
        srcBox: { left: bronVak.x, bottom: bronVak.y, right: bronVak.x + bronVak.width, top: bronVak.y + bronVak.height },
        srcLabel: bijschrift,
        breedte: vak.width,
        hoogte: vak.height,
      }, { x: vak.x, y: vak.y, page: paginaNr }, { opacity, belowContent: o.onder === true, lockAspectRatio: true });
    }
    if (!annotatie) throw new Error('IMPORT_INSERT_FAILED');
    markDocumentModified();
    await hertekenAnnotaties(doc);
    return { annotatie, pagina: paginaNr, opSchaal: vak.opSchaal, begrensd, dpi };
  } finally {
    await ruimOp(pad);
  }
}

/** Verwijdert een tijdelijke PDF van de import (stil als dat niet lukt). */
export async function ruimOp(pad) {
  if (!pad) return;
  try { await window.__TAURI__?.fs?.remove?.(pad); } catch { /* al weg of in gebruik */ }
}

/**
 * Ruimt tijdelijke werkbestanden (import-PDF's en werkkopieën van
 * paginabewerkingen) op die van een vorige keer zijn blijven staan
 * (een tab die nog open stond bij het afsluiten, of een bestand dat toen nog
 * in gebruik was). Alleen bestanden ouder dan een dag, zodat een import van nu
 * nooit onder handen genomen wordt.
 */
export async function ruimOudeImportsOp(ouderDanMs = 24 * 60 * 60 * 1000) {
  const fs = window.__TAURI__?.fs;
  if (!isTauri() || !fs?.readDir) return 0;
  try {
    // De importmap van de app, en de tijdelijke map van het systeem: daar
    // staan de werkkopieën van paginabewerkingen en imports van vroeger.
    const mappen = new Set();
    const importmap = await importMap();
    if (importmap) mappen.add(importmap);
    if (window.__TAURI__?.path?.tempDir) mappen.add(metScheiding(await window.__TAURI__.path.tempDir()));
    const nu = Date.now();
    // Wat een open document nog gebruikt, blijft staan, hoe oud het ook is:
    // de app kan langer dan een dag open staan.
    const inGebruik = new Set();
    for (const doc of state.documents || []) {
      for (const pad of [doc?.filePath, ...(Array.isArray(doc?._werkbestanden) ? doc._werkbestanden : [])]) {
        if (pad) inGebruik.add(String(pad).split(/[\\/]/).pop().toLowerCase());
      }
    }
    let opgeruimd = 0;
    for (const map of mappen) {
      let items = [];
      try { items = await fs.readDir(map); } catch { continue; }
      for (const item of items) {
        const naam = item?.name || '';
        if (inGebruik.has(naam.toLowerCase())) continue;
        // De PDF van een import én de werkkopieën van paginabewerkingen
        // (`opds-edit-…`): beide blijven staan als de app midden in het werk
        // stopte. De tijd staat in de naam.
        const ouderdom = ouderdomWerkbestand(naam, nu);
        if (ouderdom === null || ouderdom < ouderDanMs) continue;
        try {
          await fs.remove(`${map}${naam}`);
          opgeruimd += 1;
        } catch { /* nog in gebruik */ }
      }
    }
    return opgeruimd;
  } catch {
    return 0;
  }
}
