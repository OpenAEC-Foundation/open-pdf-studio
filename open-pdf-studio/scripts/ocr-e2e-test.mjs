// OCR end-to-end verification (outside Tauri): loads a real PDF + real OCR
// output (from `cargo run --example ocr_poc -- <pdf> 0 > words.json`),
// writes the invisible searchable text layer with the ACTUAL js/pdf/saver
// module, saves it, then re-extracts the page's text with pdf.js to prove
// the words really are searchable/extractable from the saved file.
//
// Usage: node scripts/ocr-e2e-test.mjs <source-pdf> <words.json> <out-pdf>
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { writeOcrTextLayer, embedOcrFont } from '../js/pdf/saver/ocr-text-layer.js';

const [, , sourcePdf, wordsJson, outPdf] = process.argv;
if (!sourcePdf || !wordsJson || !outPdf) {
  console.error('usage: node scripts/ocr-e2e-test.mjs <source-pdf> <words.json> <out-pdf>');
  process.exit(1);
}

const words = JSON.parse(await readFile(wordsJson, 'utf8'));
const fontBytes = await readFile(new URL('../src-tauri/resources/fonts/NotoSansTC-Regular.ttf', import.meta.url));

const pdfBytes = await readFile(sourcePdf);
const pdfDoc = await PDFDocument.load(pdfBytes);
const [page] = pdfDoc.getPages();

const font = await embedOcrFont(pdfDoc, fontBytes);
writeOcrTextLayer(page, words, font);

const savedBytes = await pdfDoc.save();
await writeFile(outPdf, savedBytes);
console.log(`Saved ${outPdf} (${savedBytes.length} bytes, was ${pdfBytes.length})`);

// Re-extract text with pdf.js to prove it's actually searchable now.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: savedBytes }).promise;
const page1 = await doc.getPage(1);
const content = await page1.getTextContent();
const extracted = content.items.map((it) => it.str).join('');
console.log(`Extracted ${extracted.length} chars of text from the saved PDF's page 1.`);
console.log('Sample:', extracted.slice(0, 200));

// CJK words from Tesseract often come out as one box per character, so
// pdf.js's text-content extraction inserts whitespace between them (a
// documented, expected characteristic of Tesseract CJK OCR layers, not a
// bug) — compare with whitespace stripped instead of an exact substring.
const normalized = extracted.replace(/\s+/g, '');
const expectedSamples = ['建築工程合約', '承建商', '地基'];
const missing = expectedSamples.filter((s) => !normalized.includes(s));
if (missing.length > 0) {
  console.error('FAIL: missing expected text in extracted content:', missing);
  process.exit(1);
}
console.log('PASS: all expected Traditional Chinese phrases found in the saved, searchable PDF.');
