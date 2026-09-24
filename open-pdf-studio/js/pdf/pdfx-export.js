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
//
// Output profile (#422), chosen in the export panel:
//   • "sRGB — no conversion" (default): a compact sRGB ICC v2 display profile
//     generated in-code (buildSrgbIccProfile, in pdfx-enrich.js) becomes the
//     output intent and nothing is converted. Byte for byte the export as it
//     was before #422.
//   • A CMYK printing profile (from the system colour folder or a chosen
//     .icc/.icm file): the Rust side (crate open-pdf-cmyk, Little CMS) first
//     converts RGB content to CMYK — content streams, Form XObjects,
//     annotation appearances, tiling patterns, images, axial and radial
//     gradients with exponential or stitching functions, transparency groups —
//     and then that profile (/N 4) becomes the output intent. The export ends
//     with a report of what was converted and what was not, with the reason.
//   No CMYK profile is shipped: the user brings the profile of the print shop.
//
// KNOWN LIMITATIONS (documented, honest):
//   • Not converted, and reported as such: mesh and function-based gradients,
//     gradients with sampled or PostScript functions, Separation/DeviceN
//     colour with an RGB alternate, JPEG 2000 and LZW-compressed images,
//     images with a colour-key mask. They stay RGB.
//   • Annotation colour entries (/C, /IC) and default appearance strings are
//     left alone; printing uses the appearance streams, which are converted.
//   • Standard-14 fonts used by app-drawn appearances are not embedded, which a
//     strict PDF/X preflight flags. For guaranteed conformance, rasterise the
//     document first (Export → Raster PDF) and then run PDF/X export on that.
//   • Full external preflight validation is out of scope.
//   • The CMYK conversion needs the desktop app; the browser build shows the
//     one "desktop only" message.

import { getActiveDocument } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { isTauri, invoke, readBinaryFile, writeBinaryFile, saveFileDialog } from '../core/platform.js';
import { meldAlleenBureaublad, vangAlleenBureaublad } from '../core/webfuncties.js';
import { getCachedPdfBytes } from './loader.js';
import { buildPdfx, conversionErrorMessage, formatCmykReport } from './pdfx-cmyk.js';
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

// Voortgang van de Rust-kant (pagina's) in de laadmelding.
async function luisterNaarOmzetting(onProgress) {
  const ev = window.__TAURI__?.event;
  if (!ev?.listen) return () => {};
  const stop = await ev.listen('pdfx-cmyk-progress', (e) => onProgress(e.payload));
  return () => { try { stop(); } catch { /* al gestopt */ } };
}

// ── Public entry point ─────────────────────────────────────────────────────
// Export the active document as a PDF/X file (Save As — original untouched).
// `profilePath` null = sRGB without conversion; otherwise a CMYK printing
// profile and a rendering intent ('relative' or 'perceptual').
export async function exportAsPdfX({ conformance = 'X-3', profilePath = null, intent = 'relative' } = {}) {
  const t = i18next.t.bind(i18next);
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) {
    showMessage(t('noPdfLoaded', { defaultValue: 'No PDF loaded.' }));
    return false;
  }
  if (!isTauri()) {
    await meldAlleenBureaublad(t(profilePath ? 'appMenu:pdfxCmyk.featureName' : 'appMenu:exportPanel.exportPdfx'));
    return false;
  }

  const baseName = (activeDoc.fileName || 'document').replace(/\.pdf$/i, '');
  const suffix = conformance === 'X-4' ? 'PDFX-4' : 'PDFX-3';
  const defaultName = `${baseName}_${suffix}.pdf`;

  const outputPath = await saveFileDialog(defaultName, [
    { name: 'PDF/X Files', extensions: ['pdf'] },
  ]);
  if (!outputPath) return false;

  showLoading(profilePath ? t('appMenu:pdfxCmyk.converting') : 'Exporting PDF/X...');
  let stopLuisteren = () => {};
  let result;
  try {
    const existingBytes = await getCurrentPdfBytes(activeDoc);
    if (!existingBytes) {
      showMessage(t('failedToSavePdf', { error: 'no source bytes', defaultValue: 'Could not read the source PDF.' }));
      return false;
    }
    const sourceBytes = existingBytes instanceof Uint8Array ? existingBytes : new Uint8Array(existingBytes);

    if (profilePath) {
      stopLuisteren = await luisterNaarOmzetting(({ done, total }) => {
        showLoading(t('appMenu:pdfxCmyk.convertingPages', { done, total }));
      });
    }
    try {
      result = await buildPdfx(
        sourceBytes,
        { conformance, title: baseName, profilePath, intent },
        {
          invoke,
          onPhase: (phase) => {
            if (phase === 'writing') {
              stopLuisteren();
              showLoading(t('appMenu:pdfxCmyk.writing'));
            }
          },
        },
      );
    } catch (error) {
      if (await vangAlleenBureaublad(error, t('appMenu:pdfxCmyk.featureName'))) return false;
      // De Rust-kant wijst af met een code (tekst); al het andere is een echte fout.
      if (typeof error === 'string') {
        console.error('PDF/X CMYK conversion failed:', error);
        showMessage(conversionErrorMessage(t, error), t('appMenu:exportPanel.exportPdfx'));
        return false;
      }
      throw error;
    }

    await writeBinaryFile(outputPath, new Uint8Array(result.pdfBytes));

    // Open the exported result in a new tab so the user can inspect it.
    try {
      const { createTab } = await import('../ui/chrome/tabs.js');
      const { loadPDF } = await import('./loader.js');
      const { index } = createTab(outputPath);
      await loadPDF(outputPath, index);
    } catch (e) {
      console.error('Could not open PDF/X result in a new tab:', e);
    }

    if (result.conversion) {
      showMessage(
        formatCmykReport(t, {
          report: result.conversion.report,
          profileName: result.conversion.profileName,
          sizeBefore: sourceBytes.length,
          sizeAfter: result.pdfBytes.length,
        }),
        t('appMenu:exportPanel.exportPdfx'),
      );
    }
    return outputPath;
  } catch (error) {
    console.error('Error exporting PDF/X:', error);
    showMessage(t('failedToSavePdf', { error: error?.message || String(error), defaultValue: 'Failed to export PDF/X.' }));
    return false;
  } finally {
    stopLuisteren();
    hideLoading();
  }
}
