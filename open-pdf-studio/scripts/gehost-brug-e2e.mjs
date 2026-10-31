// De brug naar de werkplek (#694, #704) in een echte browser.
//
// De gehoste bundel (gebouwd zoals de release: --mode hosted --base=./,
// verder ongewijzigd) staat in een nagebootste werkplek van de OpenAEC
// SuperCloud (scripts/werkplek-proef.mjs): onder /werkplek/app/pdf/ op
// oorsprong A met de strikte CSP van de host (sandbox, geen 'self'), in
//   <iframe sandbox="allow-scripts allow-downloads allow-modals" credentialless>
// op een gastpagina op oorsprong B, met #ouder=<B>&app=pdf&bestand=DOC-1.
// De app heeft dus een opaque origin ("null"), geen opslag en geen cookies.
// Twee kwaadwillende vensters (een derde oorsprong C en een tweede venster
// op B) sturen bij elk bericht van de app eerst vervalste antwoorden.
//
// Gecontroleerd in headless Chromium:
//  1. de handdruk: de gastpagina zwijgt eerst 2 s; vervalste antwoorden op
//     hallo tellen niet, de app blijft elke 250 ms hallo zeggen;
//  2. het document opent uit de bytes van `open`; de app meldt `geopend`;
//     de PDF.js-worker en de andere workers draaien uit blob: (geen
//     terugval op de hoofdthread);
//  3. een rechthoek gaat met Ctrl+S naar de gastpagina; de bytes daar
//     bevatten de annotatie (pdf-lib);
//  4. een tweede opslag krijgt een conflict: de app toont de vertaalde
//     melding met de naam van de kopie en de melding van de host; de bytes
//     staan in de kopie, niets is weg; een derde opslag gaat naar de kopie;
//  5. lijst en versies in de vorm van de host; de versielijst in "Op deze
//     site" vraagt `versies`, toont de huidige versie bovenaan en opent die
//     via `open` (#707);
//  7. een alleen-lezen document: opslaan weigert met een vertaalde melding,
//     er gaat geen opslaan naar de host;
//  8. een mislukte open toont de vertaalde melding en gaat als `melding`
//     naar de host; bytes die geen PDF zijn ook (#707);
//  8b. een oudere versie uit de versielijst (#712): `open { bestand, versie }`
//     (een getal), een eigen tabblad met "Version 2 of 3 – read-only" (ook in
//     de titel), opslaan staat uit en Ctrl+S stuurt niets; "Opslaan als" geeft
//     een download met die versie; opslaan bij de host weigert dan met
//     versie_alleen_lezen (ook voor het huidige tabblad, met de vertaalde
//     melding); een ongeldig versienummer geeft versie_ongeldig en de
//     vertaalde melding, een versie die niet bestaat de gewone;
//  9. geen enkel vervalst antwoord telde;
// 10. 0 CSP-overtredingen, 0 consolefouten (op de verwachte fout bij de
//     kapotte PDF na), 0 waarschuwingen over lock_file/unlock_file (#707),
//     geen verzoek van de app buiten de bundel en geen enkel verzoek van de
//     app naar de host;
// 11. met een `ouder` die niet de pagina erboven is, start de brug niet.
//
// Draaien:  npm run test:hosted-bridge   (bouwt de bundel zelf)
// of:       node scripts/gehost-brug-e2e.mjs [--dist <map>]
// Poorten:  OPDS_BRUG_POORT_APP (3661) en OPDS_BRUG_POORT_GAST (3662).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import {
  APP_PAD, startWerkplek, nieuweContext, sriUrls, totDat, appFrameVan, wachtOpDocument, tekenRechthoek,
  aantalAnnotaties, melding, sluitMelding, bewaardeBytes,
} from './werkplek-proef.mjs';

function leesArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') args.dist = argv[++i];
    else if (!argv[i].startsWith('--') && !args.dist) args.dist = argv[i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

const POORT_APP = Number(process.env.OPDS_BRUG_POORT_APP || 3661);
const POORT_GAST = Number(process.env.OPDS_BRUG_POORT_GAST || 3662);
const UIT = path.join(os.tmpdir(), 'opds-gehost-brug-e2e');
fs.mkdirSync(UIT, { recursive: true });

const regels = [];
const noteer = (...a) => { const s = a.join(' '); regels.push(s); console.log(s); };
const fouten = [];
const eis = (voorwaarde, bericht) => { if (!voorwaarde) { fouten.push(bericht); noteer('  FOUT: ' + bericht); } return voorwaarde; };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Testbestanden (zelf gemaakt) ───────────────────────────────────────────
async function maakPdf(titel, paginas) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${titel} - pagina ${i + 1}`, { x: 60, y: 760, size: 24, font });
    p.drawRectangle({ x: 60, y: 200, width: 475, height: 500, borderWidth: 1 });
  }
  return new Uint8Array(await doc.save());
}

async function soortenIn(bytes) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots();
  return {
    paginas: doc.getPageCount(),
    soorten: annots ? annots.asArray().map((r) => String(doc.context.lookup(r).get(PDFName.of('Subtype')))) : [],
  };
}

const args = leesArgs(process.argv.slice(2));
let tijdelijk = null;
let BUNDEL = args.dist && path.resolve(args.dist);
if (!BUNDEL) {
  tijdelijk = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-brug-'));
  BUNDEL = path.join(tijdelijk, 'dist');
  const { bouwGehost } = await import('./pak-webbundel.mjs');
  noteer('De gehoste bundel bouwen (--mode hosted --base=./)...');
  await bouwGehost(BUNDEL);
}
if (!fs.existsSync(path.join(BUNDEL, 'index.html'))) {
  console.error(`Geen bundel in ${BUNDEL}`);
  process.exit(2);
}

const documenten = {
  'DOC-1': { naam: 'Plattegrond.pdf', bytes: await maakPdf('Plattegrond', 2) },
  'DOC-RO': { naam: 'Gevel.pdf', bytes: await maakPdf('Gevel', 1), alleenLezen: true },
  // Geen PDF: wat een kapotte of verkeerde upload in de opslag geeft (#707).
  'DOC-KAPOT': { naam: 'Kapot.pdf', bytes: new TextEncoder().encode('Dit is geen PDF, maar een tekstbestand.\n') },
};
const werkplek = await startWerkplek({ bundel: BUNDEL, poortApp: POORT_APP, poortGast: POORT_GAST, documenten });
const { APP, GAST, DERDE } = werkplek;
noteer(`Bundel ${werkplek.bundelUrl}, gastpagina ${GAST}; CSP:\n  ${werkplek.csp}`);

const html = fs.readFileSync(path.join(BUNDEL, 'index.html'), 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const p = await nieuweContext(browser, APP, sriUrls(html, werkplek.bundelUrl));
const { page } = p;
const consoleAlles = [];
page.on('console', (m) => consoleAlles.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
const gast = () => page.evaluate(() => ({
  log: window.__gast.log, vervalsingen: window.__gast.vervalsingen, eersteAntwoord: window.__gast.eersteAntwoord,
  opgeslagen: window.__gast.opgeslagen, geopend: window.__gast.geopend, meldingen: window.__gast.meldingen,
  vragen: window.__gast.vragen, overzicht: window.__gast.overzicht(),
}));

let geslaagd = false;
try {
  await page.goto(werkplek.gastAdres({ bestand: 'DOC-1', zwijg: 2000, vervalsers: 1, conflict: 1 }), { waitUntil: 'load' });
  const frame = await appFrameVan(page);

  // 1. Handdruk met een gastpagina die later "laadt".
  await totDat(async () => {
    const g = await gast();
    return g.eersteAntwoord !== null || g.log.some((r) => r.soort !== 'hallo');
  }, 60_000, 'eerste antwoord op hallo');
  let g = await gast();
  const hallosVoor = g.log.filter((r) => r.soort === 'hallo' && r.t < 2000);
  const eersteAnder = g.log.find((r) => r.soort !== 'hallo');
  noteer(`1. handdruk: ${hallosVoor.length} keer hallo in de eerste 2 s, ${g.vervalsingen} keer vervalst geantwoord; verbonden na ${g.eersteAntwoord} ms`);
  // De cadans telt vanaf het eerste hallo: wanneer dat komt hangt af van hoe
  // snel de app opstart (op een belaste machine soms pas na ~1 s), niet van
  // de brug. Elke 250 ms één hallo, met wat speling voor timers.
  const eersteHallo = hallosVoor[0]?.t ?? 2000;
  const verwacht = Math.floor((2000 - eersteHallo) / 250) + 1;
  eis(hallosVoor.length >= 3 && hallosVoor.length >= verwacht - 1,
    `te weinig hallo tijdens het zwijgen (${hallosVoor.length}, verwacht ~${verwacht} vanaf ${Math.round(eersteHallo)} ms)`);
  if (eersteAnder && (g.eersteAntwoord === null || eersteAnder.t < g.eersteAntwoord)) {
    throw new Error(`de app vroeg "${eersteAnder.soort}" vóór de echte handdruk: een vervalst hallo-antwoord telde`);
  }
  const binnen = await frame.evaluate(() => {
    let opslag = 'bruikbaar';
    try { void window.localStorage.length; } catch (e) { opslag = e.name; }
    let koekje = 'leesbaar';
    try { void document.cookie; } catch (e) { koekje = e.name; }
    return {
      origin: self.origin, ancestorOrigins: [...(location.ancestorOrigins || [])], opslag, koekje,
      contract: !!window.__OPDS_HOST__, document: window.__OPDS_HOST__?.document, ai: typeof window.__OPDS_HOST__?.ai?.vraag,
    };
  });
  noteer(`   in het iframe: origin=${binnen.origin}, ancestorOrigins=${JSON.stringify(binnen.ancestorOrigins)}, localStorage: ${binnen.opslag}, cookie: ${binnen.koekje}`);
  eis(binnen.origin === 'null', 'het iframe heeft geen opaque origin');
  eis(binnen.contract && binnen.document === 'DOC-1' && binnen.ai === 'function', 'de brug zette het contract niet neer');

  // 2. Het document opent uit de bytes.
  await wachtOpDocument(frame, 'Plattegrond.pdf');
  g = await gast();
  noteer(`2. open { bestand: ${g.log.find((r) => r.soort === 'open')?.bestand} } -> Plattegrond.pdf staat in een tabblad; geopend: ${JSON.stringify(g.geopend)}`);
  eis(g.geopend.includes('DOC-1'), 'de app meldde geopend niet');
  const workers = page.workers().map((w) => w.url());
  noteer(`   workers: ${workers.map((u) => u.replace(/[0-9a-f-]{20,}/, '…')).join(', ') || 'geen'}`);
  eis(workers.length > 0 && workers.every((u) => u.startsWith('blob:')), `workers niet uit blob: ${workers.join(', ')}`);
  eis(!consoleAlles.some((t) => /fake worker/i.test(t)), 'PDF.js viel terug op de hoofdthread (fake worker)');
  eis(await frame.evaluate(() => Worker.opdsBlobWorker === true), 'elke andere worker start niet uit blob: (de vervanging van Worker ontbreekt)');
  await page.screenshot({ path: path.join(UIT, '1-geopend.png') });

  // 3. Een rechthoek tekenen en opslaan.
  await tekenRechthoek(page, frame, { x: 0.15, y: 0.2 });
  eis(await aantalAnnotaties(frame) === 1, 'de rechthoek is niet gemaakt');
  await page.keyboard.press('Control+s');
  await totDat(async () => (await gast()).opgeslagen.length >= 1, 60_000, 'opslaan bij de gastpagina');
  await wacht(800);
  const eerste = await bewaardeBytes(page, 'DOC-1');
  fs.writeFileSync(path.join(UIT, 'opgeslagen-1.pdf'), eerste);
  const s1 = await soortenIn(eerste);
  noteer(`3. opslaan { bestand: DOC-1, bytes: ${eerste.length} }; ${s1.paginas} pagina's, annotaties op blad 1: ${s1.soorten.join(', ') || 'geen'}`);
  eis(s1.paginas === 2 && s1.soorten.includes('/Square'), 'de opgeslagen bytes hebben geen rechthoek of niet het echte document');
  eis(await melding(frame) === null, 'een gewone opslag toonde een melding');

  // 4. Tweede opslag: conflict.
  await tekenRechthoek(page, frame, { x: 0.45, y: 0.2 });
  noteer(`4. tweede rechthoek: ${await aantalAnnotaties(frame)} annotaties`);
  await page.keyboard.press('Control+s');
  await totDat(async () => (await gast()).opgeslagen.length >= 2, 60_000, 'tweede opslag bij de gastpagina');
  const conflictTekst = await totDat(() => melding(frame), 60_000, 'melding na het conflict');
  noteer(`   conflict: de app toont "${conflictTekst.replace(/\s+/g, ' ').slice(0, 220)}…"`);
  eis(conflictTekst.includes('Plattegrond (conflict).pdf'), 'de melding noemt de kopie niet');
  eis(/separate copy/.test(conflictTekst), 'de vertaalde conflictmelding ontbreekt');
  eis(/not reserved for you/.test(conflictTekst), 'de melding "niet vastgezet" ontbreekt');
  eis(conflictTekst.includes('Iemand anders sloeg dit bestand intussen op.'), 'de melding van de host ontbreekt');
  await sluitMelding(frame);
  const kopie = await bewaardeBytes(page, 'DOC-1-conflict');
  const s2 = kopie ? await soortenIn(kopie) : { soorten: [] };
  eis(s2.soorten.filter((x) => x === '/Square').length === 2, 'de kopie heeft niet beide rechthoeken: er ging iets verloren');
  // Een derde opslag gaat naar de kopie.
  await tekenRechthoek(page, frame, { x: 0.15, y: 0.6 });
  await page.keyboard.press('Control+s');
  await totDat(async () => (await gast()).overzicht['DOC-1-conflict']?.versies === 2, 60_000, 'derde opslag in de kopie');
  await wacht(500);
  g = await gast();
  noteer(`   daarna: ${JSON.stringify(g.overzicht)}; melding bij de derde opslag: ${await melding(frame) ?? 'geen'}`);
  eis(g.overzicht['DOC-1'].versies === 1, 'het origineel kreeg een versie na het conflict');
  eis(await melding(frame) === null, '"niet vastgezet" werd nog eens gemeld');

  // 5. Lijst en versies.
  const lijst = await frame.evaluate(() => window.__OPDS_HOST__.storage.list());
  const versies = await frame.evaluate(() => window.__OPDS_HOST__.storage.versions('DOC-1'));
  noteer(`5. lijst: ${JSON.stringify(lijst)}`);
  noteer(`   versies van DOC-1: ${versies.map((v) => `v${v.version} (${v.author})`).join(', ')}`);
  eis(lijst.length === 3 && lijst[0].id === 'DOC-1' && lijst[0].name === 'Plattegrond.pdf' && lijst[0].modified, 'verkeerde lijst');
  eis(versies.length === 3 && versies.every((v) => v.version && v.modified && v.author), 'verkeerde versies');

  // De versielijst in "Op deze site" (#707).
  await frame.locator('#file-tab').click();
  await frame.locator('.app-menu-items .app-menu-item', { hasText: /^\s*Open\s*(Ctrl\+O)?\s*$/ }).first().click();
  const rij = frame.locator('.site-doc[data-site-doc="DOC-1"]');
  await rij.waitFor({ timeout: 30_000 });
  const versiesVoor = (await gast()).log.filter((r) => r.soort === 'versies').length;
  const opensVoor = (await gast()).log.filter((r) => r.soort === 'open').length;
  await rij.locator('.site-versions-btn').click();
  await totDat(() => frame.locator('.site-version').count(), 30_000, 'versielijst');
  const rijen = await frame.locator('.site-version').evaluateAll((els) => els.map((e) => ({
    versie: e.dataset.versie, huidig: e.classList.contains('current'), tekst: e.innerText.replace(/\s+/g, ' ').trim(),
  })));
  const hint = await frame.locator('.site-versions-hint').innerText().catch(() => '');
  g = await gast();
  const versieVerzoek = g.log.filter((r) => r.soort === 'versies').at(-1);
  noteer(`   versielijst in de app: ${rijen.map((r) => `${r.tekst}${r.huidig ? ' [huidig]' : ''}`).join(' | ')}; hint: "${hint}"`);
  eis(g.log.filter((r) => r.soort === 'versies').length === versiesVoor + 1 && versieVerzoek?.bestand === 'DOC-1', 'de versielijst vroeg geen versies { bestand: DOC-1 }');
  eis(rijen.length === 3 && rijen.map((r) => r.versie).join() === '3,2,1', 'de versies staan niet nieuwste eerst');
  eis(rijen[0].huidig && rijen.slice(1).every((r) => !r.huidig), 'niet precies de nieuwste versie is de huidige');
  eis(/^Version 3 \(current\)/.test(rijen[0].tekst) && rijen[2].tekst.includes('beheer@klant.example'), 'tekst van de versies');
  eis(/open read-only/.test(hint), 'de uitleg bij oudere versies ontbreekt');
  await page.screenshot({ path: path.join(UIT, '2-versies.png') });
  // De huidige versie opent het bestand via `open`, en het menu gaat dicht.
  await frame.locator('.site-version.current').click();
  await totDat(async () => (await gast()).log.filter((r) => r.soort === 'open').length > opensVoor, 30_000, 'open na de huidige versie');
  const openNaVersie = (await gast()).log.filter((r) => r.soort === 'open').at(-1);
  eis(openNaVersie.bestand === 'DOC-1', `de huidige versie opende ${openNaVersie.bestand}`);
  await totDat(async () => !(await frame.locator('.app-menu-overlay.visible').count()), 10_000, 'menu dicht');
  await wacht(500);

  // 7. Een alleen-lezen document.
  await frame.evaluate(() => window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id: 'DOC-RO' } })));
  await wachtOpDocument(frame, 'Gevel.pdf');
  const voorRo = (await gast()).opgeslagen.length;
  // Focus in het iframe: een klik op het blad (met het selectiegereedschap).
  await page.keyboard.press('Escape');
  const vakRo = await (await frame.$('canvas#annotation-canvas') || await frame.$('canvas#pdf-canvas')).boundingBox();
  await page.mouse.click(vakRo.x + 30, Math.max(vakRo.y, 0) + 30);
  await page.keyboard.press('Control+s');
  const roTekst = await totDat(() => melding(frame), 30_000, 'melding bij opslaan alleen-lezen');
  noteer(`7. alleen-lezen: "${roTekst}"`);
  eis(/read-only/.test(roTekst), 'geen vertaalde melding bij opslaan van een alleen-lezen document');
  await sluitMelding(frame);
  eis((await gast()).opgeslagen.length === voorRo, 'een alleen-lezen document ging naar de host');
  eis((await gast()).geopend.includes('DOC-RO'), 'geopend niet gemeld voor het alleen-lezen document');

  // 8. Een mislukte open.
  await frame.evaluate(() => window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id: 'ONBEKEND' } })));
  const misTekst = await totDat(() => melding(frame), 30_000, 'melding na mislukte open');
  noteer(`8. mislukte open: "${misTekst}"`);
  eis(misTekst === 'The file could not be read from storage. Try again.', 'niet de vertaalde melding');
  await totDat(async () => (await gast()).meldingen.length > 0, 10_000, 'melding bij de host');
  g = await gast();
  noteer(`   bij de host: ${JSON.stringify(g.meldingen)}`);
  eis(g.meldingen[0].tekst === misTekst && g.meldingen[0].toon === 'fout', 'de host kreeg de melding niet');
  await sluitMelding(frame);

  // Bytes die geen PDF zijn (#707): de eigen melding van de app, en een `melding` aan de host.
  const foutenVoorKapot = p.consolefouten.length;
  await frame.evaluate(() => window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id: 'DOC-KAPOT' } })));
  const kapotTekst = await totDat(() => melding(frame), 30_000, 'melding na kapotte bytes');
  await totDat(async () => (await gast()).meldingen.length > 1, 10_000, 'melding bij de host na kapotte bytes');
  g = await gast();
  const kapotBijHost = g.meldingen.at(-1);
  noteer(`   kapotte bytes: de app toont "${kapotTekst.replace(/\s+/g, ' ').slice(0, 160)}"; bij de host: ${JSON.stringify(kapotBijHost)}`);
  eis(/Failed to load PDF/i.test(kapotTekst), 'de app toonde geen eigen melding bij kapotte bytes');
  eis(kapotBijHost.tekst === 'Kapot.pdf is not a valid PDF file and could not be opened.' && kapotBijHost.toon === 'fout',
    'de host kreeg geen melding met toon "fout" bij kapotte bytes');
  eis(!g.geopend.includes('DOC-KAPOT'), 'geopend gemeld voor een document dat niet opende');
  await sluitMelding(frame);
  // De verwachte fout van de lader ("Error loading PDF") telt niet als consolefout.
  const kapotFouten = p.consolefouten.splice(foutenVoorKapot).filter((t) => !/^Error loading PDF/.test(t));
  p.consolefouten.push(...kapotFouten);

  // 8b. Een oudere versie (#712).
  const opens = async () => (await gast()).log.filter((r) => r.soort === 'open');
  const opensVoorVersie = (await opens()).length;
  await frame.locator('#file-tab').click();
  await frame.locator('.app-menu-items .app-menu-item', { hasText: /^\s*Open\s*(Ctrl\+O)?\s*$/ }).first().click();
  const rijV = frame.locator('.site-doc[data-site-doc="DOC-1"]');
  await rijV.waitFor({ timeout: 30_000 });
  await rijV.locator('.site-versions-btn').click();
  await totDat(() => frame.locator('.site-version').count(), 30_000, 'versielijst voor een oudere versie');
  await frame.locator('.site-version[data-versie="2"]').click();
  await totDat(async () => (await opens()).length > opensVoorVersie, 30_000, 'open met versie');
  const openV = (await opens()).at(-1);
  noteer(`8b. oudere versie: ${JSON.stringify({ bestand: openV.bestand, versie: openV.versie })}`);
  eis(openV.bestand === 'DOC-1' && openV.versie === 2, 'de oudere versie ging niet als open { bestand: DOC-1, versie: 2 } (getal)');
  await wachtOpDocument(frame, 'Version 2 of 3');
  const versieTab = await frame.evaluate(() => ({
    badge: document.querySelector('.document-tab.active .document-tab-version')?.textContent ?? null,
    naam: document.querySelector('.document-tab.active .document-tab-title')?.textContent ?? null,
    titel: document.title,
    titelbalk: document.querySelector('.file-name')?.textContent ?? null,
    tabs: document.querySelectorAll('.document-tab').length,
    opslaanUit: document.querySelector('button.quick-access-btn[title="Save (Ctrl+S)"]')?.disabled ?? null,
  }));
  noteer(`   tabblad: ${JSON.stringify(versieTab)}`);
  eis(versieTab.badge === 'Version 2 of 3 \u2013 read-only', `het tabblad toont niet "Version 2 of 3 \u2013 read-only" (${versieTab.badge})`);
  eis(versieTab.titel.includes('Version 2 of 3 \u2013 read-only') && !!versieTab.titelbalk?.includes('Version 2 of 3'),
    'de titel noemt de versie niet');
  eis(versieTab.opslaanUit === true, 'de opslaanknop staat niet uit');
  await page.screenshot({ path: path.join(UIT, '3-oudere-versie.png') });
  // Ctrl+S: een vertaalde melding, er gaat niets naar de host.
  const opgeslagenVoorV = (await gast()).opgeslagen.length;
  const opslaanVoorV = (await gast()).log.filter((r) => r.soort === 'opslaan').length;
  await page.keyboard.press('Escape');
  const vakV = await (await frame.$('canvas#annotation-canvas') || await frame.$('canvas#pdf-canvas')).boundingBox();
  await page.mouse.click(vakV.x + 30, Math.max(vakV.y, 0) + 30);
  await page.keyboard.press('Control+s');
  const versieRo = await totDat(() => melding(frame), 30_000, 'melding bij opslaan van een oudere versie');
  noteer(`   Ctrl+S: "${versieRo}"`);
  eis(/older version/.test(versieRo) && /Save As/.test(versieRo), 'geen vertaalde melding bij opslaan van een oudere versie');
  await sluitMelding(frame);
  eis((await gast()).log.filter((r) => r.soort === 'opslaan').length === opslaanVoorV, 'een oudere versie ging met opslaan naar de host');
  // Opslaan als: een download met de bytes van die versie (twee rechthoeken).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.keyboard.press('Control+Shift+S'),
  ]);
  const gedownload = fs.readFileSync(await download.path());
  const sDl = await soortenIn(gedownload);
  noteer(`   Opslaan als: download "${download.suggestedFilename()}", ${gedownload.length} bytes, annotaties: ${sDl.soorten.join(', ')}`);
  eis(sDl.paginas === 2 && sDl.soorten.filter((x) => x === '/Square').length === 2, 'de download is niet versie 2');
  eis((await gast()).opgeslagen.length === opgeslagenVoorV, 'Opslaan als ging naar de host');
  // Opslaan bij de host terwijl de oudere versie getoond wordt: versie_alleen_lezen.
  const weigering = await frame.evaluate(async () => {
    try { await window.__OPDS_HOST__.storage.save('DOC-1', new TextEncoder().encode('%PDF-1.4')); return null; }
    catch (e) { return { code: e.code, hostCode: e.hostCode, bericht: e.message }; }
  });
  noteer(`   storage.save tijdens de oudere versie: ${JSON.stringify(weigering)}`);
  eis(weigering?.hostCode === 'versie_alleen_lezen', 'opslaan bij de host weigerde niet met versie_alleen_lezen');
  // Het huidige tabblad opslaan: de host weigert, de app toont de vertaalde melding.
  await frame.locator('.document-tab', { has: frame.locator('.document-tab-title', { hasText: /^Plattegrond\.pdf$/ }) }).first().click();
  await wacht(800);
  await tekenRechthoek(page, frame, { x: 0.45, y: 0.6 });
  await page.keyboard.press('Control+s');
  const huidigGeweigerd = await totDat(() => melding(frame), 60_000, 'melding na versie_alleen_lezen');
  noteer(`   huidig tabblad opslaan: "${huidigGeweigerd.replace(/\s+/g, ' ')}"`);
  eis(/older version of it is open read-only/.test(huidigGeweigerd), 'geen vertaalde melding bij versie_alleen_lezen');
  await sluitMelding(frame);
  eis((await gast()).opgeslagen.length === opgeslagenVoorV, 'de host bewaarde toch een versie');
  // Een ongeldig versienummer: versie_ongeldig en de vertaalde melding.
  const meldingenVoorV = (await gast()).meldingen.length;
  await frame.evaluate(() => window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id: 'DOC-1', versie: 0 } })));
  const ongeldig = await totDat(() => melding(frame), 30_000, 'melding na een ongeldige versie');
  const openOngeldig = (await opens()).at(-1);
  noteer(`   versie 0: open ${JSON.stringify({ bestand: openOngeldig.bestand, versie: openOngeldig.versie })} -> "${ongeldig}"`);
  eis(openOngeldig.versie === 0, 'de ongeldige versie ging niet naar de host');
  eis(ongeldig === 'This version of the file cannot be opened: the version number is not valid.', 'niet de vertaalde melding bij versie_ongeldig');
  await sluitMelding(frame);
  await totDat(async () => (await gast()).meldingen.length > meldingenVoorV, 10_000, 'melding bij de host na een ongeldige versie');
  // Een versie die niet bestaat: de gewone melding.
  await frame.evaluate(() => window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id: 'DOC-1', versie: 99 } })));
  const bestaatNiet = await totDat(() => melding(frame), 30_000, 'melding na een versie die niet bestaat');
  noteer(`   versie 99: "${bestaatNiet}"`);
  eis(bestaatNiet === 'The file could not be read from storage. Try again.', 'niet de gewone melding bij een versie die niet bestaat');
  await sluitMelding(frame);
  g = await gast();

  // 9. Geen vervalst antwoord telde.
  const tekst = await frame.evaluate(() => document.body.innerText);
  noteer(`9. ${g.vervalsingen} keer vervalst geantwoord (derde oorsprong én ander venster op de juiste oorsprong)`);
  eis(!tekst.includes('VERVALST') && !tekst.includes('Vervalst.pdf'), 'een vervalst antwoord is zichtbaar in de app');
  eis(g.vervalsingen >= g.log.length, 'niet elk bericht kreeg een vervalst antwoord');
  eis(!lijst.some((d) => d.id === 'VERVALST') && !versies.some((v) => v.version === 'VERVALST'), 'een vervalste lijst telde');

  // 10. CSP, console en verzoeken.
  await wacht(500);
  const overtredingen = await p.overtredingen();
  const buiten = werkplek.verzoeken.app.filter((v) => !v.pad.startsWith(APP_PAD));
  const naarHost = werkplek.verzoeken.gast.filter((v) => v.origin === 'null');
  const metKoekje = werkplek.verzoeken.app.filter((v) => v.cookie);
  noteer(`10. ${overtredingen.length} CSP-overtreding(en), ${p.consolefouten.length} consolefout(en), ${p.paginafouten.length} paginafout(en); `
    + `${werkplek.verzoeken.app.length} verzoeken naar de bundel (${buiten.length} buiten ${APP_PAD}, ${metKoekje.length} met cookie), ${naarHost.length} van de app naar de host`);
  eis(overtredingen.length === 0, `CSP-overtredingen:\n    ${overtredingen.join('\n    ')}`);
  eis(p.consolefouten.length === 0, `consolefouten:\n    ${p.consolefouten.join('\n    ')}`);
  eis(p.paginafouten.length === 0, `paginafouten:\n    ${p.paginafouten.join('\n    ')}`);
  const lockWaarschuwingen = consoleAlles.filter((t) => /lock[ _]file/i.test(t));
  noteer(`    ${lockWaarschuwingen.length} waarschuwing(en) over lock_file/unlock_file`);
  eis(lockWaarschuwingen.length === 0, `lock_file/unlock_file in de browser:\n    ${lockWaarschuwingen.join('\n    ')}`);
  eis(buiten.length === 0 && naarHost.length === 0 && metKoekje.length === 0, 'de app haalde iets buiten de bundel of bij de host');

  // 11. Een ouder die niet de pagina erboven is: geen brug.
  const page2 = await p.ctx.newPage();
  await page2.goto(werkplek.gastAdres({ ouder: DERDE }), { waitUntil: 'load' });
  const frame2 = await appFrameVan(page2);
  await totDat(() => frame2.evaluate(() => !!document.querySelector('#app-root')?.children.length).catch(() => false), 60_000, 'tweede app geladen');
  await wacht(1500);
  const zonder = await frame2.evaluate(() => ({ contract: window.__OPDS_HOST__ !== undefined, ancestor: [...(location.ancestorOrigins || [])] }));
  const log2 = await page2.evaluate(() => window.__gast.log.length);
  noteer(`11. #ouder=${DERDE} onder ${zonder.ancestor[0]}: __OPDS_HOST__ ${zonder.contract ? 'staat er (FOUT)' : 'ontbreekt'}, ${log2} berichten naar buiten`);
  eis(!zonder.contract && log2 === 0, 'de brug startte met een ouder die niet de pagina erboven is');
  await page2.close();

  geslaagd = fouten.length === 0;
} catch (e) {
  fouten.push(e.message);
  noteer('FOUT: ' + e.stack);
  try { await page.screenshot({ path: path.join(UIT, 'fout.png') }); } catch { /* */ }
} finally {
  await browser.close();
  await werkplek.sluit();
  if (tijdelijk) fs.rmSync(tijdelijk, { recursive: true, force: true });
}

fs.writeFileSync(path.join(UIT, 'verslag.txt'), regels.join('\n') + '\n');
noteer(geslaagd ? `GESLAAGD (verslag en schermafdrukken in ${UIT})` : `MISLUKT: ${fouten.length} fout(en)`);
process.exit(geslaagd ? 0 : 1);
