// Launched in a killable subprocess: the vulnerable worker can block its thread.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { postscriptFixture } from './postscript-fixture.mjs';
import { patchPostscriptProgress } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'opds-postscript-'));
try {
  const source = readFileSync(process.argv[4] || require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  const worker = join(temp, 'pdf.worker.mjs');
  writeFileSync(worker, process.argv[2] !== 'patched' ? source : patchPostscriptProgress(source));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
  const task = pdfjs.getDocument({ data: postscriptFixture(process.argv[3]), useSystemFonts: false });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  console.log('READY: requesting shading operators');
  const ops = await page.getOperatorList();
  if (!ops.fnArray.includes(pdfjs.OPS.shadingFill)) throw new Error('Fixture did not exercise shading');
  await task.destroy();
  console.log('PASS: real worker completed shading operator list');
} finally { rmSync(temp, { recursive: true, force: true }); }
