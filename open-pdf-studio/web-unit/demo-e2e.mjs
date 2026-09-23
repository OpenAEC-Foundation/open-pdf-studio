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

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => { const m = String(e.message).slice(0, 200); noteer('  [paginafout] ' + m); fouten.push('paginafout: ' + m); });

let bytes;
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
if (notitie) noteer('10. opmerking: "' + notitie.get(PDFName.of('Contents')).decodeText() + '"');

fs.writeFileSync(path.join(UIT, 'verslag.txt'), regels.join('\n'), 'utf8');
noteer('bewijs staat in ' + UIT);

if (fouten.length) {
  console.error('\nMISLUKT:\n - ' + fouten.join('\n - '));
  process.exit(1);
}
console.log('\nALLES GOED');
