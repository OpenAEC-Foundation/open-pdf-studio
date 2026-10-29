import { isAnnotationHiddenInOutput } from '../annotations/view-filters.js';
import { bereidKnipselsVoorUitvoer, KNIPSEL_UITVOER_FOUT } from '../annotations/vector-snippet-preview.js';
import { state, getActiveDocument, getAnnotationBounds } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { isTauri, writeBinaryFileAtomic, saveFileDialog, openFolderDialog } from '../core/platform.js';
import { renderAnnotationsForPage, drawAnnotation } from '../annotations/rendering.js';
import { showMessage } from '../bridge.js';
import i18next from '../i18n/config.js';
import { joinExportPath } from './export-path.js';
import { canvasToTiffBytes } from './tiff.js';
import { imageWithDpi } from './image-dpi.js';
import { PDFDocument } from 'pdf-lib';
import { pdfiumRasterBeschikbaar, kiesRasterMotor, renderPaginaPdfium, maakJpegEncoder } from './raster-export.js';
import { maakPixelPoort, maakVolgorde } from './raster-export-plan.js';

const nu = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const RASTER_JPEG_KWALITEIT = 0.92;

/**
 * Parse a page range string like "1-5, 8, 11-13" into an array of page numbers.
 * @param {string} rangeStr - The range string
 * @param {number} totalPages - Total number of pages in the document
 * @returns {number[]} Array of 1-based page numbers, sorted and deduplicated
 */
