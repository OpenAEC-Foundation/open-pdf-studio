import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./office-export.js', import.meta.url), 'utf8');
const exportSource = source.slice(source.indexOf('export async function exportOffice'))
  .replace('export async function', 'async function');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness({ saveFileDialog = async name => `/tmp/${name}` } = {}) {
  const content = deferred();
  const extracting = deferred();
  const page = {
    rotate: 0,
    getViewport: () => ({ width: 595, height: 842 }),
    getTextContent: () => {
      extracting.resolve();
      return content.promise;
    },
  };
  const pdf = { numPages: 1, getPage: async () => page };
  const doc = { pdfDoc: pdf, filePath: 'source.pdf', fileName: 'source.pdf', textEdits: [], ocrResults: {} };
  const state = { documents: [doc] };
  const writes = [], messages = [], built = [];
  const deps = {
    state, getActiveDocument: () => state.documents[0],
    saveFileDialog,
    writeBinaryFileAtomic: async (path, bytes) => writes.push({ path, bytes }),
    showLoading() {}, hideLoading() {}, showMessage: message => messages.push(message),
    i18next: { t: key => key },
    textItemsToBoxes: () => [], recoverLayout: () => [], recoverDrawingLayout: () => [],
    buildOdt: () => new Uint8Array(), buildXlsx: () => new Uint8Array([1, 2, 3]),
    buildDocx: (pages, options) => { built.push({ pages, options }); return new Uint8Array([4, 5]); },
    pageImage: async () => new Uint8Array(),
  };
  const exportOffice = new Function(...Object.keys(deps), `${exportSource}\nreturn exportOffice;`)(...Object.values(deps));
  return { content, extracting, doc, state, writes, messages, built, exportOffice };
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

test('DOCX export writes a .docx with the recovered blocks and a page image when there is no text', async () => {
  const h = harness();
  const exporting = h.exportOffice({ format: 'docx', pages: [1, 1, 7] });
  h.content.resolve({ items: [] });
  assert.equal(await exporting, true);
  assert.equal(h.writes[0].path, '/tmp/source.docx');
  assert.deepEqual([...h.writes[0].bytes], [4, 5]);
  assert.equal(h.built.length, 1);
  assert.deepEqual(h.built[0].pages.map(p => p.number), [1]);
  assert.ok(h.built[0].pages[0].image instanceof Uint8Array);
  assert.equal(h.built[0].pages[0].emptyMessage, 'appMenu:exportPanel.officeNoText');
});

test('an unknown office format is refused before asking for a file', async () => {
  const h = harness();
  assert.equal(await h.exportOffice({ format: 'rtf', pages: [1] }), false);
  assert.deepEqual(h.writes, []);
});

for (const format of ['odt', 'xlsx']) {
  test(`${format} rejects text edits made while choosing the output file`, async () => {
    const dialog = deferred();
    const h = harness({ saveFileDialog: () => dialog.promise });
    const exporting = h.exportOffice({ format, pages: [1] });
    h.doc.textEdits.push({ baked: false, replacement: 'Updated' });
    dialog.resolve(`/tmp/source.${format}`);
    h.content.resolve({ items: [] });
    assert.equal(await exporting, false);
    assert.deepEqual(h.writes, []);
    assert.match(h.messages[0], /officeSaveEditsFirst/);
  });

  test(`${format} rejects text edits arriving during text extraction`, async () => {
    const h = harness();
    const exporting = h.exportOffice({ format, pages: [1] });
    await h.extracting.promise;
    h.doc.textEdits.push({ baked: false, replacement: 'Updated' });
    h.content.resolve({ items: [] });
    assert.equal(await exporting, false);
    assert.deepEqual(h.writes, []);
    assert.match(h.messages[0], /officeSaveEditsFirst/);
  });
}

test('already saved edits do not block Office export', async () => {
  const h = harness();
  h.doc.textEdits.push({ baked: true });
  const exporting = h.exportOffice({ format: 'xlsx', pages: [1] });
  h.content.resolve({ items: [] });
  assert.equal(await exporting, true);
  assert.equal(h.writes.length, 1);
});
