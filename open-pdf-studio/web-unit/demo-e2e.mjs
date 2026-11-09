// Controle op de demopagina van de web-unit met een echte browser: een
// tekening laden, een lijn meten, een opmerking plaatsen, opslaan, en de
// teruggegeven bytes met pdf-lib nalopen.
//
// Draaien:  npm run test:web-unit
// Zonder argument start deze controle zelf een dev-server; geef een URL mee om
// tegen een al draaiende server of tegen een gebouwde `dist-web-unit` te
// meten:  node web-unit/demo-e2e.mjs http://127.0.0.1:4173/demo/index.html
//
// Deze controle staat NIET in `test:unit`: hij heeft een draaiende server en
// een browser nodig. De pure delen (api, meten, opslaan) staan daar wel in.

import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Zonder URL-argument draaien we onze eigen dev-server, zodat de controle in
// één opdracht loopt.
let server = null;
let URL_DEMO = process.argv[2];
if (!URL_DEMO) {
  const { createServer } = await import('vite');
  server = await createServer({
    configFile: 'vite.web-unit.config.js',
    server: { port: 4179, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const basis = server.resolvedUrls?.local?.[0] || `http://127.0.0.1:${server.config.server.port}/`;
  URL_DEMO = basis.replace(/\/$/, '') + '/demo/index.html';
}

const UIT = path.join(os.tmpdir(), 'opds-web-unit-e2e');
fs.mkdirSync(UIT, { recursive: true });

// De voorbeeldtekening uit demo.js: A3 liggend met een lijn van precies 200 pt.
const PAGINA_BREEDTE = 1191;
const PAGINA_HOOGTE = 842;
const LIJN_PT = 200;
const SCHAAL_NOEMER = 100;
const VERWACHT_C = (SCHAAL_NOEMER * 25.4) / 72;   // mm per punt bij 1:100

const regels = [];
const noteer = (...a) => { const s = a.join(' '); regels.push(s); console.log(s); };
const fouten = [];
const eis = (voorwaarde, bericht) => { if (!voorwaarde) fouten.push(bericht); };
const soortVan = (d) => String(d.get(PDFName.of('Subtype'))).replace(/^\//, '');

/**
 * De voorbeeldpagina (web-unit/voorbeeld) zet de unit met mount(); hier
 * loopt de gastheer-API erlangs: load(bytes), de Engelse gebeurtenissen,
 * setAnnotations/getAnnotations in het app-model, setScale, exportPdf, de
 * alleen-lezenstand en storage="local" (pagina en schaal na opnieuw openen).
 */
async function controleerVoorbeeld(page, url) {
  const tweeBladen = await PDFDocument.create();
  tweeBladen.addPage([595, 842]);
  tweeBladen.addPage([595, 842]);
  const bron = Array.from(await tweeBladen.save());

  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__voorbeeld && !!window.OpenPdfStudio, null, { timeout: 60000 });
  const r = await page.evaluate(async (bron) => {
    const unit = window.__voorbeeld;
    const gezien = [];
    for (const n of ['opds:load', 'opds:change', 'opds:save', 'opds:error', 'opds:geladen']) {
      unit.addEventListener(n, (e) => gezien.push([n, e.detail && (e.detail.pages ?? e.detail.count ?? e.detail.annotationCount ?? e.detail.paginas ?? e.detail.message)]));
    }
    const bytes = new Uint8Array(bron);
    const info = await unit.load(bytes);
    unit.setAnnotations([
      { type: 'measureDistance', page: 1, startX: 100, startY: 100, endX: 300, endY: 100, strokeColor: '#ff0000' },
      { type: 'comment', page: 1, x: 50, y: 60, text: 'Check this' },
      { type: 'square', page: 2, x: 10, y: 20, breedte: 30, hoogte: 40 },
    ]);
    const schaal = unit.setScale('1:50');
    const lijst = unit.getAnnotations();
    lijst[0].startX = -1;                       // een kopie: de laag blijft heel
    const uit = await unit.exportPdf();
    const knoppen = [...unit.shadowRoot.querySelectorAll('.balk button')].map((b) => b.textContent);
    unit.setMode('view');
    const verborgen = unit.shadowRoot.querySelector('button[data-naam="measure"]').hidden;
    unit.setMode('edit');

    // storage="local": een tweede unit onthoudt pagina en schaal per document.
    const vak = document.createElement('div');
    vak.style.cssText = 'height:300px';
    document.body.append(vak);
    let tweede = window.OpenPdfStudio.mount(vak, { storage: 'local', document: bytes.slice() });
    await new Promise((ok) => tweede.addEventListener('opds:load', ok, { once: true }));
    tweede.page = 2;
    tweede.setScale('1:20');
    tweede.destroy();
    tweede = window.OpenPdfStudio.mount(vak, { storage: 'local' });
    await tweede.load(bytes.slice());
    const onthouden = { page: tweede.page, ratio: Math.round(tweede.getScale()?.ratio || 0) };
    const gewist = tweede.clearStorage();
    tweede.destroy();

    let s = '';
    for (let i = 0; i < uit.length; i += 8192) s += String.fromCharCode(...uit.subarray(i, i + 8192));
    return {
      info, schaal, soorten: unit.getAnnotations().map((a) => a.type), startX: unit.getAnnotations()[0].startX,
      maat: unit.getAnnotations()[0].measureText, gezien, knoppen, verborgen, onthouden, gewist,
      status: document.getElementById('status').textContent, versie: window.OpenPdfStudio.version,
      base64: btoa(s),
    };
  }, bron);

  noteer('11. voorbeeldpagina: ' + r.info.pages + " pagina's, status \"" + r.status + '", versie ' + r.versie);
  eis(r.info.pages === 2, 'load() hoort 2 bladen te melden');
  noteer('12. soorten na setAnnotations: ' + r.soorten.join(', ') + '; maat ' + r.maat);
  eis(r.soorten.join() === 'measureDistance,comment,box', 'het app-model klopt niet: ' + r.soorten.join());
  eis(r.startX === 100, 'getAnnotations() gaf geen losse kopie');
  eis(r.maat === '3527.78 mm', 'de maat bij 1:50 hoort 3527.78 mm te zijn, niet ' + r.maat);
  eis(Math.round(r.schaal?.ratio) === 50 && r.schaal?.unit === 'mm', 'setScale gaf ' + JSON.stringify(r.schaal));
  const namen = r.gezien.map((g) => g[0]);
  noteer('13. gebeurtenissen: ' + [...new Set(namen)].join(', '));
  for (const n of ['opds:load', 'opds:change', 'opds:save', 'opds:geladen']) eis(namen.includes(n), n + ' kwam niet');
  eis(!namen.includes('opds:error'), 'er kwam een opds:error');
  eis(r.gezien.find((g) => g[0] === 'opds:save')?.[1] === 3, 'opds:save hoort annotationCount 3 te hebben');
  eis(r.status.includes('annotation'), 'onChange uit mount() werd niet aangeroepen: ' + r.status);
  noteer('14. werkbalk: ' + r.knoppen.join(' | '));
  eis(r.knoppen[0] === 'Measure', 'de Engelse werkbalk ontbreekt');
  eis(r.verborgen === true, 'in de alleen-lezenstand hoort Meten verborgen te zijn');
  noteer('15. storage="local": pagina ' + r.onthouden.page + ', schaal 1:' + r.onthouden.ratio + ', ' + r.gewist + ' sleutel(s) gewist');
  eis(r.onthouden.page === 2 && r.onthouden.ratio === 20, 'storage="local" onthield pagina en schaal niet');
  eis(r.gewist >= 1, 'clearStorage() wiste niets');
  return Buffer.from(r.base64, 'base64');
}

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => { const m = String(e.message).slice(0, 200); noteer('  [paginafout] ' + m); fouten.push('paginafout: ' + m); });

let bytes;
let voorbeeld = null;
try {
  await page.goto(URL_DEMO, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__demo, null, { timeout: 60000 });
  noteer('1. demopagina geladen');

  const tLaad = Date.now();
  await page.click('#voorbeeld');
  await page.waitForFunction(() => {
    const c = document.querySelector('open-pdf-studio')?.shadowRoot?.querySelector('canvas');
    return c && c.width > 400;
  }, null, { timeout: 60000 });
  noteer('2. tekening geladen en getekend in ' + (Date.now() - tLaad) + ' ms');
  await page.screenshot({ path: path.join(UIT, '1-geladen.png') });

  await page.click('#zetSchaal');

  const vlak = await page.evaluate((breedtePt) => {
    const c = document.querySelector('open-pdf-studio').shadowRoot.querySelector('canvas.laag');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, schaal: r.width / breedtePt };
  }, PAGINA_BREEDTE);
  noteer('3. blad staat op ' + Math.round(vlak.x) + ',' + Math.round(vlak.y)
    + ' met ' + vlak.schaal.toFixed(3) + ' beeldpunt per paginapunt');

  // Meten: slepen over precies LIJN_PT paginapunten.
  await page.evaluate(() => window.__demo.kiesGereedschap('measure'));
  const x0 = vlak.x + 200 * vlak.schaal;
  const y0 = vlak.y + (PAGINA_HOOGTE - 600) * vlak.schaal;
  const x1 = vlak.x + (200 + LIJN_PT) * vlak.schaal;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, y0, { steps: 4 });
  await page.mouse.move(x1, y0, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Een opmerking plaatsen.
  await page.evaluate(() => window.__demo.kiesGereedschap('comment'));
  await page.mouse.click(vlak.x + 600 * vlak.schaal, vlak.y + 400 * vlak.schaal);
  await page.waitForTimeout(200);
  // Het tekstveld van de opmerking staat open: typen en bevestigen.
  const veldOpen = await page.evaluate(() => {
    const v = document.querySelector('open-pdf-studio').shadowRoot.querySelector('textarea.opmerking');
    return !!v && v.matches(':focus');
  });
  eis(veldOpen, 'na het plaatsen van een opmerking hoort het tekstveld open en gefocust te zijn');
  await page.keyboard.type('Maat controleren');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);

  const inUnit = await page.evaluate(() => window.__demo.annotaties());
  noteer('4. in de unit: ' + inUnit.map((a) => a.type).join(', '));
  eis(inUnit.length === 2, 'de unit hoort twee annotaties te hebben, niet ' + inUnit.length);
  await page.screenshot({ path: path.join(UIT, '2-gemeten.png') });

  await page.click('#opslaan');
  await page.waitForFunction(() => !!window.__laatsteBytes, null, { timeout: 60000 });
  const base64 = await page.evaluate(() => {
    const b = window.__laatsteBytes;
    let s = '';
    for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
    return btoa(s);
  });
  bytes = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(UIT, 'uitvoer.pdf'), bytes);
  noteer('5. de gastheer kreeg ' + bytes.length + ' bytes terug');
  await page.screenshot({ path: path.join(UIT, '3-opgeslagen.png') });

  // ── de minimale voorbeeldpagina: de Engelse inbeddings-API (#451) ──────────
  voorbeeld = await controleerVoorbeeld(page, URL_DEMO.replace(/\/demo\/index\.html$/, '/voorbeeld/index.html'));
} finally {
  await browser.close();
  if (server) await server.close();
}

