// Controle van het release-archief van de gehoste bundel (#692), zoals een
// platform het gebruikt: hash nagaan, uitpakken, serveren.
//
//   npm run verify:hosted-bundle -- [archief.tar.gz] [--poort 3591] [--no-tag-check]
//
// Zonder archief neemt hij het nieuwste uit dist-webbundel/ (npm run
// pack:hosted). Wat er gecontroleerd wordt:
//  1. het .sha256-bestand klopt met het archief;
//  2. het archief bevat alleen gewone bestanden met veilige paden, en elk
//     bestand klopt met MANIFEST.sha256 (niets ontbreekt, niets extra);
//  3. bron.json noemt versie, tag, commit en licentie (en de commit van de
//     tag, als die tag hier bekend is; --no-tag-check slaat dat over voor
//     een proefbouw waarvan de versie al getagd is);
//  4. uitgepakt onder twee subpaden (/pdf/ en /tools/pdf/) opent de app in
//     headless Chromium een PDF met standaardfonts en een CJK-CMap, tekent
//     alle tekst, en gaat geen enkel verzoek buiten zijn eigen map;
//  5. index.html heeft geen inline code en SRI op elk script en stylesheet
//     (#693);
//  6. geen bestand (ook de derdenvermeldingen niet) bevat code of de naam
//     van een desktop-pakket zoals de sleepplugin (#776).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BRON, LICENTIE, NOTICES, controleerManifest, leesTar, pakUit, sha256, zoekDesktopCode } from './webbundel.mjs';
import { inktPerBand, maakProefPdf, openPdfInApp, startServer } from './gehost-proef.mjs';
import { controleerIndexHtml } from './gehost-html.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUBPADEN = ['/pdf/', '/tools/pdf/'];

function leesArgs(argv) {
  const args = { poort: 3591, tagControle: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--poort') args.poort = Number(argv[++i]);
    else if (argv[i] === '--no-tag-check') args.tagControle = false;
    else args.archief = argv[i];
  }
  return args;
}

function nieuwsteArchief() {
  const map = path.join(APP, 'dist-webbundel');
  const kandidaten = fs.existsSync(map)
    ? fs.readdirSync(map).filter((n) => n.endsWith('.tar.gz')).map((n) => path.join(map, n))
    : [];
  if (!kandidaten.length) throw new Error('No archive given and none in dist-webbundel/ (run npm run pack:hosted)');
  return kandidaten.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

const fouten = [];
const eis = (ok, bericht) => { if (!ok) fouten.push(bericht); return ok; };
const meld = (s) => console.log(s);

async function controleerInBrowser(browser, origin, sub, pdfPad) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
  const verzoeken = [];
  const antwoorden = new Map();
  ctx.on('request', (r) => verzoeken.push(r.url()));
  ctx.on('response', (r) => antwoorden.set(r.url(), r.status()));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fouten.push(`${sub}: page error: ${String(e.message).slice(0, 200)}`));
  try {
    await page.goto(`${origin}${sub}`, { waitUntil: 'load', timeout: 60000 });
    await openPdfInApp(page, pdfPad);
    const inkt = await inktPerBand(page);
    for (const [band, n] of Object.entries(inkt)) eis(n > 50, `${sub}: no ink in band ${band} (${n})`);
    meld(`  ${sub}: drawn (ink per band ${JSON.stringify(inkt)})`);

    const eigen = `${origin}${sub}`;
    const buiten = verzoeken.filter((u) => !u.startsWith(eigen) && !/^(data|blob):/.test(u));
    eis(buiten.length === 0, `${sub}: requests outside ${eigen}:\n    ${buiten.join('\n    ')}`);
    const nodig = ['pdfjs/web/cmaps/UniJIS-UCS2-H.bcmap', 'pdfjs/web/standard_fonts/FoxitSymbol.pfb', 'pdfjs/web/standard_fonts/FoxitDingbats.pfb'];
    for (const n of nodig) eis(antwoorden.get(`${eigen}${n}`) === 200, `${sub}: ${n} not loaded (${antwoorden.get(`${eigen}${n}`) ?? 'not requested'})`);
    const mislukt = [...antwoorden].filter(([, s]) => s >= 400);
    eis(mislukt.length === 0, `${sub}: failed responses: ${mislukt.map(([u, s]) => `${s} ${u}`).join(', ')}`);
    meld(`  ${sub}: ${verzoeken.length} requests, ${buiten.length} outside its folder`);
  } finally {
    await ctx.close();
  }
}

