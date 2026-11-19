// Real compare rendering and wheel bubbling, including the hidden main PDF (#1180).
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-compare-wheel-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18471, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 2; i++) pdf.addPage([1000, 1200]).drawText(`Compare wheel ${i}`, { x: 200, y: 600 });
  await page.evaluate(async bytes => {
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const renderer = await import('/js/pdf/renderer.js');
    const compare = await import('/js/compare/compare-store.js');
    const view = await import('/js/pdf/pdf-viewport.js');
    for (const name of ['/compare-old.pdf', '/compare-new.pdf']) {
      const tab = createTab(name);
      await loadPDF(name, tab.index, new Uint8Array(bytes));
      await getActiveDocument()._annotationCompletion;
    }
    await renderer.setViewMode('single');
    await renderer.setZoom(1.5);
    compare.setCompareAutoAlign(false);
    compare.startCompare({oldFilePath:'/compare-old.pdf',newFilePath:'/compare-new.pdf',mode:'side',oldPageCount:2,newPageCount:2});
    window.cw = { state, getActiveDocument, renderer, compare, view };
  }, Array.from(await pdf.save()));
  await page.waitForSelector('.compare-pane-old canvas');
  await page.waitForFunction(() => [...document.querySelectorAll('.compare-view canvas')].some(c => c.width > 500));
  await page.waitForTimeout(700);
  const mainState = () => page.evaluate(() => {
    const t = window.cw, c = document.getElementById('pdf-container'), r = document.querySelector('.compare-view').getBoundingClientRect();
    return { scale:t.getActiveDocument().scale, page:t.getActiveDocument().currentPage, zoom:t.view.viewport.zoom, ox:t.view.viewport.offsetX, oy:t.view.viewport.offsetY, left:c.scrollLeft, top:c.scrollTop, x:r.x, y:r.y };
  });
  for (const mode of ['side','overlay','split']) for (const ctrl of [false,true]) {
    await page.evaluate(({mode,ctrl}) => {
      const t=window.cw;t.compare.setCompareMode(mode);t.compare.setCompareZoom(1);t.state.preferences.wheelZoomWithoutCtrl=!ctrl;
    },{mode,ctrl});
    await page.waitForTimeout(450);
    const pane = mode === 'side' ? '.compare-pane-old' : '.compare-body';
    const box=await page.locator(pane).boundingBox();
    const point={x:box.x+box.width*.3,y:box.y+box.height*.4};
    const before=await mainState();
    const anchor=await page.locator(pane).evaluate((el,point)=>{
      const r=el.querySelector('canvas').getBoundingClientRect();
      return {fx:(point.x-r.left)/r.width,fy:(point.y-r.top)/r.height};
    },point);
    await page.mouse.move(point.x,point.y);
    if(ctrl)await page.keyboard.down('Control');
    for(let i=0;i<8;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(100);}
    if(ctrl)await page.keyboard.up('Control');
    await page.waitForTimeout(450);
    const zoom=await page.evaluate(()=>window.cw.compare.compareZoom());
    assert.deepEqual(await mainState(),before,`${mode}, ctrl=${ctrl}: hidden PDF and compare position stay fixed`);
    assert.ok(Math.abs(zoom-1.1**8)<.001,`${mode}: all eight notches reach compare (${zoom})`);
    const drift=await page.locator(pane).evaluate((el,{point,anchor})=>{
      const r=el.querySelector('canvas').getBoundingClientRect();
      return {x:r.left+anchor.fx*r.width-point.x,y:r.top+anchor.fy*r.height-point.y};
    },{point,anchor});
    // Scroll offsets round to CSS pixels at each of the eight steps.
    assert.ok(Math.abs(drift.x)<=4 && Math.abs(drift.y)<=4,`${mode}: cursor anchor drift ${JSON.stringify(drift)}`);
    // Both ends of each scroll axis remain inside the visible compare pane.
    for (const end of [false,true]) {
      const edges=await page.locator(pane).evaluate((el,end)=>{
        el.scrollLeft=end?el.scrollWidth:0;el.scrollTop=end?el.scrollHeight:0;
        const page=el.querySelector('canvas');const r=page.getBoundingClientRect(),p=el.getBoundingClientRect();
        return {left:r.left-p.left,top:r.top-p.top,right:r.right-(p.left+el.clientWidth),bottom:r.bottom-(p.top+el.clientHeight)};
      },end);
      assert.ok(end ? edges.right<=2 && edges.bottom<=2 : edges.left>=-2 && edges.top>=-2,`${mode}: reachable edges ${JSON.stringify(edges)}`);
    }
    // Shift-wheel and ordinary scroll must not leak to the hidden document either.
    await page.evaluate(()=>{window.cw.state.preferences.wheelZoomWithoutCtrl=false;});
    await page.mouse.wheel(0,100);await page.waitForTimeout(250);
    await page.keyboard.down('Shift');await page.mouse.wheel(0,100);await page.keyboard.up('Shift');await page.waitForTimeout(250);
    assert.deepEqual(await mainState(),before,`${mode}: ordinary and Shift wheel stay isolated`);
    console.log(`PASS ${mode}, ctrl=${ctrl}`);
  }
  await page.evaluate(()=>{window.cw.compare.exitCompare();window.cw.state.preferences.wheelZoomWithoutCtrl=true;});
  await page.waitForTimeout(350);
  const prior=await page.evaluate(()=>window.cw.getActiveDocument().scale);
  const box=await page.locator('#pdf-container').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-100);
  await page.waitForFunction(z=>window.cw.getActiveDocument().scale!==z,prior);
  assert.deepEqual(errors,[]);
  console.log('PASS main wheel zoom restored after compare closes');
} finally { await browser?.close(); await server.close(); await rm(cache,{recursive:true,force:true}); }
