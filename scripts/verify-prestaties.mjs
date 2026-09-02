// Release-poorttest: prestatievergelijking tussen twee app-builds
// (typisch: vorige vrijgegeven versie vs. de nieuwe release-kandidaat).
// Meet per testbestand: app-start, openen-tot-eerste-inkt, zoomen naar 200%,
// en (bij meerpagina-bestanden) naar de volgende pagina.
//
// Gebruik:
//   node scripts/verify-prestaties.mjs <exe-A> <label-A> <exe-B> <label-B>
//   node scripts/verify-prestaties.mjs <exe-A> <label-A>            (één build)
//
// De exe's zijn release-builds (geïnstalleerd of los); de MCP-server wordt
// per instantie op een eigen poort gestart (OPS_ENABLE_MCP=1 vereist voor
// release-builds). Draai op een verder rustige machine; elke meting is de
// mediaan van RONDES runs.
// Exit 0 = metingen afgerond (vergelijking is informatief, geen harde
// faalgrens behalve: nieuwe build > 2x zo traag als oude op een meting).

import { spawn } from 'node:child_process';
import path from 'node:path';

const RONDES = 3;
const MCP_POORT = 9251;
const CDP_POORT = 9351;
const BESTANDEN = [
  { pad: 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/Tekst.pdf', naam: 'licht (Tekst)', paginas: true },
  { pad: 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/Technische tekening.pdf', naam: 'middel (Technische tekening)', paginas: true },
  { pad: 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/NKD1a_opm_aw.pdf', naam: 'annotatierijk (NKD1a, 7p)', paginas: true },
  { pad: 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/Zware vector PDF.pdf', naam: 'zwaar (Zware vector)', paginas: false },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mediaan = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function maakMcp(poort) {
  let id = 0;
  return async (naam, args = {}, timeoutMs = 60000) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${poort}/mcp`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: naam, arguments: args } }),
      });
      const j = JSON.parse(await res.text());
      if (j.error) throw new Error(naam + ': ' + (j.error.message || JSON.stringify(j.error)));
      const c = j?.result?.content?.[0];
      if (c?.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
      return j.result;
    } finally { clearTimeout(t); }
  };
}

async function cdpVerbind(poort, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const lijst = await (await fetch(`http://127.0.0.1:${poort}/json/list`)).json();
      const page = lijst.find((x) => x.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
        let id = 0; const wachters = new Map();
        ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && wachters.has(m.id)) { wachters.get(m.id)(m); wachters.delete(m.id); } });
        const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; wachters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
        return { ws, cdp, evalJs: async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value };
      }
    } catch { /* nog niet op */ }
    await sleep(150);
  }
  throw new Error('CDP niet bereikbaar binnen ' + maxMs + 'ms');
}

// Inkt op het zichtbare paginacanvas (enkelpagina: #pdf-canvas; met
// doorlopende terugval voor het geval een build anders start).
const INKT = `(() => {
  const kandidaten = [document.getElementById('pdf-canvas'), ...document.querySelectorAll('#continuous-container .pdf-canvas')].filter((c) => c && c.width > 4);
  for (const c of kandidaten) {
    const r = c.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    try {
      const mini = document.createElement('canvas'); mini.width = 32; mini.height = 32;
      const mc = mini.getContext('2d'); mc.fillStyle = '#f0f'; mc.fillRect(0, 0, 32, 32);
      mc.drawImage(c, 0, 0, 32, 32);
      const d = mc.getImageData(0, 0, 32, 32).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (!(d[i] === 255 && d[i+1] === 0 && d[i+2] === 255) && (d[i] < 245 || d[i+1] < 245 || d[i+2] < 245)) n++;
      }
      if (n > 4) return n;
    } catch { /* tainted/leeg */ }
  }
  return 0;
})()`;

async function wachtOpInkt(evalJs, maxMs, minInkt = 5) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = await evalJs(INKT).catch(() => 0);
    if (typeof n === 'number' && n >= minInkt) return Date.now() - t0;
    await sleep(100);
  }
  return -1; // niet gehaald
}