// ── de teruggegeven bytes nalopen ───────────────────────────────────────────
const doc = await PDFDocument.load(new Uint8Array(bytes));
const paginaNode = doc.getPages()[0].node;
const arr = paginaNode.get(PDFName.of('Annots'));
const dicts = arr ? arr.asArray().map((r) => doc.context.lookup(r)) : [];
noteer('6. in het bestand: ' + dicts.map(soortVan).join(', '));

const lijn = dicts.find((d) => soortVan(d) === 'Line');
const notitie = dicts.find((d) => soortVan(d) === 'Text');
eis(!!lijn, 'er staat geen /Line-annotatie in het bestand');
eis(!!notitie, 'er staat geen /Text-annotatie in het bestand');

if (lijn) {
  eis(String(lijn.get(PDFName.of('IT'))) === '/LineDimension', '/IT is geen LineDimension');
  eis(!!lijn.get(PDFName.of('AP')), 'de maatlijn heeft geen appearance');

  const meet = lijn.get(PDFName.of('Measure'));
  eis(!!meet, 'de maatlijn draagt geen /Measure-woordenboek');
  if (meet) {
    const x = meet.get(PDFName.of('X')).asArray()[0];
    const c = x.get(PDFName.of('C')).asNumber();
    const u = x.get(PDFName.of('U')).decodeText();
    noteer('7. meetschaal: C=' + c.toFixed(4) + ' ' + u + ' per punt (verwacht ' + VERWACHT_C.toFixed(4) + ' mm)');
    eis(Math.abs(c - VERWACHT_C) < 1e-6, 'de meetschaal in het bestand wijkt af');
    eis(u === 'mm', 'de eenheid in het bestand is niet mm');
  }

  const L = lijn.get(PDFName.of('L')).asArray().map((n) => n.asNumber());
  const lengte = Math.hypot(L[2] - L[0], L[3] - L[1]);
  noteer('8. lijnlengte: ' + lengte.toFixed(1) + ' pt (verwacht ' + LIJN_PT + ')');
  eis(Math.abs(lengte - LIJN_PT) < 6, 'de lijnlengte wijkt meer dan 6 pt af');

  const label = lijn.get(PDFName.of('Contents')).decodeText();
  noteer('9. maatlabel: "' + label + '"');
  eis(Math.abs(parseFloat(label) - LIJN_PT * VERWACHT_C) < 250, 'het maatlabel hoort ~' + Math.round(LIJN_PT * VERWACHT_C) + ' mm te zijn');
}
if (notitie) {
  const t = notitie.get(PDFName.of('Contents')).decodeText();
  noteer('10. opmerking: "' + t + '"');
  eis(t === 'Maat controleren', 'de getypte opmerkingstekst staat niet in het bestand');
}

if (voorbeeld) {
  const vdoc = await PDFDocument.load(new Uint8Array(voorbeeld));
  const perBlad = vdoc.getPages().map((p) => {
    const lijst = p.node.get(PDFName.of('Annots'));
    return lijst ? lijst.asArray().map((ref) => soortVan(vdoc.context.lookup(ref))) : [];
  });
  noteer('16. voorbeeld-export: ' + perBlad.map((l, i) => 'blad ' + (i + 1) + ': ' + (l.join(', ') || '-')).join('; '));
  eis(perBlad[0]?.join() === 'Line,Text', 'blad 1 van de export hoort Line en Text te hebben');
  eis(perBlad[1]?.join() === 'Square', 'blad 2 van de export hoort een Square te hebben');
} else {
  fouten.push('de voorbeeldpagina is niet nagelopen');
}

fs.writeFileSync(path.join(UIT, 'verslag.txt'), regels.join('\n'), 'utf8');
noteer('bewijs staat in ' + UIT);

if (fouten.length) {
  console.error('\nMISLUKT:\n - ' + fouten.join('\n - '));
  process.exit(1);
}
console.log('\nALLES GOED');
