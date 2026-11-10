// "PDF comprimeren" — reduces the file size of a PDF by rasterising every page
// to a downsampled JPEG at a chosen resolution/quality and rebuilding a fresh
// PDF from those images. This is the reliable size-reduction path for scanned
// or image-heavy drawings in this stack:
//
//   * Image downsampling/recompression happens implicitly: each page is
//     re-rendered at the target DPI and re-encoded as JPEG, so a 600-DPI scan
//     collapses to (say) 150 DPI at a fraction of the bytes.
//   * Unused objects are dropped for free: the output is a brand-new
//     PDFDocument.create(), so orphaned streams, dead fonts and duplicate
//     resources from the source never make it across.
//
// Trade-off (documented on purpose): rasterising flattens the page, so text
// becomes non-searchable and vector line-work is baked into the JPEG. That is
// the accepted behaviour for a "make this scan smaller" action and mirrors the
// existing raster-PDF export. Font subsetting is therefore not applicable to
// this path (there are no fonts left to subset).
//
// The second mode, compressPDFLossless() (#902), keeps everything: it only
// re-encodes black/white image XObjects losslessly (monochrome-document.js)
// and leaves text, OCR, vectors, annotations and forms as they are.
//
// The result is always written to a NEW file via a save-as dialog, so the
// original document on disk is never touched.
import { getActiveDocument, state, getPageRotation } from '../core/state.js';
import { isTauri, saveFileDialog, writeBinaryFile, writeBinaryFileAtomic } from '../core/platform.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { renderPageOffscreen, canvasToBytes } from './exporter.js';
import { getCachedPdfBytes } from './loader.js';
import { getCacheKey } from './page-manager.js';
import { PDFDocument } from 'pdf-lib';
import i18next from '../i18n/config.js';

// Quality presets. Each maps to a render resolution (DPI) and a JPEG quality.
// Lower DPI + lower quality => smaller file, less detail.
export const COMPRESS_PRESETS = {
  low: { dpi: 100, quality: 0.55 },     // smallest file
  medium: { dpi: 150, quality: 0.72 },  // balanced (default)
  high: { dpi: 200, quality: 0.85 },    // best quality
};

/** Human-readable byte size (e.g. 24.8 MB). */
export function formatBytes(bytes) {
  if (bytes == null || !isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
}

/** Size of the currently loaded document in bytes (annotations included). */
export function getCurrentDocumentSize() {
  try {
    const bytes = getCachedPdfBytes(getCacheKey());
    return bytes ? bytes.length : null;
  } catch {
    return null;
  }
}

function getPdfBaseName() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return 'document';
  const fileName = doc.fileName || 'document';
  return fileName.replace(/\.pdf$/i, '');
}

/**
 * Compress the active document and write the result to a new file.
 *
 * @param {Object} options
 * @param {'low'|'medium'|'high'} [options.level='medium'] - Quality preset.
 * @param {number} [options.dpi] - Explicit target DPI (overrides the preset).
 * @param {number} [options.quality] - Explicit JPEG quality 0..1 (overrides preset).
 * @returns {Promise<null | {outputPath: string, origSize: number|null, newSize: number, dpi: number, quality: number, pages: number}>}
 *          null when there is nothing to do or the user cancelled the save dialog.
 */
export async function compressPDF({ level = 'medium', dpi, quality } = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  if (!isTauri()) return null;

  const preset = COMPRESS_PRESETS[level] || COMPRESS_PRESETS.medium;
  const targetDpi = dpi ?? preset.dpi;
  const jpegQuality = quality ?? preset.quality;

  const origSize = getCurrentDocumentSize();

  const baseName = getPdfBaseName();
  const suffix = i18next.t('compress.fileSuffix', { ns: 'dialogs' });
  const outputPath = await saveFileDialog(`${baseName}${suffix}.pdf`, [
    { name: 'PDF Files', extensions: ['pdf'] },
  ]);
  if (!outputPath) return null;

  const totalPages = doc.pdfDoc.numPages;
  showLoading(i18next.t('compress.progressPreparing', { ns: 'dialogs' }));

  try {
    const exportScale = targetDpi / 72;
    const newPdf = await PDFDocument.create();

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      showLoading(i18next.t('compress.progressPage', { ns: 'dialogs', page: pageNum, total: totalPages }));

      // Re-render the page (with any annotations baked in) at the target DPI,
      // then re-encode as JPEG — this is where the downsampling happens.
      const canvas = await renderPageOffscreen(pageNum, exportScale);
      const jpegBytes = await canvasToBytes(canvas, 'jpeg', jpegQuality);
      const jpegImage = await newPdf.embedJpg(jpegBytes);

      // Keep the original page size in PDF points so the geometry is unchanged.
      const origPage = await doc.pdfDoc.getPage(pageNum);
      const extraRotation = getPageRotation(pageNum);
      const origViewportOpts = { scale: 1 };
      if (extraRotation) {
        origViewportOpts.rotation = (origPage.rotate + extraRotation) % 360;
      }
      const origViewport = origPage.getViewport(origViewportOpts);

      const page = newPdf.addPage([origViewport.width, origViewport.height]);
      page.drawImage(jpegImage, {
        x: 0,
        y: 0,
        width: origViewport.width,
        height: origViewport.height,
      });
    }

    // Fresh document => no orphaned/unused objects carried over.
    const newBytes = await newPdf.save({ useObjectStreams: true });
    await writeBinaryFile(outputPath, newBytes);

    return {
      outputPath,
      origSize,
      newSize: newBytes.length,
      dpi: targetDpi,
      quality: jpegQuality,
      pages: totalPages,
    };
  } finally {
    hideLoading();
  }
}

