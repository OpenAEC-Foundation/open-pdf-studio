import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-blank-save-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18357, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const mode of ['continuous', 'single']) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
    await page.waitForSelector('#tool-select', { timeout: 120000 });
    const result = await page.evaluate(async mode => {
      const { state, getActiveDocument } = await import('/js/core/state.ts');
      const { runAppEvent } = await import('/js/mcp-bridge.js');
      state.preferences.defaultViewMode = mode;
      const created = await runAppEvent('mcp:new-blank-pdf', { widthPt: 600, heightPt: 800, pages: 2 });
      if (!created.ok) throw new Error(JSON.stringify(created));
      const doc = getActiveDocument();
      const ready = [1, 2].map(n => doc._annotationPagesReady.has(n));
      for (const page of [1, 2]) {
        const reply = await runAppEvent('mcp:create-annotation', {
          type: 'box', page, props: { x: 30, y: 40, width: 60, height: 70 },
        });
        if (!reply.ok) throw new Error(JSON.stringify(reply));
      }
      const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(doc);
      return { ready, mode: doc.viewMode, bytes: Array.from(await pdfDocLib.save()) };
    }, mode);
    assert.equal(result.mode, mode);
    assert.deepEqual(result.ready, [true, true]);
    const saved = await PDFDocument.load(new Uint8Array(result.bytes));
    assert.equal(saved.getPageCount(), 2);
    for (const pdfPage of saved.getPages()) {
      const annotations = pdfPage.node.lookup(PDFName.of('Annots'));
      assert.equal(annotations.size(), 1);
      assert.equal(annotations.lookup(0).get(PDFName.of('Subtype')).toString(), '/Square');
    }
    await page.close();
    console.log(`PASS ${mode}: newly generated pages are ready; annotations on both pages survive saving`);
  }

  // Supplied template bytes are not known to be empty. An annotation that
  // has not been loaded into the model must remain in the saved PDF.
  const template = await PDFDocument.create();
  template.addPage([600, 800]);
  const second = template.addPage([600, 800]);
  second.node.set(PDFName.of('Annots'), template.context.obj([
    template.context.register(template.context.obj({ Type: 'Annot', Subtype: 'Text',
      Rect: [20, 20, 40, 40], Contents: PDFString.of('Keep template note') })),
  ]));
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const bytes = await page.evaluate(async input => {
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    state.preferences.defaultViewMode = 'continuous';
    await (await import('/js/pdf/loader.js')).createBlankPDF(600, 800, 2, new Uint8Array(input));
    const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(getActiveDocument());
    return Array.from(await pdfDocLib.save());
  }, Array.from(await template.save()));
  const saved = await PDFDocument.load(new Uint8Array(bytes));
  const notes = saved.getPage(1).node.lookup(PDFName.of('Annots'));
  assert.equal(notes.size(), 1);
  assert.equal(notes.lookup(0).lookup(PDFName.of('Contents')).decodeText(), 'Keep template note');
  console.log('PASS supplied template: existing annotation survives save');
} finally {
  await browser?.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
