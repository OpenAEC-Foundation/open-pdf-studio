// Poorttest #1163: de doorlopende weergave is SCHERP boven de bitmap-cap.
//
// Boven de as-cap (4096 px op de langste as) was een pagina in de doorlopende
// weergave een CSS-opgerekte bitmap: wazig. Nu is het paginacanvas daar een
// uitsnede van het zichtbare deel op apparaatresolutie, met de hele pagina op
// lage resolutie als achtergrond (open-pdf-studio/js/pdf/doorlopend-scherp.js).
//
// Per testbestand, in de doorlopende weergave:
//   - op 100 %, 200 % en 400 %: het zichtbare deel van elke pagina in beeld
//     heeft minstens devicePixelRatio bitmappixels per CSS-pixel, binnen
//     MAX_MS na de zoomopdracht;
//   - na scrollen naar een ander deel van de pagina is het weer scherp, en
//     tijdens het wachten staat de achtergrond er (geen wit);
//   - de pagina is niet wit: de inkt van een ECHTE vensteropname van het
//     paginavlak komt overeen met het canvas, en het canvas met de
//     achtergrond (geen verschuiving, geen verkeerde draaiing);
//   - uitzoomen tot onder de cap geeft weer het gewone hele-paginacanvas;
//   - dezelfde zoom in de enkelpagina-weergave heeft vergelijkbare inkt;
//   - een gedraaide pagina (90/180/270) en een document met meer pagina's;
//   - een gedraaide pagina ONDER de cap (de gewone hele-paginarender) is niet
//     wit: de vensteropname heeft de inkt van dezelfde pagina ongedraaid.
//
// De originelen worden nooit geopend: elk bestand wordt eerst naar de
// uitvoermap gekopieerd. Vensteropnamen komen als PNG in die map.
//
// Voorwaarden: een testinstantie met MCP en CDP (MCP_PORT, CDP_PORT).
// Gebruik: node scripts/verify-doorlopend-scherp.mjs [uitvoermap] [pdf ...]
//   OUD=1  alleen meten, niet beoordelen (de oude weg, OPDS_CONT_SHARP=0)
// Exit 0 = GOED, 1 = MISLUKT.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9248') + '/mcp';
const CDP = process.env.CDP_PORT || '9358';
const OUD = process.env.OUD === '1';
const UIT = process.argv[2] || path.join(os.tmpdir(), 'opds-doorlopend-scherp');
const MAP = 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/';
const BESTANDEN = process.argv.length > 3 ? process.argv.slice(3) : [
  MAP + '3199-CP-21 Constructieoverzicht.pdf',
  MAP + 'Zware vector PDF.pdf',
  MAP + 'Zware vector-2 crash.pdf',
  MAP + 'VO Constructie.pdf',
];
const GEDRAAID = process.env.GEDRAAID ?? MAP + '3131-CLT-Set.pdf';
// Een tweede bestand, alleen voor de gedraaide pagina onder de cap.
const GEDRAAID2 = process.env.GEDRAAID2 ?? MAP + 'VO Constructie.pdf';
const MEERDERE = process.env.MEERDERE ?? MAP + '3131-CLT-Set.pdf';
const ZOOMS = [1, 2, 4];
const MAX_MS = Number(process.env.MAX_MS) || 2000;
const CAP = 4096;

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
  const page = lijst.find((t) => t.type === 'page');
  if (!page) throw new Error('geen CDP-pagina');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && wachters.has(m.id)) { wachters.get(m.id)(m); wachters.delete(m.id); }
  });
}
const cdp = (method, params = {}) => new Promise((res) => { const i = ++cdpId; wachters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('evalJs: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

// ── In de pagina ───────────────────────────────────────────────────────────

// De pagina's in beeld: resolutie van het canvas over het zichtbare deel.
const STAAT = `(() => {
  const dpr = window.devicePixelRatio || 1;
  const cont = document.getElementById('pdf-container');
  const cr = cont.getBoundingClientRect();
  const paginas = [];
  document.querySelectorAll('#continuous-container .page-wrapper').forEach((w) => {
    const cc = w.querySelector('.canvas-container-cont');
    if (!cc) return;
    const r = cc.getBoundingClientRect();
    const v = { l: Math.max(r.left, cr.left), t: Math.max(r.top, cr.top), r: Math.min(r.right, cr.left + cont.clientWidth), b: Math.min(r.bottom, cr.top + cont.clientHeight) };
    if (v.r - v.l < 60 || v.b - v.t < 60) return;
    const pc = cc.querySelector('.pdf-canvas');
    const p = {
      pagina: +w.dataset.page, zoom: +(r.width / parseFloat(w.dataset.baseW)).toFixed(4),
      cssB: Math.round(r.width), cssH: Math.round(r.height), zichtB: Math.round(v.r - v.l), zichtH: Math.round(v.b - v.t),
      modus: pc ? (pc.dataset.beeld || '') : null, achtergrond: !!cc.dataset.scherpBgUrl,
      gecapt: Math.max(r.width, r.height) * dpr > ${CAP},
      bitmap: null, pxPerCss: 0, dekt: false,
    };
    if (pc && pc.width > 1) {
      const c = pc.getBoundingClientRect();
      p.bitmap = [pc.width, pc.height];
      p.pxPerCss = c.width > 0 ? +(pc.width / c.width).toFixed(3) : 0;
      p.dekt = c.left <= v.l + 1 && c.top <= v.t + 1 && c.right >= v.r - 1 && c.bottom >= v.b - 1;
    }
    paginas.push(p);
  });
  let bytes = 0;
  let uitsnedes = 0;
  document.querySelectorAll('#continuous-container canvas').forEach((c) => {
    bytes += c.width * c.height * 4;
    if (c.classList.contains('pdf-canvas') && c.dataset.beeld === 'uitsnede' && c.width > 1) uitsnedes++;
  });
  return JSON.stringify({ dpr, paginas, canvasMB: +(bytes / 1048576).toFixed(1), uitsnedes, onderweg: window.__opdsScherpOnderweg || 0 });
})()`;

// Helderheidsrasters (N x N) van het zichtbare deel van de grootste pagina in
// beeld: uit het paginacanvas en uit het achtergrondbeeld; plus waar dat deel
// in #pdf-container ligt (voor de uitsnede uit de vensteropname). Met een
// paginanummer: die pagina, ook als een andere groter in beeld staat.
const N = 64;
const rasters = (pagina = null) => `(async () => {
  const N = ${N};
  const alleen = ${pagina == null ? 'null' : Number(pagina)};
  const cont = document.getElementById('pdf-container');
  const cr = cont.getBoundingClientRect();
  let best = null;
  document.querySelectorAll('#continuous-container .page-wrapper').forEach((w) => {
    if (alleen != null && +w.dataset.page !== alleen) return;
    const cc = w.querySelector('.canvas-container-cont');
    if (!cc) return;
    const r = cc.getBoundingClientRect();
    const v = { l: Math.max(r.left, cr.left), t: Math.max(r.top, cr.top), r: Math.min(r.right, cr.left + cont.clientWidth), b: Math.min(r.bottom, cr.top + cont.clientHeight) };
    const opp = Math.max(0, v.r - v.l) * Math.max(0, v.b - v.t);
    if (opp > 3600 && (!best || opp > best.opp)) best = { w, cc, r, v, opp };
  });
  if (!best) return JSON.stringify({ fout: 'geen pagina in beeld' });
  const { cc, r, v } = best;
  const raster = (teken) => {
    const m = document.createElement('canvas');
    m.width = N; m.height = N;
    const x = m.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
    teken(x);
    const d = x.getImageData(0, 0, N, N).data;
    const uit = new Array(N * N);
    for (let i = 0; i < N * N; i++) uit[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    return uit;
  };
  // Een beeld dat op 'vak' op het scherm ligt: het stuk dat in v valt naar N x N.
  const stuk = (x, beeld, bw, bh, vak) => {
    const fx = bw / vak.width, fy = bh / vak.height;
    const l = Math.max(v.l, vak.left), t = Math.max(v.t, vak.top), rr = Math.min(v.r, vak.right), b = Math.min(v.b, vak.bottom);
    if (rr <= l || b <= t) return;
    const kx = N / (v.r - v.l), ky = N / (v.b - v.t);
    x.drawImage(beeld, (l - vak.left) * fx, (t - vak.top) * fy, (rr - l) * fx, (b - t) * fy, (l - v.l) * kx, (t - v.t) * ky, (rr - l) * kx, (b - t) * ky);
  };
  const pc = cc.querySelector('.pdf-canvas');
  const uit = { pagina: +best.w.dataset.page, canvas: null, achtergrond: null,
    deel: { x0: (v.l - cr.left) / cr.width, y0: (v.t - cr.top) / cr.height, x1: (v.r - cr.left) / cr.width, y1: (v.b - cr.top) / cr.height } };
  if (pc && pc.width > 1) uit.canvas = raster((x) => stuk(x, pc, pc.width, pc.height, pc.getBoundingClientRect()));
  // Wat het scherm hoort te tonen: de achtergrond, het paginacanvas en de
  // lagen erboven (annotaties), elk op zijn plek.
  let bg = null;
  if (cc.dataset.scherpBgUrl) {
    try { bg = new Image(); bg.src = cc.dataset.scherpBgUrl; await bg.decode(); } catch (e) { bg = null; uit.achtergrondFout = String(e); }
  }
  uit.verwacht = raster((x) => {
    if (bg && pc && pc.dataset.beeld === 'uitsnede') stuk(x, bg, bg.naturalWidth, bg.naturalHeight, r);
    cc.querySelectorAll('canvas').forEach((c) => { if (c.width > 1 && c.height > 1) stuk(x, c, c.width, c.height, c.getBoundingClientRect()); });
  });
  if (bg) uit.achtergrond = raster((x) => stuk(x, bg, bg.naturalWidth, bg.naturalHeight, r));
  return JSON.stringify(uit);
})()`;

// Helderheidsraster van een deel (fracties) van een PNG (base64).
const opnameRaster = (b64, deel) => `(async () => {
  const N = ${N};
  const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
  const beeld = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const d = ${JSON.stringify(deel)};
  const m = document.createElement('canvas'); m.width = N; m.height = N;
  const x = m.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
  x.drawImage(beeld, d.x0 * beeld.width, d.y0 * beeld.height, (d.x1 - d.x0) * beeld.width, (d.y1 - d.y0) * beeld.height, 0, 0, N, N);
  const p = x.getImageData(0, 0, N, N).data;
  const uit = new Array(N * N);
  for (let i = 0; i < N * N; i++) uit[i] = Math.round(0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]);
  beeld.close();
  return JSON.stringify(uit);
})()`;

// ── Rekenen ────────────────────────────────────────────────────────────────

/** Gemiddelde donkerte 0..1 (0 = wit). */
const inkt = (g) => (g ? g.reduce((s, v) => s + (255 - v), 0) / (g.length * 255) : 0);
/** Correlatie van twee rasters; null als een van beide (bijna) egaal is. */
function correlatie(a, b) {
  if (!a || !b) return null;
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  if (saa / n < 4 || sbb / n < 4) return null;
  return sab / Math.sqrt(saa * sbb);
}

const fouten = [];
const regels = [];
const fout = (waar, wat) => { fouten.push(`${waar}: ${wat}`); console.log(`  FOUT — ${waar}: ${wat}`); };

const staat = async () => JSON.parse(await evalJs(STAAT));
// Scherp: elke pagina in beeld is gedekt op apparaatresolutie. Boven de cap
// telt alleen een uitsnede op precies die resolutie (een oud, opgerekt beeld
// van een hogere zoom is geen eindtoestand).
const isScherp = (s) => s.paginas.length > 0 && s.paginas.every((p) => p.dekt
  && (p.gecapt ? p.modus === 'uitsnede' && Math.abs(p.pxPerCss - s.dpr) <= 0.02 : p.pxPerCss >= s.dpr - 0.02));
const vingerafdruk = (s) => s.paginas.map((p) => `${p.pagina}:${p.modus}:${p.bitmap}:${p.cssB}`).join('|');

/**
 * Wacht tot alles in beeld scherp is en zo blijft (twee metingen na elkaar
 * hetzelfde beeld, na de wachttijd waarin de app een zoom of scroll
 * afhandelt). Geeft { ms, staat }: ms tot de eerste scherpe meting, null bij
 * tijd op.
 */
async function wachtScherp(t0, maxMs = OUD ? 6000 : 20000) {
  let s = null;
  let eerste = null;
  await sleep(260);
  while (Date.now() - t0 < maxMs) {
    s = await staat();
    const nu = Date.now() - t0;
    if (isScherp(s) && s.onderweg === 0) {
      if (eerste && eerste.afdruk === vingerafdruk(s) && nu - eerste.ms >= 200) return { ms: eerste.ms, staat: s };
      if (!eerste || eerste.afdruk !== vingerafdruk(s)) eerste = { ms: nu, afdruk: vingerafdruk(s) };
    } else {
      eerste = null;
    }
    await sleep(50);
  }
  return { ms: null, staat: s };
}

async function opname(naam, breedte = 4000) {
  const s = await mcp('app_screenshot_view', { scope: 'element', selector: '#pdf-container', width: breedte });
  if (!s?.png_base64) throw new Error('geen vensteropname: ' + JSON.stringify(s).slice(0, 200));
  fs.writeFileSync(path.join(UIT, naam + '.png'), Buffer.from(s.png_base64, 'base64'));
  return s.png_base64;
}

/** Meet en beoordeel de weergave zoals ze nu staat. */
async function beoordeel(waar, naamOpname, { ms, staat: s }, { eisMs = true, pagina = null } = {}) {
  const p0 = s?.paginas?.[0];
  const samen = s?.paginas?.map((p) => `p${p.pagina} ${p.modus || 'pagina'} ${p.bitmap ? p.bitmap.join('x') : '-'} ${p.pxPerCss}px/css${p.dekt ? '' : ' DEKT NIET'}`).join('; ');
  const r = JSON.parse(await evalJs(rasters(pagina)));
  let b64 = null;
  try { b64 = await opname(naamOpname); } catch (e) { fout(waar, String(e.message || e)); }
  const scherm = b64 && r.deel ? JSON.parse(await evalJs(opnameRaster(b64, r.deel))) : null;
  const meting = {
    waar, ms, dpr: s?.dpr, zoom: p0?.zoom, gecapt: !!p0?.gecapt, modus: p0?.modus || 'pagina', pxPerCss: p0?.pxPerCss ?? 0,
    canvasMB: s?.canvasMB, inktCanvas: +inkt(r.canvas).toFixed(4), inktVerwacht: +inkt(r.verwacht).toFixed(4), inktScherm: +inkt(scherm).toFixed(4), inktAchtergrond: r.achtergrond ? +inkt(r.achtergrond).toFixed(4) : null,
    corrSchermCanvas: correlatie(scherm, r.verwacht), corrCanvasAchtergrond: correlatie(r.canvas, r.achtergrond),
  };
  regels.push(meting);
  const c = (v) => (v == null ? '-' : v.toFixed(2));
  console.log(`  ${waar}: ${ms == null ? 'NIET SCHERP' : ms + ' ms'} | zoom ${p0?.zoom} | ${samen} | canvassen ${s?.canvasMB} MB | inkt canvas ${meting.inktCanvas} verwacht ${meting.inktVerwacht} scherm ${meting.inktScherm} achtergrond ${meting.inktAchtergrond ?? '-'} | corr scherm/verwacht ${c(meting.corrSchermCanvas)} canvas/achtergrond ${c(meting.corrCanvasAchtergrond)}`);
  if (OUD) return meting;
  if (ms == null) fout(waar, `niet scherp binnen de wachttijd (${samen})`);
  else if (eisMs && ms > MAX_MS) fout(waar, `pas na ${ms} ms scherp (grens ${MAX_MS} ms)`);
  // Niet wit: het scherm toont wat het canvas heeft.
  if (meting.inktVerwacht > 0.004 && meting.inktScherm < meting.inktVerwacht * 0.5) fout(waar, `scherm (${meting.inktScherm}) veel lichter dan canvas en lagen (${meting.inktVerwacht}): wit gerasterd?`);
  // (Een haarlijn is op lage resolutie naar verhouding dikker: de achtergrond
  // mag flink donkerder zijn dan de scherpe uitsnede.)
  if (meting.inktAchtergrond != null && meting.inktAchtergrond > 0.006 && meting.inktCanvas < meting.inktAchtergrond * 0.12) fout(waar, `canvas (${meting.inktCanvas}) veel lichter dan de achtergrond (${meting.inktAchtergrond}): lege uitsnede?`);
  // (Bij weinig inkt zegt een correlatie weinig: dan telt alleen de inkt.)
  if (meting.corrSchermCanvas != null && meting.inktVerwacht > 0.01 && meting.corrSchermCanvas < 0.8) fout(waar, `scherm komt niet overeen met canvas en lagen (correlatie ${c(meting.corrSchermCanvas)})`);
  if (meting.corrCanvasAchtergrond != null && meting.inktCanvas > 0.01 && meting.corrCanvasAchtergrond < 0.5) fout(waar, `uitsnede en achtergrond komen niet overeen (correlatie ${c(meting.corrCanvasAchtergrond)}): verschoven of verkeerd gedraaid?`);
  return meting;
}

async function zoomNaar(z) {
  const t0 = Date.now();
  await mcp('app_set_zoom', { scale: z });
  return wachtScherp(t0);
}

async function openKopie(bron, naam) {
  const werk = path.join(UIT, naam + '.pdf').split(path.sep).join('/');
  fs.copyFileSync(bron, werk);
  await mcp('app_open_pdf', { path: werk });
  await sleep(3500);
  await mcp('app_set_view_mode', { mode: 'continuous' });
  await sleep(2000);
}
const sluit = async () => { try { await mcp('app_close_tab', { force: true }); } catch { /* geen tab */ } await sleep(800); };
const kort = (pad) => path.basename(pad, '.pdf').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 28);

// ── De rondes ──────────────────────────────────────────────────────────────

async function rondeBestand(bron) {
  const naam = kort(bron);
  console.log(`\n== ${path.basename(bron)}`);
  await openKopie(bron, naam);
  for (const z of ZOOMS) {
    const uitkomst = await zoomNaar(z);
    await beoordeel(`${naam} ${z * 100}%`, `${naam}-${z * 100}`, uitkomst);
    if (z < 2) continue;
    // Naar een ander deel van de pagina.
    const t0 = Date.now();
    const direct = JSON.parse(await evalJs(`(async () => {
      const c = document.getElementById('pdf-container');
      c.scrollBy(Math.round(c.clientWidth * 0.7), Math.round(c.clientHeight * 0.8));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return ${STAAT};
    })()`));
    const na = await wachtScherp(t0);
    const m = await beoordeel(`${naam} ${z * 100}% na scrollen`, `${naam}-${z * 100}-scroll`, na);
    m.achtergrondTijdensScrollen = direct.paginas.filter((p) => p.gecapt).every((p) => p.achtergrond || p.dekt);
    if (!OUD && !m.achtergrondTijdensScrollen) fout(`${naam} ${z * 100}% na scrollen`, 'direct na het scrollen geen achtergrond en geen dekkende uitsnede (wit)');
    // En ver weg (buiten de marge van de uitsnede).
    const t1 = Date.now();
    await evalJs(`(() => { const c = document.getElementById('pdf-container'); c.scrollTo(Math.round((c.scrollWidth - c.clientWidth) * 0.15), Math.round((c.scrollHeight - c.clientHeight) * 0.2)); return true; })()`);
    await beoordeel(`${naam} ${z * 100}% ver gescrold`, `${naam}-${z * 100}-ver`, await wachtScherp(t1));
  }

  // Dezelfde zoom in de enkelpagina-weergave: vergelijkbare inkt?
  const dl = regels.find((r) => r.waar === `${naam} 200%`);
  await mcp('app_set_view_mode', { mode: 'single' });
  await sleep(1500);
  await mcp('app_set_zoom', { scale: 2 });
  await sleep(4000);
  const enkel = JSON.parse(await evalJs(`(() => {
    const pc = document.getElementById('pdf-canvas'); const r = pc.getBoundingClientRect();
    const cr = document.getElementById('pdf-container').getBoundingClientRect();
    return JSON.stringify({ pxPerCss: r.width > 0 ? +(pc.width / r.width).toFixed(3) : 0,
      deel: { x0: Math.max(0, (r.left - cr.left) / cr.width), y0: Math.max(0, (r.top - cr.top) / cr.height), x1: Math.min(1, (r.right - cr.left) / cr.width), y1: Math.min(1, (r.bottom - cr.top) / cr.height) } });
  })()`));
  let inktEnkel = null;
  try { inktEnkel = +inkt(JSON.parse(await evalJs(opnameRaster(await opname(`${naam}-enkel-200`), enkel.deel)))).toFixed(4); } catch (e) { fout(`${naam} enkel`, String(e.message || e)); }
  console.log(`  enkele pagina 200%: ${enkel.pxPerCss} px/css, inkt scherm ${inktEnkel}; doorlopend 200%: inkt scherm ${dl?.inktScherm}`);
  regels.push({ waar: `${naam} enkel 200%`, pxPerCss: enkel.pxPerCss, inktScherm: inktEnkel });
  if (!OUD && inktEnkel > 0.004 && dl && dl.inktScherm < inktEnkel * 0.25) fout(`${naam} 200%`, `doorlopend (${dl.inktScherm}) veel lichter dan de enkele pagina (${inktEnkel})`);
  await mcp('app_set_view_mode', { mode: 'continuous' });
  await sleep(2000);

  // Onder de cap: het gewone canvas van de hele pagina, zonder achtergrond.
  const maat = JSON.parse(await evalJs(`(() => { let b = 0, h = 0; document.querySelectorAll('#continuous-container .page-wrapper').forEach((w) => { b = Math.max(b, parseFloat(w.dataset.baseW) || 0); h = Math.max(h, parseFloat(w.dataset.baseH) || 0); }); return JSON.stringify({ b, h, dpr: window.devicePixelRatio || 1 }); })()`));
  const onder = Math.min(1, Math.floor((CAP * 0.85) / (Math.max(maat.b, maat.h) * maat.dpr) * 100) / 100);
  const uit = await zoomNaar(onder);
  // (Onder de cap tekent de gewone hele-paginarender; diens duur op een zwaar
  // blad is hier niet de vraag.)
  const m = await beoordeel(`${naam} ${Math.round(onder * 100)}% (onder de cap)`, `${naam}-onder-de-cap`, uit, { eisMs: false });
  const p = uit.staat?.paginas?.[0];
  if (!OUD && p && (p.modus === 'uitsnede' || p.achtergrond || p.gecapt)) fout(m.waar, `nog in uitsnede-modus onder de cap (modus ${p.modus}, achtergrond ${p.achtergrond})`);
  await sluit();
}

// Een zoom waarop pagina 1 in elke stand helemaal in beeld past en onder de
// cap blijft: daar tekent de gewone hele-paginarender, en de inkt van de
// pagina is in elke stand dezelfde.
async function zoomOnderDeCap() {
  const m = JSON.parse(await evalJs(`(() => {
    const w = document.querySelector('#continuous-container .page-wrapper[data-page="1"]');
    const c = document.getElementById('pdf-container');
    return JSON.stringify({ b: parseFloat(w.dataset.baseW) || 0, h: parseFloat(w.dataset.baseH) || 0, cb: c.clientWidth, ch: c.clientHeight, dpr: window.devicePixelRatio || 1 });
  })()`));
  const lang = Math.max(m.b, m.h);
  const past = (Math.min(m.cb, m.ch) * 0.8) / lang;
  const cap = (CAP * 0.85) / (lang * m.dpr);
  return Math.max(0.1, Math.floor(Math.min(1, past, cap) * 100) / 100);
}

/**
 * Pagina 1 onder de cap, zoals ze nu gedraaid staat: het gewone canvas van de
 * hele pagina, en op een echte vensteropname de inkt van `basis` (dezelfde
 * pagina ongedraaid op dezelfde zoom). Een witte pagina heeft die niet.
 */
async function beoordeelOnderDeCap(waar, naamOpname, zoom, basis) {
  await mcp('app_go_to_page', { page: 1 });
  await sleep(600);
  const uit = await zoomNaar(zoom);
  const m = await beoordeel(waar, naamOpname, uit, { eisMs: false, pagina: 1 });
  if (OUD) return m;
  const p = uit.staat?.paginas?.find((q) => q.pagina === 1);
  if (!p) fout(waar, 'pagina 1 staat niet in beeld');
  else if (p.modus === 'uitsnede' || p.gecapt) fout(waar, `niet de hele-paginarender (modus ${p.modus}, gecapt ${p.gecapt})`);
  if (basis) {
    if (m.inktCanvas < basis.inktCanvas * 0.5) fout(waar, `canvas (inkt ${m.inktCanvas}) veel lichter dan ongedraaid (${basis.inktCanvas}): witte pagina?`);
    if (m.inktScherm < basis.inktScherm * 0.5) fout(waar, `scherm (inkt ${m.inktScherm}) veel lichter dan ongedraaid (${basis.inktScherm}): witte pagina?`);
  } else if (m.inktScherm < 0.002) {
    fout(waar, `ongedraaide pagina heeft geen inkt op het scherm (${m.inktScherm}): ongeschikt als maatstaf`);
  }
  return m;
}

async function rondeGedraaid(bron, { alleenOnderDeCap = false } = {}) {
  if (!bron) return;
  const naam = kort(bron) + '-draai';
  console.log(`\n== gedraaid${alleenOnderDeCap ? ' (alleen onder de cap)' : ''}: ${path.basename(bron)}`);
  await openKopie(bron, naam);
  const onder = await zoomOnderDeCap();
  const basis = await beoordeelOnderDeCap(`${naam} 0 graden ${Math.round(onder * 100)}% (onder de cap)`, `${naam}-0-onder`, onder, null);
  // 90 graden door de pagina te draaien, 180 door daarbovenop de weergave te
  // draaien, 270 door de pagina nog een kwartslag te draaien.
  const stappen = [[90, 'pagina'], [180, 'weergave'], [270, 'pagina']];
  for (const [hoek, soort] of stappen) {
    if (soort === 'pagina') await mcp('app_rotate_pages', { angle: 90, pages: [1] });
    else await mcp('app_run_command', { command: 'ribbon:#view-rotate-right' });
    await sleep(2500);
    // Onder de cap: de hele-paginarender mag de gedraaide pagina niet wit
    // laten (kwartslagen kwamen buiten de bitmap terecht).
    await beoordeelOnderDeCap(`${naam} ${hoek} graden (${soort}) ${Math.round(onder * 100)}% (onder de cap)`, `${naam}-${hoek}-onder`, onder, basis);
    if (alleenOnderDeCap) continue;
    await mcp('app_go_to_page', { page: 1 });
    await sleep(800);
    const uit = await zoomNaar(hoek === 180 ? 2.5 : 2);
    await beoordeel(`${naam} ${hoek} graden (${soort})`, `${naam}-${hoek}`, uit, { eisMs: false });
    const t0 = Date.now();
    await evalJs(`(() => { const c = document.getElementById('pdf-container'); c.scrollTo(Math.round((c.scrollWidth - c.clientWidth) * 0.8), Math.round((c.scrollHeight - c.clientHeight) * 0.7)); return true; })()`);
    await beoordeel(`${naam} ${hoek} graden gescrold`, `${naam}-${hoek}-scroll`, await wachtScherp(t0));
  }
  await sluit();
}

async function rondeMeerdere(bron) {
  if (!bron) return;
  const naam = kort(bron) + '-meer';
  console.log(`\n== meer pagina's: ${path.basename(bron)}`);
  await openKopie(bron, naam);
  const aantal = Number((await mcp('app_get_page_count', {}))?.page_count ?? (await mcp('app_get_page_count', {}))?.count ?? 0) || 3;
  await beoordeel(`${naam} 200% p1`, `${naam}-p1`, await zoomNaar(2));
  for (const pagina of [2, Math.min(aantal, 3), 1].filter((v, i, a) => v <= aantal && a.indexOf(v) === i)) {
    const t0 = Date.now();
    await mcp('app_go_to_page', { page: pagina });
    const uit = await wachtScherp(t0);
    const m = await beoordeel(`${naam} 200% naar p${pagina}`, `${naam}-p${pagina}`, uit, { eisMs: false });
    m.uitsnedes = uit.staat?.uitsnedes;
    console.log(`    uitsnedes met beeld: ${uit.staat?.uitsnedes}, pagina's in beeld: ${uit.staat?.paginas?.length}`);
    // Pagina's buiten beeld geven hun bitmap terug.
    if (!OUD && uit.staat && uit.staat.uitsnedes > uit.staat.paginas.length + 2) fout(m.waar, `${uit.staat.uitsnedes} uitsnedes houden een bitmap vast bij ${uit.staat.paginas.length} pagina's in beeld`);
  }
  await sluit();
}

// Een pagina met /UserUnit 2: de app rekent in pagina-eenheden, de uitsnede
// moet op dezelfde plek uitkomen als het beeld van de hele pagina.
async function rondeUserUnit() {
  let PDFDocument, PDFName, PDFNumber, rgb;
  try {
    const vereist = createRequire(process.env.OPDS_NODE_MODULES
      ? path.join(process.env.OPDS_NODE_MODULES, 'x.js')
      : new URL('../open-pdf-studio/package.json', import.meta.url));
    ({ PDFDocument, PDFName, PDFNumber, rgb } = vereist('pdf-lib'));
  } catch (e) {
    console.log('\n== /UserUnit: overgeslagen (pdf-lib niet gevonden: ' + String(e.message || e).slice(0, 80) + ')');
    return;
  }
  console.log('\n== /UserUnit 2 (gegenereerd)');
  const pdf = await PDFDocument.create();
  const blad = pdf.addPage([1190, 842]);
  blad.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  // Een onregelmatig patroon: een verschuiving of een verkeerde schaal valt op.
  for (let i = 0; i < 40; i++) {
    const x = 30 + ((i * 197) % 1100);
    const y = 30 + ((i * 331) % 760);
    blad.drawRectangle({ x, y, width: 20 + (i % 7) * 12, height: 14 + (i % 5) * 16, color: rgb((i % 4) / 4, (i % 3) / 3, 0.2 + (i % 5) / 8), borderWidth: 0 });
    blad.drawLine({ start: { x, y }, end: { x: 1190 - x / 2, y: 842 - y / 3 }, thickness: 0.4, color: rgb(0, 0, 0) });
  }
  const werk = path.join(UIT, 'userunit.pdf').split(path.sep).join('/');
  fs.writeFileSync(werk, await pdf.save());
  await mcp('app_open_pdf', { path: werk });
  await sleep(3000);
  await mcp('app_set_view_mode', { mode: 'continuous' });
  await sleep(1500);
  for (const z of [3, 6]) {
    await beoordeel(`userunit ${z * 100}%`, `userunit-${z * 100}`, await zoomNaar(z));
    const t0 = Date.now();
    await evalJs(`(() => { const c = document.getElementById('pdf-container'); c.scrollTo(Math.round((c.scrollWidth - c.clientWidth) * 0.7), Math.round((c.scrollHeight - c.clientHeight) * 0.6)); return true; })()`);
    await beoordeel(`userunit ${z * 100}% gescrold`, `userunit-${z * 100}-scroll`, await wachtScherp(t0));
  }
  await sluit();
}

fs.mkdirSync(UIT, { recursive: true });
await cdpVerbind();
console.log(`uitvoer: ${UIT}${OUD ? ' (OUD=1: alleen meten)' : ''}`);
console.log('venster:', await evalJs(`(() => { const c = document.getElementById('pdf-container'); return JSON.stringify({ dpr: window.devicePixelRatio, venster: [innerWidth, innerHeight], documentvlak: [c.clientWidth, c.clientHeight] }); })()`));
for (const bron of BESTANDEN) await rondeBestand(bron);
await rondeGedraaid(GEDRAAID);
if (process.argv.length <= 3) await rondeGedraaid(GEDRAAID2, { alleenOnderDeCap: true });
await rondeMeerdere(MEERDERE);
if (process.argv.length <= 3) await rondeUserUnit();
ws.close();

fs.writeFileSync(path.join(UIT, OUD ? 'metingen-oud.json' : 'metingen.json'), JSON.stringify(regels, null, 1));
if (fouten.length) {
  console.log('');
  for (const f of fouten) console.log('FOUT —', f);
  console.log(`MISLUKT: ${fouten.length} afwijkingen`);
  process.exit(1);
}
console.log(OUD ? '\nGEMETEN (oude weg, niet beoordeeld)' : `\nGOED — doorlopend scherp op ${ZOOMS.map((z) => z * 100).join('/')} %, na scrollen, gedraaid en met meer pagina's`);
process.exit(0);
