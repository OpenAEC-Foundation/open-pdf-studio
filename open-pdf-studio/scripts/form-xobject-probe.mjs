// Draait in een eigen proces (de fake worker van PDF.js in node laadt één
// workerbron per proces). Gebruik:
//   node scripts/form-xobject-probe.mjs original|patched|shipped [worker.mjs] [uses]
// Print één JSON-regel per pagina van de #636-fixture: een hash van de
// operatorlijst, de geëxtraheerde tekst en hoeveel streams PDF.js daarvoor
// via DecompressionStream uitpakte (operatorlijst en tekst apart).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { repeatedFormFixture } from './pdfjs-backport-fixtures.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const [mode = 'patched', workerPath, usesArg] = process.argv.slice(2);
const uses = Number(usesArg) || 400;

// De worker draait in dit proces: tel elke DecompressionStream.
let decodes = 0;
const Native = globalThis.DecompressionStream;
globalThis.DecompressionStream = class extends Native {
  constructor(...args) { super(...args); decodes++; }
};

const temp = mkdtempSync(join(tmpdir(), 'opds-form-xobject-'));
try {
  let source = readFileSync(workerPath && workerPath !== '-' ? workerPath : require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  if (mode === 'patched') source = patchPdfjsWorker(source);
  const worker = join(temp, 'pdf.worker.mjs');
  writeFileSync(worker, source);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
  const task = pdfjs.getDocument({ data: repeatedFormFixture(uses), useSystemFonts: false, stopAtErrors: true, verbosity: 0 });
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      decodes = 0;
      const t0 = performance.now();
      const ops = await page.getOperatorList();
      const opsMs = performance.now() - t0;
      const opsDecodes = decodes;
      decodes = 0;
      const text = await page.getTextContent();
      const textDecodes = decodes;
      const hash = createHash('sha256')
        .update(JSON.stringify([ops.fnArray, ops.argsArray], (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)))
        .digest('hex');
      const words = text.items.map(item => item.str).join('|');
      console.log(JSON.stringify({ page: n, ops: hash, opCount: ops.fnArray.length, opsDecodes, textDecodes, text: words, opsMs: Math.round(opsMs) }));
    }
  } finally {
    await task.destroy();
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
