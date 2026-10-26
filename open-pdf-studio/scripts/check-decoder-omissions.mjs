// Qualification of a real malformed PDF. Successful pixels are not a fidelity certificate.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const bytes=new Uint8Array(await readFile(new URL('./fixtures/decoder-omissions/unsupported-xobject.pdf',import.meta.url)));
const results=[];
for(const stopAtErrors of [false,true]) {
 const task=pdfjs.getDocument({data:bytes.slice(),stopAtErrors,verbosity:0});
 try {
  const doc=await task.promise;const page=await doc.getPage(1);
  const target=doc.canvasFactory.create(100,100);
  try {
   await page.render({canvasContext:target.context,viewport:page.getViewport({scale:1})}).promise;
   results.push({stopAtErrors,status:'resolved',knownRectanglePixel:[...target.context.getImageData(10,90,1,1).data]});
  } finally {doc.canvasFactory.destroy(target);}
 } finally {await task.destroy();}
}
// Pin this qualification to the actual installed renderer; changes require re-inspection.
assert.equal(pdfjs.version,'6.4.299');
assert.deepEqual(results[0].knownRectanglePixel,[0,0,0,255]);
assert.deepEqual(results[1].knownRectanglePixel,[255,255,255,255]);
console.log(JSON.stringify({version:pdfjs.version,sha256:createHash('sha256').update(bytes).digest('hex'),results},null,2));
