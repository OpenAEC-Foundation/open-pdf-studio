// De MCP-opdrachten voor systeemtypen (#567): app_list_system_types,
// app_register_system_type, app_update_system_type,
// app_open_system_type_editor en app_get_system_geometry. De regels zijn puur (systeem-typen-mcp.js);
// hier tegen een bibliotheek in het geheugen. Daarna de registratie op álle
// plekken: brug, Rust-server, metatabel, tools.json en de manifest.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  mcpLijstSysteemTypen, mcpRegistreerSysteemType, mcpWerkSysteemTypeBij, mcpOpenSysteemTypeEditor,
  mcpSysteemGeometrie,
} from './systeem-typen-mcp.js';
import { planRegistratie, planBijwerking, publiekeSnapshot } from './systeem-typen-contract.js';
import { systeemGeometrie, controleerGeometrieOpties } from './systeem-geometrie.js';
import { createDefaultSysteemTypen, findSysteemType } from './systeem-typen.js';

const DEF = { naam: 'Kanaalplaat 1200', categorie: 'vloer', layout: 'strook', strookBreedteMm: 1200, celYMm: 1200,
  ifcCategory: 'IfcSlab', ifcPredefinedType: 'FLOOR' };

/** Een systeem in het "actieve document" van de geheugenhost. */
const SYSTEEM = {
  id: 'sg-1', type: 'systeemraster', page: 1, systeemTypeId: 'st-plafond-600x600',
  points: [{ x: 100, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 340 }, { x: 100, y: 340 }],
};

/** Een bibliotheek en een document in het geheugen, met dezelfde host-namen
 *  als de registry en systeem-geometrie-app.js. */
function geheugenHost({ bewaarNiets = false } = {}) {
  let data = createDefaultSysteemTypen();
  const geopend = [];
  const annotaties = [JSON.parse(JSON.stringify(SYSTEEM))];
  const commit = (plan) => {
    if (plan.wijziging && !bewaarNiets) data = { ...plan.data, revisie: data.revisie + 1 };
    return { status: plan.status, type: plan.type ? publiekeSnapshot(plan.type) : null };
  };
  return {
    geopend,
    data: () => data,
    getSysteemTypenData: () => data,
    systeemTypeSnapshot: (id) => {
      const t = findSysteemType(data, id);
      return t ? publiekeSnapshot(t) : null;
    },
    alleSysteemTypeSnapshots: () => data.typen.map((t) => publiekeSnapshot(t)),
    registreerSysteemType: (eigenaar, key, def, opties) => commit(planRegistratie(data, eigenaar, key, def, opties)),
    werkEigenSysteemTypeBij: (eigenaar, id, changes, opties) => commit(planBijwerking(data, eigenaar, id, changes, opties)),
    openEditor: ({ typeId }) => {
      geopend.push(typeId);
      return { opened: geopend.length === 1, typeId };
    },
    annotaties,
    systeemInstanceGeometrie: (annotationId, opties) => {
      controleerGeometrieOpties(opties);
      const ann = annotaties.find((a) => a.id === annotationId && a.type === 'systeemraster');
      if (!ann) return null;
      return systeemGeometrie({
        documentId: 'doc-mcp', ann, pxPerMm: 0.1, typeDef: findSysteemType(data, ann.systeemTypeId), opties,
      });
    },
  };
}

test('lijst: alle typen met de bibliotheekrevisie, of één type op id', () => {
  const host = geheugenHost();
  const r = mcpLijstSysteemTypen({}, host);
  assert.equal(r.ok, true);
  assert.equal(r.libraryRevision, 0);
  assert.deepEqual(r.types.map((t) => t.id), host.data().typen.map((t) => t.id));
  const een = mcpLijstSysteemTypen({ id: 'st-plafond-600x600' }, host);
  assert.equal(een.ok, true);
  assert.equal(een.type.id, 'st-plafond-600x600');
  assert.equal('types' in een, false);
  assert.deepEqual(mcpLijstSysteemTypen({ id: 'bestaat-niet' }, host),
    { ok: false, code: 'not-found', error: 'unknown system type: bestaat-niet' });
  assert.deepEqual(mcpLijstSysteemTypen({ filter: 'x' }, host),
    { ok: false, code: 'invalid-argument', error: 'unknown argument: filter' });
  assert.equal(mcpLijstSysteemTypen({ id: 5 }, host).code, 'invalid-argument');
  assert.equal(mcpLijstSysteemTypen(null, host).ok, true, 'geen argumenten = alles');
});

