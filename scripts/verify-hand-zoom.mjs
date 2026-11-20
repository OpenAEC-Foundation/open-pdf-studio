#!/usr/bin/env node
// Live controle van het zoomen met het hand-gereedschap (#1161) in de echte
// desktop-app: de vector-viewport van de enkelpagina-weergave en de
// doorlopende weergave. Het browserscenario (test-hand-zoom-browser.mjs) dekt
// de terugval in de browser; dit script de weergave die de app zelf gebruikt.
//
// Voorwaarden: testrig draait (--mcp-server, MCP-poort via MCP_PORT, standaard
// 9223) met CDP (CDP_PORT, standaard 9345). De invoer gaat als echte
// muisgebeurtenissen via CDP; de uitkomst wordt uit de toestand van de
// weergave gelezen, niet van het scherm.
//
// Gebruik: node scripts/verify-hand-zoom.mjs [pdf]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9223') + '/mcp';
const CDP = process.env.CDP_PORT || '9345';
const BRON = process.argv[2]
  || 'C:/Users/rickd/Documents/GitHub/open-pdf-studio/fixtures/pdf/Tekst.pdf';
const WERKKOPIE = path.join(os.tmpdir(), 'hand-zoom-test.pdf').split(path.sep).join('/');
const CTRL = 2;
const SHIFT = 8;

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

let ws = null;
let cdpId = 0;
const wachters = new Map();
async function cdpVerbind() {
  const lijst = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  const pagina = lijst.find((t) => t.type === 'page');
  if (!pagina) throw new Error('geen CDP-pagina: start de rig met --remote-debugging-port');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && wachters.has(m.id)) { wachters.get(m.id)(m); wachters.delete(m.id); }
  });
}
const cdp = (method, params = {}) => new Promise((res) => {
  const i = ++cdpId;
  wachters.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

const muis = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: 0, ...extra,
});
async function klik(x, y, modifiers = 0) {
  await muis('mouseMoved', x, y, { buttons: 0, button: 'none', modifiers });
  await muis('mousePressed', x, y, { modifiers });
  await sleep(60);
  await muis('mouseReleased', x, y, { modifiers });
  await sleep(1300);
}
async function sleep_(x0, y0, x1, y1, modifiers = 0, { loslaten = true, stappen = 8 } = {}) {
  await muis('mouseMoved', x0, y0, { buttons: 0, button: 'none', modifiers });
  await muis('mousePressed', x0, y0, { modifiers });
  for (let i = 1; i <= stappen; i += 1) {
    await muis('mouseMoved', x0 + ((x1 - x0) * i) / stappen, y0 + ((y1 - y0) * i) / stappen, { modifiers });
    await sleep(25);
  }
  if (loslaten) { await muis('mouseReleased', x1, y1, { modifiers }); await sleep(1300); }
}
const toets = async (key, code, vk) => {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
};

/** De toestand van de weergave: viewport of de doorlopende pagina in beeld. */
const stand = async () => JSON.parse(await evalJs(`(() => {
  const vp = window.__pdfViewport;
  const cont = document.getElementById('pdf-container').getBoundingClientRect();
  const uit = { container: { left: cont.left, top: cont.top, width: cont.width, height: cont.height } };
  if (vp && vp.active) {
    const r = document.getElementById('pdf-canvas').getBoundingClientRect();
    return JSON.stringify({ ...uit, soort: 'viewport', zoom: vp.zoom, ox: vp.offsetX, oy: vp.offsetY, left: r.left, top: r.top });
  }
  const bladen = [...document.querySelectorAll('#continuous-container .page-wrapper')];
  const blad = bladen.map((b) => ({ b, r: b.getBoundingClientRect() }))
    .filter((x) => x.r.bottom > cont.top && x.r.top < cont.bottom)[0];
  if (blad) {
    return JSON.stringify({ ...uit, soort: 'doorlopend', zoom: blad.r.width, left: blad.r.left, top: blad.r.top, hoogte: blad.r.height, pagina: blad.b.dataset.page });
  }
  const c = document.getElementById('pdf-canvas').getBoundingClientRect();
  return JSON.stringify({ ...uit, soort: 'enkel', zoom: c.width, left: c.left, top: c.top, hoogte: c.height });
})()`));

/** Het paginapunt onder schermpunt (x, y), in een maat die niet met de zoom meeschaalt. */
const paginapunt = (s, x, y) => (s.soort === 'viewport'
  ? { x: (x - s.left - s.ox) / s.zoom, y: (y - s.top - s.oy) / s.zoom }
  : { x: (x - s.left) / s.zoom, y: (y - s.top) / s.zoom });
/** Verschil tussen twee paginapunten, teruggerekend naar schermpixels. */
const verschilPx = (s, a, b) => Math.hypot((a.x - b.x) * s.zoom, (a.y - b.y) * s.zoom);

const fouten = [];
const meld = (ok, tekst) => { console.log(`${ok ? 'GOED' : 'FOUT'}  ${tekst}`); if (!ok) fouten.push(tekst); };

