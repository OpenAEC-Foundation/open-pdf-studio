// PDF to IFCX (#876, beta): the app side of the export — reads the document
// from the byte cache, asks the measurement scale per page, builds the IFCX
// text (ifcx-document.js) and writes it. Used by the export dialog
// (IfcxExportDialog.jsx) and the MCP tool app_export_ifcx (mcp-bridge.js).

import { PDFDocument } from 'pdf-lib';
import { getCachedPdfBytes } from './loader.js';
import { saveFileDialog, writeBinaryFileAtomic } from '../core/platform.js';
import { meetschaalOp } from './cad-export.js';
import { basisnaam } from './cad-export-logica.js';
import { bouwIfcx } from './ifcx-document.js';

export const IFCX_EXTENSIE = 'ifcx';

/** Page labels from pdf.js (null per page without a label). */
async function paginaLabels(doc) {
  try {
    const labels = await doc.pdfDoc?.getPageLabels?.();
    return Array.isArray(labels) ? labels : [];
  } catch {
    return [];
  }
}

/** Save dialog for the target file, with a proposal next to the PDF. */
export async function kiesIfcxDoel(doc) {
  const map = doc?.filePath && !doc?.isUntitled ? doc.filePath.replace(/[^\\/]*$/, '') : '';
  const voorstel = `${map}${basisnaam(doc?.fileName || doc?.filePath)}.${IFCX_EXTENSIE}`;
  return saveFileDialog(voorstel, [{ name: 'IFCX', extensions: [IFCX_EXTENSIE] }]);
}

/**
 * Exports the document to IFCX.
 * @param {object} doc  the active document
 * @param {{pad:string, paginas:number[], opties:{raster:boolean, tekst:boolean, annotaties:boolean, limieten?:object},
 *   voortgang?:(klaar:number, totaal:number)=>void, afgebroken?:()=>boolean}} o
 * @returns {Promise<{ok:true, pad:string, bytes:number, verslag:object} | {ok:false, code:string, error?:string, verslag?:object}>}
 */
export async function exporteerIfcx(doc, { pad, paginas, opties, voortgang, afgebroken }) {
  const bron = doc?.filePath ? getCachedPdfBytes(doc.filePath) : null;
  if (!bron?.length) return { ok: false, code: 'noBytes' };
  let pdf;
  try {
    pdf = await PDFDocument.load(bron, { ignoreEncryption: true, updateMetadata: false });
  } catch (e) {
    return { ok: false, code: 'failed', error: String(e?.message ?? e) };
  }
  const labels = await paginaLabels(doc);
  const { tekst, verslag } = await bouwIfcx(pdf, {
    paginas,
    labels,
    schaalVoor: (nr, kader) => meetschaalOp(nr, null, { breedte: kader.breedte, hoogte: kader.hoogte }),
    annotaties: doc.annotations || [],
    annotatieLagen: doc.annotationLayers || [],
    opties,
    bron: doc.fileName || null,
    voortgang,
    afgebroken,
    // Give the interface a moment between pages.
    wacht: () => new Promise((r) => setTimeout(r, 0)),
  });
  if (verslag.cancelled || tekst === null) return { ok: false, code: 'cancelled', verslag };
  const bytes = new TextEncoder().encode(tekst);
  await writeBinaryFileAtomic(pad, bytes);
  return { ok: true, pad, bytes: bytes.length, verslag };
}

export { waarschuwingTeksten } from './ifcx-document.js';
