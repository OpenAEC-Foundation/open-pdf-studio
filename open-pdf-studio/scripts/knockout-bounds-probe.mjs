// Draait in een eigen proces (één pdf.mjs per proces). Gebruik:
//   node scripts/knockout-bounds-probe.mjs original|patched [scale ...]
// Rendert de #637-fixture met de echte PDF.js-weergavebibliotheek op een
// @napi-rs/canvas en print per schaal één JSON-regel: een hash van de pixels,
// het aantal verschillende kleuren en hoeveel canvas-kopieën (drawImage) over een
// heel canvas liepen (`full` zonder, `whole` met bronrechthoek) tegenover een
// deelrechthoek (`partial`).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { knockoutFixture } from './pdfjs-backport-fixtures.mjs';
import { patchPdfjsDisplay } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const canvasLib = require('@napi-rs/canvas');
const [mode = 'patched', ...scaleArgs] = process.argv.slice(2);
const scales = scaleArgs.length ? scaleArgs.map(Number) : [1, 4];

// pdf.mjs laadt @napi-rs/canvas relatief aan zijn eigen pad; de kopie in de
// tijdelijke map vindt het pakket daar niet. Zet de polyfills daarom vooraf
// en geef een eigen canvasfabriek mee.
globalThis.DOMMatrix ??= canvasLib.DOMMatrix;
globalThis.Path2D ??= canvasLib.Path2D;
globalThis.ImageData ??= canvasLib.ImageData;

const counts = { full: 0, whole: 0, partial: 0 };
function instrument(context) {
  const draw = context.drawImage.bind(context);
  context.drawImage = (...args) => {
    const src = args[0];
    if (src && typeof src.width === 'number' && src.width === context.canvas.width && src.height === context.canvas.height) {
      if (args.length === 3) counts.full++;
      else if (args.length === 9 && args[3] * args[4] < src.width * src.height) counts.partial++;
      else if (args.length === 9) counts.whole++;
    }
    return draw(...args);
  };
  return context;
}
class CanvasFactory {
  constructor() {}
  create(width, height) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = canvasLib.createCanvas(width, height);
    return { canvas, context: instrument(canvas.getContext('2d')) };
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

const temp = mkdtempSync(join(tmpdir(), 'opds-knockout-'));
try {
  let source = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'), 'utf8');
  if (mode === 'patched') source = patchPdfjsDisplay(source);
  const lib = join(temp, 'pdf.mjs');
  writeFileSync(lib, source);
  const pdfjs = await import(pathToFileURL(lib).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const task = pdfjs.getDocument({ data: knockoutFixture(), useSystemFonts: false, stopAtErrors: true, verbosity: 0, CanvasFactory });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    for (const scale of scales) {
      counts.full = counts.whole = counts.partial = 0;
      const viewport = page.getViewport({ scale });
      const factory = new CanvasFactory();
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colours = new Set();
      for (let i = 0; i < data.length; i += 4) colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      const pixels = createHash('sha256').update(data).digest('hex');
      console.log(JSON.stringify({ scale, width: canvas.width, height: canvas.height, pixels, colours: colours.size, ...counts }));
    }
  } finally {
    await task.destroy();
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
