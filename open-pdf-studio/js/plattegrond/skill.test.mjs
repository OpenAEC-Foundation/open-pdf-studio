import assert from 'node:assert/strict';
import test from 'node:test';

import { PLATTEGROND_SKILL, PLATTEGROND_PROMPT, INRICHTING_PROMPT } from './skill.js';
import { SANITAIR_TEMPLATES } from '../symbols/templates/sanitair.js';
import { KEUKEN_TEMPLATES, ONDERDEEL_SOORTEN } from '../symbols/templates/keuken.js';
import { ANKERS } from '../symbols/anker.js';
import { FLOORPLAN_ACTIES } from './mcp-plattegrond.js';
import { FACADE_ACTIES } from '../gevelelement/mcp-gevelelement.js';
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

test('inrichten: de instructie noemt elk sanitair- en keukensymbool met zijn parameters', () => {
  assert.ok(PLATTEGROND_PROMPT.endsWith(INRICHTING_PROMPT), 'onderdeel van de plattegrond-instructie');
  for (const stuk of ['app_create_annotation', 'parametricSymbol', 'anchor', 'app_update_annotation', 'app_get_annotation']) {
    assert.ok(INRICHTING_PROMPT.includes(stuk), stuk);
  }
  for (const anker of Object.keys(ANKERS).filter((a) => a !== 'center')) {
    assert.ok(INRICHTING_PROMPT.includes(`anchor:"${anker}"`) || INRICHTING_PROMPT.includes(`"${anker}"`), anker);
  }
  // Elk symbool uit de palet-categorieën, met de sleutels van zijn parameters,
  // zodat een nieuwe parameter niet stil buiten de instructie valt.
  for (const t of [...SANITAIR_TEMPLATES, ...KEUKEN_TEMPLATES]) {
    assert.ok(INRICHTING_PROMPT.includes(`"${t.id}"`), `symbool ${t.id}`);
    for (const p of t.params) assert.ok(INRICHTING_PROMPT.includes(p.key), `${t.id}.${p.key}`);
  }
  for (const soort of Object.keys(ONDERDEEL_SOORTEN)) {
    assert.ok(INRICHTING_PROMPT.includes(soort), `onderdeel ${soort}`);
  }
  // De genoemde standaardmaten zijn die van de templates.
  for (const t of SANITAIR_TEMPLATES) {
    const { width, height } = t.realSizeMm({});
    assert.ok(INRICHTING_PROMPT.includes(`"${t.id}" {breedte ${width}, diepte ${height}`), `${t.id} ${width}x${height}`);
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
    'chainOf', 'addPoints', 'removePoints', '2 mm', 'names:', 'tagIds', 'RUIMTE zelf']) {
    assert.ok(PLATTEGROND_PROMPT.includes(stuk), `de instructie noemt ${stuk}`);
  }
  assert.ok(!PLATTEGROND_PROMPT.includes('offsetMm:500'), 'geen vaste offset meer voorgeschreven: de standaard groeit mee met de schaal');
  // De vier acties van de opdracht komen allemaal in de instructie voor.
  for (const a of FLOORPLAN_ACTIES) {
    assert.ok(PLATTEGROND_PROMPT.includes(`action:"${a}"`) || PLATTEGROND_PROMPT.includes(`"${a}"`), a);
  }
});

test('de instructie beschrijft het gevelelement (vliesgevel, kozijn) en al zijn acties', () => {
  for (const stuk of [
    'app_facade_element', 'curtainWall', 'windowFrame', 'wallId', 'fromMm', 'lengthMm',
    'fieldWidthsMm', 'hinge', 'swing', 'kader',
  ]) assert.ok(PLATTEGROND_PROMPT.includes(stuk), `de instructie noemt ${stuk}`);
  for (const a of FACADE_ACTIES) {
    assert.ok(PLATTEGROND_PROMPT.includes(`action:"${a}"`), `actie ${a}`);
  }
});

test('de instructie heeft een eigen blok over kozijnen en spouwmuren', () => {
  const blok = PLATTEGROND_PROMPT.slice(PLATTEGROND_PROMPT.indexOf('KOZIJNEN EN SPOUWMUREN'));
  assert.ok(blok.length > 100, 'het blok staat in de instructie');
  for (const stuk of [
    'layers', 'insideSide', 'BUITENVLAK', 'KOZIJNMAAT', 'aanslag', 'speling',
    'framePositionMm', 'overlapMm', 'clearanceMm', 'stileWidthMm', 'frameDepthMm', 'leafThicknessMm',
    'layerOpeningsMm', 'corners', 'windowType', 'turn', '67 x 114',
  ]) assert.ok(blok.includes(stuk), `het kozijnblok noemt ${stuk}`);
});
