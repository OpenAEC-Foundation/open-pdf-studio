// Palet-pictogrammen van de categorie NL IFC Bouw: één stijl (viewBox 64,
// leesbare tekst), unieke pattern-/clip-id's (alle pictogrammen delen het
// DOM) en elk gereedschap een eigen pictogram.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NL_CATEGORIES } from './nlSymbolLibrary.js';

const cat = NL_CATEGORIES.find((c) => c.id === 'nl-ifc-bouw');

test('elk symbool heeft een eigen 64×64-pictogram', () => {
  assert.equal(cat.symbols.length, 43);
  for (const s of cat.symbols) {
    assert.match(s.svg, /^<svg viewBox="0 0 64 64"/, s.id);
    const kop = s.svg.slice(0, s.svg.indexOf('>'));
    assert.ok(!/\s(width|height)=/.test(kop), `${s.id}: geen vaste maat op <svg>`);
  }
  const svgs = cat.symbols.map((s) => s.svg);
  assert.equal(new Set(svgs).size, svgs.length, 'geen twee gereedschappen met hetzelfde pictogram');
  assert.match(cat.icon, /^<svg viewBox="0 0 16 16"/);
});

test('tekst in pictogrammen is minstens 11 eenheden hoog', () => {
  for (const s of cat.symbols) {
    for (const m of s.svg.matchAll(/<text[^>]*font-size="([\d.]+)"/g)) {
      assert.ok(Number(m[1]) >= 11, `${s.id}: font-size ${m[1]}`);
    }
  }
});

test('lijndiktes volgen de stijl (hoofdlijn 2, detail 1,25)', () => {
  const toegestaan = new Set(['1', '1.25', '2', '3']);
  for (const s of cat.symbols) {
    for (const m of s.svg.matchAll(/stroke-width="([\d.]+)"/g)) {
      assert.ok(toegestaan.has(m[1]), `${s.id}: stroke-width ${m[1]}`);
    }
  }
});

test('pattern- en clip-id\'s zijn uniek over de hele categorie', () => {
  const ids = cat.symbols.flatMap((s) => [...s.svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
  for (const s of cat.symbols) {
    for (const m of s.svg.matchAll(/url\(#([^)]+)\)/g)) {
      assert.ok(s.svg.includes(`id="${m[1]}"`), `${s.id}: verwijzing naar eigen id ${m[1]}`);
    }
  }
});