export function parsePageRange(rangeStr, totalPages) {
  if (typeof rangeStr !== 'string' || !Number.isSafeInteger(totalPages) || totalPages < 1) return [];
  const pages = new Set();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return [];
      const lo = Math.max(1, Math.min(start, end));
      const hi = Math.min(totalPages, Math.max(start, end));
      if (lo > hi) return [];
      for (let i = lo; i <= hi; i++) {
        pages.add(i);
      }
    } else {
      if (!/^\d+$/.test(trimmed)) return [];
      const num = Number(trimmed);
      if (!Number.isSafeInteger(num) || num < 1 || num > totalPages) return [];
      pages.add(num);
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Render a single PDF page + annotations to an off-screen canvas.
 * @param {number} pageNum - 1-based page number
 * @param {number} exportScale - Scale factor (e.g. 300/72 for 300 DPI)
 * @param {{ deel?: {x:number, y:number, breedte:number, hoogte:number}|null,
 *           markeringen?: boolean }} [opties]
 *   deel: render only this part of the page, in whole pixels of the page
 *   rendered at `exportScale` (the print dialog renders just what lands on
 *   the sheet, see print-plaatsing.js renderDeel); markeringen: false = the
 *   document without the annotation layer ("Print: Document") — watermarks
 *   and text edits stay, they are document content.
 *
 * This is output, not screen: the annotation layer is drawn without editing
 * state — no selection frame or handles, no 2D cursor, rubber band, alignment
 * guides or crop overlay — and with the real line weights instead of the
 * screen's minimum-one-pixel rule (annotations/rendering/uitvoer-lagen.js).
 * @returns {Promise<HTMLCanvasElement>} The rendered canvas
 */
export async function renderPageOffscreen(pageNum, exportScale, { deel = null, markeringen = true, tijden = null } = {}) {
  const doc = getActiveDocument();
  const pdf = doc?.pdfDoc;
  if (!pdf) throw new Error('No PDF document is open');
  const page = await pdf.getPage(pageNum);
  if (getActiveDocument() !== doc || doc.pdfDoc !== pdf) throw exportChanged();
  const extraRotation = doc.pageRotations?.[pageNum] || 0;
  const viewportOpts = { scale: exportScale };
  if (extraRotation) {
    viewportOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(viewportOpts);
  const breedte = deel ? deel.breedte : viewport.width;
  const hoogte = deel ? deel.hoogte : viewport.height;

  // Create off-screen canvas for PDF content
  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.width = breedte;
  pdfCanvas.height = hoogte;
  const pdfCtx = pdfCanvas.getContext('2d');

  // Render PDF page
  // Geschakelde lagen (#377): afdrukken en exporteren tonen wat in beeld is.
  const { pdfjsLaagOpties } = await import('./lagen-schakelen.js');
  const renderContext = {
    canvasContext: pdfCtx,
    viewport: viewport,
    annotationMode: 0,
    ...pdfjsLaagOpties(doc),
  };
  // Part of the page: shifted so the part starts at pixel (0,0); the canvas
  // clips the rest.
  if (deel) renderContext.transform = [1, 0, 0, 1, -deel.x, -deel.y];

  const t0 = tijden ? nu() : 0;
  const renderTask = page.render(renderContext);
  await renderTask.promise;
  if (getActiveDocument() !== doc || doc.pdfDoc !== pdf) throw exportChanged();
  const t1 = tijden ? nu() : 0;

  // Annotation layer on its own canvas, composited on top of the PDF below.
  const annCanvas = await renderMarkeringenOffscreen(pageNum, exportScale, viewport, { deel, markeringen });

  // Composite: draw annotations on top of PDF
  pdfCtx.drawImage(annCanvas, 0, 0);
  annCanvas.width = 0;
  annCanvas.height = 0;
  if (tijden) {
    tijden.renderMs = t1 - t0;
    tijden.markeringMs = nu() - t1;
  }

  return pdfCanvas;
}

/**
 * The annotation layer of a page on a transparent canvas, without the PDF
 * page itself: markups (unless `markeringen` is false), watermarks and text
 * edits, as output (no editing state, real line weights). Same `deel` as
 * renderPageOffscreen. Used on its own by "Save as PDF" in the print dialog,
 * where the page stays vector and only this layer becomes an image.
 * @param {number} pageNum - 1-based page number
 * @param {number} exportScale
 * @param {{width:number, height:number}} viewport  the page at `exportScale`
 * @returns {HTMLCanvasElement}
 */
export async function renderMarkeringenOffscreen(pageNum, exportScale, viewport, { deel = null, markeringen = true } = {}) {
  const annCanvas = document.createElement('canvas');
  annCanvas.width = deel ? deel.breedte : viewport.width;
  annCanvas.height = deel ? deel.hoogte : viewport.height;
  const annCtx = annCanvas.getContext('2d');

  // Temporarily override state.scale so renderAnnotationsForPage uses export scale
  const doc = state.documents[state.activeDocumentIndex];
  const pdf = doc.pdfDoc;
  const snippetBitmaps = markeringen
    ? await bereidKnipselsVoorUitvoer(doc.annotations.filter(a => a.page === pageNum && !isAnnotationHiddenInOutput(a)), exportScale)
      .catch((err) => { throw alsKnipselMelding(err); })
    : new Map();
  if (getActiveDocument() !== doc || doc.pdfDoc !== pdf) {
    for (const bmp of snippetBitmaps.values()) bmp.close();
    throw exportChanged();
  }
  const savedScale = doc.scale;
  doc.scale = exportScale;
  try {
    const lagen = { uitvoer: true, markeringen, snippetBitmaps };
    if (deel) {
      // The same shift in page coordinates (scale 1); watermarks keep the whole page.
      renderAnnotationsForPage(annCtx, pageNum, annCanvas.width, annCanvas.height, 1,
        { x: deel.x / exportScale, y: deel.y / exportScale },
        { w: viewport.width / exportScale, h: viewport.height / exportScale }, lagen);
    } else {
      renderAnnotationsForPage(annCtx, pageNum, annCanvas.width, annCanvas.height, 1,
        undefined, undefined, lagen);
    }
  } catch (err) {
    throw alsKnipselMelding(err);
  } finally {
    // Restore original scale
    doc.scale = savedScale;
    for (const bmp of snippetBitmaps.values()) bmp.close();
  }
  return annCanvas;
}

/**
 * Convert a canvas to a blob of the specified format.
 * @param {HTMLCanvasElement} canvas
 * @param {string} format - 'png' or 'jpeg'
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<Uint8Array>}
 */
export function canvasToBytes(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to convert canvas to blob'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      },
      mimeType,
      format === 'jpeg' ? quality : undefined
    );
  });
}

/**
 * Get the base name of the current PDF (without extension).
 */
