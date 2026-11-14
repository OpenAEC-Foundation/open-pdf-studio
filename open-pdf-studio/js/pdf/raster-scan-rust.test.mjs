import test from 'node:test';
import assert from 'node:assert/strict';
import { createRasterScan, rasterFile, decodeSymbolAnswer, decodeFormAnswer, searchSymbolsInWorker } from './raster-scan-rust.js';

const deps = (call, extra = {}) => ({ inTauri: () => true, mobile: () => false, call, cachedBytes: () => new Uint8Array(10), warn: () => {}, ...extra });

test('only a file on disk with the bytes the app holds goes to the worker', () => {
  const bytes = (p) => (p === 'C:/a.pdf' ? new Uint8Array(1234) : null);
  assert.deepEqual(rasterFile('C:/a.pdf', bytes), { path: 'C:/a.pdf', expectLen: 1234 });
  assert.deepEqual(rasterFile('/home/x/a.pdf', () => new Uint8Array(5)), { path: '/home/x/a.pdf', expectLen: 5 });
  assert.equal(rasterFile('C:/other.pdf', bytes), null, 'no bytes held');
  assert.equal(rasterFile('a.pdf', () => new Uint8Array(5)), null, 'not an absolute path');
  assert.equal(rasterFile(null, bytes), null);
});

test('the worker path is off in the browser and on mobile', () => {
  assert.equal(createRasterScan(deps(async () => ({}))).usable(), true);
  assert.equal(createRasterScan(deps(async () => ({}), { inTauri: () => false })).usable(), false);
  assert.equal(createRasterScan(deps(async () => ({}), { mobile: () => true })).usable(), false);
});

test('a symbol answer decodes to the matcher result', () => {
  const out = decodeSymbolAnswer({
    template: { width: 2, height: 1, pixels: '10' },
    matches: [[10, 20, 24, 24, 0.875, 90, 1.25]],
    truncated: true,
  });
  assert.deepEqual(out, {
    template: { width: 2, height: 1, pixels: '10' },
    matches: [{ x: 10, y: 20, width: 24, height: 24, score: 0.875, rotation: 90, scale: 1.25 }],
    truncated: true,
  });
});

test('a form answer decodes to the shapes detectFormShapes returns', () => {
  const shapes = decodeFormAnswer({ shapes: [[40, 14, 260, 16, 0, 0.55, 0], [40, 70, 14, 14, 1, 0.7, 1], [40, 100, 14, 14, 2, 0.7, 1]] });
  assert.deepEqual(shapes, [
    { x: 40, y: 14, width: 260, height: 16, type: 'text', confidence: 0.55, source: 'writing-line' },
    { x: 40, y: 70, width: 14, height: 14, type: 'checkbox', confidence: 0.7, source: 'empty-outline' },
    { x: 40, y: 100, width: 14, height: 14, type: 'radio', confidence: 0.7, source: 'empty-outline' },
  ]);
});

test('a request names the operation and carries the raster', async () => {
  const calls = [];
  const scan = createRasterScan(deps(async (cmd, args) => { calls.push([cmd, args]); return { shapes: [] }; }));
  const raster = { path: 'C:/a.pdf', page_index: 0, width: 100, height: 80, rotation: 270, expect_len: 10 };
  assert.deepEqual(await scan.form({ raster, scale: 1.5 }), []);
  assert.deepEqual(calls, [['raster_scan_page', { op: 'form_shapes', request: { raster, scale: 1.5 } }]]);
});

test('an error the JS functions give too is passed on, not retried in JS', async () => {
  for (const code of ['TEMPLATE_BOUNDS', 'TEMPLATE_NEEDS_CONTRAST', 'INVALID_TOLERANCE', 'INVALID_IMAGE', 'INVALID_RASTER']) {
    const scan = createRasterScan(deps(async () => { throw `SCAN_RUST_FAILED: ${code}`; }));
    await assert.rejects(scan.symbol({}), (e) => e instanceof Error && e.message === code);
  }
});

test('any other failure gives null (the JS path) with one warning', async () => {
  const warnings = [];
  const scan = createRasterScan(deps(async () => { throw new Error('SCAN_RUST_FAILED: PDFium scan render: boom'); }, { warn: (...a) => warnings.push(a) }));
  assert.equal(await scan.symbol({}), null);
  assert.equal(await scan.form({}), null);
  assert.equal(warnings.length, 1);
  assert.equal(scan.usable(), true, 'a single failure does not switch the path off');
});

