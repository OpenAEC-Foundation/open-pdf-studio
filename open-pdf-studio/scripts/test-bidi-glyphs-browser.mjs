// Echte app: tekstlaag -> selectie -> Ctrl+C, zoekfallback en Office-downloads.
// Geen native IPC gesimuleerd; OS-WebView/installer blijft aparte kwalificatie.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { bidiMarksFixture } from './bidi-marks-fixture.mjs';
import { previousGlyphWorker } from './bidi-glyphs-baseline.mjs';
import { unzip } from '../js/bcf/bcf-zip.js';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'opds-glyph-browser-'));
const baseline = previousGlyphWorker(await readFile(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8'));
const server = await createServer({ root, cacheDir: temp, logLevel: 'error', plugins: [{ name: 'glyph-baseline-probe', configureServer(s) { s.middlewares.use((req, res, next) => { if (!req.url?.startsWith('/__glyph-baseline.worker.mjs')) return next(); res.setHeader('Content-Type', 'text/javascript'); res.end(baseline); }); } }], server: { host: '127.0.0.1', port: 18078, strictPort: false, hmr: false } });
const cases = [{ name: 'generated', bytes: [...bidiMarksFixture(['م', 'لا', 'س'])], expected: 'سلام', before: 'سالم' }];
if (process.argv[2]) {
  const bytes = await readFile(process.argv[2]);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '762c9801a97104e209e2a9d66285a1136cca57d7e2fb5996a4625e36b4f388ed', 'official fixture provenance');
  cases.push({ name: 'upstream16880', bytes: [...bytes], expected: 'سلام کلاس لاله', before: 'سالم کالس الله' });
}
const hashes = new Map();
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const previous of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') console.error('browser:', msg.text()); });
    page.on('pageerror', error => console.error('pageerror:', error.message));
    page.setDefaultTimeout(30000);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
    await page.waitForSelector('#tool-select', { timeout: 120000 });
    if (previous) await page.evaluate(async () => {
      const src = await (await fetch('/js/pdf/office-export.js')).text();
      const url = src.match(/import \* as pdfjsLib from "([^"]+)"/)[1];
      (await import(url)).GlobalWorkerOptions.workerSrc = '/__glyph-baseline.worker.mjs';
    });
    for (const c of cases) {
      const expected = previous ? c.before : c.expected;
      const result = await page.evaluate(async c => {
        const { createTab } = await import('/js/ui/chrome/tabs.js');
        const { loadPDF } = await import('/js/pdf/loader.js');
        const { index } = createTab(c.name + '.pdf');
        await loadPDF(c.name + '.pdf', index, new Uint8Array(c.bytes));
        const { setViewMode, setZoom } = await import('/js/pdf/renderer.js');
        await setViewMode('single'); await setZoom(1);
        const { getActiveDocument, state } = await import('/js/core/state.ts');
        const doc = getActiveDocument(); state.textSelectMode = true;
        const { extractPageText } = await import('/js/search/find-controller.js');
        const search = await extractPageText(doc.pdfDoc, 1, doc);
        const canvas = document.getElementById('pdf-canvas');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] < 200 && pixels[i + 1] < 200 && pixels[i + 2] < 200) ink++;
        return { search, png: canvas.toDataURL(), ink };
      }, c);
      assert.equal(result.search.text ?? result.search.pageText, expected, `${c.name}: search fallback`);
      assert.ok(result.ink > 20, `${c.name}: nonblank render`);
      const hash = createHash('sha256').update(result.png).digest('hex');
      if (previous) hashes.set(c.name, hash); else assert.equal(hash, hashes.get(c.name), `${c.name}: rendering unchanged`);
      await page.waitForFunction(() => document.querySelector('#text-layer span, .textLayer span'));
      await page.evaluate(() => {
        const layer = document.getElementById('text-layer') || document.querySelector('.textLayer');
        const range = document.createRange(); range.selectNodeContents(layer);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      const selection = await page.evaluate(async () => (await import('/js/text/text-selection.js')).getSelectedText());
      assert.equal(selection.trim(), expected, `${c.name}: app selection`);
      await page.keyboard.press('Control+c');
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).trim(), expected, `${c.name}: clipboard`);
      for (const format of ['docx', 'odt']) {
        await page.evaluate(async format => (await import('/js/ui/chrome/export-verlies-bevestigen.js')).zetNietMeerVragen(format), format);
        const downloadPromise = page.waitForEvent('download');
        const exported = await page.evaluate(async format => (await import('/js/pdf/office-export.js')).exportOffice({ format, pages: [1] }), format);
        assert.equal(exported, true, `${c.name}: ${format} export`);
        const download = await downloadPromise;
        const files = await unzip(new Uint8Array(await readFile(await download.path())));
        const xml = new TextDecoder().decode(files.get(format === 'docx' ? 'word/document.xml' : 'content.xml'));
        assert.ok(xml.includes(expected), `${c.name}: ${format} exact logical text`);
        assert.ok(!xml.includes(previous ? c.expected : c.before), `${c.name}: ${format} no wrong sequence`);
      }
      console.log(`PASS ${c.name}: ${previous ? 'previous fully patched baseline reproduces error' : 'fixed'} copy/search/DOCX/ODT/render`);
    }
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await rm(temp, { recursive: true, force: true }); }
