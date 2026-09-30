// Requires a running Vite app at OPDS_TEST_URL (default port 3087).
// The snippet raster backend is mocked; PDF.js worker, text, forms and canvas are real.
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const {chromium}=req('playwright');const {PDFDocument,rgb}=req('pdf-lib');
(async()=>{
 const source=await PDFDocument.create();const p=source.addPage([300,300]);p.drawText('PDF.js 6 smoke',{x:15,y:260,size:15});const f=source.getForm().createTextField('Customer');f.setText('Ada');f.addToPage(p,{x:20,y:190,width:150,height:30});
 const bytes=[...await source.save()];
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.OPDS_TEST_URL || 'http://127.0.0.1:3087/');await page.waitForTimeout(1000);
 const result=await page.evaluate(async(bytes)=>{
  const lib=await import('/node_modules/pdfjs-dist/build/pdf.mjs');lib.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const task=lib.getDocument({data:new Uint8Array(bytes),standardFontDataUrl:'/pdfjs/web/standard_fonts/',wasmUrl:'/pdfjs/web/wasm/'});const pdf=await task.promise;const p=await pdf.getPage(1);const vp=p.getViewport({scale:1});
  const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  const text=document.createElement('div');document.body.append(text);await new lib.TextLayer({textContentSource:await p.getTextContent(),container:text,viewport:vp}).render();
  const state=await import('/js/core/state.ts');const {createTab}=await import('/js/ui/chrome/tabs.js');createTab();const doc=state.getActiveDocument();doc.pdfDoc=pdf;doc.scale=1;
  const container=document.createElement('div');document.body.append(container);
  const form=await import('/js/pdf/form-layer.js');await form.createFormLayer(p,vp,container,1);
  const input=container.querySelector('input');if(!input||input.value!=='Ada')throw new Error('Form missing');
  const store=await import('/js/annotations/vector-snippet-store.js');const key=store.bewaar(new Uint8Array(bytes));
  doc.annotations.push({id:'qa-snippet',type:'vectorSnippet',page:1,x:10,y:10,width:100,height:100,srcBox:{left:0,bottom:0,right:300,top:300},snippetKey:key});
  let rasterCalls=0;
  window.__TAURI__={path:{tempDir:async()=>'/tmp/'},fs:{writeFile:async()=>{}},core:{invoke:async(name,args)=>{
   if(name!=='render_pdf_page_region')return null;rasterCalls++;
   const w=Math.ceil(args.regionWPt*args.scale),h=Math.ceil(args.regionHPt*args.scale);const a=new Uint8Array(8+w*h*4);const v=new DataView(a.buffer);v.setUint32(0,w,true);v.setUint32(4,h,true);for(let i=8;i<a.length;i+=4){a[i]=255;a[i+3]=255}return a;
  }}};
  const {renderMarkeringenOffscreen}=await import('/js/pdf/exporter.js');
  const out=await renderMarkeringenOffscreen(1,1,vp);const pixel=[...out.getContext('2d').getImageData(50,50,1,1).data];
  delete window.__TAURI__;await task.destroy();
  return {version:lib.version,form:input.value,text:text.textContent,rasterCalls,pixel};
 },bytes);
 console.log(JSON.stringify({result,errors}));
 const relevantErrors = errors.filter(e => !e.startsWith('WebSocket closed without opened'));
 if (relevantErrors.length) throw new Error(relevantErrors.join('\n'));
 if(result.pixel.join(',')!=='255,0,0,255')throw new Error('Snippet output placeholder or blank');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
