import assert from 'node:assert/strict';
import test from 'node:test';
import { open } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { openFileDialog, readBinaryFile, saveFileDialog, writeBinaryFileAtomic } from './platform.js';
import { maakOpslagAnnulering } from '../pdf/saver/opslag-annuleren.js';

test('Android opens, edits, replaces and reopens a provider document', async () => {
  const uri = 'content://example.documents/document/msf%3A127';
  const pdf = await PDFDocument.create();
  pdf.addPage();
  let stored = await pdf.save();
  let writes = 0;
  let proposal;
  globalThis.OpdsAndroid = { displayName: () => 'Plan.pdf' };
  globalThis.window = { __TAURI__: {
    os: { type: () => 'android' },
    dialog: { open: async () => [uri], save: async ({ defaultPath }) => { proposal = defaultPath; return uri; } },
    fs: {
      readFile: async path => { assert.equal(path, uri); return stored.slice(); },
    },
    core: { invoke: async (command, payload, { headers } = {}) => {
      if (command === 'write_android_document') {
        assert.equal(payload.path, uri);
        stored = Uint8Array.from(payload.data);
        writes++;
        return;
      }
      assert.equal(command, 'write_file_atomic');
      // A document URI has no filesystem directory for the temporary sibling.
      const path = decodeURIComponent(headers['x-opds-path']);
      const file = await open(path.slice(0, path.lastIndexOf('/')) + '/.opds-save.tmp', 'wx');
      await file.close();
    } },
  } };
  const [selected] = await openFileDialog(['pdf'], { multiple: true });
  const edited = await PDFDocument.load(await readBinaryFile(selected));
  edited.setTitle('Updated');
  await writeBinaryFileAtomic(selected, await edited.save());
  assert.equal((await PDFDocument.load(await readBinaryFile(selected))).getTitle(), 'Updated');
  assert.equal(await saveFileDialog(selected), uri);
  assert.equal(proposal, 'Plan.pdf');
  const cancellation = maakOpslagAnnulering();
  cancellation.annuleer();
  await assert.rejects(writeBinaryFileAtomic(uri, Uint8Array.of(1), { annulering: cancellation }), /cancelled/i);
  assert.equal(writes, 1);
});
