// Eigen proces per worker: PDF.js bewaart de fake-worker-module globaal.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
import { previousCurrencyWorker } from './bidi-currency-baseline.mjs';
import { bidiMarksFixture } from './bidi-marks-fixture.mjs';
import { currencyCases } from './bidi-currency-cases.mjs';
const [mode, workerPath] = process.argv.slice(2);
const temp = mkdtempSync(join(tmpdir(), 'opds-currency-'));
try {
  const source = readFileSync(workerPath, 'utf8');
  // Baseline = alle productiebackports, alleen zonder #1266.
  const previous = previousCurrencyWorker(source);
  const worker = join(temp, 'worker.mjs');
  writeFileSync(worker, mode === 'previous' ? previous : patchPdfjsWorker(source));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
  const cases = currencyCases.map(c => ({ ...c, bytes: bidiMarksFixture(c.visual) }));
  for (const c of cases) {
    const task = pdfjs.getDocument({ data: c.bytes.slice(), useSystemFonts: false, stopAtErrors: true });
    try {
      const page = await (await task.promise).getPage(1);
      const items = (await page.getTextContent()).items;
      const normal = items.map(i => i.str).join('');
      const raw = (await page.getTextContent({ disableNormalization: true })).items.map(i => i.str).join('');
      console.log(JSON.stringify({ name:c.name, normal, raw, dir:items[0].dir, expected:c.expected, before:c.before, expectedDir:c.dir }));
    } finally { await task.destroy(); }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
