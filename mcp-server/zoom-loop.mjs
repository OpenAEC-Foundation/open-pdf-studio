import { verificationPath } from '../scripts/verification-path.mjs';
// AI-driven zoom-anchor test loop.
//
// Connects to the local MCP server (started by `npm run tauri:dev:debug`)
// and runs a parametric sweep over (cursor X, cursor Y, scale, direction).
// For each test:
//   1. Snapshot pre-zoom canvas state at (x, y)
//   2. Dispatch a synthetic ctrl+wheel event
//   3. Wait for renderPage to settle
//   4. Compute anchor displacement
//   5. Log result to anchor-test.log
//
// Run:
//   node mcp-server/zoom-loop.mjs
//
// Pre-req:
//   • App started with `npm run tauri:dev:debug` (CDP 9222 + MCP 9223)
//   • BARN PDF opened, navigated to page 2

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MCP_URL = 'http://127.0.0.1:9223/mcp';
const LOG_PATH = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/mcp-server/anchor-test.log';
const BARN = verificationPath('PDF-bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf');

const log = fs.createWriteStream(LOG_PATH, { flags: 'w' });
const out = (s) => { const t = new Date().toISOString().slice(11, 23); log.write(`[${t}] ${s}\n`); process.stdout.write(`[${t}] ${s}\n`); };

let nextId = 1;
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const req = http.request(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(b);
          if (parsed.error) return reject(new Error(`JSON-RPC error: ${parsed.error.code} ${parsed.error.message}`));
          resolve(parsed.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('rpc timeout')); });
    req.write(body);
    req.end();
  });
}

async function tool(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  // MCP tools return { content: [{type:'text', text:JSON}], isError? }
  if (r?.isError) throw new Error(`tool ${name} returned error: ${JSON.stringify(r.content)}`);
  const txt = r?.content?.[0]?.text;
  try { return txt ? JSON.parse(txt) : r; } catch { return txt; }
}

