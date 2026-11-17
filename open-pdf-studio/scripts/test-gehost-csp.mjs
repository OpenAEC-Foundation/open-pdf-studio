// De gehoste bundel onder een strikte Content Security Policy (#693, #704).
//
//   npm run test:hosted-csp -- [--dist <map>] [--poort 3663]
//
// Zonder --dist bouwt hij de gehoste bundel zelf, zoals de release dat doet
// (vite build --mode hosted --base=./). Twee opzetten, elk in headless
// Chromium:
//
//  A. #693: een eigen statische server serveert de bundel onder /pdf/ met
//     het beleid uit dat issue (met 'self') als header, als gewone pagina.
//     Een PDF openen (bestandskiezer), tekenen, een rechthoek annoteren en
//     opslaan (een download).
//  B. #704, de werkplek van de OpenAEC SuperCloud (scripts/werkplek-proef.mjs):
//     de bundel onder /werkplek/app/pdf/ met precies het beleid van de host
//     (sandbox zonder allow-same-origin, default-src 'none', geen 'self',
//     alleen de absolute bundel-URL), in
//       <iframe sandbox="allow-scripts allow-downloads allow-modals" credentialless>
//     op een gastpagina op een andere oorsprong. Het document komt als bytes
//     over de brug; tekenen (met de CMaps en standaardfonts van PDF.js uit de
//     bundel), een rechthoek annoteren, opslaan naar de gastpagina, lijst,
//     versies en een vraag aan de assistent.
//
// Geëist: nul CSP-overtredingen (securitypolicyviolation-events en
// consolefouten), nul consolefouten, de annotatie zit in het opgeslagen
// bestand, geen verzoek buiten de bundel, en index.html heeft geen inline
// code en SRI op elk script en stylesheet.
//
// Overtredingen vangen:
//  - in elk frame: een securitypolicyviolation-luisteraar (addInitScript);
//  - in workers: Chromium meldt een eval-overtreding in een worker nergens in
//    de console. Daarom zet de test dezelfde luisteraar vóór elk script dat
//    de server levert en dat niet met SRI in index.html staat; die meldt via
//    console.error, en Playwright geeft workerconsoles door aan de pagina.
//    In de werkplek start elke worker uit een blob:-starter die het script
//    uit de bundel laadt (core/blob-worker.js): ook dat script krijgt de
//    luisteraar.
// Eerst per opzet een tegenproef op dezelfde server en onder hetzelfde
// beleid: een inline script, een eval in de pagina en een eval in een worker
// moeten alle drie gezien worden. Anders zegt "nul overtredingen" niets.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';
import { inktPerBand, maakProefPdf, openPdfInApp, startServer, PROEF_TEKST } from './gehost-proef.mjs';
import { controleerIndexHtml, cspBeleid } from './gehost-html.mjs';
import {
  APP_PAD, startWerkplek, nieuweContext, sriUrls, totDat, appFrameVan, tekenRechthoek, aantalAnnotaties,
  bewaardeBytes,
} from './werkplek-proef.mjs';

const SUB = '/pdf/';

