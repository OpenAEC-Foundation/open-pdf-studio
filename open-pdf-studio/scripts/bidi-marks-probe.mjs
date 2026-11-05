// Draait in een eigen proces (de fake worker van PDF.js in node laadt één
// workerbron per proces). Gebruik:
//   node scripts/bidi-marks-probe.mjs original|patched|shipped [worker.mjs]
// Leest elke regel uit bidiMarksCases via getTextContent (met en zonder
// normalisatie) en via de Office-export (DOCX) en print per geval één
// JSON-regel met de code points.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { bidiMarksFixture } from './bidi-marks-fixture.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
import { textItemsToBoxes, recoverLayout } from '../js/pdf/office-layout.js';
import { buildDocx } from '../js/pdf/office-files.js';
import { unzip } from '../js/bcf/bcf-zip.js';
const require = createRequire(import.meta.url);
const [mode = 'patched', workerPath] = process.argv.slice(2);

// Logische tekst; de PDF bevat de omgekeerde (visuele) volgorde.
export const bidiMarksCases = {
  cgj: 'مَ͏رْ', // meem, fatha, CGJ, reh, sukun (#957)
  // Een merkteken uit U+0300-036F resp. een variatiekiezer, gevolgd door een
  // Arabisch merkteken in visuele volgorde: ongepatcht wisselen ze van plaats.
  acute: 'بَ́اب', // beh, fatha, U+0301, alef, beh
  vs: 'بَ︀اب', // beh, fatha, U+FE00, alef, beh
  hebrew: 'שָׁלוֹם', // Hebreeuws met punten
};
const cps = s => [...s].map(c => c.codePointAt(0).toString(16).padStart(4, '0'));
const xmlText = xml => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');

const temp = mkdtempSync(join(tmpdir(), 'opds-bidi-'));
try {
  let source = readFileSync(workerPath || require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  if (mode === 'patched') source = patchPdfjsWorker(source);
  const worker = join(temp, 'pdf.worker.mjs');
  writeFileSync(worker, source);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
  for (const [name, logical] of Object.entries(bidiMarksCases)) {
    const visual = [...logical].reverse().join('');
    const task = pdfjs.getDocument({ data: bidiMarksFixture(visual), useSystemFonts: false, stopAtErrors: true });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const normal = await page.getTextContent();
      const raw = await page.getTextContent({ disableNormalization: true });
      const viewport = page.getViewport({ scale: 1 });
      const bytes = buildDocx([{ number: 1, width: viewport.width, height: viewport.height, blocks: recoverLayout(textItemsToBoxes(raw.items, viewport)) }]);
      const docx = xmlText(new TextDecoder().decode((await unzip(bytes)).get('word/document.xml')));
      console.log(JSON.stringify({
        name, expected: cps(logical),
        normal: cps(normal.items.map(i => i.str).join('')),
        raw: cps(raw.items.map(i => i.str).join('')),
        dir: raw.items.map(i => i.dir),
        docx: cps(docx),
      }));
    } finally {
      await task.destroy();
    }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
