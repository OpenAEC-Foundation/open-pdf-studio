import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { embedOcrFont } from './ocr-text-layer.js';

const fontBytes = readFileSync(new URL('../../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

test('lettertype insluiten werkt ook bij een tweede document in dezelfde sessie', async () => {
  for (let i = 0; i < 2; i++) {
    const doc = await PDFDocument.create();
    const font = await embedOcrFont(doc, fontBytes);
    doc.addPage().drawText('ocr', { font, size: 10 });
    const bytes = await doc.save();
    assert.ok(bytes.length > 0, `document ${i + 1} opgeslagen`);
  }
});