async function hoofd() {
  const args = leesArgs(process.argv.slice(2));
  const archief = path.resolve(args.archief || nieuwsteArchief());
  const naam = path.basename(archief);
  meld(`Archive ${archief}`);

  // 1. Hash van het archief.
  const bytes = fs.readFileSync(archief);
  const hashBestand = `${archief}.sha256`;
  if (eis(fs.existsSync(hashBestand), `missing ${path.basename(hashBestand)}`)) {
    const [hash, bestand] = fs.readFileSync(hashBestand, 'utf8').trim().split(/\s+\*?/);
    eis(bestand === naam, `.sha256 names ${bestand}, not ${naam}`);
    eis(hash === sha256(bytes), '.sha256 does not match the archive');
    meld(`  sha256 ${hash}`);
  }

  // 2. Uitpakken onder twee subpaden en het manifest nalopen.
  const items = leesTar(gunzipSync(bytes));
  const wortel = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-webbundel-controle-'));
  const mappen = {};
  for (const sub of SUBPADEN) {
    mappen[sub] = path.join(wortel, ...sub.split('/').filter(Boolean));
    pakUit(items, mappen[sub]);
  }
  const map = mappen[SUBPADEN[0]];
  const manifestFouten = controleerManifest(map);
  eis(manifestFouten.length === 0, `manifest: ${manifestFouten.join(', ')}`);
  meld(`  ${items.length} files, manifest ${manifestFouten.length ? 'WRONG' : 'ok'}`);
  if (eis(fs.existsSync(path.join(map, 'index.html')), 'index.html missing')) {
    const htmlFouten = controleerIndexHtml(fs.readFileSync(path.join(map, 'index.html'), 'utf8'),
      (rel) => fs.readFileSync(path.join(map, ...rel.split('/'))));
    eis(htmlFouten.length === 0, `index.html: ${htmlFouten.join('; ')}`);
    meld(`  index.html: ${htmlFouten.length ? 'NOT CSP-ready' : 'no inline code, SRI on every script and stylesheet'}`);
  }
  eis(fs.existsSync(path.join(map, NOTICES)) && fs.statSync(path.join(map, NOTICES)).size > 1000, `${NOTICES} missing or empty`);
  const desktop = zoekDesktopCode(items);
  eis(desktop.length === 0, `desktop-only code in the bundle: ${desktop.map((t) => `${t.pad} (${t.kenmerk})`).join(', ')}`);
  meld(`  desktop-only packages: ${desktop.length ? `FOUND in ${desktop.length} file(s)` : 'none'}`);

  // 3. bron.json.
  const bron = JSON.parse(fs.readFileSync(path.join(map, BRON), 'utf8'));
  eis(naam === `open-pdf-studio-web-${bron.versie}.tar.gz`, `bron.json version ${bron.versie} does not match ${naam}`);
  eis(bron.tag === `v${bron.versie}`, `bron.json tag ${bron.tag} does not match version ${bron.versie}`);
  eis(/^[0-9a-f]{40}$/.test(bron.commit), `bron.json commit ${bron.commit} is not a full hash`);
  eis(bron.licentie === LICENTIE, `bron.json licence ${bron.licentie}`);
  eis(typeof bron.broncode === 'string' && bron.broncode.includes(bron.commit), 'bron.json broncode does not name the commit');
  if (!args.tagControle) {
    meld(`  bron.json: ${bron.tag} = ${bron.commit} (tag check skipped)`);
  } else try {
    const tagCommit = execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${bron.tag}^{commit}`], { cwd: APP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    eis(tagCommit === bron.commit, `tag ${bron.tag} points to ${tagCommit}, bron.json says ${bron.commit}`);
    meld(`  bron.json: ${bron.tag} = ${bron.commit} (matches the tag)`);
  } catch {
    meld(`  bron.json: ${bron.tag} = ${bron.commit} (tag not known here)`);
  }

  // 4. In de browser, onder beide subpaden.
  const pdfPad = path.join(wortel, 'proef.pdf');
  fs.writeFileSync(pdfPad, await maakProefPdf());
  const server = await startServer(mappen, { poort: args.poort });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const sub of SUBPADEN) await controleerInBrowser(browser, server.origin, sub, pdfPad);
    const fout = server.verzoeken.filter((v) => !SUBPADEN.some((s) => v.url.startsWith(s)));
    eis(fout.length === 0, `server saw requests outside the bundle folders: ${fout.map((v) => v.url).join(', ')}`);
  } finally {
    await browser.close();
    await server.sluit();
    fs.rmSync(wortel, { recursive: true, force: true });
  }

  if (fouten.length) {
    console.error(`\nFAILED (${fouten.length}):\n  ${fouten.join('\n  ')}`);
    process.exit(1);
  }
  meld('\nOK: archive, manifest, bron.json and both sub-paths');
}

hoofd().catch((e) => {
  console.error(e);
  process.exit(1);
});
