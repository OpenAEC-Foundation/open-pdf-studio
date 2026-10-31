// Run after `vite build`: exercise the worker actually shipped to users.
// App: node scripts/postscript-build-check.mjs dist/assets; web unit
// (vite.web-unit.config.js): node scripts/postscript-build-check.mjs dist-web-unit/brokken
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
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