function getPdfBaseName(doc = getActiveDocument()) {
  if (!doc) return 'document';
  const fileName = doc.fileName || 'document';
  return fileName.replace(/\.pdf$/i, '');
}

// Een vectorknipsel dat niet in de uitvoer kan: de uitvoer stopt met een
// melding voor de gebruiker, nooit met een leeg kader op papier (#511).
function alsKnipselMelding(err) {
  if (err?.code !== KNIPSEL_UITVOER_FOUT) return err;
  return new Error(i18next.t('snippetOutputFailed', {
    defaultValue: 'A vector snippet could not be rendered, so nothing was written. Try again.',
  }), { cause: err });
}

function exportChanged() {
  return new Error(i18next.t('documentChangedDuringExport', {
    defaultValue: 'The document changed during export. Start again.',
  }));
}

/**
 * Export pages as image files (PNG or JPEG).
 * @param {Object} options
 * @param {string} options.format - 'png', 'jpeg' or 'tiff'
 * @param {number} options.quality - JPEG quality (0-1), default 0.92
 * @param {number} options.dpi - Export resolution, default 150
 * @param {number[]} options.pages - Array of 1-based page numbers
 */
export async function exportAsImages({ format = 'png', quality = 0.92, dpi = 150, pages, includeAnnotations = true, doc = getActiveDocument() }) {
  const pdf = doc?.pdfDoc, path = doc?.filePath;
  if (!pdf || !isTauri()) return;
  const ensureCurrent = () => {
    if (getActiveDocument() !== doc || doc.pdfDoc !== pdf || doc.filePath !== path) throw exportChanged();
  };

  if (!['png', 'jpeg', 'tiff'].includes(format)) throw new Error(`Unsupported image format: ${format}`);
  const ext = format === 'jpeg' ? 'jpg' : format === 'tiff' ? 'tiff' : 'png';
  const exportScale = dpi / 72;
  if (getActiveDocument() !== doc) { showMessage(exportChanged().message); return false; }
  const baseName = getPdfBaseName(doc);

  let outputPath = null;
  let folderPath = null;

  if (pages.length === 1) {
    // Single page: save file dialog
    const defaultName = `${baseName}_page${String(pages[0]).padStart(4, '0')}.${ext}`;
    const filters = format === 'jpeg'
      ? [{ name: 'JPEG Images', extensions: ['jpg', 'jpeg'] }]
      : format === 'tiff'
        ? [{ name: 'TIFF Images', extensions: ['tif', 'tiff'] }]
        : [{ name: 'PNG Images', extensions: ['png'] }];
    outputPath = await saveFileDialog(defaultName, filters);
    if (!outputPath) return;
  } else {
    // Multiple pages: folder dialog
    folderPath = await openFolderDialog('Select output folder for exported images');
    if (!folderPath) return;
  }

  showLoading('Exporting images...');

  try {
    ensureCurrent();
    for (let i = 0; i < pages.length; i++) {
      ensureCurrent();
      const pageNum = pages[i];
      showLoading(`Exporting page ${pageNum} of ${pages[pages.length - 1]}...`);

      const canvas = await renderPageOffscreen(pageNum, exportScale, { markeringen: includeAnnotations });
      const bytes = format === 'tiff'
        ? canvasToTiffBytes(canvas, dpi)
        : imageWithDpi(await canvasToBytes(canvas, format, quality), format, dpi);
      ensureCurrent();

      let filePath;
      if (pages.length === 1) {
        filePath = outputPath;
      } else {
        const fileName = `${baseName}_page${String(pageNum).padStart(4, '0')}.${ext}`;
        filePath = joinExportPath(folderPath, fileName);
      }

      await writeBinaryFileAtomic(filePath, bytes);
    }
  } catch (error) {
    console.error('[export images]', error);
    showMessage(error?.message || String(error));
    return false;
  } finally {
    hideLoading();
  }
}

