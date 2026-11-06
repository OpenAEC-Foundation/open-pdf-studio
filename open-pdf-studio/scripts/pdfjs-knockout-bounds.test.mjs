// #637: elementen van een knockout-groep worden binnen hun begrenzingsvak
// gecomponeerd, met pixel voor pixel dezelfde uitkomst. De echte PDF.js-
// weergavebibliotheek op @napi-rs/canvas, in een eigen proces per variant.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { patchKnockoutBounds, PDFJS_DISPLAY_MODULE } from './pdfjs-knockout-bounds.mjs';
import { patchPdfjsDisplay, pdfjsPostscriptProgress } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const builds = [
  ['legacy', require.resolve('pdfjs-dist/legacy/build/pdf.mjs')],
  // De losse webunit (vite.web-unit.config.js) gebruikt de moderne build.
  ['modern', require.resolve('pdfjs-dist/build/pdf.mjs')],
];
const probe = fileURLToPath(new URL('./knockout-bounds-probe.mjs', import.meta.url));

for (const [build, path] of builds) {
  const source = readFileSync(path, 'utf8');
  test(`${build} build: backport matches once, is idempotent and rejects dependency drift`, () => {
    const fixed = patchKnockoutBounds(source);
    assert.notEqual(fixed, source);
    assert.ok(fixed.includes('#endKnockoutElement(started, intersect ?? [0, 0, 0, 0], pathBox)'));
    assert.ok(fixed.includes('destCtx.drawImage(surfaceCanvas, rx, ry, rw, rh, rx, ry, rw, rh);'));
    assert.equal(patchKnockoutBounds(fixed), fixed);
    assert.equal(patchPdfjsDisplay(fixed), fixed);
    assert.throws(() => patchKnockoutBounds(source + source), /no longer matches.*#637/);
    assert.throws(() => patchKnockoutBounds(source.replace('    destCtx.drawImage(surfaceCanvas, 0, 0);\n', '    destCtx.drawImage(surfaceCanvas, 0, 0, 1);\n')), /no longer matches/);
    // Half gepatcht (een paar ontbrekend) is ook drift.
    assert.throws(() => patchKnockoutBounds(fixed.replace('rect = null\n    } = options;', 'rect\n    } = options;')), /no longer matches/);
    assert.ok(PDFJS_DISPLAY_MODULE.test(path), 'the plugin recognises this module');
  });
}

test('module filter: only the display library, not the worker or the minified builds', () => {
  assert.ok(PDFJS_DISPLAY_MODULE.test('/x/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  assert.ok(PDFJS_DISPLAY_MODULE.test('C:\\x\\node_modules\\pdfjs-dist\\build\\pdf.mjs'));
  assert.ok(!PDFJS_DISPLAY_MODULE.test('/x/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'));
  assert.ok(!PDFJS_DISPLAY_MODULE.test('/x/node_modules/pdfjs-dist/build/pdf.min.mjs'));
});

test('vite plugin: build transform and dev pre-bundling both ship the patched display library', async () => {
  const plugin = pdfjsPostscriptProgress();
  const id = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const source = readFileSync(id, 'utf8');
  assert.ok(plugin.transform(source, id).code.includes('knockoutTempDirtyRect'));
  assert.equal(plugin.transform('export {}', '/x/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'), null);
  // Dev: Vite bundelt pdfjs-dist vooraf met esbuild, buiten transform om.
  const { esbuildOptions } = plugin.config().optimizeDeps;
  const { build } = await import('esbuild');
  const out = await build({ entryPoints: [id], bundle: true, write: false, format: 'esm', logLevel: 'silent', plugins: esbuildOptions.plugins });
  assert.ok(out.outputFiles[0].text.includes('knockoutTempDirtyRect'), 'pre-bundled pdf.mjs is patched');
});

function run(mode) {
  const p = spawnSync(process.execPath, [probe, mode, '1', '4', '8'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  return p.stdout.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
}

test('identical pixels for overlapping, alpha, clipped, out-of-bbox, stroke and pattern elements, at 1x, 4x and 8x', () => {
  const original = run('original');
  const patched = run('patched');
  assert.equal(original.length, 3);
  for (let i = 0; i < original.length; i++) {
    const [o, p] = [original[i], patched[i]];
    assert.equal(p.pixels, o.pixels, `scale ${o.scale}: same pixels`);
    assert.ok(o.colours > 50, 'the fixture really draws the groups');
    // Ongepatcht componeert elk element over het hele groepscanvas.
    assert.ok(o.full > 100 && o.partial === 0, `unpatched: ${JSON.stringify(o)}`);
    // Gepatcht: gewone vullingen binnen hun vak; lijn en patroon (2 elementen
    // per groep, elk ~3 kopieën) nog over het hele canvas.
    assert.equal(p.full, 0);
    assert.ok(p.partial > 150, `patched fills use their bounds: ${JSON.stringify(p)}`);
    assert.ok(p.whole > 0 && p.whole < 30, `patched stroke and pattern still use the whole canvas: ${JSON.stringify(p)}`);
  }
});
