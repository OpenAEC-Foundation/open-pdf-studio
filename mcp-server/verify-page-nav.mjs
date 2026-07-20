// Verify the page-switch optimisation on a VECTOR multi-page PDF.
//   1. prefetch: page+1's draw-commands get primed into the cache after a nav
//      (vr.hasCachedCommands(p+1) flips false -> true without visiting it)
//   2. placeholder: #page-transition-placeholder becomes display:block with the
//      thumbnail src synchronously at goToPage() (before render completes)
//   3. timing: cold first nav vs prefetch-primed next nav
//
// Usage: node mcp-server/verify-page-nav.mjs

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const MCP = 'http://127.0.0.1:9223/mcp';
const PDF = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/3131-CLT-Set.pdf';

async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); const text = j?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];
  const ev = []; page.on('console', m => ev.push({ t: Date.now(), text: m.text() }));
  const findLast = (cut, re) => { const m = ev.filter(e => e.t >= cut && re.test(e.text)); return m[m.length - 1] || null; };
  const numPages = () => page.evaluate(async () => { const s = await import('/js/core/state.ts'); const d = s.state.documents[s.state.activeDocumentIndex]; return d?.pdfDoc?.numPages || 0; }).catch(() => 0);
  const cached = (pn) => page.evaluate(async (n) => { const vr = await import('/js/pdf/vector-renderer.js'); const s = await import('/js/core/state.ts'); const d = s.state.documents[s.state.activeDocumentIndex]; return d ? vr.hasCachedCommands(d.filePath, n, 0) : null; }, pn);

  await tool('app_clear_caches', {}); await sleep(500);
  let pc = 0;
  for (let a = 1; a <= 3 && !pc; a++) { await tool('app_open_pdf', { path: PDF }); for (let i = 0; i < 20 && !pc; i++) { await sleep(700); pc = await numPages(); } }
  console.log(`pageCount = ${pc}`);
  if (!pc) { console.log('OPEN FAILED (scope/path?)'); await browser.close(); process.exit(2); }
  await sleep(5000); // settle p1 + let visible thumbnails render

  const thumbs = await page.evaluate(async () => { const ts = await import('/js/solid/stores/panels/thumbnailStore.js'); const d = ts.thumbnailData || {}; const keys = Object.keys(d).filter(k => d[k] && String(d[k]).length > 50); return { count: keys.length, keys: keys.slice(0, 12) }; });
  console.log(`thumbnails ready: ${JSON.stringify(thumbs)}`);

  await tool('app_go_to_page', { page: 1 }); await sleep(1500);

  // ── PREFETCH ──
  const before = { p2: await cached(2), p3: await cached(3) };
  const t2 = Date.now();
  await tool('app_go_to_page', { page: 2 });
  await sleep(2800); // cold render of p2 + 600ms prefetch debounce → should prime p3
  const after = { p2: await cached(2), p3: await cached(3) };
  console.log(`p2 PERF: ${(findLast(t2, /analyze_page_type=/)?.text || '').trim()} | ${(findLast(t2, /renderPage\(2\) TOTAL/)?.text || '').trim()}`);
  console.log(`cached BEFORE nav→2:  ${JSON.stringify(before)}`);
  console.log(`cached AFTER  nav→2:  ${JSON.stringify(after)}   <- p3 false→true = prefetch primed it`);

  const t3 = Date.now(); await tool('app_go_to_page', { page: 3 }); await sleep(1500);
  console.log(`p3 nav: ${(findLast(t3, /renderPage\(3\) TOTAL/)?.text || '').trim()}   <- fast = served from prefetch cache`);

  // ── PLACEHOLDER ── force thumbnail generation first (headless drive has the
  // sidebar closed, so no thumbnails render on their own), then synchronous peek
  // (showPagePlaceholder runs before renderPage's first await).
  const ph = await page.evaluate(async () => {
    const lp = await import('/js/ui/panels/left-panel.js');
    const ts = await import('/js/solid/stores/panels/thumbnailStore.js');
    try { if (lp.generateThumbnails) await lp.generateThumbnails(); } catch {}
    let keys = [];
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 500));
      keys = Object.keys(ts.thumbnailData).filter(k => ts.thumbnailData[k] && String(ts.thumbnailData[k]).length > 50);
      if (keys.length) break;
    }
    const r = await import('/js/pdf/renderer.js');
    const target = keys.length ? Number(keys[0]) : 1;
    const p = r.goToPage(target);                 // do NOT await — placeholder is set synchronously
    const e = document.getElementById('page-transition-placeholder');
    const snap = e ? { thumbCount: keys.length, target, display: e.style.display, hasSrc: !!e.src && e.src.length > 50, w: e.style.width } : { thumbCount: keys.length, target, exists: false };
    await p;
    return snap;
  });
  console.log(`PLACEHOLDER at goToPage: ${JSON.stringify(ph)}   <- display:block + hasSrc=true = shows instantly`);

  console.log(`PREFETCH logs: ${JSON.stringify([...new Set(ev.filter(e => /\[prefetch\]/.test(e.text)).map(e => e.text))])}`);
  console.log(`ERRORS: ${JSON.stringify(ev.filter(e => /error|Uncaught|TypeError|not a function|Cannot read/i.test(e.text)).map(e => e.text).slice(0, 6))}`);
  await browser.close();
})().catch(e => { console.error('PROBE_ERR:', e.message); process.exit(1); });
