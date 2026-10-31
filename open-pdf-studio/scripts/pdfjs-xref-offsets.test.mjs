import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { patchXrefStreamOffsets } from './pdfjs-xref-offsets.mjs';
import { patchPdfjsWorker, pdfjsPostscriptProgress } from './pdfjs-postscript-progress.mjs';
import { xrefOffsetFixture, HUGE_OFFSETS } from './xref-offset-fixture.mjs';
const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
// The separate web unit (vite.web-unit.config.js) ships the modern build.
const modern = readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8');
const builds = [['legacy', source], ['modern', modern]];
const SHIFT = 'offset = offset << 8 | offsetByte;';
const ARITHMETIC = 'offset = offset * 256 + offsetByte;';

const temp = mkdtempSync(join(tmpdir(), 'opds-xref-test-'));
test.after(() => rmSync(temp, { recursive: true, force: true }));

// The real XRef class exactly as the worker ships it: the bundle is one ES
// module whose top-level classes we re-export from a temporary copy.
let copies = 0;
async function workerModule(workerSource) {
  const file = join(temp, `pdf.worker.${copies++}.mjs`);
  writeFileSync(file, `${workerSource}\nexport { XRef, Stream, StringStream };\n`);
  return import(pathToFileURL(file).href);
}
function decode({ XRef, Stream }, { bytes, startXRef }) {
  const xref = new XRef(new Stream(bytes), {});
  xref.setStartXRef(startXRef);
  xref.readXRef();
  return xref;
}

for (const [build, source] of builds) test(`${build} build: backport matches once, is idempotent and rejects dependency drift`, () => {
  const fixed = patchXrefStreamOffsets(source);
  assert.notEqual(fixed, source);
  assert.ok(fixed.includes(ARITHMETIC));
  assert.ok(!fixed.includes(SHIFT), 'no signed 32-bit offset decoding left');
  assert.equal(fixed.split('offset = offset * 256').length, 2, 'exactly one site patched');
  assert.equal(patchXrefStreamOffsets(fixed), fixed);
  assert.throws(() => patchXrefStreamOffsets(source.replace(SHIFT, 'offset = (offset << 8) | offsetByte;')), /no longer matches/);
  assert.throws(() => patchXrefStreamOffsets(source + source), /no longer matches/);
});

for (const [build, source] of builds) test(`${build} build: the shipped worker gets both backports; neither undoes the other`, () => {
  const both = patchPdfjsWorker(source);
  assert.ok(both.includes(ARITHMETIC) && !both.includes(SHIFT));
  assert.ok(both.includes('return new Token(TOKEN.number, Number.isFinite(number) ? number : 0);'));
  assert.equal(patchPdfjsWorker(both), both);
});

test('plugin serves the patched worker and refuses an unqualified PDF.js version', () => {
  const plugin = pdfjsPostscriptProgress();
  plugin.configResolved({ command: 'serve', root: fileURLToPath(new URL('..', import.meta.url)), base: '/' });
  let served;
  plugin.configureServer({ middlewares: { use: fn => fn({ url: '/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs?v=1' },
    { setHeader() {}, end: body => { served = body; } }, () => assert.fail('worker route not handled')) } });
  assert.ok(served.includes(ARITHMETIC) && !served.includes(SHIFT));
  assert.equal(served, patchPdfjsWorker(source));

  const webUnit = pdfjsPostscriptProgress({ workerPath: 'build/pdf.worker.mjs' });
  webUnit.configResolved({ command: 'serve', root: fileURLToPath(new URL('../web-unit', import.meta.url)), base: '/' });
  webUnit.configureServer({ middlewares: { use: fn => fn({ url: '/node_modules/pdfjs-dist/build/pdf.worker.mjs' },
    { setHeader() {}, end: body => { served = body; } }, () => assert.fail('web-unit worker route not handled')) } });
  assert.equal(served, patchPdfjsWorker(modern));

  const root = join(temp, 'drift');
  mkdirSync(join(root, 'node_modules/pdfjs-dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'node_modules/pdfjs-dist/package.json'), '{"version":"6.5.0"}');
  assert.throws(() => pdfjsPostscriptProgress().configResolved({ command: 'build', root, base: '/' }), /Qualify PDF\.js 6\.5\.0.*#638/);
});

// Upstream's own regression case (PDF.js #22172, test/unit/document_spec.js).
const UPSTREAM = '%PDF-1.5\n3 0 obj\n<</Type/XRef/W[1 5 2]/Index[0 3]/Size 4/Root 1 0 R/Length 24>>\nstream\n'
  + '\x00\x00\x00\x00\x00\x00\xff\xff' // free
  + '\x01\x00\x80\x00\x00\x00\x00\x00' // 2^31
  + '\x01\x01\x00\x00\x00\x0a\x00\x00' // 2^32 + 10
  + '\nendstream\nendobj\nstartxref\n9\n%%EOF\n';

test('unpatched real XRef reader corrupts offsets of 2^31 and 2^32 + 10', async () => {
  const worker = await workerModule(source);
  const xref = new worker.XRef(new worker.StringStream(UPSTREAM), {});
  xref.setStartXRef(9);
  xref.readXRef();
  assert.equal(xref.getEntry(1).offset, -(2 ** 31));
  assert.equal(xref.getEntry(2).offset, 10);
});

for (const [build, source] of builds) test(`${build} build: patched real XRef reader decodes 2^31 and 2^32 + 10 exactly`, async () => {
  const worker = await workerModule(patchPdfjsWorker(source));
  const xref = new worker.XRef(new worker.StringStream(UPSTREAM), {});
  xref.setStartXRef(9);
  xref.readXRef();
  assert.equal(xref.getEntry(1).offset, 2 ** 31);
  assert.equal(xref.getEntry(2).offset, 2 ** 32 + 10);

  for (const width of [5, 6, 7, 8]) {
    // Plus the largest offset the field (or a safe JS integer) can hold.
    const huge = [...HUGE_OFFSETS, Math.min(2 ** (8 * width) - 1, Number.MAX_SAFE_INTEGER)];
    const fixture = xrefOffsetFixture(width, huge);
    const decoded = decode(worker, fixture);
    fixture.hugeObjects.forEach((num, i) => {
      const { offset, gen, uncompressed } = decoded.getEntry(num);
      assert.ok(offset > 0, `W offset ${width}: object ${num} positive`);
      assert.equal(offset, huge[i], `W offset ${width}: object ${num} exact`);
      assert.equal(gen, 0);
      assert.equal(uncompressed, true);
    });
    assert.ok(decoded.getEntry(1).offset < fixture.startXRef, 'ordinary offsets unchanged');
  }
});

test('patched real worker still opens an XRef-stream PDF with 8-byte offsets', async () => {
  const file = join(temp, 'pdf.worker.api.mjs');
  writeFileSync(file, patchPdfjsWorker(source));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(file).href;
  // In node the worker runs in this thread, so its warnings land here: a
  // broken XRef stream would be hidden by the "Indexing all PDF objects" fallback.
  const warnings = [];
  const log = console.log;
  console.log = (...args) => { warnings.push(args.join(' ')); };
  const task = pdfjs.getDocument({ data: xrefOffsetFixture(8).bytes, useSystemFonts: false });
  try {
    const doc = await task.promise;
    assert.equal(doc.numPages, 1);
    const page = await doc.getPage(1);
    assert.deepEqual(page.view, [0, 0, 100, 100]);
  } finally { console.log = log; await task.destroy(); }
  assert.deepEqual(warnings.filter(w => /Indexing|XRef/i.test(w)), []);
});
