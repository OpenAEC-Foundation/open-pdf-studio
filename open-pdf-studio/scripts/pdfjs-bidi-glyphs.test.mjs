import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { patchBidiGlyphs } from './pdfjs-bidi-glyphs.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
import { glyphCases } from './bidi-glyphs-cases.mjs';
const require = createRequire(import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'opds-glyph-unit-'));
test.after(() => rmSync(temp, { recursive: true, force: true }));
for (const build of ['legacy/build', 'build']) {
  const workerPath = require.resolve(`pdfjs-dist/${build}/pdf.worker.mjs`);
  const source = readFileSync(workerPath, 'utf8');
  test(`${build}: complete glyph backport is idempotent and fails closed on drift/partial/duplicate patches`, () => {
    const fixed = patchBidiGlyphs(source);
    assert.equal(patchBidiGlyphs(fixed), fixed);
    const all = patchPdfjsWorker(source);
    assert.equal(patchPdfjsWorker(all), all);
    assert.throws(() => patchBidiGlyphs(source + source), /#1078/);
    assert.throws(() => patchBidiGlyphs(fixed + source), /#1078/);
    for (const fragment of ['function findUnequal', 'function bidi', 'for (level = highestLevel', 'chars.join("")', 'function runBidiTransform', 'textChunk.str.push(glyphUnicode)', 'get category()']) {
      assert.throws(() => patchBidiGlyphs(source.replace(fragment, `${fragment}changed`)), /#1078/, fragment);
    }
    assert.throws(() => patchBidiGlyphs(fixed.replace('bidi(textChunk.str,', 'bidi(textChunk.str.join(""),')), /#1078/);
  });
  test(`${build}: real bidi preserves same-level glyphs and cached normalization stays out of serialization`, async () => {
    const file = join(temp, build.replace('/', '-') + '.mjs');
    writeFileSync(file, patchPdfjsWorker(source) + '\nexport { bidi, fonts_Glyph };');
    const { bidi, fonts_Glyph } = await import(pathToFileURL(file).href);
    for (const c of glyphCases) assert.equal(bidi(c.glyphs).str, c.raw, c.name);
    assert.deepEqual(bidi([], -1, true), { str: '', dir: 'ttb' });
    assert.deepEqual(bidi(['لا', 'م'], -1, true), { str: 'لام', dir: 'ttb' });
    const glyph = new fonts_Glyph(1, 'x', '\uFC42');
    assert.equal(glyph.normalizedUnicode, 'لم');
    assert.equal(Object.getOwnPropertyDescriptor(glyph, 'normalizedUnicode').enumerable, false);
    assert.equal(JSON.parse(JSON.stringify(glyph)).normalizedUnicode, undefined);
  });
  test(`${build}: full production worker reproduces old ligature corruption and fixes public extraction`, () => {
    const probe = fileURLToPath(new URL('./bidi-glyphs-probe.mjs', import.meta.url));
    const run = mode => {
      const p = spawnSync(process.execPath, [probe, mode, workerPath], { encoding: 'utf8', timeout: 60000 });
      assert.equal(p.status, 0, p.stdout + p.stderr);
      return p.stdout.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
    };
    const before = run('previous'), after = run('patched');
    assert.equal(before.find(c => c.name === 'lam-alef').normal, 'سالم');
    assert.equal(before.find(c => c.name === 'lam-alef').raw, 'سالم');
    assert.notEqual(before.find(c => c.name === 'presentation-form').normal, 'سلمم');
    for (const c of after) {
      assert.equal(c.normal, c.expectedNormal, c.name + ': normalized');
      assert.equal(c.raw, c.expectedRaw, c.name + ': raw');
    }
    assert.deepEqual(after.find(c => c.name === 'LTR-control'), before.find(c => c.name === 'LTR-control'));
  });
}
