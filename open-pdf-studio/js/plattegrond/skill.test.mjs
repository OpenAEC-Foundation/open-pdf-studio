import assert from 'node:assert/strict';
import test from 'node:test';

import { PLATTEGROND_SKILL, PLATTEGROND_PROMPT } from './skill.js';
import { FLOORPLAN_ACTIES } from './mcp-plattegrond.js';
import { ASSISTANT_SKILLS, SKILLS_SYSTEM_PROMPT } from '../assistant-skills.js';

test('de vaardigheid staat als chip in het assistentvenster', () => {
  const chip = ASSISTANT_SKILLS.find((s) => s.id === 'floorplan');
  assert.equal(chip, PLATTEGROND_SKILL, 'als eigen element in de lijst');
  assert.ok(chip.label && chip.icon && chip.hint, 'een chip heeft een naam, een teken en een uitleg');
  assert.equal(chip.needsInput, true, 'de gebruiker vult aan wat er getekend moet worden');
  assert.equal(new Set(ASSISTANT_SKILLS.map((s) => s.id)).size, ASSISTANT_SKILLS.length, 'geen dubbele id');
  // De bestaande vaardigheden blijven staan; deze komt erachteraan.
  assert.equal(ASSISTANT_SKILLS[ASSISTANT_SKILLS.length - 1].id, 'floorplan');
  for (const id of ['translate', 'summarize', 'draw', 'detect-doors']) {
    assert.ok(ASSISTANT_SKILLS.some((s) => s.id === id), id);
  }
});

test('de instructie voor het model noemt de opdracht, de eenheden en de volgorde', () => {
  assert.ok(SKILLS_SYSTEM_PROMPT.endsWith(PLATTEGROND_PROMPT), 'achteraan toegevoegd');
  for (const stuk of [
    'app_floorplan', 'app_set_measure_scale', 'app_get_viewport_state',
    'paginapunten', 'MILLIMETERS',
    'alongMm', 'openTo', 'openEnds', 'refresh:true', 'undo',
  ]) assert.ok(PLATTEGROND_PROMPT.includes(stuk), `de instructie noemt ${stuk}`);
  // #477: maten aan het wandvlak en de buitenhoek, ruimtetag in plaats van een
  // los tekstvak, ruimten achter de wanden, alleen het getal.
  for (const stuk of ['WANDVLAK', 'buitenhoek', 'buitenste laag', 'ruimtetag', 'los tekstvak', 'ACHTER', 'showUnit', 'number',
    'chainOf', 'addPoints', 'removePoints', '2 mm']) {
    assert.ok(PLATTEGROND_PROMPT.includes(stuk), `de instructie noemt ${stuk}`);
  }
  assert.ok(!PLATTEGROND_PROMPT.includes('offsetMm:500'), 'geen vaste offset meer voorgeschreven: de standaard groeit mee met de schaal');
  // De vier acties van de opdracht komen allemaal in de instructie voor.
  for (const a of FLOORPLAN_ACTIES) {
    assert.ok(PLATTEGROND_PROMPT.includes(`action:"${a}"`) || PLATTEGROND_PROMPT.includes(`"${a}"`), a);
  }
});
