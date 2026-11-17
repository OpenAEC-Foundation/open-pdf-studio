// Real system-font embedding chain in Chromium; optimized and production bundles.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, build } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument, PDFDict, PDFName, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fontkitReverseSubstitution } from './fontkit-reverse-substitution.mjs';

const fixture = await readFile(new URL('./font-native-tests/fixtures/reverse-substitution.ttf', import.meta.url));
const cases = [{bytes:fixture,text:'ABCD',expected:[2,3,6,5]}];
if (process.env.OPDS_TEST_FONT_FACE) cases.push({bytes:await readFile(process.env.OPDS_TEST_FONT_FACE),text:'Iosevka SS03 123 ABC fi -> !='});
const cache=await mkdtemp(path.join(tmpdir(),'opds-reverse-font-'));
const entry=path.join(process.cwd(),'scripts',`.fontkit-reverse-probe-${process.pid}.js`);
let server,browser;
try {
  await writeFile(entry, `import { PDFDocument } from 'pdf-lib';
import { maakSysteemFontKeten } from '../js/pdf/saver/systeem-fonts.js';
globalThis.probe = async (input, text) => {
 const pdf=await PDFDocument.create();
 const chain=maakSysteemFontKeten(pdf,{zoek:async()=>({pad:'/test/font.ttf',exact:true,insluitbaar:true,subset:true}),laadBytes:async()=>new Uint8Array(input)});
 const f=await chain.voor('Reverse Fixture');
 if(!f) throw new Error('Embedding did not select requested font');
 const encoded=f.font.encodeText(text).asString();
 pdf.addPage([595,842]).drawText(text,{font:f.font,size:20});
 return {encoded,bytes:Array.from(await pdf.save())};
};`);
  const output=await build({configFile:false,root:process.cwd(),plugins:[fontkitReverseSubstitution(),{name:'native-platform-stub',enforce:'pre',load(id){if(id.endsWith('/js/core/platform.js'))return 'export const isTauri=()=>false; export const invoke=()=>{throw new Error("Unexpected native call")};';}}],logLevel:'warn',build:{write:false,minify:true,lib:{entry,name:'ReverseProbe',formats:['iife']},rollupOptions:{output:{inlineDynamicImports:true,manualChunks:undefined}}}});
  const production=(Array.isArray(output)?output[0]:output).output.find(x=>x.type==='chunk').code;
  server=await createServer({root:process.cwd(),cacheDir:cache,server:{host:'127.0.0.1',port:18324,strictPort:true,hmr:false}});
  await server.listen();browser=await chromium.launch({headless:true});
  for(const mode of ['optimizer','production']) {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/__reverse-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Font save regression</title>'}));
    await page.goto('http://127.0.0.1:18324/__reverse-probe');
    if(mode==='optimizer') await page.evaluate(async url=>{await import(url)},'/scripts/'+path.basename(entry));
    else await page.addScriptTag({content:production});
    for(const c of cases) {
      const result=await page.evaluate(async ({input,text})=>globalThis.probe(input,text),{input:Array.from(c.bytes),text:c.text});
      const pdf=await PDFDocument.load(new Uint8Array(result.bytes));
      const dict=pdf.context.enumerateIndirectObjects().map(([,o])=>o).find(o=>o instanceof PDFDict && o.has(PDFName.of('FontFile2')));
      assert.ok(dict,'requested TrueType font embedded');
      const embedded=fontkit.create(decodePDFRawStream(dict.lookup(PDFName.of('FontFile2'))).decode());
      assert.ok(embedded.numGlyphs>1);
      if(c.expected) for(const [i,gid] of c.expected.entries()) {
        const cid=parseInt(result.encoded.slice(i*4,i*4+4),16);
        assert.deepEqual(embedded.getGlyph(cid).path.commands,fontkit.create(c.bytes).getGlyph(gid).path.commands);
      }
      const text=await page.evaluate(async bytes=>{
        const lib=await import('/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
        lib.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';
        const task=lib.getDocument({data:new Uint8Array(bytes)});
        const doc=await task.promise;
        const page=await doc.getPage(1);const content=await page.getTextContent();
        await task.destroy();return content.items.map(x=>x.str).join('');
      },result.bytes);
      assert.equal(text,c.text);
    }
    assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${mode}: save/reopen, glyph outlines and extracted text (${cases.length} fonts)`);
  }
} finally {
  await browser?.close();await server?.close();await rm(entry,{force:true});await rm(cache,{recursive:true,force:true});
}
