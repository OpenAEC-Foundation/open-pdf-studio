import assert from 'node:assert/strict';
import test from 'node:test';
import { writeTempPdf } from './platform.js';

test('desktop sends the PDF as a raw body and the job name in a header', async () => {
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (...args) => { calls.push(args); return 'C:/tmp/x.pdf'; } } } };
  const bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
  assert.equal(await writeTempPdf(bytes, 'Tekening één #1.pdf'), 'C:/tmp/x.pdf');
  assert.deepEqual(calls, [['write_temp_pdf', bytes, { headers: { 'x-opds-name': encodeURIComponent('Tekening één #1.pdf') } }]]);
  assert.ok(calls[0][1] instanceof Uint8Array, 'no Array.from: one number per byte would cross as JSON');
});

test('without a name no header is sent', async () => {
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (...args) => { calls.push(args); return 'p'; } } } };
  await writeTempPdf(new Uint8Array([1]));
  assert.deepEqual(calls[0][2], { headers: {} });
});

test('an ArrayBuffer is passed as a byte view', async () => {
  let payload;
  globalThis.window = { __TAURI__: { core: { invoke: async (_c, data) => { payload = data; return 'p'; } } } };
  await writeTempPdf(new Uint8Array([1, 2, 3]).buffer);
  assert.deepEqual(payload, new Uint8Array([1, 2, 3]));
});

test('Android sends JSON bytes and the name through the same command', async () => {
  let call;
  globalThis.window = { __TAURI__: {
    os: { type: () => 'android' }, core: { invoke: async (...args) => { call = args; return 'p'; } },
  } };
  await writeTempPdf(new Uint8Array([1, 255]), 'a.pdf');
  assert.deepEqual(call[1], { data: [1, 255], name: 'a.pdf' });
});

test('in the browser there is no temp file', async () => {
  globalThis.window = {};
  await assert.rejects(writeTempPdf(new Uint8Array([1])));
});
