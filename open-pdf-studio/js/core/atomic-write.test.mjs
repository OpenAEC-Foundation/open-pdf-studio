import assert from 'node:assert/strict';
import test from 'node:test';
import { writeBinaryFileAtomic } from './platform.js';

test('desktop sends binary bytes and an encoded destination to the atomic writer', async () => {
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (...args) => calls.push(args) } } };
  const bytes = new Uint8Array([0, 128, 255]);
  await writeBinaryFileAtomic('/tmp/één #1.pdf', bytes);
  assert.deepEqual(calls, [['write_file_atomic', bytes, { headers: { 'x-opds-path': encodeURIComponent('/tmp/één #1.pdf') } }]]);
});

test('native failure never falls back to overwriting the original', async () => {
  let directWrites = 0;
  globalThis.window = { __TAURI__: {
    core: { invoke: async () => { throw new Error('disk full'); } },
    fs: { writeFile: async () => { directWrites++; } },
  } };
  await assert.rejects(writeBinaryFileAtomic('file.pdf', new Uint8Array([1])), /disk full/);
  assert.equal(directWrites, 0);
});

test('Android sends JSON bytes through the same atomic command', async () => {
  let payload;
  globalThis.window = { __TAURI__: {
    os: { type: () => 'android' }, core: { invoke: async (_command, data) => { payload = data; } },
  } };
  await writeBinaryFileAtomic('/data/file.pdf', new Uint8Array([1, 255]));
  assert.deepEqual(payload, { data: [1, 255] });
});
