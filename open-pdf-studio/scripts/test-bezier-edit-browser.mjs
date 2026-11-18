// Actual context menu, pointer dragging, undo and save/reopen for #1169.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-bezier-edit-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18469, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  for (const mode of ['single', 'continuous']) {
  await page.evaluate(async (mode) => {
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    const renderer = await import('/js/pdf/renderer.js');
    const edit = await import('/js/annotations/bezier-edit.js');
    const geometry = await import('/js/annotations/bezier-contour.js');
    const render = await import('/js/annotations/rendering.js');
    window.be = { state, getActiveDocument, renderer, edit, geometry, render, mode };
    await (await import('/js/pdf/loader.js')).createBlankPDF(595, 842, 1);
    await renderer.setViewMode(mode); await renderer.fitPage();
    const i18n = (await import('/js/i18n/config.js')).default;
    await i18n.changeLanguage('en');
    const ann = (await import('/js/annotations/factory.js')).createAnnotation({type:'polyline',page:1,points:[{x:100,y:200},{x:350,y:200},{x:400,y:350}],strokeColor:'#000000',lineWidth:2});
    (await import('/js/tools/manager.js')).setTool('select');
    const d=getActiveDocument();d.annotations=[ann];d.selectedAnnotations=[d.annotations[0]];d.selectedAnnotation=d.annotations[0];
    render.redrawAnnotations();
  }, mode);
  const snap = () => page.evaluate(() => JSON.parse(JSON.stringify(window.be.getActiveDocument().annotations[0])));
  const client = p => page.evaluate(async p => {
    const { paginaNaarClient } = await import('/js/pdf/weergave-ruimte.js');
    return paginaNaarClient(1,p.x,p.y);
  },p);
  async function english() { await page.evaluate(async()=>{window.be.state.preferences.language='en';await (await import('/js/i18n/config.js')).default.changeLanguage('en');}); }
  async function context(p, label) {
    await english();
    const q=await client(p); await page.mouse.click(q.x,q.y,{button:'right'});
    await page.getByText(label,{exact:true}).click();
  }
  async function drag(p, dx,dy) {
    const a=await client(p),b=await client({x:p.x+dx,y:p.y+dy});
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();
  }
  await context({x:225,y:200},'Make segment curved');
  let ann=await snap(); assert.ok(ann.points[0].outgoing);assert.ok(ann.points[1].incoming);
  const original=structuredClone(ann);
  await drag(ann.points[0].outgoing,0,80);
  ann=await snap();assert.ok(ann.points[0].outgoing.y>270,JSON.stringify(ann));assert.deepEqual(ann.points[1].incoming,original.points[1].incoming);
  const changed=structuredClone(ann);
  await page.evaluate(async()=> (await import('/js/core/undo-manager.js')).undo());
  assert.deepEqual((await snap()).points,original.points);
  await page.evaluate(async()=> (await import('/js/core/undo-manager.js')).redo());
  assert.deepEqual((await snap()).points,changed.points);
  const mid=await page.evaluate(()=>{const b=window.be;return b.geometry.contourPoint(b.geometry.contourSegments(b.getActiveDocument().annotations[0].points)[0],.5);});
  await context(mid,'Insert vertex here');assert.equal((await snap()).points.length,4);
  await page.evaluate(async()=> (await import('/js/core/undo-manager.js')).undo());
  const beforeSave=(await snap()).points;
  await page.evaluate(async()=>{
    const {pdfDocLib}=await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(window.be.getActiveDocument());
    const bytes=await pdfDocLib.save();
    await (await import('/js/pdf/loader.js')).createBlankPDF(595,842,1,bytes.slice());
    const b=window.be,d=b.getActiveDocument();d.selectedAnnotations=[d.annotations[0]];d.selectedAnnotation=d.annotations[0];
    await b.renderer.setViewMode(b.mode);await b.renderer.fitPage();b.render.redrawAnnotations();
  });
  ann=await snap();
  for(let i=0;i<beforeSave.length;i++)for(const k of ['x','y'])assert.ok(Math.abs(ann.points[i][k]-beforeSave[i][k])<1e-5);
  assert.ok(Math.abs(ann.points[0].outgoing.y-beforeSave[0].outgoing.y)<1e-5);
  await drag(ann.points[1].incoming,0,60);
  assert.ok((await snap()).points[1].incoming.y>250);
  const mid2=await page.evaluate(()=>{const b=window.be;return b.geometry.contourPoint(b.geometry.contourSegments(b.getActiveDocument().annotations[0].points)[0],.5);});
  await context(mid2,'Make segment straight');assert.equal((await snap()).points[0].outgoing,undefined);
  await page.evaluate(()=>{window.be.getActiveDocument().annotations[0].locked=true;});
  await english();
  const q=await client({x:225,y:200});await page.mouse.click(q.x,q.y,{button:'right'});
  const locked=page.getByText('Make segment curved',{exact:true});
  assert.ok(await locked.evaluate(el=>el.closest('.context-menu-item')?.className.includes('disabled')));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{const d=window.be.getActiveDocument();d.annotations[0].locked=false;d.pdfaCompliance='PDF/A-2b';d.pdfADismissed=false;d.selectedAnnotations=[d.annotations[0]];d.selectedAnnotation=d.annotations[0];});
  await page.mouse.click(q.x,q.y,{button:'right'});
  assert.ok(await page.getByText('Make segment curved',{exact:true}).evaluate(el=>el.closest('.context-menu-item')?.className.includes('disabled')));
  await page.evaluate(async()=>{
    const b=window.be,d=b.getActiveDocument();d.pdfaCompliance=null;d.pdfADismissed=true;
    (await import('/js/solid/stores/contextMenuStore.js')).hideMenu();
    (await import('/js/ui/panels/properties-panel.js')).hideProperties();
    const ann=(await import('/js/annotations/factory.js')).createAnnotation({type:'polygon',page:1,x:120,y:220,width:180,height:120,sides:5,rotation:30,flipX:true});
    d.annotations=[ann];d.selectedAnnotations=[d.annotations[0]];d.selectedAnnotation=d.annotations[0];b.render.redrawAnnotations();
  });
  const polygonBefore=await page.evaluate(()=>window.be.edit.bezierEditNodes(window.be.getActiveDocument().annotations[0]));
  const midpoint={x:(polygonBefore[0].x+polygonBefore[1].x)/2,y:(polygonBefore[0].y+polygonBefore[1].y)/2};
  await context(midpoint,'Make segment curved');
  const polygonCurve=await page.evaluate(()=>window.be.edit.bezierEditNodes(window.be.getActiveDocument().annotations[0]));
  await drag(polygonCurve[0].outgoing,25,40);
  const polygonAfter=await page.evaluate(()=>window.be.edit.bezierEditNodes(window.be.getActiveDocument().annotations[0]));
  assert.ok(polygonAfter[0].outgoing.y-polygonCurve[0].outgoing.y>30);
  for(let i=0;i<polygonBefore.length;i++)for(const k of ['x','y'])assert.ok(Math.abs(polygonAfter[i][k]-polygonBefore[i][k])<1e-5);
  console.log(mode, 'PASS: rotated/reflected regular polygon materialization and independent control drag');
  console.log(mode, 'PASS: actual segment menu, independent pointer control drag, undo/redo, exact insertion, save/reopen/re-edit, straightening and locked/read-only menu guards');
  }
} finally { await browser?.close();await server.close();await rm(cache,{recursive:true,force:true}); }