async function beproef(naam) {
  const s0 = await stand();
  console.log(`\n== ${naam} (${s0.soort}, zoom ${s0.zoom.toFixed(3)})`);
  const P = { x: s0.container.left + s0.container.width * 0.42, y: s0.container.top + s0.container.height * 0.40 };

  // 1. Gewone klik met de voorkeur uit: niets verandert.
  await klik(P.x, P.y);
  const s1 = await stand();
  meld(Math.abs(s1.zoom - s0.zoom) < 1e-6, 'gewone klik (voorkeur uit) zoomt niet');

  // 2. Ctrl+klik: een stap inzoomen, het punt onder de cursor blijft staan.
  const voor = paginapunt(s1, P.x, P.y);
  await klik(P.x, P.y, CTRL);
  const s2 = await stand();
  meld(s2.zoom > s1.zoom * 1.05, `Ctrl+klik zoomt in (${s1.zoom.toFixed(3)} -> ${s2.zoom.toFixed(3)})`);
  const afwijking = verschilPx(s2, paginapunt(s2, P.x, P.y), voor);
  meld(afwijking < 3, `het punt onder de cursor blijft staan (afwijking ${afwijking.toFixed(2)} px)`);

  // 3. Ctrl+Shift+klik: precies één stap terug. De beginzoom (hele pagina)
  // ligt niet op de zoomladder; s2 wel. Dus nog een stap in en één uit moet
  // weer op s2 uitkomen.
  await klik(P.x, P.y, CTRL);
  const s2b = await stand();
  meld(s2b.zoom > s2.zoom * 1.05, `nog een Ctrl+klik zoomt verder in (${s2.zoom.toFixed(3)} -> ${s2b.zoom.toFixed(3)})`);
  await klik(P.x, P.y, CTRL | SHIFT);
  const s3 = await stand();
  meld(Math.abs(s3.zoom - s2.zoom) / s2.zoom < 0.01, `Ctrl+Shift+klik zoomt één stap uit (${s2b.zoom.toFixed(3)} -> ${s3.zoom.toFixed(3)})`);
  const terug = verschilPx(s3, paginapunt(s3, P.x, P.y), voor);
  meld(terug < 3, `ook na in en uit staat hetzelfde punt onder de cursor (afwijking ${terug.toFixed(2)} px)`);

  // 4. Slepen: pannen, de zoom blijft gelijk.
  const vast = paginapunt(s3, P.x, P.y);
  await sleep_(P.x, P.y, P.x - 90, P.y - 60);
  const s4 = await stand();
  meld(Math.abs(s4.zoom - s3.zoom) < 1e-6, 'slepen verandert de zoom niet');
  const verschoven = verschilPx(s4, paginapunt(s4, P.x, P.y), vast);
  meld(s3.soort !== 'viewport' || verschoven > 20, `slepen verschuift het blad (${verschoven.toFixed(1)} px)`);

  // 5. Ctrl+slepen en Escape: geen zoom.
  await sleep_(P.x, P.y, P.x + 160, P.y + 100, CTRL, { loslaten: false });
  const zichtbaar = await evalJs(`(() => { const r = document.getElementById('hand-zoom-rechthoek'); if (!r) return false; const b = r.getBoundingClientRect(); return b.width > 50 && b.height > 30 && getComputedStyle(r).display !== 'none'; })()`);
  meld(zichtbaar === true, 'tijdens Ctrl+slepen staat de zoomrechthoek op het scherm');
  await toets('Escape', 'Escape', 27);
  await muis('mouseReleased', P.x + 160, P.y + 100, { modifiers: CTRL });
  await sleep(900);
  const s5 = await stand();
  meld(Math.abs(s5.zoom - s4.zoom) < 1e-6, 'Escape breekt de zoomrechthoek af');

  // 6. Ctrl+slepen: de rechthoek vult daarna het venster, haar midden staat in het midden.
  const A = { x: P.x - 40, y: P.y - 30 };
  const B = { x: A.x + 240, y: A.y + 150 };
  const midden = paginapunt(s5, (A.x + B.x) / 2, (A.y + B.y) / 2);
  await sleep_(A.x, A.y, B.x, B.y, CTRL);
  const s6 = await stand();
  const factor = s6.zoom / s5.zoom;
  const verwacht = Math.min(s5.container.width / 240, s5.container.height / 150);
  meld(factor > 1.5, `Ctrl+slepen zoomt in op de rechthoek (factor ${factor.toFixed(2)}, verwacht rond ${verwacht.toFixed(2)})`);
  meld(Math.abs(factor - verwacht) / verwacht < 0.25, 'de zoomfactor past bij de rechthoek');
  const cx = s6.container.left + s6.container.width / 2;
  const cy = s6.container.top + s6.container.height / 2;
  const uitMidden = verschilPx(s6, paginapunt(s6, cx, cy), midden);
  meld(uitMidden < 40, `het midden van de rechthoek staat in het midden van het venster (afwijking ${uitMidden.toFixed(1)} px)`);
  return s0.soort;
}

fs.copyFileSync(BRON, WERKKOPIE);
await cdpVerbind();
await mcp('app_open_pdf', { path: WERKKOPIE });
await sleep(4000);
const gezet = await mcp('app_set_tool', { tool: 'hand' });
const huidig = await mcp('app_get_current_tool', {});
console.log('gereedschap:', JSON.stringify(gezet).slice(0, 120), '->', JSON.stringify(huidig).slice(0, 120));

const soorten = [];
await mcp('app_set_view_mode', { mode: 'single' });
await sleep(2500);
await mcp('app_fit_page', {});
await sleep(1800);
soorten.push(await beproef('enkele pagina'));

await mcp('app_set_view_mode', { mode: 'continuous' });
await sleep(3000);
await mcp('app_fit_page', {});
await sleep(1800);
soorten.push(await beproef('doorlopend'));

meld(soorten.includes('viewport'), `de vector-viewport is beproefd (weergaven: ${soorten.join(', ')})`);
ws.close();
console.log(fouten.length ? `\nMISLUKT: ${fouten.length} fout(en)` : '\nGOED: zoomen met het hand-gereedschap werkt in de desktop-app');
process.exit(fouten.length ? 1 : 0);
