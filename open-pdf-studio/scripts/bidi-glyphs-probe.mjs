// Eigen proces per worker: PDF.js bewaart de fake-worker-module globaal.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
import { previousGlyphWorker } from './bidi-glyphs-baseline.mjs';
import { bidiMarksFixture } from './bidi-marks-fixture.mjs';
import { glyphCases } from './bidi-glyphs-cases.mjs';
const [mode, workerPath, officialFixture] = process.argv.slice(2);
const temp = mkdtempSync(join(tmpdir(), 'opds-glyphs-'));
try {
  const source = readFileSync(workerPath, 'utf8');
  // Baseline = volledige productie-pijplijn vóór #1078, inclusief #957.
  const previous = previousGlyphWorker(source);
  const worker = join(temp, 'worker.mjs');
  writeFileSync(worker, mode === 'previous' ? previous : patchPdfjsWorker(source));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
  const cases = glyphCases.map(c => ({ ...c, bytes: bidiMarksFixture(c.glyphs) }));
  if (officialFixture) cases.push({ name: 'upstream16880', bytes: new Uint8Array(readFileSync(officialFixture)), normal: 'سلام کلاس لاله', raw: 'سلام کلاس لاله' });
  for (const c of cases) {
    const task = pdfjs.getDocument({ data: c.bytes.slice(), useSystemFonts: false, stopAtErrors: true });
    try {
      const page = await (await task.promise).getPage(1);
      const normal = (await page.getTextContent()).items.map(i => i.str).join('');
      const raw = (await page.getTextContent({ disableNormalization: true })).items.map(i => i.str).join('');
      // PDF.js drops leading/trailing whitespace glyphs at extraction boundaries.
      console.log(JSON.stringify({ name: c.name, normal, raw, expectedNormal: c.name === 'mark- ' ? 'لَ' : c.normal, expectedRaw: c.name === 'mark- ' ? 'لَ' : c.raw }));
    } finally { await task.destroy(); }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
