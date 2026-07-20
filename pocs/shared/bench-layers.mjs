// Per-layer breakdown of "open BARN" timings — measures the dominant cost
// stages so we can see where the remaining time goes after PoC 02+04.
//
// Does NOT touch the UI (no tab close, no state mutation). Pure invoke()
// calls only, so it can't crash the app.

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
const pdfPath = join(PROJECT_ROOT, corpus.fixture_root, fixture.path);
const runs = args.runs ? parseInt(args.runs) : 5;
const numPages = fixture.pages;

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
    // Force cold start (drop DocumentHandle on Rust side)
    await evaluate(`window.__TAURI__.core.invoke('clear_pdf_cache', { path: ${escapedPath} }).catch(()=>null)`);
    await new Promise(r => setTimeout(r, 300));

    const m = await evaluate(`(async () => {
      const milestones = {};
      const t0 = performance.now();

      // Layer 1: read raw bytes (the cost the user pays at file-open)
      const tA = performance.now();
      const bytes = await window.__TAURI__.fs.readFile(${escapedPath});
      milestones.readFile_ms = performance.now() - tA;
      milestones.fileSize_bytes = bytes.length;

      // Layer 2: get page dimensions (parses the PDF on Rust side)
      const tB = performance.now();
      const dims = await window.__TAURI__.core.invoke('get_page_dimensions', { path: ${escapedPath} });
      milestones.parse_ms = performance.now() - tB;
      milestones.numPages = dims.length;

      // Layer 3: render page 1 (full Rust render including image decode)
      const tC = performance.now();
      const p1buf = await window.__TAURI__.core.invoke('render_pdf_page', {
        path: ${escapedPath}, pageIndex: 0, scale: 1.0, rotation: 0,
      });
      milestones.renderP1_ms = performance.now() - tC;
      const p1view = new DataView(p1buf.buffer || p1buf);
      milestones.p1_width = p1view.getUint32(0, true);
      milestones.p1_height = p1view.getUint32(4, true);
      milestones.p1_rgba_bytes = p1buf.byteLength || p1buf.length;

      // Layer 4: render 1 thumbnail (what generateThumbnails would do per page)
      const tD = performance.now();
      const thumb = await window.__TAURI__.core.invoke('render_thumbnail', {
        path: ${escapedPath}, pageIndex: 0, maxWidth: 200, rotation: 0, skipImages: true,
      });
      milestones.renderThumb1_ms = performance.now() - tD;
      milestones.thumb_url_length = thumb.length;

      // Layer 5: render thumbnails for ALL pages (simulating full strip fill)
      const tE = performance.now();
      for (let p = 0; p < ${numPages}; p++) {
        await window.__TAURI__.core.invoke('render_thumbnail', {
          path: ${escapedPath}, pageIndex: p, maxWidth: 200, rotation: 0, skipImages: true,
        });
      }
      milestones.allThumbs_ms = performance.now() - tE;

      milestones.total_ms = performance.now() - t0;
      return milestones;
    })()`);
    results.push(m);
    console.error(
      `[run ${i + 1}/${runs}] readFile=${m.readFile_ms.toFixed(0)}ms parse=${m.parse_ms.toFixed(0)}ms ` +
      `renderP1=${m.renderP1_ms.toFixed(0)}ms thumb1=${m.renderThumb1_ms.toFixed(0)}ms ` +
      `allThumbs=${m.allThumbs_ms.toFixed(0)}ms total=${m.total_ms.toFixed(0)}ms`
    );
  }

  ws.close();

  // Stats
  const fields = ['readFile_ms', 'parse_ms', 'renderP1_ms', 'renderThumb1_ms', 'allThumbs_ms', 'total_ms'];
  const stats = {};
  for (const f of fields) {
    const arr = results.map(r => r[f]).filter(x => x != null);
    if (arr.length === 0) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    stats[f] = {
      median: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
      min: Math.round(sorted[0] * 10) / 10,
      max: Math.round(sorted[sorted.length - 1] * 10) / 10,
    };
  }
  console.log(JSON.stringify({
    fixture: fixture.name,
    fileSize_MB: Math.round(results[0].fileSize_bytes / 1024 / 1024 * 10) / 10,
    p1_dimensions: `${results[0].p1_width}x${results[0].p1_height}`,
    p1_rgba_MB: Math.round(results[0].p1_rgba_bytes / 1024 / 1024 * 10) / 10,
    numPages: results[0].numPages,
    stats,
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
