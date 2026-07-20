// End-to-end "open BARN" benchmark — measures the real user-facing latency
// from clicking open through to a usable rendered page 1.
//
// Unlike bench-raw-cdp.mjs (which only measures the Rust render call), this
// exercises the full loadPDF → setViewMode → renderPage(1) flow so we see
// every layer: file read, PDF.js parse, pdf-lib parse, annotation loading,
// thumbnail generation, and the prerender side effects.
//
// Usage:
//   node pocs/shared/bench-end-to-end.mjs --fixture barn --runs 5

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';

const require = createRequire(import.meta.url);
const { WebSocket } = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/ws');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const corpus = JSON.parse(readFileSync(join(__dirname, 'corpus.json'), 'utf-8'));

const args = parseArgs(process.argv.slice(2));
const fixture = corpus.fixtures.find(f => f.name === (args.fixture || 'barn'));
if (!fixture) { console.error(`Unknown fixture: ${args.fixture}`); process.exit(2); }
const pdfPath = join(PROJECT_ROOT, corpus.fixture_root, fixture.path);
const runs = args.runs ? parseInt(args.runs) : 5;

async function main() {
  const targets = await fetchJson('http://localhost:9222/json/list');
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) { console.error('No page target'); process.exit(3); }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  await new Promise((r) => ws.on('open', r));
  function send(method, params = {}) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expr, awaitPromise = true) {
    const result = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  const escapedPath = JSON.stringify(pdfPath);
  await evaluate(`window.__TAURI__.core.invoke('allow_fs_scope', { path: ${escapedPath} })`);

  const results = [];
  for (let i = 0; i < runs; i++) {
    // Force a fully cold start: clear Rust caches AND close any open tabs.
    await evaluate(`(async () => {
      try { await window.__TAURI__.core.invoke('clear_pdf_cache', { path: ${escapedPath} }); } catch (e) {}
      try {
        const stateMod = await import('/js/core/state.ts');
        const tabsMod = await import('/js/ui/chrome/tabs.js');
        while (stateMod.state.documents.length > 0) tabsMod.closeTab(0, true);
      } catch (e) { /* tabs may not be loaded */ }
    })()`);
    await new Promise(r => setTimeout(r, 500));

    // Measure the full open flow.
    const result = await evaluate(`(async () => {
      const t0 = performance.now();
      const milestones = { t0 };

      const stateMod = await import('/js/core/state.ts');
      const tabsMod = await import('/js/ui/chrome/tabs.js');
      const loaderMod = await import('/js/pdf/loader.js');

      milestones.beforeCreateTab = performance.now() - t0;
      tabsMod.createTab(${escapedPath});
      milestones.afterCreateTab = performance.now() - t0;

      const docIndex = stateMod.state.activeDocumentIndex;
      await loaderMod.loadPDF(${escapedPath}, docIndex);
      milestones.loadPDFDone = performance.now() - t0;

      // Wait for the first rendered page to appear on canvas (visual completion)
      const t_visualStart = performance.now();
      let visualDone = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        await new Promise(r => requestAnimationFrame(r));
        const canvas = document.getElementById('pdf-canvas');
        if (canvas && canvas.width > 100 && canvas.height > 100) {
          // Check pixel sample is non-white (something was drawn)
          try {
            const ctx = canvas.getContext('2d');
            const px = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
            if (px[0] !== 255 || px[1] !== 255 || px[2] !== 255 || px[3] !== 255) {
              visualDone = true;
              break;
            }
          } catch (e) {}
        }
        if (performance.now() - t_visualStart > 10000) break;
      }
      milestones.firstPixelOnCanvas = performance.now() - t0;
      milestones.visualDone = visualDone;

      return milestones;
    })()`);
    results.push(result);
    console.error(`[run ${i + 1}/${runs}] loadPDF=${result.loadPDFDone?.toFixed(0)}ms firstPixel=${result.firstPixelOnCanvas?.toFixed(0)}ms visualDone=${result.visualDone}`);
  }

  ws.close();

  // Stats
  const loadTimes = results.map(r => r.loadPDFDone).filter(x => x != null);
  const firstPixelTimes = results.map(r => r.firstPixelOnCanvas).filter(x => x != null);
  const stats = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      n: arr.length,
      median: sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: arr.reduce((a, b) => a + b, 0) / arr.length,
    };
  };
  console.log(JSON.stringify({
    fixture: fixture.name,
    runs: results,
    stats: {
      loadPDFDone: stats(loadTimes),
      firstPixelOnCanvas: stats(firstPixelTimes),
    },
  }, null, 2));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

main().catch(e => { console.error('FATAL:', e); process.exit(99); });
