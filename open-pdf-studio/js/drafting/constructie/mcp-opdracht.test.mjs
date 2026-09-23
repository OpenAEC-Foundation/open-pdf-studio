// De bedrading van app_structural_layout: de opdracht moet in alle lagen
// hetzelfde heten en hetzelfde schema hebben (Rust-brug, meegeleverde
// gereedschapslijst, extensie-manifest, JS-brug), en elk veld in dat schema
// moet in de rekenmodule landen. Drift tussen die lagen valt hier om.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { BRUG_SLEUTELS, OPGAVE_SLEUTELS, normaliseerOpgave } from './constructieplan.js';

const OPDRACHT = 'app_structural_layout';
const KANAAL = 'mcp:structural-layout';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const leesJson = (pad) => JSON.parse(lees(pad));

const TOOLS = leesJson('../../../../mcp-stdio/tools.json');
const SCHEMA = TOOLS.find(t => t.name === OPDRACHT)?.inputSchema;

test('de opdracht staat in de meegeleverde gereedschapslijst', () => {
  assert.ok(SCHEMA, `${OPDRACHT} ontbreekt in mcp-stdio/tools.json`);
  assert.equal(SCHEMA.type, 'object');
  assert.equal(SCHEMA.additionalProperties, false, 'onbekende velden horen geweigerd te worden');
  assert.deepEqual(SCHEMA.required, ['origin', 'baysX', 'baysY']);
});

test('de opdracht staat in het extensie-manifest', () => {
  const manifest = leesJson('../../../../mcpb/manifest.json');
  const item = manifest.tools.find(t => t.name === OPDRACHT);
  assert.ok(item, `${OPDRACHT} ontbreekt in mcpb/manifest.json`);
  assert.ok(item.description && item.description.length > 20);
});

test('de Rust-brug kent de opdracht, stuurt hem door en bewaakt hem in zijn test', () => {
  const rs = lees('../../../src-tauri/src/mcp_server.rs');
  assert.ok(rs.includes(`"name": "${OPDRACHT}"`), 'geen schema in mcp_server.rs');
  const regel = rs.split(/\r?\n/).find(l => l.includes(`"${OPDRACHT}"`) && l.includes('tool_app_request'));
  assert.ok(regel, 'geen doorstuurregel in mcp_server.rs');
  assert.ok(regel.includes(`"${KANAAL}"`), `de doorstuurregel noemt ${KANAAL} niet`);
  const m = /Duration::from_secs\((\d+)\)/.exec(regel);
  // Een heel raster uitzetten duurt langer dan een losse annotatie maken.
  assert.ok(m && Number(m[1]) >= 30, 'de tijdgrens is te krap voor een heel raster');

  const meta = lees('../../../src-tauri/src/mcp_tool_meta.rs');
  assert.ok(meta.includes(`"${OPDRACHT}"`), `${OPDRACHT} ontbreekt in de metatabel`);
});

test('de JS-brug koppelt het kanaal aan een behandelaar', () => {
  const brug = lees('../../mcp-bridge.js');
  assert.match(brug, new RegExp(`'${KANAAL}':\\s*handleStructuralLayout`));
  assert.ok(brug.includes('handleStructuralLayout'), 'geen behandelaar in mcp-bridge.js');
  // Het plan tekent balken als betonbalk; die moet over MCP te maken zijn.
  assert.match(brug, /type === 'betonbalk'/);
  assert.match(brug, /case 'betonbalk':/);
});

test('elk veld uit het schema landt in de rekenmodule', () => {
  const bekend = new Set([...OPGAVE_SLEUTELS, ...BRUG_SLEUTELS]);
  const velden = Object.keys(SCHEMA.properties);
  assert.ok(velden.length >= 15);
  for (const veld of velden) {
    const vertaald = Object.keys(normaliseerOpgave({ [veld]: 1 }));
    assert.equal(vertaald.length, 1, `${veld} vertaalt niet naar precies een sleutel`);
    assert.ok(bekend.has(vertaald[0]), `${veld} landt op de onbekende sleutel '${vertaald[0]}'`);
  }
});

test('de keuzelijsten in het schema zijn waarden die de module begrijpt', () => {
  for (const veld of ['labelStyleX', 'labelStyleY']) {
    for (const waarde of SCHEMA.properties[veld].enum) {
      const uit = normaliseerOpgave({ [veld]: waarde });
      assert.ok(['letters', 'cijfers'].includes(Object.values(uit)[0]), `${veld}=${waarde}`);
    }
  }
  // De richtingen staan in de beschrijvingen; controleer dat ze vertaald worden.
  assert.equal(normaliseerOpgave({ beams: { direction: 'both' } }).balken.richting, 'beide');
  assert.equal(normaliseerOpgave({ floors: { direction: 'shortest' } }).vloeren.richting, 'kortste');
});
