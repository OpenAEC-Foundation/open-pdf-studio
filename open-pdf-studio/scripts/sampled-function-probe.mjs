// One process per worker avoids PDF.js fake-worker module caching between cases.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { sampledFunctionFixture } from './sampled-function-fixture.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'opds-sampled-render-'));
try {
  const source = readFileSync(process.argv[3] || require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  const worker = join(temp, 'pdf.worker.mjs');
  writeFileSync(worker, process.argv[2] === 'patched' ? patchPdfjsWorker(source) : source);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
  const pixels = ctx => [10, 50, 90].map(x => Array.from(ctx.getImageData(x, 50, 1, 1).data));
  const poppler = spawnSync('pdftoppm', ['-v']).status === 0;
  for (const bits of [8, 16, 24, 32]) for (const tint of [false, true]) {
    const bytes = sampledFunctionFixture(bits, tint);
    const task = pdfjs.getDocument({ data: bytes.slice(), stopAtErrors: true });
    try {
      const page = await (await task.promise).getPage(1);
      const canvas = createCanvas(100, 100);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: 1 }) }).promise;
      const actual = pixels(canvas.getContext('2d'));
      const broken = process.argv[2] === 'original' && bits === 32;
      for (const [index, rgba] of actual.entries()) {
        const expected = broken ? 0 : [140, 191, 242][index];
        assert.ok(Math.abs(rgba[0] - expected) <= 2, `${bits}-bit tint=${tint}: ${actual}`);
        assert.deepEqual(rgba, [rgba[0], rgba[0], rgba[0], 255]);
      }
      if (poppler) {
        const input = join(temp, 'fixture.pdf'), output = join(temp, 'reference');
        writeFileSync(input, bytes);
        const result = spawnSync('pdftoppm', ['-r', '72', '-singlefile', '-png', input, output], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const ref = createCanvas(100, 100);
        ref.getContext('2d').drawImage(await loadImage(output + '.png'), 0, 0);
        const reference = pixels(ref.getContext('2d'));
        if (!broken) actual.forEach((rgba, i) => assert.ok(Math.abs(rgba[0] - reference[i][0]) <= 2, `PDF.js ${actual}; Poppler ${reference}`));
        else assert.ok(reference.every(rgba => rgba[0] > 130), 'independent renderer preserves the gray samples');
      }
      console.log(`PASS ${bits}-bit ${tint ? 'tint' : 'shading'}: ${actual.map(rgba => rgba[0])}; Poppler=${poppler}`);
    } finally { await task.destroy(); }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
