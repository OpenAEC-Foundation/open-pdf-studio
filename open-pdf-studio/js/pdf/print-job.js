// Background print job: render the selected pages to a temp PDF and spool it
// to the printer, reporting progress through printProgressStore so the print
// dialog can close immediately and the user keeps working.

import { PDFDocument } from 'pdf-lib';
import i18next from '../i18n/config.js';
import { getActiveDocument, getPageRotation } from '../core/state.js';
import { invoke } from '../core/platform.js';
import { renderPageOffscreen, canvasToBytes } from './exporter.js';
import { viewportOpties } from './getoonde-pagina.js';
import {
  berekenPlaatsing, renderDeel, ongedraaidDeel, printPxPerPt, voegPrintPaginaToe,
} from './print-plaatsing.js';
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
