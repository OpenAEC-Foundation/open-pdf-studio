// Pixel equality control, run original/patched in separate processes.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
import { bidiMarksFixture } from './bidi-marks-fixture.mjs';
const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'opds-bidi-render-'));
try {
  let source = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  if (process.argv[2] === 'patched') source = patchPdfjsWorker(source);
  const file = join(root, 'worker.mjs'); writeFileSync(file, source);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(file).href;
  const bytes = process.argv[3] ? new Uint8Array(readFileSync(process.argv[3])) : await bidiMarksFixture();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: true });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    console.log(JSON.stringify({ fixtureHash: createHash('sha256').update(bytes).digest('hex'), pixelHash: createHash('sha256').update(pixels).digest('hex'), darkPixels: pixels.reduce((n, v, i) => n + (i % 4 === 0 && v < 220 ? 1 : 0), 0) }));
  } finally { await task.destroy(); }
} finally { rmSync(root, { recursive: true, force: true }); }
