// Run after `vite build`: exercise the worker actually shipped to users.
// App: node scripts/postscript-build-check.mjs dist/assets; web unit
// (vite.web-unit.config.js): node scripts/postscript-build-check.mjs dist-web-unit/brokken
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { xrefOffsetFixture } from './xref-offset-fixture.mjs';
const assets = resolve(process.argv[2] || 'dist/assets');
const files = fs.readdirSync(assets);
const workers = files.filter(name => /^pdf\.worker-.*\.js$/.test(name));
assert.equal(workers.length, 1, 'editor and print queue must share one patched worker');
const worker = resolve(assets, workers[0]);
const probe = fileURLToPath(new URL('./postscript-probe.mjs', import.meta.url));
for (const program of ['{ pop + 0 0 }', '{ pop - 0 0 }', '{ pop 1e999 0 0 }', '{ pop foo 0 0 }', '{ pop @ 0 0 }', '{ 0 0 }']) {
  const result = spawnSync(process.execPath, [probe, 'built', program, worker], { timeout: 15000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log('PASS built worker:', program);
}
// #878: zero-size initial font keeps the visible text that follows it.
const zeroFont = spawnSync(process.execPath, [fileURLToPath(new URL('./zero-font-probe.mjs', import.meta.url)), 'shipped', worker], { timeout: 30000, encoding: 'utf8' });
assert.equal(zeroFont.status, 0, zeroFont.stdout + zeroFont.stderr);
console.log('PASS built worker: zero-size initial font keeps visible text');
const chunks = files.filter(name => name.endsWith('.js') && !workers.includes(name));
assert.ok(chunks.some(name => fs.readFileSync(resolve(assets, name), 'utf8').includes(workers[0])), 'app references the patched asset');
console.log('PASS one shared worker:', workers[0]);
// #638: the shipped worker decodes XRef stream offsets above 2 GiB exactly.
const temp = fs.mkdtempSync(join(tmpdir(), 'opds-xref-build-'));
try {
  const copy = join(temp, 'pdf.worker.mjs');
  fs.writeFileSync(copy, `${fs.readFileSync(worker, 'utf8')}
export { XRef, Stream };
`);
  const { XRef, Stream } = await import(pathToFileURL(copy).href);
  const fixture = xrefOffsetFixture(8);
  const xref = new XRef(new Stream(fixture.bytes), {});
  xref.setStartXRef(fixture.startXRef);
  xref.readXRef();
  assert.deepEqual(fixture.hugeObjects.map(num => xref.getEntry(num).offset), [2 ** 31, 2 ** 32 + 10]);
  console.log('PASS built worker: XRef stream offsets 2^31 and 2^32 + 10');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
// #949: 32-bit samples in Type 0 functions (tint transform and shading).
const sampled = spawnSync(process.execPath, [fileURLToPath(new URL('./sampled-function-probe.mjs', import.meta.url)), 'shipped', worker], { timeout: 60000, encoding: 'utf8' });
assert.equal(sampled.status, 0, sampled.stdout + sampled.stderr);
const sampledRows = sampled.stdout.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
assert.equal(sampledRows.length, 4);
for (const row of sampledRows) assert.deepEqual(row.fills, ['#808080', '#ffffff'], `${row.bps}-bit sampled function`);
console.log('PASS built worker: 32-bit sampled functions are read unsigned');
// #957: combining marks keep their logical order in RTL text extraction.
const bidiMarks = spawnSync(process.execPath, [fileURLToPath(new URL('./bidi-marks-probe.mjs', import.meta.url)), 'shipped', worker], { timeout: 60000, encoding: 'utf8' });
assert.equal(bidiMarks.status, 0, bidiMarks.stdout + bidiMarks.stderr);
const bidiRows = bidiMarks.stdout.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
assert.equal(bidiRows.length, 4);
for (const row of bidiRows) assert.deepEqual(row.raw, row.expected, `bidi ${row.name}`);
console.log('PASS built worker: combining marks keep their logical order');
// #636: the shipped worker decodes a repeated Form XObject once per page operation.
const formCache = spawnSync(process.execPath, [fileURLToPath(new URL('./form-xobject-probe.mjs', import.meta.url)), 'shipped', worker], { timeout: 120000, encoding: 'utf8' });
assert.equal(formCache.status, 0, formCache.stdout + formCache.stderr);
const formRows = formCache.stdout.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
assert.equal(formRows.length, 2);
for (const row of formRows) assert.deepEqual([row.opsDecodes, row.textDecodes], [3, 3], `page ${row.page} decodes`);
console.log('PASS built worker: repeated Form XObjects are decoded once per page operation');
// #637: the shipped display library carries the knockout-bounds backport
// (a property name, so it survives minification).
assert.ok(chunks.some(name => fs.readFileSync(resolve(assets, name), 'utf8').includes('knockoutTempDirtyRect')), 'display library carries the #637 backport');
console.log('PASS built display library: knockout fills composite within their bounds');
