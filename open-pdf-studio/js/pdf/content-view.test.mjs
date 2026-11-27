import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import { normalizeContentView, contentViewFilter, DEFAULT_CONTENT_VIEW } from './content-view.js';
import { readContentView, writeContentView } from './saver/content-view.js';
test('disabled master bypasses filters while retaining slider settings', () => {
 const value={enabled:false,grayscale:70,brightness:50,opacity:35};
 assert.equal(contentViewFilter(value),'none');
 assert.deepEqual(normalizeContentView(value),value);
 assert.equal(contentViewFilter({...value,enabled:true}),'grayscale(0.7) brightness(0.5) invert(1) brightness(0.35) invert(1)');
});
test('untrusted numeric settings are bounded and never become CSS', () => {
 assert.deepEqual(normalizeContentView({enabled:'true',grayscale:Infinity,brightness:'url(x)',opacity:NaN}),DEFAULT_CONTENT_VIEW);
 assert.deepEqual(normalizeContentView({enabled:true,grayscale:999,brightness:-50,opacity:-1}),{enabled:true,grayscale:100,brightness:25,opacity:0});
});
test('PDF catalog roundtrip preserves disabled settings and original page content', async () => {
 const pdf=await PDFDocument.create();pdf.addPage([200,300]).drawText('Original content');
 const before=pdf.getPage(0).node.Contents().toString();
 const value={enabled:false,grayscale:85,brightness:125,opacity:45};
 writeContentView(pdf,value);
 assert.equal(pdf.getPage(0).node.Contents().toString(),before);
 const again=await PDFDocument.load(await pdf.save());
 assert.deepEqual(readContentView(again),value);assert.deepEqual(again.getPage(0).getSize(),{width:200,height:300});
});
test('missing, malformed and future catalog values are ignored and untouched on save', async () => {
 const pdf=await PDFDocument.create();pdf.addPage();const key=PDFName.of('OPS_ContentView');
 assert.equal(readContentView(pdf),undefined);
 for(const text of ['{','null','[]',JSON.stringify({version:2,enabled:true}),'x'.repeat(2050)]) {
  const raw=PDFHexString.fromText(text);pdf.catalog.set(key,raw);
  assert.equal(readContentView(pdf),undefined);writeContentView(pdf,undefined);assert.equal(pdf.catalog.get(key),raw);
 }
});