test('registreren: altijd in de MCP-namespace, idempotent, gebruikersbewerking blijft', () => {
  const host = geheugenHost();
  const r = mcpRegistreerSysteemType({ key: 'kp-1200', definition: DEF }, host);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'created');
  assert.equal(r.type.id, 'mcp:kp-1200');
  assert.deepEqual(r.type.owner, { kind: 'mcp', key: 'kp-1200' });
  assert.equal(host.data().revisie, 1);
  assert.equal(mcpRegistreerSysteemType({ key: 'kp-1200', definition: DEF }, host).status, 'unchanged');
  assert.equal(host.data().revisie, 1);
  // Een MCP-client kan zich niet uitgeven voor een extensie.
  const nep = mcpRegistreerSysteemType({ key: 'ext:test.synthetisch#k', definition: DEF }, host);
  assert.equal(nep.ok, false);
  assert.equal(nep.code, 'invalid-key');
  // De gebruiker bewerkt het type; opnieuw registreren laat dat staan.
  const t = findSysteemType(host.data(), 'mcp:kp-1200');
  t.celYMm = 900; t.revisie = 2;
  const k = mcpRegistreerSysteemType({ key: 'kp-1200', definition: { ...DEF, celYMm: 1500 } }, host);
  assert.equal(k.status, 'kept-user-edit');
  assert.equal(k.type.definition.celYMm, 900);
});

test('registreren: dezelfde afwijzingen als de plugin-API, Engels en met code', () => {
  const host = geheugenHost();
  const gevallen = [
    [{ key: 'k', definition: { ...DEF, prijs: 3 } }, 'unknown-field', /unknown field: prijs/],
    [{ key: 'k', definition: { ...DEF, celYMm: 30000 } }, 'invalid-field', /celYMm/],
    [{ key: 'k', definition: { ...DEF, lagen: [{}] } }, 'unsupported-field', /layered system types are not supported/],
    [{ key: 'k', definition: DEF, schema: 2 }, 'unsupported-version', /schema/],
    [{ key: 'K', definition: DEF }, 'invalid-key', /key/],
    [{ key: 'k' }, 'invalid-argument', /definition/],
    [{ definition: DEF }, 'invalid-key', /key/],
    [{ key: 'k', definition: DEF, owner: 'x' }, 'invalid-argument', /unknown argument: owner/],
    [{ key: 'k', definition: { naam: 'x', layout: 'raster' } }, 'missing-field', /categorie/],
  ];
  for (const [args, code, tekst] of gevallen) {
    const r = mcpRegistreerSysteemType(args, host);
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.equal(r.code, code, r.error);
    assert.match(r.error, tekst);
  }
  assert.equal(host.data().revisie, 0, 'niets bewaard');
  assert.equal(host.data().typen.length, createDefaultSysteemTypen().typen.length);
});

test('bijwerken: alleen MCP-typen, met de laatst gelezen revisie', () => {
  const host = geheugenHost();
  mcpRegistreerSysteemType({ key: 'kp-1200', definition: DEF }, host);
  const u = mcpWerkSysteemTypeBij({ id: 'mcp:kp-1200', expectedRevision: 1, changes: { celYMm: 1000 } }, host);
  assert.equal(u.ok, true);
  assert.equal(u.status, 'updated');
  assert.equal(u.type.revision, 2);
  const oud = mcpWerkSysteemTypeBij({ id: 'mcp:kp-1200', expectedRevision: 1, changes: { celYMm: 900 } }, host);
  assert.deepEqual([oud.ok, oud.code, oud.currentRevision], [false, 'stale-revision', 2]);
  assert.match(oud.error, /revision/);
  assert.equal(mcpWerkSysteemTypeBij({ id: 'st-plafond-600x600', expectedRevision: 1, changes: { celXMm: 700 } }, host).code, 'not-owner');
  assert.equal(mcpWerkSysteemTypeBij({ id: 'mcp:onbekend', expectedRevision: 1, changes: { celXMm: 700 } }, host).code, 'not-found');
  assert.equal(mcpWerkSysteemTypeBij({ id: 'mcp:kp-1200', changes: { celXMm: 700 } }, host).code, 'invalid-argument');
  assert.equal(mcpWerkSysteemTypeBij({ id: 'mcp:kp-1200', expectedRevision: 2, changes: { celXMm: 700 }, force: true }, host).error,
    'unknown argument: force');
  const nul = mcpWerkSysteemTypeBij({ id: 'mcp:kp-1200', expectedRevision: 2, changes: { celYMm: null } }, host);
  assert.equal(nul.ok, true);
  assert.deepEqual(nul.type.unconfirmed.slice(0, 1), ['celYMm']);
});

