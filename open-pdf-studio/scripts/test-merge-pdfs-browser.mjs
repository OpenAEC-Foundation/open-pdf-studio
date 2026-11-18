// PDF's samenvoegen via het echte venster (#1134), in de browserbouw:
// lintknop Indelen > Samenvoegen, bestanden toevoegen met de plusknop, een
// paginabereik, de invoegpositie en de knop Samenvoegen. Daarna staat het
// resultaat in het document: het aantal pagina's, de volgorde en de inhoud
// kloppen, de annotatie van het open document staat nog op haar pagina, en
// de doorlopende weergave toont de eerste samengevoegde pagina.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

/** Een PDF met `aantal` gekleurde bladen en op elk blad "<naam> p<n>". */
async function maakPdf(naam, aantal, kleur, maat = [595, 842]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < aantal; i++) {
    const blad = pdf.addPage(maat);
    blad.drawRectangle({ x: 0, y: 0, width: maat[0], height: maat[1], color: rgb(...kleur) });
    blad.drawText(`${naam} p${i + 1}`, { x: 30, y: 30, size: 12, font, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await pdf.save());
}

const cache = await mkdtemp(path.join(tmpdir(), 'opds-merge-pdfs-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18371, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('[data-tab="organize"]', { timeout: 120000 });

  // Zonder document staat de knop uit.
  await page.locator('[data-tab="organize"]').click();
  await page.waitForSelector('#merge-pdfs');
  assert.equal(await page.locator('#merge-pdfs').isDisabled(), true, 'Merge is disabled without a document');

  // Het open document: twee rode bladen, in de doorlopende weergave, met een
  // annotatie op blad 2.
  await page.evaluate(async (bytes) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { setViewMode } = await import('/js/pdf/renderer.js');
    const { runAppEvent } = await import('/js/mcp-bridge.js');
    const tab = createTab('/doel.pdf');
    await loadPDF('/doel.pdf', tab.index, new Uint8Array(bytes));
    await setViewMode('continuous');
    const r = await runAppEvent('mcp:create-annotation', { type: 'box', page: 2, props: { x: 100, y: 100, width: 80, height: 60 } });
    if (!r.ok) throw new Error(`annotation not created: ${JSON.stringify(r)}`);
  }, Array.from(await maakPdf('doel', 2, [1, 0, 0])));

  // Het venster openen met de lintknop.
  await page.locator('[data-tab="organize"]').click();
  assert.equal(await page.locator('#merge-pdfs').isDisabled(), false, 'Merge is enabled with a document');
  await page.locator('#merge-pdfs').click();
  await page.waitForSelector('.merge-pdfs-dialog');

  // Bestanden toevoegen met de plusknop: namen met spaties en niet-ASCII.
  const [kiezer] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.merge-pdfs-toolbar-btn').first().click(),
  ]);
  assert.equal(kiezer.isMultiple(), true, 'several files can be picked at once');
  await kiezer.setFiles([
    { name: 'Bijlage één (v2).pdf', mimeType: 'application/pdf', buffer: await maakPdf('B', 3, [0, 1, 0], [842, 595]) },
    { name: 'tweede — 図面.pdf', mimeType: 'application/pdf', buffer: await maakPdf('T', 1, [0, 0, 1]) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.merge-pdfs-file-item').length === 2);
  assert.deepEqual(await page.locator('.merge-pdfs-file-name').allTextContents(), ['Bijlage één (v2).pdf', 'tweede — 図面.pdf']);
  assert.match(await page.locator('.merge-pdfs-file-pages').first().textContent(), /^3\b/);

  // Van het eerste bestand alleen blad 1 en 2; invoegen na de huidige pagina.
  const bereik = page.locator('.merge-pdfs-range').first();
  await bereik.fill('1-2');
  await bereik.blur();
  assert.match(await page.locator('.merge-pdfs-file-count').textContent(), /\b3\b/, 'the page total follows the range');
  await page.evaluate(async () => { (await import('/js/core/state.ts')).getActiveDocument().currentPage = 1; });
  await page.locator('.merge-pdfs-select').selectOption('after');
  await page.locator('.merge-pdfs-footer .pref-btn-primary').click();

  await page.waitForFunction(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    return getActiveDocument()?.pdfDoc?.numPages === 5;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const na = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const doc = getActiveDocument();
    const teksten = [];
    const maten = [];
    for (let p = 1; p <= doc.pdfDoc.numPages; p++) {
      const blad = await doc.pdfDoc.getPage(p);
      teksten.push((await blad.getTextContent()).items.map((i) => i.str).join('').trim());
      const v = blad.getViewport({ scale: 1 });
      maten.push([Math.round(v.width), Math.round(v.height)]);
    }
    return {
      teksten, maten,
      weergave: doc.viewMode,
      pagina: doc.currentPage,
      gewijzigd: !!doc.modified,
      annotaties: doc.annotations.map((a) => [a.type, a.page]),
      vensterOpen: !!document.querySelector('.merge-pdfs-dialog'),
      doorlopendZichtbaar: getComputedStyle(document.getElementById('continuous-container')).display !== 'none',
    };
  });
  assert.deepEqual(na.teksten, ['doel p1', 'B p1', 'B p2', 'T p1', 'doel p2']);
  assert.deepEqual(na.maten, [[595, 842], [842, 595], [842, 595], [595, 842], [595, 842]]);
  assert.deepEqual(na.annotaties, [['box', 5]], 'the annotation of the open document moved with its page');
  assert.equal(na.vensterOpen, false, 'the dialog closed');
  assert.equal(na.gewijzigd, true);
  assert.equal(na.weergave, 'continuous');
  assert.equal(na.doorlopendZichtbaar, true);
  assert.equal(na.pagina, 2, 'the first merged page is in front');

  // De doorlopende weergave toont het samengevoegde blad (groen), niet meer
  // alleen het oude document (rood).
  const png = await page.screenshot();
  const kleur = await page.evaluate(async (b64) => {
    const c = document.getElementById('pdf-container').getBoundingClientRect();
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, png.toString('base64'));
  assert.ok(kleur[1] > 200 && kleur[0] < 80 && kleur[2] < 80, `the merged page is shown in the continuous view (pixel ${kleur})`);

  // Ongedaan maken zet het document terug.
  await page.evaluate(async () => { await (await import('/js/core/undo-manager.js')).undo(); });
  await page.waitForFunction(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    return getActiveDocument()?.pdfDoc?.numPages === 2;
  }, null, { timeout: 60000 });

  assert.deepEqual(fouten, [], 'no uncaught browser errors');
  console.log(JSON.stringify({ passed: true, paginas: na.teksten, weergave: na.weergave }));
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
