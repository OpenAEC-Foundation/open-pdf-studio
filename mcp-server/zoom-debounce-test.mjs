import { verificationPath } from '../scripts/verification-path.mjs';
// Zoom-debounce test: dispatch 8 rapid zoom-in steps and measure total
// CPU spent on rendering. Compares with-freeze vs without-freeze conceptually
// by observing how many _render() executions actually do the heavy vector
// paint vs skip via freeze.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const MCP = 'http://127.0.0.1:9223/mcp';
const PDF = verificationPath('PDF-bestanden/NKD1a_opm_aw.pdf');

async function tool(name, args) {
  const r = await fetch(MCP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await r.json();
  const text = j?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];

  await tool('app_clear_caches', {});
  const TEST_PDF = process.argv[2] || verificationPath('PDF-bestanden/NKE2D2_opm_aw.pdf');
  const TEST_PAGE = Number(process.argv[3] || 1);
  await tool('app_open_pdf', { path: TEST_PDF });
  await tool('app_go_to_page', { page: TEST_PAGE });
  await sleep(8000); // long settle so thumbnails + background work doesn't dominate IPC queue

  await page.evaluate(() => { window.__zoomFreezeFrameCount = 0; });
  console.log(`${TEST_PDF.split(/[\\\\/]/).pop()} page ${TEST_PAGE}. Starting rapid zoom-in test (8 steps)...\n`);

  // Instrument _render to count calls and time
  await page.evaluate(() => {
    const vp = window.__pdfViewport;
    if (!vp) { console.warn('no viewport'); return; }
    window.__zoomTestStats = { renderCalls: 0, totalMs: 0, perCall: [] };
  });

  const t0 = Date.now();

  // Dispatch 8 rapid zoom-in via the app_zoom_in tool (which goes through zoomStepAtCenter)
  for (let i = 0; i < 8; i++) {
    await tool('app_zoom_in', {});
    // No sleep between — as fast as the IPC allows
  }
  console.log(`8 zoom_in dispatches done in ${Date.now() - t0} ms`);

  // Wait for freeze to release + final render to complete
  await sleep(500);

  const freezeCount = await page.evaluate(() => window.__zoomFreezeFrameCount || 0);
  console.log(`__zoomFreezeFrameCount = ${freezeCount}  (frames painted via freeze fast-path during the 8 steps)`);

  // Capture viewport state to confirm we're at the higher zoom
  const finalState = await tool('app_get_viewport_state', {});
  console.log(`Final zoom: ${finalState.viewport.zoom.toFixed(3)}, file: ${finalState.viewport.filePath?.split(/[\\\\/]/).pop()}, page: ${finalState.viewport.pageNum}`);
  console.log(`Engine: ${finalState.engine}`);

  // Check recent console for [PERF] entries
  const since = t0;
  const log = await tool('app_get_recent_console', { since });
  console.log('\nConsole entries during test:');
  for (const e of (log.entries || []).slice(-25)) {
    if (/freeze|zoom|render|tile/i.test(e.text)) {
      console.log(`  +${e.t - since}ms ${e.text.slice(0, 120)}`);
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
