// US-tekenvellen ARCH A–E1 en ANSI A–E (#996): één lijst, in elke papierlijst
// (nieuw document, pagina invoegen, lege pagina's, herschalen, afdrukken).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { US_PAPIERFORMATEN, usFormatenVan, usFormaat, usInPunten, usInMm, usFormaatTekst } from './us-papierformaten.js';
import { BLANK_PRESETS, presetSize } from '../pdf/blank-page-setup.js';
import { PAPIERFORMATEN, formaatTekst, paginaFormaat } from '../pdf/print-pagina-instelling.js';
import { PAPIERKEUZES, papierSleutel } from '../pdf/print-opdracht.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('the standard US sheet sizes in inches', () => {
  const maten = Object.fromEntries(US_PAPIERFORMATEN.map(f => [f.label, [f.breedteIn, f.hoogteIn]]));
  assert.deepEqual(maten, {
    'ARCH A': [9, 12], 'ARCH B': [12, 18], 'ARCH C': [18, 24], 'ARCH D': [24, 36], 'ARCH E': [36, 48], 'ARCH E1': [30, 42],
    'ANSI A': [8.5, 11], 'ANSI B': [11, 17], 'ANSI C': [17, 22], 'ANSI D': [22, 34], 'ANSI E': [34, 44],
  });
  assert.equal(usFormatenVan('arch').length, 6);
  assert.equal(usFormatenVan('ansi').length, 5);
  const d = usFormaat('arch-d');
  assert.deepEqual(usInPunten(d), { breedte: 1728, hoogte: 2592 });
  assert.deepEqual(usInMm(d), { breedte: 609.6, hoogte: 914.4 });
  assert.equal(usFormaatTekst(d), 'ARCH D (24 x 36 in)');
  assert.equal(usFormaat('nope'), null);
});

test('blank pages in Edit Pages offer every US sheet', () => {
  for (const f of US_PAPIERFORMATEN) {
    assert.equal(BLANK_PRESETS[f.sleutel].label, f.label);
    assert.deepEqual(presetSize(f.sleutel), { width: f.breedteIn * 72, height: f.hoogteIn * 72 });
  }
});

test('page setup for printing offers ARCH A-E1 and ANSI C-E; ANSI A/B are Letter and Tabloid', () => {
  for (const f of US_PAPIERFORMATEN) {
    if (f.sleutel === 'ansi-a' || f.sleutel === 'ansi-b') {
      assert.equal(PAPIERFORMATEN[f.sleutel], undefined);
      continue;
    }
    const p = PAPIERFORMATEN[f.sleutel];
    assert.ok(p, f.sleutel);
    assert.equal(formaatTekst(f.sleutel), usFormaatTekst(f));
    assert.equal(paginaFormaat(f.breedteIn * 72, f.hoogteIn * 72), f.sleutel);
    assert.equal(paginaFormaat(f.hoogteIn * 72, f.breedteIn * 72), f.sleutel);
    assert.ok(PAPIERKEUZES.includes(f.label));
    assert.equal(papierSleutel(f.label), f.sleutel);
  }
  assert.equal(paginaFormaat(8.5 * 72, 11 * 72), 'letter');
  assert.equal(paginaFormaat(11 * 72, 17 * 72), 'tabloid');
});

test('the Rust print side and the MCP schema know the same sheets', () => {
  const instelling = bron('../../src-tauri/src/print_instelling.rs');
  const server = bron('../../src-tauri/src/mcp_server.rs');
  const tools = JSON.parse(bron('../../../mcp-stdio/tools.json'));
  for (const [sleutel, f] of Object.entries(PAPIERFORMATEN)) {
    if (!f.inch) continue;
    assert.match(instelling, new RegExp(`"${sleutel}", ${f.inch[0]}, ${f.inch[1]}[)]`), sleutel);
    assert.ok(server.includes(`"${f.label}"`), `${f.label} in mcp_server.rs`);
  }
  for (const naam of ['app_print', 'app_print_to_pdf']) {
    const papier = tools.find(t => t.name === naam).inputSchema.properties.paper.enum;
    for (const k of PAPIERKEUZES.filter(k => k !== 'page' && k !== 'printer')) assert.ok(papier.includes(k), `${naam} ${k}`);
  }
});

test('new document, insert page and resize pages list both US series', () => {
  for (const pad of ['NewDocDialog.jsx', 'InsertPageDialog.jsx', 'ResizePagesDialog.jsx']) {
    const dialoog = bron(`../solid/components/dialogs/${pad}`);
    assert.match(dialoog, /usFormatenVan\('arch'\)/, pad);
    assert.match(dialoog, /usFormatenVan\('ansi'\)/, pad);
    assert.match(dialoog, /t\('newDoc\.usArchitectural'\)/, pad);
  }
  assert.match(bron('../solid/components/dialogs/NewDocDialog.jsx'), /US_PAPIERFORMATEN\.map\(/);
  assert.match(bron('../solid/components/dialogs/ResizePagesDialog.jsx'), /US_PAPIERFORMATEN\.map\(/);
  for (const taal of ['en', 'nl']) {
    const d = JSON.parse(bron(`../i18n/locales/${taal}/dialogs.json`)).newDoc;
    assert.equal(typeof d.usArchitectural, 'string');
    assert.equal(typeof d.usEngineering, 'string');
  }
});
