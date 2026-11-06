// Geen telemetrie en geen watermerk, controleerbaar (#629). Houdt PRIVACY.md
// in de hoofdmap eerlijk:
//
// 1. Elk internetadres in de meegeleverde bron (js/, src-tauri/src,
//    index.html, tauri.conf.json) staat in PRIVACY.md. Uitgezonderd zijn
//    adressen die alleen een naamruimte of schema aanduiden (XML-naamruimten,
//    kleurprofielen) en voorbeeldadressen uit tests (RFC 2606).
// 2. Geen telemetrie-, analyse- of foutrapportagepakket tussen de
//    afhankelijkheden van de app (npm en Rust).
// 3. Het statistiekscript van de website komt alleen in de publieke
//    webdeploy (live.yml), nooit in een bureaubladbouw of eigen webbundel.
// 4. Opslaan voegt niets toe aan de pagina's: geen watermerk, geen stempel,
//    geen tekst. Met de echte saver, zonder bewerking en met een nieuwe
//    annotatie.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, StandardFonts, decodePDFRawStream, rgb } from 'pdf-lib';
import { opslaan, laad } from '../pdf/rondgang.testhulp.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repo = path.resolve(app, '..');
const PRIVACY = fs.readFileSync(path.join(repo, 'PRIVACY.md'), 'utf8');

// ── 1. adressen in de bron ─────────────────────────────────────────────────

const OVERSLAAN = new Set(['node_modules', 'dist', 'target', 'gen', 'binaries', 'resources', 'icons']);

function bestanden(map, uit = []) {
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, e.name);
    if (e.isDirectory()) {
      if (!OVERSLAAN.has(e.name)) bestanden(p, uit);
    } else if (/\.(m?js|jsx|ts|tsx|rs)$/.test(e.name) && !/\.test\.|testhulp|\.spec\.|_tests?\.rs$/.test(e.name)) {
      uit.push(p);
    }
  }
  return uit;
}

const BRON = [
  ...bestanden(path.join(app, 'js')),
  ...bestanden(path.join(app, 'src-tauri', 'src')),
  path.join(app, 'index.html'),
  path.join(app, 'src-tauri', 'tauri.conf.json'),
];

/** Adressen die alleen iets aanduiden en nooit worden opgevraagd. */
function alleenAanduiding(host) {
  return /^(ns|schemas?)\./.test(host)
    || ['www.w3.org', 'purl.org', 'www.color.org', 'www.npes.org', 'www.aiim.org', 'www.xfa.org', 'schema.tauri.app'].includes(host)
    // RFC 2606: voorbeeldadressen in documentatie en ingebouwde tests.
    || /(^|\.)example\.(com|org|net)$/.test(host) || /\.(example|invalid|test)$/.test(host);
}

/** host -> bestanden waarin hij voorkomt */
function adressenInBron() {
  const hosts = new Map();
  for (const f of BRON) {
    const tekst = fs.readFileSync(f, 'utf8');
    for (const m of tekst.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}|localhost|127\.0\.0\.1)\b/gi)) {
      const host = m[1].toLowerCase();
      if (alleenAanduiding(host)) continue;
      if (!hosts.has(host)) hosts.set(host, new Set());
      hosts.get(host).add(path.relative(app, f).replace(/\\/g, '/'));
    }
  }
  return hosts;
}

/** De adressen die PRIVACY.md noemt (tussen backticks). */
const GENOEMD = new Set(
  [...PRIVACY.matchAll(/`([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}|localhost|127\.0\.0\.1)`/gi)].map((m) => m[1].toLowerCase()),
);

test('elk internetadres in de meegeleverde bron staat in PRIVACY.md', () => {
  const hosts = adressenInBron();
  assert.ok(hosts.has('api.github.com'), 'de scan vindt de adressen');
  const ontbreekt = [...hosts].filter(([h]) => !GENOEMD.has(h)).map(([h, f]) => `${h} (${[...f].join(', ')})`);
  assert.deepEqual(ontbreekt, [], 'adressen die PRIVACY.md niet noemt');
});

test('de scan slaat geen bronmap over die meegeleverd wordt', () => {
  assert.ok(BRON.length > 500, `${BRON.length} bronbestanden`);
  assert.ok(BRON.some((f) => f.endsWith(path.join('solid', 'components', 'dialogs', 'FeedbackDialog.jsx'))));
  assert.ok(BRON.some((f) => f.endsWith(path.join('src-tauri', 'src', 'lib.rs'))));
});

// ── 2. afhankelijkheden ───────────────────────────────────────────────────

const TELEMETRIE = /sentry|posthog|mixpanel|amplitude|segment|analytics|telemetr|aptabase|datadog|bugsnag|rollbar|newrelic|new-relic|appinsights|applicationinsights|matomo|plausible|umami|gtag|hotjar|logrocket|fullstory|firebase|honeybadger|raygun|countly/i;

test('geen telemetrie- of analysepakket tussen de npm-afhankelijkheden', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  const namen = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
  assert.deepEqual(namen.filter((n) => TELEMETRIE.test(n)), []);
});

