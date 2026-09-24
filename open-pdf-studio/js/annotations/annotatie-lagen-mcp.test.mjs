// De MCP-opdrachten voor annotatielagen (#468): opvragen, aanmaken, aan/uit
// zetten, en een laag-argument bij het aanmaken en bijwerken van annotaties.
// De regels zijn puur; mcp-bridge.js doet alleen het werk eromheen.

import assert from 'node:assert/strict';
import basisTest from 'node:test';
import { readFileSync } from 'node:fs';

import {
  lagenOverzicht, laagArgument, maakLaag, zetLaag, annotatieLaagNaam, filterOpLaag,
} from './annotatie-lagen-mcp.js';
import { addLayer, getLayers, currentLayerId, DEFAULT_LAYER_ID } from './annotatie-lagen.js';

const STANDAARD = 'Default';
// Ook tegen documenten die, zoals in de app, bij toewijzen een kopie bewaren.
import { perDocumentsoort, documentDatNietsBewaart } from './documentsoorten.testhulp.mjs';
const { test, maakDoc } = perDocumentsoort(basisTest);
const leeg = () => maakDoc();

test('lagen opvragen: naam, aantal, schakelaars, huidige en standaardlaag', () => {
  const doc = leeg();
  const a = addLayer(doc, { name: 'Structure', color: '#FF0000' }).layer;
  doc.annotations.push({ id: '1', layer: a.id }, { id: '2' });
  assert.deepEqual(lagenOverzicht(doc, STANDAARD), [
    { id: DEFAULT_LAYER_ID, name: 'Default', color: null, visible: true, printable: true, locked: false, count: 1, current: true, default: true },
    { id: a.id, name: 'Structure', color: '#ff0000', visible: true, printable: true, locked: false, count: 1, current: false, default: false },
  ]);
});

test('een laag aanmaken, met schakelaars en eventueel als huidige laag', () => {
  const doc = leeg();
  const r = maakLaag(doc, { name: 'Client comments', visible: false, color: '#00ff00', current: true }, STANDAARD);
  assert.equal(r.ok, true);
  assert.equal(r.layer.name, 'Client comments');
  assert.equal(r.layer.visible, false);
  assert.equal(r.layer.color, '#00ff00');
  assert.equal(currentLayerId(doc), r.layer.id);
  assert.equal(r.layer.current, true);
});

test('aanmaken: naam verplicht en uniek, onbekende of verkeerde argumenten geweigerd', () => {
  const doc = leeg();
  maakLaag(doc, { name: 'A' }, STANDAARD);
  assert.match(maakLaag(doc, {}, STANDAARD).error, /name/);
  assert.match(maakLaag(doc, { name: 'a' }, STANDAARD).error, /already exists/);
  assert.match(maakLaag(doc, { name: 'B', kleur: 'rood' }, STANDAARD).error, /unknown argument: kleur/);
  assert.match(maakLaag(doc, { name: 'B', visible: 'ja' }, STANDAARD).error, /visible must be a boolean/);
  assert.match(maakLaag(doc, { name: 'B', color: 'red' }, STANDAARD).error, /color/);
  assert.match(maakLaag(null, { name: 'B' }, STANDAARD).error, /no active document/);
  assert.equal(getLayers(doc).length, 2, 'niets aangemaakt bij een fout');
});

test('een laag aan- en uitzetten, vergrendelen, hernoemen, kleur, huidige laag', () => {
  const doc = leeg();
  const a = addLayer(doc, { name: 'Structure' }).layer;
  const r = zetLaag(doc, { layer: 'structure', visible: false, locked: true, printable: false }, STANDAARD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed.sort(), ['locked', 'printable', 'visible']);
  assert.equal(r.layer.visible, false);
  assert.equal(r.layer.locked, true);
  const r2 = zetLaag(doc, { layer: a.id, name: 'Round 2', color: '#123456', current: true }, STANDAARD);
  assert.deepEqual(r2.changed.sort(), ['color', 'current', 'name']);
  assert.equal(r2.layer.name, 'Round 2');
  assert.equal(currentLayerId(doc), a.id);
  // De standaardlaag is te vinden op id en op haar weergavenaam.
  assert.equal(zetLaag(doc, { layer: 'Default', visible: false }, STANDAARD).layer.id, DEFAULT_LAYER_ID);
  assert.equal(zetLaag(doc, { layer: DEFAULT_LAYER_ID, visible: true }, STANDAARD).layer.visible, true);
});

test('bijwerken: onbekende laag, niets te doen, en fouten', () => {
  const doc = leeg();
  addLayer(doc, { name: 'Structure' });
  assert.match(zetLaag(doc, { layer: 'Nope', visible: true }, STANDAARD).error, /unknown layer: Nope \(layers: Default, Structure\)/);
  assert.match(zetLaag(doc, { layer: 'Structure' }, STANDAARD).error, /nothing to change/);
  assert.match(zetLaag(doc, { visible: true }, STANDAARD).error, /layer/);
  assert.match(zetLaag(doc, { layer: 'Structure', current: false }, STANDAARD).error, /current/);
  assert.match(zetLaag(doc, { layer: 'Default', name: 'X' }, STANDAARD).error, /default layer/);
  assert.match(zetLaag(doc, { layer: 'Structure', hidden: true }, STANDAARD).error, /unknown argument: hidden/);
});

