import test from 'node:test';
import assert from 'node:assert/strict';

import {
  percentile,
  summarizeRuns,
  extractZoomPhases,
  aggregatePeak,
  hasStableZoomEvidence,
  hasRenderCompletion,
  totalSuccessfulZoomMs,
} from './vector-zoom-metrics.mjs';
import { parseArgs } from './vector-zoom-benchmark.mjs';

test('percentile selects deterministic nearest-rank values', () => {
  const values = [900, 100, 700, 300, 500];
  assert.equal(percentile(values, 0.5), 500);
  assert.equal(percentile(values, 0.95), 900);
  assert.equal(percentile([], 0.5), null);
});

test('summarizeRuns ignores failed runs and reports median and p95', () => {
  const summary = summarizeRuns([
    { visibleSharpMs: 100 },
    { visibleSharpMs: null },
    { visibleSharpMs: 300 },
    { visibleSharpMs: 200 },
  ]);

  assert.deepEqual(summary, {
    count: 3,
    medianMs: 200,
    p95Ms: 300,
  });
});

test('extractZoomPhases retains explicit timings and leaves absent phases null', () => {
  const sinceMs = 1_000;
  const result = extractZoomPhases([
    { t: 900, text: '[prog] oude run klaar' },
    { t: 1_010, text: '[prog-perf] @50 run-start 4096x2896 12 tegels p1 scale=3.000' },
    { t: 1_130, text: '[prog-perf] @170 tegel-invoke 1024x1024 120ms (4.0MB)' },
    { t: 1_145, text: '[prog] eerste tegel @135ms' },
    { t: 1_190, text: '[prog-perf] @230 publish createImageBitmap 4096x2896 45ms' },
    { t: 1_510, text: '[prog] klaar 12 tegels @500ms' },
  ], sinceMs);

  assert.equal(result.firstTileMs, 135);
  assert.equal(result.completeMs, 500);
  assert.equal(result.firstPublishMs, 45);
  assert.equal(result.maxTileInvokeMs, 120);
  assert.equal(result.bitmapOrchestratorMs, null);
  assert.equal(result.raw.length, 5);
});

test('extractZoomPhases does not turn missing timings into zeroes', () => {
  const result = extractZoomPhases([
    { t: 2_000, text: '[bo] render gestart' },
  ], 2_000);

  assert.deepEqual(result, {
    firstTileMs: null,
    completeMs: null,
    firstPublishMs: null,
    maxTileInvokeMs: null,
    bitmapOrchestratorMs: null,
    raw: [{ t: 2_000, text: '[bo] render gestart' }],
  });
});

test('parseArgs preserves PDF paths with spaces and commas', () => {
  const pdf = 'C:/PDF-bestanden/MV-03 Mechanische ventilatie, ontwerp.pdf';
  const args = parseArgs([
    '--pdf', pdf,
    '--label', 'baseline-mv03',
    '--page', '2',
    '--runs', '7',
    '--output', 'C:/metingen/vector zoom',
  ]);

  assert.deepEqual(args, {
    pdf,
    label: 'baseline-mv03',
    page: 2,
    runs: 7,
    output: 'C:/metingen/vector zoom',
  });
});

test('parseArgs defaults to five runs and rejects a missing PDF', () => {
  assert.deepEqual(parseArgs(['--pdf', 'C:/test.pdf']), {
    pdf: 'C:/test.pdf',
    label: 'baseline',
    page: 1,
    runs: 5,
    output: null,
  });
  assert.throws(() => parseArgs([]), /--pdf is required/);
});

test('aggregatePeak isolates the measured app and its workers', () => {
  const samples = [{
    processes: [
      { Id: 10, ParentProcessId: 1, ProcessName: 'open-pdf-studio', rssMb: 500 },
      { Id: 11, ParentProcessId: 10, ProcessName: 'pdfium-worker', rssMb: 300 },
      { Id: 12, ParentProcessId: 10, ProcessName: 'pdfium-worker', rssMb: 200 },
      { Id: 20, ParentProcessId: 2, ProcessName: 'open-pdf-studio', rssMb: 900 },
      { Id: 21, ParentProcessId: 20, ProcessName: 'pdfium-worker', rssMb: 800 },
    ],
  }];

  assert.deepEqual(aggregatePeak(samples, 10), {
    mainPeakMb: 500,
    workerPeakMb: 300,
    workerTotalPeakMb: 500,
  });
});

