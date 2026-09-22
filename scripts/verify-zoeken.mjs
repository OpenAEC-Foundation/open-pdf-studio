// Release-poorttest: zoekmarkeringen liggen op het gevonden woord.
//
// Aanleiding: bij zoeken op een woord stonden de markeringen ergens anders op
// de pagina (linksboven, meerdere keren te groot) dan de treffers — de telling
// "1 of 2" klopte wel. Deze test bedient de zoekfunctie via de GUI (Ctrl+F,
// typen, Enter/Shift+Enter, knoppen voor vorige/volgende, "alles markeren" en
// hoofdlettergevoelig) en meet per markering of die op het woord ligt.
//
// Het script maakt zijn eigen synthetische test-PDF met pdf-lib: een liggende
// en een staande pagina, pagina's met /Rotate 90, 180 en 270 en een pagina
// waarvan de MediaBox niet op 0,0 begint. De verwachte plek van elk woord
// komt uit de bekende tekenposities (pdf-lib-fontmaten) via de weergavematrix
// van pdf.js (PageViewport); de gemeten plek is getBoundingClientRect() van
// elke .search-highlight. Dat gebeurt in enkele pagina en Doorlopend, op zoom
// 50/100/175 %, en na een zoomwissel zonder opnieuw te zoeken.
//
// Voorwaarden: testrig draait (--mcp-server; MCP_PORT default 9223, CDP via
// CDP_PORT default 9345). Gebruik:
//   node scripts/verify-zoeken.mjs
// Uitvoer (PDF, schermafdrukken, rapport.json): map in %TEMP% (ZOEK_UIT).
// Exit 0 = GOED, exit 1 = MISLUKT (met details op stdout).
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const HIER = path.dirname(fileURLToPath(import.meta.url));
// Draait dit script vanuit een worktree zonder eigen node_modules, geef dan
// met OPDS_NODE_MODULES de map van een checkout die ze wel heeft.
const MODULEMAPPEN = [
  path.join(HIER, '..', 'open-pdf-studio', 'node_modules'),
  ...(process.env.OPDS_NODE_MODULES ? [process.env.OPDS_NODE_MODULES] : []),
];
function modulePad(naam) {
  for (const basis of MODULEMAPPEN) {
    const p = path.join(basis, naam);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`module ${naam} niet gevonden in ${MODULEMAPPEN.join(' of ')}`);
}
const playwright = require(modulePad('playwright'));
const { PDFDocument, StandardFonts, degrees } = require(modulePad('pdf-lib'));
const pdfjs = await import(pathToFileURL(path.join(modulePad('pdfjs-dist'), 'legacy', 'build', 'pdf.mjs')).href);

const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9223') + '/mcp';
const CDP = process.env.CDP_PORT || '9345';
const UIT = process.env.ZOEK_UIT || path.join(os.tmpdir(), 'verify-zoeken');
const TOLERANTIE = 2; // px per rand
const ZOOMS = [0.5, 1.0, 1.75];
const WOORD = 'Merkwoord';

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

// ── Synthetische test-PDF ───────────────────────────────────────────────────
// Elke regel: [tekst, x, y (basislijn), grootte] in PDF-user-space. De eerste
// pagina bootst de melding na: kleine tabelregels (6 pt) die met het woord
// beginnen, onder een "logo"-blok linksboven.
const A4 = [595.28, 841.89];
const PAGINAS = [
  { naam: 'liggend', box: [0, 0, A4[1], A4[0]], rot: 0, logo: [40, 505, 110, 55], regels: [
    ['Overzicht van de posten', 64.5, 470, 14],
    ['Merkwoord berekening + controle', 64.5, 385.86, 6],
    ['Merkwoord oplevering', 64.5, 378.56, 6],
    ['Overige posten', 64.5, 371.26, 6],
  ] },
  { naam: 'staand', box: [0, 0, A4[0], A4[1]], rot: 0, regels: [
    ['Merkwoord', 72, 760, 12],
    ['een regel met Merkwoord midden in de zin', 72, 400, 12],
    ['HOOFDLETTERS: MERKWOORD', 300, 200, 10],
  ] },
  { naam: 'rotate-90', box: [0, 0, A4[0], A4[1]], rot: 90, regels: [['Merkwoord op een gedraaide pagina', 72, 700, 14]] },
  { naam: 'rotate-180', box: [0, 0, A4[0], A4[1]], rot: 180, regels: [['Merkwoord op een gedraaide pagina', 72, 700, 14]] },
  { naam: 'rotate-270', box: [0, 0, A4[0], A4[1]], rot: 270, regels: [['Merkwoord op een gedraaide pagina', 72, 700, 14]] },
  { naam: 'mediabox-verschoven', box: [200, 100, 200 + A4[0], 100 + A4[1]], rot: 0, regels: [['Merkwoord in een verschoven box', 272, 800, 12]] },
];

