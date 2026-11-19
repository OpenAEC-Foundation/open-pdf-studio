// Release-poorttest: de doorlopende weergave toont daadwerkelijk BEELD op
// meerdere zoomniveaus. Aanleiding: "als ik naar 150% zoom wordt het wit" —
// een witte paginabitmap valt buiten alle bestaande poorten (de
// plaatsings-sweep meet in enkelpagina-modus).
//
// Per testbestand: openen in doorlopende weergave, per zoomniveau de
// zichtbare pagina-canvases op inkt controleren (verkleind naar 48x48 en
// niet-witte pixels tellen). Bestanden waarvan bekend is dat PDFium ze wit
// rastert (bv. NKD1a: ook de onafhankelijke referentie-render is leeg) horen
// NIET in deze lijst.
//
// Voorwaarden: testrig draait (MCP_PORT default 9223, CDP_PORT default 9345).
// Gebruik: node scripts/verify-doorlopend-inkt.mjs
// Exit 0 = GOED, 1 = MISLUKT.

const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9223') + '/mcp';
const CDP = process.env.CDP_PORT || '9345';
const BESTANDEN = [
  'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/Technische tekening.pdf',
  'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/tekening-2.pdf',
  'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/rapport-constructie.pdf',
];
const ZOOMS = [0.75, 1.0, 1.5, 2.5];
const MIN_INKT = 10; // niet-witte samples van 2304 (48x48)

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
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

const INKT = `(async () => {
  const cont = document.getElementById('pdf-container');
  const cr = cont.getBoundingClientRect();
  const uit = [];
  const telInkt = (teken) => {
    const mini = document.createElement('canvas'); mini.width = 48; mini.height = 48;
    const mc = mini.getContext('2d'); mc.fillStyle = '#f0f'; mc.fillRect(0, 0, 48, 48);
    teken(mc);
    const d = mc.getImageData(0, 0, 48, 48).data;
    let inkt = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (!(d[i] === 255 && d[i+1] === 0 && d[i+2] === 255) && (d[i] < 245 || d[i+1] < 245 || d[i+2] < 245)) inkt++;
    }
    return inkt;
  };
  for (const w of document.querySelectorAll('#continuous-container .page-wrapper')) {
    const r = w.getBoundingClientRect();
    if (r.top >= cr.bottom || r.bottom <= cr.top) continue;
    const pc = w.querySelector('.pdf-canvas');
    if (!pc || !pc.width) { uit.push({ p: w.dataset.page, inkt: null }); continue; }
    // Boven de bitmap-cap is het paginacanvas een uitsnede van het zichtbare
    // deel (#1163), met de hele pagina als achtergrondbeeld van de
    // paginacontainer. De inkt van de pagina is dan die van achtergrond plus
    // uitsnede; en de uitsnede mag niet leeg zijn waar de achtergrond beeld
    // heeft (een wit gerasterde uitsnede over een goede pagina).
    if (pc.dataset.beeld === 'uitsnede') {
      const cc = w.querySelector('.canvas-container-cont');
      const vak = cc.getBoundingClientRect();
      if (Math.min(vak.bottom, cr.bottom) - Math.max(vak.top, cr.top) < 120) continue;
      if (pc.width <= 1) { uit.push({ p: w.dataset.page, inkt: 0 }); continue; }
      try {
        let bg = null;
        if (cc.dataset.scherpBgUrl) { try { bg = new Image(); bg.src = cc.dataset.scherpBgUrl; await bg.decode(); } catch { bg = null; } }
        const c = pc.getBoundingClientRect();
        const fx = 48 / vak.width, fy = 48 / vak.height;
        const plek = [(c.left - vak.left) * fx, (c.top - vak.top) * fy, c.width * fx, c.height * fy];
        const pagina = telInkt((mc) => { if (bg) mc.drawImage(bg, 0, 0, 48, 48); mc.drawImage(pc, ...plek); });
        const uitsnede = telInkt((mc) => mc.drawImage(pc, 0, 0, 48, 48));
        const eronder = bg ? telInkt((mc) => mc.drawImage(bg, (c.left - vak.left) / vak.width * bg.naturalWidth, (c.top - vak.top) / vak.height * bg.naturalHeight,
          c.width / vak.width * bg.naturalWidth, c.height / vak.height * bg.naturalHeight, 0, 0, 48, 48)) : 0;
        // Een uitsnede van een dun stuk tekening (een kaderlijn onderaan het
        // blad) verdwijnt bij verkleinen naar 48x48: tel daarom ook op volle
        // resolutie, omgerekend naar hetzelfde raster van 48x48.
        const vol = pc.getContext('2d').getImageData(0, 0, pc.width, pc.height).data;
        let donker = 0;
        for (let i = 0; i < vol.length; i += 4) if (vol[i + 3] > 10 && (vol[i] < 200 || vol[i+1] < 200 || vol[i+2] < 200)) donker++;
        const uitsnedeVol = donker > 0 ? Math.max(1, Math.round(donker / (vol.length / 4) * 48 * 48)) : 0;
        const eigen = Math.max(uitsnede, uitsnedeVol);
        uit.push({ p: w.dataset.page, inkt: eigen === 0 && eronder >= 10 ? 0 : Math.max(bg ? pagina : 0, eigen) });
      } catch { uit.push({ p: w.dataset.page, inkt: 'fout' }); }
      continue;
    }
    try {
      const mini = document.createElement('canvas'); mini.width = 48; mini.height = 48;
      const mc = mini.getContext('2d'); mc.fillStyle = '#f0f'; mc.fillRect(0, 0, 48, 48);
      mc.drawImage(pc, 0, 0, 48, 48);
      const d = mc.getImageData(0, 0, 48, 48).data;
      let inkt = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (!(d[i] === 255 && d[i+1] === 0 && d[i+2] === 255) && (d[i] < 245 || d[i+1] < 245 || d[i+2] < 245)) inkt++;
      }
      uit.push({ p: w.dataset.page, inkt });
    } catch { uit.push({ p: w.dataset.page, inkt: 'fout' }); }
  }
  return JSON.stringify(uit);
})()`;

await cdpVerbind();
const fouten = [];
for (const pad of BESTANDEN) {
  const naam = pad.split('/').pop();
  await mcp('app_open_pdf', { path: pad });
  await sleep(4000);
  await evalJs(`(() => { const b = [...document.querySelectorAll('button,[role=button]')].find(x => /(doorlopend|continuous)/i.test(x.title || '') && !/(boek|book|naast)/i.test(x.title || '')); if (b) b.click(); return true; })()`);
  await sleep(2500);
  for (const z of ZOOMS) {
    await mcp('app_set_zoom', { scale: z });
    await sleep(4500);
    const staat = JSON.parse(await evalJs(INKT));
    const zichtbaar = staat.filter((x) => x.inkt !== null);
    const wit = zichtbaar.filter((x) => typeof x.inkt === 'number' && x.inkt < MIN_INKT);
    if (!zichtbaar.length) fouten.push(`${naam} @${z}: geen gerenderde pagina's zichtbaar`);
    for (const w of wit) fouten.push(`${naam} @${z}: pagina ${w.p} is wit (inkt ${w.inkt})`);
    console.log(`${naam} @${z}: ${zichtbaar.map((x) => `p${x.p}=${x.inkt}`).join(' ')}`);
  }
}

if (fouten.length) {
  for (const f of fouten) console.log('FOUT —', f);
  console.log(`MISLUKT: ${fouten.length} witte/lege weergaven`);
  process.exit(1);
}
console.log('GOED — doorlopende weergave toont beeld op zoom ' + ZOOMS.join('/'));
process.exit(0);
