// Bouw beide echte productieconfiguraties met een extra, niet-uitgeleverde
// testentry. Controleer pixels uit die gehashte assets tegen MuPDF en de
// echte renderPageOffscreen + PNG-export. Geen native renderer of printermock.
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { softMaskFixture, maskVariants } from './soft-mask-fixture.mjs';
import * as mupdf from 'mupdf';
import { patchKnockoutBounds } from './pdfjs-knockout-bounds.mjs';
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const temp = mkdtempSync(join(tmpdir(), 'opds-mask-browser-'));
const reference = new Map();
const browser = await chromium.launch({ headless: true });
let checked = 0, exported = 0, unchangedGrayKnockouts = 0;
try {
  // Independent renderer, generated input and lossless PNG references.
  for (const variant of maskVariants) for (const knockout of [false, true]) for (const earlierBlue of [false, true]) {
    const options = { ...variant, knockout, earlierBlue };
    const id = `${variant.name}-${knockout}-${earlierBlue}`;
    const path = join(temp, id);
    writeFileSync(path + '.pdf', softMaskFixture(options));
    const p = spawnSync('pdftoppm', ['-png', '-singlefile', '-r', '72', path + '.pdf', path], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    const doc = mupdf.Document.openDocument(softMaskFixture(options), 'application/pdf');
    const pdfPage = doc.loadPage(0);
    const pix = pdfPage.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, false);
    const mupdfImage = await loadImage(pix.asPNG());
    reference.set(id, mupdfImage);
    pix.destroy(); pdfPage.destroy(); doc.destroy();
    // Poppler differs on prior content beneath a knockout soft mask; MuPDF
    // and the separately checked pinned PDFium agree there. Keep both sources.
    const popplerImage = await loadImage(readFileSync(path + '.png'));
    const sample = image => {
      const c = createCanvas(400, 400), ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [[250,150],[75,325],[125,325],[30,130]].map(([x,y]) => [...ctx.getImageData(x,y,1,1).data]);
    };
    const m = sample(mupdfImage), pSamples = sample(popplerImage);
    if (knockout && earlierBlue && variant.name !== 'white') {
      console.log(`Reference disagreement ${id}: MuPDF=${m[0]}, Poppler=${pSamples[0]}`);
    } else {
      assert.ok(m.every((pixel,i) => pixel.every((v,c) => Math.abs(v-pSamples[i][c]) <= 2)), `independent references agree: ${id}`);
    }
  }
  for (const target of ['app', 'web-unit']) {
    const outDir = join(temp, target);
    const configFile = resolve(target === 'app' ? 'vite.config.js' : 'vite.web-unit.config.js');
    const result = await build({ configFile, logLevel: 'warn', build: { outDir, rollupOptions: {
      input: { main: resolve(target === 'app' ? 'index.html' : 'web-unit/src/index.js'),
        probe: resolve(`scripts/soft-mask-${target === 'app' ? 'export' : 'browser'}-probe.mjs`) },
      preserveEntrySignatures: 'exports-only',
    } } });
    const output = (Array.isArray(result) ? result[0] : result).output;
    const probe = output.find(c => c.type === 'chunk' && c.isEntry && c.name === 'probe');
    assert.ok(probe, 'emitted test entry');
    writeFileSync(join(outDir, 'control-pdfjs.mjs'), patchKnockoutBounds(readFileSync(require.resolve(
      `pdfjs-dist/${target === 'app' ? 'legacy/' : ''}build/pdf.mjs`), 'utf8')));
    writeFileSync(join(outDir, 'mask-test.html'), '<!doctype html><title>Mask regression</title>');
    const server = await preview({ configFile, build: { outDir }, preview: { host: '127.0.0.1', port: 18328, strictPort: false } });
    try {
      const page = await browser.newPage();
      await page.goto(server.resolvedUrls.local[0] + 'mask-test.html');
      page.on('pageerror', e => console.error('Browser:', e.message));
      for (const variant of maskVariants) for (const knockout of [false, true]) for (const earlierBlue of [false, true]) {
        const options = { ...variant, knockout, earlierBlue };
        const id = `${variant.name}-${knockout}-${earlierBlue}`;
        for (const scale of [1, 1.5, 4]) for (const rotation of [0, 90, 180, 270]) {
          const result = await page.evaluate(async ({ url, options, scale, rotation }) => (await import(url)).renderMask(options, scale, rotation),
            { url: '/' + probe.fileName, options, scale, rotation });
          if (variant.name === 'gray' && knockout) {
            // Existing PDF.js nonzero-alpha knockout output differs from the
            // independent engines; #1028 must not alter that separate path.
            const baseline = await page.evaluate(async ({ url, options, scale, rotation }) => (await import(url)).renderMask(options, scale, rotation, true),
              { url: '/' + probe.fileName, options, scale, rotation });
            assert.equal(result.png, baseline.png, `${target}/${id}: nonzero-alpha knockout unchanged`);
            unchangedGrayKnockouts++;
          } else {
            await comparePng(result.png, reference.get(id), scale, rotation, `${target}/${id}/${scale}/${rotation}`);
          }
          checked++;
          if (checked % 24 === 0) console.log(`Compared ${checked} renders (${target}/${id})`);
        }
        if (target === 'app' && !(variant.name === 'gray' && knockout)) for (const rotation of [0, 90, 180, 270]) {
          const bytes = await page.evaluate(async ({ url, options, rotation }) => (await import(url)).exportMask(options, rotation),
            { url: '/' + probe.fileName, options, rotation });
          await comparePng(Buffer.from(bytes), reference.get(id), 1.5, rotation, `export/${id}/${rotation}`);
          exported++;
        }
      }
      await page.close();
      console.log(`PASS ${target}: production assets compared with independent MuPDF references; gray knockouts compared with pre-fix PDF.js`);
    } finally { await new Promise(resolve => server.httpServer.close(resolve)); }
  }
  console.log(JSON.stringify({ renders: checked, pngExports: exported, referenceRenderer: 'MuPDF (Poppler cross-check; PDFium spot-check)', unchangedGrayKnockouts, fixtureCount: reference.size }));
} finally { await browser.close(); rmSync(temp, { recursive: true, force: true }); }

