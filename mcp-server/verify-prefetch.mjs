// Prove the idle-gated prefetch on a HEAVY vector PDF (slow per-page extract =
// the real page-switch-delay case). Far-jump to an uncached page, then poll
// whether the NEXT page's draw-commands get primed into the cache on their own.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const MCP = 'http://127.0.0.1:9223/mcp';
const PDF = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/Zware vector PDF.pdf';

async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); const t = j?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return t; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];
  const ev = []; page.on('console', m => ev.push({ t: Date.now(), text: m.text() }));
  const findLast = (cut, re) => { const m = ev.filter(e => e.t >= cut && re.test(e.text)); return m[m.length - 1] || null; };
  const numPages = () => page.evaluate(async () => { const s = await import('/js/core/state.ts'); const d = s.state.documents[s.state.activeDocumentIndex]; return d?.pdfDoc?.numPages || 0; }).catch(() => 0);
  const cached = (n) => page.evaluate(async (pn) => { const vr = await import('/js/pdf/vector-renderer.js'); const s = await import('/js/core/state.ts'); const d = s.state.documents[s.state.activeDocumentIndex]; return d ? vr.hasCachedCommands(d.filePath, pn, 0) : null; }, n);

  await tool('app_clear_caches', {}); await sleep(400);
  let pc = 0;
  for (let a = 1; a <= 2 && !pc; a++) { await tool('app_open_pdf', { path: PDF }); for (let i = 0; i < 16 && !pc; i++) { await sleep(700); pc = await numPages(); } }
  console.log(`pageCount=${pc}`);
  if (pc < 6) { console.log('not enough pages'); await browser.close(); process.exit(2); }
  await sleep(4000);

  // Confirm it's vector: visit p1 and wait (heavy extract may take seconds).
  await tool('app_go_to_page', { page: 1 });
  let vec = false; for (let i = 0; i < 16 && !vec; i++) { await sleep(700); vec = await cached(1); }
  console.log(`page1 vector-cached after wait = ${vec}`);
  if (!vec) { console.log('Not vector (or extract failed) — cannot test vector prefetch here'); await browser.close(); process.exit(3); }

  // Far jump to an uncached region, then watch the NEXT page get primed.
  const FAR = 9, NEXT = 10;
  const t = Date.now();
  await tool('app_go_to_page', { page: FAR });
  await sleep(300);
  const nextAtStart = await cached(NEXT);                 // expect false (debounce 600ms not fired yet)
  const farRender = findLast(t, new RegExp(`renderPage\\(${FAR}\\) TOTAL`));
  // poll up to ~16s for prefetch to prime NEXT
  let primedAt = null;
  for (let i = 0; i < 24; i++) { await sleep(700); if (await cached(NEXT)) { primedAt = Math.round((Date.now() - t)); break; } }
  console.log(`p${FAR} render: ${(farRender?.text || '').trim()}`);
  console.log(`cached(p${NEXT}) right after jump = ${nextAtStart}`);
  console.log(`cached(p${NEXT}) primed = ${primedAt !== null ? 'YES @ ~' + primedAt + 'ms' : 'NO (within 16s)'}`);
  console.log(`PREFETCH ${(!nextAtStart && primedAt !== null) ? 'CONFIRMED ✓' : 'not observed'}`);

  // Now navigate to NEXT — should be a cache hit (fast).
  const t2 = Date.now(); await tool('app_go_to_page', { page: NEXT }); await sleep(1500);
  console.log(`p${NEXT} nav after prefetch: ${(findLast(t2, new RegExp(`renderPage\\(${NEXT}\\) TOTAL`))?.text || '').trim()}`);
  console.log(`[prefetch] logs: ${JSON.stringify([...new Set(ev.filter(e => /\[prefetch\]/.test(e.text)).map(e => e.text))])}`);
  console.log(`errors: ${JSON.stringify(ev.filter(e => /error|Uncaught|TypeError|not a function/i.test(e.text)).map(e=>e.text).slice(0,5))}`);
  await browser.close();
})().catch(e => { console.error('PROBE_ERR:', e.message); process.exit(1); });