function leesArgs(argv) {
  const args = { poort: 3663 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') args.dist = argv[++i];
    else if (argv[i] === '--poort') args.poort = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

const meld = (s) => console.log(s);
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const isCsp = (t) => /CSP violation|Content Security Policy|Refused to/i.test(t);

// Tegenproef A: een eigen pagina op dezelfde server, onder hetzelfde beleid.
const TEGENPROEF = '/tegenproef/';
const TEGENPROEF_BESTANDEN = {
  'index.html': '<!doctype html><html><head><script src="pagina.js"></script><script>window.inline = 1;</script></head><body></body></html>',
  'pagina.js': "try { eval('1'); } catch (e) {}\nnew Worker('worker.js').onmessage = function () { window.workerKlaar = true; };",
  'worker.js': "try { eval('1'); } catch (e) {}\npostMessage(1);",
};

// Tegenproef B: in de bundelmap van de werkplek, in het sandbox-iframe, met
// een worker zoals de app hem daar start (een klassieke blob-starter).
const TEGENPROEF_WERKPLEK = '__tegenproef/';
const TEGENPROEF_WERKPLEK_BESTANDEN = {
  'index.html': '<!doctype html><html><head><script src="pagina.js"></script><script>window.inline = 1;</script></head><body></body></html>',
  'pagina.js': "try { eval('1'); } catch (e) {}\n"
    + "var starter = URL.createObjectURL(new Blob(['importScripts(' + JSON.stringify(new URL('worker.js', location.href).href) + ');'], { type: 'text/javascript' }));\n"
    + 'new Worker(starter).onmessage = function () { window.workerKlaar = true; };',
  'worker.js': "try { eval('1'); } catch (e) {}\npostMessage(1);",
};

function schrijfMap(map, bestanden) {
  fs.mkdirSync(map, { recursive: true });
  for (const [naam, inhoud] of Object.entries(bestanden)) fs.writeFileSync(path.join(map, naam), inhoud);
}

/** Zag de opzet een inline script, een eval in de pagina en een eval in een worker? */
function tegenproefUitslag(inPagina, consolefouten) {
  return {
    inline: inPagina.some((t) => t.startsWith('script-src-elem inline')),
    eval: inPagina.some((t) => t.startsWith('script-src eval')),
    worker: consolefouten.some((t) => t.startsWith('[worker] CSP violation: script-src eval')),
  };
}

async function soortenInBlad1(bytes) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots();
  return annots ? annots.asArray().map((r) => String(doc.context.lookup(r).get(PDFName.of('Subtype')))) : [];
}

// ── A. #693: als gewone pagina, met 'self' ──────────────────────────────────
async function opzetA({ browser, dist, html, werk, pdfPad, poort, eis }) {
  meld('\nA. #693: top-level page, policy with \'self\'');
  const tegenproefMap = path.join(werk, 'tegenproef');
  schrijfMap(tegenproefMap, TEGENPROEF_BESTANDEN);
  const headers = {};
  const server = await startServer({ [SUB]: dist, [TEGENPROEF]: tegenproefMap }, { poort, headers });
  headers['Content-Security-Policy'] = cspBeleid(server.origin);
  meld(`Serving ${dist} at ${server.origin}${SUB}\n  Content-Security-Policy: ${headers['Content-Security-Policy']}`);
  try {
    const t = await nieuweContext(browser, server.origin, new Set());
    try {
      await t.page.goto(`${server.origin}${TEGENPROEF}`, { waitUntil: 'load' });
      await t.page.waitForFunction(() => window.workerKlaar === true, null, { timeout: 10000 }).catch(() => {});
      await t.page.waitForTimeout(500);
      const tp = tegenproefUitslag(await t.overtredingen(), t.consolefouten);
      meld(`Control page: inline script ${tp.inline ? 'seen' : 'MISSED'}, eval in page ${tp.eval ? 'seen' : 'MISSED'}, eval in worker ${tp.worker ? 'seen' : 'MISSED'}`);
      eis(tp.inline && tp.eval && tp.worker, 'A control: a deliberate violation was not reported; the detector is blind');
    } finally {
      await t.ctx.close();
    }

    const p = await nieuweContext(browser, server.origin, sriUrls(html, `${server.origin}${SUB}`), { acceptDownloads: true });
    const { page } = p;
    await page.goto(`${server.origin}${SUB}`, { waitUntil: 'load', timeout: 60000 });
    await openPdfInApp(page, pdfPad);
    const inkt = await inktPerBand(page);
    for (const [band, n] of Object.entries(inkt)) eis(n > 50, `A: no ink in band ${band} (${n})`);
    meld(`1. opened and drawn (ink per band ${JSON.stringify(inkt)})`);

    await tekenRechthoek(page, page.mainFrame());
    eis(await aantalAnnotaties(page.mainFrame()) === 1, 'A: the rectangle annotation was not created');
    meld('2. rectangle annotation drawn');

    // Opslaan: in de browser wordt dat een download.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click('.quick-access-toolbar .quick-access-btn >> nth=1'),
    ]);
    const opgeslagen = path.join(werk, 'opgeslagen.pdf');
    await download.saveAs(opgeslagen);
    const soorten = await soortenInBlad1(fs.readFileSync(opgeslagen));
    eis(soorten.includes('/Square'), `A: saved PDF has no Square annotation (${soorten.join(', ') || 'none'})`);
    meld(`3. saved ${fs.statSync(opgeslagen).size} bytes, annotations: ${soorten.join(', ') || 'none'}`);

    await wacht(500);
    const overtredingen = await p.overtredingen();
    eis(overtredingen.length === 0, `A: CSP violation events:\n    ${overtredingen.join('\n    ')}`);
    eis(p.consolefouten.length === 0, `A: console errors:\n    ${p.consolefouten.join('\n    ')}`);
    eis(p.paginafouten.length === 0, `A: page errors:\n    ${p.paginafouten.join('\n    ')}`);
    meld(`4. ${overtredingen.length} violation event(s), ${p.consolefouten.filter(isCsp).length} CSP console report(s), ${p.consolefouten.length} console error(s)`);
    const buiten = server.verzoeken.filter((v) => !v.url.startsWith(SUB) && !v.url.startsWith(TEGENPROEF));
    eis(buiten.length === 0, `A: requests outside ${SUB}: ${buiten.map((v) => v.url).join(', ')}`);
    await p.ctx.close();
  } finally {
    await server.sluit();
  }
}

