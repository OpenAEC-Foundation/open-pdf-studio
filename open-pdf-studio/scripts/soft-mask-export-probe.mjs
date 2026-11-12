// Testentry die de echte PDF.js-uitvoerroute voor afbeeldingen/raster-PDF gebruikt.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'virtual:opds-pdfjs-worker-url';
import { state, createDocument } from '../js/core/state.js';
import { renderPageOffscreen, canvasToBytes } from '../js/pdf/exporter.js';
import { softMaskFixture } from './soft-mask-fixture.mjs';
export { renderMask } from './soft-mask-browser-probe.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export async function exportMask(options, rotation) {
  const task = pdfjs.getDocument({ data: softMaskFixture(options) });
  try {
    const doc = createDocument(); doc.pdfDoc = await task.promise;
    doc.pageRotations[1] = rotation;
    state.documents.push(doc); state.activeDocumentIndex = state.documents.length - 1;
    const canvas = await renderPageOffscreen(1, 1.5, { markeringen: false });
    const bytes = await canvasToBytes(canvas, 'png');
    return Array.from(bytes);
  } finally { state.documents.pop(); state.activeDocumentIndex = -1; await task.destroy(); }
}
