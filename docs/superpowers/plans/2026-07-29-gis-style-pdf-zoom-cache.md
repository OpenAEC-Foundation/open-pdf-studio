# GIS-style PDF Zoom Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse any cached sharp PDF region that covers the current viewport so repeated zoom-in and zoom-out settle sharply within 100 ms.

**Architecture:** Add a pure coverage-selection module and make the region cache search by PDF bounds and physical render scale instead of exact zoom keys. Measure this minimal behavior before changing tile granularity; only retained winners proceed to background coverage warming.

**Tech Stack:** JavaScript ES modules, Node test runner, Canvas `ImageBitmap`, Tauri region-render IPC, existing MCP zoom benchmark.

## Global Constraints

- A warm sharp transition at 150→300 and 300→150 has a median latency of at most 100 ms.
- The warm 150–300–150 sequence improves by at least 80%.
- A cold cache starts no more native region renders than the current route.
- Every production behavior starts with a failing test.
- A candidate without measured benefit is reverted before the next task.
- Preserve PDF painter order and render output.
- Do not push or create a pull request.

---

### Task 1: Coverage-aware tile selection

**Files:**
- Create: `open-pdf-studio/js/pdf/tile-coverage.js`
- Create: `open-pdf-studio/js/pdf/tile-coverage.test.mjs`
- Modify: `open-pdf-studio/js/pdf/tile-cache.js`
- Modify: `open-pdf-studio/package.json`

**Interfaces:**
- Consumes: cached entries with `regionMeta.regionXpt`, `regionYpt`, `regionWpt`, `regionHpt`, and `renderScale`.
- Produces: `findBestCoveringTile(entries, request)` and `tileCacheFindCovering(...)`.

- [ ] **Step 1: Write the failing coverage-selection tests**

```js
test('reuses a 300 percent tile when zooming out to a covered 150 percent viewport', () => {
  const entries = [{
    id: 'wide-high-res',
    regionMeta: {
      regionXpt: 0, regionYpt: 0, regionWpt: 1000, regionHpt: 700,
      renderScale: 4.5,
    },
  }];
  const hit = findBestCoveringTile(entries, {
    regionXpt: 100, regionYpt: 100, regionWpt: 800, regionHpt: 500,
    requiredScale: 2.25,
  });
  assert.equal(hit?.id, 'wide-high-res');
});

test('rejects a sharp tile that does not cover the complete viewport', () => {
  const entries = [{
    id: 'narrow',
    regionMeta: {
      regionXpt: 200, regionYpt: 100, regionWpt: 400, regionHpt: 500,
      renderScale: 8,
    },
  }];
  const hit = findBestCoveringTile(entries, {
    regionXpt: 100, regionYpt: 100, regionWpt: 800, regionHpt: 500,
    requiredScale: 2.25,
  });
  assert.equal(hit, null);
});

test('chooses the least oversampled covering tile', () => {
  const entries = [
    { id: 'scale-8', regionMeta: { regionXpt: 0, regionYpt: 0, regionWpt: 1000, regionHpt: 700, renderScale: 8 } },
    { id: 'scale-4', regionMeta: { regionXpt: 0, regionYpt: 0, regionWpt: 1000, regionHpt: 700, renderScale: 4 } },
  ];
  const hit = findBestCoveringTile(entries, {
    regionXpt: 100, regionYpt: 100, regionWpt: 800, regionHpt: 500,
    requiredScale: 3,
  });
  assert.equal(hit?.id, 'scale-4');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test js/pdf/tile-coverage.test.mjs`

Expected: FAIL because `tile-coverage.js` does not exist.

- [ ] **Step 3: Implement the pure selector**

```js
export function findBestCoveringTile(entries, request, epsilon = 0.5) {
  const covers = (m) =>
    m.renderScale + 0.001 >= request.requiredScale
    && m.regionXpt <= request.regionXpt + epsilon
    && m.regionYpt <= request.regionYpt + epsilon
    && m.regionXpt + m.regionWpt >= request.regionXpt + request.regionWpt - epsilon
    && m.regionYpt + m.regionHpt >= request.regionYpt + request.regionHpt - epsilon;
  const candidates = entries.filter((entry) => entry?.regionMeta && covers(entry.regionMeta));
  candidates.sort((a, b) => {
    const scale = a.regionMeta.renderScale - b.regionMeta.renderScale;
    if (Math.abs(scale) > 0.001) return scale;
    return a.regionMeta.regionWpt * a.regionMeta.regionHpt
      - b.regionMeta.regionWpt * b.regionMeta.regionHpt;
  });
  return candidates[0] || null;
}
```

