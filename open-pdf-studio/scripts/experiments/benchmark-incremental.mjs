import { PDFDocument } from 'pdf-lib';
import * as mupdf from 'mupdf';
import { appendNotePrototype } from './incremental-save.mjs';
const src = await PDFDocument.create();
for (let i=0;i<100;i++) src.addPage([595,842]).drawText(`Page ${i+1}: reproducible save evaluation`);
const input=await src.save();
const times={incremental:[],rewrite:[]};const sizes={};
for(let i=0;i<5;i++) for(const mode of Object.keys(times)) {
 const start=performance.now();let output;
 if(mode==='incremental') output=appendNotePrototype(input,{text:'Benchmark note'});
 else {
  const doc=mupdf.Document.openDocument(input,'application/pdf');const page=doc.loadPage(0);const note=page.createAnnotation('Text');let buf;
  try { note.setRect([20,20,40,40]);note.setContents('Benchmark note');note.update();buf=doc.saveToBuffer();output=buf.asUint8Array().slice(); }
  finally { buf?.destroy();note.destroy();page.destroy();doc.destroy(); }
 }
 times[mode].push(performance.now()-start);sizes[mode]=output.length;
}
console.log(JSON.stringify({fixture:'100 synthetic text pages',inputBytes:input.length,outputBytes:sizes,medianMs:Object.fromEntries(Object.entries(times).map(([k,v])=>[k,v.sort((a,b)=>a-b)[2]])),combinedProcessMaxRssKiB:process.resourceUsage().maxRSS,limitation:'Incremental includes conservative input scan; rewrite is a backend reference, not the application save path.'},null,2));