test('nooit ok:true zonder terug te lezen uit de bibliotheek', () => {
  const host = geheugenHost({ bewaarNiets: true });
  const r = mcpRegistreerSysteemType({ key: 'kp-1200', definition: DEF }, host);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not-stored');
  assert.match(r.error, /not stored/);
});

test('editor openen: alleen bestaande typen, verandert niets', () => {
  const host = geheugenHost();
  const voor = JSON.stringify(host.data());
  assert.deepEqual(mcpOpenSysteemTypeEditor({ id: 'st-plafond-600x600' }, host),
    { ok: true, opened: true, typeId: 'st-plafond-600x600' });
  assert.deepEqual(mcpOpenSysteemTypeEditor({ id: 'st-plafond-600x600' }, host),
    { ok: true, opened: false, typeId: 'st-plafond-600x600' });
  assert.equal(mcpOpenSysteemTypeEditor({ id: 'bestaat-niet' }, host).code, 'not-found');
  assert.equal(mcpOpenSysteemTypeEditor({}, host).code, 'invalid-argument');
  assert.equal(mcpOpenSysteemTypeEditor({ id: 'st-plafond-600x600', modal: true }, host).error, 'unknown argument: modal');
  assert.deepEqual(host.geopend, ['st-plafond-600x600', 'st-plafond-600x600']);
  assert.equal(JSON.stringify(host.data()), voor);
});

test('geometrie: de snapshot van een systeem, revisies en afwijzingen, zonder iets te wijzigen', () => {
  const host = geheugenHost();
  const voor = JSON.stringify(host.data());
  const r = mcpSysteemGeometrie({ annotationId: 'sg-1' }, host);
  assert.equal(r.ok, true);
  assert.equal(r.geometry.document.id, 'doc-mcp');
  assert.deepEqual(r.geometry.type, { id: 'st-plafond-600x600', revision: 1 });
  assert.equal(r.geometry.units, 'mm');
  assert.equal(r.geometry.coordinateSpace, 'system');
  assert.equal(r.geometry.confirmed, true);
  assert.equal(r.geometry.panels.length, 24);
  assert.equal(JSON.stringify(host.data()), voor, 'lezen wijzigt niets');
  // Dezelfde revisies: dezelfde snapshot.
  const zelfde = mcpSysteemGeometrie({ annotationId: 'sg-1', expectedDocumentRevision: r.geometry.document.revision,
    expectedTypeRevision: 1 }, host);
  assert.deepEqual(zelfde, r);
  // Verouderd: eerst verandert het type (door de gebruiker), dan de instance.
  findSysteemType(host.data(), 'st-plafond-600x600').revisie = 2;
  const typeOud = mcpSysteemGeometrie({ annotationId: 'sg-1', expectedTypeRevision: 1 }, host);
  assert.deepEqual([typeOud.ok, typeOud.code, typeOud.field, typeOud.currentRevision],
    [false, 'stale-revision', 'expectedTypeRevision', 2]);
  host.annotaties[0].points[1].x = 480;
  const docOud = mcpSysteemGeometrie({ annotationId: 'sg-1', expectedDocumentRevision: r.geometry.document.revision }, host);
  assert.deepEqual([docOud.ok, docOud.code, docOud.field], [false, 'stale-revision', 'expectedDocumentRevision']);
  assert.match(docOud.error, /stale document revision/);
  assert.equal(docOud.currentRevision, mcpSysteemGeometrie({ annotationId: 'sg-1' }, host).geometry.document.revision);
  // Afwijzingen met code, in het Engels.
  assert.deepEqual(mcpSysteemGeometrie({ annotationId: 'bestaat-niet' }, host),
    { ok: false, code: 'not-found', error: 'no system with id bestaat-niet in the active document' });
  assert.equal(mcpSysteemGeometrie({}, host).code, 'invalid-argument');
  assert.equal(mcpSysteemGeometrie({ annotationId: 'sg-1', zoom: 2 }, host).error, 'unknown argument: zoom');
  assert.equal(mcpSysteemGeometrie({ annotationId: 'sg-1', expectedTypeRevision: 1.5 }, host).code, 'invalid-argument');
  assert.equal(mcpSysteemGeometrie({ annotationId: 'sg-1', schema: 2 }, host).code, 'unsupported-version');
  // Een type zonder bevestigde maat geeft nooit een bevestigde snapshot.
  delete findSysteemType(host.data(), 'st-plafond-600x600').celYMm;
  const onbevestigd = mcpSysteemGeometrie({ annotationId: 'sg-1' }, host);
  assert.equal(onbevestigd.geometry.confirmed, false);
  assert.deepEqual(onbevestigd.geometry.unconfirmed, ['celYMm']);
});

