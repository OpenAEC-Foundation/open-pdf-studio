import assert from 'node:assert/strict';
import test from 'node:test';

import {
  definitiesVan, definitieVan, startsetUitVoorkeuren, zorgVoorDefinities, neemDefinitieOver,
  pasCatalogusToe, gebruik, zetStiftenOver, kopieDefinities, zichtbareStiften,
} from './document.js';
import { standaardSet, maakDefinitie } from './definities.js';

test('een document zonder stiften heeft geen definities, en opzoeken faalt netjes', () => {
  const doc = { annotations: [] };
  assert.deepEqual(definitiesVan(doc), []);
  assert.equal(definitieVan(doc, 'x'), null);
  assert.equal(definitieVan(null, { stiftDefId: 'x' }), null);
});

test('startset: eigen set uit de voorkeuren, anders de ingebouwde', () => {
  assert.deepEqual(startsetUitVoorkeuren({}), standaardSet());
  assert.deepEqual(startsetUitVoorkeuren({ stiftStartset: [] }), standaardSet());
  const eigen = [maakDefinitie('latei', { id: 'eigen' })];
  assert.deepEqual(startsetUitVoorkeuren({ stiftStartset: eigen }).map((d) => d.id), ['eigen']);
});

test('de eerste stift geeft het document de startset, daarna blijft die staan', () => {
  const doc = {};
  const lijst = zorgVoorDefinities(doc, {});
  assert.equal(lijst.length, 11);
  lijst[0].omschrijving = 'aangepast';
  assert.equal(zorgVoorDefinities(doc, {})[0].omschrijving, 'aangepast');
  assert.equal(definitieVan(doc, { stiftDefId: 'sd-std-latei' }).soort, 'latei');
  // De kopie deelt niets met de ingebouwde set.
  assert.equal(standaardSet()[0].omschrijving, 'Bestaande wand');
});

test('overnemen: een onbekende definitie komt erbij, een bekende id niet', () => {
  const doc = {};
  assert.equal(neemDefinitieOver(doc, { id: 'a', soort: 'paal', omschrijving: 'Buispaal' }), true);
  assert.equal(neemDefinitieOver(doc, { id: 'a', soort: 'paal', omschrijving: 'Andere' }), false);
  assert.equal(neemDefinitieOver(doc, 'rommel'), false);
  assert.deepEqual(definitiesVan(doc).map((d) => d.omschrijving), ['Buispaal']);
});

test('de catalogus gaat voor op momentopnamen, alleen-momentopname blijft', () => {
  const doc = {};
  neemDefinitieOver(doc, { id: 'a', soort: 'paal', omschrijving: 'uit momentopname' });
  neemDefinitieOver(doc, { id: 'b', soort: 'latei', omschrijving: 'alleen momentopname' });
  pasCatalogusToe(doc, [{ id: 'a', soort: 'paal', omschrijving: 'uit catalogus' }]);
  assert.deepEqual(definitiesVan(doc).map((d) => [d.id, d.omschrijving]),
    [['a', 'uit catalogus'], ['b', 'alleen momentopname']]);
  pasCatalogusToe(doc, null);
  assert.equal(definitiesVan(doc).length, 2);
});

test('gebruik tellen en stiften overzetten', () => {
  const doc = { annotations: [
    { id: '1', type: 'stift', stiftDefId: 'a' }, { id: '2', type: 'stift', stiftDefId: 'a' },
    { id: '3', type: 'stift', stiftDefId: 'b' }, { id: '4', type: 'box' },
  ] };
  assert.deepEqual([...gebruik(doc)], [['a', 2], ['b', 1]]);
  const over = zetStiftenOver(doc, 'a', 'b');
  assert.deepEqual(over, [{ annotationId: '1', van: 'a', naar: 'b' }, { annotationId: '2', van: 'a', naar: 'b' }]);
  assert.deepEqual([...gebruik(doc)], [['b', 3]]);
});

test('kopie voor undo deelt niets met het document', () => {
  const doc = { stiftDefinities: [maakDefinitie('latei', { id: 'l' })] };
  const kopie = kopieDefinities(doc);
  kopie[0].omschrijving = 'x';
  assert.equal(doc.stiftDefinities[0].omschrijving, 'Latei');
});

test('een stift op een verborgen markeringslaag telt niet mee in de legenda', () => {
  const doc = {
    annotationLayers: [{ id: 'default', visible: true }, { id: 'oud', name: 'Oud', visible: false }],
    annotations: [
      { id: '1', type: 'stift', stiftDefId: 'a' },
      { id: '2', type: 'stift', stiftDefId: 'b', layer: 'oud' },
      { id: '3', type: 'box' },
    ],
  };
  assert.deepEqual(zichtbareStiften(doc).map((a) => a.id), ['1']);
  assert.deepEqual(zichtbareStiften({ annotations: doc.annotations }).map((a) => a.id), ['1', '2']);
  assert.deepEqual(zichtbareStiften(null), []);
});
