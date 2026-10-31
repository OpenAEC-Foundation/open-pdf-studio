// Run after `vite build`: exercise the worker actually shipped to users.
// App: node scripts/postscript-build-check.mjs dist/assets; web unit
// (vite.web-unit.config.js): node scripts/postscript-build-check.mjs dist-web-unit/brokken
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
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
const chunks = files.filter(name => name.endsWith('.js') && !workers.includes(name));
assert.ok(chunks.some(name => fs.readFileSync(resolve(assets, name), 'utf8').includes(workers[0])), 'app references the patched asset');
console.log('PASS one shared worker:', workers[0]);
// #638: the shipped worker decodes XRef stream offsets above 2 GiB exactly.
const temp = fs.mkdtempSync(join(tmpdir(), 'opds-xref-build-'));
try {
  const copy = join(temp, 'pdf.worker.mjs');
  fs.writeFileSync(copy, `${fs.readFileSync(worker, 'utf8')}\nexport { XRef, Stream };\n`);
  const { XRef, Stream } = await import(pathToFileURL(copy).href);
  const fixture = xrefOffsetFixture(8);
  const xref = new XRef(new Stream(fixture.bytes), {});
  xref.setStartXRef(fixture.startXRef);
  xref.readXRef();
  assert.deepEqual(fixture.hugeObjects.map(num => xref.getEntry(num).offset), [2 ** 31, 2 ** 32 + 10]);
  console.log('PASS built worker: XRef stream offsets 2^31 and 2^32 + 10');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