async function waitForApp(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await rpc('tools/list', {});
      if (r?.tools?.some(t => t.name === 'app_zoom_anchor_test')) {
        out(`MCP server ready (${r.tools.length} tools, including app_zoom_anchor_test)`);
        return true;
      }
      out(`MCP server up but missing test tools — rebuilding? (saw ${r?.tools?.length ?? 0} tools)`);
    } catch (e) {
      out(`MCP not ready: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('MCP server never came up with test tools — restart `npm run tauri:dev:debug` and wait for build to finish');
}

async function setupBarnP2() {
  out('Opening BARN.pdf...');
  await tool('app_open_pdf', { path: BARN });
  await new Promise(r => setTimeout(r, 800));
  out('Navigating to page 2...');
  await tool('app_go_to_page', { page: 2 });
  await new Promise(r => setTimeout(r, 800));
  out('Setting zoom to 1.0...');
  await tool('app_set_zoom', { value: 1.0 });
  await new Promise(r => setTimeout(r, 1500));
  const state = await tool('app_get_viewport_state');
  out('Viewport state: ' + JSON.stringify(state).slice(0, 500));
}

async function runOneTest(label, x, y, direction = 'in') {
  out(`--- ${label}: ctrl+wheel ${direction} @ (${x}, ${y}) ---`);
  const r = await tool('app_zoom_anchor_test', { x, y, direction });
  if (!r.ok) {
    out(`  FAIL: ${r.error || JSON.stringify(r)}`);
    return r;
  }
  const verdict = r.pass ? 'PASS' : r.acceptable ? 'ACCEPTABLE' : 'FAIL';
  out(`  ${verdict}: anchorError = ${r.anchorErrorPx?.toFixed(2)} px (dx=${r.anchorErrorX?.toFixed(2)}, dy=${r.anchorErrorY?.toFixed(2)})`);
  out(`  pre:  canvas=(${r.pre.canvas.left.toFixed(0)},${r.pre.canvas.top.toFixed(0)}) ${r.pre.canvas.width.toFixed(0)}x${r.pre.canvas.height.toFixed(0)}` +
      `  scroll=(${r.pre.container?.scrollLeft},${r.pre.container?.scrollTop})  scale=${r.pre.scale}`);
  out(`  post: canvas=(${r.post.canvas.left.toFixed(0)},${r.post.canvas.top.toFixed(0)}) ${r.post.canvas.width.toFixed(0)}x${r.post.canvas.height.toFixed(0)}` +
      `  scroll=(${r.post.container?.scrollLeft},${r.post.container?.scrollTop})  scale=${r.post.scale}`);
  if (r.post.tile?.display === 'block') {
    out(`  tile: @${r.post.tile.cssLeft},${r.post.tile.cssTop}  ${r.post.tile.cssWidth}x${r.post.tile.cssHeight}`);
  }
  return r;
}

async function main() {
  out('=== zoom-loop.mjs starting ===');
  await waitForApp();
  await setupBarnP2();

  // Grid of cursor positions to test. Picks: center, near-left, near-right,
  // far-left, far-right, near-top, near-bottom.
  const positions = [
    { label: 'center', x: 900, y: 500 },
    { label: 'left-edge', x: 300, y: 500 },
    { label: 'right-edge', x: 1500, y: 500 },
    { label: 'far-left', x: 150, y: 500 },
    { label: 'far-right', x: 1700, y: 500 },
    { label: 'top', x: 900, y: 200 },
    { label: 'bottom', x: 900, y: 800 },
  ];

  const results = [];

  // Phase 1: from initial zoom, do one zoom-in at each position (with a clear+restart between).
  for (const p of positions) {
    // Reset to known zoom before each test to make results independent
    await tool('app_set_zoom', { value: 1.0 });
    await new Promise(r => setTimeout(r, 600));
    const r = await runOneTest(`phase1-${p.label}`, p.x, p.y, 'in');
    results.push({ phase: 1, ...p, ...r });
  }

  // Phase 2: chain 5 zoom-ins at center to test mid-zoom anchor at scale ≥ 200%
  out('=== Phase 2: progressive zoom-in at center ===');
  await tool('app_set_zoom', { value: 1.0 });
  await new Promise(r => setTimeout(r, 600));
  for (let step = 1; step <= 5; step++) {
    const r = await runOneTest(`phase2-step${step}`, 900, 500, 'in');
    results.push({ phase: 2, step, ...r });
  }

  // Phase 3: at high zoom (post-phase-2), test anchor with cursor at different positions
  out('=== Phase 3: at high zoom, cursor at different positions ===');
  for (const p of positions) {
    const r = await runOneTest(`phase3-${p.label}`, p.x, p.y, 'in');
    results.push({ phase: 3, ...p, ...r });
  }

  // Phase 4: high-zoom tile verification (zoom > cap, ~300%+ on BARN)
  // At zoom 3.0 on a 1632pt-wide page, capZoom ≈ 2.51, so a tile is required.
  // Verifies that the tile renders, sits at the right page-region, and that
  // cursor anchor still works on top of it.
  out('=== Phase 4: high-zoom tile verification ===');
  await tool('app_set_zoom', { value: 3.0 });
  await new Promise(r => setTimeout(r, 1500));
  for (const p of positions) {
    const r = await runOneTest(`phase4-${p.label}`, p.x, p.y, 'in');
    results.push({ phase: 4, ...p, ...r });
    // Probe tile state so we can assert it actually rendered above cap
    const state = await tool('app_get_viewport_state');
    const tile = state?.tile;
    if (tile) {
      out(`  tile @ ${tile.width}x${tile.height}, region pt=(${tile.meta?.regionXpt?.toFixed(0)},${tile.meta?.regionYpt?.toFixed(0)}) ${tile.meta?.regionWpt?.toFixed(0)}x${tile.meta?.regionHpt?.toFixed(0)}, zoom=${tile.meta?.zoom?.toFixed(2)}`);
    } else {
      out(`  TILE MISSING — zoom > cap should have produced a tile`);
    }
  }

  // Summary
  const failed = results.filter(r => !r.pass && !r.acceptable);
  const acceptable = results.filter(r => !r.pass && r.acceptable);
  const passed = results.filter(r => r.pass);
  out('=== SUMMARY ===');
  out(`Total: ${results.length}, PASS: ${passed.length}, ACCEPTABLE: ${acceptable.length}, FAIL: ${failed.length}`);
  if (failed.length > 0) {
    out('Failed tests:');
    for (const f of failed) {
      out(`  ${f.phase}-${f.label || ('step'+f.step)} (@${f.pre?.cursor?.x},${f.pre?.cursor?.y}): ${f.anchorErrorPx?.toFixed(2)} px error`);
    }
  }
  out('=== zoom-loop.mjs done ===');
  log.end();
}

main().catch(e => { out('FATAL: ' + (e?.message ?? e)); log.end(); process.exit(1); });
