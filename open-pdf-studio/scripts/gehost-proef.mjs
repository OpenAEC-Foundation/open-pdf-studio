// Gedeelde stukken voor de browsercontroles van de gehoste bundel (#692, #693):
// een kleine statische server die mappen onder subpaden zet, en een test-PDF
// die PDF.js dwingt zijn eigen hulpbestanden op te halen.
//
// Geen vite-preview: die serveert maar één basis en voegt eigen gedrag toe.
// Deze server doet alleen wat een eenvoudige statische host doet, plus de
// headers die de aanroeper meegeeft (bv. de CSP van #693), en houdt bij wat er
// gevraagd werd.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.sha256': 'text/plain; charset=utf-8',
};

/**
 * Start een statische server.
 * @param {{ [subpad: string]: string }} mappen  '/pdf/' → map op schijf
 * @param {{ poort?: number, headers?: object }} opties
 * @returns {Promise<{ origin: string, verzoeken: { url: string, status: number }[], sluit: () => Promise<void> }>}
 */
export async function startServer(mappen, { poort = 0, headers = {} } = {}) {
  const verzoeken = [];
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let status = 404;
    let bestand = null;
    for (const [sub, map] of Object.entries(mappen)) {
      if (!url.startsWith(sub)) continue;
      const rel = url.slice(sub.length) || 'index.html';
      const vol = path.resolve(map, rel);
      if (!vol.startsWith(path.resolve(map) + path.sep)) break;
      if (fs.existsSync(vol) && fs.statSync(vol).isFile()) bestand = vol;
      break;
    }
    if (bestand) {
      status = 200;
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(bestand).toLowerCase()] || 'application/octet-stream', ...headers });
      fs.createReadStream(bestand).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...headers });
      res.end('not found');
    }
    verzoeken.push({ url: req.url, status });
  });
  await new Promise((ok, fout) => {
    server.once('error', fout);
    server.listen(poort, '127.0.0.1', ok);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    verzoeken,
    sluit: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}

/** Tekst die op de test-PDF staat, om in de tekstlaag terug te vinden. */
export const PROEF_TEKST = {
  helvetica: 'Standard font Helvetica',
  cjk: '日本語',
};

/**
 * Een PDF met niet-ingebedde standaardfonts en een niet-ingebed CJK-font met
 * een voorgedefinieerde CMap. PDF.js haalt daarvoor op:
 *  - cmaps/UniJIS-UCS2-H.bcmap (de codering van het CJK-font),
 *  - standard_fonts/ voor Symbol en ZapfDingbats (die vervangt hij nooit door
 *    een systeemfont).
 * @returns {Promise<Uint8Array>}
 */
export async function maakProefPdf() {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const symbool = await doc.embedFont(StandardFonts.Symbol);
  const dingbats = await doc.embedFont(StandardFonts.ZapfDingbats);
  pagina.drawText(PROEF_TEKST.helvetica, { x: 50, y: 780, size: 24, font: helv });
  pagina.drawText('Standard font Times', { x: 50, y: 740, size: 24, font: times });
  pagina.drawText('αβγδ', { x: 50, y: 700, size: 24, font: symbool });
  pagina.drawText('✓✗✈', { x: 50, y: 660, size: 24, font: dingbats });
  pagina.drawRectangle({ x: 50, y: 400, width: 200, height: 100, borderColor: rgb(0, 0, 0), borderWidth: 2 });

  // Type0-font zonder fontbestand: alleen de CMap-naam en het CID-systeem.
  const ctx = doc.context;
  const cid = ctx.register(ctx.obj({
    Type: 'Font',
    Subtype: 'CIDFontType0',
    BaseFont: 'KozMinPr6N-Regular',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Japan1'), Supplement: 6 },
    FontDescriptor: ctx.register(ctx.obj({
      Type: 'FontDescriptor',
      FontName: 'KozMinPr6N-Regular',
      Flags: 6,
      FontBBox: [-437, -340, 1147, 1317],
      ItalicAngle: 0,
      Ascent: 1317,
      Descent: -349,
      CapHeight: 742,
      StemV: 80,
    })),
    DW: 1000,
  }));
  const type0 = ctx.register(ctx.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'KozMinPr6N-Regular-UniJIS-UCS2-H',
    Encoding: 'UniJIS-UCS2-H',
    DescendantFonts: [cid],
  }));
  pagina.node.normalizedEntries().Font.set(PDFName.of('FCJK'), type0);
  // 日本語 in UCS-2: 65E5 672C 8A9E
  const inhoud = ctx.flateStream('BT /FCJK 32 Tf 50 600 Td <65E5672C8A9E> Tj ET');
  pagina.node.addContentStream(ctx.register(inhoud));
  return doc.save({ useObjectStreams: false });
}

// ── In de browser ───────────────────────────────────────────────────────────

/** Open een PDF zoals een gebruiker: de knop Openen en de bestandskiezer. */
export async function openPdfInApp(page, pdfPad) {
  await page.waitForSelector('#tool-select', { timeout: 60000 });
  const [kiezer] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 30000 }),
    page.click('.quick-access-toolbar .quick-access-btn >> nth=0'),
  ]);
  await kiezer.setFiles(pdfPad);
  await page.waitForFunction(() => {
    // Enkele pagina of doorlopend (de standaard): het blad dat getekend is.
    const c = [document.querySelector('canvas#pdf-canvas'), document.querySelector('#continuous-container canvas.pdf-canvas')].find((x) => x && x.width > 300);
    return !!c && document.body.textContent.includes('日本語');
  }, null, { timeout: 60000 });
  // Even wachten tot de rendering van de eerste pagina klaar is.
  await page.waitForTimeout(1500);
}

/**
 * Tel donkere beeldpunten op de pagina, per band van de test-PDF. Een band
 * zonder inkt betekent: dat font is niet getekend.
 * @returns {Promise<{ [band: string]: number }>}
 */
export async function inktPerBand(page) {
  return page.evaluate(() => {
    const c = [document.querySelector('canvas#pdf-canvas'), document.querySelector('#continuous-container canvas.pdf-canvas')].find((x) => x && x.width > 300);
    const ctx = c.getContext('2d');
    const schaal = c.height / 842; // de test-PDF is A4 staand
    // Banden in PDF-punten: [onderkant, bovenkant] boven de basislijn.
    const banden = { helvetica: [775, 800], symbool: [695, 720], dingbats: [655, 680], cjk: [595, 632] };
    const uit = {};
    for (const [naam, [onder, boven]] of Object.entries(banden)) {
      const y = Math.round((842 - boven) * schaal);
      const h = Math.round((boven - onder) * schaal);
      const x = Math.round(45 * schaal);
      const w = Math.round(300 * schaal);
      const d = ctx.getImageData(x, y, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] < 300) n++;
      uit[naam] = n;
    }
    return uit;
  });
}
