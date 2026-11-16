// Exercise the actual continuous-page renderer against a contrasting page.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, PDFName } from 'pdf-lib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-highlight-'));
const server = await createServer({ cacheDir: cache, server: { host: '127.0.0.1', port: 3201, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0], { timeout: 120000 });
  await page.waitForSelector('#document-tabs', { timeout: 120000 });
  const pdf = await PDFDocument.create();
  const pdfPage = pdf.addPage([200, 200]);
  const highlight = pdf.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [20, 160, 100, 180],
    QuadPoints: [20, 180, 100, 180, 20, 160, 100, 160], C: [1, 1, 0], F: 4 });
  pdfPage.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(highlight)]));
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const tab = createTab('/highlight-test.pdf');
    await loadPDF('/highlight-test.pdf', tab.index, new Uint8Array(bytes));
    await (await import('/js/core/state.ts')).getActiveDocument()._annotationCompletion;
  }, Array.from(await pdf.save()));
  assert.deepEqual(await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    return doc.annotations.map(a => ({ type: a.type, blendMode: a.blendMode }));
  }), [{ type: 'textHighlight', blendMode: undefined }], 'imported highlight retains its implicit default');
  for (const overlayClass of ['annotation-canvas', 'annotation-canvas-sharp']) {
    for (const dpr of [1, 2]) {
      for (const geometry of ['rects', 'quads']) {
        const result = await page.evaluate(async ({ overlayClass, dpr, geometry }) => {
          const { getActiveDocument } = await import('/js/core/state.ts');
          const { renderAnnotationsForPage } = await import('/js/annotations/rendering.js');
          const doc = getActiveDocument(); doc.scale = 1;
          const rect = { x: 20, y: 20, width: 80, height: 20 };
          // Loaded PDF highlights and newly drawn text highlights omit blendMode:
          // Multiply is their inherent appearance, not a user override.
          const annotation = { id: 'highlight', type: 'textHighlight', page: 1,
            ...rect, color: '#FFFF00', fillColor: '#FFFF00', opacity: 1,
            ...(geometry === 'rects' ? { rects: [rect] } : { quads: [[
              { x: 20, y: 20 }, { x: 100, y: 20 }, { x: 20, y: 40 }, { x: 100, y: 40 },
            ]] }) };
          doc.annotations = [annotation]; doc.selectedAnnotations = []; doc.selectedAnnotation = null;
          const container = document.createElement('div');
          Object.assign(container.style, { position: 'fixed', left: '0', top: '0', width: '200px', height: '200px', zIndex: '99999' });
          const background = document.createElement('canvas'); background.className = 'pdf-canvas';
          background.width = background.height = 200;
          Object.assign(background.style, { width: '200px', height: '200px' });
          const b = background.getContext('2d'); b.fillStyle = 'white'; b.fillRect(0, 0, 200, 200);
          b.fillStyle = 'black'; b.fillRect(40, 20, 10, 20);
          const overlay = document.createElement('canvas'); overlay.className = overlayClass;
          // A cropped overlay at a nonzero offset, as used after scrolling.
          overlay.width = overlay.height = 100 * dpr;
          Object.assign(overlay.style, { position: 'absolute', left: '10px', top: '10px', width: '100px', height: '100px' });
          container.append(background, overlay); document.body.append(container);
          const ctx = overlay.getContext('2d');
          renderAnnotationsForPage(ctx, 1, overlay.width, overlay.height, dpr, { x: 10, y: 10 });
          const composite = document.createElement('canvas'); composite.width = composite.height = 200;
          const c = composite.getContext('2d'); c.drawImage(background, 0, 0); c.drawImage(overlay, 10, 10, 100, 100);
          const pixel = (x, y) => Array.from(c.getImageData(x, y, 1, 1).data);
          const result = { text: pixel(45, 30), paper: pixel(30, 30), outside: pixel(30, 60), blendMode: annotation.blendMode };
          // A user-selected mode must still take precedence over the default.
          doc.annotations[0].blendMode = 'screen';
          renderAnnotationsForPage(ctx, 1, overlay.width, overlay.height, dpr, { x: 10, y: 10 });
          c.clearRect(0, 0, 200, 200); c.drawImage(background, 0, 0); c.drawImage(overlay, 10, 10, 100, 100);
          result.screenText = pixel(45, 30); result.screenPaper = pixel(30, 30);
          container.remove(); return result;
        }, { overlayClass, dpr, geometry });
        assert.deepEqual(result.text, [0, 0, 0, 255], `${overlayClass}/${dpr}/${geometry}: text must remain black`);
        assert.deepEqual(result.paper, [255, 255, 0, 255], 'white paper must become yellow');
        assert.deepEqual(result.outside, [255, 255, 255, 255], 'outside the highlight must stay unchanged');
        assert.deepEqual(result.screenText, [255, 255, 0, 255], 'explicit screen blends black to yellow');
        assert.deepEqual(result.screenPaper, [255, 255, 255, 255], 'explicit screen preserves white');
        assert.equal(result.blendMode, undefined, 'rendering must not mutate stored annotation properties');
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: continuous and sharp text highlights preserve text, rects/quads, DPR 1/2, cropped overlay offsets');
} catch (e) { console.error(e); process.exitCode = 1; } finally {
  await browser.close(); await Promise.race([server.close(), new Promise(r => setTimeout(r, 2000))]); await rm(cache, { recursive: true, force: true });
}
process.exit(process.exitCode || 0);