async function meetRun(exe, bestand) {
  const env = {
    ...process.env,
    OPS_ENABLE_MCP: '1',
    OPDS_DETACHED: '1',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_POORT}`,
    WEBVIEW2_USER_DATA_FOLDER: 'C:/Users/rickd/AppData/Local/Temp/opds-prestatie-webview',
  };
  const t0 = Date.now();
  const proc = spawn(exe, ['--mcp-server', '--mcp-port', String(MCP_POORT)], { env, detached: true, stdio: 'ignore' });
  const uit = { appStartMs: -1, openMs: -1, zoomMs: -1, paginaMs: -1 };
  try {
    const { ws, evalJs } = await cdpVerbind(CDP_POORT, 30000);
    // App-start: tot de ribbon in de DOM staat
    const tR0 = Date.now();
    while (Date.now() - tR0 < 20000) {
      const klaar = await evalJs(`!!document.querySelector('.ribbon, [class*=ribbon]')`).catch(() => false);
      if (klaar) break;
      await sleep(100);
    }
    uit.appStartMs = Date.now() - t0;

    const mcp = maakMcp(MCP_POORT);
    const tOpen = Date.now();
    await mcp('app_open_pdf', { path: bestand.pad }, 90000);
    const inktNa = await wachtOpInkt(evalJs, 60000);
    uit.openMs = inktNa < 0 ? -1 : (Date.now() - tOpen);

    // Zoom naar 200%: meet tot er weer inkt staat na de schaalwissel
    const tZoom = Date.now();
    await mcp('app_set_zoom', { scale: 2 }, 30000).catch(() => null);
    await sleep(150);
    const zInkt = await wachtOpInkt(evalJs, 60000);
    uit.zoomMs = zInkt < 0 ? -1 : (Date.now() - tZoom);

    if (bestand.paginas) {
      const tPag = Date.now();
      const geklikt = await evalJs(`(() => {
        const k = [...document.querySelectorAll('button, [role=button], .ribbon-button')].find((b) => /volgende|next/i.test((b.title || '') + ' ' + (b.textContent || '')) && b.offsetParent);
        if (!k) return false; k.click(); return true;
      })()`);
      if (geklikt) {
        await sleep(150);
        const pInkt = await wachtOpInkt(evalJs, 60000);
        uit.paginaMs = pInkt < 0 ? -1 : (Date.now() - tPag);
      }
    }
    ws.close();
  } finally {
    try { process.kill(proc.pid); } catch { /* al weg */ }
    // WebView2-kinderen sterven mee met het hoofdproces
    await sleep(1200);
  }
  return uit;
}

async function meetBuild(exe, label) {
  console.log(`\n===== ${label} — ${exe}`);
  const per = {};
  for (const bestand of BESTANDEN) {
    const runs = [];
    for (let i = 0; i < RONDES; i++) {
      try {
        runs.push(await meetRun(exe, bestand));
      } catch (e) {
        console.log(`  run mislukt (${bestand.naam}):`, e.message);
      }
      await sleep(800);
    }
    if (!runs.length) { per[bestand.naam] = null; continue; }
    const med = (veld) => mediaan(runs.map((r) => r[veld]).filter((v) => v >= 0));
    per[bestand.naam] = {
      appStartMs: med('appStartMs') ?? -1,
      openMs: med('openMs') ?? -1,
      zoomMs: med('zoomMs') ?? -1,
      paginaMs: bestand.paginas ? (med('paginaMs') ?? -1) : undefined,
    };
    console.log(`  ${bestand.naam}:`, JSON.stringify(per[bestand.naam]));
  }
  return per;
}

const [exeA, labelA, exeB, labelB] = process.argv.slice(2);
if (!exeA || !labelA) {
  console.log('gebruik: node scripts/verify-prestaties.mjs <exe-A> <label-A> [<exe-B> <label-B>]');
  process.exit(1);
}
const resA = await meetBuild(exeA, labelA);
let resB = null;
if (exeB && labelB) resB = await meetBuild(exeB, labelB);

if (resB) {
  console.log(`\n===== VERGELIJKING (${labelA} -> ${labelB}, mediaan in ms)`);
  let regressies = 0;
  for (const naam of Object.keys(resA)) {
    const a = resA[naam], b = resB[naam];
    if (!a || !b) { console.log(`  ${naam}: onvolledig`); continue; }
    const velden = ['appStartMs', 'openMs', 'zoomMs', 'paginaMs'];
    const delen = [];
    for (const v of velden) {
      if (a[v] === undefined || b[v] === undefined) continue;
      const factor = a[v] > 0 && b[v] > 0 ? (b[v] / a[v]).toFixed(2) : '?';
      delen.push(`${v.replace('Ms', '')} ${a[v]}->${b[v]} (x${factor})`);
      if (a[v] > 0 && b[v] > a[v] * 2 && b[v] - a[v] > 1000) regressies++;
    }
    console.log(`  ${naam}: ${delen.join(' | ')}`);
  }
  if (regressies) {
    console.log(`MISLUKT: ${regressies} meting(en) meer dan 2x zo traag als ${labelA}`);
    process.exit(1);
  }
  console.log('GOED — geen prestatie-regressie boven de 2x-grens');
}
process.exit(0);
