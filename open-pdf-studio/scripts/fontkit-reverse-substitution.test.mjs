import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import original from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFDict, decodePDFRawStream } from 'pdf-lib';
import { patchFontkitReverse } from './fontkit-reverse-substitution.mjs';
import { metTrueTypeUitlijning } from '../js/pdf/saver/ttf-subset-padding.js';

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('@pdf-lib/fontkit'), 'utf8');
const bytes = readFileSync(new URL('./font-native-tests/fixtures/reverse-substitution.ttf', import.meta.url));
const context = { exports: {}, module: { exports: {} }, require, Buffer, setTimeout, clearTimeout, console, process };
vm.runInNewContext(patchFontkitReverse(source, 'umd'), context);
const kit = context.module.exports;
const ids = (text, features = {}) => Array.from(kit.create(bytes).layout(text, features).glyphs, g => g.id);

test('original fontkit reproduces Not a fixed size with a valid GSUB 8 table', () => {
  assert.throws(() => original.create(bytes).layout('ABCD'), /Not a fixed size/);
});
test('reverse substitution respects nearest-first backtrack, lookahead and boundaries', () => {
  assert.deepEqual(ids('ABCD'), [2,3,6,5]);
  for (const text of ['BACD','ABCA','ABC','BCD']) {
    assert.deepEqual(ids(text), Array.from(text, c => original.create(bytes).glyphForCodePoint(c.codePointAt(0)).id));
  }
  assert.deepEqual(ids('ABCD',{calt:false}), [2,3,4,5]);
});
test('reverse processing observes substituted lookahead, including extension lookups', () => {
  for (const feature of ['ss01','ss04']) {
    assert.deepEqual(ids('AAA',{calt:false,[feature]:true}), [2,3,2]);
    assert.deepEqual(ids('',{[feature]:true}), []);
  }
});
test('empty contexts, ignored marks and ordinary substitutions remain valid', () => {
  assert.deepEqual(ids('AA',{ss02:true}),[6,6]);
  assert.deepEqual(ids('AB\u0301C',{ss03:true}),[2,6,7,4]);
  assert.deepEqual(ids('D',{ss05:true}),[4]);
});
test('PDF save/reopen retains substituted glyph outlines and text mapping', async () => {
  const pdf=await PDFDocument.create();pdf.registerFontkit(metTrueTypeUitlijning(kit));
  const f=await pdf.embedFont(bytes,{subset:true});
  const encoded=f.encodeText('ABCD').asString();
  pdf.addPage().drawText('ABCD',{font:f});
  const reopened=await PDFDocument.load(await pdf.save());
  const dict=reopened.context.lookup(f.ref,PDFDict);
  const cidfont=dict.lookup(PDFName.of('DescendantFonts')).lookup(0,PDFDict);
  const stream=cidfont.lookup(PDFName.of('FontDescriptor'),PDFDict).lookup(PDFName.of('FontFile2'));
  const embedded=original.create(decodePDFRawStream(stream).decode());
  const originalFont=original.create(bytes);
  for (const [i,gid] of [2,3,6,5].entries()) {
    const cid=parseInt(encoded.slice(i*4,i*4+4),16);
    assert.deepEqual(embedded.getGlyph(cid).path.commands,originalFont.getGlyph(gid).path.commands);
  }
  const cmap=Buffer.from(decodePDFRawStream(dict.lookup(PDFName.of('ToUnicode'))).decode()).toString();
  for (const code of ['0041','0042','0043','0044']) assert.ok(cmap.includes(code));
});
test('dependency changes fail closed before an unqualified patch is shipped', () => {
  assert.throws(()=>patchFontkitReverse(source+'\n','umd'),/Unqualified fontkit/);
});
