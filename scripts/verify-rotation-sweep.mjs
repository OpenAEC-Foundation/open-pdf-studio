// Rotatie/weergave-sweep over alle verificatie-PDF's: opent elk bestand in de
// live rig (--mcp-server, poort 9223), wacht tot de pagina daadwerkelijk inkt
// bevat, schrijft een screenshot-PNG van pagina 1 (en een middenpagina bij
// meerpagina-documenten) en logt per bestand de actieve render-engine.
//
// De PNG's zijn bedoeld om HANDMATIG te beoordelen (orientatie, compleetheid,
// annotatie-orientatie) — de ink-drempel vangt alleen blanco/mislukte renders.
//
// Gebruik:
//   node scripts/verify-rotation-sweep.mjs <output-dir> [dir1] [dir2] ...
// Zonder dir-argumenten worden de twee standaard-verificatiemappen gebruikt.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const MCP = 'http://127.0.0.1:9223/mcp';
const DEFAULT_DIRS = [
  'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden',
  'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden',
];
const OUT = process.argv[2];
if (!OUT) { console.error('gebruik: node scripts/verify-rotation-sweep.mjs <output-dir> [dirs...]'); process.exit(2); }
const DIRS = process.argv.length > 3 ? process.argv.slice(3) : DEFAULT_DIRS;
fs.mkdirSync(OUT, { recursive: true });

async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json();
  const t = j?.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return t; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (f) => f.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);

(async () => {
  // Zelfde CDP-poort als de andere poortscripts (CDP_PORT, standaard 9345);
  // 127.0.0.1 i.p.v. localhost, anders probeert Node eerst IPv6 (::1).
  const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${process.env.CDP_PORT || '9345'}`);
  const page = browser.contexts()[0].pages()[0];
  // Ink-percentage van het zichtbare pdf-canvas (niet-witte, niet-transparante pixels).
  const ink = () => page.evaluate(() => {
    const c = document.getElementById('pdf-canvas');
    if (!c || !c.width) return { i: 0 };
    const x = c.getContext('2d');
    let d; try { d = x.getImageData(0, 0, c.width, c.height).data; } catch { return { i: -1 }; }
    let n = 0, t = 0;
    for (let k = 0; k < d.length; k += 4 * 17) { t++; if (d[k + 3] > 0 && !(d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245)) n++; }
    return { i: +(100 * n / t).toFixed(1) };
  });
  // Via MCP i.p.v. een module-import: in een release- of geinstalleerde build
  // zijn de modules gebundeld en werkt import('/js/...') niet.
  const numPages = async () => (await tool('app_get_page_count', {}))?.pageCount || 0;
  const waitInk = async (max = 20) => {
    let best = 0;
    for (let i = 0; i < max; i++) { await sleep(1400); const w = await ink(); if (w.i > best) best = w.i; if (w.i > 2.5) break; }
    return best;
  };
  const shoot = async (dest) => {
    // Settle-delay: direct na waitInk kan een schaal-herrender de canvas net
    // hebben leeggemaakt; zonder pauze levert dat vals-blanco screenshots op.
    await sleep(2500);
    const s = await tool('app_screenshot_view', { width: 1100 });
    const b64 = s?.png_base64 || s?.image || (typeof s === 'string' ? s : null);
    if (!b64) return false;
    fs.writeFileSync(dest, Buffer.from(b64.split(',').pop(), 'base64'));
    return true;
  };

  const rows = [];
  let dirIdx = 0;
  for (const dir of DIRS) {
    dirIdx++;
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
    console.log(`\n=== ${dir} (${files.length} bestanden) ===`);
    for (const f of files) {
      const t0 = Date.now();
      await tool('app_clear_caches', {}); await sleep(300);
      const opened = await tool('app_open_pdf', { path: `${dir}/${f}` });
      let pc = 0;
      for (let i = 0; i < 120 && !pc; i++) { await sleep(700); pc = await numPages(); }
      if (!pc || opened?.ok === false) {
        console.log(`OPEN-FAIL  ${f}`);
        rows.push({ dir, file: f, status: 'OPEN-FAIL' });
        continue;
      }
      const p1 = await waitInk();
      const vp = await tool('app_get_viewport_state', {});
      const engine = vp?.engine || '?';
      // Map-index in de bestandsnaam: dezelfde PDF kan in meerdere mappen
      // voorkomen en zou anders zijn eigen screenshot overschrijven.
      const base = path.join(OUT, `d${dirIdx}-${safe(f)}`);
      await shoot(`${base}-p1.png`);
      let midInfo = '';
      if (pc > 1) {
        const mid = Math.max(2, Math.ceil(pc / 2));
        await tool('app_go_to_page', { page: mid });
        const pm = await waitInk();
        await shoot(`${base}-p${mid}.png`);
        midInfo = ` p${mid}=${pm}%`;
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      const status = p1 > 2 ? 'RENDERT' : 'BLANK';
      console.log(`${status.padEnd(9)} ${f.slice(0, 46).padEnd(46)} pages=${String(pc).padStart(3)} p1=${p1}%${midInfo} engine=${engine} ${secs}s`);
      rows.push({ dir, file: f, status, pages: pc, p1, engine });
      // Sluit de tab weer om geheugen-opbouw over tientallen zware bestanden te voorkomen.
      const tabs = await tool('app_list_tabs', {});
      const idx = tabs?.tabs?.find((t) => t.active)?.index;
      if (idx !== undefined) await tool('app_close_tab', { index: idx, force: true });
    }
  }
  fs.writeFileSync(path.join(OUT, 'sweep-summary.json'), JSON.stringify(rows, null, 2));
  const fails = rows.filter((r) => r.status !== 'RENDERT');
  console.log(`\n${rows.length - fails.length}/${rows.length} renderen. ${fails.length ? 'AFWIJKEND: ' + fails.map((r) => r.file).join(', ') : 'ALLE OK'}`);
  await browser.close();
  process.exit(0);
})();
