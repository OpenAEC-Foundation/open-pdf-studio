import assert from 'node:assert/strict';
import test from 'node:test';
import { pageTextSpans } from './mcp-page-text.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyInPlaceTextEdits } from '../pdf/saver/text-edit-inplace.js';

const viewport = { transform: [1, 0, 0, -1, 0, 842], scale: 1 };
const glyph = (str, x, y = 700, fontName = 'f1') => ({ str, width: 6, height: 12, transform: [12, 0, 0, 12, x, y], fontName });

test('glyph-positioned text becomes a readable line with a stable, document-bound id', () => {
  const spans = pageTextSpans([
    glyph('S', 20), glyph('u', 28), glyph('d', 36), glyph('d', 44), glyph('e', 52), glyph('n', 60),
    glyph('Change', 110),
  ], { f1: { fontFamily: 'Noto Sans' } }, viewport, 'doc-1', 2);
  assert.deepEqual(spans.map(s => s.text), ['Sudden', 'Change']);
  assert.equal(spans[0].id, 'doc-1:p2:i0-5');
  assert.deepEqual(spans[0].bbox, { x: 20, y: 130, width: 46, height: 12 });
  assert.equal(spans[0].fontFamily, 'Noto Sans');
  assert.equal(spans[0].pdfWidth, 46);
});

test('different baselines and fonts stay separate', () => {
  const spans = pageTextSpans([glyph('Hello', 20), glyph('World', 20, 680), glyph('Bold', 60, 680, 'f2')],
    {}, viewport, 'doc-2', 1);
  assert.deepEqual(spans.map(s => s.text), ['Hello', 'World', 'Bold']);
});

test('glyph-positioned PDF text can be merged and removed without losing neighbouring text', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([320, 200]);
  let x = 30;
  for (const char of 'Hello') {
    page.drawText(char, { x, y: 120, font, size: 12 });
    x += font.widthOfTextAtSize(char, 12);
  }
  page.drawText('Keep', { x: 30, y: 80, font, size: 12 });
  const bytes = await pdf.save();
  const rendered = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
  const renderedPage = await rendered.getPage(1);
  const content = await renderedPage.getTextContent();
  const spans = pageTextSpans(content.items, content.styles,
    renderedPage.getViewport({ scale: 1 }), 'doc-glyphs', 1);
  const hello = spans.find(span => span.text === 'Hello');
  assert.ok(hello, JSON.stringify(spans));
  const copy = await PDFDocument.load(bytes);
  const edit = { page: 1, originalText: hello.text, newText: 'Hoi',
    pdfX: hello.pdfAnchor.x, pdfY: hello.pdfAnchor.y,
    pdfWidth: hello.pdfWidth, fontSize: hello.fontSize,
    originalLineInfo: [{ x: hello.pdfAnchor.x, y: hello.pdfAnchor.y,
      text: hello.text, fontSize: hello.fontSize, angle: hello.rotation }],
    originalSpanTexts: [[hello.text]] };
  const removed = applyInPlaceTextEdits(copy, copy.getPages(), [edit]).get(edit);
  assert.ok(removed, 'every original glyph must be removed in place');
  const afterPdf = await getDocument({ data: Uint8Array.from(await copy.save()), useSystemFonts: true }).promise;
  const after = (await (await afterPdf.getPage(1)).getTextContent()).items.map(item => item.str).join('');
  assert.doesNotMatch(after, /Hello/);
  assert.match(after, /Keep/);
  await rendered.loadingTask.destroy();
  await afterPdf.loadingTask.destroy();
});
