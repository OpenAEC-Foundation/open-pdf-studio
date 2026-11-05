// #636: een Form XObject die vaak op een pagina staat, wordt per
// paginabewerking maar één keer uitgepakt, met dezelfde operatorlijst en
// tekst als zonder backport. De echte PartialEvaluator uit de worker en de
// echte PDF.js-API.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { patchFormXObjectCache, FORM_CACHE_MAX_BYTES } from './pdfjs-form-xobject-cache.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const builds = [
  ['legacy', require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')],
  // De losse webunit (vite.web-unit.config.js) levert de moderne build.
  ['modern', require.resolve('pdfjs-dist/build/pdf.worker.mjs')],
];
const probe = fileURLToPath(new URL('./form-xobject-probe.mjs', import.meta.url));

const temp = mkdtempSync(join(tmpdir(), 'opds-form-cache-test-'));
test.after(() => rmSync(temp, { recursive: true, force: true }));
let copies = 0;
async function workerModule(workerSource) {
  const file = join(temp, `pdf.worker.${copies++}.mjs`);
  writeFileSync(file, `${workerSource}\nexport { PartialEvaluator, Stream };\n`);
  return import(pathToFileURL(file).href);
}

for (const [build, path] of builds) {
  const source = readFileSync(path, 'utf8');
  test(`${build} build: backport matches once, is idempotent and rejects dependency drift`, () => {
    const fixed = patchFormXObjectCache(source);
    assert.notEqual(fixed, source);
    assert.equal(fixed.split('stream = await this._getDecodedStream(stream);').length, 3, 'operator list and text content');
    assert.ok(!fixed.includes('const bytes = await stream.asyncGetBytes();'));
    assert.equal(patchFormXObjectCache(fixed), fixed);
    assert.throws(() => patchFormXObjectCache(source + source), /no longer matches.*#636/);
    assert.throws(() => patchFormXObjectCache(source.replace('    intersector = null\n  }) {\n', '    intersector\n  }) {\n')), /no longer matches/);
    assert.throws(() => patchFormXObjectCache(source.replace('this._regionalImageCache = new RegionalImageCache();', '')), /no longer matches/);
    const all = patchPdfjsWorker(source);
    assert.ok(all.includes('_getDecodedStream'), 'the shipped worker carries the backport');
    assert.equal(patchPdfjsWorker(all), all);
  });

  test(`${build} build: the cache is per evaluator, shared by clones and bounded`, async () => {
    const { PartialEvaluator, Stream } = await workerModule(patchPdfjsWorker(source));
    const evaluator = () => new PartialEvaluator({ xref: null, handler: null, pageIndex: 0, idFactory: null });
    let decodes = 0;
    const asyncStream = (objId, bytes) => ({
      isAsync: true,
      dict: objId ? { objId } : null,
      asyncGetBytes: async () => { decodes++; return bytes; },
    });
    const page = evaluator();
    const bytes = new Uint8Array([1, 2, 3]);
    const a = await page._getDecodedStream(asyncStream('5R', bytes));
    const b = await page._getDecodedStream(asyncStream('5R', bytes));
    assert.equal(decodes, 1, 'second use of the same form is served from the cache');
    assert.ok(a instanceof Stream && b instanceof Stream && a !== b, 'every use gets its own stream');
    assert.deepEqual([a.getByte(), a.getByte(), b.getByte()], [1, 2, 1], 'independent read positions');
    // Een kloon (bv. voor een Type3-font of een patroon) deelt de cache.
    await page.clone()._getDecodedStream(asyncStream('5R', bytes));
    assert.equal(decodes, 1);
    // Een nieuwe evaluator (de volgende paginabewerking) begint leeg.
    await evaluator()._getDecodedStream(asyncStream('5R', bytes));
    assert.equal(decodes, 2);
    // Zonder objectnummer (inline/samengestelde stream) nooit cachen.
    await page._getDecodedStream(asyncStream(null, bytes));
    await page._getDecodedStream(asyncStream(null, bytes));
    assert.equal(decodes, 4);
    // Een stream die niet uit te pakken is, blijft de oorspronkelijke.
    const failing = { isAsync: true, dict: { objId: '9R' }, asyncGetBytes: async () => null };
    assert.equal(await page._getDecodedStream(failing), failing);

    // Begrensd: boven FORM_CACHE_MAX_BYTES wordt er niet meer bijgecachet.
    const bounded = evaluator();
    const big = new Uint8Array(Math.floor(FORM_CACHE_MAX_BYTES * 0.6));
    decodes = 0;
    await bounded._getDecodedStream(asyncStream('1R', big));
    await bounded._getDecodedStream(asyncStream('2R', big));
    await bounded._getDecodedStream(asyncStream('1R', big));
    await bounded._getDecodedStream(asyncStream('2R', big));
    assert.equal(decodes, 3, 'the first form is cached, the one that does not fit is decoded every time');
    assert.ok(bounded._decodedStreamCache.bytes <= FORM_CACHE_MAX_BYTES);
    assert.equal(bounded._decodedStreamCache.entries.size, 1);
  });
}

function run(mode, path = '-') {
  const p = spawnSync(process.execPath, [probe, mode, path], { encoding: 'utf8', timeout: 120000 });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  return p.stdout.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
}
const stable = rows => rows.map(({ opsMs, opsDecodes, textDecodes, ...rest }) => rest);

test('public API: identical operator list and text, one decode per form per page operation', () => {
  const original = run('original');
  const patched = run('patched');
  assert.equal(original.length, 2);
  assert.deepEqual(stable(patched), stable(original), 'same operator list and text content');
  for (const row of original) {
    assert.ok(row.opsDecodes >= 400 && row.textDecodes >= 400, `unpatched decodes every Do: ${JSON.stringify(row.opsDecodes)}`);
  }
  for (const row of patched) {
    // Paginacontent + Fm0 (400 keer gebruikt) + Fm1 (één keer), elke pagina opnieuw.
    assert.equal(row.opsDecodes, 3, `page ${row.page} operator list`);
    assert.equal(row.textDecodes, 3, `page ${row.page} text content`);
    assert.ok(row.opCount > 4000);
    assert.ok(row.text.includes('once') && row.text.split('|').filter(w => w === 'm').length === 400);
  }
});
