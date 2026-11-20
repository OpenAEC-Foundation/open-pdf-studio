import { verificationPath } from '../scripts/verification-path.mjs';
// Engine comparison probe — PDF.js vs Rust kernel.
//
// For each test PDF: cold open (file-read + PDF.js getDocument + Rust render
// preview), then navigate through pages and capture all [PERF] timing entries.
// Reports a single table per PDF + a summary.

const MCP = 'http://127.0.0.1:9223/mcp';
const TEST_DIR = verificationPath('PDF-bestanden') + '/';

const PDFS = [
  { name: 'Tekst.pdf',                          path: TEST_DIR + 'Tekst.pdf',                                                       sizeMB:  0.2 },
  { name: '3131-CLT-Set.pdf',                   path: TEST_DIR + '3131-CLT-Set.pdf',                                                sizeMB:  1.5 },
  { name: 'rapport-constructie.pdf',            path: TEST_DIR + 'rapport-constructie.pdf',                                         sizeMB:  1.7 },
  { name: 'NKE2D2_opm_aw.pdf',                  path: TEST_DIR + 'NKE2D2_opm_aw.pdf',                                               sizeMB:  5.9 },
  { name: 'Zware vector PDF.pdf',               path: TEST_DIR + 'Zware vector PDF.pdf',                                            sizeMB: 17.9 },
  { name: 'NKD1a_opm_aw.pdf',                   path: TEST_DIR + 'NKD1a_opm_aw.pdf',                                                sizeMB: 24.8 },
  { name: 'BARN Relocation',                    path: TEST_DIR + '20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf', sizeMB: 26.8 },
  { name: '2885 Demo project.pdf',              path: TEST_DIR + '2885 Demo project.pdf',                                           sizeMB: 39.5 },
];

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
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractMs(text, marker) {
  // Match e.g. "PDF.js getDocument done: 591ms" — but the format uses cumulative ms.
  const m = text.match(new RegExp(marker + `[^:]*:\\s*(\\d+)ms`));
  return m ? Number(m[1]) : null;
}

async function measureOne(pdf, pageCount) {
  await tool('app_clear_caches', {});
  await sleep(200);

  const t0 = Date.now();
  const sinceCut = t0;
  const wallT0 = performance.now();
  const result = await tool('app_open_pdf', { path: pdf.path });
  const wallOpen = performance.now() - wallT0;
  if (!result?.ok) return { pdf: pdf.name, error: result?.error || 'open failed' };

  // Wait briefly for first-paint + thumbnail loop to settle.
  await sleep(800);

  const consoleLog = await tool('app_get_recent_console', { since: sinceCut });
  const lines = consoleLog?.entries || [];

  // Pull out the key cumulative timings (all measured from loadPDF start).
  const findFirst = (m) => {
    for (const e of lines) {
      const ms = extractMs(e.text, m);
      if (ms !== null) return { ms, text: e.text };
    }
    return null;
  };
  const fileRead     = findFirst('File read done');
  const getDocument  = findFirst('PDF.js getDocument done');
  const setView      = findFirst('setViewMode START');
  // cold-open preview painted timer is its OWN base (Rust render duration only)
  const previewLine  = lines.find(e => /cold-open preview painted/.test(e.text));
  const previewMs    = previewLine ? Number(previewLine.text.match(/painted:\s*(\d+)/)?.[1] || 0) : null;
  const renderP1Total = findFirst('renderPage\\(1\\) TOTAL');
  const analyzeMs    = findFirst('renderPage\\(1\\) analyze_page_type=');

  // Now navigate to a middle page and measure cold per-page nav.
  let navMs = null, navAnalyzeMs = null;
  const navPage = pdf.name.toLowerCase().startsWith('tekst') ? 1
                : Math.min(pdf.name.includes('Demo') ? 4 : 3, result.page_count || 2);
  if (result.page_count > 1) {
    const sinceNav = Date.now();
    await tool('app_go_to_page', { page: navPage });
    await sleep(1500); // wait for tile render
    const navConsole = await tool('app_get_recent_console', { since: sinceNav });
    const navLines = navConsole?.entries || [];
    const navTotal = navLines.find(e => new RegExp(`renderPage\\(${navPage}\\) TOTAL`).test(e.text));
    if (navTotal) navMs = Number(navTotal.text.match(/TOTAL:\s*(\d+)/)?.[1] || 0);
    const navAnal = navLines.find(e => new RegExp(`renderPage\\(${navPage}\\) analyze_page_type=`).test(e.text));
    if (navAnal) navAnalyzeMs = Number(navAnal.text.match(/=\w+:\s*(\d+)/)?.[1] || 0);
  }

  return {
    pdf: pdf.name,
    sizeMB: pdf.sizeMB,
    pages: result.page_count,
    fileReadMs: fileRead?.ms ?? null,
    getDocMs:   getDocument?.ms ?? null,           // cumulative — subtract fileRead for raw PDF.js cost
    pdfjsRawMs: (getDocument && fileRead) ? getDocument.ms - fileRead.ms : null,
    previewMs:  previewMs,                          // Rust render time for page 1
    p1RenderMs: renderP1Total?.ms ?? null,         // Vector/raster render after getDocument
    p1AnalyzeMs: analyzeMs?.ms ?? null,
    navPage,
    navTotalMs: navMs,
    navAnalyzeMs,
    wallOpenMs: Math.round(wallOpen),
  };
}

