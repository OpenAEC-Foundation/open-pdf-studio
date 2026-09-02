// Release-poorttest: annotaties landen op de plek van de muiscursor, ook bij
// hoge zoomniveaus. Aanleiding: maatlijn leek bij ~350% niet onder de cursor
// te verschijnen. De test plaatst een maatlijn (drie kliks: punt 1, punt 2,
// maatlijnpositie) via echte muis-events op berekende schermcoördinaten en
// verifieert dat de leader-punten van de gemaakte annotatie exact de bedoelde
// app-punten zijn.
//
// Voorwaarden: testrig draait (--mcp-server, MCP-poort via MCP_PORT, default
// 9223; CDP via CDP_PORT, default 9345). Gebruik:
//   node scripts/verify-plaatsing-cursor.mjs
// Exit 0 = GOED, 1 = MISLUKT.

import fs from 'fs';

const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9223') + '/mcp';
const CDP = process.env.CDP_PORT || '9345';
const BRONFIXTURE = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/Tekst.pdf';
const WERKKOPIE = 'C:/Users/rickd/AppData/Local/Temp/plaatsing-cursor-test.pdf';
const ZOOMS = [1.0, 2.0, 3.52];
const TOLERANTIE = 1.5; // app-punten (pt)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mcpId = 0;
async function mcp(naam, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/call', params: { name: naam, arguments: args } }),
  });
  const j = JSON.parse(await res.text());
  if (j.error) throw new Error(naam + ': ' + (j.error.message || JSON.stringify(j.error)));
  const c = j?.result?.content?.[0];
  if (c?.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
  return j.result;
}

let ws = null, cdpId = 0;
const wachters = new Map();
async function cdpVerbind() {
  const lijst = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  const page = lijst.find((t) => t.type === 'page');
  if (!page) throw new Error('geen CDP-pagina — start de rig met --remote-debugging-port');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && wachters.has(m.id)) { wachters.get(m.id)(m); wachters.delete(m.id); }
  });
}
const cdp = (method, params = {}) => new Promise((res) => { const i = ++cdpId; wachters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

// Eigen werkkopie: voorkomt bestandslocks met andere instanties.
fs.copyFileSync(BRONFIXTURE, WERKKOPIE);
await cdpVerbind();
await mcp('app_open_pdf', { path: WERKKOPIE });
await sleep(3500);
await evalJs(`(() => { const b = [...document.querySelectorAll('button,[role=button]')].find(x => /(enkele pagina|single page)/i.test(x.title || '')); if (b) b.click(); return true; })()`);
await sleep(2500);

const mapInfo = async () => JSON.parse(await evalJs(`(() => {
  const c = document.getElementById('annotation-canvas');
  const r = c.getBoundingClientRect();
  const vp = window.__pdfViewport;
  return JSON.stringify({ rect: { left: r.left, top: r.top }, vpActief: !!(vp && vp.active), vpZoom: vp && vp.zoom, vpOx: vp && vp.offsetX, vpOy: vp && vp.offsetY });
})()`));

const fouten = [];
for (const zoomDoel of ZOOMS) {
  await mcp('app_set_zoom', { scale: zoomDoel });
  await sleep(1800);
  const mi = await mapInfo();
  if (!mi.vpActief) { fouten.push(`zoom ${zoomDoel}: vector-viewport niet actief — mapping niet toetsbaar`); continue; }
  const container = JSON.parse(await evalJs(`(() => { const r = document.getElementById('pdf-container').getBoundingClientRect(); return JSON.stringify({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 }); })()`));
  const naarApp = (sx, sy) => ({ x: (sx - mi.rect.left - mi.vpOx) / mi.vpZoom, y: (sy - mi.rect.top - mi.vpOy) / mi.vpZoom });
  const naarScherm = (p) => ({ x: mi.rect.left + p.x * mi.vpZoom + mi.vpOx, y: mi.rect.top + p.y * mi.vpZoom + mi.vpOy });
  const midden = naarApp(container.cx, container.cy);
  const doel = [
    { x: midden.x - 120 / mi.vpZoom, y: midden.y },
    { x: midden.x + 120 / mi.vpZoom, y: midden.y },
  ];
  const kliks = [...doel.map(naarScherm), naarScherm({ x: midden.x, y: midden.y + 25 })];

  // Schone lei per meting.
  for (const a of ((await mcp('app_list_annotations', {}))?.annotations || [])) {
    await mcp('app_delete_annotation', { id: a.id }).catch(() => {});
  }
  await mcp('app_key', { key: 'Escape' }).catch(() => {});
  await sleep(300);
  await mcp('app_set_tool', { tool: 'measureDistance' });
  await sleep(500);
  for (const k of kliks) {
    await mcp('app_mouse_move', { x: k.x, y: k.y }); await sleep(150);
    await mcp('app_mouse_click', { x: k.x, y: k.y }); await sleep(500);
  }
  await sleep(600);
  const lijst = (await mcp('app_list_annotations', {}))?.annotations || [];
  let ann = null;
  for (const a of lijst) {
    const g = await mcp('app_get_annotation', { id: a.id });
    const kand = g?.annotation || g;
    if (kand.type === 'measureDistance') ann = kand;
  }
  if (!ann) { fouten.push(`zoom ${zoomDoel}: geen maatlijn gemaakt`); continue; }
  const afw1 = Math.hypot(ann.leaderStartX - doel[0].x, ann.leaderStartY - doel[0].y);
  const afw2 = Math.hypot(ann.leaderEndX - doel[1].x, ann.leaderEndY - doel[1].y);
  // Volgorde kan wisselen — neem de beste toewijzing.
  const afw1b = Math.hypot(ann.leaderStartX - doel[1].x, ann.leaderStartY - doel[1].y);
  const afw2b = Math.hypot(ann.leaderEndX - doel[0].x, ann.leaderEndY - doel[0].y);
  const maxAfw = Math.min(Math.max(afw1, afw2), Math.max(afw1b, afw2b));
  console.log(`zoom ${zoomDoel}: afwijking ${maxAfw.toFixed(2)} pt`);
  if (maxAfw > TOLERANTIE) {
    fouten.push(`zoom ${zoomDoel}: maatlijn wijkt ${maxAfw.toFixed(1)} pt af van de klikpunten (leader ${ann.leaderStartX?.toFixed(1)},${ann.leaderStartY?.toFixed(1)} vs doel ${doel[0].x.toFixed(1)},${doel[0].y.toFixed(1)})`);
  }
}

if (fouten.length) {
  for (const f of fouten) console.log('FOUT —', f);
  console.log(`MISLUKT: ${fouten.length} afwijkingen`);
  process.exit(1);
}
console.log('GOED — plaatsing onder de cursor klopt op zoom ' + ZOOMS.join('/'));
process.exit(0);
