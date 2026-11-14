// Het verscherpen van paginabeelden in Rust in plaats van op de
// interface-thread: de route vraagt één keer of de backend het kan, geeft de
// sterkte mee aan het render-commando en onthoudt welke beelden al verscherpt
// terugkwamen, zodat de JS-filter die overslaat.

import assert from 'node:assert/strict';
import test from 'node:test';
import { maakSharpenRoute } from './render-sharpen-route.js';

const beeld = (n = 16) => new Uint8Array(8 + n);

test('de backend wordt één keer gevraagd; ja geeft de sterkte van de voorkeur', async () => {
  const vragen = [];
  const route = maakSharpenRoute({ invoke: async (cmd) => { vragen.push(cmd); return true; }, sterkte: () => 0.5 });
  assert.equal(await route.aanvraag(), 0.5);
  assert.equal(await route.aanvraag(), 0.5);
  assert.deepEqual(vragen, ['sharpen_rust_beschikbaar']);
});

test('uitgezet, een oudere backend of geen Tauri: geen aanvraag, JS verscherpt zelf', async () => {
  for (const invoke of [async () => false, async () => { throw new Error('Command sharpen_rust_beschikbaar not found'); }, null]) {
    const route = maakSharpenRoute({ invoke, sterkte: () => 0.5 });
    assert.equal(await route.aanvraag(), 0);
    const bytes = beeld();
    route.markeer(bytes, 0);
    assert.equal(route.isVerscherpt(new Uint8ClampedArray(bytes.buffer, 8)), false);
  }
});

test('voorkeur op 0 (uit): geen aanvraag, ook als de backend het kan', async () => {
  const route = maakSharpenRoute({ invoke: async () => true, sterkte: () => 0 });
  assert.equal(await route.aanvraag(), 0);
});

test('de sterkte volgt de voorkeur van het moment van de aanvraag', async () => {
  let s = 0.3;
  const route = maakSharpenRoute({ invoke: async () => true, sterkte: () => s });
  assert.equal(await route.aanvraag(), 0.3);
  s = 1.2;
  assert.equal(await route.aanvraag(), 1.2);
});

test('een beeld dat verscherpt terugkwam is herkenbaar aan zijn buffer, in elke vorm', async () => {
  const route = maakSharpenRoute({ invoke: async () => true, sterkte: () => 0.5 });
  const alsBytes = beeld();
  route.markeer(alsBytes, 0.5);
  assert.equal(route.isVerscherpt(new Uint8ClampedArray(alsBytes.buffer, alsBytes.byteOffset + 8)), true);
  const alsBuffer = beeld().buffer;
  route.markeer(alsBuffer, 0.5);
  assert.equal(route.isVerscherpt(new Uint8ClampedArray(alsBuffer, 8)), true);
  // Een ander beeld, of een antwoord zonder aanvraag, niet.
  assert.equal(route.isVerscherpt(new Uint8ClampedArray(beeld().buffer, 8)), false);
  const zonder = beeld();
  route.markeer(zonder, 0);
  assert.equal(route.isVerscherpt(new Uint8ClampedArray(zonder.buffer, 8)), false);
  // Geen beeld: geen fout.
  route.markeer(null, 0.5);
  route.markeer(undefined, 0.5);
  assert.equal(route.isVerscherpt(null), false);
});

test('gelijktijdige eerste aanvragen stellen samen één vraag', async () => {
  let vragen = 0;
  const route = maakSharpenRoute({ invoke: async () => { vragen++; await new Promise((r) => setTimeout(r, 5)); return true; }, sterkte: () => 0.8 });
  assert.deepEqual(await Promise.all([route.aanvraag(), route.aanvraag(), route.aanvraag()]), [0.8, 0.8, 0.8]);
  assert.equal(vragen, 1);
});
