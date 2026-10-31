// De tabel met functies zonder webvariant, en de ene melding die erbij hoort.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = {};

const {
  BUREAUBLAD_KNOPPEN,
  EXTERNE_DIENSTEN,
  MELDING_SLEUTEL,
  bureaubladFunctie,
  externeDienst,
  externeDienstenAan,
  knopUit,
  knopUitInBrowser,
  meldingTekst,
  vangAlleenBureaublad,
} = await import('./webfuncties.js');
const { NietInBrowserError } = await import('./platform.js');

test('elke functie zonder webvariant heeft een knop in de tabel', () => {
  const functies = new Set(Object.values(BUREAUBLAD_KNOPPEN));
  for (const f of ['print', 'ocr', 'cadImport', 'cadExport',
    'compress', 'pdfx', 'protectPdf', 'ifc', 'plugins', 'updater', 'mcp']) {
    assert.ok(functies.has(f), `geen knop gekoppeld aan "${f}"`);
  }
});

test('een knop uit de tabel staat uit in de browser en aan op het bureaublad', () => {
  for (const id of Object.keys(BUREAUBLAD_KNOPPEN)) {
    assert.equal(knopUitInBrowser(id, false), true, `id ${id} hoort uit te staan`);
    assert.equal(knopUitInBrowser(id, true), false, `id ${id} hoort op het bureaublad aan te staan`);
  }
  assert.equal(bureaubladFunctie('ep-ocr'), 'ocr');
});

test('wat in de browser wél werkt blijft aan', () => {
  // Bijlagen (download + <input type=file>), het handtekening-gereedschap
  // (tekenen is gewoon JS) en schermafdrukken (navigator.clipboard) hebben
  // een werkende webweg; die uitschakelen zou een achteruitgang zijn.
  for (const id of ['tool-signature', 'panel-attachments', 'menu-annotate-screenshot',
    'rotate-left', 'tool-select', undefined, null, '', 'toString']) {
    assert.equal(knopUitInBrowser(id, false), false, `id ${id}`);
    assert.equal(bureaubladFunctie(id), null, `id ${id}`);
  }
});

test('de melding is er één, met de naam die op de knop staat', () => {
  const gezien = [];
  const t = (sleutel, opties) => { gezien.push([sleutel, opties]); return `${sleutel}:${opties.feature}`; };
  assert.equal(meldingTekst(t, 'OCR'), 'desktopOnly:OCR');
  assert.deepEqual(gezien, [[MELDING_SLEUTEL, { feature: 'OCR' }]]);
});

test('vangAlleenBureaublad laat een echte fout door', async () => {
  // Een fout van de Rust-kant of van de schijf hoort NIET als "alleen op het
  // bureaublad" weggemoffeld te worden; de aanroeper moet hem zelf melden.
  // (Alleen deze tak is hier te lopen: de andere opent een venster.)
  assert.equal(await vangAlleenBureaublad(new Error('schijf vol'), 'OCR'), false);
  assert.equal(await vangAlleenBureaublad(null, 'OCR'), false);
  assert.equal(await vangAlleenBureaublad('NIET_IN_BROWSER', 'OCR'), false);
});

test('de fout van invoke() draagt de opdrachtnaam mee', () => {
  const fout = new NietInBrowserError('ocr_page');
  assert.equal(fout.command, 'ocr_page');
  assert.equal(fout.name, 'NietInBrowserError');
});

// ── Als gast: geen diensten op andere hosts (#548) ──────────────────────────

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..', '..');

test('elke dienst op een andere host heeft een knop in de tabel', () => {
  const diensten = new Set(Object.values(EXTERNE_DIENSTEN));
  for (const d of ['feedback', 'assistant', 'symbolLibrary', 'whatsNew']) {
    assert.ok(diensten.has(d), `geen knop gekoppeld aan "${d}"`);
  }
  assert.equal(externeDienst('send-feedback'), 'feedback');
  assert.equal(externeDienst('toString'), null);
});

