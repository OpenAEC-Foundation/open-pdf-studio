// #949: 32-bit samples in Type 0 (sampled) functions moeten unsigned gelezen
// worden. De echte PDFFunction uit de worker en de echte PDF.js-API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { patchSampledFunction32 } from './pdfjs-sampled-function.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
import { sampledFunctionSamples } from './sampled-function-fixture.mjs';
const require = createRequire(import.meta.url);
const legacyPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
// De losse webunit (vite.web-unit.config.js) levert de moderne build.
const modernPath = require.resolve('pdfjs-dist/build/pdf.worker.mjs');
const builds = [['legacy', legacyPath], ['modern', modernPath]];
const SIGNED = '(codeBuf >> codeSize) * sampleMul';
const UNSIGNED = '(codeBuf >>> codeSize) * sampleMul';
const probe = fileURLToPath(new URL('./sampled-function-probe.mjs', import.meta.url));

const temp = mkdtempSync(join(tmpdir(), 'opds-sampled-test-'));
test.after(() => rmSync(temp, { recursive: true, force: true }));
let copies = 0;
async function workerModule(workerSource) {
  const file = join(temp, `pdf.worker.${copies++}.mjs`);
  writeFileSync(file, `${workerSource}\nexport { PDFFunction, Stream };\n`);
  return import(pathToFileURL(file).href);
}
function bytesFor(bps, values) {
  const out = [];
  for (const v of values) for (let b = bps / 8 - 1; b >= 0; b--) out.push(Math.floor(v / 2 ** (8 * b)) % 256);
  return new Uint8Array(out);
}
const samples = ({ PDFFunction, Stream }, bps, values = sampledFunctionSamples(bps)) =>
  PDFFunction.getSampleArray([values.length], 1, bps, new Stream(bytesFor(bps, values)));

for (const [build, path] of builds) {
  const source = readFileSync(path, 'utf8');
  test(`${build} build: backport matches once, is idempotent and rejects dependency drift`, () => {
    const fixed = patchSampledFunction32(source);
    assert.notEqual(fixed, source);
    assert.ok(fixed.includes(UNSIGNED) && !fixed.includes(SIGNED));
    assert.equal(fixed.split(UNSIGNED).length, 2, 'exactly one site patched');
    assert.equal(patchSampledFunction32(fixed), fixed);
    assert.throws(() => patchSampledFunction32(source + source), /no longer matches.*#949/);
    assert.throws(() => patchSampledFunction32(source.replace(SIGNED, '(codeBuf >> codeSize)*sampleMul')), /no longer matches/);
    const all = patchPdfjsWorker(source);
    assert.ok(all.includes(UNSIGNED) && !all.includes(SIGNED), 'the shipped worker carries the backport');
    assert.equal(patchPdfjsWorker(all), all);
  });

  test(`${build} build: real PDFFunction reads 32-bit samples unsigned, 8/16/24-bit unchanged`, async () => {
    const original = await workerModule(source);
    const fixed = await workerModule(patchPdfjsWorker(source));
    // Ongepatcht: 0x80000000 en 0xffffffff worden negatief (zwart).
    const broken = samples(original, 32);
    assert.ok(broken[0] < 0 && broken[1] < 0, `unpatched 32-bit samples are negative: ${broken}`);
    const [half, one] = samples(fixed, 32);
    assert.equal(half, 0x80000000 / (2 ** 32 - 1));
    assert.equal(one, 1);
    for (const bps of [8, 16, 24]) {
      assert.deepEqual(samples(fixed, bps), samples(original, bps), `${bps}-bit unchanged`);
      assert.equal(samples(fixed, bps)[1], 1);
    }
    // Meerdere samples achter elkaar (codeBuf-rest tussen samples) blijven exact.
    const values = [0, 1, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff];
    assert.deepEqual(samples(fixed, 32, values), values.map(v => v / (2 ** 32 - 1)));
  });
}

// Via de publieke PDF.js-API: tint-transformatie (Separation) en axiaal
// verloop gebruiken dezelfde sampled functie; ook de gerenderde pixels.
function run(mode, path) {
  const p = spawnSync(process.execPath, [probe, mode, path], { encoding: 'utf8', timeout: 60000 });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  return Object.fromEntries(p.stdout.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)).map(r => [r.bps, r]));
}
const GOOD = { fills: ['#808080', '#ffffff'], stops: [[0, '#808080'], [1, '#ffffff']] };
for (const [build, path] of builds) test(`${build} build: tint transform and axial shading are no longer black`, () => {
  const original = run('original', path);
  assert.deepEqual(original[32].fills, ['#000000', '#000000'], 'reproduces #949 unpatched');
  const fixed = run('patched', path);
  for (const bps of [8, 16, 24, 32]) {
    assert.deepEqual({ fills: fixed[bps].fills, stops: fixed[bps].stops }, GOOD, `${bps}-bit`);
    assert.deepEqual(fixed[bps].fills, bps === 32 ? GOOD.fills : original[bps].fills);
  }
  // Gerenderd verloop: ~50% grijs naar wit (alleen als @napi-rs/canvas laadt).
  const px = fixed[32].pixels;
  if (px) {
    assert.ok(px[0] > 120 && px[0] < 160 && px[1] > px[0] && px[2] > px[1], `nonblack gradient: ${px}`);
    assert.deepEqual(px, fixed[8].pixels, '32-bit renders like the 8-bit control');
  }
});
