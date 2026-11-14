// Exercise browser fontkit (including its Buffer implementation), not Node's.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFDict, decodePDFRawStream } from 'pdf-lib';
const bytes = await readFile(new URL('./font-native-tests/fixtures/odd-glyphs.ttf', import.meta.url));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-font-browser-'));
let server, browser;
try {
  server = await createServer({ root: process.cwd(), cacheDir: cache, server: { host: '127.0.0.1', port: 18366, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/__font-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Font embedding test</title>' }));
  await page.goto('http://127.0.0.1:18366/__font-probe');
  const result = await page.evaluate(async input => {
    const { PDFDocument } = await import('/node_modules/pdf-lib/dist/pdf-lib.esm.js');
    const { maakSysteemFontKeten } = await import('/js/pdf/saver/systeem-fonts.js');
    const doc = await PDFDocument.create();
    const requests = [];
    const chain = maakSysteemFontKeten(doc, {
      zoek: async () => ({ pad: '/fonts/test.ttc', gezicht: 1, exact: true, insluitbaar: true, subset: true }),
      laadBytes: async (pad, gezicht) => { requests.push({pad, gezicht}); return new Uint8Array(input); },
    });
    const f = await chain.voor('Odd Glyphs');
    if (!f) throw new Error('Font embedding failed');
    const cid = parseInt(f.font.encodeText('A').asString(), 16);
    doc.addPage().drawText('A A', { font: f.font });
    return { bytes: Array.from(await doc.save()), cid, requests };
  }, Array.from(bytes));
  assert.deepEqual(errors, []);
  assert.deepEqual(result.requests, [{ pad: '/fonts/test.ttc', gezicht: 1 }]);
  const doc = await PDFDocument.load(new Uint8Array(result.bytes));
  const fd = doc.context.enumerateIndirectObjects().map(([, o]) => o).find(o => o instanceof PDFDict && o.has(PDFName.of('FontFile2')));
  assert.ok(fd);
  const subset = fontkit.create(decodePDFRawStream(fd.lookup(PDFName.of('FontFile2'))).decode());
  assert.deepEqual(subset.getGlyph(result.cid).path.commands, fontkit.create(bytes).glyphForCodePoint(65).path.commands);
  console.log('PASS: browser embeds selected face; odd glyph outlines survive subsetting');
} finally {
  await browser?.close();
  await server?.close();
  await rm(cache, { recursive: true, force: true });
}
