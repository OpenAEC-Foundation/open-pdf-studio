// Tekstselectie-markering in de echte browser (#506).
//
//   npm run test:text-selection   (Chromium: npx playwright install chromium)
//
// Start de Vite-dev-server van de app, bouwt met de echte tekstlaagbouwer
// (js/text/text-layer.js → createTextLayer, PDF.js TextLayer en
// styles/text-layer.css) de tekstlaag van een gegenereerde brief en
// selecteert alle tekst. Op een wit vlak zonder paginacanvas is alleen de
// selectie zichtbaar, zodat de pixels de markering zelf laten zien.
//
// Per regel wordt geëist:
//  - geometrie: opeenvolgende spans overlappen niet meer dan een halve pixel en
//    zijn even hoog als de regel (lettergrootte × schaal);
//  - binnen de regelband is elke pixel de selectiekleur (op een paar eenheden
//    anti-aliasing na): geen donkere banden op woordgrenzen en geen gaten
//    (een lichte naad van één pixel tussen twee runs telt niet als gat);
//  - boven en onder de spans staat geen selectiekleur: niets steekt uit.
// Dat op twee manieren gebouwd: met de schaal in de laag (Doorlopend) en op
// schaal 1 met de zoom als CSS-transform (de enkele pagina).
//
// Tegenproeven, zodat "geslaagd" iets zegt:
//  - zonder de verticale clip moet de uitsteek-controle aanslaan;
//  - met te brede spans (--scale-x × 1,3) moet de overlap-controle aanslaan,
//    terwijl de kleur toch één tint blijft (dekkende selectie, multiply);
//  - dezelfde overlap met een doorschijnende selectiekleur moet donkerder zijn;
//  - zonder vlak op de woordafstanden moet de gatencontrole aanslaan.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(APP, 'package.json'));
const { chromium } = req('playwright');
const { PDFDocument, StandardFonts } = req('pdf-lib');
const { PNG } = req('pngjs');
const { createServer } = await import('vite');

const SELECTIE = [0xb8, 0xd8, 0xff];
const TOLERANTIE = 6;
const SCHAAL = 3;
const LETTER = 11;
const REGELS = [
  'Dear Sir or Madam, thank you for your letter of last week.',
  'We have reviewed the proposal and agree with the general terms.',
  'Please find enclosed the signed copy for your administration.',
  'Kind regards, the project office of the foundation.',
];

// Een brief waarin elk woord een eigen run is (afwisselend regulier en vet,
// zoals briefgeneratoren dat vaak doen); PDF.js maakt er een span per woord van.
async function maakBrief() {
  const doc = await PDFDocument.create();
  const p = doc.addPage([420, 200]);
  const fonts = [
    [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold)],
    [await doc.embedFont(StandardFonts.TimesRoman), await doc.embedFont(StandardFonts.TimesRomanBold)],
  ];
  let y = 160;
  REGELS.forEach((regel, ri) => {
    let x = 20;
    regel.split(' ').forEach((woord, wi) => {
      const font = fonts[ri % 2][wi % 2];
      p.drawText(`${woord} `, { x, y, size: LETTER, font });
      x += font.widthOfTextAtSize(`${woord} `, LETTER);
    });
    y -= 14;
  });
  return [...await doc.save()];
}

