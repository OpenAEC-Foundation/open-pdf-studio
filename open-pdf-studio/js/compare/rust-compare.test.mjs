// Compare in the PDFium worker (#465): request shape, answer decoding, which
// sides can go to the worker, and the fallback to the JS pipeline.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRustRequest, decodeRustResponse, rustSideFile, createRustCompare, CLUSTER_FIELDS } from './rust-compare.js';
import { registerCompareSource, clearCompareSources } from './compare-sources.js';
import { detectionParams } from './detect-plan.js';

// Answer as compare_pixel_pair packs it (src-tauri/src/lib.rs).
function pack(head, clusters) {
  const json = new TextEncoder().encode(JSON.stringify({ ...head, clusters: clusters.length }));
  const pad = (8 - ((4 + json.length) % 8)) % 8;
  const buf = new ArrayBuffer(4 + json.length + pad + clusters.length * CLUSTER_FIELDS * 8);
  new DataView(buf).setUint32(0, json.length, true);
  new Uint8Array(buf, 4, json.length).set(json);
  const f = new Float64Array(buf, 4 + json.length + pad, clusters.length * CLUSTER_FIELDS);
  clusters.forEach((c, i) => f.set(c, i * CLUSTER_FIELDS));
  return buf;
}

test('the request carries the sides, the resolution and the pixel parameters in worker field names', () => {
  const params = detectionParams('line', 0.2);
  const base = {
    old: { path: 'C:/a.pdf', expectLen: 10 }, new: { path: 'C:/b.pdf', expectLen: 20 }, oldIndex: 0, newIndex: 2,
    oldSize: { width: 1190.5, height: 841.9 }, newSize: { width: 1190.5, height: 841.9 }, pxPerPt: 1.76, params,
  };
  const manual = buildRustRequest({ ...base, alignment: { dx: 1, dy: 2, rotation: 0, scale: 1 } });
  assert.deepEqual(manual.old, { path: 'C:/a.pdf', page_index: 0, width_pt: 1190.5, height_pt: 841.9, expect_len: 10 });
  assert.equal(manual.new.page_index, 2);
  assert.equal(manual.threshold, params.threshold);
  assert.deepEqual(manual.params, { tolerance_px: params.tolerancePx, min_area_px: params.minAreaPx, merge_px: params.mergePx, noise_px: params.noisePx });
  assert.deepEqual(manual.alignment, { dx: 1, dy: 2, rotation: 0, scale: 1 });
  assert.equal(manual.auto_align, undefined);
  assert.equal(manual.skip_detect, false);
  const auto = buildRustRequest({ ...base, autoAlign: true, measureRatio: 0.5, skipDetect: true });
  assert.deepEqual(auto.auto_align, { measure_ratio: 0.5 });
  assert.equal(auto.alignment, undefined);
  assert.equal(auto.skip_detect, true);
  assert.equal(buildRustRequest({ ...base, autoAlign: true, measureRatio: null }).auto_align.measure_ratio, null);
});

test('the answer decodes into the clusters detectMaskChanges returns', () => {
  for (const extra of ['', 'x', 'xyz1234']) {
    const head = { ok: true, old_px: 1.5, truncated: false, align_info: null, pad: extra };
    const buf = pack(head, [[0, 10, 20, 30, 40, 99, 1.5, 2.5, 3.5, 4.5], [2, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    const { head: h, clusters } = decodeRustResponse(buf);
    assert.equal(h.old_px, 1.5);
    assert.deepEqual(clusters[0], { type: 'added', x: 10, y: 20, width: 30, height: 40, pixelCount: 99, old: { x: 1.5, y: 2.5, width: 3.5, height: 4.5 } });
    assert.equal(clusters[1].type, 'modified');
    // Also from a view on a larger buffer.
    const big = new Uint8Array(buf.byteLength + 16);
    big.set(new Uint8Array(buf), 8);
    assert.deepEqual(decodeRustResponse(big.subarray(8, 8 + buf.byteLength)).clusters, clusters);
  }
  assert.deepEqual(decodeRustResponse(pack({ ok: true }, [])).clusters, []);
});

test('only sides with a file of their own go to the worker, with the length the app holds', () => {
  const cached = new Map([['C:\\work\\plan.pdf', new Uint8Array(123)], ['/home/u/plan.pdf', new Uint8Array(7)]]);
  const deps = { cachedBytes: (p) => cached.get(p) };
  assert.deepEqual(rustSideFile('C:\\work\\plan.pdf', deps), { path: 'C:\\work\\plan.pdf', expectLen: 123 });
  assert.deepEqual(rustSideFile('/home/u/plan.pdf', deps), { path: '/home/u/plan.pdf', expectLen: 7 });
  assert.equal(rustSideFile('C:\\work\\other.pdf', deps), null, 'no bytes in the app');
  assert.equal(rustSideFile('Untitled-1', deps), null, 'not a disk path');
  clearCompareSources();
  const file = registerCompareSource({ kind: 'file', path: 'D:\\rev\\A.pdf', bytes: new Uint8Array(55) });
  const prev = registerCompareSource({ kind: 'previous', path: 'C:\\work\\plan.pdf', bytes: new Uint8Array(99) });
  assert.deepEqual(rustSideFile(file, deps), { path: 'D:\\rev\\A.pdf', expectLen: 55 });
  assert.equal(rustSideFile(prev, deps), null, 'the version before the last save only exists in memory');
  clearCompareSources();
});

test('the worker path falls back to JS: off outside Tauri, warns once on a failure, stays off when disabled', async () => {
  const warnings = [];
  let answer = null;
  let calls = 0;
  const rust = createRustCompare({
    inTauri: () => true,
    cachedBytes: () => null,
    warn: (...a) => warnings.push(a.join(' ')),
    call: async (cmd, args) => {
      calls++;
      assert.equal(cmd, 'compare_pixel_pair');
      assert.ok(args.request);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  assert.equal(createRustCompare({ inTauri: () => false, call: null, cachedBytes: () => null }).usable(), false);
  assert.equal(rust.usable(), true);

  answer = pack({ ok: true, old_px: 2 }, [[1, 0, 0, 5, 5, 25, 0, 0, 5, 5]]);
  assert.equal((await rust.run({})).clusters[0].type, 'removed');

  // No pool yet: JS this time, silently, and the next pair tries again.
  answer = new Error('COMPARE_RUST_UNAVAILABLE: worker pool not ready');
  assert.equal(await rust.run({}), null);
  assert.equal(warnings.length, 0);
  assert.equal(rust.usable(), true);

  // A real failure: one warning, JS, and the worker is tried again later.
  answer = new Error('COMPARE_RUST_FAILED: PDF_COMPARE_STALE: file changed');
  assert.equal(await rust.run({}), null);
  assert.equal(await rust.run({}), null);
  assert.equal(warnings.length, 1);
  assert.equal(rust.usable(), true);

  // Switched off with OPDS_RUST_COMPARE=0: JS for the rest of the session.
  answer = new Error('COMPARE_RUST_DISABLED');
  assert.equal(await rust.run({}), null);
  assert.equal(rust.usable(), false);
  assert.equal(warnings.length, 1);
  assert.equal(calls, 5);
});
