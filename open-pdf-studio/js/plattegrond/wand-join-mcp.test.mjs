// Wandjoin via MCP (#476): app_floorplan action:"wall" met joinStart /
// joinEnd, inspect meldt de stand, en de buitenkant (Rust-schema, tools.json)
// kent de argumenten. app_update_annotation zet noJoinStart / noJoinEnd als
// gewone eigenschap; dat pad is generiek en wordt hier niet opnieuw getoetst.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { plattegrondOpdracht } from './mcp-plattegrond.js';
import { PLATTEGROND_PROMPT } from './skill.js';

const K = 0.5;                                    // paginapunten per mm

function omgevingMet(annotaties = []) {
  const doc = { currentPage: 1, annotations: annotaties, paginas: 1 };
  let teller = 0;
  return {
    doc,
    pxPerMmAt: () => K,
    async maak(type, page, props) {
      const ann = { id: `a${++teller}`, type, page, ...props };
      doc.annotations.push(ann);
      return { ok: true, id: ann.id };
    },
    async werkBij(id, props) {
      const a = doc.annotations.find((x) => x.id === id);
      if (!a) return { ok: false };
      Object.assign(a, props);
      return { ok: true };
    },
    async transactie(fn) { await fn(); },
  };
}

const gevelMetDeur = {
  action: 'wall',
  start: { x: 0, y: 100 }, end: { x: 5000, y: 100 },
  thicknessMm: 120,
  material: 'nen47-metselwerk-kunststeen',
  openings: [{ kind: 'door', widthMm: 900, alongMm: 2000 }],
};

test('standaard krijgt geen enkel wandstuk een join-vlag', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht(gevelMetDeur, o);
  assert.equal(r.ok, true);
  for (const w of o.doc.annotations.filter((a) => a.type === 'wall')) {
    assert.equal('noJoinStart' in w, false);
    assert.equal('noJoinEnd' in w, false);
  }
});

test('joinStart:false / joinEnd:false gelden voor het begin en het eind van de LOOP', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht({ ...gevelMetDeur, joinStart: false, joinEnd: false }, o);
  assert.equal(r.ok, true);
  const wanden = r.wallIds.map((id) => o.doc.annotations.find((a) => a.id === id));
  assert.equal(wanden.length, 2, 'de deur knipt de loop in tweeën');
  assert.equal(wanden[0].noJoinStart, true, 'begin van de loop');
  assert.equal('noJoinEnd' in wanden[0], false, 'dit einde ligt bij de deur');
  assert.equal('noJoinStart' in wanden[1], false, 'dit begin ligt bij de deur');
  assert.equal(wanden[1].noJoinEnd, true, 'eind van de loop');
});

test('alleen joinEnd:false; joinStart:true verandert niets', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, joinStart: true, joinEnd: false,
  }, o);
  const [w] = r.wallIds.map((id) => o.doc.annotations.find((a) => a.id === id));
  assert.equal('noJoinStart' in w, false);
  assert.equal(w.noJoinEnd, true);
});

test('inspect meldt per wand of de join aan elk uiteinde aan staat', async () => {
  const o = omgevingMet();
  await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, joinStart: false,
  }, o);
  const r = await plattegrondOpdracht({ action: 'inspect' }, o);
  assert.equal(r.walls.length, 1);
  assert.equal(r.walls[0].joinStart, false);
  assert.equal(r.walls[0].joinEnd, true);
});

test('het MCP-schema van app_floorplan kent joinStart en joinEnd (Rust en tools.json)', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const server = lees('../../src-tauri/src/mcp_server.rs');
  const floorplan = server.slice(server.indexOf('fn floorplan_tool()'), server.indexOf('fn handle_tools_list()'));
  for (const arg of ['joinStart', 'joinEnd']) {
    assert.match(floorplan, new RegExp(`"${arg}":\\s*\\{ "type": "boolean"`), `${arg} in mcp_server.rs`);
  }
  const tools = JSON.parse(lees('../../../mcp-stdio/tools.json'));
  const t = tools.find((x) => x.name === 'app_floorplan');
  for (const arg of ['joinStart', 'joinEnd']) {
    assert.equal(t.inputSchema.properties[arg]?.type, 'boolean', `${arg} in tools.json`);
  }
});

test('de plattegrond-instructie noemt de join-argumenten en de spouwmuuropbouw', () => {
  for (const stuk of ['joinStart', 'joinEnd', 'noJoinStart', 'noJoinEnd', 'app_update_annotation']) {
    assert.ok(PLATTEGROND_PROMPT.includes(stuk), `de instructie noemt ${stuk}`);
  }
  // Nederlandse spouwmuur, van buiten naar binnen.
  for (const stuk of ['metselwerk 100', 'luchtspouw 40', 'isolatie 100', 'kalkzandsteen 120', '360']) {
    assert.ok(PLATTEGROND_PROMPT.includes(stuk), `de instructie noemt ${stuk}`);
  }
});
