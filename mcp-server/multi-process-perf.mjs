import { verificationPath } from '../scripts/verification-path.mjs';
// Multi-process PDFium perf probe — compares v1.59 (pool) vs v1.58.3
// (single proc) on NKD1a's 4-page sequential cold browse.
//
// Run AFTER the v1.59 build is live (npm run tauri:dev:debug). The
// probe prints a per-page TOTAL plus the sum across all 4 pages.

const MCP = 'http://127.0.0.1:9223/mcp';
const PDF = verificationPath('PDF-bestanden/NKD1a_opm_aw.pdf');

let id = 1;
async function tool(name, args) {
  const r = await fetch(MCP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await r.json();
  const text = j?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('=== Multi-process PDFium perf probe ===');
  await tool('app_clear_caches', {});
  await sleep(300);
  await tool('app_open_pdf', { path: PDF });
  await sleep(8000); // settle thumbnails

  const t0 = Date.now();
  for (const p of [2, 3, 4, 5]) {
    const t = Date.now();
    await tool('app_go_to_page', { page: p });
    await sleep(2000);
    console.log(`  p${p}: ${Date.now() - t} ms`);
  }
  const total = Date.now() - t0;
  console.log(`Total for 4 sequential pages: ${total} ms`);
  console.log('');
  console.log('v1.58.3 baseline (single proc):  ~6000 ms expected');
  console.log('v1.59.0 target  (5 PDFium pool): ~1500 ms target');
})().catch(e => { console.error('PROBE_ERR:', e.message); process.exit(1); });