// --- de registratie op álle plekken -------------------------------------------

const REPO = new URL('../../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, REPO), 'utf8');

const TOOLS = [
  { naam: 'app_list_system_types', kanaal: 'mcp:list-system-types', handler: 'handleListSystemTypes',
    meta: 'lees', titel: 'List system types', readOnly: true, destructive: false },
  // Registreren kan een bestaande, onbewerkte mcp:-definitie vervangen en
  // alle systemen ermee hertekenen: dat wijzigt bestaande gegevens.
  { naam: 'app_register_system_type', kanaal: 'mcp:register-system-type', handler: 'handleRegisterSystemType',
    meta: 'wijzigt', titel: 'Register system type', readOnly: false, destructive: true },
  { naam: 'app_update_system_type', kanaal: 'mcp:update-system-type', handler: 'handleUpdateSystemType',
    meta: 'wijzigt', titel: 'Update system type', readOnly: false, destructive: true },
  { naam: 'app_open_system_type_editor', kanaal: 'mcp:open-system-type-editor', handler: 'handleOpenSystemTypeEditor',
    meta: 'lees', titel: 'Open system type editor', readOnly: true, destructive: false },
  { naam: 'app_get_system_geometry', kanaal: 'mcp:get-system-geometry', handler: 'handleGetSystemGeometry',
    meta: 'lees', titel: 'Get system geometry', readOnly: true, destructive: false },
];

const BESCHRIJVINGEN = {
  app_list_system_types: 'List the reusable system types (suspended ceilings, floor slabs, panel systems) of the app library, or one type by id. Each entry has its stable id, owner, revision, whether the user edited it, the validated definition, unconfirmed dimensions and stored values that fail validation. Compare libraryRevision between calls to detect changes. Reads only.',
  app_register_system_type: 'Register a system type owned by MCP under the id mcp:<key>. Repeating the call with the same definition changes nothing (status unchanged), and a definition the user edited in the app is kept (status kept-user-edit) and never overwritten. A different definition replaces an existing mcp:<key> type that the user has not edited (status updated) and redraws every system that uses it. Unknown fields, out-of-range values and layered definitions are rejected. Missing dimensions stay unconfirmed.',
  app_update_system_type: 'Update a system type owned by MCP (id mcp:<key>). Pass the revision you last read as expectedRevision; a stale revision is rejected with the current revision. Types of the app or of extensions cannot be changed here. Nested values (sparingRegels, paneelTypen) are replaced as a whole; null clears an optional field.',
  app_open_system_type_editor: 'Open the app\'s system type editor with the given type selected, or select it in the editor that is already open without discarding unapplied edits. Returns immediately; the user applies or cancels in the app. Does not change any data.',
  app_get_system_geometry: 'Get the geometry of one system (suspended ceiling, floor slab, panel field) in the active document, computed by the app\'s own geometry engine: panels with clipped outlines, grid lines, openings, trimmers, edge segments and component positions, in millimetres in the system\'s own frame (independent of zoom and view rotation; placement maps it onto the page). Includes the document and type revisions and whether every physical dimension is confirmed. Pass expectedDocumentRevision and expectedTypeRevision to reject a stale snapshot. Reads only.',
};

const DEFINITIE_SCHEMA = {
  type: 'object',
  properties: {
    naam: { type: 'string', description: 'Display name (1-200 characters). Not an identity: references use the id.' },
    categorie: { type: 'string', enum: ['plafond', 'vloer', 'wand', 'overig'] },
    layout: { type: 'string', enum: ['raster', 'strook'], description: 'raster: cells in two directions (needs celXMm and celYMm). strook: strips in one direction (needs strookBreedteMm and celYMm).' },
    ifcCategory: { type: 'string', enum: ['IfcCovering', 'IfcWall', 'IfcSlab', 'IfcPlate'] },
    ifcPredefinedType: { type: ['string', 'null'], enum: ['CEILING', 'FLOORING', 'FLOOR', 'CLADDING', 'ROOFING', null] },
    celXMm: { type: ['number', 'null'], minimum: 50, maximum: 20000, description: 'Cell width in mm. Left out or null: unconfirmed, no default is applied.' },
    celYMm: { type: ['number', 'null'], minimum: 50, maximum: 20000, description: 'Cell height in mm. Left out or null: unconfirmed, no default is applied.' },
    strookBreedteMm: { type: ['number', 'null'], minimum: 50, maximum: 20000, description: 'Strip width in mm for the strook layout. Left out or null: unconfirmed.' },
    edgeProfiel: { type: 'string', enum: ['geen', 'hoeklijn', 'schaduwvoeg'] },
    sparingRegels: { type: ['object', 'null'], properties: {
      kleineSparingMaxMm: { type: 'number', minimum: 10, maximum: 20000 },
      raveelVanafMm: { type: 'number', minimum: 10, maximum: 20000 } },
    additionalProperties: false },
    paneelTypen: { type: 'array', minItems: 1, maxItems: 50, items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        naam: { type: 'string' },
        renderStijl: { type: 'string', enum: ['tegel', 'ventilatie', 'licht'] } },
      required: ['id', 'naam', 'renderStijl'],
      additionalProperties: false } },
    lagen: { type: 'array', maxItems: 0, description: 'Reserved. Schema 1 has one implicit layer; only an empty array is accepted.' },
  },
  additionalProperties: false,
};

