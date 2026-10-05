import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyInPlaceTextEdits } from '../pdf/saver/text-edit-inplace.js';
import { embedMcpTextFont } from './mcp-text-font.js';

const latin = readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

test('subset-font replacement removes old glyphs, embeds missing glyphs and keeps vector artwork', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(latin).buffer });
  try {
    const source = await PDFDocument.create();
    source.registerFontkit(fontkit);
    const subset = await source.embedFont(latin, { subset: true });
    const sourcePage = source.addPage([595, 842]);
    sourcePage.drawRectangle({ x: 50, y: 650, width: 200, height: 100, borderColor: rgb(1, 0, 0), borderWidth: 1 });
    sourcePage.drawText('Hello', { x: 72, y: 700, size: 12, font: subset });
    const beforeBytes = await source.save();
    const lib = await PDFDocument.load(beforeBytes);
    const edit = {
      id: 'mcp-test', page: 1, originalText: 'Hello', newText: 'Été',
      pdfX: 72, pdfY: 700, pdfWidth: subset.widthOfTextAtSize('Hello', 12),
      fontSize: 12, lineSpacing: 14.4, numOriginalLines: 1,
      fontFamily: 'Helvetica', loadedFontName: 'subset', color: '#000000',
      originalLineInfo: [{ x: 72, y: 700, text: 'Hello', fontSize: 12, angle: 0 }],
      originalSpanTexts: [['Hello']],
    };
    const inPlace = applyInPlaceTextEdits(lib, lib.getPages(), [edit]).get(edit);
    assert.ok(inPlace && !inPlace.needsCover, 'source text is safely removable');
    assert.equal(inPlace.encodeRun('Été', 0, 12, { bold: false, italic: false, baseBold: false, baseItalic: false }), null);
    const fallback = await embedMcpTextFont(lib, 'Été');
    assert.equal(fallback.name, 'LiberationSans-Regular');
    lib.getPage(0).drawText('Été', { x: 72, y: 700, size: 12, font: fallback.font });
    const afterBytes = await lib.save();
    const inspect = async bytes => {
      const pdf = await getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false }).promise;
      try {
        const page = await pdf.getPage(1);
        return { text: (await page.getTextContent()).items.map(item => item.str).join(''),
          paths: (await page.getOperatorList()).fnArray.filter(op => op === OPS.constructPath).length };
      } finally { await pdf.loadingTask.destroy(); }
    };
    const before = await inspect(beforeBytes), after = await inspect(afterBytes);
    assert.match(before.text, /Hello/);
    assert.match(after.text, /Été/);
    assert.ok(!after.text.includes('Hello'));
    assert.equal(after.paths, before.paths);
  } finally { globalThis.fetch = oldFetch; }
});
