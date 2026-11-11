import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchSoftMaskBounds } from './pdfjs-soft-mask-bounds.mjs';
import { patchPdfjsDisplay, pdfjsPostscriptProgress } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const probe = fileURLToPath(new URL('./soft-mask-probe.mjs', import.meta.url));

function run(mode, build) {
  const p = spawnSync(process.execPath, [probe, mode, build], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  return p.stdout.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
}
for (const build of ['legacy', 'modern']) {
  const id = require.resolve(`pdfjs-dist/${build === 'legacy' ? 'legacy/' : ''}build/pdf.mjs`);
  const source = readFileSync(id, 'utf8');
  test(`${build}: exact-match, idempotent, rejects partial/duplicate patches and dependency drift`, () => {
    const fixed = patchSoftMaskBounds(source);
    assert.notEqual(source, fixed);
    assert.equal(patchSoftMaskBounds(fixed), fixed);
    assert.equal(patchPdfjsDisplay(patchPdfjsDisplay(source)), patchPdfjsDisplay(source));
    assert.throws(() => patchSoftMaskBounds(source + source), /no longer matches/);
    assert.throws(() => patchSoftMaskBounds(source.replace('    const preparedEntry = this.smaskPreparedEntry;', '    const preparedEntry = other;')), /no longer matches/);
    assert.throws(() => patchSoftMaskBounds(fixed.replace('mask.width', 'mask.changedWidth')), /no longer matches/);
    assert.equal(pdfjsPostscriptProgress().transform(source, id).code, patchPdfjsDisplay(source));
  });
  // The modern build requires browser APIs absent in Node; exercise its
  // emitted assets in test-soft-mask-browser.mjs instead of adding polyfills.
  if (build === 'legacy') test(`${build}: real PDF.js fixes disjoint masks, preserves partial draws and nonzero outside alpha at 3 zooms / 4 rotations`, () => {
    const before = run('baseline', build), after = run('patched', build);
    assert.equal(after.length, 192);
    after.forEach((row, i) => {
      const label = JSON.stringify({ ...row, samples: undefined });
      assert.equal(row.paths[row.knockout ? 'inplace' : 'scratch'], 2, label);
      if (row.variant === 'black' || row.variant === 'alpha') {
        assert.deepEqual(before[i].samples[0], [255, 0, 0, 255], 'baseline reproduces the red leak: ' + label);
        assert.deepEqual(row.samples, [
          row.earlierBlue ? [0, 0, 255, 255] : [255, 255, 255, 255],
          [255, 0, 0, 255], [255, 255, 255, 255], [0, 255, 0, 255],
        ], label);
      } else {
        // Keep the nonzero-alpha path unchanged. The browser/reference
        // test qualifies its colors independently of the Node canvas backend.
        assert.deepEqual(row.samples, before[i].samples, label);
        if (row.variant === 'white') assert.deepEqual(row.samples, [
          [255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255],
        ], label);
      }
    });
  });
}
