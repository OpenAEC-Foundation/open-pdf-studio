import test from 'node:test';
import * as mupdf from 'mupdf';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pdfLibXRefBounds, pdfLibXRefEsbuild } from './pdf-lib-xref-bounds.mjs';
import { pdfLibInternEsbuild } from './pdf-lib-intern-pools.mjs';
import { classicFixture, damageClassic } from './pdf-lib-classic-xref-fixture.mjs';
const app = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'opds-classic-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
async function bundle(name, plugins) {
  const outfile = join(dir, `${name}.mjs`);
  await build({ stdin: { contents: `export * from 'pdf-lib'; export { default as ByteStream } from 'pdf-lib/es/core/parser/ByteStream';`, resolveDir: app }, bundle: true, format: 'esm', platform: 'browser', outfile, plugins, logLevel: 'silent' });
  return import(pathToFileURL(outfile));
}
const raw = await classicFixture();
const damaged = damageClassic(raw);
const text = b => Buffer.from(b).toString('latin1');
const bytes = s => Uint8Array.from(Buffer.from(s, 'latin1'));
function render(input) {
  const doc = mupdf.Document.openDocument(input, 'application/pdf');
  const images = [];
  try {
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
      try { images.push(Uint8Array.from(pixmap.getPixels())); }
      finally { pixmap.destroy(); page.destroy(); }
    }
  } finally { doc.destroy(); }
  return images;
}
function preserved(lib, doc) {
  assert.equal(doc.getPageCount(), 2);
  assert.equal(doc.getPage(0).getWidth(), 300);
  const annotations = doc.getPage(0).node.Annots();
  assert.equal(annotations.size(), 1);
  assert.equal(doc.context.lookup(annotations.get(0)).get(lib.PDFName.of('Subtype')).toString(), '/Square');
  for (let i = 0; i < 2; i++) {
    const content = doc.context.lookup(doc.getPage(i).node.Contents().get(0));
    assert.match(Buffer.from(lib.decodePDFRawStream(content).decode()).toString(), /Tj/);
  }
}
test('baseline: readable non-empty PDF fails with blank classic generation', async () => {
  const lib = await bundle('baseline', [pdfLibInternEsbuild()]);
  preserved(lib, await lib.PDFDocument.load(raw));
  await assert.rejects(lib.PDFDocument.load(damaged, { parseSpeed: 5000 }), /Failed to parse number/);
});
for (const mode of ['optimizer', 'production']) {
  test(`${mode}: recover only complete classic entries, preserve objects, save and reopen`, async () => {
    const production = pdfLibXRefBounds();
    const plugin = mode === 'optimizer' ? pdfLibXRefEsbuild() : { name: 'production-transform', setup(b) {
      b.onLoad({ filter: /pdf-lib[\\/]es[\\/]core[\\/]parser[\\/](PDFParser|PDFXRefStreamParser)\.js$/ }, ({ path }) => ({ contents: production.transform(readFileSync(path, 'utf8'), path).code, loader: 'js' }));
    } };
    const lib = await bundle(mode, [plugin, pdfLibInternEsbuild()]);
    for (const input of [raw, damaged, damageClassic(raw, '00007'), damageClassic(damaged, '00007')]) {
      const before = input.slice();
      const doc = await lib.PDFDocument.load(input, { parseSpeed: 5000, updateMetadata: false });
      preserved(lib, doc);
      const baseline = await lib.PDFDocument.load(raw, { updateMetadata: false });
      assert.deepEqual(doc.context.enumerateIndirectObjects().map(([ref, obj]) => [ref.toString(), obj.toString()]), baseline.context.enumerateIndirectObjects().map(([ref, obj]) => [ref.toString(), obj.toString()]));
      for (const useObjectStreams of [false, true]) {
        const saved = await doc.save({ useObjectStreams });
        preserved(lib, await lib.PDFDocument.load(saved));
        assert.deepEqual(render(saved), render(raw), 'MuPDF preserves all page and annotation pixels');
      }
      assert.deepEqual(input, before);
    }
    const tableStart = text(damaged).lastIndexOf('\nxref\n');
    const missingBody = text(damaged).replace(/\d+ 0 obj/, m => m.replace('obj', 'xxx'));
    const bad = [
      bytes(text(damaged).replace(/(\d{10})       n/, '9999999999       n')),
      bytes(text(damaged).replace(/(\d{10})       n/, '$1       f')),
      bytes(text(damaged).replace(/(\d{10})       n/, '$1\n      n')),
      bytes(text(damaged).replace(/(\d{10})       n/, '$1       z')),
      bytes(missingBody),
      bytes(text(damaged).slice(0, text(damaged).indexOf('trailer', tableStart))),
      bytes(text(damaged).replace(/\n\d{10} 00007 n ?\n/, '\n')),
      bytes(text(damaged).slice(0, text(damaged).indexOf('       n', tableStart) + 5)),
    ];
    for (const input of bad) {
      const before = input.slice();
      let reads = 0;
      const next = lib.ByteStream.prototype.next;
      lib.ByteStream.prototype.next = function () { reads++; return next.call(this); };
      try { await assert.rejects(lib.PDFDocument.load(input, { parseSpeed: 5000 }), undefined, 'reject incomplete or ambiguous recovery'); }
      finally { lib.ByteStream.prototype.next = next; }
      assert.ok(reads < input.length * 4, `bounded reads: ${reads}`);
      assert.deepEqual(input, before);
    }
  });
}