// ── B. #704: de werkplek ────────────────────────────────────────────────────
async function opzetB({ browser, dist, html, werk, pdf, poort, eis }) {
  meld('\nB. #704: the workplace (opaque sandbox, credentialless, no \'self\', sub-path)');
  const tegenproefMap = path.join(werk, 'tegenproef-werkplek');
  schrijfMap(tegenproefMap, TEGENPROEF_WERKPLEK_BESTANDEN);
  const werkplek = await startWerkplek({
    bundel: dist, poortApp: poort, poortGast: poort + 1,
    documenten: { PROEF: { naam: 'proef.pdf', bytes: pdf } },
    extraInBundel: { [TEGENPROEF_WERKPLEK]: tegenproefMap },
  });
  meld(`Serving ${dist} at ${werkplek.bundelUrl}, host page ${werkplek.GAST}\n  Content-Security-Policy: ${werkplek.csp}`);
  try {
    const t = await nieuweContext(browser, werkplek.APP, new Set());
    try {
      await t.page.goto(werkplek.gastAdres({ pagina: `${TEGENPROEF_WERKPLEK}index.html` }), { waitUntil: 'load' });
      const frame = await appFrameVan(t.page);
      await totDat(() => frame.evaluate(() => window.workerKlaar === true).catch(() => false), 10_000, 'worker in the control page').catch(() => {});
      await wacht(500);
      const origin = await frame.evaluate(() => self.origin);
      const tp = tegenproefUitslag(await t.overtredingen(), t.consolefouten);
      meld(`Control page (origin ${origin}): inline script ${tp.inline ? 'seen' : 'MISSED'}, eval in page ${tp.eval ? 'seen' : 'MISSED'}, eval in blob worker ${tp.worker ? 'seen' : 'MISSED'}`);
      eis(origin === 'null', 'B control: the iframe has no opaque origin');
      eis(tp.inline && tp.eval && tp.worker, 'B control: a deliberate violation was not reported; the detector is blind');
    } finally {
      await t.ctx.close();
    }

    const p = await nieuweContext(browser, werkplek.APP, sriUrls(html, werkplek.bundelUrl));
    const { page } = p;
    await page.goto(werkplek.gastAdres({ bestand: 'PROEF' }), { waitUntil: 'load', timeout: 60000 });
    const frame = await appFrameVan(page);
    await totDat(() => frame.evaluate((tekst) => {
      const c = [document.querySelector('canvas#pdf-canvas'), document.querySelector('#continuous-container canvas.pdf-canvas')].find((x) => x && x.width > 300);
      return !!c && document.body.textContent.includes(tekst);
    }, PROEF_TEKST.cjk).catch(() => false), 90_000, 'document open from bytes');
    await wacht(1500);
    const inkt = await inktPerBand(frame);
    for (const [band, n] of Object.entries(inkt)) eis(n > 50, `B: no ink in band ${band} (${n})`);
    meld(`1. opened from bytes over the bridge and drawn (ink per band ${JSON.stringify(inkt)})`);

    await tekenRechthoek(page, frame);
    eis(await aantalAnnotaties(frame) === 1, 'B: the rectangle annotation was not created');
    meld('2. rectangle annotation drawn');

    await page.keyboard.press('Control+s');
    await totDat(() => page.evaluate(() => window.__gast.opgeslagen.length > 0), 60_000, 'save to the host page');
    await wacht(500);
    const bytes = await bewaardeBytes(page, 'PROEF');
    const soorten = await soortenInBlad1(bytes);
    eis(soorten.includes('/Square'), `B: saved PDF has no Square annotation (${soorten.join(', ') || 'none'})`);
    meld(`3. saved ${bytes.length} bytes to the host page, annotations: ${soorten.join(', ') || 'none'}`);

    const host = await frame.evaluate(async () => {
      const h = window.__OPDS_HOST__;
      const lijst = await h.storage.list();
      const versies = await h.storage.versions('PROEF');
      const ai = await h.ai.vraag({ messages: [{ role: 'user', content: 'Hallo' }], max_tokens: 20 });
      return { lijst, versies, ai };
    });
    eis(host.lijst.some((d) => d.id === 'PROEF' && d.name === 'proef.pdf'), 'B: list');
    eis(host.versies.length === 2, 'B: versions');
    eis(host.ai.bericht?.content === 'Nep-antwoord 1', 'B: ai.vraag');
    meld(`4. list ${host.lijst.length} file(s), ${host.versies.length} version(s), assistant: "${host.ai.bericht?.content}"`);

    await wacht(500);
    const overtredingen = await p.overtredingen();
    const naarHost = werkplek.verzoeken.gast.filter((v) => v.origin === 'null');
    eis(overtredingen.length === 0, `B: CSP violation events:\n    ${overtredingen.join('\n    ')}`);
    eis(p.consolefouten.length === 0, `B: console errors:\n    ${p.consolefouten.join('\n    ')}`);
    eis(p.paginafouten.length === 0, `B: page errors:\n    ${p.paginafouten.join('\n    ')}`);
    meld(`5. ${overtredingen.length} violation event(s), ${p.consolefouten.filter(isCsp).length} CSP console report(s), ${p.consolefouten.length} console error(s); `
      + `${page.workers().length} worker(s) from blob: ${page.workers().every((w) => w.url().startsWith('blob:'))}`);
    eis(page.workers().every((w) => w.url().startsWith('blob:')), 'B: a worker did not start from blob:');
    // De tegenproef liep eerder; tel alleen wat de app vroeg.
    const buiten = werkplek.verzoeken.app
      .filter((v) => !v.pad.startsWith(`${APP_PAD}${TEGENPROEF_WERKPLEK}`))
      .filter((v) => !v.pad.startsWith(APP_PAD));
    eis(buiten.length === 0, `B: requests outside ${APP_PAD}: ${buiten.map((v) => v.pad).join(', ')}`);
    eis(naarHost.length === 0, `B: the app made ${naarHost.length} request(s) to the host`);
    await p.ctx.close();
  } finally {
    await werkplek.sluit();
  }
}

