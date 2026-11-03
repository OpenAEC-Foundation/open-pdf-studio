import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { patchSampledFunctions } from './pdfjs-sampled-functions.mjs';
import { patchPdfjsWorker, pdfjsPostscriptProgress } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'opds-sampled-test-'));
test.after(() => rmSync(temp, { recursive: true, force: true }));
const signed = '(codeBuf >> codeSize) * sampleMul';
const unsigned = '(codeBuf >>> codeSize) * sampleMul';
for (const build of ['legacy/build', 'build']) {
  const workerPath = `${build}/pdf.worker.mjs`;
  const source = readFileSync(require.resolve(`pdfjs-dist/${workerPath}`), 'utf8');
  test(`${build}: sampled backport is narrow, idempotent and rejects drift or duplicate sites`, () => {
    const fixed = patchSampledFunctions(source);
    assert.equal(fixed, source.replace(signed, unsigned));
    assert.equal(patchSampledFunctions(fixed), fixed);
    for (const invalid of [source.replace(signed, '(codeBuf >> (codeSize)) * sampleMul'), source + source, source + fixed, fixed + fixed]) {
      assert.throws(() => patchSampledFunctions(invalid), /no longer matches.*#949/);
    }
    assert.ok(patchPdfjsWorker(source).includes(unsigned));
    assert.equal(patchPdfjsWorker(patchPdfjsWorker(source)), patchPdfjsWorker(source));
  });
  test(`${build}: actual decoder preserves unsigned 32-bit samples and 8/16/24-bit controls`, async () => {
    for (const [name, bytes] of [['before', source], ['after', patchPdfjsWorker(source)]]) {
      const path = join(temp, `${build.replace('/', '-')}-${name}.mjs`);
      writeFileSync(path, bytes + '\nexport { PDFFunction, Stream };');
      const { PDFFunction, Stream } = await import(pathToFileURL(path).href);
      for (const bits of [8, 16, 24, 32]) {
        const data = Uint8Array.from([128, ...Array(bits / 8 - 1).fill(0), ...Array(bits / 8).fill(255)]);
        const values = PDFFunction.getSampleArray([2], 1, bits, new Stream(data));
        const max = 2 ** bits - 1;
        assert.deepEqual(values, bits === 32 && name === 'before' ? [-(2 ** 31) / max, -1 / max] : [2 ** (bits - 1) / max, 1]);
      }
    }
  });
  test(`${build}: development and production plugin deliver identical patched bytes`, () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const plugin = pdfjsPostscriptProgress({ workerPath });
    plugin.configResolved({ command: 'serve', root, base: '/test/' });
    let served;
    plugin.configureServer({ middlewares: { use: fn => fn({ url: `/test/node_modules/pdfjs-dist/${workerPath}?v=1` },
      { setHeader() {}, end: body => { served = body; } }, () => assert.fail('worker not served')) } });
    assert.equal(served, patchPdfjsWorker(source));
    plugin.configResolved({ command: 'build', root, base: '/' });
    let emitted;
    plugin.load.call({ emitFile: asset => { emitted = asset.source; return 'worker'; } }, '\0virtual:opds-pdfjs-worker-url');
    assert.equal(emitted, served);
    assert.equal(readFileSync(require.resolve(`pdfjs-dist/${workerPath}`), 'utf8'), source, 'shared dependencies untouched');
  });
}
for (const mode of ['original', 'patched']) test(`${mode}: public PDF.js render of sampled shading and tint transforms`, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./sampled-function-probe.mjs', import.meta.url)), mode], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/PASS /g) || []).length, 8);
});