// In de pagina: bouw de laag, selecteer alles, geef de spanvakken terug.
async function bouwLaag(page, { bytes, opbouw, extraCss }) {
  return page.evaluate(async ({ bytes, opbouw, extraCss, SCHAAL }) => {
    document.getElementById('proef-506')?.remove();
    document.getElementById('proef-506-css')?.remove();
    // De PDF.js-module die de app zelf gebruikt (Vite's voorgebundelde dep).
    const bron = await (await fetch('/js/text/text-layer.js')).text();
    const pdfjsUrl = bron.match(/import \* as pdfjsLib from "([^"]+)"/)?.[1];
    if (!pdfjsUrl) throw new Error('pdfjs import not found in text-layer.js');
    const pdfjsLib = await import(pdfjsUrl);
    const { pdfjsBronnen } = await import('/js/core/basis-url.js');
    const { createTextLayer } = await import('/js/text/text-layer.js');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), ...pdfjsBronnen(), isEvalSupported: false }).promise;
    const pdfPage = await pdf.getPage(1);

    if (extraCss) {
      const st = document.createElement('style');
      st.id = 'proef-506-css';
      st.textContent = extraCss;
      document.head.append(st);
    }
    const vp1 = pdfPage.getViewport({ scale: 1 });
    const vak = document.createElement('div');
    vak.id = 'proef-506';
    Object.assign(vak.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647', background: '#ffffff',
      isolation: 'isolate', overflow: 'hidden',
      width: `${Math.ceil(vp1.width * SCHAAL)}px`, height: `${Math.ceil(vp1.height * SCHAAL)}px`,
    });
    document.body.append(vak);

    let laag;
    if (opbouw === 'doorlopend') {
      // Schaal in de laag: --total-scale-factor = SCHAAL.
      laag = await createTextLayer(pdfPage, pdfPage.getViewport({ scale: SCHAAL }), vak, 1);
    } else {
      // Enkele pagina: laag op schaal 1, de zoom als matrix (pdf-viewport.js).
      laag = await createTextLayer(pdfPage, vp1, vak, 1);
      laag.style.setProperty('--total-scale-factor', '1');
      Object.assign(laag.style, {
        width: `${vp1.width}px`, height: `${vp1.height}px`, left: '0', top: '0',
        transform: `matrix(${SCHAAL}, 0, 0, ${SCHAAL}, 0, 0)`, transformOrigin: '0 0',
      });
    }
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const spans = [...laag.querySelectorAll('span:not(.markedContent):not([data-ws])')]
      .filter((s) => s.textContent.trim());
    const sel = getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStartBefore(spans[0]);
    r.setEndAfter(spans[spans.length - 1]);
    sel.addRange(r);
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    return {
      breedte: Math.ceil(vp1.width * SCHAAL),
      hoogte: Math.ceil(vp1.height * SCHAAL),
      spans: spans.map((s) => {
        const b = s.getBoundingClientRect();
        return { tekst: s.textContent, l: b.left, r: b.right, t: b.top, b: b.bottom };
      }),
    };
  }, { bytes, opbouw, extraCss, SCHAAL });
}

// Spans per regel, op volgorde.
function perRegel(spans) {
  const regels = [];
  for (const s of spans) {
    const regel = regels.find((rg) => Math.abs(rg[0].t - s.t) < 2 && Math.abs(rg[0].b - s.b) < 2);
    if (regel) regel.push(s); else regels.push([s]);
  }
  return regels.map((rg) => rg.sort((a, b) => a.l - b.l));
}

