// Background print job: render the selected pages to a temp PDF and spool it
// to the printer, reporting progress through printProgressStore so the print
// dialog can close immediately and the user keeps working.

import { PDFDocument } from 'pdf-lib';
import i18next from '../i18n/config.js';
import { getActiveDocument, getPageRotation } from '../core/state.js';
import { invoke, readBinaryFile, writeBinaryFile } from '../core/platform.js';
import { renderPageOffscreen, renderMarkeringenOffscreen, canvasToBytes } from './exporter.js';
import { getCachedPdfBytes } from './loader.js';
import { viewportOpties } from './getoonde-pagina.js';
import {
  berekenPlaatsing, renderDeel, ongedraaidDeel, printPxPerPt, voegPrintPaginaToe,
} from './print-plaatsing.js';
import { bouwVectorPrintPdf, maakTegelRaster, vakkenUitRaster, vakOpVel } from './print-vector.js';
import { markeringenVoorInhoud } from '../solid/stores/print-instellingen.js';
import {
  startPrintProgress, updatePrintProgress, finishPrintProgress, failPrintProgress,
} from '../solid/stores/printProgressStore.js';

/**
 * Een canvas een kwartslag linksom gedraaid: de bovenrand komt links. Dezelfde
 * richting als DRAAIING_HAAKS in print-plaatsing.js en als de printkern in
 * Rust (`draai_linksom`).
 */
function kwartslagLinksom(canvas) {
  const uit = document.createElement('canvas');
  uit.width = canvas.height;
  uit.height = canvas.width;
  const ctx = uit.getContext('2d');
  ctx.translate(0, uit.height);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  return uit;
}

/**
 * Het paginabeeld van `deel` (renderDeel) zoals het op het vel ligt: gerenderd
 * uit de getoonde pagina en, als de pagina haaks op het vel stond
 * (`plaatsing.gedraaid`), een kwartslag linksom gedraaid. Het voorbeeld in de
 * printdialoog en de printopdracht gebruiken allebei deze functie.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPrintBeeld(pageNum, pxPerPt, plaatsing, deel, { markeringen = true } = {}) {
  const canvas = await renderPageOffscreen(pageNum, pxPerPt, {
    deel: ongedraaidDeel(plaatsing, pxPerPt, deel.px), markeringen,
  });
  return plaatsing.gedraaid ? kwartslagLinksom(canvas) : canvas;
}

/**
 * The temporary print PDF (not saved yet): every page as a page image. Scale
 * and position come from print-plaatsing.js, the same rule as the preview:
 * with a known sheet (`vel`, portrait in mm) each page becomes a page at
 * paper size with the image at the chosen place and scale (`opVel`);
 * without a sheet each page keeps its own size, as before the scale choice.
 * Only the part of a page that lands on the sheet is rendered, at 300 dpi on
 * paper and never finer than 300 dpi of the page itself. Prints nothing.
 * `inhoud` volgt de keuzelijst "Afdrukken": 'doc-only' laat de markeringen
 * weg, alles anders drukt document én markeringen af
 * (stores/print-instellingen.js).
 * @param {{ doc: object, pages:number[], orientatie?:'auto'|'portrait'|'landscape',
 *           vel?: {breedteMm:number, hoogteMm:number}|null,
 *           schaling?: string, zoom?: number, centreren?: boolean, inhoud?: string,
 *           voortgang?: (index:number, pageNum:number) => void }} opts
 * @returns {Promise<{ pdf: PDFDocument, opVel: boolean }>}
 */
export async function bouwPrintPdf({
  doc, pages, orientatie = 'auto', vel = null, schaling = 'fit', zoom = 100, centreren = true,
  inhoud = 'doc-and-markups', voortgang = () => {},
}) {
  const markeringen = markeringenVoorInhoud(inhoud);
  const pdf = await PDFDocument.create();
  // Pages laid out on the sheet (the sheet is the same for every page).
  let opVel = false;
  for (let i = 0; i < pages.length; i++) {
    const pageNum = pages[i];
    voortgang(i, pageNum);
    const origPage = await doc.pdfDoc.getPage(pageNum);
    const origViewport = origPage.getViewport(viewportOpties(origPage, getPageRotation(pageNum)));
    const plaatsing = berekenPlaatsing({
      papier: vel,
      orientatie,
      pagina: { breedtePt: origViewport.width, hoogtePt: origViewport.height },
      schaling,
      zoom,
      centreren,
    });
    if (!plaatsing) throw new Error(`page ${pageNum} has no usable size`);
    opVel = plaatsing.bekend;

    const pxPerPt = printPxPerPt(plaatsing);
    const deel = renderDeel(plaatsing, pxPerPt);
    const canvas = await renderPrintBeeld(pageNum, pxPerPt, plaatsing, deel, { markeringen });
    const jpegBytes = await canvasToBytes(canvas, 'jpeg', 0.92);
    voegPrintPaginaToe(pdf, plaatsing, deel, await pdf.embedJpg(jpegBytes));
  }
  return { pdf, opVel };
}

