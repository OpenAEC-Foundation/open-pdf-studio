import { verificationPath } from '../scripts/verification-path.mjs';
// Wall-clock open-time probe for NKD1a (or any path passed as argv[2]).
// Calls the live app via MCP JSON-RPC and captures the in-app [PERF] log.

const MCP = 'http://127.0.0.1:9223/mcp';
const PDF_PATH = process.argv[2] ||
  verificationPath('PDF-bestanden/NKD1a_opm_aw.pdf');

let id = 1;
async function rpc(method, params) {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function tool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}

(async () => {
  console.log('--- clear caches');
  await tool('app_clear_caches', {});

  // Snapshot console-buffer cutoff so we only see this open's entries.
  const sinceCut = Date.now();

  console.log(`--- open ${PDF_PATH}`);
  const t0 = performance.now();
  const r = await tool('app_open_pdf', { path: PDF_PATH });
  const wall = (performance.now() - t0).toFixed(0);
  console.log(`--- app_open_pdf returned in ${wall} ms`);
  console.log('--- result:', JSON.stringify(r).slice(0, 200));

  // Wait longer so post-open background work flushes (thumbnails take ~2s).
  await new Promise(res => setTimeout(res, 3000));

  const perf = await tool('app_get_recent_console', { since: sinceCut });
  console.log('--- bufferSize:', perf?.bufferSize, 'returned:', perf?.entries?.length);
  const arr = perf?.entries || [];
  for (const l of arr) {
    const dt = l.t - sinceCut;
    console.log(`  [+${String(dt).padStart(5)}ms] ${l.text}`);
  }
})().catch(e => {
  console.error('PROBE_ERR:', e.message);
  process.exit(1);
});
