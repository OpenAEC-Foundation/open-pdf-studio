import { verificationPath } from '../scripts/verification-path.mjs';
// Speed comparison: our open-pdf-render Skia kernel vs PDFium for raw
// page-render. Both go through the same Rust DocHandleCache so the
// document parse cost is shared — only the per-page render is timed.
//
// Caveat: open-pdf-render is < accuracy goal vs PyMuPDF reference (the
// /loop is still iterating). These numbers measure SPEED only.
//
// For each PDF:
//   1. Cold open via app_open_pdf (warms both bytes & handle cache server-side)
//   2. Call render_pdf_page (PDFium) — discard, populates pixmap cache
//   3. Call render_pdf_page_skia — first call (cold)
//   4. Call render_pdf_page_skia again — warm (open-pdf-render has its own pixmap cache)
//   5. Call render_pdf_page (PDFium) again — warm (pixmap cache)
//   Compare cold vs cold, warm vs warm.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const MCP = 'http://127.0.0.1:9223/mcp';

const PDFS = [
  { name: 'Tekst.pdf',                  path: verificationPath('PDF-bestanden/Tekst.pdf'),                  pages: [1, 2] },
  { name: 'rapport-constructie.pdf',    path: verificationPath('PDF-bestanden/rapport-constructie.pdf'),    pages: [1, 5] },
  { name: 'NKE2D2_opm_aw.pdf',          path: verificationPath('PDF-bestanden/NKE2D2_opm_aw.pdf'),          pages: [1, 2] },
  { name: 'NKD1a_opm_aw.pdf',           path: verificationPath('PDF-bestanden/NKD1a_opm_aw.pdf'),           pages: [1, 2, 4] },
  { name: 'BARN Relocation',            path: verificationPath('PDF-bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf'), pages: [1, 4] },
];

let id = 1;
async function rpc(method, params) {
  const r = await fetch(MCP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];

  console.log('\n=== open-pdf-render (Skia) vs PDFium — pure render time ===');
  console.log('PDF                                Page Scale | PDFium cold  Skia cold  | PDFium warm  Skia warm  | cold ratio');
  console.log('-'.repeat(120));

  for (const pdf of PDFS) {
    const opened = await tool('app_open_pdf', { path: pdf.path });
    if (!opened?.ok) { console.log(`  ${pdf.name.padEnd(36)} FAILED: ${opened?.error}`); continue; }
    await sleep(500);

    for (const pgNum of pdf.pages) {
      if (pgNum > opened.page_count) continue;
      const scale = 1.0;

      // Clear pixmap caches first so cold timing is real
      await tool('app_clear_caches', {});
      await sleep(150);

      const r = await page.evaluate(async ({ path, pgNum, scale }) => {
        const args = { path, pageIndex: pgNum - 1, scale, rotation: 0 };
        const t = (fn) => fn().then(buf => ({ ms: Math.round(performance.now() - t0), bytes: (buf instanceof Uint8Array ? buf : new Uint8Array(buf)).length }));
        let t0;

        // PDFium cold
        t0 = performance.now();
        const pdfiumColdR = await window.__TAURI__.core.invoke('render_pdf_page', args);
        const pdfiumCold = { ms: Math.round(performance.now() - t0), bytes: (pdfiumColdR instanceof Uint8Array ? pdfiumColdR : new Uint8Array(pdfiumColdR)).length };

        // Skia cold (first call after fresh cache; pdfium cache won't affect this because they're separate caches)
        t0 = performance.now();
        let skiaCold;
        try {
          const r = await window.__TAURI__.core.invoke('render_pdf_page_skia', args);
          skiaCold = { ms: Math.round(performance.now() - t0), bytes: (r instanceof Uint8Array ? r : new Uint8Array(r)).length };
        } catch (e) {
          skiaCold = { error: e.message };
        }

        // PDFium warm (hits pixmap cache)
        t0 = performance.now();
        const pdfiumWarmR = await window.__TAURI__.core.invoke('render_pdf_page', args);
        const pdfiumWarm = { ms: Math.round(performance.now() - t0), bytes: (pdfiumWarmR instanceof Uint8Array ? pdfiumWarmR : new Uint8Array(pdfiumWarmR)).length };

        // Skia warm (hits its own pixmap cache in open-pdf-render)
        t0 = performance.now();
        let skiaWarm;
        try {
          const r = await window.__TAURI__.core.invoke('render_pdf_page_skia', args);
          skiaWarm = { ms: Math.round(performance.now() - t0), bytes: (r instanceof Uint8Array ? r : new Uint8Array(r)).length };
        } catch (e) {
          skiaWarm = { error: e.message };
        }

        return { pdfiumCold, skiaCold, pdfiumWarm, skiaWarm };
      }, { path: pdf.path, pgNum, scale });

      const fmt = (x, label = 'ms') => x?.error ? `ERR(${x.error?.slice(0,18)})` : `${x?.ms ?? '-'}${label}`;
      const ratio = (r.pdfiumCold?.ms && r.skiaCold?.ms) ? `${(r.skiaCold.ms / r.pdfiumCold.ms).toFixed(2)}x` : '-';
      const row = [
        pdf.name.padEnd(36),
        String(pgNum).padStart(4),
        scale.toFixed(1).padStart(5),
        fmt(r.pdfiumCold).padStart(11),
        fmt(r.skiaCold).padStart(10),
        fmt(r.pdfiumWarm).padStart(12),
        fmt(r.skiaWarm).padStart(10),
        ratio.padStart(10),
      ].join(' ');
      console.log(row);
    }
  }
  await browser.close();
})().catch(e => { console.error('PROBE_ERR:', e.message); process.exit(1); });
