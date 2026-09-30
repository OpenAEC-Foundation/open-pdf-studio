import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfjsRecord } from './pdfjs-record.js';

test('PDF.js 6 form catalog remains usable as UI record and releases worker', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage();
  const field = doc.getForm().createTextField('Customer'); field.setText('Ada'); field.addToPage(page);
  const loading = getDocument({ data: await doc.save() });
  try {
    const pdf = await loading.promise;
    assert.equal(pdf.loadingTask, loading);
    const fields = await pdf.getFieldObjects();
    assert.ok(fields instanceof Map);
    assert.equal(pdfjsRecord(fields).Customer.find(f => f.type === 'text').value, 'Ada');
    assert.equal(fields.get('Customer').find(f => f.type === 'text').value, 'Ada');
  } finally { await loading.destroy(); }
});
test('PDF.js actions and absent catalogs normalize without changing original Map', () => {
  const actions = new Map([['Blur', ['checkDate();']]]);
  assert.deepEqual(pdfjsRecord(actions), { Blur: ['checkDate();'] });
  assert.ok(actions instanceof Map);
  assert.equal(pdfjsRecord(null), null);
});
