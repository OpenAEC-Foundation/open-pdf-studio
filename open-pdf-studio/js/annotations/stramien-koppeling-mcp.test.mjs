// De stramienkoppeling over MCP: opvragen via app_get_annotation
// (gridAlignment) en omzetten via app_update_annotation (alignStart /
// alignEnd). De brug zelf draait alleen in de app; hier bewaken we dat alle
// lagen (JS-brug, Rust-schema, meegeleverde gereedschapslijst, skill-tekst)
// hetzelfde zeggen.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { SKILLS_SYSTEM_PROMPT } from '../assistant-skills.js';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const TOOLS = JSON.parse(lees('../../../mcp-stdio/tools.json'));
const beschrijving = (naam) => TOOLS.find(t => t.name === naam)?.description || '';

function blok(bron, begin) {
  const start = bron.indexOf(begin);
  assert.ok(start >= 0, `${begin} ontbreekt`);
  const volgende = bron.indexOf('\nasync function ', start + begin.length);
  return bron.slice(start, volgende > 0 ? volgende : undefined);
}

test('app_get_annotation meldt gridAlignment bij een stramienlijn', () => {
  const brug = lees('../mcp-bridge.js');
  const get = blok(brug, 'async function handleGetAnnotation(');
  assert.match(get, /isStramien\(ann\)/);
  assert.match(get, /gridAlignment = koppelMod\.koppelingOverzicht\(/);
});

test('app_update_annotation zet alignStart / alignEnd om als één ongedaan-stap', () => {
  const brug = lees('../mcp-bridge.js');
  const upd = blok(brug, 'async function handleUpdateAnnotation(');
  assert.match(upd, /'alignStart' in props/);
  assert.match(upd, /'alignEnd' in props/);
  // Geen velden op de annotatie: ze gaan uit de patch.
  assert.match(upd, /alignStart: _as, alignEnd: _ae, \.\.\.ruwePatch/);
  // Alleen voor een stramienlijn, alleen booleans.
  assert.match(upd, /only apply to a grid line/);
  assert.match(upd, /must be true \(couple\) or false \(unlock\)/);
  // Eén ongedaan-stap, ook samen met andere velden.
  assert.ok((upd.match(/beginUndoTransaction\(\)/g) || []).length >= 2);
  // Nieuwe params laten de koppeling staan.
  assert.match(upd, /bewaarKoppeling\(ann\.params, patch\.params\)/);
  // De schakelaar is dezelfde als die van het slotje en het paneel.
  assert.match(brug, /schakelStramienSlot\(ann, eind, aan, \{ doc, hertekenen: false \}\)/);
});

test('het schema van beide opdrachten noemt de koppeling, in Rust en in tools.json', () => {
  const rs = lees('../../src-tauri/src/mcp_server.rs');
  for (const naam of ['app_update_annotation', 'app_get_annotation']) {
    const tekst = beschrijving(naam);
    assert.ok(tekst, `${naam} ontbreekt in tools.json`);
    assert.ok(rs.includes(`"description": "${tekst}"`), `${naam}: beschrijving in mcp_server.rs wijkt af van tools.json`);
  }
  assert.match(beschrijving('app_update_annotation'), /alignStart/);
  assert.match(beschrijving('app_update_annotation'), /alignEnd/);
  assert.match(beschrijving('app_get_annotation'), /gridAlignment/);
});

test('de constructieskill legt de koppeling uit', () => {
  assert.match(SKILLS_SYSTEM_PROMPT, /GEKOPPELD/);
  assert.match(SKILLS_SYSTEM_PROMPT, /alignStart: false/);
  assert.match(SKILLS_SYSTEM_PROMPT, /alignEnd/);
  assert.match(SKILLS_SYSTEM_PROMPT, /gridAlignment/);
});