const VERWACHTE_SCHEMAS = {
  app_list_system_types: { type: 'object', properties: { id: { type: 'string', description: 'Stable id of one system type.' } }, additionalProperties: false },
  app_register_system_type: { type: 'object', properties: {
    key: { type: 'string', description: 'Stable key: lowercase letters, digits, dot, underscore or hyphen (1-64).' },
    definition: { ...DEFINITIE_SCHEMA, required: ['naam', 'categorie', 'layout'] },
    schema: { type: 'integer', enum: [1] },
    restore: { type: 'boolean', description: 'Recreate a type the user removed. Only on an explicit user request.' },
  }, required: ['key', 'definition'], additionalProperties: false },
  app_update_system_type: { type: 'object', properties: {
    id: { type: 'string' },
    expectedRevision: { type: 'integer', minimum: 1 },
    changes: DEFINITIE_SCHEMA,
    schema: { type: 'integer', enum: [1] },
  }, required: ['id', 'expectedRevision', 'changes'], additionalProperties: false },
  app_open_system_type_editor: { type: 'object', properties: { id: { type: 'string', description: 'Stable id of the system type to select.' } }, required: ['id'], additionalProperties: false },
  app_get_system_geometry: { type: 'object', properties: {
    annotationId: { type: 'string', description: 'Id of the system annotation (type systeemraster) in the active document.' },
    expectedDocumentRevision: { type: 'string', description: 'document.revision of an earlier snapshot; a different current revision is rejected.' },
    expectedTypeRevision: { type: 'integer', minimum: 1, description: 'type.revision of an earlier snapshot; a different current revision is rejected.' },
    schema: { type: 'integer', enum: [1] },
  }, required: ['annotationId'], additionalProperties: false },
};

/** De json!-literal van een Rust-functie als JSON (de functies zijn letterlijk). */
function rustDescriptor(bron, functie) {
  const start = bron.indexOf(`fn ${functie}(`);
  assert.ok(start >= 0, `${functie} in mcp_server.rs`);
  const open = bron.indexOf('json!(', start) + 'json!('.length;
  let diepte = 0;
  let i = open;
  for (; i < bron.length; i++) {
    const c = bron[i];
    if (c === '"') { i++; while (bron[i] !== '"') { if (bron[i] === '\\') i++; i++; } continue; }
    if (c === '{' || c === '[') diepte++;
    if (c === '}' || c === ']') { diepte--; if (diepte === 0) break; }
  }
  const tekst = bron.slice(open, i + 1)
    .replace(/system_type_definition_schema\(true\)/g, '"__DEF_REGISTREREN__"')
    .replace(/system_type_definition_schema\(false\)/g, '"__DEF_BIJWERKEN__"');
  return JSON.parse(tekst);
}

