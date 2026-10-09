import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapTekst } from './wrap-tekst.js';

const tien = (s) => s.length * 10; // elk teken 10 breed

test('korte tekst blijft ongewijzigd', () => {
  assert.equal(wrapTekst('hallo wereld', 200, tien), 'hallo wereld');
});

test('lange tekst breekt op spaties binnen de breedte', () => {
  const uit = wrapTekst('aaa bbb ccc ddd eee', 80, tien); // 8 tekens per regel
  assert.equal(uit, 'aaa bbb\nccc ddd\neee');
  for (const regel of uit.split('\n')) assert.ok(tien(regel) <= 80);
});

test('bestaande regeleinden en lege regels blijven staan', () => {
  assert.equal(wrapTekst('een\n\ntwee drie', 200, tien), 'een\n\ntwee drie');
  assert.equal(wrapTekst('aaa bbb ccc\nddd', 70, tien), 'aaa bbb\nccc\nddd');
});

test('een woord dat niet past wordt op tekens afgebroken', () => {
  const uit = wrapTekst('abcdefghij kl', 50, tien); // 5 tekens per regel
  assert.equal(uit, 'abcde\nfghij\nkl');
});

test('onbruikbare invoer geeft de tekst terug', () => {
  assert.equal(wrapTekst('abc def', 0, tien), 'abc def');
  assert.equal(wrapTekst('abc def', 50, null), 'abc def');
  assert.equal(wrapTekst(undefined, 50, tien), '');
});
