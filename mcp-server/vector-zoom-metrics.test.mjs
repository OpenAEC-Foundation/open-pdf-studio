import test from 'node:test';
import assert from 'node:assert/strict';

import {
  percentile,
  summarizeRuns,
  extractZoomPhases,
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
