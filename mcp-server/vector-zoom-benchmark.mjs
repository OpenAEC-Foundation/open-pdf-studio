import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { extractZoomPhases, summarizeRuns } from './vector-zoom-metrics.mjs';

const DEFAULT_MCP = 'http://127.0.0.1:9223/mcp';
const ZOOM_SEQUENCE = [1, 1.5, 2, 3];
const RELEVANT_LOG = /\[render]|\[tile]|\[wheel-zoom]|\[PERF]|\[bitmap-orch]|\[tile-orch]|\[prog]|\[prog-perf]|\[pbc]|\[bo]|STALE|JANK/i;
const COMPLETION_LOG = /\[prog]\s+klaar|\[pbc]\s+whole-page\s+KLAAR|\[tile-orch]\s+cached|cache-hit-direct|cache-hit bucket/i;

export function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument near ${flag ?? '<end>'}`);
    }
    values.set(flag.slice(2), value);
  }

  const pdf = values.get('pdf');
  if (!pdf) throw new Error('--pdf is required');

  const page = Number(values.get('page') ?? 1);
  const runs = Number(values.get('runs') ?? 5);
  if (!Number.isInteger(page) || page < 1) throw new Error('--page must be a positive integer');
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');

  return {
    pdf,
    label: values.get('label') ?? 'baseline',
    page,
    runs,
    output: values.get('output') ?? null,
  };
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

class McpClient {
  constructor(endpoint = DEFAULT_MCP) {
    this.endpoint = endpoint;
    this.id = 1;
  }

  async rpc(method, params = {}) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.id++, method, params }),
    });
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message ?? JSON.stringify(payload.error));
    return payload.result;
  }

  async tool(name, args = {}) {
    const result = await this.rpc('tools/call', { name, arguments: args });
    const text = result?.content?.[0]?.text;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

function processSnapshot() {
  const command = [
    "$names = @('open-pdf-studio','pdfium-worker');",
    '$items = Get-Process -Name $names -ErrorAction SilentlyContinue |',
    "Select-Object Id,ProcessName,@{n='rssMb';e={[math]::Round($_.WorkingSet64/1MB,1)}};",
    'if ($items) { $items | ConvertTo-Json -Compress } else { "[]" }',
  ].join(' ');

  try {
    const stdout = execFileSync('powershell', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      timeout: 8_000,
      windowsHide: true,
    }).trim();
    const parsed = JSON.parse(stdout || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function aggregatePeak(samples) {
  let mainPeakMb = 0;
  let workerPeakMb = 0;
  let workerTotalPeakMb = 0;
  for (const sample of samples) {
    const main = sample.processes.filter((item) => item.ProcessName === 'open-pdf-studio');
    const workers = sample.processes.filter((item) => item.ProcessName === 'pdfium-worker');
    mainPeakMb = Math.max(mainPeakMb, ...main.map((item) => item.rssMb), 0);
    workerPeakMb = Math.max(workerPeakMb, ...workers.map((item) => item.rssMb), 0);
    workerTotalPeakMb = Math.max(
      workerTotalPeakMb,
      workers.reduce((sum, item) => sum + item.rssMb, 0),
    );
  }
  return { mainPeakMb, workerPeakMb, workerTotalPeakMb };
}

async function recentEntries(client, since) {
  const response = await client.tool('app_get_recent_console', { since });
  return Array.isArray(response) ? response : (response?.entries ?? []);
}

async function waitForStableZoom(client, scale, since, timeoutMs = 120_000) {
  const started = performance.now();
  let lastRelevantSignature = '';
  let lastRelevantAt = performance.now();
  let completionSeen = false;
  let latestEntries = [];
  const rssSamples = [];

  while (performance.now() - started < timeoutMs) {
    const [viewport, entries] = await Promise.all([
      client.tool('app_get_viewport_state', {}),
      recentEntries(client, since),
    ]);
    latestEntries = entries;
    rssSamples.push({ atMs: Math.round(performance.now() - started), processes: processSnapshot() });

    const relevant = entries.filter((entry) => RELEVANT_LOG.test(entry.text));
    const signature = relevant.map((entry) => `${entry.t}:${entry.text}`).join('\n');
    if (signature !== lastRelevantSignature) {
      lastRelevantSignature = signature;
      lastRelevantAt = performance.now();
    }
    completionSeen ||= relevant.some((entry) => COMPLETION_LOG.test(entry.text));

    const actualZoom = Number(viewport?.viewport?.zoom ?? viewport?.doc?.scale);
    const zoomMatches = Number.isFinite(actualZoom) && Math.abs(actualZoom - scale) < 0.001;
    const quietForMs = performance.now() - lastRelevantAt;
    if (zoomMatches && completionSeen && quietForMs >= 800) {
      return {
        ok: true,
        elapsedMs: Math.round(performance.now() - started),
        viewport,
        entries: latestEntries,
        rssSamples,
      };
    }
    await sleep(200);
  }

  return {
    ok: false,
    elapsedMs: Math.round(performance.now() - started),
    error: `zoom ${scale} did not stabilize within ${timeoutMs}ms`,
    entries: latestEntries,
    rssSamples,
  };
}

async function captureScreenshot(client, outputDir, stem) {
  const shot = await client.tool('app_screenshot_view', { width: 2000 });
  const encoded = shot?.png_base64 ?? shot?.base64 ?? shot?.data;
  if (!shot?.ok || typeof encoded !== 'string') {
    return { ok: false, error: shot?.error ?? 'screenshot returned no PNG data' };
  }
  const bytes = Buffer.from(encoded, 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (outputDir) {
    const file = join(outputDir, `${stem}.png`);
    await writeFile(file, bytes);
    return { ok: true, sha256: hash, bytes: bytes.length, file };
  }
  return { ok: true, sha256: hash, bytes: bytes.length };
}

async function measureZoom(client, scale, runIndex, outputDir) {
  const since = Date.now();
  const wallStarted = performance.now();
  const setResult = await client.tool('app_set_zoom', { scale });
  if (!setResult?.ok) {
    return { scale, ok: false, error: setResult?.error ?? 'app_set_zoom failed' };
  }

  const stable = await waitForStableZoom(client, scale, since);
  const visibleSharpMs = Math.round(performance.now() - wallStarted);
  const screenshot = stable.ok
    ? await captureScreenshot(client, outputDir, `run-${runIndex}-zoom-${String(scale).replace('.', '_')}`)
    : null;

  return {
    scale,
    ok: stable.ok,
    visibleSharpMs: stable.ok ? visibleSharpMs : null,
    stabilization: stable,
    phases: extractZoomPhases(stable.entries ?? [], since),
    rss: aggregatePeak(stable.rssSamples ?? []),
    screenshot,
  };
}

async function measurePan(client) {
  const viewport = await client.tool('app_get_viewport_state', {});
  const x = Math.round((viewport?.container?.left ?? 0) + (viewport?.container?.width ?? 800) / 2);
  const y = Math.round((viewport?.container?.top ?? 0) + (viewport?.container?.height ?? 600) / 2);
  const since = Date.now();
  const started = performance.now();
  const response = await client.tool('app_scroll', { x, y, dx: 240, dy: 180 });
  await sleep(800);
  const entries = await recentEntries(client, since);
  return {
    ok: response?.ok !== false,
    elapsedMs: Math.round(performance.now() - started),
    phases: extractZoomPhases(entries, since),
  };
}

function gitIdentity() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

async function runBenchmark(args) {
  if (!existsSync(args.pdf)) throw new Error(`PDF does not exist: ${args.pdf}`);
  const outputDir = args.output ? resolve(args.output, args.label) : null;
  if (outputDir) await mkdir(outputDir, { recursive: true });

  const client = new McpClient(process.env.OPS_MCP_URL || DEFAULT_MCP);
  const tools = await client.rpc('tools/list');
  const names = new Set((tools?.tools ?? []).map((tool) => tool.name));
  for (const required of [
    'app_clear_caches',
    'app_open_pdf',
    'app_go_to_page',
    'app_set_zoom',
    'app_scroll',
    'app_get_viewport_state',
    'app_get_recent_console',
    'app_screenshot_view',
  ]) {
    if (!names.has(required)) throw new Error(`MCP tool unavailable: ${required}`);
  }

  await client.tool('app_clear_caches', {});
  const openStarted = performance.now();
  const opened = await client.tool('app_open_pdf', { path: args.pdf });
  const openMs = Math.round(performance.now() - openStarted);
  if (!opened?.ok) throw new Error(opened?.error ?? 'app_open_pdf failed');
  if (args.page !== 1) {
    const pageResult = await client.tool('app_go_to_page', { page: args.page });
    if (!pageResult?.ok) throw new Error(pageResult?.error ?? 'app_go_to_page failed');
  }

  const result = {
    schemaVersion: 1,
    label: args.label,
    pdf: resolve(args.pdf),
    pdfName: basename(args.pdf),
    page: args.page,
    gitCommit: gitIdentity(),
    startedAt: new Date().toISOString(),
    openMs,
    runs: [],
  };

  for (let runIndex = 1; runIndex <= args.runs; runIndex += 1) {
    const run = { index: runIndex, zooms: [] };
    for (const scale of ZOOM_SEQUENCE) {
      run.zooms.push(await measureZoom(client, scale, runIndex, outputDir));
    }
    run.pan = await measurePan(client);
    run.returnTo100 = await measureZoom(client, 1, runIndex, outputDir);
    run.visibleSharpMs = run.zooms
      .filter((zoom) => zoom.scale > 1 && Number.isFinite(zoom.visibleSharpMs))
      .reduce((sum, zoom) => sum + zoom.visibleSharpMs, 0);
    result.runs.push(run);
  }

  result.summary = summarizeRuns(result.runs);
  result.finishedAt = new Date().toISOString();
  if (outputDir) {
    const resultFile = join(outputDir, 'result.json');
    await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`);
    result.resultFile = resultFile;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBenchmark(args);
  console.log(JSON.stringify({
    label: result.label,
    pdf: result.pdfName,
    openMs: result.openMs,
    summary: result.summary,
    resultFile: result.resultFile ?? null,
  }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`VECTOR_ZOOM_BENCHMARK_ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
