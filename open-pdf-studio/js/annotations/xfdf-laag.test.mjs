// De laagnaam in XFDF (#468). XFDF kent geen lagen; de naam gaat mee in een
// eigen attribuut `opslayer`, zoals de andere eigen attributen (opstype, …).
// Een naam, geen id: een XFDF-bestand reist tussen documenten, en daar zegt
// alleen de naam iets. Andere programma's negeren het attribuut.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { laagAttribuut, laagUitAttribuut } from './xfdf-laag.js';
import { addLayer, getLayers, DEFAULT_LAYER_ID } from './annotatie-lagen.js';

test('exporteren: de laagnaam als attribuut, de standaardlaag zonder', () => {
  const doc = { annotations: [] };
  const a = addLayer(doc, { name: 'Constructie & "maatvoering" <1>' }).layer;
  assert.equal(laagAttribuut(doc, { layer: a.id }), ' opslayer="Constructie &amp; &quot;maatvoering&quot; &lt;1&gt;"');
  assert.equal(laagAttribuut(doc, {}), '');
  assert.equal(laagAttribuut(doc, { layer: 'onbekend' }), '', 'onbekend = standaardlaag');
  assert.equal(laagAttribuut({ annotations: [] }, {}), '', 'zonder lagen verandert de uitvoer niet');
  assert.equal(laagAttribuut(null, { layer: 'x' }), '');
});

test('importeren: een bekende laag op naam, ongeacht hoofdletters', () => {
  const doc = { annotations: [] };
  const a = addLayer(doc, { name: 'Constructie' }).layer;
  assert.deepEqual(laagUitAttribuut(doc, 'constructie'), { id: a.id, nieuw: false });
});

test('importeren: een onbekende laag wordt aangemaakt, één keer', () => {
  const doc = { annotations: [] };
  const r = laagUitAttribuut(doc, 'Ronde 2');
  assert.equal(r.nieuw, true);
  assert.equal(getLayers(doc).find((l) => l.id === r.id).name, 'Ronde 2');
  assert.deepEqual(laagUitAttribuut(doc, 'Ronde 2'), { id: r.id, nieuw: false });
  assert.equal(getLayers(doc).length, 2);
});

test('importeren zonder attribuut: de standaardlaag', () => {
  const doc = { annotations: [] };
  assert.deepEqual(laagUitAttribuut(doc, null), { id: DEFAULT_LAYER_ID, nieuw: false });
  assert.deepEqual(laagUitAttribuut(doc, '   '), { id: DEFAULT_LAYER_ID, nieuw: false });
  assert.equal(getLayers(doc).length, 1);
});

test('xfdf.js schrijft het attribuut bij elke annotatie en leest het bij het importeren', () => {
  const xfdf = readFileSync(new URL('./xfdf.js', import.meta.url), 'utf8');
  const common = xfdf.slice(xfdf.indexOf('function commonAttrs('));
  assert.match(common.slice(0, 1200), /laagAttribuut\(getActiveDocument\(\), ann\)/);
  const importeer = xfdf.slice(xfdf.indexOf('export function importFromXFDF('), xfdf.indexOf('// Convert a single annotation to XFDF'));
  assert.match(importeer, /laagUitAttribuut\(activeDoc, el\.getAttribute\('opslayer'\)\)/);
  assert.match(importeer, /assignLayer\(\[ann\], laag\.id\)/);
});
