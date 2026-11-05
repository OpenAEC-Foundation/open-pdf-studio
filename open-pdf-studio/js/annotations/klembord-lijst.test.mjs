import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voegToe, verwijder, omschrijving, KLEMBORD_MAX } from './klembord-lijst.js';

test('nieuwste kopie komt vooraan', () => {
  let l = [];
  l = voegToe(l, { id: 'a' });
  l = voegToe(l, { id: 'b' });
  assert.deepEqual(l.map(i => i.id), ['b', 'a']);
});

test('geschiedenis houdt hooguit 30 kopieen', () => {
  let l = [];
  for (let i = 0; i < 40; i++) l = voegToe(l, { id: `c${i}` });
  assert.equal(KLEMBORD_MAX, 30);
  assert.equal(l.length, 30);
  assert.equal(l[0].id, 'c39');
  assert.equal(l[29].id, 'c10');
});

test('verwijderen haalt alleen dat item weg', () => {
  const l = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(verwijder(l, 'b').map(i => i.id), ['a', 'c']);
  assert.deepEqual(verwijder(l, 'x').map(i => i.id), ['a', 'b', 'c']);
  assert.deepEqual(verwijder(null, 'a'), []);
});

test('omschrijving: soort en tekst voor een markering, null voor een groep', () => {
  assert.equal(omschrijving([{ type: 'textbox', text: '  Hallo\n wereld ' }]), 'textbox: Hallo wereld');
  assert.equal(omschrijving([{ type: 'cloud' }]), 'cloud');
  assert.equal(omschrijving([{ type: 'a' }, { type: 'b' }]), null);
  assert.equal(omschrijving([{ type: 'textbox', text: 'x'.repeat(40) }]).length, 'textbox: '.length + 24);
});