test('switched off or an app without the command: off for the session, silently', async () => {
  for (const msg of ['SCAN_RUST_DISABLED', 'Command raster_scan_page not found']) {
    const warnings = [];
    const scan = createRasterScan(deps(async () => { throw msg; }, { warn: (...a) => warnings.push(a) }));
    assert.equal(await scan.form({}), null);
    assert.equal(scan.usable(), false);
    assert.equal(warnings.length, msg === 'SCAN_RUST_DISABLED' ? 0 : 1);
  }
});

test('a pool that is still starting or a changed file is quiet and tried again', async () => {
  for (const msg of ['SCAN_RUST_UNAVAILABLE: worker pool not ready', 'SCAN_RUST_UNAVAILABLE: PDF_WORKER_UNAVAILABLE', 'SCAN_RUST_FAILED: PDF_SCAN_STALE: a.pdf has 1 bytes on disk, the app holds 2']) {
    const warnings = [];
    const scan = createRasterScan(deps(async () => { throw msg; }, { warn: (...a) => warnings.push(a) }));
    assert.equal(await scan.symbol({}), null);
    assert.equal(warnings.length, 0, msg);
    assert.equal(scan.usable(), true);
  }
});

// The search over pages: the template page first (crop, and search there when
// it is one of the pages), then the other pages with the returned template.
function fakeScan(answers) {
  const requests = [];
  return {
    requests,
    async symbol(request) {
      requests.push(request);
      const a = answers[request.raster.page_index];
      return a === null ? null : { template: { width: 2, height: 1, pixels: '10' }, matches: a || [], truncated: false };
    },
  };
}
const rasterFor = async (page) => ({ path: 'C:/a.pdf', page_index: page - 1, width: 100, height: 80, rotation: 0, expect_len: 10 });

test('the template page is asked first and searched when it is one of the pages', async () => {
  const scan = fakeScan({ 1: [{ x: 1 }], 2: [{ x: 2 }] });
  const done = [];
  const out = await searchSymbolsInWorker(scan, {
    rasterFor, templatePage: 2, crop: [1, 2, 24, 24], pages: [3, 2, 3], threshold: 0.8, rotations: [0, 90], scales: [1], onPage: (p) => done.push(p),
  });
  assert.deepEqual(scan.requests.map((r) => [r.raster.page_index, !!r.crop, !!r.template, r.search]), [[1, true, false, true], [2, false, true, true]]);
  assert.deepEqual(scan.requests[0].crop, [1, 2, 24, 24]);
  assert.deepEqual(scan.requests[1].template, { width: 2, height: 1, pixels: '10' });
  assert.deepEqual([scan.requests[1].threshold, scan.requests[1].rotations, scan.requests[1].scales], [0.8, [0, 90], [1]]);
  assert.deepEqual([...out.keys()], [3, 2], 'pages in the order asked, once each');
  assert.deepEqual(out.get(2).matches, [{ x: 1 }]);
  assert.deepEqual(out.get(3).matches, [{ x: 2 }]);
  assert.deepEqual(done, [3, 2]);
});

test('a template page that is not searched is only cropped', async () => {
  const scan = fakeScan({ 0: [{ x: 9 }], 4: [] });
  const out = await searchSymbolsInWorker(scan, { rasterFor, templatePage: 1, crop: [0, 0, 10, 10], pages: [5], threshold: 0.75, rotations: [0], scales: [1] });
  assert.deepEqual(scan.requests.map((r) => [r.raster.page_index, r.search]), [[0, false], [4, true]]);
  assert.deepEqual([...out.keys()], [5]);
});

test('one failing page gives null: the whole search runs in JS', async () => {
  const scan = fakeScan({ 0: [], 1: null });
  assert.equal(await searchSymbolsInWorker(scan, { rasterFor, templatePage: 1, crop: [0, 0, 10, 10], pages: [1, 2, 3], threshold: 0.75, rotations: [0], scales: [1] }), null);
  assert.equal(scan.requests.length, 2, 'stops at the failure');
});

