// #1246: echte loader/saver en PDF.js; alleen native bestandsschrijven is nep.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classicFixture, damageClassic } from './pdf-lib-classic-xref-fixture.mjs';
const cache = mkdtempSync(join(tmpdir(), 'opds-classic-browser-'));
let server, browser;
try {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const raw = await classicFixture();
  const damaged = damageClassic(raw);
  const bad = Uint8Array.from(Buffer.from(Buffer.from(damaged).toString('latin1').replace(/(\d{10})       n/, '9999999999       n'), 'latin1'));
  const result = await page.evaluate(async ({ raw, damaged, bad }) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF, getSharedPdfLibDoc, setCachedPdfBytes, getCachedPdfBytes } = await import('/js/pdf/loader.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { savePDF } = await import('/js/pdf/saver.js');
    const { maakOpslagAnnulering } = await import('/js/pdf/saver/opslag-annuleren.js');
    // De applicatie gebruikt de legacy PDF.js-bundel. Onafhankelijke tekst/pixelcontrole.
    const pdfjs = await import('/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';
    async function render(bytes) {
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
      const pdf = await task.promise;
      const result = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const p = await pdf.getPage(n); const viewport = p.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        // De saver bouwt annotatie-appearances opnieuw; vergelijk pagina-inhoud zonder die laag.
        await p.render({ canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let nonWhite = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240) nonWhite++;
        result.push({ text: (await p.getTextContent()).items.map(i => i.str).join(''), nonWhite, image: canvas.toDataURL() });
      }
      await task.destroy(); return result;
    }
    const baseline = await render(raw);
    const damagedRender = await render(damaged);
    await loadPDF('/classic.pdf', createTab('classic.pdf').index, new Uint8Array(damaged));
    const doc = getActiveDocument(); await doc._annotationCompletion;
    const shared = await getSharedPdfLibDoc(doc);
    const loaded = { pages: shared.getPageCount(), annotations: doc.annotations.length };
    doc.modified = true;
    let writes = 0, saved;
    const files = new Map([['/classic.pdf', new Uint8Array(damaged)]]);
    window.__TAURI__ = {
      path: { tempDir: async () => '/temp' },
      fs: { readFile: async p => files.get(p)?.slice(), remove: async () => {}, writeFile: async (p, b) => { writes++; files.set(p, b.slice()); } },
      core: { invoke: async (cmd, args, opts) => {
        if (cmd === 'write_file_atomic') { writes++; saved = new Uint8Array(args).slice(); files.set(decodeURIComponent(opts.headers['x-opds-path']), saved); return true; }
        if (cmd.startsWith('render_')) throw new Error('No native rendering in this test');
        return null;
      } },
    };
    const original = new Uint8Array(bad); files.set('/classic.pdf', original.slice()); setCachedPdfBytes(doc.filePath, original);
    const failed = await savePDF(null, { zonderHandtekeningVraag: true });
    const failure = { failed, writes, modified: doc.modified, cacheIntact: getCachedPdfBytes(doc.filePath) === original, sourceIntact: files.get('/classic.pdf').every((v, i) => v === bad[i]) };
    const recovered = new Uint8Array(damaged); files.set('/classic.pdf', recovered.slice()); setCachedPdfBytes(doc.filePath, recovered);
    const cancellation = maakOpslagAnnulering(); cancellation.annuleer();
    const cancelled = await savePDF(null, { zonderHandtekeningVraag: true, annulering: cancellation });
    const cancelState = { cancelled, writes, modified: doc.modified, cacheIntact: getCachedPdfBytes(doc.filePath) === recovered };
    const success = await savePDF(null, { zonderHandtekeningVraag: true });
    const rendered = await render(saved);
    delete window.__TAURI__;
    await loadPDF('/reopened.pdf', createTab('reopened.pdf').index, saved.slice());
    const reopened = getActiveDocument(); await reopened._annotationCompletion;
    return { loaded, failure, cancelState, success, writes, reopened: { pages: reopened.pdfDoc.numPages, annotations: reopened.annotations.length }, texts: rendered.map(x => x.text), nonWhite: rendered.map(x => x.nonWhite), damagedMatches: JSON.stringify(baseline) === JSON.stringify(damagedRender), savedMatches: JSON.stringify(baseline) === JSON.stringify(rendered) };
  }, { raw: [...raw], damaged: [...damaged], bad: [...bad] });
  assert.deepEqual(result.loaded, { pages: 2, annotations: 1 });
  assert.deepEqual(result.failure, { failed: false, writes: 0, modified: true, cacheIntact: true, sourceIntact: true });
  assert.deepEqual(result.cancelState, { cancelled: false, writes: 0, modified: true, cacheIntact: true });
  assert.equal(result.success, true); assert.ok(result.writes > 0);
  assert.deepEqual(result.reopened, { pages: 2, annotations: 1 });
  assert.deepEqual(result.texts, ['Classic XRef recovery page 1', 'Classic XRef recovery page 2']);
  assert.ok(result.nonWhite.every(n => n > 100));
  assert.equal(result.damagedMatches, true); assert.equal(result.savedMatches, true);
  console.log(JSON.stringify({ browser: browser.version(), ...result }));
} finally { await browser?.close(); await server?.close(); rmSync(cache, { recursive: true, force: true }); }