test('hasStableZoomEvidence accepts completion, matching sharp tile, or a quiet cache hit', () => {
  assert.equal(hasStableZoomEvidence({
    scale: 1,
    completionSeen: true,
    quietForMs: 800,
    viewport: {
      viewport: { pageW: 3_370, pageH: 2_384 },
      tile: null,
    },
  }), true);
  assert.equal(hasStableZoomEvidence({
    scale: 1.5,
    completionSeen: false,
    quietForMs: 800,
    viewport: {
      devicePixelRatio: 1.5,
      tile: { meta: { zoom: 1.5, renderScale: 2.25 } },
    },
  }), true);
  assert.equal(hasStableZoomEvidence({
    scale: 1,
    completionSeen: false,
    quietForMs: 1_500,
    viewport: {
      viewport: { pageW: 3_370, pageH: 2_384 },
      tile: null,
    },
  }), true);
  assert.equal(hasStableZoomEvidence({
    scale: 1,
    completionSeen: true,
    quietForMs: 8_000,
    viewport: {
      devicePixelRatio: 1.5,
      viewport: { pageW: 3_370, pageH: 2_384 },
      tile: null,
    },
  }), false);
  assert.equal(hasStableZoomEvidence({
    scale: 1.5,
    completionSeen: false,
    quietForMs: 8_000,
    viewport: {
      viewport: { pageW: 3_370, pageH: 2_384 },
      tile: null,
    },
  }), false);
  assert.equal(hasStableZoomEvidence({
    scale: 2,
    completionSeen: true,
    quietForMs: 8_000,
    viewport: {
      viewport: { pageW: 3_370, pageH: 2_384 },
      tile: { meta: { zoom: 1.5 } },
    },
  }), false);
  assert.equal(hasStableZoomEvidence({
    scale: 1.5,
    completionSeen: false,
    quietForMs: 8_000,
    viewport: {
      devicePixelRatio: 1.5,
      viewport: { pageW: 3_370, pageH: 2_384 },
      tile: { meta: { zoom: 1.5 } },
    },
  }), false);
  assert.equal(hasStableZoomEvidence({
    scale: 2,
    completionSeen: false,
    quietForMs: 800,
    viewport: {
      devicePixelRatio: 1.5,
      viewport: { pageW: 3_370, pageH: 2_384 },
      tile: { meta: { zoom: 1.5, renderScale: 4 } },
    },
  }), true);
  assert.equal(hasStableZoomEvidence({
    scale: 3,
    completionSeen: false,
    quietForMs: 900,
    viewport: { tile: { meta: { zoom: 1.5 } } },
  }), false);
});

test('hasStableZoomEvidence rejects a quiet viewport with a stale tile from another zoom', () => {
  assert.equal(hasStableZoomEvidence({
    scale: 3,
    completionSeen: false,
    quietForMs: 8_000,
    viewport: { tile: { meta: { zoom: 1.5 } } },
  }), false);
});

test('totalSuccessfulZoomMs rejects failed or visually stale zoom runs', () => {
  const valid = [
    { scale: 1, ok: true, visibleSharpMs: 100, screenshot: { ok: true, sha256: 'base' } },
    { scale: 1.5, ok: true, visibleSharpMs: 200, screenshot: { ok: true, sha256: 'zoom-a' } },
    { scale: 2, ok: true, visibleSharpMs: 300, screenshot: { ok: true, sha256: 'zoom-b' } },
    { scale: 3, ok: true, visibleSharpMs: 400, screenshot: { ok: true, sha256: 'zoom-c' } },
  ];
  assert.equal(totalSuccessfulZoomMs(valid), 900);

  const failed = structuredClone(valid);
  failed[2].ok = false;
  failed[2].visibleSharpMs = null;
  assert.equal(totalSuccessfulZoomMs(failed), null);

  const stale = structuredClone(valid);
  stale.slice(1).forEach((zoom) => {
    zoom.screenshot.sha256 = 'same-blank-frame';
  });
  assert.equal(totalSuccessfulZoomMs(stale), null);
});

test('hasRenderCompletion herkent alleen een afgeronde render of cache-hit', () => {
  assert.equal(hasRenderCompletion([
    { text: '[prog] eerste tegel @500ms' },
    { text: '[prog] klaar @2400ms (12 tegels)' },
  ]), true);
  assert.equal(hasRenderCompletion([
    { text: '[tile-orch] cached visible tile' },
  ]), true);
  assert.equal(hasRenderCompletion([
    { text: '[prog-guard] zware pagina → progressief pad' },
  ]), false);
});
