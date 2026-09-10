// De store houdt de bronbytes van vectorknipsels vast en ontdubbelt ze op
// inhoud. Gaat dat mis, dan sleept elk knipsel zijn eigen kopie van een zwaar
// CAD-blad mee — precies wat deze module moet voorkomen.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sleutelVoor, bewaar, bytesVan, sleutels, heeft, wisOngebruikt, leegmaken, padVan,
} from './vector-snippet-store.js';

const bytes = (s) => new TextEncoder().encode(s);
const tekst = (b) => new TextDecoder().decode(b);

test('sleutelVoor is stabiel, hexadecimaal en 64 bits', () => {
  assert.equal(sleutelVoor(bytes('x')), sleutelVoor(bytes('x')));
  assert.match(sleutelVoor(bytes('x')), /^[0-9a-f]{16}$/);
  assert.notEqual(sleutelVoor(bytes('x')), sleutelVoor(bytes('y')));
});

test('sleutelVoor onderscheidt inhoud die alleen in lengte verschilt', () => {
  assert.notEqual(sleutelVoor(bytes('aaa')), sleutelVoor(bytes('aaaa')));
  assert.notEqual(sleutelVoor(new Uint8Array(0)), sleutelVoor(new Uint8Array(1)));
});

test('dezelfde bytes worden maar één keer bewaard', () => {
  leegmaken();
  const a = bewaar(bytes('pdf-een'));
  const b = bewaar(bytes('pdf-een'));
  assert.equal(a, b);
  assert.equal(sleutels().length, 1, 'geen tweede kopie');
  const c = bewaar(bytes('pdf-twee'));
  assert.notEqual(a, c);
  assert.equal(sleutels().length, 2);
});

test('bytes komen ongewijzigd terug; een onbekende sleutel geeft null', () => {
  leegmaken();
  const sleutel = bewaar(bytes('inhoud'));
  assert.equal(tekst(bytesVan(sleutel)), 'inhoud');
  assert.equal(heeft(sleutel), true);
  assert.equal(bytesVan('deadbeefdeadbeef'), null);
  assert.equal(heeft('deadbeefdeadbeef'), false);
});

test('wisOngebruikt houdt alleen wat nog in gebruik is', () => {
  leegmaken();
  const k1 = bewaar(bytes('een'));
  const k2 = bewaar(bytes('twee'));
  const k3 = bewaar(bytes('drie'));
  assert.equal(wisOngebruikt([k1, k3]), 1);
  assert.deepEqual(sleutels().sort(), [k1, k3].sort());
  assert.equal(bytesVan(k2), null);
});

test('wisOngebruikt zonder gebruikers maakt alles leeg', () => {
  leegmaken();
  bewaar(bytes('een'));
  bewaar(bytes('twee'));
  assert.equal(wisOngebruikt([]), 2);
  assert.deepEqual(sleutels(), []);
});

test('padVan schrijft één keer weg en onthoudt het pad', async () => {
  leegmaken();
  const sleutel = bewaar(bytes('inhoud'));
  let schrijfacties = 0;
  const schrijf = async (s, b) => { schrijfacties++; return `C:/cache/${s}.pdf`; };
  assert.equal(await padVan(sleutel, schrijf), `C:/cache/${sleutel}.pdf`);
  assert.equal(await padVan(sleutel, schrijf), `C:/cache/${sleutel}.pdf`);
  assert.equal(schrijfacties, 1, 'tweede aanroep gebruikt het onthouden pad');
});

test('padVan van een onbekende sleutel schrijft niets', async () => {
  leegmaken();
  let schrijfacties = 0;
  const pad = await padVan('deadbeefdeadbeef', async () => { schrijfacties++; return 'x'; });
  assert.equal(pad, null);
  assert.equal(schrijfacties, 0);
});

test('een mislukte schrijfactie wordt niet onthouden', async () => {
  leegmaken();
  const sleutel = bewaar(bytes('inhoud'));
  assert.equal(await padVan(sleutel, async () => null), null);
  assert.equal(await padVan(sleutel, async (s) => `C:/cache/${s}.pdf`), `C:/cache/${sleutel}.pdf`);
});

test('wisOngebruikt vergeet ook het pad', async () => {
  leegmaken();
  const sleutel = bewaar(bytes('inhoud'));
  await padVan(sleutel, async (s) => `C:/cache/${s}.pdf`);
  wisOngebruikt([]);
  const opnieuw = bewaar(bytes('inhoud'));
  let schrijfacties = 0;
  await padVan(opnieuw, async (s) => { schrijfacties++; return `C:/cache/${s}.pdf`; });
  assert.equal(schrijfacties, 1, 'na wissen moet er opnieuw geschreven worden');
});