test('an abort between pages stops the search', async () => {
  const scan = fakeScan({ 0: [], 1: [], 2: [] });
  const controller = new AbortController();
  const run = searchSymbolsInWorker(scan, {
    rasterFor, templatePage: 1, crop: [0, 0, 10, 10], pages: [1, 2, 3], threshold: 0.75, rotations: [0], scales: [1],
    signal: controller.signal, onPage: () => controller.abort(),
  });
  await assert.rejects(run, (e) => e.name === 'AbortError');
  assert.equal(scan.requests.length, 1);
});

// match(): the app renders, Rust matches on that same raster.
const { encodeSymbolMatch, decodeMatchAnswer } = await import('./raster-scan-rust.js');
const { matchSymbols } = await import('../search/symbol-matcher.js');

test('the match body is the template followed by the image, sizes in the header', () => {
  const image = { width: 3, height: 2, pixels: new Uint8Array([0, 1, 0, 1, 1, 0]) };
  const template = { width: 2, height: 1, pixels: new Uint8Array([1, 0]) };
  const { body, header } = encodeSymbolMatch(image, template, { threshold: 0.8, rotations: [0, 90], scales: [1, 1.25] });
  assert.deepEqual([...body], [1, 0, 0, 1, 0, 1, 1, 0]);
  assert.deepEqual(JSON.parse(header), { width: 3, height: 2, templateWidth: 2, templateHeight: 1, threshold: 0.8, rotations: [0, 90], scales: [1, 1.25] });
  assert.deepEqual(JSON.parse(encodeSymbolMatch(image, template).header).rotations, [0], 'defaults of matchSymbols');
});

test('a match call sends a raw body and decodes to what matchSymbols returns', async () => {
  const calls = [];
  const scan = createRasterScan(deps(async (...a) => { calls.push(a); return { matches: [[4, 5, 6, 6, 0.9, 0, 1]], truncated: false, ms: 1 }; }));
  const image = { width: 3, height: 2, pixels: new Uint8Array(6) };
  const template = { width: 2, height: 1, pixels: new Uint8Array([1, 0]) };
  const out = await scan.match(image, template, { threshold: 0.75, rotations: [0], scales: [1] });
  assert.deepEqual(out, { matches: [{ x: 4, y: 5, width: 6, height: 6, score: 0.9, rotation: 0, scale: 1 }], truncated: false });
  assert.equal(calls[0][0], 'symbol_match_raster');
  assert.ok(calls[0][1] instanceof Uint8Array && calls[0][1].length === 8);
  assert.equal(typeof calls[0][2].headers['x-opds-symbol'], 'string');
});

test('tolerances matchSymbols rejects never reach Rust: JS gives its own error', async () => {
  let called = 0;
  const scan = createRasterScan(deps(async () => { called++; return { matches: [] }; }));
  const image = { width: 20, height: 20, pixels: new Uint8Array(400) };
  const template = { width: 6, height: 6, pixels: new Uint8Array(36).fill(1) };
  for (const bad of [{ threshold: 0.4 }, { threshold: NaN }, { rotations: [] }, { rotations: [0, 90, 180, 270, 0] }, { scales: [1, 1, 1, 1] }, { scales: ['1'] }, { rotations: 'x' }]) {
    assert.equal(await scan.match(image, template, bad), null, JSON.stringify(bad));
    await assert.rejects(matchSymbols(image, template, { ...bad, yieldTask: async () => {} }), /INVALID_TOLERANCE/);
  }
  assert.equal(called, 0);
  // A rotation or scale that only transformTemplate rejects does reach Rust,
  // which answers with the same code.
  const refusing = createRasterScan(deps(async () => { throw 'SCAN_RUST_FAILED: INVALID_TOLERANCE'; }));
  await assert.rejects(refusing.match(image, template, { rotations: [45] }), /^Error: INVALID_TOLERANCE$/);
});

test('a failing match gives null, so the JS matcher runs', async () => {
  const scan = createRasterScan(deps(async () => { throw new Error('SCAN_RUST_FAILED: expected a raw body'); }));
  assert.equal(await scan.match({ width: 1, height: 1, pixels: new Uint8Array(1) }, { width: 1, height: 1, pixels: new Uint8Array(1) }), null);
  assert.deepEqual(decodeMatchAnswer({ matches: [], truncated: true, ms: 3 }), { matches: [], truncated: true });
});
