import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voegVolgordeSamen, verplaatsNaast, verschuifZichtbaar, isStandaardVolgorde } from './sectie-volgorde.js';

const STD = ['general', 'location', 'replies', 'appearance', 'textFormat', 'paragraph'];

test('zonder opgeslagen volgorde: de standaard', () => {
  assert.deepEqual(voegVolgordeSamen(STD, null), STD);
  assert.deepEqual(voegVolgordeSamen(STD, []), STD);
  assert.equal(isStandaardVolgorde(null, STD), true);
});

test('opgeslagen volgorde wint, niets verloren of dubbel', () => {
  const opg = ['appearance', 'general', 'location', 'replies', 'textFormat', 'paragraph'];
  assert.deepEqual(voegVolgordeSamen(STD, opg), opg);
  const dubbel = ['appearance', 'appearance', 'general'];
  const r = voegVolgordeSamen(STD, dubbel);
  assert.equal(r.length, STD.length);
  assert.equal(new Set(r).size, STD.length);
  assert.equal(r[0], 'appearance');
});

test('onbekende sleutels vallen weg, nieuwe secties op hun standaardplek', () => {
  // De gebruiker plaatste Appearance boven Location; 'replies' en
  // 'paragraph' kende de opgeslagen lijst nog niet, 'oud' bestaat niet meer.
  const opg = ['general', 'appearance', 'oud', 'location', 'textFormat'];
  assert.deepEqual(voegVolgordeSamen(STD, opg),
    ['general', 'appearance', 'location', 'replies', 'textFormat', 'paragraph']);
  // Nieuwe sectie zonder voorganger in de lijst komt vooraan.
  assert.deepEqual(voegVolgordeSamen(['nieuw', 'a', 'b'], ['b', 'a']), ['nieuw', 'b', 'a']);
});

test('slepen: Appearance boven Location', () => {
  const r = verplaatsNaast(STD, 'appearance', 'location');
  assert.deepEqual(r, ['general', 'appearance', 'location', 'replies', 'textFormat', 'paragraph']);
  assert.equal(isStandaardVolgorde(r, STD), false);
  // Erna: General onder Replies.
  assert.deepEqual(verplaatsNaast(STD, 'general', 'replies', true),
    ['location', 'replies', 'general', 'appearance', 'textFormat', 'paragraph']);
  // Op zichzelf of onbekend doel: niets verandert.
  assert.deepEqual(verplaatsNaast(STD, 'general', 'general'), STD);
  assert.deepEqual(verplaatsNaast(STD, 'general', 'x'), STD);
});

test('volgorde geldt voor een soort met andere secties', () => {
  const eigen = verplaatsNaast(STD, 'paragraph', 'general');
  // Een lijn heeft geen Paragraph/Character: de rest houdt de volgorde.
  const lijn = new Set(['general', 'location', 'appearance']);
  assert.deepEqual(eigen.filter(k => lijn.has(k)), ['general', 'location', 'appearance']);
  const tekst = new Set(['general', 'location', 'paragraph']);
  assert.deepEqual(eigen.filter(k => tekst.has(k)), ['paragraph', 'general', 'location']);
});

test('toetsenbord: verschuiven springt over verborgen secties', () => {
  const zicht = ['general', 'appearance', 'textFormat'];
  // Appearance omhoog: langs General (location/replies zijn verborgen).
  const op = verschuifZichtbaar(STD, 'appearance', -1, zicht);
  assert.deepEqual(op.filter(k => zicht.includes(k)), ['appearance', 'general', 'textFormat']);
  // General omlaag: na Appearance.
  const neer = verschuifZichtbaar(STD, 'general', 1, zicht);
  assert.deepEqual(neer.filter(k => zicht.includes(k)), ['appearance', 'general', 'textFormat']);
  // Bovenaan omhoog en onderaan omlaag: niets.
  assert.deepEqual(verschuifZichtbaar(STD, 'general', -1, zicht), STD);
  assert.deepEqual(verschuifZichtbaar(STD, 'paragraph', 1), STD);
});
