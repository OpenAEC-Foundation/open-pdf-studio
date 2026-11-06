// Draait in een eigen proces (de fake worker van PDF.js in node laadt één
// workerbron per proces). Gebruik:
//   node scripts/sampled-function-probe.mjs original|patched|shipped [worker.mjs]
// Print één JSON-regel per BitsPerSample: de kleuren van de Separation-vlakken
// (tint 0 en 1), de kleurstops van het verloop en, als @napi-rs/canvas laadt,
// de gerenderde grijswaarden op x = 10, 50, 90 (y = 50) bij 100 x 100 px.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { sampledFunctionFixture } from './sampled-function-fixture.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const [mode = 'patched', workerPath] = process.argv.slice(2);
const temp = mkdtempSync(join(tmpdir(), 'opds-sampled-'));
try {
  let source = readFileSync(workerPath || require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  if (mode === 'patched') source = patchPdfjsWorker(source);
  const worker = join(temp, 'pdf.worker.mjs');
  writeFileSync(worker, source);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
  for (const bps of [8, 16, 24, 32]) {
    const task = pdfjs.getDocument({ data: sampledFunctionFixture(bps), useSystemFonts: false, stopAtErrors: true });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const ops = await page.getOperatorList();
      const fills = ops.fnArray.flatMap((fn, i) => (fn === pdfjs.OPS.setFillRGBColor ? [ops.argsArray[i][0]] : []));
      const shading = ops.fnArray.findIndex(fn => fn === pdfjs.OPS.shadingFill);
      if (shading < 0) throw new Error('fixture did not exercise the shading');
      const stops = page.objs.get(ops.argsArray[shading][0])[3];
      let pixels = null;
      try {
        const viewport = page.getViewport({ scale: 1 });
        const { canvas, context } = doc.canvasFactory.create(viewport.width, viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        // y = 50 ligt boven de Separation-vlakjes (onderste 10 pt).
        pixels = [10, 50, 90].map(x => context.getImageData(x, 50, 1, 1).data[0]);
      } catch { /* geen canvas beschikbaar: alleen de operatorlijst */ }
      console.log(JSON.stringify({ bps, fills, stops, pixels }));
    } finally {
      await task.destroy();
    }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
