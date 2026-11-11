// Testentry voor beide echte Vite-configs; wordt niet in normale builds geladen.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'virtual:opds-pdfjs-worker-url';
import { softMaskFixture, samplePoints } from './soft-mask-fixture.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export async function renderMask(options, scale, rotation, baseline = false) {
  const controlUrl = '/control-pdfjs.mjs';
  const lib = baseline ? await import(/* @vite-ignore */ controlUrl) : pdfjs;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = lib.getDocument({ data: softMaskFixture(options) });
  try {
    const doc = await task.promise, page = await doc.getPage(1);
    const viewport = page.getViewport({ scale, rotation });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    const context = canvas.getContext('2d');
    const samples = samplePoints.map(([x, y]) => {
      const [cx, cy] = viewport.convertToViewportPoint(x, y);
      return [...context.getImageData(Math.floor(cx), Math.floor(cy), 1, 1).data];
    });
    return { samples, png: canvas.toDataURL('image/png') };
  } finally { await task.destroy(); }
}
