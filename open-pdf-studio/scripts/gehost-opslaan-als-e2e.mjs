// Opslaan als in de opslag van de werkplek (#726), in een echte browser.
//
// De gehoste bundel in de nagebootste werkplek (scripts/werkplek-proef.mjs),
// met een gastpagina die `opslaan_als` kent (?opslaanals=1) en een die dat
// niet kent. Gecontroleerd in headless Chromium:
//  1. de handdruk noemt opslaan_als; Ctrl+Shift+S opent de dialoog met
//     "<naam> (copy).pdf" en de mappen uit `lijst` (Archief alleen-lezen);
//  2. een map openen vraagt `lijst { map }`; Opslaan stuurt opslaan_als
//     { naam, map, bytes } en er komt geen download; de bytes bevatten de
//     nieuwe annotatie;
//  3. "Het nieuwe bestand openen": het tabblad heet zoals het nieuwe bestand,
//     de app meldt `geopend` met het nieuwe id, en Ctrl+S schrijft daarna met
//     `opslaan` naar het nieuwe bestand (niet naar het origineel);
//  4. dezelfde naam nog eens: de host maakt "(2)" en de app meldt dat er
//     niets overschreven is; "Verder met het origineel" laat het tabblad staan;
//  5. de map Archief weigert (alleen_lezen): de vertaalde melding met
//     "Download instead", en die knop geeft een download;
//  6. pagina's uitnemen (een export) gaat ook naar de host, met een melding
//     waar het bestand staat, en zonder download;
//  7. een gastpagina zonder opslaan_als: Opslaan als blijft een download,
//     zonder dialoog;
//  8. 0 CSP-overtredingen, 0 consolefouten en paginafouten.
//
// Draaien:  npm run test:hosted-save-as   (bouwt de bundel zelf)
// of:       node scripts/gehost-opslaan-als-e2e.mjs [--dist <map>]
// Poorten:  OPDS_OPSLAAN_ALS_POORT_APP (3671) en OPDS_OPSLAAN_ALS_POORT_GAST (3672).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import {
  startWerkplek, nieuweContext, sriUrls, totDat, appFrameVan, wachtOpDocument, tekenRechthoek,
  bewaardeBytes, melding, sluitMelding,
} from './werkplek-proef.mjs';

const args = process.argv.slice(2);
const distArg = args.indexOf('--dist') >= 0 ? args[args.indexOf('--dist') + 1] : null;
const POORT_APP = Number(process.env.OPDS_OPSLAAN_ALS_POORT_APP || 3671);
const POORT_GAST = Number(process.env.OPDS_OPSLAAN_ALS_POORT_GAST || 3672);

const fouten = [];
const noteer = (...a) => console.log(a.join(' '));
const eis = (voorwaarde, bericht) => { if (!voorwaarde) { fouten.push(bericht); noteer('  FOUT: ' + bericht); } return voorwaarde; };