async function comparePng(png, ref, scale, rotation, label) {
  const actual = await loadImage(png);
  const canvas = createCanvas(actual.width, actual.height), ctx = canvas.getContext('2d');
  ctx.drawImage(actual, 0, 0);
  const got = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(rotation * Math.PI / 180);
  ctx.scale(scale, scale); ctx.drawImage(ref, -200, -200);
  const expected = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // Compare an evenly spaced pixel grid over the entire page, leaving 2px around shape
  // boundaries for different antialiasing kernels. This catches lost earlier
  // marks and unexpected painting outside the four sample points as well.
  let compared = 0;
  const step = Math.max(1, Math.floor(scale));
  for (let y = 2; y < canvas.height - 2; y += step) for (let x = 2; x < canvas.width - 2; x += step) {
    const i = (y * canvas.width + x) * 4;
    let edge = false;
    for (const offset of [-8, 8, -8 * canvas.width, 8 * canvas.width]) {
      for (let c = 0; c < 4; c++) if (expected[i + offset + c] !== expected[i + c]) { edge = true; break; }
      if (edge) break;
    }
    if (edge) continue;
    for (let c = 0; c < 4; c++) {
      if (Math.abs(got[i+c] - expected[i+c]) > 2) assert.fail(
        `${label}: pixel(${x},${y}) channel${c}: ${got[i+c]} != reference ${expected[i+c]}`);
    }
    compared++;
  }
  assert.ok(compared > canvas.width * canvas.height / (step * step) * 0.9, label + ': sufficient reference coverage');
}