/**
 * Export pages as a rasterized PDF (each page is a JPEG image).
 *
 * Zware pagina's komen uit de PDFium-workerpool, lichte uit PDF.js (zie
 * kiesRasterMotor); een paar pagina's tegelijk, de JPEG-codering in een Web
 * Worker, en het in de PDF zetten in de gevraagde volgorde terwijl volgende
 * pagina's al renderen (#701). Zonder pool (of buiten de desktop-app) alles
 * via PDF.js.
 * @param {Object} options
 * @param {number} options.dpi - Export resolution, default 300
 * @param {number[]} options.pages - Array of 1-based page numbers
 * @param {string} [options.outputPath] - doelbestand; zonder: opslagvenster
 * @param {boolean} [options.openInTab=true] - resultaat openen in een tabblad
 * @param {'pdfium'|'pdfjs'} [options.motor] - één motor voor alle pagina's
 *   (metingen/tests); zonder: per pagina gekozen
 * @param {object} [options.meting] - wordt gevuld met tijden per pagina
 */
export async function exportAsRasterPdf({
  dpi = 300, pages, doc = getActiveDocument(),
  outputPath = null, openInTab = true, motor = null, meting = null,
}) {
  const pdf = doc?.pdfDoc, path = doc?.filePath;
  if (!pdf || !isTauri()) return;
  const ensureCurrent = () => {
    if (getActiveDocument() !== doc || doc.pdfDoc !== pdf || doc.filePath !== path) throw exportChanged();
  };

  if (getActiveDocument() !== doc) { showMessage(exportChanged().message); return false; }
  if (!outputPath) {
    const baseName = getPdfBaseName(doc);
    outputPath = await saveFileDialog(`${baseName}_raster.pdf`, [
      { name: 'PDF Files', extensions: ['pdf'] }
    ]);
    if (!outputPath) return;
  }

  const totaal = pages.length;
  const annuleer = new AbortController();
  const toonVoortgang = (klaar) => showLoading(
    i18next.t('rasterExportProgress', {
      done: klaar, total: totaal,
      defaultValue: 'Rasterizing pages: {{done}} of {{total}}',
    }),
    { voortgang: totaal ? klaar / totaal : 0, annuleren: () => annuleer.abort() },
  );
  toonVoortgang(0);

  const tStart = nu();
  let encoder = null;
  try {
    ensureCurrent();
    const exportScale = dpi / 72;
    const newPdf = await PDFDocument.create();
    const poolKlaar = motor ? motor === 'pdfium' : await pdfiumRasterBeschikbaar(doc);
    encoder = maakJpegEncoder();
    // Tot vier pagina's tegelijk (de pool heeft vier workers; PDF.js-pagina's
    // overlappen met de codering van de vorige), binnen een pixelbudget: één
    // A0 op 300 dpi gaat alleen.
    const poort = maakPixelPoort({ maxPaginas: 4, maxPixels: 120e6 });
    const volgorde = maakVolgorde();
    const perPagina = [];
    let klaar = 0;
    let fout = null;
    let embedKetting = Promise.resolve();
    const gestopt = () => !!fout || annuleer.signal.aborted;

    const zetInPdf = async ({ jpeg, breedtePt, hoogtePt, tijden }) => {
      if (gestopt()) return;
      const t0 = nu();
      const jpegImage = await newPdf.embedJpg(jpeg);
      const page = newPdf.addPage([breedtePt, hoogtePt]);
      page.drawImage(jpegImage, { x: 0, y: 0, width: breedtePt, height: hoogtePt });
      tijden.embedMs = nu() - t0;
      klaar++;
      if (!annuleer.signal.aborted) toonVoortgang(klaar);
    };

    const verwerk = async (i) => {
      const pageNum = pages[i];
      const tijden = { pagina: pageNum };
      perPagina[i] = tijden;
      try {
        const paginaMotor = motor || await kiesRasterMotor(doc, pageNum, poolKlaar);
        let r = await rasterPaginaCanvas(doc, pageNum, exportScale,
          { motor: paginaMotor, tijden, signal: annuleer.signal });
        ensureCurrent();
        if (gestopt()) return;
        tijden.motor = r.motor;
        tijden.px = r.canvas.width * r.canvas.height;
        const t0 = nu();
        let jpeg;
        try {
          jpeg = await encoder.encodeer(r.canvas, RASTER_JPEG_KWALITEIT);
        } catch (err) {
          // De JPEG-worker viel weg en nam het beeld mee: opnieuw via het
          // oude pad, gecodeerd op de hoofdthread.
          console.warn(`[raster] page ${pageNum}: JPEG worker failed, retrying on the main thread:`, err);
          r = await rasterPaginaCanvas(doc, pageNum, exportScale, { motor: 'pdfjs' });
          ensureCurrent();
          jpeg = await canvasToBytes(r.canvas, 'jpeg', RASTER_JPEG_KWALITEIT);
        }
        tijden.jpegMs = nu() - t0;
        ensureCurrent();
        volgorde.zet(i, { jpeg, breedtePt: r.breedtePt, hoogtePt: r.hoogtePt, tijden });
        for (const item of volgorde.afnemen()) {
          embedKetting = embedKetting.then(() => zetInPdf(item));
        }
      } catch (err) {
        fout ??= err;
      }
    };

    const taken = [];
    for (let i = 0; i < totaal && !gestopt(); i++) {
      ensureCurrent();
      // Pixelmaat vooraf, voor het budget: dezelfde viewport als de render.
      const page = await pdf.getPage(pages[i]);
      ensureCurrent();
      const extra = doc.pageRotations?.[pages[i]] || 0;
      const vp = page.getViewport({ scale: exportScale, rotation: (page.rotate + extra) % 360 });
      const vrij = await poort.neem(Math.floor(vp.width) * Math.floor(vp.height));
      if (gestopt()) { vrij(); break; }
      taken.push(verwerk(i).finally(vrij));
    }
    await Promise.all(taken);
    await embedKetting;
    if (annuleer.signal.aborted) return null;
    if (fout) throw fout;

    const tSave = nu();
    const pdfBytes = await newPdf.save();
    ensureCurrent();
    await writeBinaryFileAtomic(outputPath, pdfBytes);
    const tEind = nu();
    if (meting) {
      meting.motor = motor || (poolKlaar ? 'auto' : 'pdfjs');
      meting.jpegViaWorker = encoder.viaWorker;
      meting.paginas = perPagina;
      meting.opslaanMs = tEind - tSave;
      meting.totaalMs = tEind - tStart;
      meting.bytes = pdfBytes.length;
    }
    const gem = (k) => Math.round(perPagina.reduce((som, t) => som + (t?.[k] || 0), 0) / Math.max(1, totaal));
    const viaPdfium = perPagina.filter(t => t?.motor === 'pdfium').length;
    console.log(`[raster] ${totaal} pages at ${dpi} dpi (${viaPdfium} via PDFium, ${totaal - viaPdfium} via PDF.js) in ${Math.round(tEind - tStart)} ms`
      + ` (per page: render ${gem('renderMs')}, markup ${gem('markeringMs')}, jpeg ${gem('jpegMs')}, embed ${gem('embedMs')} ms)`);

    // Open the rasterised result in a new tab. Each page is now a flat image,
    // so it renders identically in every viewer/printer — the reliable way to
    // share/print annotated drawings without appearance-stream mismatches.
    if (openInTab) {
      try {
        const { createTab } = await import('../ui/chrome/tabs.js');
        const { loadPDF } = await import('./loader.js');
        const { index } = createTab(outputPath);
        await loadPDF(outputPath, index);
      } catch (e) {
        console.error('Could not open raster PDF in a new tab:', e);
      }
    }
  } catch (error) {
    console.error('[export raster PDF]', error);
    showMessage(error?.message || String(error));
    return false;
  } finally {
    encoder?.sluit();
    hideLoading();
  }
  return outputPath;
}

