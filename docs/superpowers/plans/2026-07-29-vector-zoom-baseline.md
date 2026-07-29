# Vector Zoom Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a repeatable, machine-readable zoom-performance baseline for MV-03 and NKD1a before changing render behavior.

**Architecture:** A focused Node benchmark drives the existing app MCP endpoint, records console phase timings and process RSS, and writes one JSON result per run outside the tracked source tree. Pure parsing and summary functions live in a small importable module so their behavior is test-first verified independently of the desktop app.

**Tech Stack:** Node.js built-in test runner, HTTP JSON-RPC, existing Open PDF Studio MCP bridge, PowerShell process metrics.

## Global Constraints

- Keep product rendering behavior unchanged during the baseline task.
- Benchmark both supplied PDF files with fixed zoom steps 100%, 150%, 200%, 300%, pan, and return to 100%.
- Run at least five measured repetitions; report cold runs separately.
- Preserve only later candidates with at least 10% reproducible improvement, no visual regression, and no unacceptable peak-memory increase.
- Do not merge or open a pull request during research.

---

### Task 1: Pure benchmark metrics

**Files:**
- Create: `mcp-server/vector-zoom-metrics.mjs`
- Create: `mcp-server/vector-zoom-metrics.test.mjs`

**Interfaces:**
- Consumes: console entries shaped as `{ t: number, text: string }`.
- Produces: `percentile(values, fraction)`, `summarizeRuns(runs)`, and `extractZoomPhases(entries, sinceMs)`.

- [ ] **Step 1: Write the failing tests**

Test exact percentile selection, median/p95 summaries, and extraction of
`[prog-perf]`, `[prog]`, `[bo]`, and bitmap-publication durations from a
small deterministic console fixture. Assert that absent phases remain `null`
instead of becoming zero.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test mcp-server/vector-zoom-metrics.test.mjs
```

Expected: FAIL because `vector-zoom-metrics.mjs` does not exist.

- [ ] **Step 3: Implement the minimal pure metrics module**

Implement:

```js
export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

export function summarizeRuns(runs) {
  const values = runs.map((run) => run.visibleSharpMs).filter(Number.isFinite);
  return {
    count: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}
```

`extractZoomPhases()` must retain raw matching entries and derive only values
that are explicitly present in the log; it must not estimate missing phases.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
node --test mcp-server/vector-zoom-metrics.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add mcp-server/vector-zoom-metrics.mjs mcp-server/vector-zoom-metrics.test.mjs
git commit -m "test(perf): voeg vector-zoom meetparser toe"
```

### Task 2: MCP zoom benchmark driver

**Files:**
- Create: `mcp-server/vector-zoom-benchmark.mjs`
- Modify: `mcp-server/vector-zoom-metrics.test.mjs`
- Test: `mcp-server/vector-zoom-metrics.test.mjs`

**Interfaces:**
- Consumes: `--pdf`, `--label`, `--runs`, `--page`, and optional `--output`.
- Consumes MCP tools: `app_clear_caches`, `app_open_pdf`, `app_go_to_page`, `app_set_zoom`, `app_scroll`, `app_get_viewport_state`, `app_get_recent_console`, and `app_screenshot_view`.
- Produces: JSON containing environment identity, individual runs, phase timings, worker RSS, screenshots hashes, and summaries.

- [ ] **Step 1: Extend the failing test**

Add tests for an exported `parseArgs(argv)` that rejects missing PDF paths,
defaults to five warm runs, and preserves paths containing spaces and commas.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test mcp-server/vector-zoom-metrics.test.mjs
```

Expected: FAIL because `parseArgs` is not exported.

- [ ] **Step 3: Implement the minimal driver**

The driver must:

1. Verify `tools/list` before a run.
2. Clear app caches before a cold run.
3. Open exactly one supplied PDF.
4. Navigate to the configured page.
5. Establish 100% zoom and wait until render activity is quiet.
6. For each zoom target, capture a console cutoff, call `app_set_zoom`,
   poll viewport and console state until the final bitmap/tile for that zoom
   is stable, and record elapsed wall time.
7. Sample main-process and all `pdfium-worker` RSS values during each step.
8. Save one screenshot per stable zoom target and record a SHA-256 hash.
9. Perform a fixed scroll/pan and record its stabilization latency.
10. Write JSON only under the supplied output directory.

Use an explicit quiet-window condition based on unchanged viewport identity
and no new relevant render messages for 300 ms. Use a 120-second hard timeout;
timeouts are recorded as failures and never converted into successful values.

- [ ] **Step 4: Run unit tests and syntax validation**

Run:

```powershell
node --test mcp-server/vector-zoom-metrics.test.mjs
node --check mcp-server/vector-zoom-benchmark.mjs
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add mcp-server/vector-zoom-benchmark.mjs mcp-server/vector-zoom-metrics.test.mjs
git commit -m "test(perf): automatiseer vector-zoom nulmeting"
```

### Task 3: Build and baseline execution

**Files:**
- No tracked source changes.
- Output: `C:\Users\rickd\Documents\GitHub\verification-files\performance\vector-zoom-baseline\`

**Interfaces:**
- Consumes: the benchmark driver from Task 2 and the two supplied PDFs.
- Produces: cold and warm result JSON, screenshots, terminal log, and a concise comparison table.

- [ ] **Step 1: Verify clean branch and dependencies**

Run:

```powershell
git status --short
npm install
npm run test:unit
```

Expected: clean branch before dependency setup and unit tests exit 0.

- [ ] **Step 2: Start the development app with MCP**

Run from `open-pdf-studio`:

```powershell
npm run tauri -- dev -- -- --mcp-server
```

Wait until `http://127.0.0.1:9223/mcp` responds to `tools/list`.

- [ ] **Step 3: Execute MV-03 baseline**

Run the driver once cold and at least five warm repetitions against:

```text
C:\Users\rickd\Documents\GitHub\verification-files\PDF-bestanden\MV-03_Mechanische ventilatie, 3e verdieping ontwerp ACH van 1,5 naar 2,0.pdf
```

Store results below the untracked verification output directory.

- [ ] **Step 4: Execute NKD1a baseline**

Run the same protocol against:

```text
C:\Users\rickd\Documents\GitHub\verification-files\PDF-bestanden\NKD1a_opm_aw.pdf
```

- [ ] **Step 5: Validate result completeness**

Reject the baseline when any file lacks five successful measured runs,
stable screenshot hashes, phase logs, or RSS samples. Do not begin product
optimization until both baselines are complete.

- [ ] **Step 6: Select exactly one first hypothesis**

Use the measured phase share:

- queue/stale work dominant: select task-priority/cancellation;
- repeated page-load dominant: select worker-affinity;
- bitmap publication dominant: select tiled publication;
- scene chunk traversal dominant: select PDFVM spatial indexing.

Write a separate implementation plan for only the selected hypothesis.