function meet(png, laag) {
  const kleur = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
  const isSelectie = ([r, g, b]) => b > 200 && b - r > 25; // ook randpixels
  // Anti-aliasing op een span-rand die midden in een pixel valt, mag een paar
  // eenheden schelen; een doorschijnende kleur die in een overlap optelt
  // scheelt tientallen (donkerder), een gat ook (lichter).
  const donker = (c) => c.some((v, k) => SELECTIE[k] - v > TOLERANTIE);
  const licht = (c) => c.some((v, k) => v - SELECTIE[k] > TOLERANTIE);
  const uit = { overlap: 0, hoogteFout: 0, donker: 0, donkerVoorbeeld: null, gaten: 0, gatVoorbeeld: null, naden: 0, uitsteek: 0, uitsteekVoorbeeld: null, regels: 0 };
  const regels = perRegel(laag.spans);
  uit.regels = regels.length;
  regels.forEach((rg, ri) => {
    for (let i = 1; i < rg.length; i++) uit.overlap = Math.max(uit.overlap, rg[i - 1].r - rg[i].l);
    for (const s of rg) uit.hoogteFout = Math.max(uit.hoogteFout, Math.abs((s.b - s.t) - LETTER * SCHAAL));
    const top = Math.max(...rg.map((s) => s.t));
    const bodem = Math.min(...rg.map((s) => s.b));
    const links = Math.ceil(rg[0].l) + 1;
    // Tot vlak voor het einde van de laatste span: daar eindigt de tekst, en
    // de laatste glyph hoeft het (op een laagpixel afgeronde) vak niet te vullen.
    const rechts = Math.floor(rg[rg.length - 1].r) - SCHAAL - 1;
    // Binnen de band de selectiekleur (de tekst zelf is transparant), per
    // kolom bekeken. Nergens donkerder. Lichter alleen als naad van hooguit
    // één pixel: het regeleinde-vlak van de browser dekt de woordafstand tot
    // op een fractie van een pixel; twee of meer lichte kolommen naast elkaar
    // zijn een echt gat.
    let lichtReeks = 0;
    for (let x = links; x <= rechts + 1; x++) {
      let kolomLicht = false;
      if (x <= rechts) {
        for (let y = Math.ceil(top) + 1; y <= Math.floor(bodem) - 2; y++) {
          const c = kleur(x, y);
          if (donker(c)) { uit.donker++; uit.donkerVoorbeeld ??= { regel: ri, x, y, c }; }
          if (licht(c)) { kolomLicht = true; }
        }
      }
      if (kolomLicht) { lichtReeks++; continue; }
      if (lichtReeks === 1) uit.naden++;
      else if (lichtReeks > 1) { uit.gaten++; uit.gatVoorbeeld ??= { regel: ri, x: x - lichtReeks, breedte: lichtReeks }; }
      lichtReeks = 0;
    }
    // Erboven en eronder (tot halverwege de regelafstand): geen selectie.
    const halveAfstand = Math.floor((14 - LETTER) * SCHAAL / 2);
    const rijen = [];
    for (let d = 2; d <= halveAfstand; d++) rijen.push(Math.floor(Math.min(...rg.map((s) => s.t))) - d, Math.ceil(Math.max(...rg.map((s) => s.b))) + d - 1);
    for (const y of rijen) {
      if (y < 0 || y >= png.height) continue;
      for (let x = links; x <= rechts; x++) {
        if (isSelectie(kleur(x, y))) { uit.uitsteek++; uit.uitsteekVoorbeeld ??= { regel: ri, x, y }; }
      }
    }
  });
  return uit;
}

async function proef(page, bytes, opbouw, extraCss) {
  let laag;
  for (let poging = 1; ; poging++) {
    try {
      laag = await bouwLaag(page, { bytes, opbouw, extraCss });
      break;
    } catch (e) {
      // Vite kan bij de eerste start afhankelijkheden opnieuw optimaliseren
      // en de pagina herladen; dan opnieuw.
      if (poging >= 3 || !/context was destroyed|navigat/i.test(e.message)) throw e;
      await page.waitForSelector('#tool-select', { timeout: 180000 });
    }
  }
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: laag.breedte, height: laag.hoogte } });
  return meet(PNG.sync.read(buf), laag);
}

const fouten = [];
const eis = (ok, tekst) => { if (!ok) fouten.push(tekst); };

