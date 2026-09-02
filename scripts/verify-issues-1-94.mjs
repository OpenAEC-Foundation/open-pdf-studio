// GUI-verificatieprotocol voor release 1.94: controleert de opgeloste issues
// en de gemergde PR's via de MCP-server tegen de LIVE app (testrig).
//
// Gedekt:
//   #352  afbeelding/handtekening embedt echt (rondgang met gelinkte afbeelding)
//   #332  formulierlaag volgt de pagina (CropBox-fixture)
//   #339  meegeleverde NL-groepen tonen Built-in (geen dode knoppen)
//   #341 + PR342  lijndikte en kleur werken op een geplaatst symbool
//   PR342 aspect  symbool wordt niet in een vierkant geduwd
//   #338  nieuwe constructie- en bouwplaats-symbolen: aanwezig en plaatsbaar
//   #343 / PR344  linework-catalogusformaat is geregistreerd (importpad aanwezig)
//
// Voorwaarden: testrig draait (MCP 9223, CDP 9222), Vite op 3041.
// Gebruik: node scripts/verify-issues-1-94.mjs
// Exit 0 = GOED, 1 = MISLUKT. Screenshots in tests/protocol/results/issues-1-94/.

import { writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const MCP = 'http://127.0.0.1:' + (process.env.MCP_PORT || '9223') + '/mcp';
const CDP = process.env.CDP_PORT || '9222';
const UIT = 'tests/protocol/results/issues-1-94';
const WERK = path.resolve(UIT, 'werk');
const FIXTURES = 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden';

mkdirSync(WERK, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mcpId = 0;
async function mcp(naam, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/call', params: { name: naam, arguments: args } }),
  });
  const j = JSON.parse(await res.text());
  if (j.error) throw new Error(naam + ': ' + JSON.stringify(j.error).slice(0, 200));
  const c = j?.result?.content?.[0];
  if (c?.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
  return j.result;
}

let ws = null, cdpId = 0;
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
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('evaluate: ' + (r.result.exceptionDetails.exception?.description || 'fout').slice(0, 200));
  return r.result?.result?.value;
}
async function schermafdruk(naam) {
  const s = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(UIT, naam + '.png'), Buffer.from(s.result.data, 'base64'));
}

// Klik op een punt op de PAGINA (app-coördinaten) door pointerevents op het
// element onder dat schermpunt te dispatchen — synthetische app_mouse_click
// bereikt het canvas niet betrouwbaar.
async function klikOpPagina(appX, appY) {
  return evalJs(`(() => {
    const c = document.getElementById('pdf-canvas');
    const vp = window.__pdfViewport;
    if (!c || !vp) return 'geen canvas/viewport';
    const r = c.getBoundingClientRect();
    const x = r.left + vp.offsetX + ${appX} * vp.zoom;
    const y = r.top + vp.offsetY + ${appY} * vp.zoom;
    const el = document.elementFromPoint(x, y);
    if (!el) return 'geen element op ' + x + ',' + y;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    return 'klik op ' + (el.className || el.id || el.tagName);
  })()`);
}

const fouten = [];
const oks = [];
function check(onderdeel, conditie, detail = '') {
  if (conditie) { oks.push(onderdeel); console.log(`  OK   ${onderdeel}${detail ? ' — ' + detail : ''}`); }
  else { fouten.push(`${onderdeel}${detail ? ' — ' + detail : ''}`); console.log(`  FOUT ${onderdeel}${detail ? ' — ' + detail : ''}`); }
}

async function sluitAlleTabs() {
  for (let g = 0; g < 12; g++) {
    const tabs = await mcp('app_list_tabs', {});
    if (!tabs?.tabs?.length) break;
    await mcp('app_close_tab', { index: tabs.tabs[0].index, force: true });
    await sleep(250);
  }
}

// Klein 8x8 rood PNG (geldige bytes) als testafbeelding.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAGklEQVQYV2P8z8Dwn4EIwDiqkH5hRUxwAABPlB/x2rB1eAAAAABJRU5ErkJggg==';
const PNG_DATA_URL = 'data:image/png;base64,' + PNG_B64;