test('als gast staan de diensten uit, met een eigen oorsprong aan', () => {
  for (const id of Object.keys(EXTERNE_DIENSTEN)) {
    assert.equal(knopUit(id, { inTauri: false, gehost: true }), true, `${id} als gast`);
    assert.equal(knopUit(id, { inTauri: false, gehost: false }), false, `${id} losse webversie`);
    assert.equal(knopUit(id, { inTauri: true, gehost: false }), false, `${id} bureaublad`);
  }
  // De regel voor alleen-bureaublad blijft gewoon gelden.
  assert.equal(knopUit('ep-ocr', { inTauri: false, gehost: false }), true);
  assert.equal(knopUit('ep-ocr', { inTauri: true, gehost: false }), false);
  assert.equal(knopUit('tool-select', { inTauri: false, gehost: true }), false);
  assert.equal(externeDienstenAan(true), false);
  assert.equal(externeDienstenAan(false), true);
  // Zonder gastsignaal (geen gastbouw, geen gastobject) is de app geen gast.
  assert.equal(externeDienstenAan(), true);
  window.__OPDS_HOST__ = {};
  try { assert.equal(externeDienstenAan(), false); } finally { delete window.__OPDS_HOST__; }
});

function bronbestanden(map) {
  const uit = [];
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, e.name);
    if (e.isDirectory()) uit.push(...bronbestanden(p));
    else if (/\.(jsx?|mjs|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) uit.push(p);
  }
  return uit;
}
const relatief = (p) => path.relative(app, p).split(path.sep).join('/');
const bronnen = bronbestanden(path.join(app, 'js')).map((p) => [relatief(p), fs.readFileSync(p, 'utf8')]);

test('elke knop uit de tabel bestaat echt', () => {
  for (const id of Object.keys(EXTERNE_DIENSTEN)) {
    assert.ok(bronnen.some(([, tekst]) => tekst.includes(`id="${id}"`)), `geen element met id="${id}"`);
  }
});

// XML-naamruimten zijn geen verzoeken; een link via openExtern() opent de
// gebruiker zelf, in een nieuw venster.
const NAAMRUIMTE = /^https?:\/\/(www\.w3\.org|schemas\.openxmlformats\.org|purl\.org|ns\.adobe\.com|www\.xfa\.org|www\.npes\.org|www\.color\.org)([/?#]|$)/;

// Bestand met een adres op een andere host → bestand dat vóór het verzoek
// externeDienstenAan() vraagt. null: alleen bereikbaar via een knop die in
// de browser al uit staat.
const DIENSTEN = {
  'js/help/release-notes.js': 'js/help/release-notes.js',
  'js/help/previous-version.js': null, // knop ribbon-previous-version
  'js/core/draagbaar.js': null, // releasepagina via openExtern, knop ribbon-check-updates (#881)
  'js/solid/components/dialogs/FeedbackDialog.jsx': 'js/solid/components/dialogs/FeedbackDialog.jsx',
  'js/solid/data/symbolLibraryOnline.js': 'js/solid/stores/symbolLibraryOnlineStore.js',
  'js/solid/components/AssistantPanel.jsx': 'js/solid/components/AssistantPanel.jsx',
  'js/mcp-bridge.js': 'js/mcp-bridge.js',
};

test('elk verzoek naar een andere host vraagt eerst externeDienstenAan()', () => {
  const gevonden = new Set();
  for (const [rel, tekst] of bronnen) {
    for (const regel of tekst.split(/\r?\n/)) {
      if (/^\s*(\/\/|\*|\/\*)/.test(regel) || /openExtern(al)?\(/.test(regel)) continue;
      for (const url of regel.match(/https?:\/\/[^\s'"`)<>]+/g) || []) {
        if (!NAAMRUIMTE.test(url)) gevonden.add(rel);
      }
    }
  }
  const onbekend = [...gevonden].filter((rel) => !(rel in DIENSTEN));
  assert.deepEqual(onbekend, [],
    'nieuwe dienst op een andere host: zet de knop in EXTERNE_DIENSTEN en vraag externeDienstenAan()');
  const teksten = new Map(bronnen);
  for (const [rel, bewaker] of Object.entries(DIENSTEN)) {
    if (bewaker === null) {
      assert.equal(bureaubladFunctie('ribbon-previous-version'), 'updater');
      continue;
    }
    assert.match(teksten.get(bewaker) || '', /externeDienstenAan\(/,
      `${bewaker} vraagt externeDienstenAan() niet (voor ${rel})`);
  }
});