// Bouwt de PDF en geeft per pagina de treffers van WOORD (hoofdletterongevoelig)
// met hun rechthoek in user-space: x van de glyphs, y van basislijn−0,2·em tot
// basislijn+0,8·em (dezelfde ascent-conventie als de tekstlaag).
async function maakTestPdf(pad) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const treffers = [];
  PAGINAS.forEach((def, i) => {
    const [x0, y0, x1, y1] = def.box;
    const page = doc.addPage([x1 - x0, y1 - y0]);
    page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
    if (def.rot) page.setRotation(degrees(def.rot));
    if (def.logo) page.drawRectangle({ x: def.logo[0], y: def.logo[1], width: def.logo[2], height: def.logo[3], borderWidth: 1 });
    for (const [tekst, x, y, s] of def.regels) {
      page.drawText(tekst, { x, y, size: s, font });
      const laag = tekst.toLowerCase();
      for (let k = laag.indexOf(WOORD.toLowerCase()); k >= 0; k = laag.indexOf(WOORD.toLowerCase(), k + 1)) {
        const bx = x + font.widthOfTextAtSize(tekst.slice(0, k), s);
        const bw = font.widthOfTextAtSize(tekst.slice(k, k + WOORD.length), s);
        treffers.push({ pagina: i + 1, naam: def.naam, tekst: tekst.slice(k, k + WOORD.length), y,
          box: [bx, y - 0.2 * s, bx + bw, y + 0.8 * s] });
      }
    }
  });
  const bytes = await doc.save();
  fs.writeFileSync(pad, bytes);
  // Weergavematrix per pagina uit pdf.js zelf (MediaBox-oorsprong + /Rotate).
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const viewports = [];
  for (let p = 1; p <= pdf.numPages; p++) viewports.push((await pdf.getPage(p)).getViewport({ scale: 1 }));
  for (const t of treffers) {
    const vp = viewports[t.pagina - 1];
    const [bx0, by0, bx1, by1] = t.box;
    const hoeken = [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]].map(([x, y]) => vp.convertToViewportPoint(x, y));
    const xs = hoeken.map((h) => h[0]); const ys = hoeken.map((h) => h[1]);
    // Rechthoek in weergavepunten (oorsprong linksboven van de getoonde pagina).
    t.weergave = { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    t.paginaMaat = { w: vp.width, h: vp.height };
  }
  // Leesvolgorde zoals de app sorteert: pagina, dan PDF-y aflopend, dan x.
  treffers.sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.box[0] - b.box[0]);
  return treffers;
}

