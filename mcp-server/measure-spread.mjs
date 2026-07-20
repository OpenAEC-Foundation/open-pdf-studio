// Meet MV-03 progressieve render: tijd tot eerste tegel / klaar + piek-RSS
// van de pdfium-workers. Gebruik: node mcp-server/measure-spread.mjs <label>
import { execSync } from 'child_process';

const MCP = 'http://127.0.0.1:9223/mcp';
const PDF = 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/MV-03_Mechanische ventilatie, 3e verdieping ontwerp ACH van 1,5 naar 2,0.pdf';
const LABEL = process.argv[2] || 'meting';

async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); const t = j?.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return t; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function workerRss() {
  try {
    const out = execSync('powershell -NoProfile -Command "(Get-Process pdfium-worker -ErrorAction SilentlyContinue | ForEach-Object { [math]::Round($_.WorkingSet64/1MB) }) -join \',\'"', { timeout: 8000 }).toString().trim();
    return out ? out.split(',').map(Number) : [];
  } catch { return []; }
}

(async () => {
  const t0 = Date.now();
  const peaks = { perWorker: [], totalPeak: 0, samples: 0 };
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const rss = workerRss();
      if (rss.length) {
        peaks.samples++;
        const total = rss.reduce((a, b) => a + b, 0);
        if (total > peaks.totalPeak) { peaks.totalPeak = total; peaks.perWorker = rss.slice().sort((a, b) => b - a); }
      }
      await sleep(700);
    }
  })();

  console.log(`[${LABEL}] MV-03 openen...`);
  await tool('app_open_pdf', { path: PDF });

  // Wacht op [prog] klaar (max 120s), poll console — cumulatief verzamelen
  // zodat een vroege klaar-regel niet uit de ring-buffer wegdrukt.
  let done = false;
  const seen = new Map();
  for (let i = 0; i < 120 && !done; i++) {
    await sleep(1000);
    const cons = await tool('app_get_recent_console', { limit: 400 });
    const entries = Array.isArray(cons) ? cons : (cons?.entries || []);
    for (const e of entries) {
      const txt = (e.text || '').trim();
      if (/\[prog\]|\[bo\]/.test(txt) && !seen.has(txt)) seen.set(txt, Date.now() - t0);
    }
    done = [...seen.keys()].some(t => /\[prog\] klaar/.test(t));
  }
  await sleep(2000);
  sampling = false; await sampler;

  console.log(`\n[${LABEL}] prog-regels (@wall):`);
  for (const [txt, at] of seen) console.log(`   ${(at / 1000).toFixed(1)}s  ${txt.slice(0, 110)}`);
  console.log(`[${LABEL}] wall tot klaar-detectie: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[${LABEL}] PIEK totaal RSS workers: ${peaks.totalPeak} MB  per-worker(top): ${peaks.perWorker.join(', ')} MB  (samples: ${peaks.samples})`);
  const after = workerRss();
  console.log(`[${LABEL}] RSS nu: ${after.join(', ')} MB (som ${after.reduce((a, b) => a + b, 0)} MB)`);
})();