function rustDefinitieSchema(bron) {
  const d = rustDescriptor(bron, 'system_type_definition_schema');
  assert.ok(/if register \{\s*schema\["required"\] = json!\(\["naam", "categorie", "layout"\]\);\s*\}/.test(bron),
    'registreren voegt de verplichte velden toe');
  return d;
}

const sorteer = (v) => (Array.isArray(v) ? v.map(sorteer)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorteer(v[k])])) : v);

test('de opdrachten staan in de brug, de Rust-server, de metatabel, tools.json en de manifest', () => {
  const brug = lees('open-pdf-studio/js/mcp-bridge.js');
  const server = lees('open-pdf-studio/src-tauri/src/mcp_server.rs');
  const meta = lees('open-pdf-studio/src-tauri/src/mcp_tool_meta.rs');
  const tools = JSON.parse(lees('mcp-stdio/tools.json'));
  const manifest = JSON.parse(lees('mcpb/manifest.json'));
  const definitie = rustDefinitieSchema(server);
  assert.deepEqual(definitie, DEFINITIE_SCHEMA, 'het definitieschema in Rust is dat uit het ontwerp');
  for (const t of TOOLS) {
    assert.match(brug, new RegExp(`'${t.kanaal}':\\s+${t.handler},`), `${t.kanaal} in de HANDLERS`);
    assert.match(brug, new RegExp(`async function ${t.handler}\\(`), `${t.handler} bestaat`);
    assert.match(server, new RegExp(`"${t.naam}"\\s+=> tool_app_request\\(state, "${t.kanaal}",\\s+&arguments, Duration::from_secs\\(10\\)\\)\\.await,`),
      `${t.naam}: dispatch met kanaal en 10 s`);
    assert.ok(meta.includes(`${t.meta}("${t.naam}", "${t.titel}"),`), `${t.naam} in mcp_tool_meta.rs`);
    assert.ok(manifest.tools.some((m) => m.name === t.naam), `${t.naam} in manifest.json`);

    const functie = `${t.naam.replace(/^app_/, '')}_tool`;
    const rust = rustDescriptor(server, functie);
    assert.equal(rust.name, t.naam);
    assert.equal(rust.description, BESCHRIJVINGEN[t.naam], `${t.naam}: letterlijke beschrijving`);
    const schema = JSON.parse(JSON.stringify(rust.inputSchema), (k, v) => (
      v === '__DEF_REGISTREREN__' ? { ...definitie, required: ['naam', 'categorie', 'layout'] }
        : v === '__DEF_BIJWERKEN__' ? definitie : v));
    assert.deepEqual(schema, VERWACHTE_SCHEMAS[t.naam], `${t.naam}: schema`);
    assert.ok(server.includes(`${functie}()`), `${functie}() staat in de lijst`);

    const opSchijf = tools.find((x) => x.name === t.naam);
    assert.ok(opSchijf, `${t.naam} in tools.json`);
    assert.equal(opSchijf.description, rust.description, 'byte-gelijk aan Rust');
    assert.deepEqual(opSchijf.inputSchema, schema);
    assert.equal(JSON.stringify(opSchijf.inputSchema), JSON.stringify(sorteer(schema)), 'sleutels alfabetisch, zoals serde');
    assert.deepEqual(opSchijf.annotations, {
      destructiveHint: t.destructive, openWorldHint: false, readOnlyHint: t.readOnly, title: t.titel,
    });
  }
  // Aaneengesloten na app_facade_element, in de volgorde van de server; de
  // opdrachttool (#575) en de extensietools (extensie_tools()) komen daar nog achter.
  const start = tools.findIndex((t) => t.name === 'app_facade_element') + 1;
  assert.deepEqual(tools.slice(start, start + TOOLS.length).map((t) => t.name), TOOLS.map((t) => t.naam));
  assert.equal(tools.length, 97);
});
