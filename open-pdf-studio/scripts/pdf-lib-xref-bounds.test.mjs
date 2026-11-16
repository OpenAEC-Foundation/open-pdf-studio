import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pdfLibXRefBounds, pdfLibXRefEsbuild, patchXRefBounds } from './pdf-lib-xref-bounds.mjs';
import { pdfLibInternEsbuild } from './pdf-lib-intern-pools.mjs';

export function fixture(w = '[1 1 1]', { data = [], index = '/Index [0 1]', size = '4', filter = '' } = {}) {
  let s = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n';
  const offset = s.length;
  s += `3 0 obj\n<< /Type /XRef /Root 1 0 R /Size ${size} ${index} ${filter} /W ${w} /Length ${data.length} >>\nstream\n`;
  return Uint8Array.from(Buffer.concat([Buffer.from(s), Buffer.from(data),
    Buffer.from(`\nendstream\nendobj\nstartxref\n${offset}\n%%EOF\n`)]));
}
const app = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'opds-xref-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
async function bundle(name, plugins) {
  const outfile = join(dir, `${name}.mjs`);
  await build({ stdin: { contents: `export * from 'pdf-lib';
    export { default as ByteStream } from 'pdf-lib/es/core/parser/ByteStream';
    export { default as XRefParser } from 'pdf-lib/es/core/parser/PDFXRefStreamParser';`, resolveDir: app },
    bundle: true, format: 'esm', platform: 'browser', outfile, plugins, logLevel: 'silent' });
  return import(pathToFileURL(outfile));
}
async function countReads(lib, fn) {
  let reads = 0;
  const original = lib.ByteStream.prototype.next;
  lib.ByteStream.prototype.next = function () { reads++; return original.call(this); };
  try { return { result: await fn(), reads }; }
  finally { lib.ByteStream.prototype.next = original; }
}

test('unpatched 1.17.1 reproduces successful fabricated entries and 300,000 EOF reads', async () => {
  const lib = await bundle('baseline', []);
  const { reads } = await countReads(lib, () => lib.PDFDocument.load(fixture('[100000 100000 100000]'), { parseSpeed: 5000 }));
  assert.ok(reads >= 300000);
});

