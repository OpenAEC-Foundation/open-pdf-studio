import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import { CONSTRUCTIEOVERZICHT_SKILL, CONSTRUCTIEOVERZICHT_PROMPT } from './skill.js';
import { PLATTEGROND_PROMPT } from '../plattegrond/skill.js';
import { ASSISTANT_SKILLS, SKILLS_SYSTEM_PROMPT } from '../assistant-skills.js';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const alle = (re) => [...new Set([...CONSTRUCTIEOVERZICHT_PROMPT.matchAll(re)].map((m) => m[1]))];

test('de vaardigheid staat als chip in het assistentvenster', () => {
  const chip = ASSISTANT_SKILLS.find((s) => s.id === 'structural-overview');
  assert.equal(chip, CONSTRUCTIEOVERZICHT_SKILL, 'als eigen element in de lijst');
  assert.ok(chip.label && chip.icon && chip.hint, 'een chip heeft een naam, een teken en een uitleg');
  assert.equal(chip.needsInput, true, 'de gebruiker vult bron, bouwlagen en constructieprincipe aan');
  assert.equal(new Set(ASSISTANT_SKILLS.map((s) => s.id)).size, ASSISTANT_SKILLS.length, 'geen dubbele id');
  // Naast "Zet constructie uit"; de plattegrond blijft de laatste chip.
  const plek = ASSISTANT_SKILLS.indexOf(chip);
  assert.equal(ASSISTANT_SKILLS[plek - 1].id, 'structural-layout');
  assert.equal(ASSISTANT_SKILLS[ASSISTANT_SKILLS.length - 1].id, 'floorplan');
});

test('de instructie staat in de systeeminstructie, vóór de plattegrond', () => {
  assert.ok(SKILLS_SYSTEM_PROMPT.includes(CONSTRUCTIEOVERZICHT_PROMPT));
  assert.ok(SKILLS_SYSTEM_PROMPT.endsWith(PLATTEGROND_PROMPT), 'de plattegrond-instructie blijft achteraan');
  assert.ok(SKILLS_SYSTEM_PROMPT.indexOf(CONSTRUCTIEOVERZICHT_PROMPT) < SKILLS_SYSTEM_PROMPT.indexOf(PLATTEGROND_PROMPT));
});

test('elke genoemde MCP-opdracht bestaat in de gereedschapslijst', () => {
  const namen = new Set(JSON.parse(lees('../../../mcp-stdio/tools.json')).map((t) => t.name));
  const genoemd = alle(/\b(app_[a-z_]+)/g);
  assert.ok(genoemd.length >= 10, 'de instructie noemt de opdrachten bij naam');
  for (const naam of genoemd) assert.ok(namen.has(naam), `${naam} staat niet in mcp-stdio/tools.json`);
});

test('elke genoemde lintknop bestaat', () => {
  const map = new URL('../solid/components/ribbon/', import.meta.url);
  const lint = readdirSync(map).filter((f) => f.endsWith('.jsx')).map((f) => readFileSync(new URL(f, map), 'utf8')).join('\n');
  const knoppen = alle(/ribbon:#([\w-]+)/g);
  assert.deepEqual(knoppen.sort(), ['arr-send-back']);
  for (const id of knoppen) assert.ok(lint.includes(`id="${id}"`), `geen lintknop met id ${id}`);
});

test('elke genoemde lijnstijl kent de tekenroutine', () => {
  const routine = lees('../annotations/rendering/decorations.js');
  const stijlen = alle(/borderStyle "([\w-]+)"/g);
  assert.deepEqual(stijlen.sort(), ['dashed', 'long-dash']);
  for (const stijl of stijlen) assert.ok(routine.includes(`case '${stijl}':`), `lijnstijl ${stijl} onbekend`);
});

test('de conventies van een constructieoverzicht staan erin', () => {
  for (const stuk of [
    'ONDERLIGGENDE bouwlaag als onderlegger', 'GESTIPPELD', 'zonder lateien', 'opacity:0.2', 'op één lijn',
    'alleen het hellende dak', 'Platte daken op de hoogte van een verdiepingsvloer', 'kolommetjes',
    'koker 100x100', 'geen Rc-waarden', 'Raster-PDF', 'geen app_structural_layout',
  ]) assert.ok(CONSTRUCTIEOVERZICHT_PROMPT.includes(stuk), `de instructie noemt ${stuk}`);
});

// Opslaan en exporteren beslist de gebruiker. app_save_pdf zonder pad overschrijft
// het geopende sjabloon; de knop Raster-PDF opent vanuit de brug een opslagvenster
// en meldt al succes voordat er iets is weggeschreven.
test('de assistent slaat niet zelf op en exporteert niet zelf', () => {
  assert.ok(!/app_save_pdf/.test(CONSTRUCTIEOVERZICHT_PROMPT), 'geen app_save_pdf in de instructie');
  assert.ok(!CONSTRUCTIEOVERZICHT_PROMPT.includes('btn-home-raster-pdf'), 'de Raster-PDF-knop niet zelf indrukken');
  assert.ok(/Bied de gebruiker aan[^.]*Raster-PDF/.test(CONSTRUCTIEOVERZICHT_PROMPT), 'de Raster-PDF wordt aangeboden');
});
