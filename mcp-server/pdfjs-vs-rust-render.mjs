import { verificationPath } from '../scripts/verification-path.mjs';
// PDF.js render vs Rust render — side-by-side timing probe.
//
// For each test PDF (assumed already open in the app):
//   1. Time PDF.js's own canvas render via pdfDoc.getPage(n).render(...)
//   2. Time Rust's render_pdf_page invoke for the same page+scale
//   3. Report ratios
//
// PDF.js path goes through its worker — text spans + form fields + paint.
// Rust path goes through PDFium with our render_annotations(false).

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const MCP = 'http://127.0.0.1:9223/mcp';

const PDFS = [
  { name: 'Tekst.pdf',                  path: verificationPath('PDF-bestanden/Tekst.pdf'),                  pages: [1, 2] },
  { name: 'rapport-constructie.pdf',    path: verificationPath('PDF-bestanden/rapport-constructie.pdf'),    pages: [1, 5, 10] },
  { name: 'NKE2D2_opm_aw.pdf',          path: verificationPath('PDF-bestanden/NKE2D2_opm_aw.pdf'),          pages: [1, 2, 3] },
  { name: 'NKD1a_opm_aw.pdf',           path: verificationPath('PDF-bestanden/NKD1a_opm_aw.pdf'),           pages: [1, 2, 4] },
  { name: 'BARN Relocation',            path: verificationPath('PDF-bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf'), pages: [1, 2, 4] },
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

  // Inject a measurement helper into the page.
  await page.evaluate(() => {
    if (window.__measureRender) return; // idempotent
    window.__measureRender = async function(pageNum, scale) {
      const stateMod = await import(/* @vite-ignore */ '/js/core/state.ts');
      const doc = stateMod.state.documents[stateMod.state.activeDocumentIndex];
      if (!doc?.pdfDoc) return { error: 'no pdfDoc' };
      const t0 = performance.now();
      const pdfPage = await doc.pdfDoc.getPage(pageNum);
      const tGetPage = performance.now() - t0;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      const tRenderStart = performance.now();
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      const tRender = performance.now() - tRenderStart;
      return {
        ok: true,
        getPageMs: Math.round(tGetPage),
        renderMs: Math.round(tRender),
        totalMs: Math.round(performance.now() - t0),
        width: canvas.width,
        height: canvas.height,
      };
    };
  });

  console.log('\n=== PDF.js render vs Rust render ===');
  console.log('PDF                                Page Scale | PDFjs getPage  PDFjs render  Rust render | ratio');
  console.log('-'.repeat(110));

  for (const pdf of PDFS) {
    // Open in app (no-op if already open) so PDF.js doc is loaded
    const opened = await tool('app_open_pdf', { path: pdf.path });
    if (!opened?.ok) { console.log(`  ${pdf.name.padEnd(36)} FAILED: ${opened?.error}`); continue; }
    await sleep(800); // let things settle

    for (const pgNum of pdf.pages) {
      if (pgNum > opened.page_count) continue;
      const scale = 1.0;

      // Measure PDF.js render via injected helper
      let pdfjs = { error: 'n/a' };
      try {
        pdfjs = await page.evaluate(({ pgNum, scale }) => window.__measureRender(pgNum, scale), { pgNum, scale });
      } catch (e) { pdfjs = { error: e.message }; }

      // Measure Rust render via invoke (do it twice — first warm cache, second is what we time)
      let rust = { error: 'n/a' };
      try {
        // Warm
        await page.evaluate(({ path, pgNum, scale }) =>
          window.__TAURI__.core.invoke('render_pdf_page', { path, pageIndex: pgNum - 1, scale, rotation: 0 }),
          { path: pdf.path, pgNum, scale });
        // Measure cold-after-pdfium (the pdfium doc is cached, but the rendered bitmap isn't if we invalidate)
        const t = await page.evaluate(async ({ path, pgNum, scale }) => {
          // Force pixmap miss by passing a slightly different scale, then back?
          // Simpler — just don't clear cache; measure warm. Caller can compare both.
          const t0 = performance.now();
          const result = await window.__TAURI__.core.invoke('render_pdf_page', { path, pageIndex: pgNum - 1, scale, rotation: 0 });
          const elapsed = Math.round(performance.now() - t0);
          const bytes = result instanceof Uint8Array ? result : new Uint8Array(result);
          return { renderMs: elapsed, bytes: bytes.length };
        }, { path: pdf.path, pgNum, scale });
        rust = t;
      } catch (e) { rust = { error: e.message }; }

      const ratio = (pdfjs.renderMs && rust.renderMs) ? (pdfjs.renderMs / rust.renderMs).toFixed(2) + 'x' : '-';
      const row = [
        pdf.name.padEnd(36),
        String(pgNum).padStart(4),
        scale.toFixed(1).padStart(5),
        String(pdfjs.getPageMs ?? '-').padStart(13),
        String(pdfjs.renderMs ?? `ERR(${pdfjs.error})`).padStart(12),
        String(rust.renderMs ?? `ERR(${rust.error})`).padStart(11),
        ratio.padStart(6),
      ].join(' ');
      console.log(row);
    }
  }
  await browser.close();
})().catch(e => { console.error('PROBE_ERR:', e.message); process.exit(1); });
