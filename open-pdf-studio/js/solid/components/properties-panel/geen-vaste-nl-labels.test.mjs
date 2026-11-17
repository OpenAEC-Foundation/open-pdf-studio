// Properties-panel sections must not render hard-coded Dutch display text
// (#1151): the wall, concrete beam and system grid sections once showed
// Dutch labels whatever the app language. This is a source check: outside
// comments, none of the Dutch display words found back then may appear in a
// section component, and every language has the keys the sections ask for.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const MAP = new URL('./', import.meta.url);
const LOCALES = new URL('../../../i18n/locales/', import.meta.url);
const lees = (url) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');

// Display words as they were written in the sections (case-sensitive, whole
// words). Stored values such as 'geen', 'tonen' or 'hoeklijn' are lower case
// and stay what they are, so existing documents keep working.
const WOORDEN = [
  'Wand', 'Dikte', 'Materiaal', 'Isolatiemateriaal', 'Metselwerk', 'Kalkzandsteen',
  'Isolatie', 'Geen', 'Steenwol', 'Glaswol', 'Betonbalk', 'Profiel', 'Aangepast',
  'Breedte', 'Hoogte', 'Lijnstijl', 'Doorgetrokken', 'Gestippeld', 'Hartlijn',
  'Tagtekst', 'Systeem', 'Systeemtype', 'Typen', 'Strookbreedte', 'Celmaat',
  'Plaatbreedte', 'Plaathoogte', 'onbevestigd', 'Sparing', 'Randprofiel',
  'Hoeklijn', 'Schaduwvoeg', 'Rasterhoek', 'Centreer',
  'Randconditie', 'Gesneden', 'Minimale', 'Onderdeel', 'Paneeltype', 'Ander',
  'Afmeting', 'Lengte', 'Strook', 'Positie', 'Klein', 'Raveelijzer',
  'Verzwaarde', 'Rasterlijn', 'Richting', 'Randstukken', 'Links', 'Rechts',
  'Boven', 'Onder', 'verticaal', 'horizontaal', 'vanaf', 'Meet',
];

// Source without comments: block comments (also the JSX form) and line
// comments that start a line or follow whitespace.
const zonderCommentaar = (bron) => bron
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1');

const secties = readdirSync(MAP).filter((f) => f.endsWith('.jsx'));

test('no section component contains a hard-coded Dutch display word', () => {
  assert.ok(secties.length >= 30, `${secties.length} components`);
  const gevonden = [];
  for (const bestand of secties) {
    const regels = zonderCommentaar(lees(new URL(bestand, MAP))).split('\n');
    regels.forEach((regel, i) => {
      for (const woord of WOORDEN) {
        if (new RegExp(`(?<![\\w.'-])${woord}(?![\\w'-])`).test(regel)) gevonden.push(`${bestand}:${i + 1} ${woord}`);
      }
    });
  }
  assert.deepEqual(gevonden, []);
});

test('the check itself catches a Dutch label and leaves stored values alone', () => {
  const raakt = (regel) => WOORDEN.some((w) => new RegExp(`(?<![\\w.'-])${w}(?![\\w'-])`).test(regel));
  assert.ok(raakt('<label>Dikte (mm)</label>'));
  assert.ok(raakt('<CollapsibleSection title="Wand" name="wall">'));
  assert.ok(raakt('/> Hartlijn tonen'));
  assert.ok(!raakt('<option value="geen">{t(\'systeemraster.edge.geen\')}</option>'));
  assert.ok(!raakt('const breedte = () => annotProps.plaatBreedteMm;'));
  assert.ok(!raakt('// Breedte in mm') || zonderCommentaar('// Breedte in mm').trim() === '');
});

// Every t('wall.…' | 'betonbalk.…' | 'systeemraster.…' | 'scaleRegion.…')
// the sections ask for exists in every language, and is not empty.
test('all languages have the keys of the building-element sections', () => {
  const sleutels = new Set();
  for (const bestand of ['WallSection.jsx', 'BetonbalkSection.jsx', 'SysteemrasterSection.jsx', 'PropertiesPanel.jsx']) {
    const bron = lees(new URL(bestand, MAP));
    for (const m of bron.matchAll(/\bt\('((?:wall|betonbalk|systeemraster|scaleRegion)\.[\w.-]+)'/g)) sleutels.add(m[1]);
  }
  assert.ok(sleutels.size >= 80, `${sleutels.size} keys`);
  const talen = readdirSync(LOCALES);
  const ontbreekt = [];
  for (const taal of talen) {
    const p = JSON.parse(lees(new URL(`${taal}/properties.json`, LOCALES)));
    for (const s of sleutels) {
      const v = s.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), p);
      if (typeof v !== 'string' || !v.trim()) ontbreekt.push(`${taal} ${s}`);
    }
  }
  assert.deepEqual(ontbreekt, []);
});

// The material tables keep their ids (stored in documents); each id that is
// not a proper name has a translated display name in English and Dutch.
test('wall materials keep their ids and have a display name per language', () => {
  // Read from the source: the module itself needs the app state.
  const bron = lees(new URL('../../../annotations/rendering/walls.js', import.meta.url));
  const tabel = (naam) => [...bron.split(`export const ${naam} = [`)[1].split('];')[0]
    .matchAll(/id: '([^']+)', label: '([^']+)'/g)].map((m) => ({ id: m[1], label: m[2] }));
  const WALL_MATERIALS = tabel('WALL_MATERIALS');
  const ISOLATIE_MATERIALEN = tabel('ISOLATIE_MATERIALEN');
  assert.deepEqual(WALL_MATERIALS.map((m) => m.id), [
    'nen47-metselwerk-baksteen', 'nen47-metselwerk-kunststeen', 'nen47-beton-prefab',
    'nen47-beton-gewapend', 'isolatie', 'none',
  ]);
  assert.deepEqual(ISOLATIE_MATERIALEN.map((m) => m.id), ['steenwol', 'glaswol', 'pir', 'eps', 'kooltherm', 'pur']);
  const en = JSON.parse(lees(new URL('en/properties.json', LOCALES))).wall;
  const nl = JSON.parse(lees(new URL('nl/properties.json', LOCALES))).wall;
  for (const m of WALL_MATERIALS) {
    assert.ok(en.materials[m.id], `en ${m.id}`);
    assert.equal(nl.materials[m.id], m.label, `nl ${m.id}`);
    assert.notEqual(en.materials[m.id], nl.materials[m.id], m.id);
  }
  assert.deepEqual(Object.keys(en.insulation), ['steenwol', 'glaswol']);
  assert.equal(en.title, 'Wall');
  assert.equal(nl.title, 'Wand');
});
