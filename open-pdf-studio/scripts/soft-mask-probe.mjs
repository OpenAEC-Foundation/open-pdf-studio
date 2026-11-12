// #1028: echte PDF.js-compositor in een apart proces, eigen gegenereerde fixtures.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { softMaskFixture, maskVariants, samplePoints } from './soft-mask-fixture.mjs';
import { patchKnockoutBounds } from './pdfjs-knockout-bounds.mjs';
import { patchPdfjsDisplay } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const canvasLib = require('@napi-rs/canvas');
const [mode = 'patched', build = 'legacy'] = process.argv.slice(2);
const scales = [1, 1.5, 4];

// pdf.mjs laadt @napi-rs/canvas relatief aan zijn eigen pad; de kopie in de
// tijdelijke map vindt het pakket daar niet. Zet de polyfills daarom vooraf
// en geef een eigen canvasfabriek mee.
globalThis.DOMMatrix ??= canvasLib.DOMMatrix;
globalThis.Path2D ??= canvasLib.Path2D;
globalThis.ImageData ??= canvasLib.ImageData;

class CanvasFactory {
  constructor() {}
  create(width, height) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = canvasLib.createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(entry, width, height) {
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  destroy(entry) {
    entry.canvas.width = entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

const temp = mkdtempSync(join(tmpdir(), 'opds-soft-mask-'));
try {
  const modulePath = `pdfjs-dist/${build === 'legacy' ? 'legacy/' : ''}build/pdf.mjs`;
  let source = readFileSync(require.resolve(modulePath), 'utf8');
  source = mode === 'baseline' ? patchKnockoutBounds(source) : patchPdfjsDisplay(source);
  // Test-only observation of the real compositor, no behavior replacement.
  source = source.replace('  composeSMask(ctx, smask, layerCtx, layerBox) {',
    '  composeSMask(ctx, smask, layerCtx, layerBox) { globalThis.maskPaths[ctx ? "scratch" : "inplace"]++;');
  const lib = join(temp, 'pdf.mjs');
  writeFileSync(lib, source);
  const pdfjs = await import(pathToFileURL(lib).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve(modulePath.replace('pdf.mjs', 'pdf.worker.mjs'))).href;
  for (const variant of maskVariants) for (const knockout of [false, true]) for (const earlierBlue of [false, true]) {
    const task = pdfjs.getDocument({ data: softMaskFixture({ ...variant, knockout, earlierBlue }), verbosity: 0, CanvasFactory });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      for (const scale of scales) for (const rotation of [0, 90, 180, 270]) {
        globalThis.maskPaths = { scratch: 0, inplace: 0 };
        const viewport = page.getViewport({ scale, rotation });
        const factory = new CanvasFactory();
        const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const samples = samplePoints.map(([x, y]) => {
          const [cx, cy] = viewport.convertToViewportPoint(x, y);
          return [...context.getImageData(Math.floor(cx), Math.floor(cy), 1, 1).data];
        });
        console.log(JSON.stringify({ variant: variant.name, knockout, earlierBlue, scale, rotation, samples, paths: globalThis.maskPaths }));
        factory.destroy({ canvas, context });
      }
    } finally { await task.destroy(); }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
