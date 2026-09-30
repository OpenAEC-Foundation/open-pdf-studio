import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./office-export.js', import.meta.url), 'utf8');
const exportSource = source.slice(source.indexOf('export async function exportOffice'))
  .replace('export async function', 'async function');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness() {
  const content = deferred();
  const page = { rotate: 0, getViewport: () => ({ width: 595, height: 842 }), getTextContent: () => content.promise };
  const pdf = { numPages: 1, getPage: async () => page };
  const doc = { pdfDoc: pdf, filePath: 'source.pdf', fileName: 'source.pdf', textEdits: [], ocrResults: {} };
  const state = { documents: [doc] };
  const writes = [], messages = [];
  const deps = {
    state, getActiveDocument: () => state.documents[0],
    saveFileDialog: async () => '/tmp/source.xlsx',
    writeBinaryFileAtomic: async (path, bytes) => writes.push({ path, bytes }),
    showLoading() {}, hideLoading() {}, showMessage: message => messages.push(message),
    i18next: { t: key => key },
    textItemsToBoxes: () => [], recoverLayout: () => [], recoverDrawingLayout: () => [],
    buildOdt: () => new Uint8Array(), buildXlsx: () => new Uint8Array([1, 2, 3]),
    pageImage: async () => new Uint8Array(),
  };
  const exportOffice = new Function(...Object.keys(deps), `${exportSource}\nreturn exportOffice;`)(...Object.values(deps));
  return { content, doc, state, writes, messages, exportOffice };
}

test('closing the source document during Office extraction prevents an output file', async () => {
  const h = harness();
  const exporting = h.exportOffice({ format: 'xlsx', pages: [1] });
  h.state.documents.length = 0;
  h.content.resolve({ items: [] });
  assert.equal(await exporting, false);
  assert.deepEqual(h.writes, []);
  assert.match(h.messages[0], /documentChangedDuringExport/);
});

test('switching tabs leaves the captured source document exportable', async () => {
  const h = harness();
  const exporting = h.exportOffice({ format: 'xlsx', pages: [1] });
  h.state.documents.unshift({ fileName: 'another.pdf' });
  h.content.resolve({ items: [] });
  assert.equal(await exporting, true);
  assert.equal(h.writes[0].path, '/tmp/source.xlsx');
});
