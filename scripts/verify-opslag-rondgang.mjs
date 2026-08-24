// Opslag-rondgang: kopieert elk verificatie-PDF, opent de kopie in de app,
// slaat op met Ctrl+S en sluit de tab. Daarna vergelijkt
// verify-opslag-rondgang.py elke opgeslagen kopie extern met het origineel.
//
// Aanleiding: een oudere app-versie heeft ooit een bestand verminkt
// weggeschreven (halve MediaBox, annotaties zonder paginacompensatie). Deze
// test vangt dat soort schade vóór hij in omloop raakt.
//
// Voorwaarden: Vite draait, de app draait met --mcp-server --mcp-port en met
// CDP (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=...).
//
// Gebruik:
//   node scripts/verify-opslag-rondgang.mjs [pdf-map] [werkmap]
// Standaard: ../verification-files/PDF-bestanden en ./opslag-rondgang

import fs from 'fs';
import path from 'path';

const MCP = process.env.MCP_URL || 'http://127.0.0.1:9223/mcp';
const CDP_POORT = process.env.CDP_PORT || '9345';
const BRON = (process.argv[2] || 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden').replace(/\\/g, '/');
const WERK = (process.argv[3] || 'opslag-rondgang').replace(/\\/g, '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mcpId = 0;
async function mcp(naam, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/call', params: { name: naam, arguments: args } }),
  });
  const j = JSON.parse(await res.text());
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  const c = j?.result?.content?.[0];
  if (c?.type === 'text') {
    try { return JSON.parse(c.text); } catch { return c.text; }
  }
  return j.result;
}

let ws = null;
let cdpId = 0;
async function cdpVerbind() {
  const lijst = await (await fetch(`http://127.0.0.1:${CDP_POORT}/json/list`)).json();
  const page = lijst.find((t) => t.type === 'page');
  if (!page) throw new Error('geen CDP-pagina gevonden');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
}
function cdpStuur(method, params) {
  return new Promise((res) => {
    const id = ++cdpId;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', h);
      res(m.result);
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ctrlS() {
  const basis = { modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 };
  await cdpStuur('Input.dispatchKeyEvent', { type: 'keyDown', ...basis });
  await cdpStuur('Input.dispatchKeyEvent', { type: 'keyUp', ...basis });
}

const KOPIE = path.join(WERK, 'kopie');
fs.mkdirSync(KOPIE, { recursive: true });
await cdpVerbind();

const bestanden = fs.readdirSync(BRON).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
const rapport = [];

for (const naam of bestanden) {
  const rij = { bestand: naam };
  const kopiePad = path.join(KOPIE, naam);
  try {
    fs.copyFileSync(path.join(BRON, naam), kopiePad);
    const mtimeVoor = fs.statSync(kopiePad).mtimeMs;

    const r = await mcp('app_open_pdf', { path: kopiePad.replace(/\\/g, '/') });
    rij.openOk = !!r?.ok;
    if (!rij.openOk) {
      rij.fout = JSON.stringify(r).slice(0, 100);
    } else {
      // Ruim wachten: zware bladen renderen en laden annotaties na.
      await sleep(9000);
      await ctrlS();
      // Wachten tot de save daadwerkelijk op schijf staat (mtime verandert);
      // zware bestanden kunnen daar even over doen.
      for (let poging = 0; poging < 30; poging += 1) {
        await sleep(1000);
        if (fs.statSync(kopiePad).mtimeMs !== mtimeVoor) break;
      }
      rij.opgeslagen = fs.statSync(kopiePad).mtimeMs !== mtimeVoor;
    }
  } catch (e) {
    rij.fout = String(e.message).slice(0, 120);
  }
  try { await mcp('app_close_tab', {}); } catch (_) { /* tab kan al weg zijn */ }
  await sleep(1500);
  console.log(`${rij.openOk ? 'ok  ' : 'FOUT'} ${rij.opgeslagen === true ? 'opgeslagen    ' : rij.opgeslagen === false ? 'NIET-OPGESLAGEN' : '-             '} ${naam}${rij.fout ? `  << ${rij.fout}` : ''}`);
  rapport.push(rij);
}

fs.writeFileSync(path.join(WERK, 'rapport.json'), JSON.stringify(rapport, null, 1));
const nOk = rapport.filter((r) => r.opgeslagen).length;
console.log(`\nklaar — ${nOk}/${rapport.length} kopieën opgeslagen in ${KOPIE}`);
console.log(`vervolg: python scripts/verify-opslag-rondgang.py ${WERK} "${BRON}"`);
process.exit(0);
