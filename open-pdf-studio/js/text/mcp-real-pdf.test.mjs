// Optional live probe using the repository's mixed image/vector text PDF.
// Run against a detached native app: node js/text/mcp-real-pdf.test.mjs [port]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const source = resolve('../test pdf-bestanden/Originele bestanden/Tekst.pdf');
const target = join(tmpdir(), `opds-mcp-real-${process.pid}.pdf`);
const endpoint = `http://127.0.0.1:${process.argv[2] || 9323}/mcp`;
let id = 0;
async function call(name, args = {}) {
  const response = await fetch(endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call',
      params: { name, arguments: args } }) });
  const rpc = await response.json();
  assert.equal(rpc.error, undefined, `${name}: ${JSON.stringify(rpc.error)}`);
  const result = JSON.parse(rpc.result.content.find(item => item.type === 'text').text);
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}
async function pageFacts(path) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  const page = await pdf.getPage(1);
  const text = (await page.getTextContent()).items.map(item => item.str).join(' ');
  const ops = await page.getOperatorList();
  const images = ops.fnArray.filter(op => op === OPS.paintImageXObject).length;
  const vectors = ops.fnArray.filter(op => op === OPS.constructPath).length;
  await pdf.loadingTask.destroy();
  return { text, images, vectors };
}

const before = await pageFacts(source);
await call('app_open_pdf', { path: source });
const page = await call('app_get_page_text', { page: 1 });
const span = page.spans.find(item => item.text === 'Offerte:');
assert.ok(span, JSON.stringify(page.spans.slice(0, 10)));
const replacement = await call('app_replace_text', {
  spanId: span.id, expectedText: span.text, newText: 'Aanbod:',
  ...(span.color ? {} : { color: '#000000' }),
});
await call('app_save_pdf', { path: target });
const after = await pageFacts(target);
assert.match(after.text, /Aanbod:/);
assert.doesNotMatch(after.text, /Offerte:/);
assert.equal(after.images, before.images);
assert.equal(after.vectors, before.vectors);
console.log(JSON.stringify({ ok: true, target, replacement, before: {
  images: before.images, vectors: before.vectors }, after: {
  images: after.images, vectors: after.vectors } }));