/**
 * Eén pagina van de rasterexport als beeld, met markeringslaag: via de
 * PDFium-workers (`motor: 'pdfium'`) of via PDF.js op de hoofdthread
 * (`'pdfjs'`, het oude pad). Lukt PDFium niet voor deze pagina, dan valt hij
 * terug op PDF.js. Het document moet het actieve zijn (zoals bij elke
 * export). Retour { canvas, breedtePt, hoogtePt, motor }: het canvas heeft
 * de maat van de PDF.js-viewport op `exportScale` met de paginarotatie plus
 * de extra rotatie (pageRotations); breedtePt × hoogtePt is de paginamaat.
 */
export async function rasterPaginaCanvas(doc, pageNum, exportScale, { motor = 'pdfium', tijden = null, signal = null } = {}) {
  const pdf = doc.pdfDoc;
  const page = await pdf.getPage(pageNum);
  if (getActiveDocument() !== doc || doc.pdfDoc !== pdf) throw exportChanged();
  const extraRotation = doc.pageRotations?.[pageNum] || 0;
  const rotation = (page.rotate + extraRotation) % 360;
  const viewport = page.getViewport({ scale: exportScale, rotation });
  const paginaPt = page.getViewport({ scale: 1, rotation });
  const maat = { breedtePt: paginaPt.width, hoogtePt: paginaPt.height };
  if (motor === 'pdfium') {
    const t0 = nu();
    let canvas = null;
    try {
      canvas = await renderPaginaPdfium({
        doc, pageNum, scale: exportScale, extraRot: extraRotation,
        breedte: Math.floor(viewport.width), hoogte: Math.floor(viewport.height), signal,
      });
    } catch (err) {
      // Afgebroken: niet alsnog via PDF.js.
      signal?.throwIfAborted();
      console.warn(`[raster] page ${pageNum}: PDFium render failed, using PDF.js:`, err);
    }
    if (getActiveDocument() !== doc || doc.pdfDoc !== pdf) throw exportChanged();
    if (canvas) {
      const t1 = nu();
      const annCanvas = await renderMarkeringenOffscreen(pageNum, exportScale, viewport);
      canvas.getContext('2d').drawImage(annCanvas, 0, 0);
      // Geheugen meteen vrij: op een A0 op 300 dpi is dit canvas 560 MB.
      annCanvas.width = 0;
      annCanvas.height = 0;
      if (tijden) {
        tijden.renderMs = t1 - t0;
        tijden.markeringMs = nu() - t1;
      }
      return { canvas, ...maat, motor: 'pdfium' };
    }
  }
  const canvas = await renderPageOffscreen(pageNum, exportScale, { tijden });
  return { canvas, ...maat, motor: 'pdfjs' };
}

