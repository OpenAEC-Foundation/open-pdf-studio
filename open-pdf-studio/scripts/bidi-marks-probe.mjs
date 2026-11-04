import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { bidiMarksFixture, ARABIC_CGJ } from './bidi-marks-fixture.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
import { workerVoorOudeWebview } from './oude-webview.mjs';
import { textItemsToBoxes, recoverLayout } from '../js/pdf/office-layout.js';
import { buildDocx, buildOdt } from '../js/pdf/office-files.js';
import { unzip } from '../js/bcf/bcf-zip.js';
const require = createRequire(import.meta.url);
const mode = process.argv[2];
const root = mkdtempSync(join(tmpdir(), 'opds-bidi-'));
try {
  let source = readFileSync(process.argv[3] || require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  if (!['original', 'shipped'].includes(mode)) source = patchPdfjsWorker(source);
  if (mode === 'transformed') source = await workerVoorOudeWebview(source);
  const file = join(root, 'worker.mjs');
  writeFileSync(file, source);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(file).href;
  const expected = [ARABIC_CGJ, '\u0645\u064e\u0300\u0631\u0652', '\u0645\u064e\ufe0f\u0631\u0652', '\u05d0\u05b7\u034f\u05d1', 'ABC123!'];
  for (const text of expected) {
    const bytes = await bidiMarksFixture(text === 'ABC123!' ? text : [...text].reverse().join(''));
    const task = pdfjs.getDocument({ data: bytes.slice(), stopAtErrors: true, useSystemFonts: true, verbosity: 0 });
    try {
      const page = await (await task.promise).getPage(1);
      for (const disableNormalization of [false, true]) {
        const content = await page.getTextContent({ disableNormalization });
        assert.equal(content.items.map(i => i.str ?? '').join(''), text, 'exact source Unicode order');
        const blocks = recoverLayout(textItemsToBoxes(content.items, page.getViewport({ scale: 1 })), { joinParagraphs: true });
        for (const [build, name] of [[buildDocx, 'word/document.xml'], [buildOdt, 'content.xml']]) {
          const zip = await unzip(build([{ number: 1, width: 400, height: 200, blocks }]));
          assert.ok(new TextDecoder().decode(zip.get(name)).includes(text), `${name}: preserve exact Unicode ${JSON.stringify(text)} in ${JSON.stringify(blocks)}`);
        }
      }
    } finally { await task.destroy(); }
  }
  console.log('PASS: real worker extraction, normalization on/off, DOCX and ODT Unicode order');
} finally { rmSync(root, { recursive: true, force: true }); }
