// Browser-side regression using the same PDF.js module/worker URL as loader.js.
import * as pdfjs from 'pdfjs-dist';
import '../js/pdf/loader.js';
import { postscriptFixture } from './postscript-fixture.mjs';

export async function renderFixture(program, workerUrl = pdfjs.GlobalWorkerOptions.workerSrc, cancel = false) {
  const port = new Worker(workerUrl, { type: 'module' });
  const worker = new pdfjs.PDFWorker({ port });
  const task = pdfjs.getDocument({ data: postscriptFixture(program), worker });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 100;
    const context = canvas.getContext('2d');
    const options = { canvasContext: context, viewport: page.getViewport({ scale: 1 }) };
    if (cancel) {
      const rendering = page.render(options);
      rendering.cancel();
      try { await rendering.promise; throw new Error('Cancellation was ignored'); }
      catch (error) { if (error.name !== 'RenderingCancelledException') throw error; }
    }
    await page.render(options).promise;
    const pixels = context.getImageData(0, 0, 100, 100).data;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), x => x.toString(16).padStart(2, '0')).join('');
    return { hash, left: Array.from(context.getImageData(10, 50, 1, 1).data), right: Array.from(context.getImageData(90, 50, 1, 1).data) };
  } finally {
    await task.destroy();
    worker.destroy();
    port.terminate();
  }
}
