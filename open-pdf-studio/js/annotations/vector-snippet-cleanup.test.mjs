// Opruimen van knipsel-bronnen: welke sleutels zijn nog in gebruik?
//
// De klembord-module importeert state/factory/undo (TypeScript + SolidJS), dus
// hier testen we de pure kern: gebruikteSleutels-logica tegen de echte store.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { bewaar, sleutels, leegmaken, wisOngebruikt } from './vector-snippet-store.js';

// gebruikteSleutels uit de echte bron halen, zonder de app-imports mee te laden.
// Regeleinden gelijktrekken: op een Windows-checkout met autocrlf staat er
// CRLF in het bestand en vindt het zoeken naar de sluitaccolade hieronder niets.
const bron = readFileSync(new URL('./vector-snippet-clipboard.js', import.meta.url), 'utf8')
  .split('\r\n').join('\n');
const start = bron.indexOf('export function gebruikteSleutels');
const eind = bron.indexOf('\n}\n', start) + 3;
const fnTekst = bron.slice(start, eind).replace('export function', 'function');
// eslint-disable-next-line no-new-func
const gebruikteSleutels = new Function('_knipsel', `${fnTekst}; return gebruikteSleutels;`);

const bytes = (s) => new TextEncoder().encode(s);

test('alleen bronnen van knipsels in open documenten blijven staan', () => {
  leegmaken();
  const houden = bewaar(bytes('in gebruik'));
  const weg = bewaar(bytes('verwijderd knipsel'));
  const docs = [{ annotations: [{ type: 'vectorSnippet', snippetKey: houden }, { type: 'box' }] }];
  const fn = gebruikteSleutels(null);
  assert.equal(wisOngebruikt(fn(docs)), 1);
  assert.deepEqual(sleutels(), [houden]);
  void weg;
});

test('wat op het klembord staat wordt niet opgeruimd, ook zonder document', () => {
  leegmaken();
  const opKlembord = bewaar(bytes('net geknipt'));
  const fn = gebruikteSleutels({ snippetKey: opKlembord });
  assert.equal(wisOngebruikt(fn([])), 0);
  assert.deepEqual(sleutels(), [opKlembord]);
});

test('een vastgezet knipsel houdt zijn bron tot na opslaan', () => {
  // Vastgezet is nog een annotatie tot het bestand opnieuw geopend wordt, en de
  // saver heeft de bronbytes nodig om hem in de inhoudstroom te schrijven.
  leegmaken();
  const k = bewaar(bytes('vastgezet'));
  const fn = gebruikteSleutels(null);
  wisOngebruikt(fn([{ annotations: [{ type: 'vectorSnippet', snippetKey: k, flattened: true }] }]));
  assert.deepEqual(sleutels(), [k]);
});

test('twee documenten met knipsels uit dezelfde bron delen die bron', () => {
  leegmaken();
  const k = bewaar(bytes('gedeelde bron'));
  const fn = gebruikteSleutels(null);
  const docs = [
    { annotations: [{ type: 'vectorSnippet', snippetKey: k }] },
    { annotations: [{ type: 'vectorSnippet', snippetKey: k }] },
  ];
  assert.deepEqual(fn(docs), [k], 'een sleutel, niet twee');
});
