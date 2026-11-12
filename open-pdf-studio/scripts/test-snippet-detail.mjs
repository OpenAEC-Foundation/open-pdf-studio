// Real PDF.js rasterization behind the native-region IPC contract; actual
// drawAnnotation and browser Canvas2D, without changing any running app.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-snippet-detail-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  for (const rotation of [0,90,180,270]) {
    const pdf = await PDFDocument.create(); const p = pdf.addPage([1000,1200]);
    p.setCropBox(40,60,900,1000); p.setRotation(degrees(rotation));
    // Fine vector lines disappear in the old 4096-pixel overview.
    for (let x=435; x<445; x+=0.25) p.drawRectangle({x,y:450,width:0.08,height:200,color:rgb(0,0,0)});
    p.drawRectangle({x:390,y:550,width:100,height:0.12,color:rgb(1,0,0)});
    const result = await page.evaluate(async ({bytes,rotation}) => {
      const lib = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      lib.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const task = lib.getDocument({data:new Uint8Array(bytes)}); const pdf = await task.promise;
      const source = await pdf.getPage(1);
      const store = await import('/js/annotations/vector-snippet-store.js');
      const previews = await import('/js/annotations/vector-snippet-preview.js');
      const {weergaveVak} = await import('/js/pdf/vector-embed.js');
      const {drawAnnotation} = await import('/js/annotations/rendering.js');
      previews.leegmaken(); store.leegmaken();
      const ann = {type:'vectorSnippet',id:'detail',page:1,x:10,y:20,width:600,height:800,
        srcBox:{left:140,bottom:160,right:740,top:960},snippetKey:store.bewaar(new Uint8Array(bytes)),opacity:0.5};
      const region = weergaveVak(ann.srcBox,{x:40,y:60,width:900,height:1000},rotation);
      ann.width=region.width; ann.height=region.height;
      const calls=[]; let inflight=0,maxInflight=0;
      window.__TAURI__={path:{tempDir:async()=>'/tmp/'},fs:{writeFile:async()=>{}},core:{invoke:async(name,args)=>{
        if(name!=='render_pdf_page_region')return null;
        calls.push(args); maxInflight=Math.max(maxInflight,++inflight);
        try {
          const c=document.createElement('canvas');c.width=Math.ceil(args.regionWPt*args.scale);c.height=Math.ceil(args.regionHPt*args.scale);
          const ctx=c.getContext('2d');
          await source.render({canvasContext:ctx,viewport:source.getViewport({scale:args.scale}),
            transform:[1,0,0,1,-args.regionXPt*args.scale,-args.regionYPt*args.scale],background:'rgba(0,0,0,0)'}).promise;
          const data=new Uint8Array(8+c.width*c.height*4);const v=new DataView(data.buffer);
          v.setUint32(0,c.width,true);v.setUint32(4,c.height,true);data.set(ctx.getImageData(0,0,c.width,c.height).data,8);return data;
        } finally {inflight--;}
      }}};
      previews.bijNieuweTegel(null);
      const c=document.createElement('canvas'); c.width=800;c.height=600;
      const ctx=c.getContext('2d');
      const results=[];
      for (const [zoom,angle,pan] of [[32,0,0],[64,0,5],[32,37,0],[1,0,0]]) {
        ann.rotation=angle;
        window.__pdfViewport={active:true,zoom};
        // Keep the source centre on screen, with an extra pan to a new tile.
        const cx=ann.x+ann.width/2,cy=ann.y+ann.height/2;
        const matrix=new DOMMatrix().translate(400-pan*zoom,300).scale(zoom).translate(-cx,-cy);
        const paint=()=>{ctx.resetTransform();ctx.clearRect(0,0,c.width,c.height);ctx.setTransform(matrix);drawAnnotation(ctx,ann);};
        paint(); await previews.wachtOpKnipselPreviews([ann],zoom);
        for(let i=0;i<40;i++) {
          const count=calls.length;paint(); await previews.wachtOpKnipselPreviews([ann],zoom);
          if(calls.length===count && !inflight)break;
          if(i===39)throw new Error('preview never settles');
        }
        paint();
        // Independent direct vector render into the visible canvas.
        const refScale=zoom===1 ? window.devicePixelRatio : 1;
        const ref=document.createElement('canvas');ref.width=c.width*refScale;ref.height=c.height*refScale;
        const transform=new DOMMatrix().scale(refScale).multiply(matrix).translate(cx,cy).rotate(angle).translate(-cx,-cy)
          .translate(ann.x,ann.y).translate(-region.x,-region.y);
        await source.render({canvasContext:ref.getContext('2d'),viewport:source.getViewport({scale:1}),
          transform:[transform.a,transform.b,transform.c,transform.d,transform.e,transform.f],background:'rgba(0,0,0,0)'}).promise;
        const down=document.createElement('canvas');down.width=c.width;down.height=c.height;
        const dc=down.getContext('2d');dc.imageSmoothingQuality='high';dc.drawImage(ref,0,0,c.width,c.height);
        const a=ctx.getImageData(0,0,c.width,c.height).data,b=dc.getImageData(0,0,c.width,c.height).data;
        // Compare opacity-weighted coverage; no double alpha from overview underneath.
        let error=0,ink=0,peak=0;
        for(let j=3;j<a.length;j+=4) {error+=Math.abs(a[j]-b[j]*ann.opacity);ink+=b[j]*ann.opacity;peak=Math.max(peak,a[j]);}
        results.push({zoom,angle,pan,relativeError:error/Math.max(1,ink),peak});
      }
      const details=calls.filter(a=>a.scale>16);
      delete window.__TAURI__;delete window.__pdfViewport;
      previews.leegmaken();await task.destroy();
      return {rotation,results,details:details.length,maxSide:Math.max(...details.map(a=>Math.ceil(Math.max(a.regionWPt,a.regionHPt)*a.scale))),maxInflight};
    }, {bytes:Array.from(await pdf.save()),rotation});
    console.log(JSON.stringify(result));
    assert.ok(result.details>0,'high zoom must render details above the old 16x ceiling');
    assert.ok(result.maxSide<=515,'detail allocation stays bounded');
    assert.ok(result.maxInflight<=4,'at most four native requests in flight');
    for(const r of result.results) {
      // Arbitrary-angle bitmap resampling differs from direct vector AA;
      // at 1x, rounding a half-opacity subpixel line may differ by one alpha unit.
      assert.ok(r.relativeError < (r.angle ? 0.15 : r.zoom===1 ? 0.02 : 0.01), `rotation ${rotation}: ${JSON.stringify(r)}`);
      assert.ok(r.peak<=128,'transparency is not painted twice');
    }
  }
  console.log('PASS: high zoom, pan, arbitrary annotation rotation, four source rotations, CropBox, opacity and bounded requests');
} finally { if(browser)await browser.close();await server.close();await rm(cache,{recursive:true,force:true}); }