- [ ] **Step 4: Integrate selector into the LRU cache**

Add `tileCacheFindCovering(filePath, pageNum, rotation, request)` that filters
the real cache by page identity, passes entries to `findBestCoveringTile`, and
touches the winning LRU entry.

- [ ] **Step 5: Run focused and full unit tests**

Run: `node --test js/pdf/tile-coverage.test.mjs js/pdf/progressive-render.test.mjs`

Expected: all tests PASS.

Run: `npm run test:unit`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/pdf/tile-coverage.js open-pdf-studio/js/pdf/tile-coverage.test.mjs open-pdf-studio/js/pdf/tile-cache.js open-pdf-studio/package.json
git commit -m "perf(pdf): select cached tiles by viewport coverage"
```

### Task 2: Use coverage hits in both zoom directions

**Files:**
- Modify: `open-pdf-studio/js/pdf/bitmap-orchestrator.js`
- Modify: `open-pdf-studio/js/pdf/tile-coverage.test.mjs`

**Interfaces:**
- Consumes: `tileCacheFindCovering(filePath, pageNum, rotation, request)`.
- Produces: `visiblePdfRegion(viewport, cssWidth, cssHeight)` as a pure exported helper and coverage-first lookup before native IPC.

- [ ] **Step 1: Write a failing viewport-region test**

```js
test('computes the larger PDF cover after zooming out around the same center', () => {
  const region = visiblePdfRegion({
    pageW: 1200, pageH: 800, zoom: 1.5, offsetX: -300, offsetY: -150,
  }, 1200, 750);
  assert.deepEqual(region, { x: 200, y: 100, w: 800, h: 500 });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test js/pdf/tile-coverage.test.mjs`

Expected: FAIL because `visiblePdfRegion` is not exported.

- [ ] **Step 3: Implement the pure viewport conversion**

Move the existing screen-to-PDF region calculation into
`visiblePdfRegion(viewport, cssWidth, cssHeight)` and use the same helper for
cache lookup and cache-miss rendering.

- [ ] **Step 4: Check coverage before exact-key lookup and IPC**

Build a request with the visible region and
`requiredScale = viewport.zoom * devicePixelRatio`. When
`tileCacheFindCovering` returns a hit, publish its bitmap/meta and return
without calling `invokeTileRegion`.

- [ ] **Step 5: Run tests**

Run: `node --test js/pdf/tile-coverage.test.mjs js/pdf/progressive-render.test.mjs`

Expected: all tests PASS.

Run: `npm run test:unit`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/pdf/bitmap-orchestrator.js open-pdf-studio/js/pdf/tile-coverage.test.mjs
git commit -m "perf(pdf): reuse sharp viewport coverage across zoom"
```

### Task 3: Benchmark gate

**Files:**
- Modify: `docs/performance/2026-07-29-vector-pdf-zoom-results.md`
- Reuse: existing benchmark scripts and artifacts under the verification directory.

**Interfaces:**
- Consumes: coverage-hit performance marks and the two verification PDFs.
- Produces: controlled A/B medians for 150→300→150, native invoke count, and peak RSS.

- [ ] **Step 1: Add a benchmark assertion for sharp return zoom**

Configure the existing benchmark sequence to visit 150%, 300%, 150%, repeat it
fifty times after one warm-up, and require `renderScale >= zoom * dpr` at every
settled sample.

- [ ] **Step 2: Record an unmodified baseline**

Run the benchmark from the parent commit in a clean app process for both PDFs,
at least three times each. Record median, p95, native invoke count, and RSS.

- [ ] **Step 3: Record the candidate**

Run the identical benchmark on the coverage candidate, at least three clean
processes per PDF.

- [ ] **Step 4: Apply the gate**

Keep the candidate only when warm sharp transitions are at most 100 ms, the
sequence improves by at least 80%, cold native invokes do not increase, and
RSS stays within the documented cache budget. Otherwise revert both candidate
commits.

- [ ] **Step 5: Verify and document**

Run: `npm run test:unit`

Expected: all tests PASS.

Run: `npm run build`

Expected: exit code 0.

Write measured baseline and candidate results into the performance report.

- [ ] **Step 6: Commit retained benchmark evidence**

```bash
git add docs/performance/2026-07-29-vector-pdf-zoom-results.md
git commit -m "docs(perf): record coverage-cache zoom results"
```

