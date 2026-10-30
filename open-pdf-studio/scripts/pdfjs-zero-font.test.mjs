import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchZeroInitialFont, patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
test('zero-font backport matches once, composes with PostScript, is idempotent and rejects drift', () => {
    const patched = patchZeroInitialFont(source);
    assert.notEqual(patched, source);
    assert.equal(patchZeroInitialFont(patched), patched);
    const both = patchPdfjsWorker(source);
    assert.equal(patchPdfjsWorker(both), both);
    assert.throws(() => patchZeroInitialFont(source + source), /no longer matches/);
    assert.throws(() => patchZeroInitialFont(source.replace('currentTextState.font.name !== textState.font.name', 'differentCode()')), /no longer matches/);
});
for (const mode of ['original', 'transformed'])
    test(`real legacy worker extraction and Office round trip: ${mode}`, () => {
        const p = spawnSync(process.execPath, [fileURLToPath(new URL('./zero-font-probe.mjs', import.meta.url)), mode], { encoding: 'utf8', timeout: 30000 });
        if (mode === 'original') {
            assert.notEqual(p.status, 0);
            assert.match(p.stderr, /Cannot read properties of null/);
        }
        else {
            assert.equal(p.status, 0, p.stdout + p.stderr);
            assert.match(p.stdout, /PASS/);
        }
    });
