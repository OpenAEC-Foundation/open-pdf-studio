// Exercise the real app's keyboard and wheel handlers in a private browser.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, degrees, rgb } from 'pdf-lib';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-zoom-anchor-'));
const server = await createServer({
  root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18033, strictPort: false, hmr: false },
});
const fixture = await PDFDocument.create();
const sheet = fixture.addPage([1300, 1700]);
sheet.setCropBox(50, 60, 1200, 1600);
sheet.setRotation(degrees(90));
sheet.drawRectangle({ x: 350, y: 450, width: 300, height: 400, color: rgb(0.2, 0.4, 0.8) });
const fixtureBytes = [...await fixture.save()];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, deviceScaleFactor: dpr });
    page.setDefaultTimeout(15000);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
    await page.waitForSelector('#tool-select', { timeout: 120000 });
    for (const kind of ['blank', 'opened-rotated']) {
      const loaded = await page.evaluate(async ({ kind, fixtureBytes }) => {
        const { createBlankPDF, loadPDF } = await import('/js/pdf/loader.js');
        if (kind === 'blank') await createBlankPDF(1200, 1600, 1);
        else {
          const { createTab } = await import('/js/ui/chrome/tabs.js');
          const { index } = createTab('zoom-anchor.pdf');
          await loadPDF('zoom-anchor.pdf', index, new Uint8Array(fixtureBytes));
        }
        const { getActiveDocument } = await import('/js/core/state.ts');
        const doc = getActiveDocument();
        const firstPage = await doc.pdfDoc.getPage(1);
        return { filePath: doc.filePath, rotation: firstPage.rotate, crop: firstPage.view };
      }, { kind, fixtureBytes });
      if (kind === 'opened-rotated') {
        assert.equal(loaded.filePath, 'zoom-anchor.pdf');
        assert.equal(loaded.rotation, 90);
        assert.deepEqual(loaded.crop, [50, 60, 1250, 1660]);
      } else assert.equal(loaded.filePath, null);
      for (const mode of ['single', 'continuous']) {
        await page.evaluate(async mode => {
          const { setViewMode, setZoom } = await import('/js/pdf/renderer.js');
          await setViewMode(mode);
          await setZoom(1.5);
          const c = document.getElementById('pdf-container');
          c.scrollLeft = 250; c.scrollTop = 350;
        }, mode);
        for (const input of ['key-in', 'key-out', 'wheel-in', 'wheel-out', 'wheel-burst']) {
          const before = await page.evaluate(async ({ mode, input }) => {
            const { getActiveDocument } = await import('/js/core/state.ts');
            const c = document.getElementById('pdf-container'), r = c.getBoundingClientRect();
            const p = (mode === 'single' ? document.getElementById('pdf-canvas') : document.querySelector('.canvas-container-cont')).getBoundingClientRect();
            const fraction = input.startsWith('key') ? 0.5 : 0.31;
            return {
              scale: getActiveDocument().scale,
              rect: { left: p.left, top: p.top, width: p.width, height: p.height },
              anchor: { x: r.left + c.clientLeft + c.clientWidth * fraction, y: r.top + c.clientTop + c.clientHeight * fraction },
            };
          }, { mode, input });
          if (input.startsWith('key')) {
            await page.keyboard.press(input === 'key-in' ? 'Control+=' : 'Control+-');
          } else {
            // Dispatch on the scrolling container, not the canvas: client
            // coordinates must not be relative to the event target bounds.
            await page.evaluate(({ anchor, input }) => {
              const target = document.getElementById('pdf-container');
              for (let n = 0; n < (input === 'wheel-burst' ? 3 : 1); n++) {
                target.dispatchEvent(new WheelEvent('wheel', {
                  clientX: anchor.x, clientY: anchor.y,
                  deltaY: input === 'wheel-out' ? 100 : -100,
                  ctrlKey: true, bubbles: true, cancelable: true,
                }));
              }
            }, { anchor: before.anchor, input });
          }
          await page.waitForFunction(async old => {
            const { getActiveDocument } = await import('/js/core/state.ts');
            return getActiveDocument().scale !== old && !window.__pdfRenderInFlight;
          }, before.scale);
          // Include the debounced continuous repaint, not just its CSS preview.
          await page.waitForTimeout(350);
          const after = await page.evaluate(mode => {
            const p = (mode === 'single' ? document.getElementById('pdf-canvas') : document.querySelector('.canvas-container-cont')).getBoundingClientRect();
            return { left: p.left, top: p.top, width: p.width, height: p.height };
          }, mode);
          const fx = (before.anchor.x - before.rect.left) / before.rect.width;
          const fy = (before.anchor.y - before.rect.top) / before.rect.height;
          const dx = after.left + fx * after.width - before.anchor.x;
          const dy = after.top + fy * after.height - before.anchor.y;
          assert.ok(Math.abs(dx) < 2 && Math.abs(dy) < 2, `${kind} ${mode} ${input} DPR${dpr}: anchor drift (${dx}, ${dy})`);
          console.log(`PASS ${kind} ${mode} ${input} DPR${dpr}: drift ${dx.toFixed(2)}, ${dy.toFixed(2)} CSS px`);
        }
      }
    }
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
