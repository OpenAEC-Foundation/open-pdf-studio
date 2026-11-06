import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tijdelijkNaTabKlik, tijdelijkSluitenBij } from './ribbon-ingeklapt.js';

test('ingeklapt: een tabtitel klapt het lint tijdelijk open (#960)', () => {
  assert.equal(tijdelijkNaTabKlik({ ingeklapt: true, tijdelijkOpen: false, zelfdeTab: true }), true);
  assert.equal(tijdelijkNaTabKlik({ ingeklapt: true, tijdelijkOpen: false, zelfdeTab: false }), true);
  // Een ander tabblad terwijl het open staat: blijft open met dat tabblad.
  assert.equal(tijdelijkNaTabKlik({ ingeklapt: true, tijdelijkOpen: true, zelfdeTab: false }), true);
  // Nog eens op dezelfde titel: weer dicht.
  assert.equal(tijdelijkNaTabKlik({ ingeklapt: true, tijdelijkOpen: true, zelfdeTab: true }), false);
});

test('niet ingeklapt: nooit tijdelijk', () => {
  assert.equal(tijdelijkNaTabKlik({ ingeklapt: false, tijdelijkOpen: false, zelfdeTab: false }), false);
  assert.equal(tijdelijkNaTabKlik({ ingeklapt: false, tijdelijkOpen: true, zelfdeTab: true }), false);
});

test('dichtklappen bij een klik buiten het lint of Esc', () => {
  assert.equal(tijdelijkSluitenBij({ tijdelijkOpen: true, soort: 'pointerdown', binnenLint: false }), true);
  assert.equal(tijdelijkSluitenBij({ tijdelijkOpen: true, soort: 'pointerdown', binnenLint: true }), false);
  assert.equal(tijdelijkSluitenBij({ tijdelijkOpen: true, soort: 'keydown', toets: 'Escape' }), true);
  assert.equal(tijdelijkSluitenBij({ tijdelijkOpen: true, soort: 'keydown', toets: 'a' }), false);
  assert.equal(tijdelijkSluitenBij({ tijdelijkOpen: false, soort: 'pointerdown', binnenLint: false }), false);
});

test('het lint toont de inhoud ook als hij tijdelijk open is', () => {
  const s = readFileSync(new URL('./Ribbon.jsx', import.meta.url), 'utf8');
  assert.match(s, /<Show when=\{inhoudZichtbaar\(\)\}>/);
  assert.match(s, /tijdelijkNaTabKlik\(/);
  assert.doesNotMatch(s, /onClick=\{\(\) => setActiveTab\('/, 'every tab title goes through kiesTab');
  const css = readFileSync(new URL('../../../../styles/ribbon.css', import.meta.url), 'utf8');
  assert.match(css, /\.ribbon-container\.ribbon-tijdelijk-open > \.ribbon-content/);
});