async function maakPdf(titel, paginas) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${titel} - pagina ${i + 1}`, { x: 60, y: 760, size: 24, font });
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

let BUNDEL = distArg && path.resolve(distArg);
if (!BUNDEL) {
  const tijdelijk = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-opslaan-als-'));
  BUNDEL = path.join(tijdelijk, 'dist');
  const { bouwGehost } = await import('./pak-webbundel.mjs');
  noteer('De gehoste bundel bouwen (--mode hosted --base=./)...');
  await bouwGehost(BUNDEL);
}
if (!fs.existsSync(path.join(BUNDEL, 'index.html'))) {
  console.error(`Geen bundel in ${BUNDEL}`);
  process.exit(2);
}

const documenten = { 'DOC-1': { naam: 'Plattegrond.pdf', bytes: await maakPdf('Plattegrond', 2) } };
const werkplek = await startWerkplek({ bundel: BUNDEL, poortApp: POORT_APP, poortGast: POORT_GAST, documenten });
const html = fs.readFileSync(path.join(BUNDEL, 'index.html'), 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });

/** De tekst van de keuzedialoog (#726), of null. */
const keuzeTekst = (frame) => frame.evaluate(() => document.querySelector('.host-keuze-dialog .message-dialog-body')?.innerText ?? null).catch(() => null);
const kies = async (frame, label) => {
  await frame.locator('.host-keuze-dialog .host-keuze-footer button', { hasText: label }).first().click();
  await totDat(async () => (await keuzeTekst(frame)) === null, 60_000, 'keuzedialoog dicht');
};
const dialoogOpen = (frame) => frame.evaluate(() => !!document.querySelector('.host-save-as-dialog')).catch(() => false);
const items = (frame) => frame.evaluate(() => [...document.querySelectorAll('.host-save-as-item')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const actieveTab = (frame) => frame.evaluate(() => document.querySelector('.document-tab.active .document-tab-title')?.textContent ?? null);

async function slaOpAlsVia(page, frame) {
  await frame.locator('canvas#pdf-canvas, #continuous-container canvas').first().click({ position: { x: 20, y: 20 } }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+S');
  await totDat(() => dialoogOpen(frame), 120_000, 'dialoog Opslaan als');
  await totDat(async () => (await items(frame)).length > 0, 120_000, 'mappen in de dialoog');
}

try {
  // ── Met opslaan_als ──────────────────────────────────────────────────────
  const p = await nieuweContext(browser, werkplek.APP, sriUrls(html, werkplek.bundelUrl), { acceptDownloads: true });
  const { page } = p;
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  const gast = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__gast)));
  await page.goto(werkplek.gastAdres({ opslaanals: 1 }));
  const frame = await appFrameVan(page);
  await wachtOpDocument(frame, 'Plattegrond.pdf');
  // Op een drukke machine kan het lint later klaar zijn dan het blad.
  await frame.locator('button.tp-btn[title="Rect"]').first().waitFor({ timeout: 120_000 });
  const hallo = (await gast()).log.find((r) => r.soort === 'hallo');
  eis(!!hallo, 'geen handdruk');

  // 1. De dialoog.
  await tekenRechthoek(page, frame);
  await slaOpAlsVia(page, frame);
  const naam1 = await frame.inputValue('#host-save-as-naam');
  const top = await items(frame);
  noteer(`1. dialoog: naam "${naam1}", items ${JSON.stringify(top)}`);
  eis(naam1 === 'Plattegrond (copy).pdf', 'de voorgestelde naam is niet "<naam> (copy).pdf"');
  eis(top.some((t) => t === 'Project') && top.some((t) => /^Archief read-only$/.test(t)), 'de mappen (en alleen-lezen) staan er niet');
  eis(top.some((t) => t === 'Plattegrond.pdf'), 'het bestaande bestand staat er niet');

  // 2. Map Project en opslaan.
  await frame.locator('.host-save-as-item', { hasText: 'Project' }).click();
  await totDat(async () => (await gast()).log.some((r) => r.soort === 'lijst') && (await frame.locator('.host-save-as-weg').innerText()).includes('Project'), 60_000, 'submap open');
  await frame.locator('.host-save-as-dialog .modal-footer button', { hasText: /^Save$/ }).click();
  const tekst1 = await totDat(() => keuzeTekst(frame), 120_000, 'keuze na opslaan als');
  let g = await gast();
  noteer(`2. opslaan_als: ${JSON.stringify(g.opgeslagenAls)}; melding "${tekst1}"`);
  eis(g.opgeslagenAls.length === 1 && g.opgeslagenAls[0].map === 'MAP-PROJECT' && g.opgeslagenAls[0].naam === 'Plattegrond (copy).pdf', 'opslaan_als niet met naam en map');
  eis(/Saved as .Plattegrond \(copy\)\.pdf. in your documents/.test(tekst1), 'niet de melding "Saved as"');
  eis(downloads.length === 0, 'Opslaan als gaf een download');
  eis(g.opgeslagen.length === 0, 'het origineel werd overschreven');
  const nieuw1 = g.opgeslagenAls[0].id;
  const s1 = await soortenIn(await bewaardeBytes(page, nieuw1));
  eis(s1.paginas === 2 && s1.soorten.includes('/Square'), 'het nieuwe bestand mist de rechthoek');

  // 3. Het nieuwe bestand openen.
  await kies(frame, 'Open the new file');
  await totDat(async () => (await actieveTab(frame)) === 'Plattegrond (copy).pdf', 60_000, 'tabblad heet zoals het nieuwe bestand');
  await totDat(async () => (await gast()).geopend.includes(nieuw1), 60_000, 'geopend met het nieuwe id');
  await tekenRechthoek(page, frame, { x: 0.3, y: 0.4 });
  await page.keyboard.press('Control+s');
  await totDat(async () => (await gast()).opgeslagen.length > 0, 120_000, 'opslaan naar het nieuwe bestand');
  g = await gast();
  noteer(`3. na openen: tabblad "${await actieveTab(frame)}", opslaan ${JSON.stringify(g.opgeslagen)}`);
  eis(g.opgeslagen.every((o) => o.bestand === nieuw1), 'Ctrl+S ging niet naar het nieuwe bestand');
  const s3 = await soortenIn(await bewaardeBytes(page, nieuw1));
  eis(s3.soorten.filter((x) => x === '/Square').length === 2, 'de tweede rechthoek staat niet in het nieuwe bestand');

  // 4. Dezelfde naam nog eens in Project: "(2)", niets overschreven.
  await slaOpAlsVia(page, frame);
  await frame.locator('.host-save-as-item', { hasText: 'Project' }).click();
  await totDat(async () => (await items(frame)).some((t) => t === 'Plattegrond (copy).pdf'), 60_000, 'bestaand bestand in Project');
  await frame.fill('#host-save-as-naam', 'Plattegrond (copy)');
  await page.keyboard.press('Enter');
  const tekst4 = await totDat(() => keuzeTekst(frame), 120_000, 'keuze na hernoemen');
  g = await gast();
  noteer(`4. hernoemd: ${JSON.stringify(g.opgeslagenAls.at(-1))}; "${tekst4}"`);
  eis(g.opgeslagenAls.at(-1).definitief === 'Plattegrond (copy) (2).pdf', 'de host maakte geen (2)');
  eis(/already exists.*Plattegrond \(copy\) \(2\)\.pdf.*Nothing was overwritten/.test(tekst4), 'niet de melding over de hernoeming');
  await kies(frame, 'Keep editing the original');
  eis((await actieveTab(frame)) === 'Plattegrond (copy).pdf', 'het tabblad wisselde bij "verder met het origineel"');

  // 5. Archief weigert: melding en download.
  await slaOpAlsVia(page, frame);
  await frame.locator('.host-save-as-item', { hasText: 'Archief' }).click();
  await totDat(async () => (await frame.locator('.host-save-as-weg').innerText()).includes('Archief'), 60_000, 'map Archief open');
  await frame.locator('.host-save-as-dialog .modal-footer button', { hasText: /^Save$/ }).click();
  const tekst5 = await totDat(() => keuzeTekst(frame), 120_000, 'melding bij alleen-lezen map');
  noteer(`5. alleen-lezen map: "${tekst5}"`);
  eis(/do not have permission to save in this folder/.test(tekst5), 'niet de vertaalde melding bij alleen_lezen');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    kies(frame, 'Download instead'),
  ]);
  noteer(`   download "${download.suggestedFilename()}"`);
  eis(/\.pdf$/.test(download.suggestedFilename()), 'geen PDF-download na de weigering');
  const sDl = await soortenIn(fs.readFileSync(await download.path()));
  eis(sDl.soorten.includes('/Square'), 'de download mist de annotaties');

  // 6. Pagina's uitnemen (lint Organiseren) gaat ook naar de host, zonder download.
  const voorExport = (await gast()).opgeslagenAls.length;
  const downloadsVoor = downloads.length;
  await frame.locator('.ribbon-tab[role="tab"][data-tab="organize"]').click();
  await frame.locator('button#extract-pages').click();
  await frame.locator('.extract-pages-dialog .modal-footer button', { hasText: /^Extract$/ }).click();
  await totDat(() => dialoogOpen(frame), 120_000, 'dialoog Opslaan als bij uitnemen');
  const naam6 = await frame.inputValue('#host-save-as-naam');
  await frame.locator('.host-save-as-dialog .modal-footer button', { hasText: /^Save$/ }).click();
  await totDat(async () => (await gast()).opgeslagenAls.length > voorExport, 120_000, 'uitgenomen pagina\'s bij de host');
  const export6 = (await gast()).opgeslagenAls.at(-1);
  const meld6 = await totDat(() => melding(frame), 120_000, 'melding na de export');
  noteer(`6. uitnemen: naam "${naam6}", ${JSON.stringify(export6)}; "${meld6}"`);
  eis(/_extracted\.pdf$/.test(naam6) && export6.naam === naam6 && export6.map === null, 'uitnemen ging niet als nieuw bestand naar de host');
  eis((await soortenIn(await bewaardeBytes(page, export6.id))).paginas === 1, 'de uitgenomen PDF heeft niet 1 pagina');
  eis(/Saved as/.test(meld6), 'geen melding waar de export staat');
  eis(downloads.length === downloadsVoor, 'uitnemen gaf een download');
  await sluitMelding(frame);

  const overtredingen = await p.overtredingen();
  noteer(`8. CSP: ${overtredingen.length}, consolefouten: ${p.consolefouten.length}, paginafouten: ${p.paginafouten.length}`);
  eis(overtredingen.length === 0, `CSP-overtredingen: ${overtredingen.join(' | ')}`);
  eis(p.consolefouten.length === 0, `consolefouten: ${p.consolefouten.join(' | ')}`);
  eis(p.paginafouten.length === 0, `paginafouten: ${p.paginafouten.join(' | ')}`);
  await p.ctx.close();

  // ── 7. Zonder opslaan_als: een download, zoals altijd ────────────────────
  const q = await nieuweContext(browser, werkplek.APP, sriUrls(html, werkplek.bundelUrl), { acceptDownloads: true });
  await q.page.goto(werkplek.gastAdres());
  const frame2 = await appFrameVan(q.page);
  await wachtOpDocument(frame2, 'Plattegrond.pdf');
  // Zoals stap 1: een rechthoek, dan heeft de app de toetsenbordfocus.
  await frame2.locator('button.tp-btn[title="Rect"]').first().waitFor({ timeout: 120_000 });
  await tekenRechthoek(q.page, frame2);
  await q.page.keyboard.press('Escape');
  const [dl2] = await Promise.all([
    q.page.waitForEvent('download', { timeout: 120_000 }),
    q.page.keyboard.press('Control+Shift+S'),
  ]);
  noteer(`7. zonder opslaan_als: download "${dl2.suggestedFilename()}", dialoog: ${await dialoogOpen(frame2)}`);
  eis(dl2.suggestedFilename() === 'Plattegrond.pdf', 'zonder opslaan_als niet de oude download');
  eis(!(await dialoogOpen(frame2)), 'zonder opslaan_als toch de dialoog');
  eis(q.consolefouten.length === 0 && q.paginafouten.length === 0, `fouten zonder opslaan_als: ${[...q.consolefouten, ...q.paginafouten].join(' | ')}`);
  await q.ctx.close();
} catch (e) {
  fouten.push(String(e?.stack || e));
  console.error(e);
} finally {
  await browser.close();
  await werkplek.sluit();
}

if (fouten.length) {
  console.error(`\n${fouten.length} fout(en):\n- ${fouten.join('\n- ')}`);
  process.exit(1);
}
noteer('\nAlles in orde.');
