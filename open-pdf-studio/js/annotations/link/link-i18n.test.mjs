// De teksten van de links (#953) staan in elke taal, met de Engelse
// plaatshouders; Nederlands en Italiaans (de melders) zijn echt vertaald. En
// elke sleutel die de code gebruikt, bestaat in het Engels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const map = fileURLToPath(new URL('../../i18n/locales/', import.meta.url));
const talen = readdirSync(map);
const json = (taal, ns) => JSON.parse(readFileSync(`${map}${taal}/${ns}.json`, 'utf8'));
const pad = (o, p) => p.split('.').reduce((v, k) => v?.[k], o);
const plaatshouders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const bron = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const SLEUTELS = {
  dialogs: Object.keys(json('en', 'dialogs').link).map((k) => `link.${k}`),
  ribbon: ['comment.link', 'comment.linkTitle'],
  context: ['textSelection.linkSelection'],
  common: ['mobileMore.insertLink'],
  properties: ['types.link'],
};

test('every locale has the link strings with the English placeholders', () => {
  assert.ok(SLEUTELS.dialogs.length > 20);
  for (const [ns, sleutels] of Object.entries(SLEUTELS)) {
    const en = json('en', ns);
    for (const taal of talen) {
      const t = json(taal, ns);
      for (const s of sleutels) {
        const waarde = pad(t, s);
        assert.equal(typeof waarde, 'string', `${taal}/${ns}: ${s}`);
        assert.ok(waarde.trim(), `${taal}/${ns}: ${s} is empty`);
        assert.deepEqual(plaatshouders(waarde), plaatshouders(pad(en, s)), `${taal}/${ns}: ${s} placeholders`);
      }
    }
  }
});

test('Dutch and Italian are translated', () => {
  for (const taal of ['nl', 'it']) {
    assert.notEqual(json(taal, 'dialogs').link.title, json('en', 'dialogs').link.title, taal);
    assert.notEqual(json(taal, 'common').mobileMore.insertLink, json('en', 'common').mobileMore.insertLink, taal);
    assert.notEqual(json(taal, 'context').textSelection.linkSelection, json('en', 'context').textSelection.linkSelection, taal);
  }
});

test('the keys the link code uses exist', () => {
  const en = json('en', 'dialogs');
  const bestanden = [
    '../../solid/components/dialogs/LinkDialog.jsx',
    '../../solid/components/properties-panel/LinkSection.jsx',
    './link-volgen.js',
    '../../tools/tools/select-tool.js',
  ];
  for (const b of bestanden) {
    for (const m of bron(b).matchAll(/\bt\('(link\.\w+)'/g)) {
      assert.equal(typeof pad(en, m[1]), 'string', `${b}: ${m[1]}`);
    }
  }
  assert.match(bron('../../tools/tools/select-tool.js'), /'link\.followHint'/);
});