for (const mode of ['optimizer', 'production']) {
  test(`${mode}: actual PDFDocument.load rejects malformed layouts with bounded reads; valid save/reopen survives`, async () => {
    const production = pdfLibXRefBounds();
    const plugin = mode === 'optimizer' ? pdfLibXRefEsbuild() : {
      name: 'production-transform', setup(b) {
        b.onLoad({ filter: /pdf-lib[\\/]es[\\/]core[\\/]parser[\\/](PDFParser|PDFXRefStreamParser)\.js$/ }, ({ path }) => ({
          contents: production.transform(readFileSync(path, 'utf8'), path).code, loader: 'js',
        }));
      },
    };
    const lib = await bundle(mode, [plugin, pdfLibInternEsbuild()]);
    const bad = [
      fixture(), fixture('[100000 100000 100000]'), fixture('[-1 1 1]'), fixture('[1.5 1 1]'),
      fixture('[1 1]'), fixture('[1 1 1 1]'), fixture('/Bad'), fixture('[/Bad 1 1]'),
      fixture('[9 0 0]'), fixture('[999999999999999999999999999999999999999999999999999999 0 0]'),
      fixture('[1 1 1]', { data: [1, 0] }),
      fixture('[1 1 1]', { data: deflateSync(Uint8Array.from([1, 0])), filter: '/Filter /FlateDecode' }),
      fixture('[1 1 1]', { data: [1, 0, 0], index: '/Index [0 2]' }),
      fixture('[0 0 0]', { index: '/Index [0 1000001]', size: '1000001' }),
      fixture('[8 8 8]', { index: '/Index [0 1000000]', size: '1000000' }),
      fixture('[0 0 0]', { index: '/Index [0]' }), fixture('[0 0 0]', { index: '/Index /Bad' }),
      fixture('[0 0 0]', { index: '/Index [-1 1]' }), fixture('[0 0 0]', { index: '/Index [0 0.5]' }),
      fixture('[0 0 0]', { index: '', size: '-1' }), fixture('[0 0 0]', { index: '/Index [3 2]' }),
      fixture('[0 8 0]', { data: [255, 255, 255, 255, 255, 255, 255, 255] }),
    ];
    for (const bytes of bad) {
      const before = bytes.slice();
      const { reads } = await countReads(lib, () => assert.rejects(lib.PDFDocument.load(bytes, { parseSpeed: 5000 }),
        { name: 'InvalidXRefStreamError' }));
      assert.ok(reads < 2000, `bounded reads: ${reads}`);
      assert.deepEqual(bytes, before);
    }
    for (const bytes of [fixture('[0 0 0]'), fixture('[0 1 0]', { data: [0] }),
      fixture('[1 1 1]', { data: [1, 0, 0] }), fixture('[0 8 0]', { data: [0, 0, 0, 0, 0, 0, 0, 1] }),
      fixture('[0 0 0]', { index: '', size: '4' }),
      fixture('[1 1 1]', { index: '/Index [0 1 3 1]', data: [0, 0, 0, 1, 0, 0] })]) {
      const doc = await lib.PDFDocument.load(bytes, { parseSpeed: 5000 });
      doc.addPage([100, 100]);
      const saved = await doc.save(); // Flate-compressed XRef and object streams.
      assert.equal((await lib.PDFDocument.load(saved)).getPageCount(), 1);
      assert.equal((await lib.PDFDocument.load(await doc.save({ useObjectStreams: false }))).getPageCount(), 1);
    }
    // Een realistische grote XRef blijft ruim binnen het expliciete werkbudget.
    const large = await lib.PDFDocument.create(); large.addPage([100, 100]);
    const refs = [];
    for (let i = 0; i < 10000; i++) refs.push(large.context.register(large.context.obj({ Value: i })));
    large.catalog.set(lib.PDFName.of('RegressionObjects'), large.context.obj(refs));
    const reopened = await lib.PDFDocument.load(await large.save(), { parseSpeed: 5000 });
    assert.equal(reopened.catalog.lookup(lib.PDFName.of('RegressionObjects')).size(), 10000);
    assert.equal((await lib.PDFDocument.load(await reopened.save())).getPageCount(), 1);
    // Nonfinite numeric objects cannot be written literally as PDF numbers.
    for (const w of [NaN, Infinity, -Infinity]) {
      const ctx = lib.PDFContext.create();
      const stream = ctx.stream(new Uint8Array(), { Type: 'XRef', Size: 4, Index: [0, 1], W: [w, 0, 0] });
      const { reads } = await countReads(lib, () => assert.throws(() => lib.XRefParser.forStream(stream).parseIntoContext()));
      assert.equal(reads, 0);
    }
    const ctx = lib.PDFContext.create();
    const parser = lib.XRefParser.forStream(ctx.stream(Uint8Array.from([0, 0, 0, 128, 0, 0, 0]), { Type: 'XRef', Size: 4, Index: [0, 1], W: [0, 7, 0] }));
    const entries = parser.parseIntoContext();
    assert.equal(entries[0].offset, 2147483648, 'no signed 32-bit truncation');
    assert.equal(entries[0].deleted, false, 'omitted type defaults to 1');
    assert.equal(entries[0].ref.generationNumber, 0);
  });
}
test('dependency drift fails closed and optimizer is registered', () => {
  const plugin = pdfLibXRefBounds();
  assert.equal(plugin.config().optimizeDeps.esbuildOptions.plugins[0].name, plugin.name);
  for (const name of ['PDFParser', 'PDFXRefStreamParser']) {
    const source = readFileSync(new URL(`../node_modules/pdf-lib/es/core/parser/${name}.js`, import.meta.url), 'utf8');
    assert.throws(() => patchXRefBounds(source + '\n', name), /Unqualified/);
  }
  assert.equal(plugin.transform('', '/other.js'), null);
});
