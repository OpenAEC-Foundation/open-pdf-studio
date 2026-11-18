// Real renderer and saved PDF appearances; control-handle UI is tested separately when implemented.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-bezier-render-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const results = await page.evaluate(async () => {
    const { drawAnnotation } = await import('/js/annotations/rendering.js');
    const { drawSelectionHandles } = await import('/js/annotations/rendering/selection.js');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { findAnnotationAt } = await import('/js/annotations/geometry.js');
    const { veelhoekUitPunten } = await import('/js/annotations/veelhoek-punten.js');
    await (await import('/js/pdf/loader.js')).createBlankPDF(595, 842, 1);
    const doc = getActiveDocument();
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext('2d');
    const pts = [{ x: 40, y: 40, outgoing: { x: 40, y: 140 } }, { x: 140, y: 40, incoming: { x: 140, y: 140 } }, { x: 190, y: 40 }];
    const ann = createAnnotation({ type: 'polyline', page: 1, points: pts, strokeColor: '#000000', lineWidth: 4, opacity: 1 });
    doc.annotations = [ann];
    const pixels = (x, y) => [...ctx.getImageData(x - 2, y - 2, 5, 5).data].filter((_, i) => i % 4 === 3).some(a => a > 0);
    drawAnnotation(ctx, ann);
    const line = { bow: pixels(90, 115), chord: pixels(90, 40), straight: pixels(165, 40), hit: findAnnotationAt(90, 115)?.id === ann.id };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const operations = [];
    const selectionContext = new Proxy(ctx, { get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args) => { if (key === 'bezierCurveTo') operations.push(args); return value.apply(target, args); };
    }, set(target, key, value) { target[key] = value; return true; } });
    drawSelectionHandles(selectionContext, ann);
    const selectionCurve = operations.some(args => args.join(',') === '40,140,140,140,140,40');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const poly = createAnnotation({ type: 'polygon', page: 1, ...veelhoekUitPunten(pts), strokeColor: '#000000', fillColor: '#00ff00', lineWidth: 4, opacity: 1 });
    drawAnnotation(ctx, poly);
    const area = { bow: pixels(90, 115), interior: pixels(90, 80), outside: pixels(90, 140) };
    async function saveAndRender(annotation) {
      getActiveDocument().annotations = [annotation];
      const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(getActiveDocument());
      const bytes = await pdfDocLib.save();
      await (await import('/js/pdf/loader.js')).createBlankPDF(595, 842, 1, bytes.slice());
      const loaded = getActiveDocument();
      const pdfPage = await loaded.pdfDoc.getPage(1);
      const viewport = pdfPage.getViewport({scale:1});
      const output = document.createElement('canvas');output.width=viewport.width;output.height=viewport.height;
      const context=output.getContext('2d');
      await pdfPage.render({canvasContext:context,viewport,annotationMode:1}).promise;
      const ink=(x,y)=>{const d=context.getImageData(x-2,y-2,5,5).data;for(let i=0;i<d.length;i+=4)if(Math.min(d[i],d[i+1],d[i+2])<100)return true;return false;};
      return {bow:ink(90,115),chord:ink(90,40),straight:ink(165,40),interior:ink(90,80),
        nodes:loaded.annotations[0]?.points?.length,handle:!!loaded.annotations[0]?.points?.[0]?.outgoing};
    }
    const savedLine=await saveAndRender(ann);
    const savedArea=await saveAndRender(poly);
    return { line, area, selectionCurve, savedLine, savedArea };
  });
  assert.deepEqual(results, { line: { bow: true, chord: false, straight: true, hit: true }, area: { bow: true, interior: true, outside: false }, selectionCurve: true, savedLine:{bow:true,chord:false,straight:true,interior:false,nodes:3,handle:true}, savedArea:{bow:true,chord:true,straight:true,interior:true,nodes:3,handle:true} });
  console.log('PASS: actual polyline/polygon renderer draws and hits cubic curves, retains straight segments and fills the curved polygon; saved PDF appearances render correctly and editable handles reopen');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
