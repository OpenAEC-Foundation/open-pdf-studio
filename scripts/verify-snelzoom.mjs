// Integratietest snel zoomen in de doorlopende weergave, via de testrig.
// Vuurt WheelEvents in-page af (à ~8ms, native-achtige dichtheid) in bursts
// met pauzes van 140ms — de pauze laat de debounced re-renderlus starten en
// de volgende burst zoomt er dwars doorheen. Meet daarna:
//   - drift van het content-punt onder de cursor (in- en weer uitzoomend
//     hoort het punt exact terug op zijn plek te staan);
//   - consistentie van de wrappermaten (alle pagina's zelfde schaalratio).
//
// Voorwaarden (zelfde rig-recept als verify-annotatie-plaatsing.mjs):
//   - Vite draait (npm run dev in open-pdf-studio/)
//   - De app draait met --mcp-server en CDP via
//     WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<poort>
//
// Gebruik:
//   node scripts/verify-snelzoom.mjs [pdf]
// Normen: einddrift <= 2 px en 0 wrapperfouten -> exit 0, anders exit 1.

const MCP = process.env.MCP_URL || 'http://127.0.0.1:9223/mcp';
const CDP_POORT = process.env.CDP_PORT || '9345';
const PDF = (process.argv[2] || 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/NKD1a_opm_aw.pdf').replace(/\\/g, '/');

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
  if (c?.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
  return j.result;
}

let ws = null, cdpId = 0;
const wachters = new Map();
async function cdpVerbind() {
  const lijst = await (await fetch(`http://127.0.0.1:${CDP_POORT}/json/list`)).json();
  const page = lijst.find((t) => t.type === 'page');
  if (!page) throw new Error('geen CDP-pagina gevonden');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && wachters.has(m.id)) {
      const { res, rej } = wachters.get(m.id);
      wachters.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    }
  });
}
function cdp(method, params = {}) {
  return new Promise((res, rej) => { const id = ++cdpId; wachters.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr, opts = {}) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, ...opts });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

await cdpVerbind();
console.log('open:', PDF.split('/').pop());
const open = await mcp('app_open_pdf', { path: PDF });
if (!open?.ok) throw new Error('openen mislukt: ' + JSON.stringify(open).slice(0, 200));
await sleep(4000);

// Doorlopende weergave afdwingen + vanaf fit starten.
const isContinu = async () => JSON.parse(await evalJs(`(() => {
  const cc = document.getElementById('continuous-container');
  return JSON.stringify(!!(cc && getComputedStyle(cc).display !== 'none' && cc.querySelector('.page-wrapper')));
})()`));
if (!(await isContinu())) {
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button,[role=button]')].find(x =>
      /(doorlopend|continuous)/i.test(x.title || '') && !/(boek|book|facing|naast)/i.test(x.title || ''));
    if (b) b.click(); return true;
  })()`);
  await sleep(2500);
}
if (!(await isContinu())) throw new Error('doorlopende weergave niet actief te krijgen');
await mcp('app_fit_page', {}).catch(() => {});
await sleep(2000);

const uit = JSON.parse(await evalJs(`(async () => {
  const container = document.getElementById('pdf-container');
  const mv = document.querySelector('.main-view');
  const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
  const vuur = (cx, cy, dy) => mv.dispatchEvent(new WheelEvent('wheel', {
    clientX: cx, clientY: cy, deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true,
  }));
  const rect = () => container.getBoundingClientRect();
  const ccs = () => [...document.querySelectorAll('#continuous-container .page-wrapper .canvas-container-cont')];

  // Voor-zoomen tot de inhoud op beide assen overloopt: zolang de pagina in
  // de viewport past is er geen scrollruimte en kan het anker inherent niet
  // vastgehouden worden (scrollLeft clampt op 0).
  for (let k = 0; k < 60; k++) {
    if (container.scrollWidth > container.clientWidth * 1.3 &&
        container.scrollHeight > container.clientHeight * 1.3) break;
    const r0 = rect();
    vuur(r0.left + r0.width / 2, r0.top + r0.height / 2, -100);
    await slaap(20);
  }
  await slaap(1500);

  container.scrollTop = container.scrollHeight * 0.45;
  await slaap(300);
  const r1 = rect();
  const cx = r1.left + r1.width / 2, cy = r1.top + r1.height / 2;
  let idx = -1, fx = 0, fy = 0, bestAfstand = Infinity;
  ccs().forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const afstand = cy < r.top ? r.top - cy : (cy > r.bottom ? cy - r.bottom : 0);
    if (afstand < bestAfstand) { bestAfstand = afstand; idx = i; fx = (cx - r.left) / r.width; fy = (cy - r.top) / r.height; }
  });
  if (idx < 0) return JSON.stringify({ fout: 'geen ankerpagina' });

  const drift = () => {
    const r = ccs()[idx].getBoundingClientRect();
    return Math.hypot(r.left + fx * r.width - cx, r.top + fy * r.height - cy);
  };
  const wrapperFouten = () => {
    const ratios = [];
    document.querySelectorAll('#continuous-container .page-wrapper').forEach((w) => {
      const cc = w.querySelector('.canvas-container-cont');
      const baseW = parseFloat(w.dataset.baseW);
      if (cc && baseW) ratios.push(parseFloat(cc.style.width) / baseW);
    });
    const med = ratios.slice().sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
    return ratios.filter((r) => Math.abs(r - med) / med > 0.002).length;
  };

  // 4 bursts van 12 events à 8ms: twee in, twee uit (schaal eindigt netto
  // ~gelijk), met 140ms-pauzes waarin de re-renderlus start.
  let maxDrift = 0, maxFout = 0;
  for (const dy of [-60, -60, 60, 60]) {
    for (let k = 0; k < 12; k++) {
      vuur(cx, cy, dy);
      await slaap(8);
      maxDrift = Math.max(maxDrift, drift());
      maxFout = Math.max(maxFout, wrapperFouten());
    }
    await slaap(140);
    maxDrift = Math.max(maxDrift, drift());
    maxFout = Math.max(maxFout, wrapperFouten());
  }
  // Na-ijlende renders volgen (trage vellen kunnen seconden later landen).
  for (let k = 0; k < 12; k++) { await slaap(500); maxFout = Math.max(maxFout, wrapperFouten()); }
  return JSON.stringify({
    maxDriftTijdens: +maxDrift.toFixed(1),
    driftEind: +drift().toFixed(1),
    maxWrapperFouten: maxFout,
    eindFouten: wrapperFouten(),
  });
})()`, { awaitPromise: true }));

console.log(JSON.stringify(uit));
if (uit.fout) { console.log('MISLUKT:', uit.fout); process.exit(1); }
const ok = uit.driftEind <= 2 && uit.eindFouten === 0;
console.log(ok ? 'GOED — anker houdt, wrappermaten consistent' : 'MISLUKT — einddrift of wrapperfouten boven de norm');
process.exit(ok ? 0 : 1);
