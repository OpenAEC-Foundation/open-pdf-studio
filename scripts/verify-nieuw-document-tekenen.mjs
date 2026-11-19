// Poorttest #1174: op een NIEUW document kun je meteen tekenen.
//
// Een nieuw document in de doorlopende weergave past zich direct daarna in het
// venster (fitPage). Die tweede render haalde de eerste in, en
// de pagina kreeg haar muis-events dan nooit: geen enkel gereedschap deed nog
// iets op het blad, tot de weergave opnieuw werd opgebouwd.
//
// Een nieuw document opent nu in de enkele-paginaweergave (de standaard);
// de race wordt nagebootst door meteen naar doorlopend te schakelen en
// passend te maken: twee renders vlak na elkaar op een nieuw document.
//
// Per ronde: een nieuw leeg document (zonder de weergave aan te raken), dan
// met ECHTE muisgebeurtenissen (CDP Input.dispatchMouseEvent) een rechthoek en
// een vrije lijn slepen en een lijn met twee klikken zetten; elke keer moet er
// een annotatie bij komen. Daarna hetzelfde in de enkelpagina-weergave en
// terug in de doorlopende. De paginacontainer moet precies één stel
// luisteraars hebben, ook na opnieuw renderen (zoomen).
//
// Voorwaarden: een testinstantie met MCP en CDP (MCP_PORT, CDP_PORT).
// Gebruik: node scripts/verify-nieuw-document-tekenen.mjs [rondes]
// Exit 0 = GOED, 1 = MISLUKT.
const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9248') + '/mcp';
const CDP = process.env.CDP_PORT || '9358';
const RONDES = Number(process.argv[2]) || 4;

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
const consoleFouten = [];
async function cdpVerbind() {
  const lijst = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  const page = lijst.find((t) => t.type === 'page');
  if (!page) throw new Error('geen CDP-pagina');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && wachters.has(m.id)) { wachters.get(m.id)(m); wachters.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') consoleFouten.push('uitzondering: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleFouten.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  });
}
const cdp = (method, params = {}) => new Promise((res) => { const i = ++cdpId; wachters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('evalJs: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

const fouten = [];
const fout = (waar, wat) => { fouten.push(`${waar}: ${wat}`); console.log(`  FOUT — ${waar}: ${wat}`); };

const muis = (type, x, y, knop) => cdp('Input.dispatchMouseEvent', {
  type, x, y, pointerType: 'mouse',
  button: knop ? 'left' : 'none', buttons: type === 'mouseReleased' ? 0 : (knop ? 1 : 0),
  ...(type === 'mouseMoved' ? {} : { clickCount: 1 }),
});
async function sleep2(x0, y0, x1, y1) {
  await muis('mouseMoved', x0, y0, false);
  await sleep(60);
  await muis('mousePressed', x0, y0, true);
  for (let i = 1; i <= 6; i++) { await muis('mouseMoved', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, true); await sleep(25); }
  await muis('mouseReleased', x1, y1, true);
  await sleep(400);
}
async function klik(x, y) {
  await muis('mouseMoved', x, y, false);
  await sleep(40);
  await muis('mousePressed', x, y, true);
  await muis('mouseReleased', x, y, true);
  await sleep(250);
}
const escape = async () => {
  for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);
};

const aantal = async () => {
  const l = await mcp('app_list_annotations', {});
  return (Array.isArray(l) ? l : (l?.annotations || [])).length;
};
// Het paginavlak op het scherm: de container van pagina 1 (doorlopend) of het
// annotatiecanvas (enkele pagina).
const vlak = async () => JSON.parse(await evalJs(`(() => {
  const cont = document.getElementById('continuous-container');
  const cc = document.querySelector('#continuous-container .page-wrapper[data-page="1"] .canvas-container-cont');
  const doorlopend = !!cc && cont.style.display !== 'none';
  const el = doorlopend ? cc : document.getElementById('annotation-canvas');
  const r = el.getBoundingClientRect();
  return JSON.stringify({ doorlopend, l: r.left, t: r.top, b: r.width, h: r.height });
})()`));
// Aantal luisteraars per soort op de container van pagina 1.
async function luisteraars() {
  const o = await cdp('Runtime.evaluate', { expression: `document.querySelector('#continuous-container .page-wrapper[data-page="1"] .canvas-container-cont')` });
  const id = o.result?.result?.objectId;
  if (!id) return null;
  const l = await cdp('DOMDebugger.getEventListeners', { objectId: id });
  const t = {};
  for (const x of l.result?.listeners || []) t[x.type] = (t[x.type] || 0) + 1;
  return t;
}

/** Teken met drie gereedschappen; elke keer moet er een annotatie bij komen. */
async function tekenRonde(waar, rij) {
  const v = await vlak();
  const p = (fx, fy) => [v.l + v.b * fx, v.t + v.h * fy];
  const y = 0.08 + rij * 0.17;
  const stappen = [
    ['box', () => sleep2(...p(0.1, y), ...p(0.25, y + 0.12))],
    ['draw', () => sleep2(...p(0.35, y), ...p(0.5, y + 0.12))],
    ['line', async () => { await klik(...p(0.6, y)); await muis('mouseMoved', ...p(0.7, y + 0.06), false); await klik(...p(0.8, y + 0.12)); await escape(); }],
  ];
  for (const [tool, doe] of stappen) {
    const voor = await aantal();
    await mcp('app_set_tool', { tool });
    await sleep(250);
    await doe();
    const na = await aantal();
    const nu = (await mcp('app_get_current_tool', {}))?.tool;
    console.log(`  ${waar} ${tool}: ${voor} -> ${na}${na > voor ? '' : '  NIETS GETEKEND'}`);
    if (na <= voor) fout(`${waar} ${tool}`, `geen annotatie erbij (${voor} -> ${na}); gereedschap nu ${nu}`);
  }
  await mcp('app_set_tool', { tool: 'select' });
}

await cdpVerbind();
await cdp('Runtime.enable');
console.log('venster:', await evalJs(`JSON.stringify({ dpr: window.devicePixelRatio, venster: [innerWidth, innerHeight] })`));
for (let n = 0; n < RONDES; n++) {
  // Afwisselend direct en even later: de inhalende render valt er dan voor,
  // tijdens of na.
  const wacht = [0, 400, 1500, 3000][n % 4];
  const formaat = n % 2 ? { widthPt: 595.28, heightPt: 841.89 } : { widthPt: 1190.55, heightPt: 841.89 };
  console.log(`\n== ronde ${n + 1}: nieuw document ${formaat.widthPt} x ${formaat.heightPt} pt, tekenen na ${wacht} ms`);
  const nieuw = await mcp('app_new_blank_pdf', formaat);
  if (!nieuw?.ok) { fout(`ronde ${n + 1}`, 'nieuw document mislukt: ' + JSON.stringify(nieuw).slice(0, 200)); continue; }
  await sleep(wacht);
  const v = await vlak();
  if (v.doorlopend) fout(`ronde ${n + 1}`, 'het nieuwe document opent doorlopend; de standaard is enkele pagina');
  await tekenRonde(`ronde ${n + 1} enkele pagina (standaard)`, 0);
  // Naar doorlopend met direct een tweede render erachteraan: de race van #1174.
  await mcp('app_set_view_mode', { mode: 'continuous' });
  await mcp('app_fit_page', {});
  await sleep(wacht);
  if (!(await vlak()).doorlopend) fout(`ronde ${n + 1}`, 'het nieuwe document is niet in de doorlopende weergave te krijgen');
  await tekenRonde(`ronde ${n + 1} doorlopend`, 1);
  const l1 = await luisteraars();
  console.log('  luisteraars:', JSON.stringify(l1));
  if (!l1 || l1.pointerdown !== 1 || l1.pointerup !== 1 || l1.pointermove !== 1) fout(`ronde ${n + 1}`, `paginacontainer heeft niet precies één stel luisteraars: ${JSON.stringify(l1)}`);
  // Opnieuw renderen (zoom) mag geen tweede stel koppelen: dan tekende elke
  // sleep twee annotaties.
  const zoom = (await mcp('app_get_viewport_state', {}))?.zoom;
  await mcp('app_zoom_in', {});
  await sleep(1200);
  await mcp('app_zoom_out', {});
  await sleep(1200);
  const l2 = await luisteraars();
  if (!l2 || l2.pointerdown !== 1) fout(`ronde ${n + 1}`, `na zoomen ${JSON.stringify(l2)} luisteraars (zoom was ${zoom})`);
  const voor = await aantal();
  await tekenRonde(`ronde ${n + 1} doorlopend na zoomen`, 2);
  const erbij = (await aantal()) - voor;
  if (erbij !== 3) fout(`ronde ${n + 1}`, `na zoomen kwamen er ${erbij} annotaties bij in plaats van 3`);
  await mcp('app_set_view_mode', { mode: 'single' });
  await sleep(1500);
  await tekenRonde(`ronde ${n + 1} enkele pagina`, 3);
  await mcp('app_set_view_mode', { mode: 'continuous' });
  await sleep(1500);
  await tekenRonde(`ronde ${n + 1} terug doorlopend`, 4);
  try { await mcp('app_close_tab', { force: true }); } catch { /* geen tab */ }
  await sleep(700);
}
ws.close();

if (consoleFouten.length) {
  console.log('\nconsole:');
  for (const f of consoleFouten.slice(-10)) console.log('  ' + f);
  fouten.push(`${consoleFouten.length} fouten in de console`);
}
if (fouten.length) {
  console.log('');
  for (const f of fouten) console.log('FOUT —', f);
  console.log(`MISLUKT: ${fouten.length} afwijkingen`);
  process.exit(1);
}
console.log(`\nGOED — op ${RONDES} nieuwe documenten meteen getekend (doorlopend, na zoomen, enkele pagina)`);
process.exit(0);
