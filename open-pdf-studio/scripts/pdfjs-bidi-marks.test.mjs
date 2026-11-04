import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { patchBidiMarks } from './pdfjs-bidi-marks.mjs';
import { patchPdfjsWorker, pdfjsPostscriptProgress } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const probe = fileURLToPath(new URL('./bidi-marks-probe.mjs', import.meta.url));
for (const build of ['legacy/build', 'build']) {
  const workerPath = `${build}/pdf.worker.mjs`;
  const path = require.resolve(`pdfjs-dist/${workerPath}`);
  const source = readFileSync(path, 'utf8');
  test(`${build}: bidi patch composes, is idempotent and rejects dependency drift`, () => {
    const patched = patchPdfjsWorker(source);
    assert.notEqual(patched, source);
    assert.equal(patchPdfjsWorker(patched), patched);
    assert.throws(() => patchBidiMarks(source + source), /no longer matches/);
    assert.throws(() => patchBidiMarks('unrecognized worker'), /no longer matches/);
  });
  for (const mode of build === 'build' ? ['original', 'patched'] : ['original', 'patched', 'transformed']) {
    test(`${build}: real extraction and Office roundtrip (${mode})`, () => {
      const p = spawnSync(process.execPath, [probe, mode, path], { encoding: 'utf8', timeout: 60000 });
      if (mode === 'original') {
        assert.notEqual(p.status, 0);
        assert.match(p.stderr, /exact source Unicode order/);
      } else assert.equal(p.status, 0, p.stdout + p.stderr);
    });
  }
  test(`${build}: actual bidi algorithm preserves mixed scripts, numbers, punctuation and vertical text controls`, () => {
    const start = source.indexOf('const baseTypes =');
    const end = source.indexOf('\nclass ', source.indexOf('function bidi('));
    const extract = s => runInNewContext(`${s.slice(start, end)}; bidi`, { warn() {} });
    const before = extract(source);
    // Patch only the isolated segment so indexes do not shift.
    const after = runInNewContext(`${patchBidiMarks(source.slice(start, end))}; bidi`, { warn() {} });
    for (const text of ['abc 123!', 'مرحبا 123 ABC', 'אבג (123) ABC', '123,456.78', 'A\u0300', '\u093e', 'مرحبا']) {
      assert.equal(JSON.stringify(after(text)), JSON.stringify(before(text)), text);
    }
    assert.equal(after('ر\u034f\u064eم').str, 'م\u064e\u034fر');
    assert.equal(after('ر\u034f\u064eم', -1, true).str, 'ر\u034f\u064eم');
  });
  test(`${build}: dev delivery includes correction`, () => {
    const plugin = pdfjsPostscriptProgress({ workerPath });
    plugin.configResolved({ command: 'serve', root: fileURLToPath(new URL('..', import.meta.url)), base: '/' });
    let middleware, served;
    plugin.configureServer({ middlewares: { use: fn => { middleware = fn; } } });
    middleware({ url: `/node_modules/pdfjs-dist/${workerPath}` }, { setHeader() {}, end: body => { served = body; } }, () => assert.fail('not served'));
    assert.equal(served, patchPdfjsWorker(source));
  });
}
