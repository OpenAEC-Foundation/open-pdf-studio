import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { joinExportPath } from './export-path.js';

const source = readFileSync(new URL('./exporter.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pageRangeSource = source.slice(source.indexOf('export function parsePageRange'),
  source.indexOf('/**\n * Render a single PDF page'))
  .replace('export function', 'function');
const parsePageRange = new Function(`${pageRangeSource}\nreturn parsePageRange;`)();
const imageExport = source.slice(source.indexOf('export async function exportAsImages'),
  source.indexOf('/**\n * Export pages as a rasterized PDF'))
  .replace('export async function', 'async function');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('page ranges reject malformed or partly invalid input instead of exporting different pages', () => {
  assert.deepEqual(parsePageRange('1-3, 5, 3', 6), [1, 2, 3, 5]);
  assert.deepEqual(parsePageRange('3 - 1', 6), [1, 2, 3]);
  for (const input of ['2abc', '1, 2abc', '1,,2', '1-2-3', '0', '7', '1,7', '9999999999999999999']) {
    assert.deepEqual(parsePageRange(input, 6), [], input);
  }
});

function harness() {
  const a = { pdfDoc: {}, filePath: 'a.pdf' }, b = { pdfDoc: {}, filePath: 'b.pdf' };
  let active = a;
  const writes = [], renders = [], messages = [];
  const tiffCalls = [], densityCalls = [];
  const deps = {
    getActiveDocument: () => active, isTauri: () => true,
    getPdfBaseName: () => 'a',
    saveFileDialog: async () => '/tmp/a_page0001.png',
    openFolderDialog: async () => '/tmp/pages',
    showLoading() {}, hideLoading() {},
    renderPageOffscreen: async (page, scale, options) => { renders.push({ page, scale, options }); return {}; },
    canvasToBytes: async () => new Uint8Array([1, 2, 3]),
    canvasToTiffBytes: (canvas, dpi) => { tiffCalls.push({ canvas, dpi }); return new Uint8Array([4, 5, 6]); },
    imageWithDpi: (bytes, format, dpi) => { densityCalls.push({ format, dpi }); return bytes; },
    joinExportPath,
    writeBinaryFileAtomic: async (path, bytes) => writes.push({ path, bytes }),
    showMessage: message => messages.push(message),
    exportChanged: () => new Error('Document changed during export'),
  };
  const exportAsImages = new Function(...Object.keys(deps), `${imageExport}\nreturn exportAsImages;`)(...Object.values(deps));
  return { deps, exportAsImages, writes, renders, messages, tiffCalls, densityCalls, switchToB: () => { active = b; } };
}

test('multi-page image export writes atomic files inside the chosen Linux folder', async () => {
  const h = harness();
  await h.exportAsImages({ pages: [1, 2], dpi: 300, includeAnnotations: false });
  assert.deepEqual(h.writes.map(write => write.path), ['/tmp/pages/a_page0001.png', '/tmp/pages/a_page0002.png']);
  assert.deepEqual(h.renders.map(render => render.scale), [300 / 72, 300 / 72]);
  assert.ok(h.renders.every(render => render.options.markeringen === false));
  assert.deepEqual(h.densityCalls, [{ format: 'png', dpi: 300 }, { format: 'png', dpi: 300 }]);
});

test('switching documents while rendering aborts before writing another document’s pixels', async () => {
  const h = harness(), entered = deferred(), release = deferred();
  h.deps.renderPageOffscreen = async () => { entered.resolve(); await release.promise; return {}; };
  const exportAsImages = new Function(...Object.keys(h.deps), `${imageExport}\nreturn exportAsImages;`)(...Object.values(h.deps));
  const exporting = exportAsImages({ pages: [1] });
  await entered.promise;
  h.switchToB(); release.resolve();
  assert.equal(await exporting, false);
  assert.deepEqual(h.writes, []);
  assert.equal(h.messages[0], 'Document changed during export');
});

test('TIFF export uses the chosen DPI and extension', async () => {
  const h = harness();
  await h.exportAsImages({ format: 'tiff', pages: [1, 2], dpi: 300 });
  assert.deepEqual(h.writes.map(write => write.path), ['/tmp/pages/a_page0001.tiff', '/tmp/pages/a_page0002.tiff']);
  assert.deepEqual(h.tiffCalls.map(call => call.dpi), [300, 300]);
  assert.deepEqual([...h.writes[0].bytes], [4, 5, 6]);
});

test('a document captured before module loading cannot export a later active tab', async () => {
  const h = harness();
  const selected = h.deps.getActiveDocument();
  h.switchToB();
  assert.equal(await h.exportAsImages({ pages: [1], doc: selected }), false);
  assert.deepEqual(h.renders, []);
  assert.deepEqual(h.writes, []);
  assert.equal(h.messages[0], 'Document changed during export');
});
