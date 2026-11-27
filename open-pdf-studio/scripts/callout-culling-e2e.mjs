import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const cacheDir = await mkdtemp(join(tmpdir(), 'opds-callout-cull-'));
const server = await createServer({cacheDir, server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
let browser;
try {
  await server.listen(); browser=await chromium.launch({headless:true});
  const page=await browser.newPage(); page.setDefaultNavigationTimeout(90000);
  if (process.env.BASELINE_BOUNDS) await page.route('**/js/annotations/spatial-index.js',async route=>{
    const response=await route.fetch();const body=await response.text();
    assert.ok(body.includes("type === 'callout' ? metCalloutLeider(basis, annotation) : basis"));
    await route.fulfill({response,body:body.replace("type === 'callout' ? metCalloutLeider(basis, annotation) : basis",'basis')});
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('[data-tab="drawing"]').waitFor({timeout:90000});
  const pdf=await PDFDocument.create();pdf.addPage([1200,800]);
  const results=await page.evaluate(async bytes=>{
    const {cacheWebFile}=await import('/js/core/platform.js');
    const {createTab}=await import('/js/ui/chrome/tabs.js');
    const {loadPDFIfNeeded}=await import('/js/pdf/loader.js');
    const {getActiveDocument}=await import('/js/core/state.ts');
    cacheWebFile('callout.pdf',new Uint8Array(bytes));const {index}=createTab('callout.pdf');await loadPDFIfNeeded('callout.pdf',index);
    const {renderAnnotationsForPage,drawAnnotation}=await import('/js/annotations/rendering.js');
    const doc=getActiveDocument();doc.viewMode='continuous';
    if(window.__pdfViewport) window.__pdfViewport.active=false;
    const a={id:'visible-leader',type:'callout',page:1,x:900,y:300,width:150,height:50,
      arrowX:100,arrowY:100,kneeX:500,kneeY:100,armOriginX:900,armOriginY:325,
      lineWidth:2,strokeColor:'#ff0000',fillColor:'none',text:'Callout',fontSize:12,opacity:1};
    const count=c=>{const d=c.getContext('2d').getImageData(0,0,256,256).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>180&&d[i+1]<80&&d[i+2]<80&&d[i+3]>100)n++;return n;};
    const out=[];
    for(const rotation of [0,90]) for(const scale of [1,4,16]) {
      doc.scale=scale;doc.annotations=[{...a,rotation}];
      const offset={x:200-128/scale,y:100-128/scale};
      const actual=document.createElement('canvas');actual.width=actual.height=256;
      renderAnnotationsForPage(actual.getContext('2d'),1,256,256,1,offset,{w:1200,h:800},{watermerken:false,tekstbewerkingen:false,inactief:true});
      const expected=document.createElement('canvas');expected.width=expected.height=256;
      const ctx=expected.getContext('2d');ctx.scale(scale,scale);ctx.translate(-offset.x,-offset.y);drawAnnotation(ctx,doc.annotations[0]);
      out.push({rotation,scale,actual:count(actual),expected:count(expected)});
    }
    return out;
  },[...await pdf.save()]);
  for(const r of results){assert.ok(r.expected>100,JSON.stringify(r));assert.equal(r.actual,r.expected,JSON.stringify(r));console.log('PASS callout leader pixels',JSON.stringify(r));}
} finally {await browser?.close();await server.close();await rm(cacheDir,{recursive:true,force:true});}