const server = await createServer({
  configFile: path.join(APP, 'vite.config.js'),
  root: APP,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false },
});
await server.listen();
const adres = server.httpServer.address();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const paginafouten = [];
  page.on('pageerror', (e) => { if (!/WebSocket/.test(e.message)) paginafouten.push(e.message); });
  await page.goto(`http://127.0.0.1:${adres.port}/`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('#tool-select', { timeout: 180000 });
  const bytes = await maakBrief();

  for (const opbouw of ['doorlopend', 'enkele-pagina']) {
    const m = await proef(page, bytes, opbouw);
    console.log(`${opbouw}: ${JSON.stringify(m)}`);
    eis(m.regels === REGELS.length, `${opbouw}: expected ${REGELS.length} lines, got ${m.regels}`);
    eis(m.overlap <= 0.5, `${opbouw}: adjacent spans overlap by ${m.overlap.toFixed(2)} px`);
    eis(m.hoogteFout <= 1, `${opbouw}: span height differs ${m.hoogteFout.toFixed(2)} px from the line`);
    eis(m.donker === 0, `${opbouw}: ${m.donker} pixels in the line band are darker than the selection colour, e.g. ${JSON.stringify(m.donkerVoorbeeld)}`);
    eis(m.gaten === 0, `${opbouw}: ${m.gaten} gaps in the line band, e.g. ${JSON.stringify(m.gatVoorbeeld)}`);
    eis(m.uitsteek === 0, `${opbouw}: ${m.uitsteek} selection pixels above or below the line, e.g. ${JSON.stringify(m.uitsteekVoorbeeld)}`);
  }

  // Tegenproef 1: zonder de verticale clip steekt de selectie uit.
  const zonderClip = await proef(page, bytes, 'enkele-pagina',
    '.textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) { overflow-y: visible !important; }');
  console.log(`control, no clip: ${JSON.stringify(zonderClip)}`);
  eis(zonderClip.uitsteek > 0, 'control: without the clip no spill was seen; the spill check is blind');

  // Tegenproef 2: te brede spans overlappen, maar de kleur blijft één tint.
  const breed = await proef(page, bytes, 'enkele-pagina',
    '.textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) { transform: scaleX(calc(var(--scale-x) * 1.3)) !important; }');
  console.log(`control, wide spans: ${JSON.stringify(breed)}`);
  eis(breed.overlap > 2, 'control: widened spans did not overlap; the overlap check is blind');
  eis(breed.donker === 0, `control: overlapping spans darkened the selection colour (${breed.donker} pixels, e.g. ${JSON.stringify(breed.donkerVoorbeeld)})`);

  // Tegenproef 3: dezelfde overlap met een doorschijnende selectiekleur (zoals
  // vóór de fix) geeft donkere banden; anders is de donker-controle blind.
  // Eén laag van die kleur op wit is de selectiekleur binnen de tolerantie,
  // dus alleen de overlap telt als donker.
  const doorschijnend = await proef(page, bytes, 'enkele-pagina',
    '.textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) { transform: scaleX(calc(var(--scale-x) * 1.3)) !important; }'
    + ' .textLayer { mix-blend-mode: normal !important; } .textLayer ::selection { background: rgba(0, 110, 255, 0.28) !important; }');
  console.log(`control, translucent: ${JSON.stringify(doorschijnend)}`);
  eis(doorschijnend.donker > 0, 'control: a translucent selection over overlapping spans was not seen as darker; the darkness check is blind');

  // Tegenproef 4: woordafstanden zonder vlak (zoals vóór de fix) en zonder het
  // regeleinde-vlak van de browser (horizontale clip) laten gaten tussen de
  // woorden; anders is de gatencontrole blind.
  const zonderAfstand = await proef(page, bytes, 'enkele-pagina',
    '.textLayer span[data-woordafstand]::selection { background: transparent !important; }'
    + ' .textLayer > :not(.markedContent) { overflow-x: clip !important; }');
  console.log(`control, no word spaces: ${JSON.stringify(zonderAfstand)}`);
  eis(zonderAfstand.gaten > 0, 'control: unselected word spaces left no gaps; the gap check is blind');

  eis(paginafouten.length === 0, `page errors: ${paginafouten.join(' | ')}`);
} finally {
  await browser.close();
  await server.close();
}

if (fouten.length) {
  console.error(`\nFAILED:\n  ${fouten.join('\n  ')}`);
  process.exit(1);
}
console.log('\nText selection highlight: even, no overlaps, no spill.');
