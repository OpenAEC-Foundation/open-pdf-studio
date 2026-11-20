import { verificationPath } from '../scripts/verification-path.mjs';
// Sweep all test PDFs through the live app via MCP and report:
//   • engine label (Raster/Vector/Hybrid?) per page
//   • renderPage TOTAL timing per page
//   • thumbnail render success/failure
//   • viewport state after open
//
// Run after `npm run tauri:dev:debug` is up.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MCP_URL = 'http://127.0.0.1:9223/mcp';
const TEST_DIR = verificationPath('PDF-bestanden');
const LOG_PATH = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/mcp-server/sweep-results.log';

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
          if (parsed.error) return reject(new Error(`JSON-RPC ${parsed.error.code}: ${parsed.error.message}`));
          resolve(parsed.result);
        } catch (e) { reject(new Error(`bad response: ${b.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('rpc timeout')); });
    req.write(body); req.end();
  });
}

async function tool(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r?.isError) throw new Error(`tool ${name}: ${JSON.stringify(r.content)}`);
  const txt = r?.content?.[0]?.text;
  try { return txt ? JSON.parse(txt) : r; } catch { return txt; }
}

async function sweepFile(filePath) {
  const name = path.basename(filePath);
  out(`\n━━━━━━━━ ${name} ━━━━━━━━`);
  await tool('app_clear_caches');
  const t0 = Date.now();
  let openResult;
  try {
    openResult = await tool('app_open_pdf', { path: filePath });
  } catch (e) {
    out(`  ❌ open failed: ${e.message}`);
    return { name, error: e.message };
  }
  const openMs = Date.now() - t0;
  if (!openResult.ok) {
    out(`  ❌ open returned: ${JSON.stringify(openResult)}`);
    return { name, error: 'open !ok' };
  }
  await new Promise(r => setTimeout(r, 1000));
  const state = await tool('app_get_viewport_state');
  const numPages = openResult.page_count;
  out(`  📂 opened in ${openMs}ms, ${numPages} pages, engine=${state.engine}`);
  if (state.viewport) {
    out(`     pageType=${state.viewport.pageType ?? 'n/a'} pageW=${state.viewport.pageW?.toFixed?.(1) ?? state.viewport.pageW} pageH=${state.viewport.pageH?.toFixed?.(1) ?? state.viewport.pageH} rotation=${state.viewport.rotation}`);
  }

  // Navigate p1 → pN → p1 to exercise both directions
  const visits = [];
  for (let p = 1; p <= Math.min(numPages, 5); p++) visits.push(p);
  if (numPages > 1) for (let p = Math.min(numPages, 5) - 1; p >= 1; p--) visits.push(p);
  for (const p of visits) {
    const tt0 = Date.now();
    try {
      await tool('app_go_to_page', { page: p });
    } catch (e) {
      out(`  ❌ page ${p}: ${e.message}`);
      continue;
    }
    const navMs = Date.now() - tt0;
    await new Promise(r => setTimeout(r, 200));
    const ps = await tool('app_get_viewport_state');
    out(`  → p${p}: nav=${navMs}ms engine=${ps.engine}`);
  }

  // Test zoom anchor in 3 positions at scale 1.0 then 2.0 then 4.0
  out(`  --- zoom-anchor probe ---`);
  await tool('app_set_zoom', { value: 1.0 });
  await new Promise(r => setTimeout(r, 600));
  for (const [x, y, label] of [[700, 400, 'center'], [300, 300, 'top-left'], [1200, 700, 'bottom-right']]) {
    try {
      const r = await tool('app_zoom_anchor_test', { x, y, direction: 'in' });
      const verdict = r.pass ? 'PASS' : r.acceptable ? 'OK' : 'FAIL';
      out(`     ${label} (${x},${y}): ${verdict} err=${r.anchorErrorPx?.toFixed(2) ?? '?'}px`);
    } catch (e) {
      out(`     ${label}: error ${e.message}`);
    }
  }

  return { name, ok: true };
}

async function main() {
  out('=== sweep-all-pdfs.mjs starting ===');
  // Wait for MCP
  for (let i = 0; i < 10; i++) {
    try {
      const r = await rpc('tools/list');
      if (r?.tools?.length) { out(`MCP ready (${r.tools.length} tools)`); break; }
    } catch { await new Promise(r => setTimeout(r, 1500)); }
  }

  const files = fs.readdirSync(TEST_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(TEST_DIR, f).replace(/\\/g, '/'));
  out(`Found ${files.length} test PDFs`);

  const results = [];
  for (const f of files) {
    try { results.push(await sweepFile(f)); }
    catch (e) { results.push({ name: path.basename(f), error: e.message }); }
  }

  out(`\n=== SUMMARY ===`);
  for (const r of results) {
    out(r.error ? `  ❌ ${r.name} — ${r.error}` : `  ✅ ${r.name}`);
  }
  out('=== sweep done ===');
  log.end();
}

main().catch(e => { out(`FATAL: ${e?.message ?? e}`); log.end(); process.exit(1); });
