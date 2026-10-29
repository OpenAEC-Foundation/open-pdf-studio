import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { writeWatermarkContent, readWatermarkDefinitions, watermarkIds, removeWatermarkStreams } from '../pdf/saver/watermark-content.js';
import { schrijfKopVoeten, zonderKopVoetStromen } from '../pdf/saver/kopvoet.js';
import { watermarkBaseline, watermarkPosition } from './watermark-layout.js';
const mark = extra => ({ id:'wm1',type:'textWatermark',text:'TEST',fontFamily:'Helvetica',fontSize:40,enabled:true,position:'center',layer:'infront',pageRange:'all',...extra });
const range = () => [2];
async function pdf(rotation=0) { const p=await PDFDocument.create();p.addPage([700,900]).setCropBox(50,60,600,800);p.getPage(0).setRotation(degrees(rotation));return p; }
async function text(bytes) {
  const {getDocument,Util}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const p=await getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true}).promise;
  try {const page=await p.getPage(1),v=page.getViewport({scale:1});return (await page.getTextContent()).items.filter(i=>i.str.trim()).map(i=>({text:i.str,width:i.width,m:Util.transform(v.transform,i.transform)}));}finally {await p.loadingTask.destroy();}
}
for(const rotation of [0,90,180,270]) for(const angle of [0,45,-90]) {
  test(`text stays centered on nonzero CropBox, page rotation ${rotation}, watermark angle ${angle}`,async()=>{
    const p=await pdf(rotation),w=mark({rotation:angle});await writeWatermarkContent(p,[w]);
    const [item]=await text(await p.save());assert.equal(item.text,'TEST');
    const a=angle*Math.PI/180,b=watermarkBaseline(w.fontFamily,w.fontSize);
    // Recover the center from the text baseline in display coordinates.
    const x=item.m[4]+Math.cos(a)*item.width/2+Math.sin(a)*b;
    const y=item.m[5]+Math.sin(a)*item.width/2-Math.cos(a)*b;
    assert.ok(Math.abs(x-(rotation%180?400:300))<0.1,`center x ${x}`);
    assert.ok(Math.abs(y-(rotation%180?300:400))<0.1,`center y ${y}`);
    assert.ok(Math.abs(Math.atan2(item.m[1],item.m[0])-a)<1e-8);
  });
}
test('saving/reopening twice replaces content; edit, disable and delete do not leave ghosts',async()=>{
  let p=await pdf();const w=mark();
  for(let i=0;i<2;i++) {await writeWatermarkContent(p,[w]);const bytes=await p.save();assert.equal((await text(bytes)).length,1);p=await PDFDocument.load(bytes);assert.deepEqual(readWatermarkDefinitions(p),[w]);}
  await writeWatermarkContent(p,[mark({text:'EDIT'})]);assert.deepEqual((await text(await p.save())).map(i=>i.text),['EDIT']);
  await writeWatermarkContent(p,[mark({enabled:false})]);assert.equal((await text(await p.save())).length,0);assert.equal(readWatermarkDefinitions(p)[0].enabled,false);
  await writeWatermarkContent(p,[],{known:['wm1']});assert.equal(readWatermarkDefinitions(p).length,0);assert.equal(watermarkIds(p).size,0);
});
test('unread watermark definitions and original page content survive an unrelated save',async()=>{
  const p=await pdf();p.getPage(0).drawText('ORIGINAL',{x:100,y:200});await writeWatermarkContent(p,[mark()]);
  const loaded=await PDFDocument.load(await p.save());await writeWatermarkContent(loaded,[]);
  assert.deepEqual((await text(await loaded.save())).map(i=>i.text),['ORIGINAL','TEST']);assert.equal(readWatermarkDefinitions(loaded).length,1);
});
test('preserves existing ordering: PDF content, behind watermarks, then front watermarks',async()=>{
  const p=await pdf();p.getPage(0).drawText('ORIGINAL',{x:100,y:200});
  const ws=[mark({id:'a',text:'BACK1',layer:'behind'}),mark({id:'b',text:'BACK2',layer:'behind'}),mark({id:'c',text:'FRONT'})];
  await writeWatermarkContent(p,ws);assert.deepEqual((await text(await p.save())).map(i=>i.text),['ORIGINAL','BACK1','BACK2','FRONT']);
});
test('zero custom coordinates are real positions',async()=>{
  assert.deepEqual(watermarkPosition(mark({position:'custom',customX:0,customY:0}),600,800),{x:0,y:0});
});
test('image keeps centered rotation and scale in its independent stream and roundtrips definition',async()=>{
  const p=await pdf(90);const w=mark({type:'imageWatermark',width:80,height:40,scale:2,rotation:30,imageData:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='});
  await writeWatermarkContent(p,[w]);const loaded=await PDFDocument.load(await p.save());assert.equal(watermarkIds(loaded).size,1);assert.deepEqual(readWatermarkDefinitions(loaded),[w]);
  await writeWatermarkContent(loaded,[w]);const refs=loaded.getPage(0).node.Contents();assert.equal(refs.asArray().filter(r=>loaded.context.lookup(r).dict.has(PDFName.of('OPS_Watermark'))).length,1);
  assert.equal(removeWatermarkStreams(loaded),1);assert.equal(watermarkIds(loaded).size,0);
});
test('display working copy strips ordinary and header/footer streams together',async()=>{
  const p=await pdf();p.getPage(0).drawText('ORIGINAL',{x:100,y:200});await writeWatermarkContent(p,[mark()]);
  await schrijfKopVoeten(p,[{id:'header',type:'headerFooter',enabled:true,headerCenter:'HEADER'}],{paginaBereik:range});
  const bytes=await zonderKopVoetStromen(await p.save());assert.deepEqual((await text(bytes)).map(i=>i.text),['ORIGINAL']);
  assert.equal(readWatermarkDefinitions(await PDFDocument.load(bytes)).length,1);
});
test('first/custom ranges and cancellation checkpoint remain effective',async()=>{
  const p=await pdf();p.addPage([600,800]);
  await writeWatermarkContent(p,[mark({pageRange:'custom',customPages:'2'})],{pageRange:range});
  assert.equal((await text(await p.save())).length,0);
  await assert.rejects(writeWatermarkContent(p,[mark()],{annulering:{punt(){throw Error('cancelled');}}}),/cancelled/);
});

let canvasModule;
try { canvasModule = await import('@napi-rs/canvas'); } catch { canvasModule = null; }
for (const pageRotation of [0, 90]) {
  test(`image pixels keep center, size and orientation after save on page rotation ${pageRotation}`,
    { skip: canvasModule ? false : '@napi-rs/canvas unavailable' }, async () => {
      const source = canvasModule.createCanvas(80, 40), ctx = source.getContext('2d');
      ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 40, 40);
      ctx.fillStyle = '#0000ff'; ctx.fillRect(40, 0, 40, 40);
      const p = await pdf(pageRotation);
      await writeWatermarkContent(p, [mark({ type: 'imageWatermark', width: 80, height: 40, scale: 2,
        rotation: 30, opacity: 1, imageData: source.toDataURL('image/png') })]);
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loaded = await getDocument({ data: new Uint8Array(await p.save()), isEvalSupported: false }).promise;
      try {
        const page = await loaded.getPage(1), viewport = page.getViewport({ scale: 1 });
        const canvas = canvasModule.createCanvas(viewport.width, viewport.height), context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0, xsum = 0, ysum = 0;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (pixels[i] > 200 && pixels[i + 1] < 40 && pixels[i + 2] < 40) { n++; xsum += x + 0.5; ysum += y + 0.5; }
        }
        assert.ok(Math.abs(n - 6400) < 250, `red half area ${n}`);
        assert.ok(Math.abs(xsum / n - (viewport.width / 2 - 40 * Math.cos(Math.PI / 6))) < 1);
        assert.ok(Math.abs(ysum / n - (viewport.height / 2 - 20)) < 1);
      } finally { await loaded.loadingTask.destroy(); }
    });
}