test('het laag-argument bij een annotatie: id of naam, weggelaten = niet gegeven', () => {
  const doc = leeg();
  const a = addLayer(doc, { name: 'Structure' }).layer;
  assert.deepEqual(laagArgument(doc, undefined, STANDAARD), { ok: true, id: undefined });
  assert.deepEqual(laagArgument(doc, 'STRUCTURE', STANDAARD), { ok: true, id: a.id });
  assert.deepEqual(laagArgument(doc, a.id, STANDAARD), { ok: true, id: a.id });
  assert.deepEqual(laagArgument(doc, 'Default', STANDAARD), { ok: true, id: DEFAULT_LAYER_ID });
  assert.match(laagArgument(doc, 'Nope', STANDAARD).error, /unknown layer: Nope/);
  assert.match(laagArgument(doc, 12, STANDAARD).error, /layer must be a string/);
});

test('de lijst van annotaties noemt de laag en filtert erop', () => {
  const doc = leeg();
  const a = addLayer(doc, { name: 'Structure' }).layer;
  const p = { id: 'p', layer: a.id };
  const q = { id: 'q' };
  doc.annotations.push(p, q);
  assert.equal(annotatieLaagNaam(doc, p, STANDAARD), 'Structure');
  assert.equal(annotatieLaagNaam(doc, q, STANDAARD), undefined, 'de standaardlaag hoeft niet genoemd');
  assert.deepEqual(filterOpLaag(doc, doc.annotations, 'structure', STANDAARD), { ok: true, annotations: [p] });
  assert.deepEqual(filterOpLaag(doc, doc.annotations, 'Default', STANDAARD), { ok: true, annotations: [q] });
  assert.deepEqual(filterOpLaag(doc, doc.annotations, undefined, STANDAARD), { ok: true, annotations: [p, q] });
  assert.match(filterOpLaag(doc, doc.annotations, 'Nope', STANDAARD).error, /unknown layer/);
});

// --- de registratie op álle plekken -------------------------------------------

const REPO = new URL('../../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, REPO), 'utf8');
const NIEUW = ['app_list_layers', 'app_create_layer', 'app_set_layer'];

basisTest('de nieuwe opdrachten staan in de brug, de Rust-server, de metatabel, tools.json en de manifest', () => {
  const brug = lees('open-pdf-studio/js/mcp-bridge.js');
  for (const ev of ["'mcp:list-layers'", "'mcp:create-layer'", "'mcp:set-layer'"]) assert.ok(brug.includes(ev), ev);
  const server = lees('open-pdf-studio/src-tauri/src/mcp_server.rs');
  const meta = lees('open-pdf-studio/src-tauri/src/mcp_tool_meta.rs');
  const tools = JSON.parse(lees('mcp-stdio/tools.json'));
  const manifest = JSON.parse(lees('mcpb/manifest.json'));
  for (const naam of NIEUW) {
    assert.ok(server.includes(`"${naam}"`), `${naam} in mcp_server.rs`);
    assert.ok(meta.includes(`"${naam}"`), `${naam} in mcp_tool_meta.rs`);
    assert.ok(tools.some((t) => t.name === naam), `${naam} in tools.json`);
    assert.ok(manifest.tools.some((t) => t.name === naam), `${naam} in manifest.json`);
  }
  // Het laag-argument bij aanmaken, bijwerken en opsommen.
  for (const naam of ['app_create_annotation', 'app_update_annotation', 'app_list_annotations']) {
    const t = tools.find((x) => x.name === naam);
    assert.equal(t.inputSchema.properties.layer?.type, 'string', `${naam} heeft een laag-argument`);
  }
});

// --- nooit een succes zonder laag ------------------------------------------
// In de app gaf app_create_layer {"ok":true} zonder laag terug, terwijl de laag
// niet in het document stond. Een antwoord met ok:true draagt altijd de laag
// zoals die in het document staat.

test('aanmaken geeft de laag uit het document terug, en app_list_layers kent haar', () => {
  const doc = leeg();
  const r = maakLaag(doc, { name: 'Constructie' }, STANDAARD);
  assert.equal(r.ok, true);
  assert.ok(r.layer && r.layer.id && r.layer.name === 'Constructie', 'de laag zit in het antwoord');
  assert.deepEqual(lagenOverzicht(doc, STANDAARD).map((l) => l.name), ['Default', 'Constructie']);
  assert.deepEqual(laagArgument(doc, 'Constructie', STANDAARD), { ok: true, id: r.layer.id });
});

test('bijwerken staat in het document: vergrendelen blijft vergrendeld', () => {
  const doc = leeg();
  const r = zetLaag(doc, { layer: 'Default', locked: true }, STANDAARD);
  assert.equal(r.ok, true);
  assert.equal(r.layer.locked, true);
  assert.equal(lagenOverzicht(doc, STANDAARD)[0].locked, true);
});

basisTest('een document dat niets bewaart: aanmaken en bijwerken melden een fout', () => {
  const doc = documentDatNietsBewaart();
  const r = maakLaag(doc, { name: 'Constructie' }, STANDAARD);
  assert.equal(r.ok, false);
  assert.match(r.error, /not stored/);
  const z = zetLaag(doc, { layer: 'Default', locked: true }, STANDAARD);
  assert.equal(z.ok, false);
  assert.match(z.error, /not stored/);
});
