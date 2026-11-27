import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchBidiCurrency } from './pdfjs-bidi-currency.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
for (const build of ['legacy/build', 'build']) {
  const workerPath = require.resolve(`pdfjs-dist/${build}/pdf.worker.mjs`);
  const source = readFileSync(workerPath, 'utf8');
  test(`${build}: currency patch is idempotent and rejects drift/partial/duplicate input`, () => {
    const fixed = patchBidiCurrency(source);
    assert.equal(patchBidiCurrency(fixed), fixed);
    assert.equal(patchPdfjsWorker(patchPdfjsWorker(source)), patchPdfjsWorker(source));
    for (const broken of [source + source, fixed + source, fixed + fixed,
      source.replace('charType = baseTypes[charCode]', 'charType = different[charCode]'),
      fixed.replace('charType = "ET"; // Currency', 'charType = "L"; // Currency')]) {
      assert.throws(() => patchBidiCurrency(broken), /#1266/);
    }
  });
  test(`${build}: complete production worker fixes currency extraction, retaining controls`, () => {
    const probe = fileURLToPath(new URL('./bidi-currency-probe.mjs', import.meta.url));
    for (const mode of ['previous', 'patched']) {
      const p = spawnSync(process.execPath, [probe, mode, workerPath], { encoding: 'utf8', timeout:60000 });
      assert.equal(p.status, 0, p.stdout+p.stderr);
      const cases = p.stdout.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
      assert.equal(cases.length, 4);
      for (const c of cases) {
        assert.equal(c.normal, mode==='previous'?c.before:c.expected, c.name);
        assert.equal(c.raw, c.normal, c.name+' without normalization');
        assert.equal(c.dir, c.expectedDir, c.name+' direction');
      }
      if(mode==='previous') for(const c of cases.slice(0,2)) assert.notEqual(c.normal,c.expected);
    }
  });
}