(async () => {
  console.log('Probing engine performance per PDF...');
  console.log('');
  const results = [];
  for (const pdf of PDFS) {
    process.stdout.write(`  ${pdf.name.padEnd(36)} `);
    try {
      const r = await measureOne(pdf);
      results.push(r);
      console.log(r.error ? `ERROR: ${r.error}` : `${r.pages}p, fileR=${r.fileReadMs}ms pdfjs=${r.pdfjsRawMs}ms rustPreview=${r.previewMs}ms p1Render=${r.p1RenderMs}ms`);
    } catch (e) {
      console.log('CRASH: ' + e.message);
      results.push({ pdf: pdf.name, error: e.message });
    }
  }
  console.log('');
  console.log('===== SUMMARY TABLE =====');
  console.log('PDF                                  Size  Pages | FileRead PDFjs(parse) RustPreview P1Render P1Analyze | NavPg NavTotal NavAnalyze');
  console.log('-'.repeat(150));
  for (const r of results) {
    if (r.error) { console.log(`${r.pdf.padEnd(36)}  ERR ${r.error}`); continue; }
    const row = [
      r.pdf.padEnd(36),
      String(r.sizeMB).padStart(5) + 'MB',
      String(r.pages).padStart(3) + 'p',
      String(r.fileReadMs ?? '-').padStart(6),
      String(r.pdfjsRawMs ?? '-').padStart(10),
      String(r.previewMs ?? '-').padStart(10),
      String(r.p1RenderMs ?? '-').padStart(7),
      String(r.p1AnalyzeMs ?? '-').padStart(8),
      String(r.navPage ?? '-').padStart(4),
      String(r.navTotalMs ?? '-').padStart(7),
      String(r.navAnalyzeMs ?? '-').padStart(9),
    ].join(' ');
    console.log(row);
  }
  console.log('');
  // Comparative ratio: how much of cold open is PDF.js vs Rust render
  console.log('===== PDF.js vs Rust cold-open share =====');
  for (const r of results) {
    if (r.error || !r.pdfjsRawMs || !r.previewMs) continue;
    const total = (r.fileReadMs ?? 0) + r.pdfjsRawMs;
    const ratio = (r.pdfjsRawMs / total * 100).toFixed(0);
    console.log(`  ${r.pdf.padEnd(36)} PDF.js ${r.pdfjsRawMs}ms (${ratio}% of pre-render path) vs Rust render ${r.previewMs}ms`);
  }
})().catch(e => { console.error('PROBE_FATAL:', e.message); process.exit(1); });