test('geen telemetrie- of analysekrat tussen de Rust-afhankelijkheden', () => {
  const kratten = ['open-pdf-studio/src-tauri', 'pdfium-worker', 'open-pdf-thumbnails', 'open-pdf-render', 'open-pdf-cad',
    'open-pdf-cmyk', 'open-pdf-signatures', 'open-pdf-security'];
  for (const krat of kratten) {
    const toml = fs.readFileSync(path.join(repo, krat, 'Cargo.toml'), 'utf8');
    const namen = [...toml.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]);
    assert.deepEqual(namen.filter((n) => TELEMETRIE.test(n)), [], `${krat}/Cargo.toml`);
  }
});

test('de meegeleverde bron laadt geen analysescript en stuurt geen bakens', () => {
  const treffers = [];
  for (const f of BRON) {
    const tekst = fs.readFileSync(f, 'utf8');
    if (/sendBeacon\s*\(|\bgtag\s*\(|analytics\.js|googletagmanager|google-analytics/.test(tekst)) treffers.push(path.relative(app, f));
  }
  assert.deepEqual(treffers, []);
});

// ── 3. het statistiekscript van de website ─────────────────────────────────

test('het statistiekscript komt alleen in de publieke webdeploy', () => {
  const workflows = path.join(repo, '.github', 'workflows');
  const gebruikers = fs.readdirSync(workflows)
    .filter((n) => fs.readFileSync(path.join(workflows, n), 'utf8').includes('web-statistics'));
  assert.deepEqual(gebruikers, ['live.yml']);

  const pkg = fs.readFileSync(path.join(app, 'package.json'), 'utf8');
  assert.ok(!pkg.includes('web-statistics'), 'geen npm-script voegt het toe');
  const conf = JSON.parse(fs.readFileSync(path.join(app, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.ok(!JSON.stringify(conf.build || {}).includes('web-statistics'), 'de Tauri-bouw voegt het niet toe');
  for (const s of ['pak-webbundel.mjs', 'draagbare-zip.mjs', 'webbundel.mjs']) {
    const p = path.join(app, 'scripts', s);
    if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'utf8').includes('web-statistics'), s);
  }
  assert.ok(!/analytics/i.test(fs.readFileSync(path.join(app, 'index.html'), 'utf8')), 'index.html laadt niets');
});

// ── 4. geen watermerk bij opslaan ─────────────────────────────────────────

async function bronMetTweeBladen() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [n, tekst] of [[1, 'Plattegrond begane grond'], [2, 'Doorsnede A-A']]) {
    const blad = doc.addPage([842, 595]);
    blad.drawText(tekst, { x: 60, y: 520, size: 18, font });
    blad.drawRectangle({ x: 60, y: 80, width: 700, height: 400, borderColor: rgb(0, 0, 0), borderWidth: n });
  }
  return doc.save();
}

/** Per blad: de gedecodeerde inhoud, de bronnen en de annotatiesoorten. */
async function bladen(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const inhoud = (blad) => {
    const c = blad.node.get(PDFName.of('Contents'));
    const delen = ctx.lookup(c) instanceof PDFArray ? ctx.lookup(c).asArray() : [c];
    return delen.map((r) => {
      const s = ctx.lookup(r);
      return Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString('latin1');
    }).join('\n');
  };
  const bronnen = (blad) => {
    const res = ctx.lookup(blad.node.get(PDFName.of('Resources')));
    const uit = {};
    for (const [k, v] of res.entries()) {
      const w = ctx.lookup(v);
      uit[k.asString()] = w?.keys ? w.keys().map((x) => x.asString()).sort() : String(w);
    }
    return uit;
  };
  const soorten = (blad) => (blad.node.Annots()?.asArray() || [])
    .map((r) => ctx.lookup(r).get(PDFName.of('Subtype'))?.asString());
  return doc.getPages().map((blad) => ({ inhoud: inhoud(blad), bronnen: bronnen(blad), annotaties: soorten(blad) }));
}

async function paginatekst(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const uit = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    uit.push(tc.items.map((i) => i.str).join(' ').trim());
  }
  await doc.loadingTask.destroy();
  return uit;
}

test('opslaan zonder bewerking laat elke pagina ongemoeid', async () => {
  const bron = await bronMetTweeBladen();
  const uit = await opslaan(bron, await laad(bron));
  assert.deepEqual(await bladen(uit), await bladen(bron));
  assert.deepEqual(await paginatekst(uit), ['Plattegrond begane grond', 'Doorsnede A-A']);
});

test('opslaan met een nieuwe annotatie voegt alleen die annotatie toe, geen watermerk', async () => {
  const bron = await bronMetTweeBladen();
  const modellen = await laad(bron);
  modellen.push({
    id: 'nieuw', page: 1, type: 'box', x: 100, y: 120, width: 160, height: 90, rotation: 0,
    color: '#ff0000', strokeColor: '#ff0000', fillColor: null, lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'Tester',
  });
  const uit = await opslaan(bron, modellen);
  const voor = await bladen(bron);
  const na = await bladen(uit);
  assert.equal(na.length, voor.length, 'geen blad erbij');
  for (let i = 0; i < voor.length; i++) {
    assert.equal(na[i].inhoud, voor[i].inhoud, `blad ${i + 1}: de pagina-inhoud is dezelfde`);
    assert.deepEqual(na[i].bronnen, voor[i].bronnen, `blad ${i + 1}: geen lettertype of afbeelding erbij`);
  }
  assert.deepEqual(na[0].annotaties, ['/Square']);
  assert.deepEqual(na[1].annotaties, []);
  assert.deepEqual(await paginatekst(uit), ['Plattegrond begane grond', 'Doorsnede A-A']);
});
