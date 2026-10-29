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

// Annuleren tijdens het schrijven (#766): het id in de kop, en annuleren vraagt
// Rust om vóór het hernoemen te stoppen.
const { maakOpslagAnnulering, isOpslagGeannuleerd, OpslagGeannuleerd } = await import('../pdf/saver/opslag-annuleren.js');

test('a cancellable write sends a cancel id and cancels the same id in Rust', async () => {
  const calls = [];
  let finish;
  globalThis.window = { __TAURI__: { core: { invoke: (...args) => {
    calls.push(args);
    if (args[0] === 'write_file_atomic') return new Promise((resolve, reject) => { finish = { resolve, reject }; });
    return Promise.resolve();
  } } } };
  const annulering = maakOpslagAnnulering();
  const writing = writeBinaryFileAtomic('/tmp/a.pdf', new Uint8Array([1]), { annulering });
  const id = calls[0][2].headers['x-opds-cancel-id'];
  assert.match(id, /^[\w-]{1,64}$/);
  assert.equal(calls[0][2].headers['x-opds-path'], encodeURIComponent('/tmp/a.pdf'));
  annulering.annuleer();
  assert.deepEqual(calls[1], ['cancel_file_write', { id }]);
  finish.reject('opds-write-cancelled');
  await assert.rejects(writing, (e) => isOpslagGeannuleerd(e));
});

test('after the write no cancel reaches Rust any more', async () => {
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (...args) => { calls.push(args); } } } };
  const annulering = maakOpslagAnnulering();
  await writeBinaryFileAtomic('/tmp/a.pdf', new Uint8Array([1]), { annulering });
  annulering.annuleer();
  assert.deepEqual(calls.map((c) => c[0]), ['write_file_atomic']);
});

test('an already cancelled save never starts the write', async () => {
  let calls = 0;
  globalThis.window = { __TAURI__: { core: { invoke: async () => { calls++; } } } };
  const annulering = maakOpslagAnnulering();
  annulering.annuleer();
  await assert.rejects(writeBinaryFileAtomic('/tmp/a.pdf', new Uint8Array([1]), { annulering }), OpslagGeannuleerd);
  assert.equal(calls, 0);
});

test('without the desktop host the write cannot be interrupted, so it commits first', async () => {
  globalThis.window = {};
  const annulering = maakOpslagAnnulering();
  annulering.annuleer();
  // Cancelled before: refused. Not cancelled: committed before writing.
  await assert.rejects(writeBinaryFileAtomic('/tmp/a.pdf', new Uint8Array([1]), { annulering }), OpslagGeannuleerd);
  const vrij = maakOpslagAnnulering();
  try { await writeBinaryFileAtomic('/tmp/a.pdf', new Uint8Array([1]), { annulering: vrij }); } catch { /* no download in node */ }
  assert.equal(vrij.vastgelegd, true);
});
