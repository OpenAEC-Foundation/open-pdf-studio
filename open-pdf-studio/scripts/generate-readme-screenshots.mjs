#!/usr/bin/env node
// Schermafbeeldingen voor README.md en README.nl.md, opnieuw te maken met één
// commando (vanuit open-pdf-studio/):
//
//   node scripts/generate-readme-screenshots.mjs                 # alle beelden
//   node scripts/generate-readme-screenshots.mjs --only hero,compare
//   node scripts/generate-readme-screenshots.mjs --dist <map>     # bestaande webbouw gebruiken
//
// Wat het doet:
//  1. bouwt de webversie (`OPDS_WEB_BUILD=1 vite build`, zoals de website in
//     .github/workflows/live.yml) in een tijdelijke map, tenzij --dist een
//     bestaande bouw aanwijst;
//  2. maakt de demo-PDF's met pdf-lib (scripts/readme-demo-pdfs.mjs): geen
//     tekening van een klant of project, alles vrij te verspreiden;
//  3. serveert de bouw op 127.0.0.1 op een vrije poort (scripts/gehost-proef.mjs)
//     en bedient de app in headless Chromium (1600x900, schaal 1, Engels) met
//     echte muis- en toetsgebeurtenissen: PDF openen via de bestandskiezer,
//     lintknoppen, slepen op de pagina;
//  4. schrijft ../docs/images/readme/<naam>.png en comprimeert met sharp tot
//     hoogstens 150 kB (palet-PNG; minder kleuren tot het past).
//
// Alles wat het start (server, browser, tijdelijke mappen) ruimt het op. Er
// gaat geen venster open. Een stap die mislukt, noemt zijn naam; de andere
// beelden lopen door. Exitcode 1 als er één mislukte.
//
// De webversie mist wat de bureaubladschil doet (afdrukken, OCR, CAD in- en
// uitvoer, handtekeningcontrole; js/core/webfuncties.js). Daarom tonen de
// beelden markeren, meten, vergelijken, symbolen, pagina's ordenen, zoeken en
// de gesplitste weergave. Nodig: de Chromium van Playwright (npx playwright install chromium).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { startServer } from './gehost-proef.mjs';
import { maakDemoPdfs } from './readme-demo-pdfs.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(APP, '..');
const UIT = path.join(REPO, 'docs', 'images', 'readme');
const VIEWPORT = { width: 1600, height: 900 };
// Ruim onder de 150 kB van de README-standaard (ook als je kB als 1000 bytes leest).
const MAX_BYTES = 145 * 1000;
// Plattegrond in readme-demo-pdfs.mjs: A3 liggend, 1:50, oorsprong (90, 150) pt.
const A3 = { w: 1190.55, h: 841.89 };
const PT_PER_M = (1000 / 50) * (72 / 25.4);
const OORSPRONG = { x: 90, y: 150 };

