// End-to-end probe against a running native app with --mcp-server.
// Run explicitly: node js/text/mcp-live.test.mjs [port]
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';

const endpoint = `http://127.0.0.1:${process.argv[2] || 9323}/mcp`;
let sequence = 0;
async function call(name, args = {}) {
  const reply = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence,
      method: 'tools/call', params: { name, arguments: args } }),
  });
  assert.equal(reply.status, 200, `${name} HTTP status`);
  const result = await reply.json();
  assert.equal(result.error, undefined, `${name}: ${JSON.stringify(result.error)}`);
  const output = JSON.parse(result.result.content.find(item => item.type === 'text').text);
  assert.equal(output.ok, true, `${name}: ${JSON.stringify(output)}`);
  return output;
}

async function whiteCoverPixels(pngBase64) {
  const { data, info } = await sharp(Buffer.from(pngBase64, 'base64'))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgbAt = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const [r, g, b] = rgbAt(x, y);
    if (r > 200 && b > r + 10 && b > g + 2) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  assert.ok(right > left && bottom > top, 'light-blue PDF background visible in screenshot');
  // The replaced word sits in the left half of this known fixture. The old
  // stale-view bug left a solid white cover over this part of the blue page.
  const width = right - left, height = bottom - top;
  let count = 0;
  for (let y = Math.floor(top + height * 0.22); y < top + height * 0.46; y++) {
    for (let x = Math.floor(left + width * 0.07); x < left + width * 0.46; x++) {
      const [r, g, b] = rgbAt(x, y);
      if (r > 248 && g > 248 && b > 248) count++;
    }
  }
  return count;
}

const dir = await mkdtemp(join(tmpdir(), 'opds-mcp-text-'));
const source = join(dir, 'source.pdf'), target = join(dir, 'translated.pdf');
const document = await PDFDocument.create();
const page = document.addPage([420, 250]);
const originalFont = await document.embedFont(StandardFonts.Helvetica);
page.drawRectangle({ x: 20, y: 20, width: 380, height: 210,
  borderWidth: 2, borderColor: rgb(0, 0, 1), color: rgb(0.9, 0.95, 1) });
const icon = await document.embedPng(await readFile(new URL('../../public/icon.png', import.meta.url)));
page.drawImage(icon, { x: 300, y: 120, width: 58, height: 58 });
page.drawText('Welcome', { x: 50, y: 160, size: 24,
  font: originalFont, color: rgb(0.6, 0.1, 0.2) });
await writeFile(source, await document.save());
async function artworkCounts(bytes) {
  const pdf = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const firstPage = await pdf.getPage(1);
  const ops = await firstPage.getOperatorList();
  return { vectors: ops.fnArray.filter(op => op === OPS.constructPath).length,
    images: ops.fnArray.filter(op => op === OPS.paintImageXObject).length };
}
const sourceArtwork = await artworkCounts(new Uint8Array(await readFile(source)));
assert.ok(sourceArtwork.images > 0);

await call('app_open_pdf', { path: source });
const extracted = await call('app_get_page_text', { page: 1 });
const span = extracted.spans.find(item => item.text === 'Welcome');
assert.ok(span, JSON.stringify(extracted.spans));
assert.equal(span.color?.toLowerCase(), '#991a33');
const replaced = await call('app_replace_text', {
  spanId: span.id, expectedText: span.text, newText: 'Bienvenue',
});
assert.equal(replaced.changed, true);
assert.equal(replaced.saved, false);
assert.equal(replaced.color?.toLowerCase(), '#991a33');
await call('app_save_pdf', { path: target });
const activeAfterSave = await call('app_get_page_text', { page: 1 });
assert.equal(activeAfterSave.filePath, target,
  'saving to a new path must retarget the active document');

const bytes = new Uint8Array(await readFile(target));
const pdfjs = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
const savedPage = await pdfjs.getPage(1);
const extractedText = (await savedPage.getTextContent()).items.map(item => item.str).join(' ');
assert.match(extractedText, /Bienvenue/);
assert.doesNotMatch(extractedText, /Welcome/);
const saved = await PDFDocument.load(bytes);
assert.equal(saved.getPageCount(), 1);
assert.equal(saved.getPages()[0].getWidth(), 420);
assert.deepEqual(await artworkCounts(bytes.slice()), sourceArtwork,
  'existing vector and image artwork must remain unchanged');
let coverPixels = Infinity;
for (let attempt = 0; attempt < 5; attempt++) {
  const view = await call('app_screenshot_view', { width: 1000 });
  coverPixels = await whiteCoverPixels(view.png_base64);
  if (coverPixels === 0) break;
  await new Promise(resolve => setTimeout(resolve, 200));
}
assert.equal(coverPixels, 0, 'live view must not leave a white text cover after saving');
console.log(JSON.stringify({ ok: true, source, target, extractedText,
  fontFallback: replaced.fontFallback, fontUsed: replaced.fontUsed, whiteCoverPixels: coverPixels }));