async function hoofd() {
  const args = leesArgs(process.argv.slice(2));
  let tijdelijk = null;
  let dist = args.dist && path.resolve(args.dist);
  if (!dist) {
    tijdelijk = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-csp-'));
    dist = path.join(tijdelijk, 'dist');
    const { bouwGehost } = await import('./pak-webbundel.mjs');
    meld('Building the hosted bundle (--mode hosted --base=./)...');
    await bouwGehost(dist);
  }
  const fouten = [];
  const eis = (ok, bericht) => { if (!ok) fouten.push(bericht); return ok; };

  // index.html zelf: geen inline code, SRI op alles.
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const htmlFouten = controleerIndexHtml(html, (rel) => fs.readFileSync(path.join(dist, ...rel.split('/'))));
  eis(htmlFouten.length === 0, `index.html: ${htmlFouten.join('; ')}`);
  meld(`index.html: ${htmlFouten.length ? htmlFouten.join('; ') : 'no inline code, SRI on every script and stylesheet'}`);

  const werk = tijdelijk || fs.mkdtempSync(path.join(os.tmpdir(), 'opds-csp-'));
  const pdf = await maakProefPdf();
  const pdfPad = path.join(werk, 'proef.pdf');
  fs.writeFileSync(pdfPad, pdf);

  const browser = await chromium.launch({ headless: true });
  try {
    await opzetA({ browser, dist, html, werk, pdfPad, poort: args.poort, eis });
    await opzetB({ browser, dist, html, werk, pdf, poort: args.poort, eis });
  } finally {
    await browser.close();
    fs.rmSync(werk, { recursive: true, force: true });
  }

  if (fouten.length) {
    console.error(`\nFAILED (${fouten.length}):\n  ${fouten.join('\n  ')}`);
    process.exit(1);
  }
  meld('\nOK: the hosted bundle runs under both strict policies without violations');
}

hoofd().catch((e) => {
  console.error(e);
  process.exit(1);
});
