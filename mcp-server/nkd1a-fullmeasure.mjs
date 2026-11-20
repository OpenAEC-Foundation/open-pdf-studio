import { verificationPath } from '../scripts/verification-path.mjs';
// Complete NKD1a performance measurement.
//
// Phases:
//   1. Cold open (clear caches, app_open_pdf) → first-paint preview + crisp
//   2. Page nav cold (p2..p7 one at a time, settle between)
//   3. Page nav warm (re-visit p2..p7) — should be cached
//   4. Summary: where the time goes
//
// Reports wall-clock + key [PERF] markers (renderPage TOTAL, bitmap renders).

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

function consoleSince(events, cutoff, regex) {
  return events.filter(e => e.t >= cutoff && regex.test(e.text));
}
function findLast(events, cutoff, regex) {
  const matches = events.filter(e => e.t >= cutoff && regex.test(e.text));
  return matches[matches.length - 1] || null;
}

(async () => {
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];
  const events = [];
  page.on('console', m => events.push({ t: Date.now(), text: m.text() }));

  // Get app version
  const title = await page.evaluate(() => document.title);
  console.log(`App: ${title}`);
  console.log('');

  // === PHASE 1: Cold open ===
  console.log('--- PHASE 1: COLD OPEN ---');
  await tool('app_clear_caches', {});
  await sleep(500);
  const t1 = Date.now();
  await tool('app_open_pdf', { path: PDF });
  // Wait for everything to settle (~10s for NKD1a annotations + first paint)
  await sleep(12000);

  // Find key markers
  const preview = findLast(events, t1, /cold-open preview painted/);
  const getDoc = findLast(events, t1, /PDF\.js getDocument done/);
  const rp1Total = findLast(events, t1, /renderPage\(1\) TOTAL/);
  const annotDone = findLast(events, t1, /loadExistingAnnotations DONE/);
  console.log(`  First paint (preview):  ${preview ? preview.t - t1 + 'ms' : 'n/a'}`);
  console.log(`  PDF.js getDocument:     ${getDoc ? getDoc.t - t1 + 'ms' : 'n/a'}`);
  console.log(`  renderPage(1) done:     ${rp1Total ? rp1Total.t - t1 + 'ms' : 'n/a'}`);
  console.log(`  Annotations loaded:     ${annotDone ? annotDone.t - t1 + 'ms' : 'n/a'}`);
  console.log('');

  // === PHASE 2: Per-page nav COLD ===
  console.log('--- PHASE 2: PER-PAGE NAV (COLD, after settle) ---');
  const coldTimes = {};
  for (const pn of [2, 3, 4, 5, 6, 7]) {
    const t = Date.now();
    await tool('app_go_to_page', { page: pn });
    // Wait for renderPage to log TOTAL
    await sleep(800);
    const last = findLast(events, t, new RegExp(`renderPage\\(${pn}\\) TOTAL`));
    // Also look for any bitmap render in same window
    const rastered = findLast(events, t, /Raster viewport activated/);
    coldTimes[pn] = { total: last ? last.t - t : null, raster: rastered ? rastered.t - t : null };
    console.log(`  Page ${pn}: renderPage TOTAL = ${coldTimes[pn].total}ms, raster activated = ${coldTimes[pn].raster}ms`);
  }
  console.log('');

  // === PHASE 3: Per-page nav WARM (re-visit) ===
  console.log('--- PHASE 3: PER-PAGE NAV (WARM, second visit) ---');
  const warmTimes = {};
  for (const pn of [2, 3, 4, 5, 6, 7]) {
    const t = Date.now();
    await tool('app_go_to_page', { page: pn });
    await sleep(500);
    const last = findLast(events, t, new RegExp(`renderPage\\(${pn}\\) TOTAL`));
    warmTimes[pn] = last ? last.t - t : null;
    console.log(`  Page ${pn}: renderPage TOTAL = ${warmTimes[pn]}ms`);
  }
  console.log('');

  // === SUMMARY ===
  console.log('=== SUMMARY ===');
  const coldVals = Object.values(coldTimes).map(c => c.total).filter(v => v != null);
  const warmVals = Object.values(warmTimes).filter(v => v != null);
  const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;
  const max = arr => arr.length ? Math.max(...arr) : 0;
  console.log(`Cold per-page nav: avg=${avg(coldVals)}ms, max=${max(coldVals)}ms (n=${coldVals.length})`);
  console.log(`Warm per-page nav: avg=${avg(warmVals)}ms, max=${max(warmVals)}ms (n=${warmVals.length})`);
  console.log('');
  console.log('Note: renderPage TOTAL is the JS-side time (analyze + extract + viewport setup).');
  console.log('The async PDFium bitmap render via bitmap-orchestrator happens IN PARALLEL.');
  console.log('User sees pixels in 2 stages: (a) viewport activated (canvas exists), (b) PDFium bitmap painted.');

  await browser.close();
})().catch(e => { console.error('PROBE_ERR:', e.message); process.exit(1); });