// ── Meting in de pagina (DOM, via CDP) ──────────────────────────────────────
// Enkele pagina: paginaoorsprong = #pdf-canvas + viewport-offset, schaal =
// viewport-zoom. Doorlopend: de pagina-container van elke .page-wrapper.
const METING = () => {
  const vp = window.__pdfViewport || {};
  const pc = document.getElementById('pdf-canvas');
  const pcr = pc ? pc.getBoundingClientRect() : { left: 0, top: 0 };
  const enkel = { x: pcr.left + (vp.offsetX || 0), y: pcr.top + (vp.offsetY || 0), zoom: vp.zoom || 1,
    breed: pcr.width || 0, hoog: pcr.height || 0 };
  const paginas = {};
  document.querySelectorAll('#continuous-container .page-wrapper').forEach((w) => {
    const c = w.querySelector('.canvas-container-cont');
    if (!c || w.offsetParent === null) return;
    const r = c.getBoundingClientRect();
    paginas[w.dataset.page] = { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // Alleen wat de gebruiker ziet: markeringen binnen het documentvenster.
  const cr = document.getElementById('pdf-container')?.getBoundingClientRect();
  const inBeeld = (r) => !cr || (r.right > cr.left && r.left < cr.right && r.bottom > cr.top && r.top < cr.bottom);
  const markeringen = [...document.querySelectorAll('.search-highlight')].map((h) => {
    const r = h.getBoundingClientRect();
    const w = h.closest('.page-wrapper');
    return { huidig: h.classList.contains('current'), pagina: w ? +w.dataset.page : null,
      l: r.left, t: r.top, r: r.right, b: r.bottom, zichtbaar: r.width > 0 && r.height > 0 && h.offsetParent !== null && inBeeld(r) };
  }).filter((m) => m.zichtbaar);
  const telling = (document.querySelector('.find-count-inline')?.textContent || '').trim();
  const venster = cr ? { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom } : null;
  return { enkel, paginas, markeringen, telling, venster };
};

const rnd = (v) => Math.round(v * 10) / 10;

// Schermrechthoek van een treffer volgens de meting (null = pagina niet in beeld).
function verwachteRect(t, meting, modus) {
  let x, y, s;
  if (modus === 'single') { ({ x, y } = meting.enkel); s = meting.enkel.zoom; } else {
    const p = meting.paginas[t.pagina];
    if (!p) return null;
    x = p.x; y = p.y; s = p.w / t.paginaMaat.w;
  }
  const w = t.weergave;
  return { l: x + w.l * s, t: y + w.t * s, r: x + w.r * s, b: y + w.b * s };
}
// Ligt (een deel van) de verwachte rechthoek in het documentvenster?
const zichtbaarIn = (e, v) => !!e && (!v || (e.r > v.l && e.l < v.r && e.b > v.t && e.t < v.b));
const afwijking = (a, b) => Math.max(Math.abs(a.l - b.l), Math.abs(a.t - b.t), Math.abs(a.r - b.r), Math.abs(a.b - b.b));

// Beoordeelt één meting. `v` = { modus, pagina (huidige pagina bij enkel),
// huidig (index in `lijst`), lijst (verwachte treffers van deze zoekopdracht),
// alles (alles markeren aan) }. Geeft een lijst foutteksten + een samenvatting.
function beoordeel(label, meting, v) {
  const fout = [];
  const totaal = v.lijst.length;
  const verwachtTelling = totaal ? `${v.huidig + 1} of ${totaal}` : 'No results';
  if (meting.telling !== verwachtTelling) fout.push(`telling "${meting.telling}", verwacht "${verwachtTelling}"`);
  // Zonder getekende pagina valt er niets te vergelijken (venster te klein,
  // render mislukt, of iemand heeft het venster onderhanden).
  if (v.modus === 'single' && !(meting.enkel.breed > 0 && meting.enkel.hoog > 0)) {
    fout.push('geen getekende pagina in beeld (#pdf-canvas is 0 px) — meting onbetrouwbaar');
    return { label, fout, maxAfw: 0, aantal: meting.markeringen.length, telling: meting.telling };
  }
  const opPagina = (m) => (v.modus === 'single' ? v.pagina : m.pagina);
  let maxAfw = 0;
  const gekoppeld = new Set();
  for (const m of meting.markeringen) {
    const kandidaten = v.lijst.map((t, i) => ({ t, i })).filter(({ t }) => t.pagina === opPagina(m));
    let beste = null;
    for (const k of kandidaten) {
      const e = verwachteRect(k.t, meting, v.modus);
      if (!e) continue;
      const d = afwijking(m, e);
      if (!beste || d < beste.d) beste = { ...k, e, d };
    }
    if (!beste) { fout.push(`markering op p${opPagina(m)} zonder treffer op die pagina (${rnd(m.l)},${rnd(m.t)})`); continue; }
    maxAfw = Math.max(maxAfw, beste.d);
    gekoppeld.add(beste.i);
    if (beste.d > TOLERANTIE) {
      const factor = (m.b - m.t) / (beste.e.b - beste.e.t);
      fout.push(`markering p${beste.t.pagina} (${beste.t.naam}) wijkt ${rnd(beste.d)} px af: gemeten l/t/r/b ${[m.l, m.t, m.r, m.b].map(rnd).join('/')} ` +
        `verwacht ${[beste.e.l, beste.e.t, beste.e.r, beste.e.b].map(rnd).join('/')} (hoogtefactor ${factor.toFixed(2)})`);
    }
    if (m.huidig && beste.i !== v.huidig) fout.push(`huidige markering ligt op treffer ${beste.i + 1}, verwacht ${v.huidig + 1}`);
  }
  const huidige = meting.markeringen.filter((m) => m.huidig);
  // Alleen treffers die in beeld horen te zijn, tellen mee voor "ontbreekt".
  const inVenster = (t) => (v.modus !== 'single' || t.pagina === v.pagina) && zichtbaarIn(verwachteRect(t, meting, v.modus), meting.venster);
  if (totaal && !huidige.length && inVenster(v.lijst[v.huidig])) fout.push('geen huidige (oranje) markering zichtbaar');
  if (totaal && huidige.length && v.modus === 'single' && v.pagina !== v.lijst[v.huidig].pagina) {
    fout.push(`app staat op p${v.pagina}, huidige treffer staat op p${v.lijst[v.huidig].pagina}`);
  }
  // Alles markeren: elke treffer op een getoonde pagina heeft een markering.
  const inBeeld = v.lijst.filter(inVenster);
  const verwachtAantal = v.alles ? inBeeld.length : (totaal && inVenster(v.lijst[v.huidig]) ? 1 : 0);
  if (v.modus === 'single' && meting.markeringen.length !== verwachtAantal) {
    fout.push(`${meting.markeringen.length} markeringen zichtbaar, verwacht ${verwachtAantal}`);
  }
  if (v.modus !== 'single' && !v.alles && meting.markeringen.length > 1) fout.push(`${meting.markeringen.length} markeringen terwijl alles markeren uit staat`);
  // Elke treffer op de pagina van de huidige treffer moet gemarkeerd zijn.
  if (v.alles && totaal) {
    const p = v.lijst[v.huidig].pagina;
    v.lijst.forEach((t, i) => { if (t.pagina === p && inVenster(t) && !gekoppeld.has(i)) fout.push(`treffer ${i + 1} (p${p}, ${t.naam}) heeft geen markering`); });
  }
  return { label, fout, maxAfw: rnd(maxAfw), aantal: meting.markeringen.length, telling: meting.telling };
}

// ── GUI-bediening ───────────────────────────────────────────────────────────
let pagina = null; // playwright-pagina van de rig
const resultaten = [];
let schotNr = 0;

async function staat() { return (await mcp('app_get_viewport_state', {}))?.doc || {}; }

// Meet alleen in de eigen tab: staat een andere tab actief (bv. doordat iemand
// in het rig-venster werkt), dan terugschakelen. Andere tabs blijven met rust.
let EIGEN_PAD = null;
const normPad = (p) => String(p || '').split(String.fromCharCode(92)).join('/').toLowerCase();
const zelfdePad = (a, b) => normPad(a) === normPad(b);
async function eigenTabActief() {
  const l = await mcp('app_list_tabs', {});
  const tabs = l?.tabs || [];
  const actief = tabs.find((t) => t.active);
  if (actief && zelfdePad(actief.filePath, EIGEN_PAD)) return;
  const eigen = tabs.find((t) => zelfdePad(t.filePath, EIGEN_PAD));
  if (!eigen) throw new Error('testbestand is niet meer open in de app');
  console.log(`  (actieve tab was ${actief?.fileName || '-'}; terug naar het testbestand)`);
  await mcp('app_switch_tab', { index: eigen.index });
  await sleep(2500);
}

// Wacht tot de telling klopt en de markeringen twee peilingen op rij stilstaan
// (zoeken, paginawissel, scrollen en herrenderen lopen asynchroon).
async function wachtStabiel(verwachtTelling, maxMs = 9000) {
  let vorige = null; let m = null;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(350);
    m = await pagina.evaluate(METING);
    const sleutel = JSON.stringify([m.telling, m.enkel, m.paginas, m.markeringen.map((x) => [rnd(x.l), rnd(x.t), rnd(x.r), rnd(x.b), x.huidig])]);
    const klaar = !verwachtTelling || m.telling === verwachtTelling;
    if (klaar && sleutel === vorige) return m;
    vorige = sleutel;
  }
  return m;
}

async function schermafdruk(label) {
  const pad = path.join(UIT, `${String(++schotNr).padStart(2, '0')}-${label.replace(/[^A-Za-z0-9._-]+/g, '_')}.png`);
  await pagina.screenshot({ path: pad }).catch(() => {});
  return pad;
}

// Meet, beoordeelt en logt één toestand; bij een fout ook een schermafdruk.
async function controleer(label, v, verwachtTelling, altijdSchot = false) {
  await eigenTabActief();
  const m = await wachtStabiel(verwachtTelling);
  const st = await staat();
  if (v.modus === 'single') v = { ...v, pagina: st.currentPage };
  const r = beoordeel(label, m, v);
  r.zoom = rnd((st.scale || 0) * 100);
  if (r.fout.length || altijdSchot) r.schot = await schermafdruk(label);
  resultaten.push(r);
  console.log(`${r.fout.length ? 'FOUT' : 'GOED'} — ${label} [zoom ${r.zoom}%, ${r.aantal} markeringen, "${r.telling}", max afwijking ${r.maxAfw} px]`);
  for (const f of r.fout) console.log('       ' + f);
  return r;
}

const zoekveld = () => pagina.locator('.find-bar .find-input');
const knop = (sel, n) => pagina.locator(`.find-bar ${sel}`).nth(n);

async function zoekbalkOpenen() {
  await pagina.locator('#pdf-container').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await pagina.keyboard.press('Control+f');
  await zoekveld().waitFor({ state: 'visible', timeout: 5000 });
}

async function typZoekterm(tekst) {
  await zoekveld().click();
  await pagina.keyboard.press('Control+a');
  await pagina.keyboard.press('Backspace');
  await zoekveld().type(tekst, { delay: 25 });
}

async function zetModusEnZoom(modus, zoom) {
  await mcp('app_set_view_mode', { mode: modus });
  await sleep(1500);
  if (zoom) { await mcp('app_set_zoom', { scale: zoom }); await sleep(1200); }
}

// Loopt met Enter/Shift+Enter en de knoppen door de treffers; elke stap moet
// de telling, de pagina en de plek van de huidige markering goed hebben.
async function doorloop(M, v) {
  const n = v.lijst.length;
  await zoekveld().click();
  let idx = v.huidig;
  for (let i = 0; i < n; i++) {
    await zoekveld().click();
    await pagina.keyboard.press('Enter');
    idx = (idx + 1) % n;
    await controleer(`${M}: volgende (Enter) → treffer ${idx + 1}`, { ...v, huidig: idx }, `${idx + 1} of ${n}`);
  }
  await zoekveld().click();
  await pagina.keyboard.press('Shift+Enter');
  idx = (idx - 1 + n) % n;
  await controleer(`${M}: vorige (Shift+Enter) → treffer ${idx + 1}`, { ...v, huidig: idx }, `${idx + 1} of ${n}`);
  await knop('.find-btn', 1).click();
  idx = (idx + 1) % n;
  await controleer(`${M}: knop volgende → treffer ${idx + 1}`, { ...v, huidig: idx }, `${idx + 1} of ${n}`);
  await knop('.find-btn', 0).click();
  idx = (idx - 1 + n) % n;
  await controleer(`${M}: knop vorige → treffer ${idx + 1}`, { ...v, huidig: idx }, `${idx + 1} of ${n}`);
  return idx;
}

// Eerste treffer vanaf de huidige pagina — zo kiest de app de startreffer.
async function startIndex(lijst) {
  const p = (await staat()).currentPage || 1;
  const i = lijst.findIndex((t) => t.pagina >= p);
  return i < 0 ? 0 : i;
}

async function zoekOpnieuw(M, v, term, label) {
  const huidig = await startIndex(v.lijst);
  await typZoekterm(term);
  const w = { ...v, huidig };
  await controleer(`${M}: ${label}`, w, v.lijst.length ? `${huidig + 1} of ${v.lijst.length}` : 'No results', true);
  return w;
}

// Volledige ronde in één weergave: zoeken, zoomen zonder opnieuw zoeken,
// doorlopen, alles markeren uit/aan en hoofdlettergevoelig.
async function ronde(modus, alle, exact, hoofd, start) {
  const M = modus === 'single' ? 'enkel' : 'doorlopend';
  const v = { modus, huidig: start, lijst: alle, alles: true };
  for (const z of ZOOMS) {
    await mcp('app_set_zoom', { scale: z });
    await controleer(`${M}: zoom ${z * 100}% zonder opnieuw zoeken`, v, null, true);
  }
  await doorloop(`${M} 175%`, v);
  await mcp('app_go_to_page', { page: 1 });
  await sleep(1200);
  let w = await zoekOpnieuw(M, v, WOORD.toLowerCase(), `opnieuw zoeken op "${WOORD.toLowerCase()}" vanaf p1`);
  await knop('.find-toggle-btn', 2).click();
  await controleer(`${M}: alles markeren uit`, { ...w, alles: false }, `${w.huidig + 1} of ${alle.length}`);
  await knop('.find-toggle-btn', 2).click();
  await controleer(`${M}: alles markeren weer aan`, w, `${w.huidig + 1} of ${alle.length}`);
  await knop('.find-toggle-btn', 0).click();
  await controleer(`${M}: hoofdlettergevoelig aan, "${WOORD.toLowerCase()}"`, { ...w, lijst: [], huidig: 0 }, 'No results');
  w = await zoekOpnieuw(M, { ...v, lijst: hoofd }, WOORD.toUpperCase(), `hoofdlettergevoelig, "${WOORD.toUpperCase()}"`);
  w = await zoekOpnieuw(M, { ...v, lijst: exact }, WOORD, `hoofdlettergevoelig, "${WOORD}"`);
  await knop('.find-toggle-btn', 0).click();
  await mcp('app_go_to_page', { page: 1 });
  await sleep(1200);
  return zoekOpnieuw(M, v, WOORD.toLowerCase(), `hoofdlettergevoelig uit, "${WOORD.toLowerCase()}" vanaf p1`);
}

// ── Zoekbronnen: tekst en annotaties ────────────────────────────────────────
// De annotaties worden via de app aangemaakt (zoals een gebruiker ze plaatst);
// het zoeken zelf gebeurt gewoon via de zoekbalk.
const ANNOTATIES = [
  { pagina: 2, type: 'textbox', props: { x: 60, y: 300, width: 240, height: 40, text: `${WOORD} in een tekstvak`, fontSize: 12 } },
  { pagina: 3, type: 'comment', props: { x: 90, y: 150, width: 24, height: 24, text: `${WOORD} in een notitie` } },
];

// Stand van de zoekbalk: vinkjes, hint en de resultatenlijst per pagina.
const LIJST = () => ({
  vinkjes: [...document.querySelectorAll('.find-sources .find-check input')].map((i) => i.checked),
  hint: (document.querySelector('.find-sources-hint')?.textContent || '').trim(),
  titel: (document.querySelector('.find-results-header')?.textContent || '').trim(),
  rijen: [...document.querySelectorAll('.find-results-row')].map((r) => ({
    pagina: +r.dataset.page, aantal: +r.dataset.count, annotaties: +r.dataset.annotations,
    huidig: r.classList.contains('current'), tekst: (r.textContent || '').replace(/\s+/g, ' ').trim(),
  })),
  telling: (document.querySelector('.find-count-inline')?.textContent || '').trim(),
  kaders: [...document.querySelectorAll('.search-highlight-annotation')].map((h) => {
    const b = h.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, huidig: h.classList.contains('current') };
  }),
});

const bronKnop = (n) => pagina.locator('.find-sources .find-check input').nth(n);

// Vinkje omzetten. In een smal venster kan een gedokt palet over de rand van
// de zoekbalk vallen; dan valt de muisklik terug op een klik via het element
// zelf (zelfde change-gebeurtenis, alleen zonder muisaanwijzer).
async function wisselBron(n) {
  try {
    await bronKnop(n).click({ timeout: 4000 });
  } catch {
    await bronKnop(n).evaluate((el) => el.click());
  }
  await sleep(400);
}

function noteer(label, fout) {
  resultaten.push({ label, fout });
  console.log(`${fout.length ? 'FOUT' : 'GOED'} — ${label}`);
  for (const f of fout) console.log('       ' + f);
}

async function bronnenRonde(tekstTreffers) {
  await eigenTabActief();
  for (const a of ANNOTATIES) {
    await mcp('app_create_annotation', { page: a.pagina, type: a.type, props: a.props });
  }
  await sleep(1500);
  const totaal = tekstTreffers + ANNOTATIES.length;

  // Opnieuw zoeken zodat de annotaties meetellen.
  await typZoekterm(WOORD.toLowerCase());
  await wachtStabiel(`1 of ${totaal}`);
  let L = await pagina.evaluate(LIJST);
  const fout = [];
  if (!L.vinkjes.every(Boolean) || L.vinkjes.length !== 2) fout.push(`vinkjes ${JSON.stringify(L.vinkjes)}, verwacht twee aangevinkte`);
  if (!L.titel.includes(String(totaal))) fout.push(`lijstkop "${L.titel}" noemt het totaal ${totaal} niet`);
  const p2 = L.rijen.find((r) => r.pagina === 2);
  const p3 = L.rijen.find((r) => r.pagina === 3);
  if (!p2 || p2.aantal !== 4 || p2.annotaties !== 1) fout.push(`regel pagina 2: ${JSON.stringify(p2)} (verwacht 4 treffers, 1 annotatie)`);
  if (!p3 || p3.aantal !== 2 || p3.annotaties !== 1) fout.push(`regel pagina 3: ${JSON.stringify(p3)} (verwacht 2 treffers, 1 annotatie)`);
  if (L.rijen.reduce((s, r) => s + r.aantal, 0) !== totaal) fout.push(`som van de regels ${L.rijen.map((r) => r.aantal).join('+')} ≠ ${totaal}`);
  if (!L.rijen.some((r) => r.huidig)) fout.push('geen regel gemarkeerd als huidige treffer');
  noteer(`bronnen: tekst + annotaties (${totaal} treffers, lijst per pagina)`, fout);
  await schermafdruk('bronnen-beide-aan');

  // Alleen tekst.
  await wisselBron(1);
  await wachtStabiel(`1 of ${tekstTreffers}`);
  L = await pagina.evaluate(LIJST);
  const foutT = [];
  if (L.rijen.reduce((s, r) => s + r.aantal, 0) !== tekstTreffers) foutT.push(`${L.rijen.reduce((s, r) => s + r.aantal, 0)} treffers, verwacht ${tekstTreffers}`);
  if (L.rijen.some((r) => r.annotaties > 0)) foutT.push('annotatietreffers terwijl het vinkje uit staat');
  if (L.kaders.length) foutT.push(`${L.kaders.length} annotatiekaders terwijl het vinkje uit staat`);
  noteer('bronnen: alleen tekst', foutT);

  // Alleen annotaties.
  await wisselBron(1);
  await wisselBron(0);
  await wachtStabiel(`1 of ${ANNOTATIES.length}`);
  L = await pagina.evaluate(LIJST);
  const foutA = [];
  if (L.rijen.reduce((s, r) => s + r.aantal, 0) !== ANNOTATIES.length) foutA.push(`${L.rijen.reduce((s, r) => s + r.aantal, 0)} treffers, verwacht ${ANNOTATIES.length}`);
  if (L.rijen.some((r) => r.aantal !== r.annotaties)) foutA.push('tekstreffers terwijl alleen annotaties aanstaan');
  if (!L.kaders.length) foutA.push('geen kader om de gevonden annotatie');
  else {
    const kader = L.kaders[0];
    const m = await pagina.evaluate(METING);
    const huidigePagina = (await staat()).currentPage;
    const ann = ANNOTATIES.find((a) => a.pagina === huidigePagina) || ANNOTATIES[0];
    foutA.push(...kaderControle(kader, ann, m));
  }
  noteer('bronnen: alleen annotaties (kader om de annotatie)', foutA);
  await schermafdruk('bronnen-alleen-annotaties');

  // Allebei uit: geen resultaten, wel een duidelijke toestand.
  await wisselBron(1);
  await sleep(1200);
  L = await pagina.evaluate(LIJST);
  const foutU = [];
  if (L.rijen.length) foutU.push(`${L.rijen.length} regels in de lijst terwijl beide bronnen uit staan`);
  if (!L.hint) foutU.push('geen uitleg zichtbaar terwijl beide bronnen uit staan');
  if (/not found|No results/i.test(L.telling)) foutU.push(`toestand oogt als een fout: "${L.telling}"`);
  noteer('bronnen: allebei uit → lege lijst met uitleg, geen foutmelding', foutU);
  await schermafdruk('bronnen-allebei-uit');

  // Terug naar beide en op een regel klikken.
  await wisselBron(0);
  await wisselBron(1);
  await wachtStabiel(`1 of ${totaal}`);
  const doel = (await pagina.evaluate(LIJST)).rijen.find((r) => r.pagina === 3);
  await pagina.locator('.find-results-row[data-page="3"]').click();
  await sleep(2500);
  const na = await pagina.evaluate(LIJST);
  const st = await staat();
  const foutK = [];
  if (st.currentPage !== 3) foutK.push(`app staat op pagina ${st.currentPage} na klikken op de regel van pagina 3`);
  if (!na.rijen.find((r) => r.pagina === 3)?.huidig) foutK.push('regel van pagina 3 is niet gemarkeerd als huidige treffer');
  if (!doel) foutK.push('geen regel voor pagina 3 in de lijst');
  noteer('resultatenlijst: klikken op "pagina 3" springt naar die treffer', foutK);
  await schermafdruk('bronnen-klik-op-regel');
}

// Ligt het kader binnen een paar pixels om de annotatie?
function kaderControle(kader, ann, meting) {
  const fout = [];
  const p = meting.paginas[ann.pagina];
  const schaal = p ? p.w / (595.28) : meting.enkel.zoom;
  const oorsprong = p ? { x: p.x, y: p.y } : meting.enkel;
  const mx = oorsprong.x + (ann.props.x + (ann.props.width || 24) / 2) * schaal;
  const my = oorsprong.y + (ann.props.y + (ann.props.height || 24) / 2) * schaal;
  const kx = (kader.l + kader.r) / 2;
  const ky = (kader.t + kader.b) / 2;
  const afw = Math.max(Math.abs(kx - mx), Math.abs(ky - my));
  if (afw > 6) fout.push(`kader staat ${rnd(afw)} px van de annotatie (midden ${rnd(kx)}/${rnd(ky)}, verwacht ${rnd(mx)}/${rnd(my)})`);
  return fout;
}

// ── Hoofdprogramma ──────────────────────────────────────────────────────────
fs.mkdirSync(UIT, { recursive: true });
// Unieke naam per run: een nog geopend bestand van een vorige run blijft op slot.
const PDF = path.join(UIT, `zoek-synthetisch-${Date.now()}.pdf`).split(path.sep).join('/');
const alle = await maakTestPdf(PDF);
const exact = alle.filter((t) => t.tekst === WOORD);
const hoofd = alle.filter((t) => t.tekst === WOORD.toUpperCase());
console.log(`test-PDF: ${PDF} (${PAGINAS.length} pagina's, ${alle.length} treffers; uitvoer in ${UIT})`);

const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
pagina = browser.contexts()[0].pages()[0];
try {
  await mcp('app_open_pdf', { path: PDF });
  EIGEN_PAD = PDF;
  await sleep(3500);

  // 1. Doorlopend: eerste zoekopdracht via de zoekbalk op 100 %.
  await zetModusEnZoom('continuous', 1.0);
  await mcp('app_go_to_page', { page: 1 });
  await sleep(1200);
  await zoekbalkOpenen();
  await typZoekterm(WOORD.toLowerCase());
  await controleer(`doorlopend: zoeken op "${WOORD.toLowerCase()}" (Ctrl+F, 100%)`, { modus: 'continuous', huidig: 0, lijst: alle, alles: true }, `1 of ${alle.length}`, true);
  let w = await ronde('continuous', alle, exact, hoofd, 0);

  // 2. Weergave wisselen zonder opnieuw te zoeken (zo kwam de melding binnen).
  await mcp('app_set_zoom', { scale: 0.5 });
  await sleep(1200);
  await mcp('app_set_view_mode', { mode: 'single' });
  await controleer('wissel doorlopend → enkel (50%) zonder opnieuw zoeken', { ...w, modus: 'single' }, null, true);
  await mcp('app_set_zoom', { scale: 1.75 });
  await controleer('enkel: daarna zoom 175% zonder opnieuw zoeken', { ...w, modus: 'single' }, null, true);

  // 3. Enkele pagina: dezelfde ronde.
  w = await ronde('single', alle, exact, hoofd, w.huidig);

  // 4. Terug naar Doorlopend zonder opnieuw te zoeken.
  await mcp('app_set_view_mode', { mode: 'continuous' });
  await controleer('wissel enkel → doorlopend zonder opnieuw zoeken', { ...w, modus: 'continuous' }, null, true);

  // 5. Zoekbronnen: tekst en annotaties, plus de resultatenlijst per pagina.
  await bronnenRonde(alle.length);

  // 6. Sluiten met Escape: geen markeringen meer.
  await zoekveld().click();
  await pagina.keyboard.press('Escape');
  await sleep(600);
  const naSluiten = (await pagina.evaluate(METING)).markeringen.length;
  const r = { label: 'zoekbalk sluiten (Escape)', fout: naSluiten ? [`${naSluiten} markeringen blijven staan`] : [] };
  resultaten.push(r);
  console.log(`${r.fout.length ? 'FOUT' : 'GOED'} — ${r.label}`);
} finally {
  // De testtab draagt zelfgemaakte annotaties; weggooien zonder op te slaan.
  try {
    const tabs = (await mcp('app_list_tabs', {}))?.tabs || [];
    const eigen = tabs.find((t) => zelfdePad(t.filePath, EIGEN_PAD));
    if (eigen) await mcp('app_close_tab', { index: eigen.index, force: true });
  } catch { /* opruimen is geen testresultaat */ }
  fs.writeFileSync(path.join(UIT, 'rapport.json'), JSON.stringify(resultaten, null, 1));
  await browser.close().catch(() => {});
}

const mislukt = resultaten.filter((r) => r.fout.length);
if (mislukt.length) {
  console.log(`MISLUKT: ${mislukt.length} van ${resultaten.length} controles fout (rapport: ${path.join(UIT, 'rapport.json')})`);
  process.exit(1);
}
console.log(`GOED — ${resultaten.length} controles: zoekmarkeringen liggen op de woorden (enkel + doorlopend, zoom ${ZOOMS.map((z) => z * 100).join('/')} %)`);
process.exit(0);