/**
 * De bytes zoals opslaan ze zou schrijven: met de annotaties uit de app als het
 * document gewijzigd is, anders de bytes zoals ze geladen zijn.
 */
async function currentDocumentBytes(doc) {
  if (doc.modified) {
    const { bouwAnnotatieDocument } = await import('./saver.js');
    const { pdfDocLib } = await bouwAnnotatieDocument(doc);
    return new Uint8Array(await pdfDocLib.save({ useObjectStreams: false, updateFieldAppearances: false }));
  }
  const cached = getCachedPdfBytes(doc.filePath) || getCachedPdfBytes(`__memory__${doc.id}`) || getCachedPdfBytes(getCacheKey());
  if (cached) return new Uint8Array(cached).slice();
  return new Uint8Array(await doc.pdfDoc.getData());
}

/**
 * Verliesloze monochroomoptimalisatie (#902). Optimaliseert eerst (met
 * voortgang en Annuleren); alleen een kleiner resultaat wordt, na de
 * opslaan-als-keuze, atomisch naar een nieuw bestand geschreven.
 *
 * @returns {Promise<null | {mode: 'lossless', outputPath: string|null, cancelled?: boolean,
 *          bytes?: Uint8Array|null, reason?: string|null, origSize?: number, newSize?: number,
 *          replaced?: number, images?: Array<object>}>}
 *          null bij geen document of een geannuleerde opslaan-als-keuze;
 *          outputPath null als er niets geschreven is (geen winst of geweigerd).
 */
export async function compressPDFLossless() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  if (!isTauri()) return null;

  const t = (key, opts = {}) => i18next.t(key, { ns: 'dialogs', ...opts });
  const { heeftBeveiligdeInhoud } = await import('./wachtwoord-pdf.js');
  if (heeftBeveiligdeInhoud(doc)) {
    return { mode: 'lossless', outputPath: null, bytes: null, reason: 'encrypted', images: [] };
  }

  const controller = new AbortController();
  const cancel = () => controller.abort();
  const progress = (message, voortgang = null) => showLoading(message, { voortgang, annuleren: cancel });
  let result;
  try {
    progress(t('compress.progressPreparing'));
    const source = await currentDocumentBytes(doc);
    const { optimizeMonochromeDocument } = await import('./monochrome-document.js');
    const { getMonochromeNative } = await import('./monochrome-rust.js');
    result = await optimizeMonochromeDocument(source, {
      signal: controller.signal,
      native: await getMonochromeNative(),
      onProgress: ({ done, total }) => progress(
        t('compress.progressImage', { image: Math.min(done + 1, total), total }),
        total ? done / total : null,
      ),
    });
  } catch (e) {
    if (e?.name === 'AbortError') return { mode: 'lossless', outputPath: null, cancelled: true };
    throw e;
  } finally {
    hideLoading();
  }
  if (!result.bytes) return { mode: 'lossless', outputPath: null, ...result };

  const suffix = t('compress.fileSuffix');
  const outputPath = await saveFileDialog(`${getPdfBaseName()}${suffix}.pdf`, [
    { name: 'PDF Files', extensions: ['pdf'] },
  ]);
  if (!outputPath) return null;
  // Het geopende bronbestand wordt nooit overschreven.
  if (doc.filePath && outputPath.toLowerCase() === String(doc.filePath).toLowerCase()) {
    throw new Error(t('compress.samePath'));
  }
  showLoading(t('compress.progressWriting'));
  try {
    await writeBinaryFileAtomic(outputPath, result.bytes);
  } finally {
    hideLoading();
  }
  return { mode: 'lossless', outputPath, ...result };
}
