// Legt per verificatie-PDF de annotatielaag van de app vast, zodat
// verify-annotatie-plaatsing.py die kan vergelijken met een onafhankelijke
// referentie-render. Bedoeld voor de terugkerende melding "de annotaties staan
// gedraaid" op pagina's met /Rotate.
//
// Voorwaarden:
//   - Vite draait (npm run dev in open-pdf-studio/)
//   - De app draait met --mcp-server --mcp-port <poort>
//   - De WebView is bereikbaar via CDP (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
//     --remote-debugging-port=<poort>)
//
// Gebruik:
//   node scripts/verify-annotatie-plaatsing.mjs [pdf-map] [uitvoermap]
// Standaard: ../verification-files/PDF-bestanden en ./annotatie-plaatsing

import fs from 'fs';
import path from 'path';

const MCP = process.env.MCP_URL || 'http://127.0.0.1:9223/mcp';
const CDP_POORT = process.env.CDP_PORT || '9345';
const MAP = (process.argv[2] || 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden').replace(/\\/g, '/');
const UIT = process.argv[3] || 'annotatie-plaatsing';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (n) => n.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40);

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
function cdpEval(expr) {
  return new Promise((res, rej) => {
    const id = ++cdpId;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', h);
      if (m.error) return rej(new Error(JSON.stringify(m.error)));
      if (m.result.exceptionDetails) return rej(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 200)));
      res(m.result.result.value);
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  });
}

const TOESTAND = `(() => {
  const vp = window.__pdfViewport;
  const c = document.getElementById('annotation-canvas');
  return JSON.stringify({ zoom: vp.zoom, ox: vp.offsetX, oy: vp.offsetY, pageW: vp.pageW, pageH: vp.pageH,
                          cw: c && c.width, ch: c && c.height });
})()`;

const INKT = `(() => {
  const c = document.getElementById('annotation-canvas');
  if (!c || !c.width) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n += 1;
  return n;
})()`;

fs.mkdirSync(UIT, { recursive: true });
await cdpVerbind();

const bestanden = fs.readdirSync(MAP).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
const rapport = [];

for (const naam of bestanden) {
  const rij = { bestand: naam, slug: slug(naam) };
  try {
    const r = await mcp('app_open_pdf', { path: `${MAP}/${naam}` });
    rij.openOk = !!r?.ok;
    if (!rij.openOk) {
      rij.fout = JSON.stringify(r).slice(0, 100);
    } else {
      await sleep(4000);
      // Documenten openen sinds 1.88 standaard in de doorlopende weergave,
      // maar deze meting leest het enkelpagina-annotatiecanvas uit. Expliciet
      // naar enkelpagina schakelen; zonder deze stap meet alles 0% dekking.
      await cdpEval(`(() => {
        const b = [...document.querySelectorAll('button,[role=button]')].find(x => (x.title || '') === 'Enkele pagina');
        if (b) b.click();
        return true;
      })()`).catch(() => {});
      await sleep(1500);
      await mcp('app_fit_page', {});
      await sleep(3500);
      const a = await mcp('app_list_annotations', {});
      rij.appAnnots = (a?.annotations || a || []).length;
      if (rij.appAnnots > 0) {
        // De annotatielaag wordt na het passend maken opnieuw getekend. Wachten
        // tot er inkt op staat, anders meet de vergelijking een leeg canvas.
        for (let poging = 0; poging < 10; poging += 1) {
          rij.inktPixels = await cdpEval(INKT);
          if (rij.inktPixels > 0) break;
          await sleep(1000);
        }
        Object.assign(rij, JSON.parse(await cdpEval(TOESTAND)));
        const b64 = await cdpEval(`document.getElementById('annotation-canvas').toDataURL('image/png').slice(22)`);
        rij.png = path.join(UIT, `${rij.slug}__annlaag.png`);
        fs.writeFileSync(rij.png, Buffer.from(b64, 'base64'));
      }
    }
  } catch (e) {
    rij.fout = String(e.message).slice(0, 120);
  }
  try { await mcp('app_close_tab', {}); } catch (_) { /* tab kan al weg zijn */ }
  await sleep(1200);
  console.log(`${rij.openOk ? 'ok  ' : 'FOUT'} annots=${String(rij.appAnnots ?? '-').padStart(4)}  ${naam}${rij.fout ? `  << ${rij.fout}` : ''}`);
  rapport.push(rij);
}

fs.writeFileSync(path.join(UIT, 'rapport.json'), JSON.stringify(rapport, null, 1));
console.log(`\nklaar — ${rapport.filter((r) => r.png).length} annotatielagen vastgelegd in ${UIT}`);
console.log(`vervolg: python scripts/verify-annotatie-plaatsing.py ${UIT}`);
process.exit(0);