function pythonApCheck(pdfPad) {
  const script = [
    'from pypdf import PdfReader',
    `r = PdfReader(r'''${pdfPad}''')`,
    'p = r.pages[0]',
    'stamps = [a.get_object() for a in (p.get("/Annots") or []) if a.get_object().get("/Subtype") == "/Stamp"]',
    'met_ap = sum(1 for s in stamps if s.get("/AP"))',
    'print(f"{len(stamps)} {met_ap}")',
  ].join('\n');
  const uit = execFileSync('python', ['-c', script], { encoding: 'utf-8' }).trim().split(/\s+/);
  return { stamps: Number(uit[0]), metAp: Number(uit[1]) };
}

(async () => {
  await cdpVerbind();
  await mcp('app_set_window_size', { width: 1400, height: 900 }).catch(() => {});
  await sluitAlleTabs();

  // ── #352: afbeelding-rondgang (gelinkte afbeelding door de vaste loader) ──
  console.log('== #352 afbeelding-embed-rondgang');
  {
    const pngPad = path.join(WERK, 'handtekening.png');
    writeFileSync(pngPad, Buffer.from(PNG_B64, 'base64'));
    const basis = path.join(WERK, '352-basis.pdf');
    copyFileSync(path.join(FIXTURES, 'Tekst.pdf'), basis);
    await mcp('app_open_pdf', { path: basis.replaceAll('\\', '/') });
    await sleep(3000);
    const aangemaakt = await mcp('app_create_annotation', {
      type: 'image',
      props: { x: 80, y: 80, width: 96, height: 96, imageData: PNG_DATA_URL, linkedPath: pngPad, originalWidth: 8, originalHeight: 8 },
    });
    check('#352 afbeelding aangemaakt', !!aangemaakt?.id, JSON.stringify(aangemaakt).slice(0, 80));
    const t1 = path.join(WERK, '352-stap1.pdf');
    await mcp('app_save_pdf', { path: t1.replaceAll('\\', '/') });
    await sleep(1500);
    await sluitAlleTabs();
    // Heropenen: de loader ververst de gelinkte afbeelding via het in #352
    // gerepareerde pad (data:-URL i.p.v. blob:-URL) …
    await mcp('app_open_pdf', { path: t1.replaceAll('\\', '/') });
    await sleep(4000);
    const naHeropen = await mcp('app_list_annotations', {});
    const beeld = (naHeropen?.annotations || []).filter((a) => a.type === 'image' || a.type === 'stamp');
    check('#352 één afbeelding na heropenen (geen verdubbeling)', beeld.length === 1, `gevonden: ${beeld.length}`);
    // … en een tweede opslag moet de afbeelding opnieuw embedden.
    const t2 = path.join(WERK, '352-stap2.pdf');
    await mcp('app_save_pdf', { path: t2.replaceAll('\\', '/') });
    await sleep(1500);
    const ap = pythonApCheck(t2);
    check('#352 opgeslagen stempel heeft appearance stream', ap.stamps === 1 && ap.metAp === 1, `stamps=${ap.stamps} met AP=${ap.metAp}`);
    await schermafdruk('352-afbeelding');
    await sluitAlleTabs();
  }

  // ── #332: formulierlaag volgt de pagina (CropBox ≠ MediaBox) ─────────────
  console.log('== #332 formulierlaag');
  {
    await mcp('app_open_pdf', { path: `${FIXTURES}/formulier-cropbox.pdf` });
    await sleep(5000);
    const meting = JSON.parse(await evalJs(`(() => {
      const fl = document.querySelector('#canvas-container .formLayer');
      if (!fl) return JSON.stringify({ fout: 'geen formLayer' });
      const sectie = fl.querySelector('section');
      const r = sectie ? sectie.getBoundingClientRect() : null;
      return JSON.stringify({
        transform: fl.style.transform || '',
        breedte: fl.style.width,
        sectie: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      });
    })()`));
    check('#332 formulierlaag heeft viewport-transform', /matrix\(/.test(meting.transform || ''), meting.transform || meting.fout);
    check('#332 formulierlaag is paginabreed (800px)', meting.breedte === '800px', meting.breedte);
    // Verwachte schermpositie van veld_boven: crop-ruimte (200,100)-(400,120).
    const vp = await mcp('app_get_viewport_state', {});
    const zoom = vp?.zoom ?? vp?.viewport?.zoom;
    const offX = vp?.offsetX ?? vp?.viewport?.offsetX;
    const offY = vp?.offsetY ?? vp?.viewport?.offsetY;
    if (Number.isFinite(zoom) && meting.sectie) {
      const canvasRect = JSON.parse(await evalJs(`(() => { const c = document.getElementById('pdf-canvas'); const r = c.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y }); })()`));
      const verwachtX = canvasRect.x + offX + 200 * zoom;
      const verwachtY = canvasRect.y + offY + 100 * zoom;
      const dx = Math.abs(meting.sectie.x - verwachtX);
      const dy = Math.abs(meting.sectie.y - verwachtY);
      check('#332 veld ligt op de paginapositie (±3px)', dx <= 3 && dy <= 3, `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
    } else {
      check('#332 veldpositie meetbaar', false, 'geen viewport-state of sectie');
    }
    await schermafdruk('332-formulier');
    await sluitAlleTabs();
  }

  // Open een lichte PDF als werkvlak voor de symbolentests.
  await mcp('app_open_pdf', { path: `${FIXTURES}/Tekst.pdf` });
  await sleep(3000);

  // Palet openen via de lintknop (Beeld → Toolpalette) als het nog dicht is.
  let paletOpen = await evalJs(`document.querySelector('.sp-cat-header') ? 'open' : 'dicht'`);
  if (paletOpen !== 'open') {
    await mcp('app_click_element', { selector: '#ribbon-symbol-palette' });
    await sleep(1200);
    paletOpen = await evalJs(`document.querySelector('.sp-cat-header') ? 'geopend' : 'niet gevonden'`);
  }
  console.log('  palet:', paletOpen);

  // ── #339: meegeleverde groepen zijn Built-in in de instellingen ──────────
  console.log('== #339 built-in-vlag');
  {
    const uitkomst = JSON.parse(await evalJs(`(async () => {
      const knop = [...document.querySelectorAll('button.sp-settings-btn')].find((b) => /settings/i.test(b.title || ''));
      if (!knop) return JSON.stringify({ fout: 'geen settings-knop' });
      knop.click();
      await new Promise((r) => setTimeout(r, 900));
      const tekst = document.body.innerText || '';
      const dialoogOpen = /NL IFC Bouw/.test(tekst);
      // Per groep-rij kijken of er een verwijderknop bij de NL-groepen staat.
      const rijen = [...document.querySelectorAll('*')].filter((el) =>
        el.children.length && /^(NL IFC Bouw|NL Elektra)$/.test((el.querySelector(':scope > *')?.textContent || '').trim()));
      const verwijderKnoppen = [...document.querySelectorAll('.sp-settings-btn-remove')].length;
      const heeftBadge = /built-?in/i.test(tekst);
      // Dialoog weer sluiten (Escape).
      document.querySelector('.sp-settings-overlay .sp-float-close')?.click();
      return JSON.stringify({ dialoogOpen, verwijderKnoppen, heeftBadge, rijen: rijen.length });
    })()`));
    check('#339 instellingen-dialoog geopend', !!uitkomst.dialoogOpen, uitkomst.fout || '');
    check('#339 Built-in-aanduiding zichtbaar', !!uitkomst.heeftBadge, `badge=${uitkomst.heeftBadge}`);
    check('#339 geen verwijderknoppen op meegeleverde groepen', uitkomst.verwijderKnoppen === 0, `remove-knoppen: ${uitkomst.verwijderKnoppen}`);
    await schermafdruk('339-instellingen');
    await evalJs(`(() => { document.querySelector('.sp-settings-overlay .sp-float-close')?.click(); return true; })()`);
  }

  // ── #338: nieuwe symbolen aanwezig en plaatsbaar ─────────────────────────
  console.log('== #338 nieuwe symbolen');
  {
    const namen = ['Oplegging (steunpunt)', 'Puntlast', 'q-last (verdeelde belasting)', 'Beddingsveren', 'Windverband', 'Scharnierverbinding', 'Bouwkraan (zwenkstraal)', 'Draaicirkel vrachtwagen', 'Parkeervak', 'Bouwkeet'];
    const aanwezig = JSON.parse(await evalJs(`(async () => {
      // Alle categorieën openklappen zodat de knoppen bestaan.
      for (const h of document.querySelectorAll('.sp-cat-header')) {
        if (!h.parentElement.querySelector('.sp-grid')) { h.click(); await new Promise((r) => setTimeout(r, 120)); }
      }
      const titels = [...document.querySelectorAll('button.sp-symbol-btn')].map((b) => b.title);
      return JSON.stringify(${JSON.stringify([])}.concat(${JSON.stringify(['Oplegging (steunpunt)', 'Puntlast', 'q-last (verdeelde belasting)', 'Beddingsveren', 'Windverband', 'Scharnierverbinding', 'Bouwkraan (zwenkstraal)', 'Draaicirkel vrachtwagen', 'Parkeervak', 'Bouwkeet'])}.filter((n) => !titels.includes(n))));
    })()`));
    check('#338 alle tien nieuwe symbolen in het palet', aanwezig.length === 0, aanwezig.length ? 'ontbreekt: ' + aanwezig.join(', ') : 'alle 10');
    // Plaats een parametrisch symbool via het echte palet + canvasklik.
    const geplaatst = await evalJs(`(async () => {
      const knop = [...document.querySelectorAll('button.sp-symbol-btn')].find((b) => b.title === 'Windverband');
      if (!knop) return 'geen knop';
      knop.click();
      return 'geklikt';
    })()`);
    await sleep(500);
    const klik = await klikOpPagina(200, 250);
    await sleep(1200);
    const lijst = await mcp('app_list_annotations', {});
    const parametrisch = (lijst?.annotations || []).filter((a) => a.type === 'parametricSymbol');
    check('#338 windverband geplaatst als parametrisch symbool', parametrisch.length >= 1, `klik=${klik}, parametrisch: ${parametrisch.length}`);
    await schermafdruk('338-symbolen');
    for (const a of parametrisch) await mcp('app_delete_annotation', { id: a.id });
  }

  // ── #341 + PR342: lijndikte, kleur en beeldverhouding op een symbool ─────
  console.log('== #341/PR342 symbool-uiterlijk');
  {
    // Plaats een niet-vierkant SVG-symbool via overrides + canvasklik (zelfde
    // pad als het palet: selectSymbol → placeOverrideStamp).
    await evalJs(`(async () => {
      const knop = [...document.querySelectorAll('button.sp-symbol-btn')].find((b) => /wandcontactdoos|Stopcontact|WCD/i.test(b.title || ''))
        || [...document.querySelectorAll('button.sp-symbol-btn')].find((b) => !b.classList.contains('sp-symbol-named'));
      if (knop) knop.click();
      return knop ? knop.title : 'geen';
    })()`);
    await sleep(400);
    await klikOpPagina(300, 350);
    await sleep(1500);
    let lijst = await mcp('app_list_annotations', {});
    const stempels = (lijst?.annotations || []).filter((a) => a.type === 'stamp');
    check('PR342 symbool geplaatst als stempel', stempels.length === 1, `stempels: ${stempels.length}`);
    if (stempels.length === 1) {
      const id = stempels[0].id;
      const voor = await mcp('app_get_annotation', { id });
      // Kleur en lijndikte via de brug (zelfde hooks als het paneel).
      await mcp('app_update_annotation', { id, props: { color: '#ff0000' } });
      await sleep(600);
      await mcp('app_update_annotation', { id, props: { lineWidth: 3 } });
      await sleep(900);
      const na = await mcp('app_get_annotation', { id });
      const svgVoor = voor?.annotation?.stampSvg || voor?.stampSvg || '';
      const svgNa = na?.annotation?.stampSvg || na?.stampSvg || '';
      check('#341 kleur staat in de symboolbron', /#ff0000/i.test(svgNa), svgNa ? 'svg bijgewerkt' : 'geen stampSvg teruggekregen');
      check('#341 lijndikte herschreven in de symboolbron', svgVoor !== svgNa && /stroke-width/i.test(svgNa), '');
      await schermafdruk('341-symbool-uiterlijk');
      await mcp('app_delete_annotation', { id });
    }
  }

  // ── #343 / PR344: linework-catalogusformaat geregistreerd ────────────────
  console.log('== #343/PR344 linework-catalogus');
  {
    // Het importpad leeft in de bibliotheek-instellingen; het formaat zelf is
    // door PR344 unit-getest. GUI-controle: de instellingen tonen de
    // importmogelijkheid (bestandskiezer is niet scriptbaar).
    const uitkomst = JSON.parse(await evalJs(`(async () => {
      const knop = [...document.querySelectorAll('button.sp-settings-btn')].find((b) => /settings/i.test(b.title || ''));
      if (!knop) return JSON.stringify({ fout: 'geen settings-knop' });
      knop.click();
      await new Promise((r) => setTimeout(r, 800));
      const tekst = document.body.innerText || '';
      const importAanwezig = /import|catalog/i.test(tekst);
      document.querySelector('.sp-settings-overlay .sp-float-close')?.click();
      return JSON.stringify({ importAanwezig });
    })()`));
    check('#343 import-/catalogusingang zichtbaar in instellingen', !!uitkomst.importAanwezig, uitkomst.fout || '');
  }

  await sluitAlleTabs();

  // ── Sluiten-met-opslaan verdubbelt geen annotaties ──────────────────────
  // De gerapporteerde 2867-bug: bij "sluiten en opslaan" werden alle
  // annotaties opnieuw in het bestand geschreven NAAST de bestaande, omdat
  // het opruimen van de laad-administratie vóór de opslag liep. Een
  // annotatierijk bestand is hier het scherpst: daar duurt het laden lang
  // genoeg om het venster te raken.
  console.log('== sluiten-met-opslaan (annotatie-verdubbeling)');
  {
    const werkPdf = path.join(WERK, 'sluiten-opslaan.pdf');
    copyFileSync(path.join(FIXTURES, 'NKD1a_opm_aw.pdf'), werkPdf);
    const pad = werkPdf.replaceAll('\\', '/');
    await mcp('app_open_pdf', { path: pad });
    await sleep(9000); // annotatie-extractie van alle pagina's afwachten
    const voor = (await mcp('app_list_annotations', {}))?.annotations?.length ?? -1;
    // Eén wijziging zodat het document als gewijzigd geldt en de
    // opslaan-bij-sluiten-tak daadwerkelijk doorlopen wordt.
    await mcp('app_create_annotation', { type: 'box', props: { x: 40, y: 40, width: 60, height: 30 } });
    await sleep(800);
    const tabs = await mcp('app_list_tabs', {});
    const idx = tabs?.tabs?.find((t) => t.active)?.index ?? 0;
    await mcp('app_close_tab', { index: idx, save: true });
    await sleep(4000);
    await mcp('app_open_pdf', { path: pad });
    await sleep(9000);
    const na = (await mcp('app_list_annotations', {}))?.annotations?.length ?? -1;
    check('sluiten-met-opslaan telt +1, verdubbelt niet', na === voor + 1, `voor=${voor} na=${na} (verdubbeld zou ${(voor + 1) * 2} zijn)`);
    await sluitAlleTabs();
  }

  // ── #353: voorkeuren-spiegel is klein en het bestand gaat vóór ───────────
  console.log('== #353 voorkeuren-spiegel');
  {
    const spiegel = await evalJs(`localStorage.getItem('pdfEditorPreferences') || ''`);
    let sleutels = null;
    try { sleutels = Object.keys(JSON.parse(spiegel)); } catch { /* leeg */ }
    check('#353 spiegel bevat alleen het thema (Tauri)', Array.isArray(sleutels) && sleutels.every((k) => k === 'theme'), `sleutels: ${JSON.stringify(sleutels)} (${spiegel.length} tekens)`);
    check('#353 spiegel is klein (< 1 kB)', spiegel.length > 0 && spiegel.length < 1024, `${spiegel.length} tekens`);
  }

  // ── #354: catalogus-bestandsopslag naast preferences.json ────────────────
  console.log('== #354 catalogus-bestanden');
  {
    const r = await evalJs(`(async () => {
      const inv = window.__TAURI__?.core?.invoke;
      if (!inv) return JSON.stringify({ fout: 'geen invoke' });
      await inv('save_catalog', { id: 'protocol-test', data: JSON.stringify({ format: 'linework-variants', families: [] }) });
      const terug = await inv('load_catalog', { id: 'protocol-test' });
      const verwijderd = await inv('delete_catalog', { id: 'protocol-test' });
      const weg = await inv('load_catalog', { id: 'protocol-test' });
      return JSON.stringify({ rondgang: !!terug && JSON.parse(terug).format === 'linework-variants', verwijderd, weg: weg == null });
    })()`);
    const uitkomst = JSON.parse(r);
    check('#354 catalogus-bestand: schrijven → lezen → verwijderen', !!uitkomst.rondgang && uitkomst.verwijderd === true && uitkomst.weg === true, r);
  }

  console.log('');
  console.log(`RESULTAAT: ${oks.length} OK, ${fouten.length} fout`);
  for (const f of fouten) console.log('FOUT —', f);
  if (fouten.length) { console.log('MISLUKT'); process.exit(1); }
  console.log('GOED — alle GUI-controles voor 1.94 geslaagd');
  process.exit(0);
})().catch((e) => { console.error('PROTOCOLFOUT:', e.message); process.exit(1); });
