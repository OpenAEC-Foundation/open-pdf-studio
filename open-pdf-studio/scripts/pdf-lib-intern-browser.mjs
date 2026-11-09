// Browsercontrole van de werkelijke Vite dependency-optimizer (#988).
// Eigen server, tijdelijke cache, geen HMR en geen bestaande appverbinding.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const cache = mkdtempSync(join(tmpdir(), 'opds-intern-browser-'));
let server, browser;
try {
  server = await createServer({ cacheDir: cache, server: { port: 32888, host: '127.0.0.1', strictPort: true, hmr: false }, plugins: [{
    name: 'intern-probe-entry',
    resolveId(id) { if (id === '/intern-probe.mjs') return '\0intern-probe'; },
    load(id) { if (id === '\0intern-probe') return "export { PDFDocument, PDFName, PDFRef, PDFNumber } from 'pdf-lib';"; },
    configureServer(s) { s.middlewares.use('/intern-probe.html', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Intern pool test</title>'); }); },
  }] });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:32888/intern-probe.html');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await page.evaluate(async () => {
    const lib = await import('/intern-probe.mjs');
    window.internTest = { lib, alive: [], weak: [] };
    window.makeInternDoc = async (prefix, base) => {
      const { PDFDocument, PDFName, PDFRef, PDFNumber } = lib;
      const doc = await PDFDocument.create(); doc.addPage([100,100]);
      for (let i=0;i<6000;i++) { const ref=PDFRef.of(base+i); doc.context.assign(ref,PDFNumber.of(i)); doc.catalog.set(PDFName.of(prefix+i+'x'.repeat(100)),ref); }
      return PDFDocument.load(await doc.save({useObjectStreams:false}));
    };
    window.internTest.alive.push(await window.makeInternDoc('aliveA',10000), await window.makeInternDoc('aliveB',20000));
  });
  const samples=[];
  for (let round=0;round<3;round++) {
    await page.evaluate(async round => {
      const t=window.internTest, {PDFName,PDFRef}=t.lib;
      let doc=await window.makeInternDoc('gone'+round,30000+round*10000);
      t.weak=[new WeakRef(PDFName.of('gone'+round+'0'+'x'.repeat(100))), new WeakRef(PDFRef.of(30000+round*10000))]; doc=null;
    }, round);
    for (let i=0;i<8;i++) { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(10); }
    const result = await page.evaluate(async round => {
      const t=window.internTest,{PDFName,PDFNumber,PDFDocument}=t.lib;
      const collected=t.weak.every(r=>r.deref()===undefined);
      const value=t.alive[0].catalog.lookup(PDFName.of('aliveA0'+'x'.repeat(100)),PDFNumber).asNumber();
      const [copy]=await t.alive[1].copyPages(t.alive[0],[0]);t.alive[1].addPage(copy);
      const reopened=await PDFDocument.load(await t.alive[1].save());
      return {collected,value,pages:reopened.getPageCount()};
    },round);
    assert.deepEqual(result,{collected:true,value:0,pages:round+2});
    await cdp.send('HeapProfiler.collectGarbage');
    samples.push(await cdp.send('Runtime.getHeapUsage'));
  }
  console.log(JSON.stringify({browser:browser.version(),rounds:3,liveDocuments:2,heap:samples}));
} finally {
  await browser?.close(); await server?.close(); rmSync(cache,{recursive:true,force:true});
}
