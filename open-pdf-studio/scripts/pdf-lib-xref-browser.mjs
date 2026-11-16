// Werkelijke Vite-optimizer + saver; uitsluitend native bestandsschrijven is nep.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cache = mkdtempSync(join(tmpdir(), 'opds-xref-browser-'));
let server, browser;
try {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: cache, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
      name: 'xref-probe', resolveId(id) { if (id === '/xref-probe.mjs') return '\0xref-probe'; },
      load(id) { if (id === '\0xref-probe') return "export { PDFDocument } from 'pdf-lib';"; },
    }] });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const pdf = await PDFDocument.create(); pdf.addPage([100, 100]);
  const valid = await pdf.save({ useObjectStreams: false });
  const bad = Buffer.concat([Buffer.from(valid), Buffer.from('\n999 0 obj\n<< /Type /XRef /Size 1000 /Index [0 1] /W [100000 100000 100000] /Length 0 >>\nstream\n\nendstream\nendobj\n')]);
  const result = await page.evaluate(async ({ valid, bad }) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF, setCachedPdfBytes, getCachedPdfBytes } = await import('/js/pdf/loader.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { savePDF } = await import('/js/pdf/saver.js');
    const { PDFDocument } = await import('/xref-probe.mjs');
    const { maakOpslagAnnulering } = await import('/js/pdf/saver/opslag-annuleren.js');
    const { index } = createTab('xref.pdf');
    await loadPDF('/xref.pdf', index, new Uint8Array(valid));
    const doc = getActiveDocument(); await doc._annotationCompletion;
    doc.modified = true;
    const original = new Uint8Array(bad);
    setCachedPdfBytes(doc.filePath, original);
    let writes = 0, saved;
    const files = new Map([['/xref.pdf', original.slice()]]);
    window.__TAURI__ = {
      path: { tempDir: async () => '/temp' },
      fs: { readFile: async p => files.get(p)?.slice(), remove: async () => {},
        writeFile: async (p, bytes) => { writes++; files.set(p, bytes.slice()); } },
      core: { invoke: async (cmd, args, opts) => {
        if (cmd === 'write_file_atomic') {
          writes++; saved = new Uint8Array(args).slice(); files.set(decodeURIComponent(opts.headers['x-opds-path']), saved); return true;
        }
        if (cmd.startsWith('render_')) throw new Error('No native rendering in this test');
        return null;
      } },
    };
    let directRejected = false;
    try { await PDFDocument.load(original, { parseSpeed: 5000 }); }
    catch (e) { directRejected = e.name === 'InvalidXRefStreamError'; }
    const failed = await savePDF(null, { zonderHandtekeningVraag: true });
    const failure = { failed, directRejected, writes, modified: doc.modified,
      cacheIntact: getCachedPdfBytes(doc.filePath) === original,
      sourceIntact: files.get('/xref.pdf').every((v, i) => v === bad[i]) };
    setCachedPdfBytes(doc.filePath, new Uint8Array(valid));
    const cancellation = maakOpslagAnnulering(); cancellation.annuleer();
    const cancelled = await savePDF(null, { zonderHandtekeningVraag: true, annulering: cancellation });
    const writesAfterCancel = writes;
    const success = await savePDF(null, { zonderHandtekeningVraag: true });
    const pages = (await PDFDocument.load(saved)).getPageCount();
    return { failure, cancelled, writesAfterCancel, success, pages, writes };
  }, { valid: [...valid], bad: [...bad] });
  assert.deepEqual(result.failure, { failed: false, directRejected: true, writes: 0, modified: true, cacheIntact: true, sourceIntact: true });
  assert.equal(result.cancelled, false); assert.equal(result.writesAfterCancel, 0);
  assert.equal(result.success, true); assert.equal(result.pages, 1); assert.ok(result.writes > 0);
  console.log(JSON.stringify({ browser: browser.version(), ...result }));
} finally {
  await browser?.close(); await server?.close(); rmSync(cache, { recursive: true, force: true });
}
