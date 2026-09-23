// "Als standaardstijl instellen" op een vorm zonder rand (#433, nawerk van
// #431). De randkleur-voorkeur van een soort wordt door MEER soorten gelezen
// dan alleen de soort waarvoor hij gezet is:
//
//   polygonStrokeColor  → veelhoek (kan zonder rand) én de L-vorm, die een
//                         polyline wordt (kan NIET zonder rand)
//   cloudStrokeColor    → wolk (kan zonder rand) én de wolklijn (kan niet)
//
// Bleef de voorkeur op 'none' staan, dan kreeg zo'n soort een onzichtbare
// lijn. En `color: 'none'` op een nieuwe vorm zette kruis, aanhaallijn en
// maatlabel op zwart in plaats van op de gekozen kleur.

import assert from 'node:assert/strict';
import test from 'node:test';

import { randkleurVoorVoorkeur, randkleurenUitVoorkeur } from './fill-utils.js';

// --- wegschrijven: wat komt er in <voorvoegsel>StrokeColor te staan? -------

test('een vorm zonder rand bewaart "geen rand" — die soort kan het', () => {
  assert.equal(randkleurVoorVoorkeur({ type: 'box', strokeColor: 'none', color: '#cc0000' }), 'none');
  assert.equal(randkleurVoorVoorkeur({ type: 'circle', strokeColor: 'transparent', color: '#cc0000' }), 'none');
  assert.equal(randkleurVoorVoorkeur({ type: 'measureArea', strokeColor: 'none' }), 'none');
});

test('een soort zonder "geen rand" laat de voorkeur NOOIT op none staan', () => {
  // Een lijn IS zijn streek: 'none' zou hem onzichtbaar maken.
  assert.equal(randkleurVoorVoorkeur({ type: 'line', strokeColor: 'none', color: '#00aa00' }), '#00aa00');
  assert.equal(randkleurVoorVoorkeur({ type: 'cloudPolyline', strokeColor: 'none', color: '#00aa00' }), '#00aa00');
  assert.equal(randkleurVoorVoorkeur({ type: 'text', strokeColor: 'transparent', color: '#00aa00' }), '#00aa00');
  // Geen bruikbare eigen kleur → null: de bestaande voorkeur blijft staan.
  assert.equal(randkleurVoorVoorkeur({ type: 'line', strokeColor: 'none', color: 'none' }), null);
  assert.equal(randkleurVoorVoorkeur({ type: 'polyline', strokeColor: 'none' }), null);
});

test('een gewone kleur gaat ongewijzigd naar de voorkeur', () => {
  assert.equal(randkleurVoorVoorkeur({ type: 'box', strokeColor: '#123456' }), '#123456');
  assert.equal(randkleurVoorVoorkeur({ type: 'line', color: '#123456' }), '#123456');
  // Niets gekozen → null, zodat de aanroeper de bestaande voorkeur houdt.
  assert.equal(randkleurVoorVoorkeur({ type: 'box' }), null);
  assert.equal(randkleurVoorVoorkeur(null), null);
});

// --- teruglezen: welke kleuren krijgt een nieuwe annotatie? ----------------

test('geen rand in de voorkeur geldt alleen voor soorten die het kennen', () => {
  const prefs = { polygonStrokeColor: 'none', cloudStrokeColor: 'none' };

  // Veelhoek en wolk: de omtrek mag weg.
  assert.equal(randkleurenUitVoorkeur(prefs, 'polygon', 'polygon').strokeColor, 'none');
  assert.equal(randkleurenUitVoorkeur(prefs, 'cloud', 'cloud').strokeColor, 'none');

  // De L-vorm leest dezelfde voorkeur maar wordt een polyline, de wolklijn
  // leest cloudStrokeColor: allebei zichtbaar houden.
  assert.equal(randkleurenUitVoorkeur(prefs, 'polygon', 'polyline', '#ff0000').strokeColor, '#ff0000');
  assert.equal(randkleurenUitVoorkeur(prefs, 'cloud', 'cloudPolyline', '#ff0000').strokeColor, '#ff0000');
});

test('de eigen kleur van een nieuwe vorm is nooit "none"', () => {
  // colorWithoutStroke() valt bij color 'none' terug op zwart; het kruis en de
  // aanhaallijn van een randloze vorm horen de gekozen kleur te krijgen.
  const { color, strokeColor } = randkleurenUitVoorkeur({ rectStrokeColor: 'none' }, 'rect', 'box', '#0000ff');
  assert.equal(strokeColor, 'none');
  assert.equal(color, '#0000ff');
});

test('een gewone voorkeur geeft dezelfde kleur voor rand en eigen kleur', () => {
  const prefs = { rectStrokeColor: '#FF0000' };
  assert.deepEqual(randkleurenUitVoorkeur(prefs, 'rect', 'box'), { color: '#FF0000', strokeColor: '#FF0000' });
});

test('een ontbrekende voorkeur valt terug op de meegegeven kleur', () => {
  assert.deepEqual(randkleurenUitVoorkeur({}, 'rect', 'box', '#abcdef'), { color: '#abcdef', strokeColor: '#abcdef' });
  assert.deepEqual(randkleurenUitVoorkeur(undefined, 'rect', 'box'), { color: '#000000', strokeColor: '#000000' });
  // Een terugval die zelf geen kleur is, mag niet doorsijpelen.
  assert.deepEqual(randkleurenUitVoorkeur({}, 'rect', 'box', 'none'), { color: '#000000', strokeColor: '#000000' });
});