/**
 * Export a single annotation as a PNG image.
 * @param {Object} annotation - The annotation object to export
 */
export async function exportAnnotationAsImage(annotation) {
  if (!annotation || !isTauri()) return;

  const bounds = getAnnotationBounds(annotation);
  if (!bounds) return;

  const exportScale = 3; // 3x for high-res output
  const padding = 10; // padding in annotation units

  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const w = bounds.width + padding * 2;
  const h = bounds.height + padding * 2;

  // Account for line width so strokes aren't clipped
  const lw = annotation.lineWidth ?? 3;
  const extra = lw / 2;

  const canvasW = Math.ceil((w + extra * 2) * exportScale);
  const canvasH = Math.ceil((h + extra * 2) * exportScale);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Een vectorknipsel komt uit zijn vectorinhoud op de exportresolutie, niet
  // uit de schermcache (#511).
  let snippetBitmaps = null;
  if (annotation.type === 'vectorSnippet') {
    try {
      snippetBitmaps = await bereidKnipselsVoorUitvoer([annotation], exportScale);
    } catch (err) {
      showMessage(alsKnipselMelding(err).message);
      return;
    }
  }

  // Scale and translate so the annotation draws at the correct position
  ctx.save();
  ctx.scale(exportScale, exportScale);
  ctx.translate(-(x - extra), -(y - extra));

  try {
    drawAnnotation(ctx, annotation, snippetBitmaps);
  } finally {
    for (const bmp of snippetBitmaps?.values() || []) bmp.close();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  const baseName = getPdfBaseName();
  const defaultName = `${baseName}_annotation.png`;

  const outputPath = await saveFileDialog(defaultName, [
    { name: 'PNG Images', extensions: ['png'] }
  ]);
  if (!outputPath) return;

  const bytes = await canvasToBytes(canvas, 'png');
  await writeBinaryFileAtomic(outputPath, bytes);
}
