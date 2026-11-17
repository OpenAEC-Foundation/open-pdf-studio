// De MCP-opdrachten voor staten (#1130): de config wordt gecontroleerd vóór er
// iets wordt aangemaakt (geen lege staat na een mislukte poging), een staat is
// te hernoemen, bij te werken en te verwijderen, en de beschrijving van de
// opdracht noemt elke categorie, elk veld en elke vergelijking die bestaat.
// De regels zijn puur; mcp-bridge.js doet alleen het werk eromheen (zie
// schedule-mcp-app.test.mjs voor de rondgang door de echte brug).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  staatConfig, zoekStaat, tabellenVanStaat, plaatsStaat, werkStaatBij, verwijderStaat,
} from './schedule-mcp.js';
import { buildSchedule, FILTER_OPS } from './engine.js';
import { CATEGORY_ORDER, FIELD_REGISTRY, scheduleUsesLayer } from './categories.js';
import { getTemplateById, STANDARD_SCHEDULE_TEMPLATES } from './schedule-templates.js';

const LENGTE = getTemplateById('length').config;
const TELLING = getTemplateById('count').config;

// --- de config -----------------------------------------------------------------

test('een deel-config gaat over het sjabloon heen: alleen een filter geven houdt de kolommen', () => {
  const r = staatConfig(LENGTE, { filters: [{ field: 'layer', op: '=', value: 'Walls' }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.config.categories, ['line-based']);
  assert.deepEqual(r.config.fields, LENGTE.fields);
  assert.deepEqual(r.config.sort, LENGTE.sort);
  assert.deepEqual(r.config.filters, [{ field: 'layer', op: '=', value: 'Walls' }]);
  assert.equal(r.config.itemize, true);
  assert.deepEqual(r.config.format, {});
  // Een kopie: het sjabloon zelf blijft ongemoeid.
  r.config.fields.push('x');
  assert.equal(LENGTE.fields.includes('x'), false);
});

test('zonder config blijft het sjabloon wat het was', () => {
  for (const tpl of STANDARD_SCHEDULE_TEMPLATES) {
    const r = staatConfig(tpl.config, undefined);
    assert.equal(r.ok, true, `${tpl.id}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.config.categories, tpl.config.categories, tpl.id);
    assert.deepEqual(r.config.fields, tpl.config.fields, tpl.id);
    assert.deepEqual(r.config.sort, tpl.config.sort, tpl.id);
  }
});

test('onbekende categorie, onbekend veld en een staat zonder kolommen zijn fouten met de geldige waarden erbij', () => {
  assert.match(staatConfig(LENGTE, { categories: ['length'] }).error, /unknown category: length \(categories: area, line-based, /);
  assert.match(staatConfig(LENGTE, { fields: ['type', 'lenght'] }).error, /unknown field: lenght \(fields for line-based: .*\blayer\b.*\blength\b/);
  // Een veld van een andere categorie telt hier niet mee.
  assert.match(staatConfig(LENGTE, { fields: ['area'] }).error, /unknown field: area/);
  assert.match(staatConfig(LENGTE, { fields: [] }).error, /no columns/);
  assert.match(staatConfig(LENGTE, { categories: [] }).error, /config\.categories is empty/);
  assert.match(staatConfig({}, undefined).error, /config\.categories is empty/);
  assert.match(staatConfig(null, { categories: ['area'] }).error, /no columns: give config\.fields \(fields for area: /);
  assert.match(staatConfig(LENGTE, { kolommen: ['type'] }).error, /unknown config key: kolommen \(allowed: categories, fields, filters, sort, itemize, format\)/);
  assert.match(staatConfig(LENGTE, []).error, /config must be an object/);
  assert.match(staatConfig(LENGTE, 'area').error, /config must be an object/);
  assert.match(staatConfig(LENGTE, { categories: 'area' }).error, /array of category keys/);
  assert.match(staatConfig(LENGTE, { fields: 'type' }).error, /array of field keys/);
});

test('andere categorieën: overgenomen velden, sortering en filters die daar niet bestaan vallen weg', () => {
  const basis = { ...TELLING, filters: [{ field: 'countCat', op: 'has' }, { field: 'page', op: '=', value: 1 }], format: { countCat: { heading: 'Soort' }, page: { decimals: 0 } } };
  const r = staatConfig(basis, { categories: ['area'] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.config.fields, ['page', 'count'], 'countCat bestaat niet bij vlakken');
  assert.deepEqual(r.config.sort, [], 'het sorteerniveau op countCat valt weg');
  assert.deepEqual(r.config.filters, [{ field: 'page', op: '=', value: 1 }]);
  assert.deepEqual(r.config.format, { page: { decimals: 0 } });
  assert.equal(r.config.itemize, false, 'de rest van het sjabloon blijft');
});

test('filters, sortering, itemize en opmaak worden gecontroleerd', () => {
  const fout = (cfg) => staatConfig(LENGTE, cfg).error;
  assert.match(fout({ filters: [{ field: 'laag', op: '=', value: 'A' }] }), /unknown filter field: laag/);
  assert.match(fout({ filters: [{ field: 'layer', op: '==', value: 'A' }] }), /unknown filter op: == \(ops: =, !=, >, >=, <, <=, has, none\)/);
  assert.match(fout({ filters: [{ field: 'layer', op: '=' }] }), /needs a value/);
  assert.match(fout({ filters: [{ field: 'layer', op: '=', value: 'A', hoofdletters: false }] }), /unknown filter key: hoofdletters/);
  assert.match(fout({ filters: { field: 'layer' } }), /config\.filters must be an array/);
  assert.equal(staatConfig(LENGTE, { filters: [{ field: 'label', op: 'has' }, { field: 'layer', op: 'none' }] }).ok, true);
  assert.equal(staatConfig(LENGTE, { filters: [{ field: 'page', op: '>=', value: 0 }] }).ok, true, 'nul is een waarde');
  assert.match(fout({ sort: [{ field: 'laag' }] }), /unknown sort field: laag/);
  assert.match(fout({ sort: [{ field: 'layer', dir: 'up' }] }), /asc or desc/);
  assert.match(fout({ sort: [{ field: 'layer', group: 'ja' }] }), /sort group must be a boolean/);
  assert.match(fout({ sort: 'layer' }), /config\.sort must be an array/);
  assert.match(fout({ itemize: 'nee' }), /config\.itemize must be a boolean/);
  assert.match(fout({ format: { laag: {} } }), /unknown format field: laag/);
  assert.match(fout({ format: { length: { decimals: 2.5 } } }), /decimals must be an integer from 0 to 6/);
  assert.match(fout({ format: { length: { align: 'center' } } }), /align must be left or right/);
  assert.match(fout({ format: { length: { kop: 'L' } } }), /unknown format key: kop/);
  const goed = staatConfig(LENGTE, {
    sort: [{ field: 'layer', dir: 'desc', group: true, header: true, footer: true }],
    itemize: false,
    format: { length: { heading: 'L', decimals: 1, align: 'right', total: true, unit: 'm' } },
  });
  assert.equal(goed.ok, true, JSON.stringify(goed));
  assert.equal(goed.config.itemize, false);
  assert.deepEqual(goed.config.format.length, { heading: 'L', decimals: 1, align: 'right', total: true, unit: 'm' });
});

// --- de Laag-kolom ---------------------------------------------------------------

const lijn = (id, laag, lengte) => ({
  id, type: 'line', page: 1, startX: 0, startY: 0, endX: lengte, endY: 0, __layer: laag,
});

test('een staat filtert en groepeert op laag', () => {
  const elementen = [lijn('a', 'Walls', 100), lijn('b', 'Walls', 50), lijn('c', 'Default', 30)];
  const cfg = staatConfig(LENGTE, {
    fields: ['layer', 'length'],
    filters: [{ field: 'layer', op: '=', value: 'Walls' }],
    sort: [{ field: 'layer', dir: 'asc', group: true }],
  }).config;
  const r = buildSchedule(elementen, cfg);
  assert.equal(r.count, 2);
  assert.deepEqual(r.columns.map((c) => c.key), ['layer', 'length']);
  assert.equal(r.grandTotals.length, 150);
  assert.deepEqual(r.groups.map((g) => g.key), ['Walls']);
  // Zonder filter: per laag een groep.
  const alles = buildSchedule(elementen, { ...cfg, filters: [] });
  assert.deepEqual(alles.groups.map((g) => [g.key, g.subtotals.length]), [['Default', 30], ['Walls', 150]]);
});

test('de laag wordt alleen opgezocht als de staat hem gebruikt', () => {
  assert.equal(scheduleUsesLayer({ fields: ['type', 'layer'] }), true);
  assert.equal(scheduleUsesLayer({ fields: ['type'], filters: [{ field: 'layer', op: '=', value: 'A' }] }), true);
  assert.equal(scheduleUsesLayer({ fields: ['type'], sort: [{ field: 'layer' }] }), true);
  assert.equal(scheduleUsesLayer({ fields: ['type', 'length'], filters: [], sort: [{ field: 'type' }] }), false);
  assert.equal(scheduleUsesLayer(), false);
});

// --- een staat opzoeken ----------------------------------------------------------

const LIJST = [
  { id: 's1', name: 'Walls', templateId: 'length', config: LENGTE },
  { id: 's2', name: 'length', templateId: 'length', config: LENGTE },
  { id: 's3', name: 'length', templateId: 'length', config: LENGTE },
  { id: 's4', name: 'Rooms', templateId: 'area', config: getTemplateById('area').config },
];

test('een staat opzoeken op id of naam; een naam die vaker voorkomt is een fout met de id\'s', () => {
  assert.equal(zoekStaat(LIJST, { scheduleId: 's4' }).schedule.name, 'Rooms');
  assert.equal(zoekStaat(LIJST, { scheduleId: 's4' }).index, 3);
  assert.equal(zoekStaat(LIJST, { name: 'Walls' }).schedule.id, 's1');
  assert.equal(zoekStaat(LIJST, { name: ' rooms ' }).schedule.id, 's4', 'hoofdletters en spaties tellen niet');
  // Het id gaat voor de naam.
  assert.equal(zoekStaat(LIJST, { scheduleId: 's2', name: 'Walls' }).schedule.id, 's2');
  assert.match(zoekStaat(LIJST, { name: 'length' }).error, /2 schedules are named length: pass scheduleId \(s2, s3\)/);
  assert.match(zoekStaat(LIJST, { name: 'Nope' }).error, /schedule not found: Nope \(schedules: Walls \[s1\], length \[s2\]/);
  assert.match(zoekStaat(LIJST, { scheduleId: 'x' }).error, /schedule not found: x/);
  assert.match(zoekStaat([], { scheduleId: 'x' }).error, /\(schedules: none\)/);
  assert.match(zoekStaat(LIJST, {}).error, /scheduleId or name is required/);
  assert.match(zoekStaat(LIJST, { name: '  ' }).error, /non-empty string/);
  assert.match(zoekStaat(LIJST, { scheduleId: 12 }).error, /scheduleId must be a string/);
});

// --- plaatsen --------------------------------------------------------------------

/** Een store in het klein, met een plaats-functie die de engine-regel volgt. */
function omgeving({ plaatsLukt = true, doc = { currentPage: 2, numPages: 3 } } = {}) {
  const lijst = [];
  const geplaatst = [];
  let teller = 0;
  return {
    lijst, geplaatst,
    o: {
      doc,
      lijst: () => lijst,
      sjabloon: (id) => getTemplateById(id),
      sjabloonIds: () => STANDARD_SCHEDULE_TEMPLATES.map((t) => t.id),
      voegToe: (g) => { const item = { id: `n${++teller}`, ...g }; lijst.push(item); return item; },
      werkBij: (id, w) => {
        const i = lijst.findIndex((s) => s.id === id);
        lijst[i] = { ...lijst[i], ...w };
      },
      verwijder: (id) => { lijst.splice(lijst.findIndex((s) => s.id === id), 1); },
      plaats: (id, x, y, page) => {
        if (!plaatsLukt) return null;
        const s = lijst.find((v) => v.id === id);
        const ann = { id: `t${geplaatst.length + 1}`, type: 'scheduleTable', scheduleId: id, page, x, y, width: 300, height: 60, title: s.name, columns: s.config.fields, rows: [{ cells: [] }] };
        geplaatst.push(ann);
        return ann;
      },
    },
  };
}

test('een mislukte config laat geen staat achter', () => {
  const { lijst, geplaatst, o } = omgeving();
  // De poging uit de melding: een lengtestaat op laag, met namen die niet bestaan.
  for (const config of [
    { categories: ['length'], fields: ['layer', 'length'] },
    { fields: ['laag', 'lengte'] },
    { fields: [] },
    { filters: [{ field: 'layer', op: 'equals', value: 'Walls' }] },
  ]) {
    const r = plaatsStaat({ templateId: 'length', name: 'Lengths per layer', config }, o);
    assert.equal(r.ok, false, JSON.stringify(config));
  }
  assert.match(plaatsStaat({ templateId: 'length', page: 9 }, o).error, /page 9 out of range \(doc has 3 pages\)/);
  assert.match(plaatsStaat({ templateId: 'lengte' }, o).error, /unknown template: lengte \(templates: area, length, count, /);
  assert.match(plaatsStaat({ templateId: 'length', config: 'x' }, o).error, /config must be an object/);
  assert.match(plaatsStaat({ templateId: 'length', name: '' }, o).error, /name must be a non-empty string/);
  assert.match(plaatsStaat({ scheduleId: 'weg' }, o).error, /schedule not found: weg/);
  assert.deepEqual(lijst, [], 'niets aangemaakt');
  assert.deepEqual(geplaatst, [], 'niets geplaatst');
  assert.match(plaatsStaat({}, { ...o, doc: null }).error, /no active document/);
});

test('plaatsen: een nieuwe staat uit het sjabloon met de config eroverheen', () => {
  const { lijst, geplaatst, o } = omgeving();
  const r = plaatsStaat({
    templateId: 'length', name: 'Walls',
    config: { fields: ['type', 'layer', 'length'], filters: [{ field: 'layer', op: '=', value: 'Walls' }] },
    x: 100, y: 200, page: 3,
  }, o);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.created, true);
  assert.equal(lijst.length, 1);
  assert.equal(lijst[0].name, 'Walls');
  assert.equal(lijst[0].templateId, 'length');
  assert.deepEqual(lijst[0].config.categories, ['line-based']);
  assert.deepEqual(lijst[0].config.fields, ['type', 'layer', 'length']);
  assert.deepEqual(lijst[0].config.sort, LENGTE.sort, 'de sortering van het sjabloon blijft');
  assert.deepEqual([r.scheduleId, r.annotationId, r.page, r.x, r.y], [lijst[0].id, 't1', 3, 100, 200]);
  assert.equal(geplaatst[0].scheduleId, lijst[0].id);
  // Zonder naam, pagina en plek: de naam van het sjabloon, de huidige pagina, 40/40.
  const s = plaatsStaat({}, o);
  assert.deepEqual([s.ok, lijst[1].name, lijst[1].templateId, s.page, s.x, s.y], [true, 'area', 'area', 2, 40, 40]);
});

test('plaatsen met een bestaande staat: hernoemen en config bijwerken, en bij mislukken alles terug', () => {
  const { lijst, o } = omgeving();
  const eerste = plaatsStaat({ templateId: 'length', name: 'Lengths' }, o);
  const id = eerste.scheduleId;
  const r = plaatsStaat({ scheduleId: id, name: 'Lengths per layer', config: { sort: [{ field: 'layer', group: true }] } }, o);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.created, false);
  assert.equal(lijst.length, 1, 'geen tweede staat');
  assert.equal(lijst[0].name, 'Lengths per layer');
  assert.deepEqual(lijst[0].config.sort, [{ field: 'layer', group: true }]);
  // Alleen opnieuw plaatsen: de staat blijft wat hij was.
  const voor = JSON.stringify(lijst);
  assert.equal(plaatsStaat({ scheduleId: id }, o).ok, true);
  assert.equal(JSON.stringify(lijst), voor);

  // Het plaatsen zelf mislukt: een nieuwe staat verdwijnt weer, een bestaande
  // krijgt zijn naam en config terug.
  const stuk = omgeving({ plaatsLukt: false });
  assert.match(plaatsStaat({ templateId: 'area', name: 'Rooms' }, stuk.o).error, /no columns/);
  assert.deepEqual(stuk.lijst, [], 'de aangemaakte staat is weer weg');
  stuk.lijst.push({ id: 'b1', name: 'Oud', templateId: 'length', config: JSON.parse(JSON.stringify(LENGTE)) });
  const oud = JSON.stringify(stuk.lijst);
  assert.equal(plaatsStaat({ scheduleId: 'b1', name: 'Nieuw', config: { fields: ['type'] } }, stuk.o).ok, false);
  assert.equal(JSON.stringify(stuk.lijst), oud, 'naam en config staan terug');
  const gooit = omgeving();
  gooit.o.plaats = () => { throw new Error('canvas weg'); };
  assert.match(plaatsStaat({ templateId: 'area' }, gooit.o).error, /placing the schedule failed: canvas weg/);
  assert.deepEqual(gooit.lijst, []);
});

// --- bijwerken -------------------------------------------------------------------

test('een staat hernoemen en zijn config aanpassen zonder te plaatsen', () => {
  const { lijst, geplaatst, o } = omgeving();
  lijst.push({ id: 'b1', name: 'Lengths', templateId: 'length', config: JSON.parse(JSON.stringify(LENGTE)) });
  const r = werkStaatBij({ name: 'lengths', newName: 'Walls', config: { filters: [{ field: 'layer', op: '=', value: 'Walls' }] } }, o);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.changed, ['config', 'name']);
  assert.equal(r.name, 'Walls');
  assert.equal(lijst[0].name, 'Walls');
  assert.deepEqual(lijst[0].config.filters, [{ field: 'layer', op: '=', value: 'Walls' }]);
  assert.deepEqual(lijst[0].config.fields, LENGTE.fields, 'wat niet genoemd is blijft staan');
  assert.deepEqual(r.config, lijst[0].config);
  assert.deepEqual(geplaatst, [], 'er wordt niets geplaatst');
  // Dezelfde naam nog eens: niets gewijzigd.
  assert.deepEqual(werkStaatBij({ scheduleId: 'b1', newName: 'Walls' }, o).changed, []);

  const voor = JSON.stringify(lijst);
  assert.match(werkStaatBij({ scheduleId: 'b1' }, o).error, /nothing to change/);
  assert.match(werkStaatBij({ scheduleId: 'b1', newName: ' ' }, o).error, /newName must be a non-empty string/);
  assert.match(werkStaatBij({ scheduleId: 'b1', config: { fields: ['nope'] } }, o).error, /unknown field: nope/);
  assert.match(werkStaatBij({ scheduleId: 'b1', newName: 'X', config: { fields: [] } }, o).error, /no columns/);
  assert.match(werkStaatBij({ scheduleId: 'b1', page: 2 }, o).error, /unknown argument: page/);
  assert.match(werkStaatBij({ newName: 'X' }, o).error, /scheduleId or name is required/);
  assert.match(werkStaatBij({ name: 'Nope', newName: 'X' }, o).error, /schedule not found: Nope/);
  assert.equal(JSON.stringify(lijst), voor, 'bij een fout verandert er niets');
});

// --- verwijderen -----------------------------------------------------------------

test('een staat verwijderen neemt zijn geplaatste tabellen mee, en alleen die', () => {
  const lijst = JSON.parse(JSON.stringify(LIJST));
  const annotaties = [
    { id: 't1', type: 'scheduleTable', scheduleId: 's1', page: 1 },
    { id: 'l1', type: 'line', page: 1 },
    { id: 't2', type: 'scheduleTable', scheduleId: 's4', page: 1 },
    { id: 't3', type: 'scheduleTable', scheduleId: 's1', page: 2 },
    { id: 't4', type: 'scheduleTable', page: 2 },
  ];
  assert.deepEqual(tabellenVanStaat(annotaties, 's1').map((a) => a.id), ['t1', 't3']);
  assert.deepEqual(tabellenVanStaat(annotaties, undefined), [], 'een tabel zonder staat hoort nergens bij');

  const weg = [];
  const o = {
    lijst: () => lijst,
    annotaties: () => annotaties,
    elders: (id) => (id === 's1' ? 2 : 0),
    verwijder: (staat, index, tabellen) => { weg.push({ id: staat.id, index, tabellen: tabellen.map((a) => a.id) }); },
  };
  const r = verwijderStaat({ name: 'Walls' }, o);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(weg, [{ id: 's1', index: 0, tabellen: ['t1', 't3'] }], 'één aanroep: tabellen en staat samen');
  assert.deepEqual(r.removedTables, [{ id: 't1', page: 1 }, { id: 't3', page: 2 }]);
  assert.equal(r.undoable, true);
  assert.equal(r.tablesInOtherDocuments, 2);
  assert.deepEqual(r.schedule, { id: 's1', name: 'Walls', templateId: 'length', config: LENGTE }, 'de definitie gaat mee terug');

  // Zonder geplaatste tabellen verandert het document niet: geen ongedaan-stap.
  const leeg = verwijderStaat({ scheduleId: 's2' }, o);
  assert.deepEqual([leeg.ok, leeg.removedTables.length, leeg.undoable, 'tablesInOtherDocuments' in leeg], [true, 0, false, false]);
  assert.deepEqual(weg[1], { id: 's2', index: 1, tabellen: [] });

  // Fouten: er wordt niets verwijderd.
  assert.match(verwijderStaat({ name: 'length' }, o).error, /2 schedules are named length/);
  assert.match(verwijderStaat({ scheduleId: 'x' }, o).error, /schedule not found: x/);
  assert.match(verwijderStaat({}, o).error, /scheduleId or name is required/);
  assert.match(verwijderStaat({ scheduleId: 's1', all: true }, o).error, /unknown argument: all/);
  assert.equal(weg.length, 2);
});

// --- de registratie op álle plekken -------------------------------------------

const REPO = new URL('../../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, REPO), 'utf8');
const NIEUW = ['app_update_schedule', 'app_delete_schedule'];
const tools = JSON.parse(lees('mcp-stdio/tools.json'));
const tool = (naam) => tools.find((t) => t.name === naam);

test('de nieuwe opdrachten staan in de brug, de Rust-server, de metatabel, tools.json, de manifest en Python', () => {
  const brug = lees('open-pdf-studio/js/mcp-bridge.js');
  for (const ev of ["'mcp:update-schedule'", "'mcp:delete-schedule'"]) assert.ok(brug.includes(ev), ev);
  const server = lees('open-pdf-studio/src-tauri/src/mcp_server.rs');
  assert.ok(server.includes('"mcp:update-schedule"') && server.includes('"mcp:delete-schedule"'), 'de Rust-server stuurt ze door');
  const meta = lees('open-pdf-studio/src-tauri/src/mcp_tool_meta.rs');
  const manifest = JSON.parse(lees('mcpb/manifest.json'));
  const python = lees('python/src/open_pdf_studio/_tools.py');
  for (const naam of NIEUW) {
    assert.ok(server.includes(`"name": "${naam}"`), `${naam} in mcp_server.rs`);
    assert.match(meta, new RegExp(`^\\s*wijzigt\\("${naam}",`, 'm'), `${naam} is wijzigt in mcp_tool_meta.rs`);
    const t = tool(naam);
    assert.ok(t, `${naam} in tools.json`);
    assert.equal(t.annotations.destructiveHint, true, `${naam} vraagt altijd`);
    assert.equal(t.annotations.readOnlyHint, false);
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.ok(manifest.tools.some((m) => m.name === naam), `${naam} in de manifest`);
    assert.ok(python.includes(`"${naam}"`), `${naam} in de Python-bibliotheek`);
  }
  assert.deepEqual(Object.keys(tool('app_delete_schedule').inputSchema.properties).sort(), ['name', 'scheduleId']);
  assert.deepEqual(Object.keys(tool('app_update_schedule').inputSchema.properties).sort(), ['config', 'name', 'newName', 'scheduleId']);
});

test('de beschrijving van de config noemt elke categorie, elk veld en elke vergelijking, met een voorbeeld op laag', () => {
  const config = tool('app_place_schedule').inputSchema.properties.config.description;
  // Woordgrenzen: 'text' mag niet meeliften op 'text-annotation'.
  const noemt = (woord) => new RegExp(`(^|[\\s,:(])${woord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s,;.)]|$)`).test(config);
  for (const cat of CATEGORY_ORDER) assert.ok(noemt(cat), `categorie ${cat}`);
  const velden = new Set(Object.values(FIELD_REGISTRY).flat().map((f) => f.key));
  for (const veld of velden) assert.ok(noemt(veld), `veld ${veld}`);
  for (const op of FILTER_OPS) assert.ok(noemt(op), `vergelijking ${op}`);
  for (const sleutel of ['categories', 'fields', 'filters', 'sort', 'itemize', 'format']) assert.ok(config.includes(`${sleutel}:`), sleutel);

  // Het voorbeeld is een config die de controle doorstaat en echt op laag filtert.
  const voorbeeld = JSON.parse(config.slice(config.indexOf('{"categories"'), config.lastIndexOf('}') + 1));
  const r = staatConfig(LENGTE, voorbeeld);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.config.filters, [{ field: 'layer', op: '=', value: 'Walls' }]);
  const uit = buildSchedule([lijn('a', 'Walls', 100), lijn('b', 'Other', 50)], r.config);
  assert.equal(uit.count, 1);
  assert.equal(uit.grandTotals.length, 100);
});

test('de beschrijvingen zeggen dat een staat van de hele app is en uit het actieve document rekent', () => {
  for (const naam of ['app_get_takeoff', 'app_place_schedule', 'app_update_schedule', 'app_delete_schedule']) {
    assert.match(tool(naam).description, /shared by the whole app/, naam);
  }
  assert.match(tool('app_get_takeoff').description, /ACTIVE document/);
  assert.match(tool('app_place_schedule').description, /checked BEFORE anything is created/);
  assert.match(tool('app_delete_schedule').description, /ONE undo step/);
  // De sjablonen die de beschrijving noemt bestaan.
  const sjablonen = tool('app_place_schedule').inputSchema.properties.templateId.description;
  for (const tpl of STANDARD_SCHEDULE_TEMPLATES) assert.ok(sjablonen.includes(tpl.id), `sjabloon ${tpl.id}`);
});
