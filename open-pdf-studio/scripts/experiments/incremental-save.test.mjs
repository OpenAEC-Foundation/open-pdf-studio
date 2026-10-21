import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import * as mupdf from 'mupdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { appendNotePrototype } from './incremental-save.mjs';

async function fixture(streams = true) { const d = await PDFDocument.create(); d.addPage([200,200]); return d.save({useObjectStreams:streams}); }
for (const streams of [true,false]) test(`append/reopen/repeat preserves bytes (object streams=${streams})`, async () => {
  let input = await fixture(streams);
  for (const text of ['First note', 'Second note']) {
    const original = input.slice();
    const output = appendNotePrototype(input, {text});
    assert.deepEqual(input, original);
    assert.deepEqual(output.slice(0,input.length), input);
    const task = pdfjs.getDocument({data:output.slice(),verbosity:0});
    try { const d=await task.promise; const p=await d.getPage(1); assert.ok((await p.getAnnotations()).some(a=>a.contentsObj?.str===text)); } finally { await task.destroy(); }
    const d=await PDFDocument.load(output); assert.ok(d.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).size()>0);
    input=output;
  }
});
test('rejects unsupported operations and invalid geometry without changing input', async () => {
  const b=await fixture(); const copy=b.slice();
  for (const operation of ['redact','sanitize','delete','edit-text']) assert.throws(()=>appendNotePrototype(b,{text:'x',operation}),/UNSUPPORTED_OPERATION/);
  assert.throws(()=>appendNotePrototype(b,{text:'x',rect:[0,0,Infinity,20]}),/INVALID_RECT/);
  assert.throws(()=>appendNotePrototype(b,{text:'x',pageIndex:99}),/INVALID_PAGE/);
  assert.deepEqual(b,copy);
});
test('rejects signature dictionaries inside object streams', async () => {
  const d=await PDFDocument.create(); d.addPage();
  const sig=d.context.register(d.context.obj({FT:'Sig',Type:'Annot',Subtype:'Widget',Rect:[0,0,20,20]}));
  d.catalog.set(PDFName.of('AcroForm'),d.context.obj({Fields:[sig]}));
  const bytes=await d.save();
  assert.throws(()=>appendNotePrototype(bytes,{text:'x'}),/PROTECTED_INPUT/);
});

test('encrypted and malformed input are rejected; subsequent good input still works', async () => {
  const bytes = await fixture();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const encrypted = doc.saveToBuffer('encrypt=aes-256,user-password=test,owner-password=owner');
  try { assert.throws(() => appendNotePrototype(encrypted.asUint8Array(), {text:'x'}), /PROTECTED_INPUT/); }
  finally { encrypted.destroy(); doc.destroy(); }
  assert.throws(() => appendNotePrototype(new TextEncoder().encode('%PDF-1.7\ninvalid'), {text:'x'}));
  assert.ok(appendNotePrototype(bytes, {text:'retry'}).length > bytes.length);
});