const argv = process.argv.slice(2);
const waarde = (naam) => {
  const i = argv.indexOf(naam);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${naam}=`));
  return eq ? eq.slice(naam.length + 1) : undefined;
};
const alleen = waarde('--only')?.split(',').filter(Boolean) ?? null;
const bestaandeDist = waarde('--dist');

// ── webbouw ───────────────────────────────────────────────────────────────────

function bouwWeb(doel) {
  const vite = path.join(APP, 'node_modules', 'vite', 'bin', 'vite.js');
  console.log('building the web version …');
  const r = spawnSync(process.execPath, [vite, 'build', '--outDir', doel, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: APP,
    stdio: 'inherit',
    env: { ...process.env, OPDS_WEB_BUILD: '1' },
  });
  if (r.status !== 0) throw new Error(`vite build failed (exit ${r.status})`);
}

// ── hulpjes voor de app ───────────────────────────────────────────────────────

const pauze = (page, ms) => page.waitForTimeout(ms);

/** Nieuwe context met voorkeuren die de app bij het starten leest. */
async function nieuwePagina(browser, origin, voorkeuren = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light' });
  const prefs = JSON.stringify({
    theme: 'light',
    language: 'en',
    authorName: 'Reviewer',
    symbolPaletteVisible: false,
    ...voorkeuren,
  });
  await context.addInitScript((p) => {
    try { localStorage.setItem('opds:pdfEditorPreferences', p); } catch { /* geen opslag: standaardwaarden */ }
  }, prefs);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`  page error: ${String(e.message).slice(0, 200)}`));
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await page.waitForSelector('#tool-select', { timeout: 60000 });
  await pauze(page, 800);
  return { context, page };
}

/** Open een PDF zoals een gebruiker: de knop Openen en de bestandskiezer. */
async function openPdf(page, bestand) {
  const tabs = await page.locator('.document-tab').count().catch(() => 0);
  const [kiezer] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 30000 }),
    page.click('.quick-access-toolbar .quick-access-btn >> nth=0'),
  ]);
  await kiezer.setFiles(bestand);
  await page.waitForFunction((n) => {
    const c = document.querySelector('canvas#pdf-canvas');
    return c && c.width > 300 && document.querySelectorAll('.document-tab').length >= n;
  }, tabs + 1, { timeout: 60000 });
  await pauze(page, 1800);
}

const lint = async (page, tab) => {
  await page.click(`.ribbon-tab[data-tab="${tab}"]`);
  await pauze(page, 300);
};

const pasPaginaIn = async (page) => {
  await lint(page, 'home');
  await page.getByRole('button', { name: /^Fit Page/ }).first().click();
  await pauze(page, 1200);
};

/** Zoom via het invoerveld in de statusbalk en schuif een punt van de plattegrond naar het midden. */
async function zoomOp(page, procent, midden) {
  const veld = page.locator('.status-zoom-input');
  await veld.click();
  await veld.fill(String(procent));
  await veld.press('Enter');
  await pauze(page, 1200);
  // Schuif met het handgereedschap (de weergave heeft eigen schuifbalken,
  // geen gewone scroll): sleep het punt naar het midden van het canvasvak.
  const vak = await page.locator('.canvas-scroll-host, #pdf-container, .pdf-container').first().boundingBox().catch(() => null)
    ?? { x: 285, y: 180, width: 1015, height: 697 };
  const doel = { x: vak.x + vak.width / 2, y: vak.y + vak.height / 2 };
  await lint(page, 'home');
  await page.getByRole('button', { name: /^Hand/ }).first().click();
  // In stappen: begin- en eindpunt van elke sleep moeten binnen het canvasvak liggen.
  for (let i = 0; i < 5; i++) {
    const p = await opPlan(page, ...midden);
    const klem = (d, max) => Math.max(-max, Math.min(max, d));
    const stap = { x: klem(doel.x - p.x, vak.width / 2 - 30), y: klem(doel.y - p.y, vak.height / 2 - 30) };
    if (Math.abs(stap.x) < 4 && Math.abs(stap.y) < 4) break;
    await sleep(page, { x: doel.x - stap.x, y: doel.y - stap.y }, doel, 12);
    await pauze(page, 300);
  }
  await page.getByRole('button', { name: /^Select/ }).first().click();
  // Het zoomveld kan de pagina een paar pixels laten verschuiven; zet dat terug.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll('html, body, #app-root, #app-root > *')) el.scrollTop = 0;
  });
  await pauze(page, 800);
}

/** Schermpunt van een punt op de plattegrond, in meters vanaf de buitenhoek. */
async function opPlan(page, mx, my) {
  const r = await page.locator('canvas#pdf-canvas').boundingBox();
  const xpt = OORSPRONG.x + mx * PT_PER_M;
  const ypt = OORSPRONG.y + my * PT_PER_M;
  return { x: r.x + (xpt / A3.w) * r.width, y: r.y + ((A3.h - ypt) / A3.h) * r.height };
}

async function sleep(page, a, b, stappen = 10) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= stappen; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / stappen, a.y + ((b.y - a.y) * i) / stappen);
  await page.mouse.up();
  await pauze(page, 400);
}

async function klik(page, p) {
  await page.mouse.move(p.x, p.y);
  await pauze(page, 60);
  await page.mouse.click(p.x, p.y);
  await pauze(page, 180);
}

async function sleepOpPlan(page, a, b) {
  await sleep(page, await opPlan(page, ...a), await opPlan(page, ...b));
}

/** Een veelhoek klik voor klik, afgesloten met Enter. */
async function veelhoek(page, punten) {
  for (const p of punten) await klik(page, await opPlan(page, ...p));
  await page.keyboard.press('Enter');
  await pauze(page, 400);
}

/** Maatlijn: begin, eind, dan de plaats van de maatlijn (drie klikken). */
async function maat(page, a, b, c) {
  for (const p of [a, b, c]) await klik(page, await opPlan(page, ...p));
  await pauze(page, 300);
}

/** Klik op een leeg stuk papier (buiten de plattegrond) om selecties en editors te sluiten. */
async function klikLeeg(page) {
  await klik(page, await opPlan(page, 3, -2.6));
}

/** Tekstballon: slepen van de pijlpunt naar het tekstvak, dan de tekst typen. */
async function tekstballon(page, punt, vak, tekst) {
  await lint(page, 'comment');
  await page.click('#tool-callout');
  await sleepOpPlan(page, punt, vak);
  await pauze(page, 500);
  // Na het slepen staat de teksteditor meestal al open; anders dubbelklikken op het vak.
  const open = await page.evaluate(() => document.activeElement?.classList.contains('inline-text-editor'));
  if (!open) {
    const midden = await opPlan(page, vak[0] + 1.1, vak[1]);
    await page.mouse.dblclick(midden.x, midden.y);
    await pauze(page, 400);
  }
  await page.keyboard.type(tekst, { delay: 5 });
  await pauze(page, 200);
  // Esc sluit de editor en bewaart de tekst (#951); V kiest het selectiegereedschap.
  await page.keyboard.press('Escape');
  await pauze(page, 300);
  await page.keyboard.press('v');
  await pauze(page, 300);
}

// ── de beelden ────────────────────────────────────────────────────────────────

const BEELDEN = {
  // Markeren op een tekening: wolk, tekstballon, stempel en een maat, met het
  // contextuele lintblad Format en het eigenschappenpaneel van de selectie.
  hero: {
    voorkeuren: { calloutFontSize: 14, calloutBorderWidth: 2, cloudLineWidth: 3, enableObjectSnap: false, snapToPdfContent: false },
    async stappen(page, pdf) {
      await openPdf(page, pdf['floor-plan-rev-a.pdf']);
      await pasPaginaIn(page);
      // Ingezoomd: de tekst van de tekstballon is dan leesbaar.
      await zoomOp(page, 75, [11.2, 5.0]);
      await lint(page, 'drawing');
      await page.click('#dr-cloud');
      await sleepOpPlan(page, [9.4, 4.9], [13.8, 8.8]);
      await page.keyboard.press('Escape');
      await lint(page, 'comment');
      await page.click('#tool-measure-distance');
      await maat(page, [9.6, 5.6], [13.7, 5.6], [11.65, 5.6]);
      await page.keyboard.press('Escape');
      // De punt net buiten de buitenmuur: binnen de viewport van de tekening
      // krijgt een nieuwe tekstballon een vaste tekstgrootte (8 pt).
      await tekstballon(page, [14.08, 7.6], [16.0, 5.0], 'Bathroom too narrow: move wall 600 mm');
      // Selecteer de tekstballon: lintblad Format en eigenschappen verschijnen.
      await klik(page, await opPlan(page, 16.0, 5.0));
      await pauze(page, 600);
    },
  },

  // Meten met de schaal die de tekening zelf meedraagt (/VP met /Measure).
  measure: {
    voorkeuren: { theme: 'default', propertiesPanelVisible: false, leftPanelCollapsed: true, enableObjectSnap: false, snapToPdfContent: false },
    async stappen(page, pdf) {
      await openPdf(page, pdf['floor-plan-rev-a.pdf']);
      await pasPaginaIn(page);
      await lint(page, 'comment');
      await page.click('#tool-measure-area');
      await veelhoek(page, [[5.1, 0.3], [13.7, 0.3], [13.7, 5.0], [5.1, 5.0]]);
      await page.keyboard.press('Escape');
      await page.click('#tool-measure-perimeter');
      await veelhoek(page, [[0.3, 5.6], [5.0, 5.6], [5.0, 8.7], [0.3, 8.7], [0.3, 5.6]]);
      await page.keyboard.press('Escape');
      await page.click('#tool-measure-distance');
      await maat(page, [0.3, 1.6], [5.0, 1.6], [2.65, 1.2]);
      await maat(page, [3.6, 0.3], [3.6, 5.5], [4.2, 2.9]);
      await page.keyboard.press('Escape');
      await klikLeeg(page);
    },
  },

  // Twee revisies over elkaar, met de lijst van wijzigingen.
  compare: {
    voorkeuren: { leftPanelCollapsed: true, toolPaletteVisible: false, propertiesPanelVisible: false },
    async stappen(page, pdf) {
      await openPdf(page, pdf['floor-plan-rev-a.pdf']);
      await openPdf(page, pdf['floor-plan-rev-b.pdf']);
      await lint(page, 'view');
      await page.click('#ribbon-compare');
      await pauze(page, 800);
      await page.locator('.cmp-mode-title', { hasText: 'Overlay' }).click();
      await page.click('.cmp-dialog-footer .pref-btn-primary');
      await page.waitForSelector('text=Exit Compare', { timeout: 60000 });
      await pauze(page, 5000);
      await page.getByRole('button', { name: 'Fit', exact: true }).first().click();
      await pauze(page, 2500);
    },
  },

  // Symbolen uit het palet op de plattegrond.
  symbols: {
    voorkeuren: { symbolPaletteVisible: true, propertiesPanelVisible: false },
    async stappen(page, pdf) {
      await openPdf(page, pdf['floor-plan-rev-a.pdf']);
      await pasPaginaIn(page);
      // Symboolschaal 1x: annotatiesymbolen komen op een vaste papiermaat
      // binnen, los van de tekeningschaal (#983).
      const schaal = page.locator('#sp-scale-input');
      await schaal.click();
      await schaal.fill('1');
      await schaal.press('Enter');
      await pauze(page, 300);
      await page.locator('.sp-cat-header', { hasText: 'Fire Protection' }).click();
      await pauze(page, 600);
      const knoppen = page.locator('.sp-grid').first().locator('.sp-symbol-btn');
      // [symbool, x, y] in meters op de plattegrond.
      // Knoppen in het palet: 1 = brandblusser, 2 = brandslanghaspel, 3 = handmelder.
      const plaatsing = [
        [1, 0.8, 1.0], [1, 5.6, 4.3], [1, 9.9, 5.7],
        [2, 4.5, 5.0],
        [3, 1.7, 0.8], [3, 13.2, 0.8], [3, 5.6, 8.3],
      ];
      for (const [i, x, y] of plaatsing) {
        await knoppen.nth(i).click();
        await pauze(page, 150);
        await klik(page, await opPlan(page, x, y));
        await pauze(page, 250);
      }
      await page.keyboard.press('Escape');
      await klikLeeg(page);
      await page.locator('.sp-cat-header', { hasText: 'Fire Protection' }).scrollIntoViewIfNeeded();
    },
  },

  // Pagina's ordenen: het venster Edit Pages met de hele set.
  pages: {
    voorkeuren: {},
    async stappen(page, pdf) {
      await openPdf(page, pdf['demo-house-set.pdf']);
      await lint(page, 'organize');
      await page.click('#edit-pages');
      await pauze(page, 2500);
      const groter = page.locator('button', { hasText: /^\+$/ }).last();
      for (let i = 0; i < 4; i++) { await groter.click().catch(() => {}); await pauze(page, 250); }
      await pauze(page, 2000);
    },
  },

  // Zoeken in tekst en markeringen, thema Dark.
  search: {
    voorkeuren: { theme: 'dark' },
    async stappen(page, pdf) {
      await openPdf(page, pdf['demo-house-set.pdf']);
      await page.keyboard.press('Control+f');
      await pauze(page, 400);
      await page.keyboard.type('wall');
      await page.keyboard.press('Enter');
      await pauze(page, 3000);
    },
  },

  // Gesplitste weergave: plattegrond links, bestek rechts, thema Blue.
  split: {
    voorkeuren: { theme: 'blue', leftPanelCollapsed: true, propertiesPanelVisible: false },
    async stappen(page, pdf) {
      await openPdf(page, pdf['demo-house-set.pdf']);
      await lint(page, 'view');
      await page.locator('#split-view-btn button').first().click();
      await pauze(page, 2000);
      // Linkerpaneel: pagina 2 (plattegrond); rechterpaneel: pagina 4 (bestek).
      await klik(page, { x: 400, y: 700 });
      await lint(page, 'home');
      await page.click('#next-page-ribbon');
      await pauze(page, 800);
      await page.click('#fit-page-ribbon');
      await pauze(page, 1200);
      await klik(page, { x: 1000, y: 700 });
      for (let i = 0; i < 3; i++) { await page.click('#next-page-ribbon'); await pauze(page, 600); }
      await page.click('#fit-page-ribbon');
      await pauze(page, 1500);
      await lint(page, 'view');
    },
  },
};

// ── PNG ───────────────────────────────────────────────────────────────────────

/** Comprimeer tot hoogstens MAX_BYTES: eerst verliesloos, dan een palet met steeds minder kleuren. */
async function comprimeer(ruw, doel) {
  let beste = await sharp(ruw).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  for (const kleuren of [256, 192, 128, 96, 64, 48, 32]) {
    if (beste.length <= MAX_BYTES) break;
    beste = await sharp(ruw).png({ compressionLevel: 9, palette: true, colors: kleuren, dither: 0, effort: 10 }).toBuffer();
  }
  fs.writeFileSync(doel, beste);
  return beste.length;
}

// ── hoofdprogramma ────────────────────────────────────────────────────────────

const tijdelijk = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-readme-'));
const mislukt = [];
let server;
let browser;
try {
  const dist = bestaandeDist ? path.resolve(bestaandeDist) : path.join(tijdelijk, 'web');
  if (!bestaandeDist) bouwWeb(dist);
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`no index.html in ${dist}`);

  const pdf = {};
  for (const [naam, bytes] of Object.entries(await maakDemoPdfs())) {
    pdf[naam] = path.join(tijdelijk, naam);
    fs.writeFileSync(pdf[naam], bytes);
  }

  fs.mkdirSync(UIT, { recursive: true });
  server = await startServer({ '/': dist });
  browser = await chromium.launch({ headless: true });
  for (const naam of alleen ?? Object.keys(BEELDEN)) {
    const beeld = BEELDEN[naam];
    if (!beeld) { mislukt.push(`${naam}: unknown image`); continue; }
    const { context, page } = await nieuwePagina(browser, server.origin, beeld.voorkeuren);
    try {
      await beeld.stappen(page, pdf);
      await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2);
      await pauze(page, 300);
      const doel = path.join(UIT, `${naam}.png`);
      const grootte = await comprimeer(await page.screenshot(), doel);
      console.log(`ok  ${naam}.png  ${(grootte / 1024).toFixed(0)} kB`);
    } catch (e) {
      const bericht = e instanceof Error ? e.message.split('\n')[0] : String(e);
      mislukt.push(`${naam}: ${bericht}`);
      console.error(`XX  ${naam}: ${bericht}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `opds-readme-fail-${naam}.png`) }).catch(() => {});
    } finally {
      await context.close();
    }
  }
} catch (e) {
  mislukt.push(e instanceof Error ? e.message : String(e));
  console.error(e);
} finally {
  await browser?.close();
  await server?.sluit();
  fs.rmSync(tijdelijk, { recursive: true, force: true });
}

if (mislukt.length) {
  console.error(`\n${mislukt.length} failed:\n- ${mislukt.join('\n- ')}`);
  process.exit(1);
}
console.log(`\ndone: ${path.relative(REPO, UIT)}`);