/**
 * De markeringen van één pagina voor de vector-print-PDF: de annotatielaag
 * (markeringen, watermerken, tekstbewerkingen) op een doorzichtig canvas, op
 * de resolutie van de printopdracht, in stukken geknipt waar iets staat
 * (print-vector.js). Een pagina zonder markeringen geeft niets, en dan staat er
 * geen enkel beeld in het bestand. Per band gelezen: het beeld van een A0 op
 * 300 dpi past niet in één keer in het geheugen.
 * @returns {Promise<{ png: Uint8Array, opVel: object }[]>}
 */
async function markeringBeelden(pageNum, plaatsing, markeringen) {
  const pxPerPt = printPxPerPt(plaatsing);
  const deel = renderDeel(plaatsing, pxPerPt);
  if (!deel) return [];
  const page = await getActiveDocument().pdfDoc.getPage(pageNum);
  const viewport = page.getViewport(viewportOpties(page, getPageRotation(pageNum), pxPerPt));
  let canvas = renderMarkeringenOffscreen(pageNum, pxPerPt, viewport, {
    deel: ongedraaidDeel(plaatsing, pxPerPt, deel.px), markeringen,
  });
  if (plaatsing.gedraaid) canvas = kwartslagLinksom(canvas);

  const raster = maakTegelRaster(canvas.width, canvas.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (let y = 0; y < canvas.height; y += raster.tegel) {
    const hoogte = Math.min(raster.tegel, canvas.height - y);
    raster.markeer(ctx.getImageData(0, y, canvas.width, hoogte).data, y, hoogte);
  }
  const uit = [];
  for (const vak of vakkenUitRaster(raster)) {
    const stuk = document.createElement('canvas');
    stuk.width = vak.breedte;
    stuk.height = vak.hoogte;
    stuk.getContext('2d').drawImage(canvas, vak.x, vak.y, vak.breedte, vak.hoogte, 0, 0, vak.breedte, vak.hoogte);
    uit.push({ png: await canvasToBytes(stuk, 'png'), opVel: vakOpVel(deel, vak) });
  }
  return uit;
}

/** De bytes waaruit het document nu getoond wordt (zoals saver.js ze zoekt). */
async function bronBytesVan(doc) {
  let bytes = doc.filePath ? getCachedPdfBytes(doc.filePath) : undefined;
  if (!bytes) bytes = getCachedPdfBytes(`__memory__${doc.id}`);
  if (!bytes && doc.filePath) bytes = await readBinaryFile(doc.filePath);
  if (!bytes) throw new Error('no source bytes');
  return bytes;
}

/**
 * Het doel "Opslaan als PDF" van de printdialoog: bouw de print-PDF en schrijf
 * de bytes naar `pad`. Geen spooler, geen stuurprogramma. Dezelfde paginakeuze,
 * schaal, plek, vel en inhoud als een printopdracht, maar met de bronpagina's
 * als vectoren (print-vector.js): tekst blijft tekst, en het vel ligt in het
 * bestand zoals gekozen. Lukt dat niet (een bron die pdf-lib niet kan lezen,
 * bijvoorbeeld versleuteld), dan de gerasterde print-PDF, en de melding zegt
 * dat. Loopt op de achtergrond, met de zwevende voortgangsbalk.
 *
 * @param {{ pages:number[], pad:string,
 *           orientatie?:'auto'|'portrait'|'landscape',
 *           vel?: {breedteMm:number, hoogteMm:number}|'pagina'|null,
 *           schaling?: string, zoom?: number, centreren?: boolean, inhoud?: string,
 *           openen?: ((pad:string) => void)|null }} opts
 *   vel 'pagina' = elke pagina haar eigen vel, in de gekozen stand
 *   (print-plaatsing.js); openen: achter de knop "Openen" op de melding na
 *   afloop.
 * @returns {Promise<boolean>}
 */
export async function slaPrintOpAlsPdf({
  pages, pad, orientatie = 'auto', vel = null, schaling = 'fit', zoom = 100, centreren = true,
  inhoud = 'doc-and-markups', openen = null,
}) {
  startPrintProgress(i18next.t('dialogs:print.progress.preparing'));
  try {
    const doc = getActiveDocument();
    if (!doc?.pdfDoc) throw new Error(i18next.t('dialogs:print.progress.errNoDocument'));
    const total = pages.length + 1;
    const voortgang = (i, pageNum) => updatePrintProgress(
      i18next.t('dialogs:print.progress.renderingPage', { page: pageNum, current: i + 1, total: pages.length }),
      i / total,
    );
    const markeringen = markeringenVoorInhoud(inhoud);

    let pdf;
    let gerasterd = false;
    try {
      ({ pdf } = await bouwVectorPrintPdf({
        bronBytes: await bronBytesVan(doc),
        paginas: pages.map((pageNum) => ({ index: pageNum - 1, extraRotatie: getPageRotation(pageNum) })),
        keuzes: { papier: vel, orientatie, schaling, zoom, centreren },
        beelden: ({ index, plaatsing }) => markeringBeelden(index + 1, plaatsing, markeringen),
        voortgang: (i, index) => voortgang(i, index + 1),
      }));
    } catch (e) {
      console.warn('[print] vector print PDF failed; falling back to page images:', e);
      gerasterd = true;
      ({ pdf } = await bouwPrintPdf({
        doc, pages, orientatie, vel, schaling, zoom, centreren, inhoud, voortgang,
      }));
    }

    updatePrintProgress(i18next.t('dialogs:print.progress.saving'), pages.length / total);
    await writeBinaryFile(pad, await pdf.save());
    finishPrintProgress(
      i18next.t(gerasterd ? 'dialogs:print.progress.savedAsImages' : 'dialogs:print.progress.savedTo', { path: pad }),
      {
        actie: openen ? { label: i18next.t('common:open'), uitvoeren: () => openen(pad) } : null,
        duur: 9000,
      },
    );
    return true;
  } catch (e) {
    console.error('Save as PDF failed:', e);
    failPrintProgress(i18next.t('dialogs:print.progress.saveFailed', { error: e?.message ?? e }));
    return false;
  }
}

/**
 * Run a print job in the background. Fire-and-forget: the caller closes the
 * dialog first, this drives the floating progress bar.
 *
 * The pages come from bouwPrintPdf; with pages laid out on the sheet
 * print_pdf gets plaatsing 'vel' (1:1 on the physical sheet, lp without
 * rescaling). Without a known sheet the behaviour from before the scale
 * choice: each page at its own size, fitted in by the printer.
 * @param {{ pages:number[], copies:number, printer:string,
 *           orientatie?:'auto'|'portrait'|'landscape', papier?:string,
 *           vel?: {breedteMm:number, hoogteMm:number}|null,
 *           schaling?: string, zoom?: number, centreren?: boolean, inhoud?: string }} opts
 */
export async function runPrintJob({
  pages, copies, printer, orientatie = 'auto', papier = 'printer',
  vel = null, schaling = 'fit', zoom = 100, centreren = true, inhoud = 'doc-and-markups',
}) {
  startPrintProgress(i18next.t('dialogs:print.progress.preparing'));
  try {
    const doc = getActiveDocument();
    if (!doc?.pdfDoc) throw new Error(i18next.t('dialogs:print.progress.errNoDocument'));
    // Reserve the last slice of the bar for the spool step.
    const total = pages.length + 1;
    const { pdf: newPdf, opVel } = await bouwPrintPdf({
      doc, pages, orientatie, vel, schaling, zoom, centreren, inhoud,
      voortgang: (i, pageNum) => updatePrintProgress(
        i18next.t('dialogs:print.progress.renderingPage', { page: pageNum, current: i + 1, total: pages.length }),
        i / total,
      ),
    });

    updatePrintProgress(i18next.t('dialogs:print.progress.saving'), pages.length / total);
    const pdfBytes = await newPdf.save();
    // Documentnaam meegeven: de spooler toont de bestandsnaam van het
    // tempbestand als printjob-naam, dus die moet naar de pdf zelf heten.
    const jobName = doc.fileName
      || (doc.filePath ? doc.filePath.split(/[\/]/).pop() : null);
    const tempPath = await invoke('write_temp_pdf', { data: Array.from(pdfBytes), name: jobName });
    if (!tempPath) throw new Error(i18next.t('dialogs:print.progress.errTempFile'));

    const numCopies = Math.max(1, copies);
    for (let c = 0; c < numCopies; c++) {
      updatePrintProgress(
        numCopies > 1
          ? i18next.t('dialogs:print.progress.sendingCopy', { current: c + 1, total: numCopies })
          : i18next.t('dialogs:print.progress.sending'),
        (pages.length + c / numCopies) / total
      );
      await invoke('print_pdf', {
        path: tempPath, printer, orientatie, papier, ...(opVel ? { plaatsing: 'vel' } : {}),
      });
    }

    finishPrintProgress(i18next.t('dialogs:print.progress.sent'));
    // delete_file (not delete_temp_file — that command does not exist).
    setTimeout(async () => { try { await invoke('delete_file', { path: tempPath }); } catch (_) {} }, 30000);
  } catch (e) {
    console.error('Print job failed:', e);
    failPrintProgress(i18next.t('dialogs:print.progress.failed', { error: e?.message ?? e }));
  }
}
