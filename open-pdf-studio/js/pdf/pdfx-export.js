// PDF/X export — produce print-ready ("drukklare") PDF files.
//
// Issue #239. This is a SEPARATE, additive export path (its own menu action);
// it does not touch the normal save pipeline in saver.js. It takes the current
// document's PDF bytes and enriches the file with the structures a PDF/X
// consumer expects:
//   • an OutputIntent (/S /GTS_PDFX) with an EMBEDDED ICC colour profile,
//   • XMP metadata carrying the PDF/X conformance identifier,
//   • a TrimBox on every page (falls back to the CropBox),
//   • an /Info dictionary with a defined /Trapped value + document title.
//
// Chosen conformance: PDF/X-3:2002 (default) and PDF/X-4.
// PDF/X-3 is deliberately preferred over X-1a because X-1a is CMYK/grayscale
// only, whereas pdf-lib cannot convert the source PDF's existing RGB content to
// CMYK. X-3 permits calibrated RGB via an ICC-based OutputIntent, so a
// pragmatic, self-contained export is achievable without a licensed CMYK
// profile.
//
// ICC profile: a compact sRGB (IEC 61966-2.1 primaries / D50) ICC v2 display
// profile is generated in-code (buildSrgbIccProfile, in pdfx-enrich.js). It is authored here from
// the open ISO 15076-1 / ICC.1 byte layout, so it carries no third-party
// licence. This keeps the export fully self-contained (no shipped binary asset).
//
// KNOWN LIMITATIONS (documented, honest):
//   • The embedded output-intent profile is an RGB display profile. A strict
//     CMYK print workflow should substitute a licensed CMYK printer profile;
//     that substitution is out of scope here.
//   • Existing RGB (or other) images inside the source PDF are NOT colour-
//     converted to CMYK.
//   • Standard-14 fonts used by app-drawn appearances are not embedded, which a
//     strict PDF/X preflight flags. For guaranteed conformance, rasterise the
//     document first (Export → Raster PDF) and then run PDF/X export on that.
//   • Full external preflight validation is out of scope.

import { getActiveDocument } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { isTauri, readBinaryFile, writeBinaryFile, saveFileDialog } from '../core/platform.js';
import { getCachedPdfBytes } from './loader.js';
import { buildPdfxBytes } from './pdfx-enrich.js';
import { showMessage } from '../bridge.js';
import i18next from '../i18n/config.js';

// ── Byte acquisition ───────────────────────────────────────────────────────
// Get the current document's PDF bytes, mirroring saver.js: cache → memory key
// → disk. NOTE: this reflects the last SAVED state; unsaved annotations are not
// included (save first to include recent edits).
async function getCurrentPdfBytes(activeDoc) {
  const currentPath = activeDoc?.filePath;
  let bytes = currentPath ? getCachedPdfBytes(currentPath) : undefined;
  if (!bytes && activeDoc) bytes = getCachedPdfBytes(`__memory__${activeDoc.id}`);
  if (!bytes && currentPath) bytes = await readBinaryFile(currentPath);
  return bytes;
}

// ── Public entry point ─────────────────────────────────────────────────────
// Export the active document as a PDF/X file (Save As — original untouched).
export async function exportAsPdfX({ conformance = 'X-3' } = {}) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) {
    showMessage(i18next.t('noPdfLoaded', { defaultValue: 'No PDF loaded.' }));
    return false;
  }
  if (!isTauri()) return false;

  const baseName = (activeDoc.fileName || 'document').replace(/\.pdf$/i, '');
  const suffix = conformance === 'X-4' ? 'PDFX-4' : 'PDFX-3';
  const defaultName = `${baseName}_${suffix}.pdf`;

  const outputPath = await saveFileDialog(defaultName, [
    { name: 'PDF/X Files', extensions: ['pdf'] },
  ]);
  if (!outputPath) return false;

  showLoading('Exporting PDF/X...');
  try {
    const existingBytes = await getCurrentPdfBytes(activeDoc);
    if (!existingBytes) {
      showMessage(i18next.t('failedToSavePdf', { error: 'no source bytes', defaultValue: 'Could not read the source PDF.' }));
      return false;
    }

    const pdfBytes = await buildPdfxBytes(existingBytes, { conformance, title: baseName });
    await writeBinaryFile(outputPath, new Uint8Array(pdfBytes));

    // Open the exported result in a new tab so the user can inspect it.
    try {
      const { createTab } = await import('../ui/chrome/tabs.js');
      const { loadPDF } = await import('./loader.js');
      const { index } = createTab(outputPath);
      await loadPDF(outputPath, index);
    } catch (e) {
      console.error('Could not open PDF/X result in a new tab:', e);
    }
    return outputPath;
  } catch (error) {
    console.error('Error exporting PDF/X:', error);
    showMessage(i18next.t('failedToSavePdf', { error: error?.message || String(error), defaultValue: 'Failed to export PDF/X.' }));
    return false;
  } finally {
    hideLoading();
  }
}
