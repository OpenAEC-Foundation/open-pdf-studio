export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

export function summarizeRuns(runs) {
  const values = runs
    .map((run) => run.visibleSharpMs)
    .filter(Number.isFinite);

  return {
    count: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

function firstNumber(entries, pattern) {
  for (const entry of entries) {
    const match = entry.text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function extractZoomPhases(entries, sinceMs) {
  const raw = entries
    .filter((entry) => entry.t >= sinceMs)
    .filter((entry) => /\[prog-perf]|\[prog]|\[bo]|\[bitmap-orch]|\[pbc]/.test(entry.text));

  const tileDurations = raw
    .map((entry) => entry.text.match(/tegel-invoke\b.*?\b(\d+)ms\b/))
    .filter(Boolean)
    .map((match) => Number(match[1]));

  return {
    firstTileMs: firstNumber(raw, /\[prog]\s+eerste tegel\s+@(\d+)ms/),
    completeMs: firstNumber(raw, /\[prog]\s+klaar\b.*?@(\d+)ms/),
    firstPublishMs: firstNumber(raw, /publish createImageBitmap\b.*?\b(\d+)ms/),
    maxTileInvokeMs: tileDurations.length ? Math.max(...tileDurations) : null,
    bitmapOrchestratorMs: firstNumber(
      raw,
      /(?:\[bo]|\[bitmap-orch]).*?(?:klaar|done|paint).*?\b(\d+)ms\b/i,
    ),
    raw,
  };
}

export function aggregatePeak(samples, appPid) {
  let mainPeakMb = 0;
  let workerPeakMb = 0;
  let workerTotalPeakMb = 0;

  for (const sample of samples) {
    const main = sample.processes.filter((item) => item.Id === appPid);
    const workers = sample.processes.filter(
      (item) => item.ProcessName === 'pdfium-worker' && item.ParentProcessId === appPid,
    );
    mainPeakMb = Math.max(mainPeakMb, ...main.map((item) => item.rssMb), 0);
    workerPeakMb = Math.max(workerPeakMb, ...workers.map((item) => item.rssMb), 0);
    workerTotalPeakMb = Math.max(
      workerTotalPeakMb,
      workers.reduce((sum, item) => sum + item.rssMb, 0),
    );
  }

  return { mainPeakMb, workerPeakMb, workerTotalPeakMb };
}

export function hasStableZoomEvidence({
  scale,
  completionSeen,
  quietForMs,
  viewport,
}) {
  const tileZoom = Number(viewport?.tile?.meta?.zoom);
  const matchingSharpTile = Number.isFinite(tileZoom) && Math.abs(tileZoom - scale) < 0.001;
  const quietCacheHit = !Number.isFinite(tileZoom) && quietForMs >= 1_500;
  return completionSeen || matchingSharpTile || quietCacheHit;
}
