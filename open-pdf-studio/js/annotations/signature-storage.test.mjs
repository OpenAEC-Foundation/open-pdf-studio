import test from 'node:test';
import assert from 'node:assert/strict';
import { getSavedSignatures, saveSignatureToStorage, deleteSavedSignature } from './signature-storage.js';
import { schrijfOpslagJson } from '../core/opslag.js';

test('drawn and imported images share a five-signature history, delete and reload', () => {
  schrijfOpslagJson('pdfEditorSignatures', [{ dataUrl: 'drawn', createdAt: 'old' }]);
  for (let i = 0; i < 5; i++) saveSignatureToStorage(`import-${i}`);
  assert.deepEqual(getSavedSignatures().map(s => s.dataUrl), ['import-0', 'import-1', 'import-2', 'import-3', 'import-4']);
  deleteSavedSignature(1);
  assert.deepEqual(getSavedSignatures().map(s => s.dataUrl), ['import-0', 'import-2', 'import-3', 'import-4']);
  assert.ok(getSavedSignatures().every(s => Number.isFinite(Date.parse(s.createdAt))));
});

test('invalid stored entries are ignored by both signature consumers', () => {
  schrijfOpslagJson('pdfEditorSignatures', [null, {}, { dataUrl: 12 }, { dataUrl: 'valid' }]);
  assert.deepEqual(getSavedSignatures(), [{ dataUrl: 'valid' }]);
  schrijfOpslagJson('pdfEditorSignatures', {});
  assert.deepEqual(getSavedSignatures(), []);
});

test('quota failure preserves saved signatures and is reported to the caller', () => {
  const original = globalThis.localStorage;
  const value = JSON.stringify([{ dataUrl: 'existing' }]);
  globalThis.localStorage = { getItem: () => value, setItem: () => { throw new Error('quota'); } };
  try {
    assert.throws(() => saveSignatureToStorage('new'), /quota/);
    assert.deepEqual(getSavedSignatures(), [{ dataUrl: 'existing' }]);
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});
