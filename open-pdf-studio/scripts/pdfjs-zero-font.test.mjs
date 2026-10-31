import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchZeroInitialFont, patchPdfjsWorker, pdfjsPostscriptProgress } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const legacyPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
// The separate web unit (vite.web-unit.config.js) ships the modern build.
const modernPath = require.resolve('pdfjs-dist/build/pdf.worker.mjs');
const probe = fileURLToPath(new URL('./zero-font-probe.mjs', import.meta.url));
for (const [build, path] of [['legacy', legacyPath], ['modern', modernPath]]) {
    const source = readFileSync(path, 'utf8');
    test(`${build} build: zero-font backport matches once, composes with PostScript, is idempotent and rejects drift`, () => {
        const patched = patchZeroInitialFont(source);
        assert.notEqual(patched, source);
        assert.equal(patchZeroInitialFont(patched), patched);
        assert.equal(patched.split('currentTextState.font?.name !== textState.font.name').length, 2);
        const both = patchPdfjsWorker(source);
        assert.equal(patchPdfjsWorker(both), both);
        assert.ok(both.includes('currentTextState.font?.name'));
        assert.throws(() => patchZeroInitialFont(source + source), /no longer matches/);
        assert.throws(() => patchZeroInitialFont(source.replace('currentTextState.font.name !== textState.font.name', 'differentCode()')), /no longer matches/);
    });
    for (const mode of build === 'legacy' ? ['original', 'transformed', 'patched'] : ['original', 'patched'])
        test(`real ${build} worker extraction and Office round trip: ${mode}`, () => {
            const p = spawnSync(process.execPath, [probe, mode, path], { encoding: 'utf8', timeout: 30000 });
            if (mode === 'original') {
                assert.notEqual(p.status, 0);
                assert.match(p.stderr, /Cannot read properties of null/);
            }
            else {
                assert.equal(p.status, 0, p.stdout + p.stderr);
                assert.match(p.stdout, /PASS/);
            }
        });
}
// The plugin serves/emits the patched worker for both the app and the web unit.
for (const [workerPath, buildPath] of [[undefined, legacyPath], ['build/pdf.worker.mjs', modernPath]]) {
    test(`dev server serves the patched worker: ${workerPath || 'legacy (default)'}`, async () => {
        const plugin = pdfjsPostscriptProgress(workerPath ? { workerPath } : undefined);
        plugin.configResolved({ command: 'serve', root: fileURLToPath(new URL('..', import.meta.url)), base: '/' });
        const url = (await plugin.load('\0virtual:opds-pdfjs-worker-url')).match(/"(.+)"/)[1];
        assert.equal(url, `/node_modules/pdfjs-dist/${workerPath || 'legacy/build/pdf.worker.mjs'}`);
        let middleware, served;
        plugin.configureServer({ middlewares: { use: fn => { middleware = fn; } } });
        middleware({ url: `${url}?v=1` }, { setHeader() {}, end: body => { served = body; } }, () => assert.fail('not served'));
        assert.equal(served, patchPdfjsWorker(readFileSync(buildPath, 'utf8')));
    });
}
