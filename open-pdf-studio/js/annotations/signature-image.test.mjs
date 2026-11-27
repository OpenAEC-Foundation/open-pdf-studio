import test from 'node:test';
import assert from 'node:assert/strict';
import { signatureImageData } from './signature-image.js';

test('rejects unsupported bytes before decoding (even if named PNG)', async () => {
  for (const value of ['', '<svg></svg>', 'GIF89a', '%PDF-1.7']) {
    await assert.rejects(signatureImageData(new TextEncoder().encode(value)), /PNG \/ JPEG/);
  }
});

test('bounds source size before allocating an image', async () => {
  await assert.rejects(signatureImageData(new Uint8Array(10 * 1024 * 1024 + 1)), /10 MB/);
});
